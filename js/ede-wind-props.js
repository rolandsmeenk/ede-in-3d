import * as THREE from 'three/webgpu';

// The props are placed in the world grid. Local +X points along the arrow, cloth or sock.
export function trackWind(object, { downwind = false, deform } = {}) {
  let aligned = false;
  let speed;
  object.userData.updateWind = (dt, reading) => {
    const target = (reading?.windSpeed ?? 0) / 3.6;
    let turn = 0;
    if (target > 0.05) {
      const yaw = (downwind ? -Math.PI / 2 : Math.PI / 2) - THREE.MathUtils.degToRad(reading.windDirection);
      const difference = yaw - object.rotation.y;
      const delta = Math.atan2(Math.sin(difference), Math.cos(difference));
      if (Math.abs(delta) > 0.001) turn = aligned ? delta * -Math.expm1(-dt / 1.2) : delta;
      object.rotation.y = (object.rotation.y + turn) % (2 * Math.PI);
      aligned = true;
    }
    if (deform) {
      const previous = speed ?? target;
      speed = Math.abs(previous - target) < 0.005 ? target : previous + (target - previous) * -Math.expm1(-dt / 0.8);
      deform(dt, speed);
    }
    // Landmark transforms are normally frozen after startup.
    if (turn || deform) object.updateMatrixWorld(true);
  };
  return object;
}

export function createWindVane(name, x, y, z, outline, color) {
  const shape = new THREE.Shape(outline.map(([px, py]) => new THREE.Vector2(px, py)));
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardNodeMaterial({ color, metalness: 0.38, roughness: 0.48, side: THREE.DoubleSide }));
  mesh.position.set(x, y, z);
  mesh.name = name;
  mesh.castShadow = true;
  return trackWind(mesh);
}

export function createWindFlag(material, phase) {
  const width = 2.16, height = 1.44;
  const geometry = new THREE.PlaneGeometry(width, height, 16, 4);
  const positions = geometry.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
  const uvs = geometry.getAttribute('uv');
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -height / 2, 0), width + height / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  let wasCalm = false;
  return trackWind(mesh, { downwind: true, deform(dt, speed) {
    if (wasCalm && speed === 0) return;
    wasCalm = speed === 0;
    const lift = THREE.MathUtils.smoothstep(speed, 0, 6);
    phase = (phase + dt * (3.5 + Math.min(speed, 14))) % (2 * Math.PI);
    for (let i = 0; i < positions.count; i++) {
      const u = uvs.getX(i);
      const y = (uvs.getY(i) - 1) * height;
      const wave = Math.sin(phase - 10 * u + y * 1.3) * 0.22 + Math.sin(phase * 2 - 19 * u) * 0.055;
      positions.setXYZ(i, 0.055 + u * width * (0.11 + lift * 0.89),
        y - (1 - lift) * 1.27 * u * u, lift * u * wave);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  } });
}
