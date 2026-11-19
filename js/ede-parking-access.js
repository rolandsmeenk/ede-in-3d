import { fittedLanePoint, projectFittedLane } from './ede-lane-geometry.js';
import { CAR } from './road-access.js';
import { indexLocalRoads } from './traffic-area.js';
import { gradeWayAt } from './ede-grade.js';
import { terrainHeightAt } from './terrain.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const mix = (a,b,t) => a + (b-a)*t;
const angle = (a,b) => Math.atan2(Math.sin(b-a),Math.cos(b-a));
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const roadY = (edge,x,z) => gradeWayAt(edge.wayId,x,z,1.2)?.y ?? terrainHeightAt(x,z);

function lanePoint(edge,lane,s) {
  const { x, z, dx, dz } = fittedLanePoint(edge, lane, s, {});
  return { x, y: roadY(edge, x, z), z, yaw: Math.atan2(dx, dz) };
}

function addCurve(points, a, b) {
  const length = distance(a,b);
  const turn = Math.min(8, length * 0.38);
  const ax = a.x + Math.sin(a.yaw) * turn, az = a.z + Math.cos(a.yaw) * turn;
  const bx = b.x - Math.sin(b.yaw) * turn, bz = b.z - Math.cos(b.yaw) * turn;
  points.push(a);
  for (let i=1;i<10;i++) {
    const t=i/10, u=1-t;
    const x=u*u*u*a.x + 3*u*u*t*ax + 3*u*t*t*bx + t*t*t*b.x;
    const z=u*u*u*a.z + 3*u*u*t*az + 3*u*t*t*bz + t*t*t*b.z;
    const dx=u*u*(ax-a.x) + 2*u*t*(bx-ax) + t*t*(b.x-bx);
    const dz=u*u*(az-a.z) + 2*u*t*(bz-az) + t*t*(b.z-bz);
    points.push({x,y:mix(a.y,b.y,t),z,yaw:Math.atan2(dx,dz)});
  }
  points.push(b);
}

function motion(points, reverse = false) {
  let length = 0;
  const samples = [];
  for (let i=0;i<points.length;i++) {
    if (i) {
      const gap = distance(points[i-1], points[i]);
      if (gap < 0.02) continue;
      length += gap;
    }
    samples.push({ ...points[i], distance: length });
  }
  return { samples, length, reverse };
}

export function parkingPose(path, s, out) {
  const progress = clamp(path.reverse ? path.length-s : s, 0, path.length);
  const points = path.samples;
  let lo=0, hi=points.length-1;
  while (lo+1<hi) {
    const mid=(lo+hi)>>1;
    if (points[mid].distance <= progress) lo=mid;
    else hi=mid;
  }
  const a=points[lo], b=points[hi];
  const t=clamp((progress - a.distance) / (b.distance - a.distance || 1),0,1);
  out.x=mix(a.x,b.x,t);
  out.y=mix(a.y,b.y,t);
  out.z=mix(a.z,b.z,t);
  out.yaw=a.yaw + angle(a.yaw,b.yaw)*t;
  out.reversing=path.reverse || !!a.backing;
  return out;
}

function driveCurve(points, from, to) {
  if (distance(from,to) < 0.08) return;
  addCurve(points,from,to);
}

function routePoints(points, layer) {
  return points.map((point,i) => {
    const a=points[i-1] ?? point, b=points[i+1] ?? point;
    const yaw=Math.atan2(b.x-a.x,b.z-a.z);
    return { ...point, y: point.y ?? terrainHeightAt(point.x,point.z), yaw, layer };
  });
}

function constrainedApproach(path, network, space, allowDriveway) {
  if (allowDriveway || !network.activeTravel) return true;
  const tracks=[];
  network.activeTravel.bikes(space.x,space.z,20,tracks);
  const foot=[];
  network.activeTravel.foot(space.x,space.z,20,foot);
  for (const track of [...tracks,...foot]) {
    if ((track.layer ?? 0) !== (space.layer ?? 0) || track.sharedRoad) continue;
    if (!track.crossing && !tracks.includes(track) && !track.sidewalk && track.kind !== 'footway') continue;
    for (const point of path.samples) {
      const dx=point.x-track.ax, dz=point.z-track.az;
      const along=clamp(dx*track.ux+dz*track.uz,0,track.len);
      if (Math.hypot(dx-along*track.ux,dz-along*track.uz) < (track.width ?? 1.8)*0.5+0.93) return false;
    }
  }
  return true;
}

