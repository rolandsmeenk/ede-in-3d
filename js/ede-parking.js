import * as THREE from 'three/webgpu';
import { createParkingAccess, findParkingArrival } from './ede-parking-access.js';
import { ParkingDemand } from './ede-parking-demand.js';

const CELL=112, TILE_COUNT=32, TILE_CAPACITY=224, RADIUS=385;
const MAX_TRIPS=4;
const distanceSq=(x,z,p) => (p.x-x)**2+(p.z-z)**2;
const tileCoordinate=n => Math.floor(n/CELL);
const key=(x,z) => x+'/'+z;
const cellKey=(x,z) => key(tileCoordinate(x),tileCoordinate(z));
const EMPTY={spaces:[],arrivals:[],departures:[],areas:[],counts:{}};

async function loadAsset(path) {
  const response=await fetch(new URL(path,import.meta.url));
  if (!response.ok) throw new Error('Parking inventory HTTP '+response.status);
  if (!path.endsWith('.gz')) return response.json();
  const bytes=new Uint8Array(await response.arrayBuffer());
  const body=new Response(bytes);
  return (bytes[0]===31 && bytes[1]===139 ?
    new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body).json();
}

export async function loadEdeParking() {
  const [inventory,facilities]=await Promise.allSettled([
    loadAsset('../assets/ede-parking-spaces.json.gz'), loadAsset('../assets/ede-parking-facilities.json')
  ]);
  const baked=inventory.value, published=facilities.value;
  if (baked?.version!==1 && published?.version!==1) throw new Error('Parking inventory unavailable');
  return {...baked, facilities:published?.version===1 ? published.facilities : []};
}

function watchOccupancy(demand) {
  const url=new URL('../api/ede-parking',import.meta.url);
  let pending=false, next=0, missing=false;
  async function poll() {
    const at=Date.now();
    if (document.hidden || pending || missing || at<next) return;
    pending=true;
    next=at+60000;
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(5000),cache:'no-store'});
      if (response.status===404) missing=true;
      else if (response.ok) {
        const data=await response.json();
        if (data.version===1 && Array.isArray(data.facilities)) {
          demand.setFacilityReadings(data.facilities.map(row => ({
            facilityId:row.id, capacity:row.capacity, occupied:row.occupied, open:row.open,
            observedAt:row.timestamp*1000, expiresAt:row.expiresAt==null ? undefined : row.expiresAt*1000
          })));
        }
      }
    } catch { /* The retained facility readings expire independently. */ }
    finally { pending=false; }
  }
  setInterval(poll,15000);
  document.addEventListener('visibilitychange',poll);
  void poll();
}

