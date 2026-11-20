import { EDE_MODELED_LANDMARKS, modeledLandmarkFootprints } from './ede-landmark-sites.js';
import { GEO } from './nyc-geodata.js';
import { FOOT } from './road-access.js';

// Ede spatial adapter for mrdoob/slop-newyork's engine, via an irregular-city data path.
// Legacy export names are retained as API aliases; all visible geography is Ede.
// 1 unit = 1 metre, x east, z south, origin at the Oude Kerk (true north up).
const EDE_DATA = GEO.ede;
const toPts = (flat) => { const out=[]; for(let i=0;i<flat.length;i+=2)out.push({x:flat[i],z:flat[i+1]});return out; };
const AFF = EDE_DATA.meta.lonLatAffine;
// Equirectangular fit around the Oude Kerk (meta.lonLatAffine): enough for teleports.
const projectLonLat = (lon,lat) => { const a=lon-AFF.lon0, b=lat-AFF.lat0; return {x:AFF.x[0]+AFF.x[1]*a+AFF.x[2]*b, z:AFF.z[0]+AFF.z[1]*a+AFF.z[2]*b}; };
const [minX,minZ,maxX,maxZ] = EDE_DATA.meta.bounds;
const ISLAND_BOUNDS = {minX,maxX,minZ,maxZ,sidewalkHeight:0.22,waterLevel:-2.2};
const CUT_Z=minZ;
const MANHATTAN_COASTLINE=toPts(GEO.manhattan);
const getIslandBoundsAtZ=()=>({westX:minX,eastX:maxX});
// Ede has an arbitrary mapped street network. Empty legacy grid registries prevent
// the original corridor builder from inventing axis-aligned Manhattan streets.
const AVENUES=[], ALL_AVENUES=[], STREETS=[], ALL_STREETS=[];
const BROADWAY_LINE=[];
const getBroadwayX=()=>0;
const WATERFRONT_PIERS=[], EAST_RIVER_BRIDGES=[], OUTER_BRIDGES=[];
const ROOSEVELT_ISLAND_POLYGON=[],GOVERNORS_ISLAND_POLYGON=[],NJ_SHORELINE_POLYGON=[],LONG_ISLAND_POLYGON=[],LONG_ISLAND_POLYGONS=[],BROOKLYN_POLYGONS=[],QUEENS_POLYGONS=[],BRONX_POLYGONS=[],WESTCHESTER_POLYGON=[],NASSAU_POLYGON=[],UPPER_MANHATTAN_POLYGON=[],BRONX_POLYGON=[],STATEN_ISLAND_POLYGON=[],RANDALLS_ISLAND_POLYGON=[],LIBERTY_ISLAND_POLYGON=[],ELLIS_ISLAND_POLYGON=[],MILL_ROCK_POLYGON=[];
const LIBERTY_STATUE_POS={x:0,z:0};
// The legacy park bounds describe a raised Central Park lawn: Ede has none.
const CENTRAL_PARK_BOUNDS={minX:-99999,maxX:-99998,minZ:-99999,maxZ:-99998};
const ROADS=EDE_DATA.roads.filter(r=>!r.tunnel).map(r=>({...r,raw:r.name,name:r.name||`Unnamed ${r.kind}`,w:r.width,dir:r.oneway?(r.reverse?-1:1):0,highway:/motorway|trunk/.test(r.kind),pts:toPts(r.pts)}));
const DRIVABLE=new Set(['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified','living_street']);
const ROAD_DRIVING=ROADS.filter(r=>DRIVABLE.has(r.kind));
const EDE_AREAS=(EDE_DATA.meta.areas||[]).map(a=>({...a,polygons:(a.polygons||[]).map(p=>({
 poly:toPts(p.ring),holes:(p.holes||[]).map(toPts)
}))}));
function districtAt() {
 return 'centrum';
}
function makeBlock(b,id,park=0){
 const poly=toPts(b.ring),holes=(b.holes||[]).map(toPts);
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,a=0,cx=0,cz=0;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const p=poly[i],q=poly[j],c=q.x*p.z-p.x*q.z;
  minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);a+=c;cx+=(q.x+p.x)*c;cz+=(q.z+p.z)*c;
 }
 a*=.5;cx=a?cx/(6*a):(minX+maxX)/2;cz=a?cz/(6*a):(minZ+maxZ)/2;
 return {id,osmId:b.id,source:b,poly,holes,rects:[],frames:null,park,parkName:park?b.name:'',rect:false,area:Math.abs(a),minX,maxX,minZ,maxZ,cx,cz,median:false,district:districtAt(cx,cz)};
}
const BLOCKS=[...EDE_DATA.buildings.filter(b=>!b.part).map((b,i)=>makeBlock(b,i)),...EDE_DATA.parks.map((b,i)=>makeBlock(b,'park:'+i,1))];
const LANDMARK_BLOCKS=new Set();
const LANDMARK_SITES=GEO.landmarks;
for (const site of EDE_MODELED_LANDMARKS) {
  const [{ outer }] = modeledLandmarkFootprints(site);
  const xs = outer.map(p => p.x), zs = outer.map(p => p.z);
  LANDMARK_SITES[site.name] = {
    x: site.x, z: site.z, h: site.height,
    w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs),
    ring: outer.flatMap(p => [p.x, p.z]),
  };
}
LANDMARK_SITES['Openluchttheater Ede'] = LANDMARK_SITES['De Eder Kuil'];
function getBlockBounds(col,row){return BLOCKS[Number.isInteger(col)?col:0]||{minX:0,maxX:0,minZ:0,maxZ:0,cx:0,cz:0,width:0,depth:0};}
const avenueNameAt=(a)=>a?.short||a?.name||'';
const avenueX=()=>0;
const fromOldFrame=(x,z)=>({x,z});
// Nearest-road index (labels, sidewalk tests): uniform grid of road segments
const ROAD_CELL = 64;
const ROAD_GRID = new Map();
for (const r of ROADS) {
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const a = r.pts[i];
    const b = r.pts[i + 1];
    const seg = { r, ax: a.x, az: a.z, bx: b.x, bz: b.z };
    const ix0 = Math.floor(Math.min(a.x, b.x) / ROAD_CELL), ix1 = Math.floor(Math.max(a.x, b.x) / ROAD_CELL);
    const iz0 = Math.floor(Math.min(a.z, b.z) / ROAD_CELL), iz1 = Math.floor(Math.max(a.z, b.z) / ROAD_CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = ix * 100000 + iz;
      if (!ROAD_GRID.has(k)) ROAD_GRID.set(k, []);
      ROAD_GRID.get(k).push(seg);
    }
  }
}
/** Nearest roads to (x, z) within `radius`: [{ road, dist }] sorted by distance (one entry per road name) */
function nearestRoads(x, z, radius = 60) {
  const best = new Map();
  const ix0 = Math.floor((x - radius) / ROAD_CELL), ix1 = Math.floor((x + radius) / ROAD_CELL);
  const iz0 = Math.floor((z - radius) / ROAD_CELL), iz1 = Math.floor((z + radius) / ROAD_CELL);
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    const list = ROAD_GRID.get(ix * 100000 + iz);
    if (!list) continue;
    for (const s of list) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
      if (d > radius) continue;
      const prev = best.get(s.r.name);
      if (!prev || d < prev.dist) best.set(s.r.name, { road: s.r, dist: d, horizontal: Math.abs(dx) > Math.abs(dz) });
    }
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist);
}

