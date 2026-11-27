import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DAY, dateEpoch } from './ede-transit-time.js';
import { EDE_POSTER_SITES } from './ede-poster-sites.js';
import { BEZOEK_EDE, paintEdeAd } from './ede-advertising.js';

const tuesday = dateEpoch('1970-01-06');
const posterWidth = 256, posterHeight = 360, inset = 16, textureSize = 1024;
const frameColor = '#313a40';
const designs = [
  [BEZOEK_EDE.title, BEZOEK_EDE.detail],
  ['Fiets door Ede', 'Een rondje over de Veluwe'],
  ['Naar de heide', 'Wandel over de Ginkelse Heide'],
  ['Ontdek de dorpen', 'Van Bennekom tot Otterlo'],
  ['Buiten in Ede', 'Vind jouw route door de natuur'],
  ['Op de Veluwe', 'Bos, zand en eindeloze paden'],
];

export function edePosterWeek(date) {
  return Math.floor((dateEpoch(date) - tuesday) / (7 * DAY));
}

function slot(series) {
  const index = series.charCodeAt(0) - 65;
  return [inset + (index % 3) * (posterWidth + inset), inset + Math.floor(index / 3) * (posterHeight + inset)];
}

function paintAtlas(ctx, week, image, campaign) {
  ctx.fillStyle = frameColor;
  ctx.fillRect(0, 0, textureSize, textureSize);
  for (const [index, series] of [...'ABCDEF'].entries()) {
    const [x, y] = slot(series);
    const designIndex = ((week + index) % designs.length + designs.length) % designs.length;
    const [title, detail] = designs[designIndex];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.5, 0.5);
    const eventArtwork = index % 2 === 0 ? campaign : null;
    paintEdeAd(ctx, posterWidth * 2, posterHeight * 2,
      eventArtwork ?? { ...BEZOEK_EDE, title, detail }, eventArtwork ? undefined : image);
    ctx.restore();
  }
}

function applyAtlasUvs(geometry, x, y, width, height) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (x + uv.getX(i) * width) / textureSize,
      1 - (y + (1 - uv.getY(i)) * height) / textureSize);
  }
  return geometry;
}

function posterGeometry(series) {
  const caseGeometry = applyAtlasUvs(new THREE.BoxGeometry(0.92, 1.27, 0.30), 994, 994, 0, 0);
  const [x, y] = slot(series);
  const print = () => applyAtlasUvs(new THREE.PlaneGeometry(0.84, 1.19), x + 1, y + 1, posterWidth - 2, posterHeight - 2);
  return [caseGeometry, print().translate(0, 0, 0.153),
    print().rotateY(Math.PI).translate(0, 0, -0.153)];
}

export function buildEdePosters(scene, lampSupports, date, campaign) {
  const key = ({ x, z }) => `${x}:${z}`;
  const supports = new Map(lampSupports.filter(p => p.kind === 'lamp' && p.layer === 0).map(p => [key(p), p]));
  const chunks = new Map(), specimens = new Map();
  for (const site of EDE_POSTER_SITES) {
    const support = supports.get(key(site));
    if (!support || support.topY - support.baseY < 2.1) continue;
    const { x, z, baseY, ux, uz } = support;
    const grid = `${Math.floor(x / 240)}:${Math.floor(z / 240)}`;
    if (!chunks.has(grid)) chunks.set(grid, []);
    if (!specimens.has(site.series)) specimens.set(site.series, posterGeometry(site.series));
    const yaw = site.yaw ?? Math.atan2(ux ?? 0, uz ?? 1);
    for (const geo of specimens.get(site.series)) {
      chunks.get(grid).push(geo.clone().rotateY(yaw).translate(x, baseY + 1.25, z));
    }
  }
  if (!chunks.size) return;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  let displayedWeek = edePosterWeek(date);
  let artwork;
  paintAtlas(ctx, displayedWeek, artwork, campaign);
  const atlas = new THREE.CanvasTexture(canvas);
  const image = new Image();
  image.src = BEZOEK_EDE.image;
  void image.decode().then(() => {
    artwork = image;
    paintAtlas(ctx, displayedWeek, artwork, campaign);
    atlas.needsUpdate = true;
  }, () => {});
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  const material = new THREE.MeshStandardNodeMaterial({ map: atlas, roughness: 0.81 });
  const group = new THREE.Group();
  group.name = 'Ede lamp-post posters';
  for (const geometries of chunks.values()) {
    const geometry = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.displayCount = geometries.length / 3;
    group.add(mesh);
  }
  for (const geometries of specimens.values()) for (const part of geometries) part.dispose();
  scene.add(group);

  function setCampaign(date, nextCampaign) {
    const week = edePosterWeek(date);
    if (week === displayedWeek && nextCampaign === campaign) return;
    displayedWeek = week;
    campaign = nextCampaign;
    paintAtlas(ctx, displayedWeek, artwork, campaign);
    atlas.needsUpdate = true;
  }

  const lastView = new THREE.Vector3(Infinity, Infinity, Infinity);
  function updateView(position) {
    if (lastView.distanceToSquared(position) < 16) return;
    lastView.copy(position);
    for (const mesh of group.children) mesh.visible = mesh.geometry.boundingBox.distanceToPoint(position) < 220;
  }
  return { setCampaign, updateView };
}
