import * as THREE from 'three/webgpu';
import { trackWind } from './ede-wind-props.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';

// Open heath southwest of the Schaapskooi, on the far side of the diagonal footpath.
const SPOTS = [
  { x: 4276, z: 1144, lineLength: 19, color: 0xef4536 },
  { x: 4301, z: 1158, lineLength: 26, color: 0xffc430 },
  { x: 4330, z: 1173, lineLength: 22, color: 0x137cdb }
];
const TAIL_SEGMENTS = 12;
const LINE_SEGMENTS = 12;

function makeSail(color, material) {
  const vertices = [[0, 0.61, 0], [-0.66, 0.09, 0], [0, -0.85, 0], [0.66, 0.09, 0]];
  const fabric = new THREE.Color(color);
  const stripe = new THREE.Color(0xfff4d8);
  const positions = [], colors = [], indices = [];
  for (let i = 0; i < vertices.length; i++) {
    positions.push(...vertices[i], ...vertices[(i + 1) % vertices.length], 0, 0.09, 0.15);
    const panel = i === 0 ? stripe : fabric;
    colors.push(...panel, ...panel, ...panel);
    indices.push(3 * i, 3 * i + 1, 3 * i + 2);
  }
  for (let i = 0; i <= TAIL_SEGMENTS; i++) {
    positions.push(-0.035, -0.85 - i * 0.25, 0, 0.035, -0.85 - i * 0.25, 0);
    const band = i % 4 < 2 ? fabric : stripe;
    colors.push(...band, ...band);
    const row = 12 + i * 2;
    if (i > 0) indices.push(row - 2, row - 1, row, row - 1, row + 1, row);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.getAttribute('normal').setUsage(THREE.DynamicDrawUsage);
  const sail = new THREE.Mesh(geometry, material);
  sail.frustumCulled = false;
  sail.name = 'Kite sail and tail';
  return sail;
}

export function createKiteFlyers(scene, terrainHeightAt) {
  const group = new THREE.Group();
  group.name = 'Ginkelse Heide kite flyers';
  group.visible = false;
  scene.add(group);

  const windHeading = new THREE.Object3D();
  let speed = 0;
  trackWind(windHeading, { downwind: true, deform: (_dt, metresPerSecond) => { speed = metresPerSecond; } });
  const ground = (_flyer, x, z) => terrainHeightAt(x, z);
  const bridle = new THREE.Vector3();
  const { lerp, smoothstep } = THREE.MathUtils;
  let crowd, flyers;
  let time = 0, flutterTime = 0, lift = 0, gust = 0;

  function populate() {
    crowd = new PersonCrowd(SPOTS.length);
    group.add(...crowd.meshes);
    const fabric = new THREE.MeshStandardNodeMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    const cord = new THREE.LineBasicMaterial({ color: 0xc5c0aa, transparent: true, opacity: 0.65, depthWrite: false });
    flyers = SPOTS.map((spot, index) => {
      const sail = makeSail(spot.color, fabric);
      const shape = new THREE.BufferGeometry();
      const cordVertices = new THREE.BufferAttribute(new Float32Array((LINE_SEGMENTS + 1) * 3), 3);
      shape.setAttribute('position', cordVertices.setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(shape, cord);
      line.name = 'Kite line';
      line.frustumCulled = false;
      group.add(sail, line);
      return { ...spot, y: terrainHeightAt(spot.x, spot.z), sail, cordVertices, phase: index * 2.1,
        rig: new PersonRig({ seed: index * 3.19 + 1.8, female: index === 1, scale: [1.02, 0.95, 0.9][index] }),
        control: { elevation: 0, pull: 0, hand: new THREE.Vector3() } };
    });
  }

  return {
    update(dt, camera, wind) {
      const dx = camera.x - 4301, dz = camera.z - 1158;
      const radius = group.visible ? 275 : 250;
      if (dx * dx + dz * dz > radius * radius) {
        group.visible = false;
        return;
      }
      const entering = !group.visible;
      if (!flyers) populate();
      group.visible = true;
      time += dt;
      windHeading.userData.updateWind(entering ? 60 : dt, wind);
      flutterTime += dt * (1.8 + speed * 0.26);
      const yaw = windHeading.rotation.y + Math.PI / 2;
      const downwindX = Math.sin(yaw), downwindZ = Math.cos(yaw);
      const windGusts = (wind?.windGusts ?? wind?.windSpeed ?? 0) / 3.6;
      const targetLift = smoothstep(speed, 2, 3.4) * (1 - smoothstep(Math.max(speed, windGusts), 10, 15));
      const blend = entering ? 1 : -Math.expm1(-dt / 1.8);
      lift += (targetLift - lift) * blend;
      gust += (Math.min(4, Math.max(0, windGusts - speed)) - gust) * blend;
      crowd.begin();

      for (const flyer of flyers) {
        const { x, y, z, sail, rig, phase, control, cordVertices } = flyer;
        const wave = Math.sin(time * 1.05 + phase);
        const flutter = Math.sin(flutterTime + phase);
        const elevation = lift * (lerp(0.47, 0.93, smoothstep(speed, 2, 9)) + wave * 0.07 + gust * flutter * 0.014);
        const sweep = wave * lift * (1.15 + 0.22 * gust);
        const range = lerp(1.25, flyer.lineLength, lift);
        const reach = Math.cos(elevation) * range;
        const kx = x + downwindX * reach + downwindZ * sweep;
        const kz = z + downwindZ * reach - downwindX * sweep;
        const ky = Math.max(terrainHeightAt(kx, kz) + 0.24, y + range * Math.sin(elevation) + lift * 1.25);
        sail.position.set(kx, ky, kz);
        sail.rotation.set(lerp(-1.53, -0.32 - elevation * 0.24, lift), yaw, lift * (0.16 * wave + 0.025 * gust * flutter), 'YXZ');
        // The main scene freezes its world matrices after startup.
        sail.updateMatrixWorld();

        control.elevation = elevation;
        control.pull = lift * (0.08 + wave * 0.05);
        if (entering) rig.placed = false;
        rig.update(dt, x, z, yaw, ground, null, 0, false);
        rig.solve(control);
        crowd.add(rig, Math.hypot(x - camera.x, y - camera.y, z - camera.z));

        const hand = control.hand;
        bridle.set(0, 0.09, 0.15).applyMatrix4(sail.matrixWorld);
        const sag = lerp(0.16, lerp(1.1, 0.22, smoothstep(speed, 2, 8)), lift);
        for (let i = 0; i <= LINE_SEGMENTS; i++) {
          const t = i / LINE_SEGMENTS;
          cordVertices.setXYZ(i, lerp(hand.x, bridle.x, t), lerp(hand.y, bridle.y, t) - 4 * sag * t * (1 - t), lerp(hand.z, bridle.z, t));
        }
        cordVertices.needsUpdate = true;

        const tail = sail.geometry.getAttribute('position');
        for (let i = 0; i <= TAIL_SEGMENTS; i++) {
          const t = i / TAIL_SEGMENTS;
          const ripplePhase = flutterTime * 1.25 - 8 * t + phase;
          const drift = Math.sin(ripplePhase) * t * lift * (0.28 + gust * 0.07);
          const trail = t * lerp(0.8, 3, lift);
          const ripple = -t * 0.35 * lift + Math.cos(ripplePhase) * t * lift * 0.17;
          const width = i % 4 === 2 ? 0.085 : 0.038;
          tail.setXYZ(12 + 2 * i, drift - width, -0.85 - trail, ripple);
          tail.setXYZ(13 + 2 * i, drift + width, -0.85 - trail, ripple);
        }
        tail.needsUpdate = true;
        sail.geometry.computeVertexNormals();
      }
      crowd.end();
    }
  };
}
