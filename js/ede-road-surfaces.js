export const EDE_PAVING_STYLE = Object.freeze({ brick: 0, block: 1, tile: 2, concrete: 3, gravel: 4, sand: 5 });

const osmMaterials = {
  asphalt: 'asphalt', chipseal: 'asphalt', brick: 'brick', paving_stones: 'block', grass_paver: 'block',
  sett: 'block', cobblestone: 'block', unhewn_cobblestone: 'block', tiles: 'tile',
  concrete: 'concrete', 'concrete:plates': 'concrete', gravel: 'gravel', fine_gravel: 'gravel',
  compacted: 'gravel', pebblestone: 'gravel', sand: 'sand', dirt: 'sand', earth: 'sand', ground: 'sand'
};
let mapped = { surfaces: [], covered: {} };
let gradeSurfaces = new Map();
let groundSurfaces = new Map();
let groundTrafficPolygons;

export function osmRoadMaterial(road) {
  return Object.hasOwn(osmMaterials, road.surface) ? osmMaterials[road.surface] : undefined;
}

export const getEdeRoadSurfaces = () => mapped;

export function hasEdeMappedSurface(segment) {
  if (mapped.covered[segment.road.id]?.includes(segment.segmentIndex)) return true;
  if (segment.road.tunnelType !== 'building_passage') return false;
  const kind = segment.road.kind === 'cycleway' ? 'cycle' : segment.pedestrian ? 'foot' : 'motor';
  return !!pavementIn(segment, groundSurfaces.get(kind));
}

function pavementKind(functionName) {
  if (functionName === 'fietspad') return 'cycle';
  if (functionName === 'voetpad' || functionName === 'voetgangersgebied') return 'foot';
  if (functionName.startsWith('rijbaan ') || ['ov-baan', 'verbindingsweg', 'verkeersdrempel', 'woonerf'].includes(functionName)) return 'motor';
}

function contains(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const az = ring[i + 1], bz = ring[j + 1];
    if ((az > z) !== (bz > z) && x < (ring[j] - ring[i]) * (z - az) / (bz - az) + ring[i]) inside = !inside;
  }
  return inside;
}

const TRAFFIC_CELL = 32;

export function isEdeTrafficPavement(x, z) {
  if (!groundTrafficPolygons) {
    groundTrafficPolygons = new Map();
    for (const surface of mapped.surfaces) {
      if (surface.layer || !/^(rijbaan |fietspad$|ov-baan$|inrit$|parkeervlak$|verbindingsweg$|verkeersdrempel$|woonerf$|overweg$)/.test(surface.function)) continue;
      for (const polygon of surface.polygons) {
        const outer = polygon[0];
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < outer.length; i += 2) {
          minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
          minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
        }
        for (let ix = Math.floor(minX / TRAFFIC_CELL); ix <= Math.floor(maxX / TRAFFIC_CELL); ix++) {
          for (let iz = Math.floor(minZ / TRAFFIC_CELL); iz <= Math.floor(maxZ / TRAFFIC_CELL); iz++) {
            const key = `${ix}/${iz}`;
            if (!groundTrafficPolygons.has(key)) groundTrafficPolygons.set(key, []);
            groundTrafficPolygons.get(key).push(polygon);
          }
        }
      }
    }
  }
  const polygons = groundTrafficPolygons.get(`${Math.floor(x / TRAFFIC_CELL)}/${Math.floor(z / TRAFFIC_CELL)}`);
  return polygons?.some(([outer, ...holes]) =>
    contains(outer, x, z) && !holes.some(hole => contains(hole, x, z))) ?? false;
}

export function gradePavement(section, layer, kind) {
  return pavementIn(section, gradeSurfaces.get(`${layer}/${kind}`));
}

function pavementIn(section, surfaces) {
  if (!surfaces) return undefined;
  const { a, b } = section;
  let result;
  for (const t of [0.2, 0.5, 0.8]) {
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const hits = surfaces.filter(surface => surface.polygons.some(([outer, ...holes]) =>
      contains(outer, x, z) && !holes.some(hole => contains(hole, x, z))));
    if (hits.length !== 1 || (result && hits[0].material !== result.material)) return undefined;
    result = hits[0];
  }
  return result;
}

export async function loadEdeRoadSurfaces() {
  const response = await fetch(new URL('../assets/ede-road-surfaces.json.gz', import.meta.url));
  if (!response.ok) throw new Error(`Ede road surfaces returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = new Response(bytes);
  const json = bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body;
  const asset = await json.json();
  if (asset.version !== 1 || !asset.covered || !Array.isArray(asset.surfaces)) {
    throw new Error('Invalid Ede road surfaces');
  }
  const grade = new Map(), ground = new Map();
  for (const surface of asset.surfaces) {
    if (surface.resolution === 'bgt-general') continue;
    const kind = pavementKind(surface.function);
    if (!kind) continue;
    const index = surface.layer ? grade : ground;
    const key = surface.layer ? `${surface.layer}/${kind}` : kind;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(surface);
  }
  gradeSurfaces = grade;
  groundSurfaces = ground;
  mapped = asset;
  groundTrafficPolygons = undefined;
  return asset;
}