/**
 * Whether a road carries (x, z) across water. Unlike nearestRoads this looks at every segment, not one per road name,
 * so an unnamed or same-named footway beside a bridge can't hide it. Walkers also use any mapped road over water
 * (quays, decks and passages that the water polygons overlap); other modes need a bridge.
 */
function roadCrossesWater(x, z, anyRoad = false) {
  const ix = Math.floor(x / ROAD_CELL), iz = Math.floor(z / ROAD_CELL);
  for (let cx = ix - 1; cx <= ix + 1; cx++) for (let cz = iz - 1; cz <= iz + 1; cz++) {
    const list = ROAD_GRID.get(cx * 100000 + cz);
    if (!list) continue;
    for (const s of list) {
      if (!anyRoad && !s.r.bridge) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1e-9)));
      if (Math.hypot(s.ax + t * dx - x, s.az + t * dz - z) < (s.r.w || 3) / 2 + (anyRoad ? 1.8 : 1)) return true;
    }
  }
  return false;
}

// Spatial index of the blocks (64 m cells)
const BLOCK_CELL = 64;
const BLOCK_GRID = new Map();
for (const b of [...BLOCKS, ...(EDE_DATA.squares || []).map((b) => ({ ...makeBlock(b, b.id), sidewalk: true }))]) {
  for (let ix = Math.floor(b.minX / BLOCK_CELL); ix <= Math.floor(b.maxX / BLOCK_CELL); ix++) {
    for (let iz = Math.floor(b.minZ / BLOCK_CELL); iz <= Math.floor(b.maxZ / BLOCK_CELL); iz++) {
      const k = ix * 100000 + iz;
      if (!BLOCK_GRID.has(k)) BLOCK_GRID.set(k, []);
      BLOCK_GRID.get(k).push(b);
    }
  }
}
function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
/** The block (curb island) under (x, z), or null on the roadway / in the water */
function blockAt(x, z, includeSidewalk = true) {
  const list = BLOCK_GRID.get(Math.floor(x / BLOCK_CELL) * 100000 + Math.floor(z / BLOCK_CELL));
  for (const b of list || []) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if ((b.rect || pointInPoly(b.poly, x, z)) && !b.holes.some(h=>pointInPoly(h,x,z))) return b;
  }
  return includeSidewalk ? sidewalkAt(x,z) : null;
}
const SIDEWALKS = new Map();
function sidewalkAt(x, z) {
  if (waterAt(x, z) && !roadCrossesWater(x, z)) return null;
  const radius = 24;
  let best = null, bestDistance = Infinity, bestSide = 0;
  for (let cx = Math.floor((x - radius) / ROAD_CELL); cx <= Math.floor((x + radius) / ROAD_CELL); cx++) {
    for (let cz = Math.floor((z - radius) / ROAD_CELL); cz <= Math.floor((z + radius) / ROAD_CELL); cz++) {
      for (const s of ROAD_GRID.get(cx * 100000 + cz) || []) {
        const r = s.r, dx = s.bx - s.ax, dz = s.bz - s.az;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const at = Math.min(len, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / len));
        const distance = Math.hypot(x - s.ax - at * dx / len, z - s.az - at * dz / len);
        if (r.kind === 'cycleway' && !r.modes?.some(mask => mask & FOOT)) continue;
        const pedestrian = ['footway', 'pedestrian', 'path', 'steps', 'cycleway'].includes(r.kind);
        const half = (r.bgtWidth ?? r.bgt?.width ?? r.w) / 2;
        const matches = pedestrian ? distance <= half : distance >= half - 0.4 && distance <= half + 5.5;
        if (!matches || distance >= bestDistance) continue;
        bestDistance = distance;
        best = r;
        bestSide = pedestrian ? 0 : Math.sign(dx * (z - s.az) - dz * (x - s.ax));
      }
    }
  }
  if (!best) return null;
  const id = 'sidewalk:' + best.id + ':' + bestSide;
  if (!SIDEWALKS.has(id)) SIDEWALKS.set(id, {
    id, sidewalk: true, park: 0, median: false, poly: best.pts, holes: [], rects: [], rect: false,
    cx: best.pts[0].x, cz: best.pts[0].z, district: districtAt(x, z)
  });
  return SIDEWALKS.get(id);
}