function onLane(edge, point, incoming, maxOffset, mappedGate=false) {
  const lane=edge.ambientLanes.at(-1);
  const inset=mappedGate ? 12 : 2.5;
  if (!Number.isInteger(lane)) return null;
  const chord = (point.x-edge.sx)*edge.dx + (point.z-edge.sz)*edge.dz;
  if (chord < -inset || chord > edge.len + inset) return null;
  const p = projectFittedLane(edge, lane, point.x, point.z, -inset, edge.len + inset, {});
  const along = p.station;
  const side = (point.z - p.z) * p.dx - (point.x - p.x) * p.dz;
  if (side < (mappedGate ? -Math.min(8,edge.half+2.5) : -0.65) || side > maxOffset) return null;
  const s=clamp(along + (incoming ? -7.5 : 7.5), 3.5, edge.len-3.5);
  if (s<3.5 || s>edge.len-3.5 || Math.abs(s-along)>(mappedGate?23:13)) return null;
  return {edge,lane,s,pose:lanePoint(edge,lane,s),side,along};
}

function directBay(space, edges, network) {
  let best, score=Infinity;
  for (const edge of edges) {
    if ((edge.layer??0) !== (space.layer??0)) continue;
    const entrance=onLane(edge,space,true,8.5);
    if (!entrance || entrance.side<1.8 || entrance.along<5 || entrance.along>edge.len-5 ||
        Math.abs(entrance.pose.y-space.y)>1.8) continue;
    let yaw=space.heading;
    if (Math.cos(yaw-entrance.pose.yaw)<0) yaw+=Math.PI;
    if (Math.abs(Math.cos(yaw-entrance.pose.yaw))<0.72 &&
        Math.sin(yaw)*edge.rx+Math.cos(yaw)*edge.rz<0) yaw+=Math.PI;
    if (Math.cos(yaw-space.heading)<0) continue;
    const points=[];
    addCurve(points,entrance.pose,{x:space.x,y:space.y,z:space.z,yaw});
    const arrival=motion(points);
    if (!constrainedApproach(arrival,network,space,space.driveway === true)) continue;
    const cost=entrance.side + Math.abs(entrance.s+7.5-entrance.along);
    if (cost>=score) continue;
    score=cost;
    best={ entrance,exit:entrance,arrival,departure:motion(points,true), heading:yaw };
  }
  return best;
}

function bestGate(point, candidates, incoming, accessIsMapped) {
  let best, cost=Infinity;
  for (const e of candidates) {
    if ((e.layer??0) !== (point.layer??0) || !e.ambientLanes?.length || e.unmodeledTunnel) continue;
    const found=onLane(e,point,incoming,accessIsMapped ? 17:5.5,accessIsMapped);
    if (!found || Math.abs(found.pose.y-(point.y ?? terrainHeightAt(point.x,point.z)))>2.1) continue;
    const score=distance(found.pose,point) + Math.abs(found.side) + (found.side<-.65?1.8:0);
    if (score<cost) {
      cost=score;
      best=found;
    }
  }
  return best;
}