function parkedTiles(parent, base, styles) {
  const group=new THREE.Group();
  group.name='Ede parked vehicles';
  parent.add(group);
  const tiles=new Map(), tilePool=[];
  for (let i=0;i<TILE_COUNT;i++) {
    const geometry=new THREE.BufferGeometry();
    geometry.setIndex(base.geometry.index);
    for (const [name, attribute] of Object.entries(base.geometry.attributes)) {
      if (name!=='paintColor' && name!=='carState') geometry.setAttribute(name,attribute);
    }
    geometry.setAttribute('paintColor',new THREE.InstancedBufferAttribute(new Float32Array(TILE_CAPACITY*3),3));
    geometry.setAttribute('carState',new THREE.InstancedBufferAttribute(new Float32Array(TILE_CAPACITY*4),4));
    const mesh=new THREE.InstancedMesh(geometry,base.material,TILE_CAPACITY);
    mesh.visible=false;
    mesh.count=0;
    mesh.castShadow=mesh.receiveShadow=true;
    mesh.userData.sharesPipelineWith=base;
    group.add(mesh);
    tilePool.push({mesh,key:null,stamp:''});
  }
  const dummy=new THREE.Object3D();
  const bins=new Map(), dirty=new Set();

  function set(state) {
    const {space,occupant}=state;
    if (space.virtual || !Number.isFinite(space.y) || !Number.isFinite(space.heading)) return;
    const bin=cellKey(space.x,space.z);
    if (occupant && state.status==='occupied') {
      if (!bins.has(bin)) bins.set(bin,new Map());
      bins.get(bin).set(space.id,state);
    } else {
      bins.get(bin)?.delete(space.id);
    }
    dirty.add(bin);
  }
  function apply(states) {
    bins.clear();
    for (const state of states) if (state.occupant) set(state);
    for (const id of tiles.keys()) dirty.add(id);
  }
  function forNearby(x,z,radius,visit) {
    for (let a=tileCoordinate(x-radius);a<=tileCoordinate(x+radius);a++) {
      for (let b=tileCoordinate(z-radius);b<=tileCoordinate(z+radius);b++) {
        for (const state of bins.get(key(a,b))?.values() ?? []) {
          if (distanceSq(x,z,state.space)<radius*radius) visit(state);
        }
      }
    }
  }
  function update(x,z,refreshView) {
    if (refreshView) {
      const local=[];
      for (const [id,states] of bins) {
        if (!states.size) continue;
        const [a,b]=id.split('/').map(Number);
        local.push({id, distance:distanceSq(x,z,{x:(a+.5)*CELL,z:(b+.5)*CELL})});
      }
      local.sort((a,b) => a.distance-b.distance);
      const active=new Set(local.slice(0,TILE_COUNT).map(row=>row.id));
      for (const [id,tile] of tiles) {
        if (active.has(id)) continue;
        tile.mesh.visible=false;
        tile.key=null;
        tiles.delete(id);
      }
      for (const id of active) {
        if (tiles.has(id)) continue;
        const tile=tilePool.find(row=>row.key===null);
        tile.key=id;
        tile.stamp='';
        tiles.set(id,tile);
        dirty.add(id);
      }
    }
    for (const id of dirty) {
      const tile=tiles.get(id);
      if (!tile) continue;
      const rows=[...(bins.get(id)?.values() ?? [])].slice(0,TILE_CAPACITY).sort((a,b)=>a.space.id.localeCompare(b.space.id));
      const stamp=rows.map(({space,occupant})=>space.id+'/'+occupant.appearanceSeed).join(',');
      if (stamp===tile.stamp) continue;
      tile.stamp=stamp;
      const {mesh}=tile;
      const {paintColor,carState}=mesh.geometry.attributes;
      for (let i=0;i<rows.length;i++) {
        const {space,occupant}=rows[i];
        const style=styles[(occupant.appearanceSeed>>>0)%styles.length];
        dummy.position.set(space.x,space.y,space.z);
        dummy.rotation.set(0,space.heading,0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i,dummy.matrix);
        paintColor.setXYZ(i,style.col.r,style.col.g,style.col.b);
        carState.setXYZW(i,0,0,0,style.style);
      }
      mesh.count=rows.length;
      mesh.visible=rows.length>0;
      if (mesh.visible) {
        mesh.computeBoundingSphere();
        mesh.instanceMatrix.needsUpdate=paintColor.needsUpdate=carState.needsUpdate=true;
      }
    }
    dirty.clear();
  }
  return {group,apply,set,update,forNearby,
    count:()=>tilePool.reduce((total,tile)=>total+(tile.mesh.visible?tile.mesh.count:0),0)};
}