// A 4 m fill serves most water queries. Boundary cells use the exact outline in a local index.
const WATER_CELL = 4;
const WATER_INDEX_CELL = 64;
const waterCols = Math.ceil((maxX - minX) / WATER_CELL);
const waterRows = Math.ceil((maxZ - minZ) / WATER_CELL);
const waterGrid = new Uint8Array(waterCols * waterRows);
const waterIndex = new Map();

function waterCellKey(column, row) {
  return column * 100000 + row;
}

function registerWater(feature) {
  const block = makeBlock(feature, feature.id);
  const rings = [block.poly, ...block.holes];
  const column0 = Math.floor(block.minX / WATER_INDEX_CELL), column1 = Math.floor(block.maxX / WATER_INDEX_CELL);
  const row0 = Math.floor(block.minZ / WATER_INDEX_CELL), row1 = Math.floor(block.maxZ / WATER_INDEX_CELL);
  for (let column = column0; column <= column1; column++) for (let row = row0; row <= row1; row++) {
    const key = waterCellKey(column, row);
    if (!waterIndex.has(key)) waterIndex.set(key, []);
    waterIndex.get(key).push(block);
  }

  const crossings = new Map();
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const low = Math.max(0, Math.ceil((Math.min(a.z, b.z) - minZ) / WATER_CELL - 0.5));
    const high = Math.min(waterRows, Math.ceil((Math.max(a.z, b.z) - minZ) / WATER_CELL - 0.5));
    for (let row = low; row < high; row++) {
      const z = minZ + (row + 0.5) * WATER_CELL;
      const x = a.x + (z - a.z) * (b.x - a.x) / (b.z - a.z);
      if (!crossings.has(row)) crossings.set(row, []);
      crossings.get(row).push(x);
    }
  }
  for (const [row, xs] of crossings) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const left = Math.max(0, Math.ceil((xs[i] - minX) / WATER_CELL - 0.5));
      const right = Math.min(waterCols - 1, Math.floor((xs[i + 1] - minX) / WATER_CELL - 0.5));
      for (let column = left; column <= right; column++) {
        const index = row * waterCols + column;
        if (!waterGrid[index]) waterGrid[index] = 1;
      }
    }
  }

  const neighbors = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j], steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let k = 0; k <= steps; k++) {
      const x = a.x + (b.x - a.x) * k / steps, z = a.z + (b.z - a.z) * k / steps;
      const col = Math.floor((x - minX) / WATER_CELL), row = Math.floor((z - minZ) / WATER_CELL);
      for (const [dx, dz] of neighbors) {
        const column = col + dx, r = row + dz;
        if (column >= 0 && column < waterCols && r >= 0 && r < waterRows) waterGrid[r * waterCols + column] = 2;
      }
    }
  }
}

