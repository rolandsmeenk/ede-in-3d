import { CAR, VAN, BUS, MOTOR, VEHICLE_CLEARANCE, fitsRoad } from './road-access.js?v=20261122-startup';
import { localClock, weekday } from './ede-transit-time.js';
import { indexLocalRoads } from './traffic-area.js';
import { EDE_WHITE_BIKE_SITES } from './ede-white-bike-sites.js';
import { whiteBikePath, whiteBikeTrack } from './ede-white-bike-traffic.js';

// Separate public approaches keep a station or square from attracting vehicles to a bus-only or walking surface.
const destinations = [
  { id:'grotestraat', kind:'shops', foot:[-61,51,0], bike:[-75,-155,0], road:[43,-53,0], zone:'centrum' },
  { id:'markt', kind:'shops', foot:[-119,-53,0], bike:[-190,-83,0], road:[-42.3,-136.9,0], parking:'q-park-markt', zone:'centrum' },
  { id:'kuiperplein', kind:'parking', foot:[-213,115,0], bike:[-254,128,0], road:[-251.8,129.5,0], parking:'kuiperplein', zone:'centrum' },
  { id:'astrant', kind:'nightlife', foot:[-184,102,0], bike:[-254,128,0], zone:'centrum' },
  { id:'museumplein', kind:'nightlife', foot:[-195,248,0], bike:[-214,300,0], zone:'centrum' },
  { id:'raadhuis', kind:'work', foot:[247,24,0], bike:[189,31,0], road:[191,32,0] },
  { id:'ziekenhuis-gelderse-vallei', kind:'work', foot:[-1666,2595,0], bike:[-1666,2595,0],
    road:[-1636,2838,0], parking:'ziekenhuis-gelderse-vallei' },
  { id:'hoekelum', kind:'recreation', foot:[452,3373,0] },
  { id:'sportpark-hoekelumse-eng', kind:'recreation', foot:[-166,3558,0], bike:[-166,3558,0] },
  { id:'ginkelse-heide', kind:'recreation', foot:[4286,1019,0], bike:[4286,1019,0], zone:'ginkelse-heide' },
  { id:'station', kind:'station', foot:[180,2121,0], bike:[94,2036,0], road:[192.9,2305.3,0], parking:'ede-wageningen-pr' },
  { id:'bospoort-homes', kind:'homes', foot:[-69,-332,0], bike:[-71,-258,0], road:[-73,-344,0] },
  { id:'bergstraat-homes', kind:'homes', foot:[300,50,0], bike:[293,-13,0], road:[306,45,0] },
  { id:'parkweg-homes', kind:'homes', foot:[-265,2025,0], bike:[-342,1928,0], road:[-297,2024,0] },
  { id:'stationsweg-homes', kind:'homes', foot:[58,1748,0], bike:[78,1723,0], road:[72,1720,0] },
  { id:'zandlaan-schools', kind:'school', foot:[-212,3058,0], bike:[-226,3029,0], road:[-164,3020,0] },
  { id:'telefoonweg-school', kind:'school', foot:[-310,-55,0], bike:[-329,-63,0], road:[-318,-46,0] }
];

const weights = {
  night:    { homes:2.3, shops:0.12, school:0, station:0.22, parking:0.22 },
  morning:  { homes:0.6, shops:0.9, school:2.8, station:2.7, parking:1.05 },
  daytime:  { homes:0.75, shops:2.8, school:0.6, station:1, parking:2.05 },
  afternoon:{ homes:1.8, shops:2.15, school:0.65, station:1.6, parking:1.4 },
  evening:  { homes:2.6, shops:0.95, school:0.1, station:0.85, parking:0.65 }
};

