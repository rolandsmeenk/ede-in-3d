import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, color, float, floor, Fn, fract, fwidth, If, length, mix, mx_noise_float,
  normalGeometry, normalWorld, positionGeometry, positionView, positionWorld, smoothstep, step, texture,
  vec2, vec3, vec4, vertexColor } from 'three/tsl';
import { bumpNormal, cityUniforms, filteredPulse, WALL_KINDS } from './tsl-materials.js';
import { isCorridorFacade } from './ede-facades.js';
import { applySnowMaterial } from './ede-snow.js';
import { bakeFacadeMaskAtlas, mipBytes } from './ede-facade-atlas.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function makeTexture(data, width, height, name, mipmaps = false) {
  const result = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  result.name = name;
  result.generateMipmaps = mipmaps;
  result.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  result.magFilter = mipmaps ? THREE.LinearFilter : THREE.NearestFilter;
  result.colorSpace = THREE.NoColorSpace;
  result.needsUpdate = true;
  return result;
}

export function createFacadeSurfaceTexture() {
  const side = 64, data = new Uint8Array(side * side * 4);
  const noise = (i, j) => ((Math.imul(i + 1262, 374761393) ^ Math.imul(j + 254, 668265263)) >>> 16) / 65535;
  const mod = (value, divisor) => value % divisor;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const row = y >> 3, brick = mod(x + (row % 2) * 8, 16), stone = mod(x + (row % 4) * 8, 32);
    const grain = noise(x, y);
    const i = (y * side + x) * 4;
    data[i] = mod(y, 8) === 0 || brick === 0 ? 146 : 213 + 27 * noise((x + (row % 2) * 8) >> 4, row) + 14 * grain;
    data[i + 1] = mod(y, 16) === 0 || stone === 0 ? 155 : 215 + 23 * noise((x + (row % 4) * 8) >> 5, row >> 1) + 13 * grain;
    data[i + 2] = mod(y, 8) === 0 ? 160 : 221 + 33 * noise(x >> 3, row);
    data[i + 3] = 224 + 30 * grain;
  }
  const surface = makeTexture(data, side, side, 'EdeTileableMasonry', true);
  surface.wrapS = surface.wrapT = THREE.RepeatWrapping;
  return { texture: surface, byteLength: mipBytes(side, side) };
}

export function createFacadeMaskTextures(baked, walls) {
  if (!baked) return null;
  const { data, width, height, paletteData, paletteHeight, rows, rects, physical, ...stats } = baked;
  return {
    ...stats,
    texture: makeTexture(data, width, height, 'EdeFacadeMaskAtlas', true),
    palette: makeTexture(paletteData, 4, paletteHeight, 'EdeFacadeFinishes'),
    rows: new Map([...rows].map(([index, row]) => [walls[index], row])),
    rects: new Map([...rects].map(([index, rect]) => [walls[index], rect])),
    physical: new Set([...physical].map(index => walls[index])),
  };
}

export function buildFacadeMaskAtlas(walls) {
  const bake = bakeFacadeMaskAtlas(walls);
  let step;
  do step = bake.next(); while (!step.done);
  return createFacadeMaskTextures(step.value, walls);
}

async function buildFacadeMaskAtlasIncrementally(walls, stillWanted) {
  const bake = bakeFacadeMaskAtlas(walls);
  let start = performance.now();
  let step;
  while (!(step = bake.next()).done) {
    if (performance.now() - start < 5) continue;
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!stillWanted()) return null;
    start = performance.now();
  }
  return createFacadeMaskTextures(step.value, walls);
}

export { buildFacadeMaskAtlasIncrementally };

export function projectFacadeUv(wall, rect, x, y, z, bottomY = wall.minY) {
  const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1];
  const u = ((x - wall.a[0]) * dx + (z - wall.a[1]) * dz) / (dx * dx + dz * dz);
  const v = (y - bottomY) / wall.height;
  const assigned = isCorridorFacade(wall) || wall.wallType === 'shared' ||
    wall.layoutMeasured !== false && (!wall.openings.length || rect[2] > 0) ? 1 : 0;
  return [rect[0] + clamp(u, 0, 1) * rect[2], rect[1] + clamp(v, 0, 1) * rect[3], assigned];
}