export function createEdeParking(parent,base,styles,network,data,closed) {
  const demand=new ParkingDemand(data);
  const access=createParkingAccess(network,data.aisles);
  const tiles=parkedTiles(parent,base,styles);
  const active=new Set(), counters=new Map(), linksByEdge=new Map(), cooling=new Map();
  let x=Infinity,z=Infinity, next=0, snapshot=EMPTY, now=0, needsSync=true;
  let enabled=new URLSearchParams(window.location.search).get('parking')!=='off';
  let nextArrival=0, nextDeparture=0, departures=[];
  const unavailable=new Set();
  watchOccupancy(demand);

  function record(trip) {
    if (!counters.has(trip.token.areaId)) counters.set(trip.token.areaId,{arrivals:0,departures:0});
    counters.get(trip.token.areaId)[trip.token.kind==='arrival'?'arrivals':'departures']++;
  }
  function changed(space,at) {
    const state=demand.getSpaceState(space.id,at);
    if (state) tiles.set(state);
  }
  function spotBusy(item, kind) {
    for (const vehicle of active) {
      const trip=vehicle.parkingTrip;
      if (!trip || item.space.areaId!==trip.token.areaId) continue;
      if (item.space.virtual) {
        if (item.link===trip.link && trip.token.kind===kind) return true;
      } else if (item.link===trip.link || distanceSq(item.space.x,item.space.z,trip.token.space)<24) return true;
    }
    return false;
  }
  function tick(fx,fz,clock,jump=false) {
    if (!enabled) return;
    if (jump || needsSync || clock>=next || Math.hypot(fx-x,fz-z)>72) {
      needsSync=false;
      now=Date.now();
      x=fx; z=fz; next=clock+12;
      for (const [id,until] of cooling) if (until<=clock) cooling.delete(id);
      snapshot=demand.refresh({x,z,radius:RADIUS,now,limit:72,
        canManeuver:(space)=>Boolean(access.link(space))});
      linksByEdge.clear();
      unavailable.clear();
      for (const area of snapshot.areas) {
        if (area.open===false || (area.reading && area.reading.occupied>=area.reading.capacity)) unavailable.add(area.id);
      }
      for (const candidate of snapshot.arrivals) {
        const link=access.link(candidate.space);
        if (!link) continue;
        const host=link.entrance.edge;
        if (!linksByEdge.has(host)) linksByEdge.set(host,[]);
        linksByEdge.get(host).push({...candidate,link});
      }
      departures=snapshot.departures.flatMap(candidate => {
        const link=access.link(candidate.space);
        return link ? [{...candidate,link}] : [];
      });
      tiles.apply(snapshot.spaces);
      tiles.update(x,z,true);
    } else {
      tiles.update(x,z,false);
    }
  }
  function cancel(v,clock=0) {
    const trip=v.parkingTrip;
    if (!trip) return;
    if (trip.token.kind==='arrival') demand.cancelArrival(trip.token);
    else demand.cancelDeparture(trip.token);
    active.delete(v);
    v.parkingTrip=null;
    if (clock) cooling.set(trip.token.space.id,clock+35);
    needsSync=true;
    changed(trip.token.space,Date.now());
  }
  function finish(v) {
    const trip=v.parkingTrip;
    if (!trip) return;
    const at=Date.now();
    const result=trip.token.kind==='arrival' ? demand.finishArrival(trip.token,at,v.parkingStyle) : demand.finishDeparture(trip.token,at);
    if (result) record(trip);
    changed(trip.token.space,at);
    active.delete(v);
    v.parkingTrip=null;
    needsSync=true;
  }
  function routeArrival(v,clock,allowedArea) {
    if (!enabled || !linksByEdge.size || clock<nextArrival || active.size>=MAX_TRIPS ||
        v.bodyType!=='sedan' || v.isPolice || v.parkingStyle==null || v.parkingTrip) return false;
    nextArrival=clock+0.9;
    const at=Date.now();
    const picked=findParkingArrival(v,linksByEdge,{
      available:item=>!cooling.has(item.space.id) && !spotBusy(item,'arrival') &&
        demand.getSpaceState(item.space.id,at)?.status==='vacant',
      closed, allowedArea, turn:network.turnRestrictionState
    });
    if (!picked) return false;
    const {item,route}=picked;
    const token=demand.reserveArrival(item.space.id,at,v.parkingStyle);
    if (!token) return false;
    v.parkingTrip={token,link:item.link,route,step:0,phase:'approach',expires:clock+85};
    active.add(v);
    return true;
  }
  function selectDeparture(v,clock,clear) {
    if (!enabled || clock<nextDeparture || active.size>=MAX_TRIPS || v.bodyType!=='sedan' ||
        v.isPolice || v.parkingStyle==null) return null;
    nextDeparture=clock+2;
    const at=Date.now();
    let tested=0;
    for (const item of departures) {
      if (distanceSq(x,z,item.space)>260**2 || spotBusy(item,'departure') || cooling.has(item.space.id) || closed?.(item.link.exit.edge)) continue;
      if (++tested>8) break;
      if (!clear(item.link.exit,item.space)) continue;
      const token=demand.beginDeparture(item.space.id,at);
      if (!token) continue;
      changed(token.space,at);
      active.add(v);
      return {token,link:item.link,phase:'maneuver',distance:0,blockedAt:0,expires:clock+65};
    }
    return null;
  }
  return {
    group:tiles.group,demand,access,tick,routeArrival,selectDeparture,cancel,finish,
    flush() { if (enabled) tiles.update(x,z,false); },
    accepts(trip) { return !unavailable.has(trip.token.areaId); },
    forParked(x,z,r,visit) { if (enabled) tiles.forNearby(x,z,r,visit); },
    appearance(seed) { return styles[(seed>>>0)%styles.length]; },
    setEnabled(value) {
      enabled=Boolean(value);
      tiles.group.visible=enabled;
      if (enabled) needsSync=true;
      else for (const v of active) cancel(v);
    },
    get enabled() { return enabled; },
    get snapshot() { return snapshot; },
    summary() {
      return {enabled,now,rendered:tiles.count(),maneuvers:active.size,counts:snapshot.counts,
        areas:snapshot.areas.map(area => ({...area,arrivals:0,departures:0,...counters.get(area.id)}))};
    }
  };
}
