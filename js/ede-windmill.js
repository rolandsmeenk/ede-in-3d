import * as THREE from 'three/webgpu';

const TURN_RATE = 0.45;
const MAX_RPM = 16;
const TAU = 2 * Math.PI;

// The cap turns into the wind while the rotor spins independently about its shaft.
export function createWindmillRig(tower, hubHeight, hubOffset, shaftSlope, { cutIn = 1.4, rotationSign = 1 } = {}) {
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

  let angularSpeed = 0;
  cap.userData.updateWind = (dt, reading) => {
    let speed = 0;
    let turn = 0;
    if (reading?.windSpeed > 0) {
      // Meteorological bearings point toward the source of the wind. Local +Z is the front of the cap.
      const heading = Math.PI - reading.windDirection * Math.PI / 180;
      const difference = heading - tower.rotation.y - cap.rotation.y;
      const delta = Math.atan2(Math.sin(difference), Math.cos(difference));
      if (Math.abs(delta) > 0.001) {
        turn = THREE.MathUtils.clamp(delta * -Math.expm1(-dt / 2), -TURN_RATE * dt, TURN_RATE * dt);
        cap.rotation.y = (cap.rotation.y + turn) % TAU;
      }
      const headwind = reading.windSpeed / 3.6 * Math.max(0, Math.cos(delta - turn));
      speed = Math.min(MAX_RPM * TAU / 60, Math.max(0, headwind - cutIn) * 0.21);
    }
    angularSpeed += (speed - angularSpeed) * -Math.expm1(-dt / 2.2);
    if (speed === 0 && angularSpeed < 0.001) angularSpeed = 0;
    if (angularSpeed) sails.rotation.z = (sails.rotation.z + rotationSign * angularSpeed * dt) % TAU;
    // The static world disables automatic matrix updates, including for the shadow passes.
    if (turn || angularSpeed) cap.updateMatrixWorld(true);
  };
  return { cap, sails };
}