export function destinationWeights(epoch = Date.now()) {
  const { date, seconds } = localClock(epoch / 1000);
  const day = weekday(date), hour = seconds / 3600;
  if (hour < 6 || hour >= 22) return weights.night;
  if (day === 0 || day === 6) {
    if (hour >= 9 && hour < 18) return { ...weights.daytime, school:0, station:0.8 };
    return { ...weights.evening, school:0 };
  }
  if (hour < 9.2) return weights.morning;
  if (hour < 14.5) return weights.daytime;
  if (hour < 18.3) return weights.afternoon;
  return weights.evening;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sq = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
const miles = { road:650, bike:550, foot:410 };
const cacheLimit = 760;
const moveAllowed = (move, mode) => Boolean((move.modes ?? MOTOR) & mode);
const keyFor = mode => mode === VAN ? 'van' : mode === BUS ? 'bus' : 'car';
const moveList = (edge, mode) => (mode === VAN ? edge.vanMoves : mode === BUS ? edge.moves : edge.ambientMoves) ?? [];
const laneList = (edge, mode) => mode === VAN ? edge.vanLanes : edge.ambientLanes;

function push(queue, row) {
  let i = queue.length;
  queue.push(row);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (queue[p].f <= row.f) break;
    queue[i] = queue[p];
    i = p;
  }
  queue[i] = row;
}

function pull(queue) {
  const top = queue[0], tail = queue.pop();
  if (!queue.length) return top;
  let i = 0;
  while (2 * i + 1 < queue.length) {
    let c = 2 * i + 1;
    if (c + 1 < queue.length && queue[c + 1].f < queue[c].f) c++;
    if (queue[c].f >= tail.f) break;
    queue[i] = queue[c];
    i = c;
  }
  queue[i] = tail;
  return top;
}

function search(start, { neighbors, identify, target, remaining, budget, range }) {
  const initial = { value:start, g:0, f:remaining(start), from:null };
  const queue = [initial], costs = new Map([[identify(start),0]]);
  for (let tested=0; queue.length && tested<budget; tested++) {
    const row = pull(queue);
    if (costs.get(identify(row.value)) !== row.g) continue;
    const goal = target(row.value, row.from !== null);
    if (goal) {
      const steps = [];
      for (let p=row; p.from; p=p.from) steps.push(p.value.step);
      return { goal, steps:steps.reverse() };
    }
    for (const next of neighbors(row.value)) {
      const g = row.g + next.cost;
      if (g > range) continue;
      const key = identify(next);
      if (g >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key,g);
      push(queue,{ value:next, g, f:g+remaining(next), from:row });
    }
  }
  return null;
}

export function findRoadTrip(network, roadTraffic, origin, goals, mode=CAR, { budget=180, range=1150, moves = edge => moveList(edge, mode) }={}) {
  const { edge, lane, s, restriction }=origin;
  if (!edge || !goals.length) return null;
  const allowed = new Map();
  for (const goal of goals) {
    if (!allowed.has(goal.edge)) allowed.set(goal.edge, []);
    allowed.get(goal.edge).push(goal);
  }
  const heuristic = ({edge:e}) => Math.min(...goals.map(goal=>Math.hypot(e.to.x-goal.x,e.to.z-goal.z)));
  return search({ edge, lane, restriction }, {
    budget, range,
    identify: row=>row.edge.id+'/'+row.lane+'/'+(row.restriction?.key??''),
    target: ({edge:e,lane:arrivalLane}, moved) => {
      if (roadTraffic.isClosed(e)) return null;
      return allowed.get(e)?.find(here =>
        (here.lane==null || here.lane===arrivalLane) && (moved || here.at>=s+14))??null;
    },
    remaining: heuristic,
    neighbors: row => {
      const next=[];
      for (const move of moves(row.edge)) {
        const lane=move.out[row.lane];
        if (lane==null || lane<0 || !moveAllowed(move,mode) || roadTraffic.isClosed(move.to)) continue;
        if (mode===BUS && (move.to.unmodeledTunnel || !((move.to.laneModes?.[lane]??move.to.modes??BUS)&BUS) ||
            !fitsRoad(VEHICLE_CLEARANCE.bus,move.to.limits,BUS))) continue;
        const restriction = network.turnRestrictionState?.(row.restriction,move,mode);
        if (restriction===null) continue;
        next.push({edge:move.to,lane,restriction,cost:move.to.len+7,step:{from:row.edge,lane:row.lane,move}});
      }
      return next;
    }
  });
}