// Use the same window proportions and finishes for streamed BAG and fallback footprints.
function neighbourhoodWindows(masonry, layout, u, v, visible, entrance = float(0), eaves = float(1e6), motorway = false) {
  const x = fract(u), y = fract(v);
  const depth = positionView.z.negate();
  const brickNear = float(1).sub(smoothstep(16, 48, depth)).mul(visible);
  const course = v.mul(layout.y).div(0.078);
  const brick = u.mul(layout.x).div(0.218).add(floor(course).mul(0.5));
  const joints = float(1).sub(filteredPulse(fract(course), 0.07, 0.93, fwidth(course))
    .mul(filteredPulse(fract(brick), 0.025, 0.975, fwidth(u).mul(layout.x).div(0.218))));
  const tone = mx_noise_float(vec3(floor(brick), floor(course), 3)).mul(0.14).add(1);
  const brickwork = mix(masonry.mul(tone), mix(masonry, color(0x9c8d7e), 0.5), joints.mul(0.55));
  const base = mix(masonry, brickwork, brickNear);
  const fw = fwidth(u), fh = fwidth(v);
  const left = float(0.5).sub(layout.z.mul(0.5)), right = float(1).sub(left);
  const top = layout.w.mul(0.5).add(0.53), bottom = float(1.06).sub(top);
  const near = float(1).sub(motorway ? smoothstep(245, 550, depth) : smoothstep(80, 180, depth)).mul(visible);
  const fitsUnderRoof = step(floor(v).add(top).mul(layout.y).add(0.12), eaves);
  const opening = filteredPulse(x, left, right, fw).mul(filteredPulse(y, bottom, top, fh))
    .mul(step(0.01, layout.z)).mul(float(1).sub(entrance)).mul(fitsUnderRoof).mul(near);
  const glass = filteredPulse(x, left.add(0.022), right.sub(0.022), fw)
    .mul(filteredPulse(y, bottom.add(0.022), top.sub(0.022), fh))
    .mul(float(1).sub(filteredPulse(x, 0.491, 0.509, fw))).mul(opening);
  const band = filteredPulse(y, 0.14, 0.22, fh).mul(step(0.8, layout.z)).mul(near);
  const door = filteredPulse(x, 0.32, 0.68, fw).mul(filteredPulse(y, 0, 0.77, fh)).mul(entrance).mul(near);
  const walls = mix(base, color(0xbbb5a9), band.mul(0.68));
  const frames = mix(walls, color(0xcec8b7), opening);
  return { finish: mix(mix(frames, color(0x354652), glass), color(0x42423c), door), glass };
}

const windowEmission = Fn(([glass, storey, bay, key]) => {
  const glow = vec3(0).toVar();
  const levels = cityUniforms.uWindowLights;
  If(levels.x.add(levels.y).add(levels.z).greaterThan(0), () => {
    const use = floor(key);
    const shop = use.equal(3).or(use.equal(4).and(storey.lessThan(1)));
    const office = use.equal(2);
    const homes = use.equal(5).select(levels.x.mul(0.55), levels.x);
    const level = shop.select(levels.z, office.select(levels.y, homes));
    const building = fract(key);
    const room = fract(building.mul(8741.43).add(storey.mul(32.17)).add(bay.mul(15.61)).sin().mul(43758.5453));
    const rank = mix(building, room, office.select(0.62, 0.36));
    const lit = smoothstep(rank, rank.add(0.045), level).mul(step(1, use));
    const warm = mix(color(0xffba72), color(0xffe4b8), room);
    glow.assign(office.select(color(0xe3ecff), warm).mul(glass).mul(lit).mul(1.5));
  });
  return glow;
});

function metalCladding(u, y, code) {
  const panel = step(4.5, code).mul(float(1).sub(step(5.5, code)));
  const weathering = step(5.5, code);
  const rib = u.div(mix(0.48, 1.20, panel.max(weathering)));
  const course = y.div(mix(2.7, 1.28, panel));
  const seam = float(1).sub(filteredPulse(fract(rib), 0.027, 0.973, fwidth(rib)))
    .max(float(1).sub(filteredPulse(fract(course), 0.012, 0.988, fwidth(course))).mul(0.6));
  const shade = mx_noise_float(vec2(floor(rib), floor(course)).mul(0.51)).mul(weathering.mul(0.24).add(0.08));
  return float(1.01).add(shade).sub(seam.mul(0.29));
}