for (const feature of EDE_DATA.water) registerWater(feature);

function waterAtExact(x, z) {
  const cell = waterIndex.get(waterCellKey(Math.floor(x / WATER_INDEX_CELL), Math.floor(z / WATER_INDEX_CELL)));
  return cell?.some(w => x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ
    && pointInPoly(w.poly, x, z) && !w.holes.some(hole => pointInPoly(hole, x, z))) ?? false;
}

function waterAt(x, z) {
  const column = Math.floor((x - minX) / WATER_CELL), row = Math.floor((z - minZ) / WATER_CELL);
  if (column < 0 || row < 0 || column >= waterCols || row >= waterRows) return waterAtExact(x, z);
  const state = waterGrid[row * waterCols + column];
  return state === 2 ? waterAtExact(x, z) : state === 1;
}

function nearestRoadPoint(x,z,roads){
 let best=null,dist=Infinity;
 for(const r of roads)for(let i=0;i+1<r.pts.length;i++){
  const a=r.pts[i],b=r.pts[i+1],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz;if(L2<1)continue;
  const t=Math.max(0.02,Math.min(.98,((x-a.x)*dx+(z-a.z)*dz)/L2)),px=a.x+t*dx,pz=a.z+t*dz,d=Math.hypot(px-x,pz-z);
  if(d<dist){dist=d;const sign=r.dir<0?-1:1;best={x:px,z:pz,heading:Math.atan2(dx*sign,dz*sign),road:r};}
 }
 return best;
}
function nearestDrivingPoint(x,z,name=null){
 return nearestRoadPoint(x,z,name?ROAD_DRIVING.filter(r=>r.name===name):ROAD_DRIVING);
}
function arrival(lon,lat,name=null){
 const p=projectLonLat(lon,lat);
 const preferred=name&&nearestDrivingPoint(p.x,p.z,name);
 const q=preferred&&Math.hypot(preferred.x-p.x,preferred.z-p.z)<250?preferred:nearestDrivingPoint(p.x,p.z);
 return q?{x:q.x,z:q.z,heading:q.heading,name:q.road.name}:{...p,heading:0};
}
const defaultSpawn=arrival(5.67204,52.04651,'Driehoek');
defaultSpawn.x-=Math.cos(defaultSpawn.heading)*1.8;defaultSpawn.z+=Math.sin(defaultSpawn.heading)*1.8;
// Legacy material code samples ordered district bands through streetZ; keep distinct thresholds.
const streetZ=(n=37)=>defaultSpawn.z+(37-Number(n))*25;
const NYC_LANDMARKS=[
 ['edewageningen','Station Ede-Wageningen','Ede-Wageningen',5.6741136,52.0274114,'Stationsgebied','Frisopark'],
 ['chico-y-chica','Chico y Chica','Chico y Chica',5.673605,52.045626,'Raadhuisplein','Raadhuisplein'],
 ['marktplein','Marktplein','Marktplein',5.669702,52.0465652,'Centrum','Marktstraat'],
 ['proosdijpark','Proosdijpark','Proosdijpark',5.6496497,52.0398935,'Veldhuizen','Veenderweg'],
 ['sherman-tank','Sherman Tank','Sherman Tank',5.69175563,52.0414851,'Langenberg','Arnhemseweg'],
].map(([id,name,short,lon,lat,district,road])=>{
 const site=LANDMARK_SITES[name];
 const {x,z}=site||projectLonLat(lon,lat);
 return {id,name,short,x,z,district,road,lon,lat};
}).concat(EDE_MODELED_LANDMARKS.map(site => ({
 ...site, short: site.name,
 lon: AFF.lon0 + (site.x - AFF.x[0]) / AFF.x[1],
 lat: AFF.lat0 + (site.z - AFF.z[0]) / AFF.z[2],
})));
// Specific approaches point toward the entrance or main façade from a mapped street.
const LANDMARK_APPROACHES={
 'nieuwe-kerk':[5.6629353,52.0368761],
 noorderkerk:[5.6685570,52.0489451],
 'sint-antoniuskerk':[5.6708978,52.0308568],
 beatrixkerk:[5.6626710,52.0341281],
 lukkien:[5.6246029,52.0221551],
 oudekerk:[5.670825,52.046130],
 'chico-y-chica':[5.6737293,52.0456570],
 openluchttheater:[5.6782546,52.0398201],
 astrant:[5.6686318,52.0450327],
 'enka-westhal':[5.67843,52.02564],
 'pegasus-flat':[5.6488113,52.0240750],
};
// Scene metres for the viewpoint and the part of each landmark the chase camera frames.
const SCENIC_ARRIVALS = {
 oudekerk:           [-49.8, -14.25, 0, 0, 18, 'Torenstraat'],
 concordiamolen:     [-386, -65, -390.65, -101.7, 16, 'Accesweg'],
 raadhuis:           [253, 8, 247.4, 34.8, 3.8, 'Bergstraat'],
 'huis-kernhem':     [-1010, -750, -973.6, -759.5, 5.3, 'Kernhemselaan'],
 openluchttheater:   [475.5, 655, 476.5, 624.8, 3.15, 'van Pabstlaan', [-5, -4.5]],
 edewageningen:      [209, 2207, 195, 2150, 17, 'Polar Bearsplein'],
 'johan-willem-friso': [145, 1928, 211, 1946, 7.5, 'Frisopark'],
 'enka-westhal':     [495, 2246, 471.16, 2287.53, 6.5, 'Akulaan'],
 hoekelum:           [339.42, 3432.40, 355.2, 3393, 6.8, 'Landgoed Hoekelum'],
 gasfabriek:         [-453, 698, -433, 672, 5.0, 'Diamantstraat'],
};
const TELEPORT_LOCATIONS={};
for(const lm of NYC_LANDMARKS){
 const approach=LANDMARK_APPROACHES[lm.id];
 const point=lm.approach ?? (approach&&projectLonLat(...approach));
 const streetPoint=point&&nearestRoadPoint(point.x,point.z,ROADS.filter(r=>r.name===lm.road));
 const t=streetPoint?{x:streetPoint.x,z:streetPoint.z,name:streetPoint.road.name}:arrival(lm.lon,lm.lat,lm.road);
 t.heading=Math.atan2(lm.x-t.x,lm.z-t.z);
 const scenic = SCENIC_ARRIVALS[lm.id];
 if (scenic) {
   const [x, z, tx, tz, height, name, offset] = scenic;
   TELEPORT_LOCATIONS[lm.id] = { x, z, name, heading: Math.atan2(tx - x, tz - z), focus: { x: tx, z: tz, height, offset } };
 } else {
   TELEPORT_LOCATIONS[lm.id] = t;
 }
 if(!LANDMARK_SITES[lm.name])LANDMARK_SITES[lm.name]={x:lm.x,z:lm.z,w:60,d:60,h:20,ring:[]};
}
function getLocationLabel(x,z){
 let landmark = null, landmarkDistance = 100;
 for (const lm of NYC_LANDMARKS) {
   const distance = Math.hypot(x - lm.x, z - lm.z);
   if (distance >= landmarkDistance) continue;
   landmark = lm;
   landmarkDistance = distance;
 }
 if (landmark) return landmark.name;
 const nearby=nearestRoads(x,z,100).filter(q=>q.road.raw);
 if(nearby.length>1&&nearby[1].dist<22)return `${nearby[0].road.name} & ${nearby[1].road.name}`;
 if(nearby.length)return nearby[0].road.name;
 if(waterAt(x,z))return 'Water · Ede';
 return 'Ede';
}
// Keyboard shortcuts are ignored while typing into a form field (e.g. the map's street search box)
function isTypingInField(e) {
  return e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
}