export function createEdeTrips(network, roadTraffic, { places=destinations, bikeParking=[], random=Math.random }={}) {
  const eligible=network.edges.filter(e=>e.ambientLanes?.length || e.vanLanes?.length);
  const nearRoad=indexLocalRoads(eligible,[]);
  const objectIds=new WeakMap(), cache=new Map();
  let nextId=0, wallAt=-Infinity, profile=weights.daytime, frame=-Infinity, plans=0, activity=null;
  const stats={road:{started:0,arrived:0,failed:0,rerouted:0}, bike:{started:0,arrived:0,failed:0},
    foot:{started:0,arrived:0,failed:0}, destinations:{}, bus:{rerouted:0,failed:0}};

  function id(o) {
    if (!objectIds.has(o)) objectIds.set(o,++nextId);
    return objectIds.get(o);
  }

  function projected(o, x, z, road) {
    const ax=road ? o.sx:o.ax, az=road ? o.sz:o.az;
    const dx=road ? o.dx:o.ux, dz=road ? o.dz:o.uz;
    const at=clamp((x-ax)*dx+(z-az)*dz,0,o.len);
    const px=ax+dx*at, pz=az+dz*at;
    return { at,x:px,z:pz,d:sq(x,z,px,pz) };
  }

  function bake(place, kind, filter) {
    const coord=place[kind];
    if (!coord) return [];
    const [x,z,layer]=coord, candidates=[];
    if (kind==='road') nearRoad(x,z,56,candidates,[]);
    else network.activeTravel?.[kind==='bike'?'bikes':'foot']?.(x,z,kind==='bike'?70:48,candidates);
    const ranked=candidates.filter(value=>(value.layer??0)===layer && !value.crossing && !value.noSpawn && !value.underpass && (!filter || filter(value)))
      .map(value=>({ ...projected(value,x,z,kind==='road'),
        ...(kind==='road' ? {edge:value} : {track:value}) }))
      .sort((a,b)=>a.d-b.d);
    if (kind==='road') return ranked.slice(0,6);
    const byWay=new Map();
    return ranked.filter(row=>{
      const way=row.track.wayId??row.track;
      const count=byWay.get(way)??0;
      byWay.set(way,count+1);
      return count<3;
    }).slice(0,9);
  }
  const hubs=places.map(place=>({...place, anchors:{ road:bake(place,'road'),bike:bake(place,'bike'),foot:bake(place,'foot') }}));
  const parkingHubs=bikeParking.map(({bikeAnchors,...place})=>({...place, anchors:{bike:bikeAnchors}}));
  const parkBikeHubs = EDE_WHITE_BIKE_SITES.map(({ id, approach, entrance }) => ({
    id, entrance, parkBike: true, anchors: { bike: bake({ bike: [approach.x, approach.z, 0] }, 'bike', whiteBikeTrack) },
  })).filter(hub => hub.anchors.bike.length);

  function updateClock(clock, now=Date.now(), nextActivity=null) {
    if (clock!==frame) {frame=clock;plans=0;}
    activity=nextActivity;
    if (now<wallAt || now>=wallAt+30000) {wallAt=now;profile=destinationWeights(now);}
  }

  function weightFor(hub, kind) {
    if (!activity) return profile[hub.kind] ?? 0;
    const {minute, weekday, holiday, schoolHoliday, morning, afternoon, market, nightlife,
      recreation, centrumEvent, heideEvent} = activity;
    const weekend = weekday === 0 || weekday === 6 || holiday;
    const base = minute < 360 || minute >= 1320 ? weights.night :
      morning ? weights.morning : afternoon ? weights.afternoon :
      minute < 870 ? weights.daytime : weights.evening;
    switch (hub.kind) {
      case 'school': return weekend || schoolHoliday ? 0 : base.school;
      case 'station': return weekend ? base.station * .65 : base.station;
      case 'homes': return afternoon ? 3.2 : base.homes;
      case 'work': return morning ? (schoolHoliday ? 1.8 : 2.8) : weekend ? 0 : .35;
      case 'shops':
        if (kind !== 'road' && centrumEvent && hub.zone === 'centrum') return 6;
        return market && hub.id === 'markt' ? (kind === 'road' ? 3.1 : 6) : base.shops;
      case 'nightlife': return nightlife || centrumEvent ? 5.5 : 0;
      case 'recreation':
        if (heideEvent && hub.zone === 'ginkelse-heide') return 6;
        return recreation ? 3.5 : 0;
      default: return base[hub.kind] ?? 0;
    }
  }

  function tryBudget(urgent=false) {
    if (plans>=(urgent?3:2)) return false;
    plans++;
    return true;
  }

  function choose(kind, x, z, plan, preferred) {
    let choices=hubs.flatMap(hub=>{
      if (preferred && hub.id!==preferred) return [];
      const candidates=hub.anchors[kind];
      if (!candidates.length) return [];
      const distance=Math.sqrt(sq(x,z,candidates[0].x,candidates[0].z));
      if (!preferred && (distance<31 || distance>miles[kind])) return [];
      const weight=weightFor(hub,kind)/(1+distance*0.004);
      return weight>0 || preferred ? [{hub,weight:weight||1}] : [];
    });
    if (kind==='bike' && !preferred) {
      const nearby = parkingHubs.flatMap(hub => {
        const {x:px,z:pz}=hub.anchors.bike[0];
        const distance=Math.hypot(x-px,z-pz), weight=weightFor(hub,kind);
        return distance>=31 && distance<=miles.bike && weight>0
          ? [{hub,distance,weight:weight*.65/(1+distance*.004)}] : [];
      });
      choices.push(...nearby.sort((a,b)=>a.distance-b.distance).slice(0,4));
    }
    return pick(choices, plan);
  }

  function pick(choices, plan) {
    for (let tried=0; choices.length && tried<3; tried++) {
      let draw=random()*choices.reduce((sum,item)=>sum+item.weight,0);
      let index=choices.findIndex(item=>(draw-=item.weight)<0);
      if (index<0) index=choices.length-1;
      const [{hub}]=choices.splice(index,1);
      const route=plan(hub);
      if (route) return {...route,hub,index:0};
    }
    return null;
  }

  function remember(key, route) {
    if (cache.size>=cacheLimit) cache.delete(cache.keys().next().value);
    cache.set(key,route);
    return route;
  }

  function roadPlan(vehicle, hub, mode) {
    const anchors=hub.anchors.road.filter(a=>laneList(a.edge,mode)?.length && !roadTraffic.isClosed(a.edge));
    const key='r/'+keyFor(mode)+'/'+vehicle.edge.id+'/'+vehicle.lane+'/'+hub.id+'/'+(vehicle.turnHistory?.key??'');
    const found=cache.get(key);
    if (found && (!found.steps.length || found.steps[0].from===vehicle.edge) &&
        !roadTraffic.isClosed(found.goal.edge) && found.steps.every(s=>!roadTraffic.isClosed(s.move.to)) &&
        (found.steps.length || found.goal.at>=vehicle.s+14)) return found;
    return remember(key,findRoadTrip(network,roadTraffic,{
      edge:vehicle.edge,lane:vehicle.lane,s:vehicle.s,restriction:vehicle.turnHistory
    },anchors,mode));
  }

  function busDetour(vehicle, targets) {
    if (!tryBudget(true)) return undefined;
    const goals=targets.map(({index,leg})=>{
      const edge=leg.road;
      return {edge,lane:leg.lane,at:Math.min(leg.to,edge.len),x:edge.sx,z:edge.sz,index};
    });
    return findRoadTrip(network,roadTraffic,{
      edge:vehicle.edge,lane:vehicle.lane,s:vehicle.s,restriction:vehicle.turnHistory
    },goals,BUS,{budget:120,range:550});
  }

  function road(vehicle, previous) {
    const mode=vehicle.bodyType==='van' ? VAN : CAR;
    if (!tryBudget(Boolean(previous))) return undefined;
    const result = previous ? (()=> {
      const replanned=roadPlan(vehicle,previous.hub,mode);
      return replanned && {...replanned,hub:previous.hub,index:0};
    })() : choose('road',vehicle.x,vehicle.z,hub=>roadPlan(vehicle,hub,mode));
    if (result) stats.road[previous?'rerouted':'started']++;
    else stats.road.failed++;
    return result;
  }

  function activePlan(kind, track, dir, at, hub) {
    const spots=hub.anchors[kind], goal=new Map(spots.map(row=>[row.track,row]));
    const key=kind+'/'+id(track)+'/'+dir+'/'+hub.id;
    const onCurrentPath = (spot,direction) => (spot.at-at)*direction>3;
    const cached=cache.get(key);
    if (cached===null && !goal.has(track)) return null;
    if (cached && (cached.steps.length || onCurrentPath(cached.goal,dir))) return cached;
    const route=search({track,dir}, {
      budget: hub.parkBike ? 950 : kind === 'foot' ? 105 : 145,
      range: hub.parkBike ? 12500 : kind === 'foot' ? 620 : 850,
      identify:row=>id(row.track)+'/'+row.dir,
      target: (row,moved) => {
        const picked=goal.get(row.track);
        return picked && (moved || onCurrentPath(picked,row.dir)) ? picked:null;
      },
      remaining:row=>{
        const t=row.track, end=row.dir>0?t.len:0;
        return Math.sqrt(Math.min(...spots.map(p=>sq(t.ax+t.ux*end,t.az+t.uz*end,p.x,p.z))));
      },
      neighbors:row=>{
        const options=row.track.links?.[row.dir>0?1:0]??[];
        return options.flatMap(legs=>{
          const last=legs.at(-1);
          if (!last || !last.track.allowed?.[last.dir>0?0:1] || (hub.parkBike && !whiteBikePath(legs))) return [];
          const length=legs.reduce((sum,leg)=>sum+leg.track.len,0);
          return [{track:last.track,dir:last.dir,cost:length+1,step:{from:row.track,dir:row.dir,legs}}];
        });
      }
    });
    return remember(key,route);
  }

  function active(kind, track, dir, at, preferred) {
    if (!track?.mapped || !tryBudget()) return null;
    const x=track.ax+track.ux*at,z=track.az+track.uz*at;
    const plan=heading=>choose(kind,x,z,hub=>activePlan(kind,track,heading,at,hub),preferred);
    let route=plan(dir);
    if (!route && track.allowed?.[dir>0?1:0] && tryBudget()) {
      dir=-dir;
      route=plan(dir);
    }
    stats[kind][route?'started':'failed']++;
    if (route) route.startDir=dir;
    return route;
  }

  function parkBike(track, dir, at, returning) {
    if (!whiteBikeTrack(track) || !tryBudget()) return null;
    const x = track.ax + track.ux * at, z = track.az + track.uz * at;
    const choices = parkBikeHubs.filter(hub => Boolean(hub.entrance) === returning).flatMap(hub => {
      const anchor = hub.anchors.bike[0];
      const distance = Math.hypot(anchor.x - x, anchor.z - z);
      if (distance < 95 || (hub.id === 'white-bike-kroller-muller' && activity?.weekday === 1 && !activity.holiday)) return [];
      const lunch = activity?.minute >= 660 && activity.minute < 840 && hub.id === 'white-bike-marchantplein';
      return [{ hub, weight: (lunch ? 2.4 : 1) / (1 + distance / 1800) }];
    });
    const route = pick(choices, hub => {
      const forward = activePlan('bike', track, dir, at, hub);
      if (forward) return { ...forward, startDir: dir };
      if (!track.allowed?.[dir > 0 ? 1 : 0]) return null;
      const reverse = activePlan('bike', track, -dir, at, hub);
      return reverse && { ...reverse, startDir: -dir };
    });
    if (route) stats.bike.started++;
    return route;
  }

  function finished(kind, trip) {
    stats[kind].arrived++;
    const counts=(stats.destinations[trip.hub.id]??={road:0,bike:0,foot:0});
    counts[kind]++;
  }

  return { hubs, stats, updateClock, road, busDetour, active, parkBike, finished };
}