export function createEdeFacadeBoxMaterial({ layout, motorway, cladding }) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.91 });
  const box = attribute('box', 'vec4'), faces = attribute('faces', 'vec4');
  const appearance = attribute('facadeAppearance', 'vec4');
  const wallLayout = layout ? vec4(...layout) : attribute('facadeLayout', 'vec4');
  const shed = layout ? float(0) : attribute('facadeShed', 'float');
  const kind = mix(faces.z, faces.w, step(0, normalGeometry.z));
  const visible = step(0.5, normalGeometry.z.abs()).mul(step(kind, WALL_KINDS.rear));
  const pier = box.x.mul(0.2).min(0.38);
  const width = box.x.sub(pier.mul(2));
  const bays = mix(floor(width.div(wallLayout.x).add(0.5)).max(1), 1, shed);
  const along = positionGeometry.x.add(0.5).mul(box.x).sub(pier);
  const u = along.div(width).mul(bays);
  const nominalHeight = mix(wallLayout.y, appearance.w, step(0.1, appearance.w));
  const storeys = floor(box.y.div(nominalHeight).add(0.4)).max(1);
  const v = positionGeometry.y.add(0.5).mul(storeys);
  const entrance = step(kind.sub(WALL_KINDS.entry).abs(), 0.1).mul(step(u, 1)).mul(step(v, 1));
  const grain = mx_noise_float(positionWorld.mul(0.7)).mul(0.1).add(0.95);
  const hasEntrance = shed.max(wallLayout.z.greaterThan(0).select(1, 0));
  const windows = neighbourhoodWindows(appearance.xyz.mul(grain), wallLayout, u, v,
    visible.mul(step(0, along)).mul(step(along, width)), entrance.mul(hasEntrance), float(1e6), motorway);
  material.colorNode = windows.finish;
  if (!layout || layout[2] > 0) {
    material.emissiveNode = windowEmission(windows.glass, floor(v), floor(u.div(2)), attribute('windowKey', 'float'));
  }
  if (cladding) {
    const lineRange = float(1).sub(smoothstep(100, 360, positionView.z.negate())).mul(visible);
    const finish = metalCladding(along, positionWorld.y, float(cladding));
    const walls = mix(appearance.xyz.mul(grain), appearance.xyz.mul(finish), lineRange);
    material.colorNode = mix(walls, material.colorNode, layout[2] > 0 ? 0.75 : 0);
  }
  return material;
}