function aisleNetwork(records, connect) {
  const points=new Map(), segments=new Map();
  let entrance,exit,gate;
  function node(x,z,layer) {
    const key=x.toFixed(2)+'/'+z.toFixed(2)+'/'+layer;
    if (!points.has(key)) points.set(key,{x,y:terrainHeightAt(x,z),z,layer,out:[],in:[]});
    return points.get(key);
  }
  for (const row of records) {
    if (!Array.isArray(row.pts) || row.pts.length<4) continue;
    const list=[];
    let a=node(row.pts[0],row.pts[1],row.layer??0);
    const first=a;
    for (let i=2;i<row.pts.length;i+=2) {
      const b=node(row.pts[i],row.pts[i+1],row.layer??0);
      if (a!==b) {
        const length=distance(a,b);
        if (!row.oneway || !row.reverse) {
          a.out.push(b); b.in.push(a);
          list.push({a,b,length});
        }
        if (!row.oneway || row.reverse) {
          b.out.push(a); a.in.push(b);
          list.push({a:b,b:a,length});
        }
      }
      a=b;
    }
    segments.set(row.id,list);
    if (row.yield || row.approachWayId || row.streetWayId) {
      const candidates=Array.isArray(row.junction) ? [node(row.junction[0],row.junction[1],row.layer??0)] : [first,a];
      for (const point of candidates) {
        const street={...point,approachWayId:row.approachWayId??row.streetWayId};
        const from=connect(street,true,true), to=connect(street,false,true);
        if (!from || !to) continue;
        const cost=distance(from.pose,point)+distance(to.pose,point);
        if (gate && cost>=gate.cost) continue;
        entrance=from; exit=to; gate={point,cost};
      }
    }
  }
  if (!gate) return null;
  function paths(direction) {
    const costs=new Map([[gate.point,0]]), prev=new Map([[gate.point,null]]), todo=[gate.point];
    while (todo.length) {
      todo.sort((a,b)=>costs.get(b)-costs.get(a));
      const point=todo.pop(), value=costs.get(point);
      for (const neighbor of point[direction]) {
        const cost=value+distance(point,neighbor);
        if (cost>=(costs.get(neighbor)??Infinity)) continue;
        costs.set(neighbor,cost);
        prev.set(neighbor,point);
        if (!todo.includes(neighbor)) todo.push(neighbor);
      }
    }
    return {costs,prev};
  }
  return { entrance,exit,segments,from:paths('out'),to:paths('in') };
}

function lotApproach(space, lot) {
  let best,score=Infinity;
  for (const {a,b,length} of lot.segments.get(space.wayId) ?? []) {
    if (!lot.from.prev.has(a) || !lot.to.prev.has(b) || a.layer!==(space.layer??0)) continue;
    const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    const along=(space.x-a.x)*dx+(space.z-a.z)*dz;
    const side=(space.z-a.z)*dx-(space.x-a.x)*dz;
    if (along<0.9 || along>length-0.8 || side<1.65 || side>8.5) continue;
    const before=Math.max(0.15,along-(Math.abs(Math.cos(space.heading-Math.atan2(dx,dz)))>.72?6:4));
    const point={x:a.x+dx*before-dz*.55,z:a.z+dz*before+dx*.55,
      y:mix(a.y,b.y,before/length),yaw:Math.atan2(dx,dz)};
    if (Math.abs(point.y-space.y)>1.6) continue;
    let heading=space.heading;
    if (Math.abs(Math.cos(heading-point.yaw))>.72 ? Math.cos(heading-point.yaw)<0 :
      Math.sin(heading)*(-dz)+Math.cos(heading)*dx<0) heading+=Math.PI;
    if (Math.cos(heading-space.heading)<0) continue;
    const cost=side+0.008*(lot.from.costs.get(a)+lot.to.costs.get(b));
    if (cost>=score) continue;
    score=cost;
    best={a,b,point,heading};
  }
  if (!best) return null;
  const {a,b,point,heading}=best;
  const inPoints=[];
  for (let node=a;node;node=lot.from.prev.get(node)) inPoints.unshift(node);
  const outPoints=[];
  for (let node=b;node;node=lot.to.prev.get(node)) outPoints.push(node);
  const aisleIn=routePoints([...inPoints,point],space.layer??0);
  const aisleOut=routePoints([point,...outPoints],space.layer??0);
  const into=[],leave=[],bend=[];
  driveCurve(into,lot.entrance.pose,aisleIn[0]);
  into.push(...aisleIn.slice(0,-1));
  addCurve(bend,point,{x:space.x,y:space.y,z:space.z,yaw:heading});
  into.push(...bend);
  for (let i=bend.length-1;i>0;i--) leave.push({...bend[i],backing:true});
  leave.push(...aisleOut);
  driveCurve(leave,aisleOut.at(-1),lot.exit.pose);
  return { entrance:lot.entrance,exit:lot.exit,arrival:motion(into),departure:motion(leave),heading };
}