// Traffic signal cycle shared by the signal heads (street-details.js) and the traffic (traffic.js), in seconds:
// avenues green until avenueAmber, amber until avenueRed; cross streets green from avenueRed until streetAmber,
// amber until the end of the cycle. Pedestrians cross with the traffic that runs parallel to them, stepping off
// only on the WALK, the first `walk` seconds of its green: long enough before the cross traffic's green for the
// slowest walker to get across the widest avenue.
const SIGNAL_TIMING = { cycle: 60, avenueAmber: 26, avenueRed: 30, streetAmber: 56, walk: 7 };

// 'green', 'amber' or 'red' for avenue or cross street traffic at a given time
function signalPhase(time, isAvenue) {
  const { cycle, avenueAmber, avenueRed, streetAmber } = SIGNAL_TIMING;
  const t = ((time % cycle) + cycle) % cycle;
  if (isAvenue) return t < avenueAmber ? 'green' : t < avenueRed ? 'amber' : 'red';
  return t < avenueRed ? 'red' : t < streetAmber ? 'green' : 'amber';
}

// Do pedestrians walking alongside avenue (or cross street) traffic have the WALK at a given time?
function walkSignal(time, isAvenue) {
  const { cycle, avenueRed, walk } = SIGNAL_TIMING;
  const t = (((time - (isAvenue ? 0 : avenueRed)) % cycle) + cycle) % cycle;
  return t < walk;
}
export {
  EDE_DATA, EDE_AREAS, toPts, projectLonLat, pointInPoly, waterAt, waterAtExact, nearestDrivingPoint, defaultSpawn, sidewalkAt,
  AVENUES,
  ALL_AVENUES,
  CENTRAL_PARK_BOUNDS,
  getIslandBoundsAtZ,
  MANHATTAN_COASTLINE,
  getBroadwayX,
  BROADWAY_LINE,
  WATERFRONT_PIERS,
  ROOSEVELT_ISLAND_POLYGON,
  GOVERNORS_ISLAND_POLYGON,
  NJ_SHORELINE_POLYGON,
  LONG_ISLAND_POLYGONS,
  BROOKLYN_POLYGONS,
  QUEENS_POLYGONS,
  BRONX_POLYGONS,
  WESTCHESTER_POLYGON,
  NASSAU_POLYGON,
  UPPER_MANHATTAN_POLYGON,
  BRONX_POLYGON,
  STATEN_ISLAND_POLYGON,
  RANDALLS_ISLAND_POLYGON,
  LIBERTY_ISLAND_POLYGON,
  LIBERTY_STATUE_POS,
  ELLIS_ISLAND_POLYGON,
  MILL_ROCK_POLYGON,
  EAST_RIVER_BRIDGES,
  OUTER_BRIDGES,
  STREETS,
  ALL_STREETS,
  ROADS,
  NYC_LANDMARKS,
  LANDMARK_SITES,
  TELEPORT_LOCATIONS,
  ISLAND_BOUNDS,
  BLOCKS,
  CUT_Z,
  SIGNAL_TIMING,
  streetZ,
  avenueX,
  districtAt,
  blockAt,
  nearestRoads,
  roadCrossesWater,
  getBlockBounds,
  getLocationLabel,
  fromOldFrame,
  isTypingInField,
  signalPhase,
  walkSignal
};
