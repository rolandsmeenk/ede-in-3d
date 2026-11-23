import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';
import { createSintHubertus } from './ede-sint-hubertus.js';

function box(batch, x, y, z, w, h, d, color, angle = 0) {
  batch.solid(new THREE.BoxGeometry(w, h, d).rotateY(angle).translate(x, y, z), color);
}

function make(site, draw) {
  const batch = new CivicBatch(), colliders = [];
  const ground = terrainHeightAt(site.x, site.z);
  const cs = Math.cos(site.heading), sn = Math.sin(site.heading);
  const block = (x, z, w, d, h) => {
    const corners = [[x, z], [x + w, z], [x + w, z + d], [x, z + d]].map(([lx, lz]) => ({
      x: site.x + lx * cs + lz * sn, z: site.z - lx * sn + lz * cs,
    }));
    for (let i = 0; i < corners.length; i++) {
      colliders.push(...wallColliders(corners[i], corners[(i + 1) % corners.length], ground - 0.08, ground + h, 0.12));
    }
  };
  draw(batch, block);
  const group = makeGroup(site.name, batch, colliders);
  group.position.set(site.x, ground, site.z);
  group.rotation.y = site.heading;
  return group;
}

function krollerMuller(batch, block) {
  // Low, pavilion-like gallery: pale masonry wings around dark glazed galleries and courtyards.
  box(batch, -6.2, 2.0, 0.0, 10.5, 4.0, 5.4, 0xc9c6b7);
  box(batch, 4.5, 2.0, -3.4, 7.0, 4.0, 5.2, 0xd5d1c2);
  box(batch, 2.0, 1.75, 2.4, 9.0, 3.5, 3.7, 0xaaa99e);
  box(batch, -5.7, 1.45, 2.76, 9.2, 2.25, 0.12, 0x39464a);
  box(batch, 3.0, 1.35, -0.71, 6.2, 2.0, 0.12, 0x364349);
  box(batch, 7.93, 1.35, -3.2, 0.12, 2.0, 4.5, 0x364349);
  box(batch, -7.1, 4.12, 0.0, 12.2, 0.25, 6.0, 0x777c70);
  box(batch, 4.4, 4.12, -3.4, 7.8, 0.25, 5.8, 0x7b8175);
  box(batch, 2.0, 3.63, 2.4, 9.4, 0.20, 4.1, 0x777c70);
  box(batch, -7.6, 0.17, 0.0, 1.7, 0.34, 6.6, 0x817e72);
  block(-11.45, -3.3, 10.5, 5.4, 4.2);
  block(1.0, -6.0, 7.0, 5.2, 4.2);
  block(-2.5, 0.55, 9.0, 3.7, 3.7);
}

function kijkLuisterMuseum(batch, block) {
  // The museum presents local shop, school and farmhouse interiors in a village setting.
  const brick = 0x9b6048, timber = 0x67513e, tile = 0x514541;
  box(batch, -3.0, 2.0, 0, 6.8, 4.0, 5.4, 0xc8b99d);
  box(batch, 4.5, 1.8, -0.2, 6.0, 3.6, 4.8, brick);
  box(batch, -3.0, 4.12, 0, 7.5, 0.25, 6.0, tile, 0.04);
  box(batch, 4.5, 3.72, -0.2, 6.6, 0.23, 5.4, 0x554640, -0.04);
  box(batch, -3.0, 1.45, 2.77, 4.1, 1.9, 0.12, 0x6d6150);
  box(batch, -3.0, 0.52, 2.86, 4.3, 0.16, 0.24, 0x4b4036);
  for (const x of [-4.3, -3.0, -1.7]) {
    box(batch, x, 1.62, 2.95, 0.92, 1.3, 0.08, 0x3e4847);
    box(batch, x, 1.62, 3.01, 0.07, 1.33, 0.08, 0xc4b08f);
  }
  // A small schoolhouse wing gives the complex a clear historic village profile.
  box(batch, -8.2, 1.65, -1.0, 4.0, 3.3, 4.2, 0xa78361);
  box(batch, -8.2, 3.38, -1.0, 4.5, 0.22, 4.8, tile);
  box(batch, -8.2, 1.12, 1.16, 1.55, 1.9, 0.12, 0x394548);
  for (const x of [-9.3, -7.2]) box(batch, x, 1.85, 1.16, 0.68, 0.92, 0.08, 0x394548);
  box(batch, -3.0, 0.45, 3.12, 1.8, 0.9, 0.12, timber);
  box(batch, -3.0, 0.94, 3.2, 2.0, 0.12, 0.16, 0x5a4838);
  block(-6.4, -2.7, 6.8, 5.4, 4.2);
  block(1.5, -2.6, 6.0, 4.8, 3.8);
  block(-10.2, -3.1, 4.0, 4.2, 3.5);
}

function alexanderkerk(batch, block) {
  const stone = 0xb4a58c, dark = 0x4b4944, roofColor = 0x514c45;
  box(batch, 0, 5.2, 0, 13.5, 10.4, 7.2, stone);
  const roof = new THREE.Shape();
  roof.moveTo(-7.0, 10.3); roof.lineTo(0, 15.3); roof.lineTo(7.0, 10.3); roof.closePath();
  batch.solid(new THREE.ExtrudeGeometry(roof, { depth: 8.0, bevelEnabled: false })
    .translate(0, 0, -4.0), roofColor);
  box(batch, -8.0, 8.0, 0, 4.2, 16.0, 5.6, 0xa9987e);
  box(batch, -8.0, 16.2, 0, 4.9, 0.8, 6.3, dark);
  const spire = new THREE.ConeGeometry(2.0, 7.0, 4).rotateY(Math.PI / 4).translate(-8.0, 20.0, 0);
  batch.solid(spire, roofColor);
  box(batch, 0, 3.8, 3.66, 1.7, 3.8, 0.12, 0x424b4a);
  for (const x of [-4.5, 0, 4.5]) box(batch, x, 6.4, 3.67, 0.9, 2.4, 0.12, 0x48504d);
  box(batch, -8.0, 5.1, 2.88, 1.1, 2.1, 0.12, 0x414947);
  block(-6.75, -3.6, 13.5, 7.2, 15.5);
  block(-10.1, -2.8, 4.2, 5.6, 24.0);
}

export const EDE_OUTER_CULTURAL_FACTORIES = {
  'kroller-muller-museum': (_, site) => make(site, krollerMuller),
  'jachthuis-sint-hubertus': createSintHubertus,
  'kijk-luistermuseum': (_, site) => make(site, kijkLuisterMuseum),
  'alexanderkerk-bennekom': (_, site) => make(site, alexanderkerk),
};
