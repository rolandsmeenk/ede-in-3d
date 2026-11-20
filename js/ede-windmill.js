import * as THREE from 'three/webgpu';

const TURN_RATE = 0.45;
const MILL_MAX_RPM = 16;
const TAU = 2 * Math.PI;
const RPM_TO_RADIANS = TAU / 60;
const CLOTH_MATERIAL = new THREE.MeshStandardNodeMaterial({
  color: 0xd5c5a7, roughness: 0.95, side: THREE.DoubleSide,
});

export function addWindmillSailcloth(sails, { angle, radii, root, innerWidth, outerWidth }) {
  const positions = [];
  let reefedCount;
  // Two radial bands fit the tapered lattice. The centre bows slightly in front of the bars.
  for (const [start, end] of [[0, 0.58], [0.58, 1]]) {
    for (let arm = 0; arm < 4; arm++) {
      const phase = angle + arm * Math.PI / 2;
      const cos = Math.cos(phase), sin = Math.sin(phase);
      const tip = radii[arm % radii.length] - 0.12;
      const point = (t, across) => {
        const radius = THREE.MathUtils.lerp(root + 0.12, tip, t);
        const width = THREE.MathUtils.lerp(innerWidth, outerWidth, t);
        const edge = 0.07 + across * (width - 0.14);
        const bow = across === 0.5 ? 0.17 : 0.06;
        return [radius * cos - edge * sin, radius * sin + edge * cos, bow];
      };
      for (const [left, right] of [[0, 0.5], [0.5, 1]]) {
        const a = point(start, left), b = point(end, left);
        const c = point(end, right), d = point(start, right);
        positions.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    }
    reefedCount ??= positions.length / 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const cloth = new THREE.Mesh(geometry, CLOTH_MATERIAL);
  cloth.name = 'Windmill sailcloth';
  cloth.castShadow = cloth.receiveShadow = true;
  cloth.visible = false;
  cloth.userData.reefedCount = reefedCount;
  sails.userData.sailcloth = cloth;
  sails.add(cloth);
  return cloth;
}

// The cap turns into the wind while the rotor spins independently about its shaft.
export function createWindmillRig(tower, hubHeight, hubOffset, shaftSlope, { turbine = false } = {}) {
  const cap = new THREE.Group();
  cap.name = 'Windmill cap';
  const shaft = new THREE.Group();
  shaft.position.set(0, hubHeight, hubOffset);
  shaft.rotation.x = -Math.atan(shaftSlope);
  const sails = new THREE.Group();
  sails.name = 'Windmill sails';
  shaft.add(sails);
  cap.add(shaft);
  tower.add(cap);

  // Use the 1/7 power law when only 10 m wind is available.
  const hubWindFactor = turbine ? (hubHeight / 10) ** (1 / 7) : 1;
  const rotationSign = turbine ? -1 : 1;
  let angularSpeed = 0;
  let aligned = false;
  cap.userData.updateWind = (dt, reading) => {
    let speed = 0;
    let turn = 0;
    const wind = (reading?.windSpeed ?? 0) / 3.6 * (reading?.atHubHeight ? 1 : hubWindFactor);
    if (wind > 0) {
      // Meteorological bearings point toward the source of the wind. Local +Z is the front of the cap.
      const heading = Math.PI - reading.windDirection * Math.PI / 180;
      const difference = heading - tower.rotation.y - cap.rotation.y;
      const delta = Math.atan2(Math.sin(difference), Math.cos(difference));
      // Start facing the wind, then slew on subsequent changes.
      if (!aligned) turn = delta;
      else if (Math.abs(delta) > 0.001) {
        turn = THREE.MathUtils.clamp(delta * -Math.expm1(-dt / 2), -TURN_RATE * dt, TURN_RATE * dt);
      }
      cap.rotation.y = (cap.rotation.y + turn) % TAU;
      aligned = true;
      const headwind = wind * Math.max(0, Math.cos(delta - turn));
      if (turbine) {
        // Siemens SWT-3.2-101 operating range. Approximate the controller curve up to rated wind.
        if (headwind >= 3 && wind < 25) {
          const rpm = THREE.MathUtils.lerp(6.5, 19, Math.min(1, (headwind - 3) / 11));
          speed = rpm * RPM_TO_RADIANS;
        }
      } else if (wind < 20) {
        speed = Math.min(MILL_MAX_RPM * RPM_TO_RADIANS, Math.max(0, headwind - 1.4) * 0.21);
      }
    }
    angularSpeed += (speed - angularSpeed) * -Math.expm1(-dt / 2.2);
    if (speed === 0 && angularSpeed < 0.001) angularSpeed = 0;
    if (angularSpeed) sails.rotation.z = (sails.rotation.z + rotationSign * angularSpeed * dt) % TAU;

    const cloth = sails.userData.sailcloth;
    if (cloth) {
      if (speed > 0 || wind >= 12) {
        const count = wind < 7 ? cloth.geometry.attributes.position.count : wind < 12 ? cloth.userData.reefedCount : 0;
        if (cloth.geometry.drawRange.count !== count) cloth.geometry.setDrawRange(0, count);
      }
      cloth.visible = angularSpeed > 0 && cloth.geometry.drawRange.count > 0;
    }
    // The static world disables automatic matrix updates, including for the shadow passes.
    if (turn || angularSpeed) cap.updateMatrixWorld(true);
  };
  return { cap, sails };
}