export function createBagFacadeMaterial(atlas = null, surfaceTexture = null, useBuildingProfiles = true) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const grain = mx_noise_float(positionWorld.mul(0.7)).mul(0.1).add(0.95);
  const masonry = vertexColor().mul(grain);
  let procedural = masonry;
  let proceduralGlow, measuredGlow;
  if (useBuildingProfiles) {
    const wall = step(normalWorld.y.abs(), 0.35);
    const along = positionWorld.x.mul(normalWorld.z.abs()).add(positionWorld.z.mul(normalWorld.x.abs()));
    const height = attribute('buildingHeight', 'float');
    const u = along.div(3.1), v = height.div(3.2);
    const above = step(2.6, height);
    const win = smoothstep(0.18, 0.22, fract(u)).mul(smoothstep(0.82, 0.78, fract(u)))
      .mul(smoothstep(0.34, 0.38, fract(v))).mul(smoothstep(0.82, 0.78, fract(v))).mul(wall).mul(above);
    const generic = masonry.mul(float(1).sub(win.mul(0.55)));
    const layout = attribute('edeFacadeLayout', 'vec4');
    const bay = attribute('edeFacadeBay', 'vec3');
    const hasLayout = step(0.1, layout.x);
    const storey = height.div(mix(3.2, layout.y, hasLayout));
    const local = neighbourhoodWindows(masonry, layout, bay.x,
      storey, wall.mul(step(0.15, height)), float(0), bay.y);
    procedural = mix(generic, local.finish, hasLayout);
    proceduralGlow = windowEmission(mix(win, local.glass, hasLayout), floor(storey),
      floor(mix(u, bay.x, hasLayout).div(2)), bay.z);
    measuredGlow = glass => windowEmission(glass, floor(storey), float(0), bay.z);
  }
  material.colorNode = procedural;
  material.emissiveNode = proceduralGlow ?? null;
  if (!atlas) return applySnowMaterial(material);

  const atlasUv = attribute('facadeUv', 'vec3');
  const style = attribute('facadeStyle', 'vec3');
  const relief = attribute('facadeRelief', 'vec2');
  const distance = length(positionGeometry.sub(cameraPosition));
  const shape = float(1).sub(smoothstep(18, 42, distance));
  material.positionNode = positionGeometry.add(vec3(relief.x, 0, relief.y).mul(shape));

  const viewDistance = positionView.z.negate();
  const assigned = step(0.5, atlasUv.z);
  const masked = assigned.mul(float(1).sub(step(1.5, atlasUv.z)));
  const trim = step(2.5, atlasUv.z);
  material.maskNode = trim.lessThan(0.5).or(viewDistance.lessThan(37));
  const finish = index => texture(atlas.palette, vec2((index + 0.5) / 4, style.z));
  const glazing = finish(0);
  const encoded = glazing.a.mul(255).round();
  const motorway = step(15.5, encoded);
  const masonryCode = encoded.sub(motorway.mul(16));
  const near = float(1).sub(atlas.motorway
    ? mix(smoothstep(100, 220, viewDistance), smoothstep(245, 550, viewDistance), motorway)
    : smoothstep(100, 220, viewDistance));
  const masks = texture(atlas.texture, atlasUv.xy).mul(masked.mul(near));
  const door = masks.g;
  const glass = masks.r.min(float(1).sub(door));
  if (measuredGlow) material.emissiveNode = mix(proceduralGlow, measuredGlow(glass), assigned);
  const frame = masks.b.min(float(1).sub(glass.add(door)).max(0));
  const sill = masks.a.min(float(1).sub(glass.add(door).add(frame)).max(0));
  const bare = float(1).sub(glass.add(door).add(frame).add(sill)).max(0);
  const pattern = texture(surfaceTexture, style.xy.mul(vec2(1 / 1.04, 1 / 0.64)));
  const brick = step(0.5, masonryCode).mul(float(1).sub(step(1.5, masonryCode)));
  const stone = step(1.5, masonryCode).mul(float(1).sub(step(2.5, masonryCode)));
  const metal = step(3.5, masonryCode);
  const cladding = step(2.5, masonryCode).mul(float(1).sub(metal));
  const textureGrain = pattern.a.mul(float(1).sub(brick.add(stone).add(cladding)))
    .add(pattern.r.mul(brick)).add(pattern.g.mul(stone)).add(pattern.b.mul(cladding));
  const materialRange = float(1).sub(smoothstep(35, 95, viewDistance)).mul(assigned).mul(float(1).sub(trim));
  const textureBlend = mix(1, textureGrain.mul(0.32).add(0.72), materialRange.mul(float(1).sub(metal)));
  let wallRgb = mix(procedural, masonry, assigned).mul(textureBlend).mul(bare);
  if (atlas.metal) {
    const metalRange = float(1).sub(smoothstep(140, 420, viewDistance)).mul(assigned).mul(metal);
    wallRgb = wallRgb.mul(mix(1, metalCladding(style.x, style.y, masonryCode), metalRange));
  }
  material.colorNode = wallRgb.add(glazing.rgb.mul(glass)).add(finish(1).rgb.mul(door))
    .add(finish(2).rgb.mul(frame).mul(0.82)).add(finish(3).rgb.mul(sill));
  material.roughnessNode = bare.mul(0.92).add(glass.mul(0.2)).add(door.mul(0.59))
    .add(frame.mul(0.62)).add(sill.mul(0.67));
  material.metalnessNode = glass.mul(0.20).add(frame.mul(0.02));
  const close = float(1).sub(smoothstep(8, 35, viewDistance));
  material.normalNode = bumpNormal(frame.mul(0.003).add(sill.mul(0.007))
    .add(textureGrain.sub(0.9).mul(materialRange).mul(bare).mul(0.003)).mul(close));
  return applySnowMaterial(material);
}