export function createParkingAccess(network, aisles = []) {
  const eligible=network.edges.filter(e => e.ambientLanes?.length && !e.underpass && !e.boundary);
  const nearby=indexLocalRoads(eligible,[]);
  const byWay=new Map(), cache=new Map(), near=[], signals=[];
  for (const edge of eligible) {
    if (!byWay.has(edge.wayId)) byWay.set(edge.wayId,[]);
    byWay.get(edge.wayId).push(edge);
  }
  function connect(point,incoming,verified) {
    const way=point.approachWayId ?? point.streetWayId;
    if (way) return bestGate(point,byWay.get(way) ?? [],incoming,verified);
    nearby(point.x,point.z,verified ? 23:9,near,signals);
    return bestGate(point,near,incoming,verified);
  }

  const grouped=new Map(), lots=new Map();
  for (const row of aisles) {
    if (!grouped.has(row.areaId)) grouped.set(row.areaId,[]);
    grouped.get(row.areaId).push(row);
  }
  for (const [areaId,records] of grouped) {
    const mapped=aisleNetwork(records,connect);
    if (mapped) lots.set(areaId,mapped);
  }
  const cacheKey=space=>space.virtual ? `garage:${space.areaId}` : space.id;

  function garage(space) {
    const facility=space.facility;
    if (!facility?.entrance || !facility?.exit) return null;
    const inGate=facility.entrance, outGate=facility.exit;
    const inside=routePoints(inGate.route?.length ? inGate.route : [inGate], inGate.layer ?? 0);
    const outside=routePoints(outGate.route?.length ? outGate.route : [outGate], outGate.layer ?? 0);
    const entrance=connect({...inGate,...inside[0],layer:(inGate.approachLayer??0)},true,true);
    const exit=connect({...outGate,...outside.at(-1),layer:(outGate.approachLayer??0)},false,true);
    if (!entrance || !exit) return null;
    if (inside.length===1) inside[0].yaw=entrance.pose.yaw;
    if (outside.length===1) outside[0].yaw=exit.pose.yaw;
    const a=[], b=[];
    driveCurve(a,entrance.pose,inside[0]);
    a.push(...inside);
    b.push(...outside);
    driveCurve(b,outside.at(-1),exit.pose);
    if (a.length<2 || b.length<2) return null;
    return {entrance,exit,arrival:motion(a),departure:motion(b),heading:inside.at(-1).yaw};
  }

  return {
    connect,
    link(space) {
      const id=cacheKey(space);
      if (!cache.has(id)) {
        const lot=lots.get(space.areaId);
        const link=space.virtual ? garage(space) : space.wayId && space.maneuver!==false ?
          (lot && lotApproach(space,lot)) || directBay(space,byWay.get(space.wayId) ?? [],network) : null;
        if (cache.size>=2048) cache.delete(cache.keys().next().value);
        cache.set(id,link??null);
      }
      return cache.get(id);
    }
  };
}

export function findParkingArrival(vehicle, linksByEdge, { available, closed, allowedArea, turn, maxEdges=42, maxDepth=4 } = {}) {
  if (!vehicle.edge || vehicle.conn || vehicle.edge.unmodeledTunnel) return null;
  const queue=[{edge:vehicle.edge,lane:vehicle.lane,previous:null,move:null,depth:0,restriction:vehicle.turnHistory}];
  const seen=new Set([`${vehicle.edge.id}/${vehicle.lane}/${vehicle.turnHistory?.key??''}`]);
  const blockedAreas=new Set();
  for (let i=0;i<queue.length && i<maxEdges;i++) {
    const node=queue[i];
    if (closed?.(node.edge)) continue;
    for (const item of linksByEdge.get(node.edge) ?? []) {
      if (allowedArea && item.space.areaId!==allowedArea) continue;
      const { entrance }=item.link;
      if (entrance.lane!==node.lane || (!node.depth && entrance.s-vehicle.s<Math.max(7,vehicle.speed*1.25))) continue;
      if (!available(item)) {
        blockedAreas.add(item.space.areaId);
        if (blockedAreas.size>=3) return null;
        continue;
      }
      const route=[];
      for (let p=node;p.previous;p=p.previous) route.unshift(p.move);
      return {item,route};
    }
    if (node.depth>=maxDepth) continue;
    for (const move of node.edge.ambientMoves ?? []) {
      const lane=move.out[node.lane];
      if (lane<0 || queue.length>=maxEdges || closed?.(move.to)) continue;
      const restriction=turn?.(node.restriction,move,CAR);
      if (restriction===null) continue;
      const key=`${move.to.id}/${lane}/${restriction?.key??''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({edge:move.to,lane,previous:node,move,depth:node.depth+1,restriction});
    }
  }
  return null;
}
