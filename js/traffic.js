import * as THREE from 'three/webgpu';
import { buildRoadNetwork, roadEdgeKey } from './road-network.js';
import { bindEdeFittedLanes, fittedLanePoint, projectFittedLane } from './ede-lane-geometry.js';
import { indexLocalRoads, localSegmentLength, pickByArea } from './traffic-area.js';
import { busEntryAt, busRouteDistance, busTrackingSpeed, createEdeBusTracker, prepareEdeBusPaths } from './ede-bus-traffic.js';
import { terrainHeightAt } from './terrain.js';
import { createEdeParking } from './ede-parking.js';
import { parkingPose } from './ede-parking-access.js';
import { createEdeTrips } from './ede-trips.js';
import { createEdeDrivingControls } from './ede-driving-controls.js';
import { CAR, VAN, BUS, BICYCLE } from './road-access.js';
import { getEdeGrade, gradeHeightAt, gradeWayAt } from './ede-grade.js';
import { createPedestrianSystem } from './pedestrian-system.js';
import { vehicleContact, resolveVehicleContact, sweptVehicleContact } from './vehicle-physics.js';
import { signalPhase, walkSignal } from './city-config.js';
import { cityUniforms, createContactShadowMaterial, createCarFlareMaterial } from './tsl-materials.js';
import { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } from './vehicle-lights.js';
import {
  BODY_SPECS,
  buildCarGeometry,
  buildCarProxyGeometry,
  buildSteerableWheelGeo,
  createCarWheelMaterial,
  createLoftedCarMaterial,
  carStyleCode,
  buildLightbarGeometry,
  createLightbarMaterial
} from './cars.js';
import {
  BUS_SPEC,
  buildLoftedBusBodyGeometry,
  buildBusSignGeometry,
  buildBusWheelGeo,
  createBusWheelMaterial,
  createLoftedBusMaterial
} from './bus.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Cars and buses follow the road graph, obey signals, yield at crossings and react to collisions.
// Vehicles replenish around the player; pedestrian-system.js manages the nearby walking population.

const NUM_CARS = 112;
const NUM_BUSES = 24;
const NUM_BIKES = 96;

// Intelligent Driver Model: max acceleration, comfortable braking, time headway, standstill gap; the sideways
// acceleration drivers accept in bends, which sets how fast they take each turn or lane shift; and how hard they brake
// in an emergency. At the wheel (see steer): the sideways acceleration the tyres grip up to, how far the front wheels
// turn (radians), and how fast the driver turns them at speed (rad/s, ~250°/s at the steering wheel; up to three times
// as fast at walking pace, 2.5 times as fast in a panic).
const CAR_DRIVER = { a: 2.0, b: 3.0, T: 1.2, s0: 2.0, aLat: 3.5, bMax: 8, grip: 8, lock: 0.6, steerRate: 0.3 };
const BUS_DRIVER = { a: 1.1, b: 2.5, T: 1.5, s0: 2.5, aLat: 2.0, bMax: 6, grip: 5, lock: 0.9, steerRate: 0.3 };
const LOOKAHEAD = 70; // metres a driver looks ahead for vehicles, stop lines and signals
// Dodging the player (see react): seconds before the player would hit it that a driver notices, and the least it keeps
// up its manoeuvre once it reacts
const AVOID_NOTICE = 1.8;
const AVOID_HOLD = 1.2;

// Car body kinds (BODY_SPECS keys) in street & highway traffic: half-length for spacing, half-width & axle for the
// path, collision half-length & mass, and the engine voice (audio-sources.js)
const CAR_KINDS = {
  taxi: { half: 2.25, halfWidth: 0.86, axle: 1.38, halfL: 2.18, mass: 1600, engine: 'sedan' },
  sedan: { half: 2.25, halfWidth: 0.86, axle: 1.38, halfL: 2.18, mass: 1600, engine: 'sedan' },
  suv: { half: 2.3, halfWidth: 0.92, axle: 1.4, halfL: 2.22, mass: 2100, engine: 'suv' },
  minivan: { half: 2.6, halfWidth: 0.92, axle: 1.52, halfL: 2.52, mass: 2000, engine: 'sedan' },
  pickup: { half: 2.86, halfWidth: 0.96, axle: 1.92, halfL: 2.78, mass: 2400, engine: 'suv' },
  van: { half: 2.96, halfWidth: 0.95, axle: 1.8, halfL: 2.88, mass: 2700, engine: 'suv' }
};

// Retire distant actors even when looking their way: keeping them indefinitely starves upcoming streets.
// Replacements may enter the far view, but nearby visible roads and sidewalks are protected from pop-in.
const VEHICLE_RADIUS = 380;
const NEAR_RADIUS = 350;
const VEHICLE_SPAWN_DISTANCE = 250;

function createBusDestinationTexture(routes) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64 * 2 ** Math.ceil(Math.log2(Math.max(routes.length, 1)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, c.width, c.height);
  routes.forEach(({ line, headsign }, idx) => {
    const y0 = idx * 64;
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(6, y0 + 8, 500, 48);
    ctx.fillStyle = '#3d3217';
    ctx.fillRect(12, y0 + 11, 126, 42);
    ctx.fillStyle = '#ffc65b';
    ctx.font = '900 32px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(line, 75, y0 + 33);
    ctx.font = '800 28px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(headsign, 152, y0 + 33, 345);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function createTrafficSystem(scene, sidewalks, obstacles, signalIntersections, busSchedule, roadTraffic, parkingData, pilot = {}) {
  const group = new THREE.Group();
  group.name = 'ManhattanTrafficAndPedestrians';
  let collisionListener = null;
  const collisionEvent = { a: null, b: null, kind: 'vehicle', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };

  function setCollisionListener(listener) {
    collisionListener = typeof listener === 'function' ? listener : null;
  }

  // Synchronous notification: listeners must copy any fields they retain. Normal points from b toward a.
  function reportCollision(a, b, x, y, z, nx, nz, speed) {
    if (!collisionListener || speed <= 0.5) return;
    collisionEvent.a = a; collisionEvent.b = b;
    collisionEvent.x = x; collisionEvent.y = y; collisionEvent.z = z;
    collisionEvent.nx = nx; collisionEvent.nz = nz; collisionEvent.speed = speed;
    collisionListener(collisionEvent);
  }

  const dummy = new THREE.Object3D();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  unitPlane.rotateX(-Math.PI * 0.5);
  const contactShadowMat = createContactShadowMaterial();

  // =========================================================================
  // 0. ROAD NETWORK
  // =========================================================================
  const network = buildRoadNetwork(sidewalks, obstacles, signalIntersections, getEdeGrade());
  const fitted = bindEdeFittedLanes(network, pilot.laneFits, edge => `${roadEdgeKey(edge)}|${edge.wayId}|${edge.layer ?? 0}`);
  const { nodes, edges, connector, curvePoint } = network;
  const trips=pilot.enabled ? createEdeTrips(network,roadTraffic) : null;
  const recentlyUsedRoads=trips && new WeakMap();
  const controls=pilot.enabled ? createEdeDrivingControls(pilot.streetFeatures,network) : null;
  const railStop=pilot.railStop;
  const roadMode=v=>v.bus?BUS:v.bodyType==='van'?VAN:CAR;
  roadTraffic.bind(edges, edge => `${roadEdgeKey(edge)}|${edge.wayId}|${edge.layer}`);
  const busPaths = prepareEdeBusPaths(busSchedule, edges, network.alternateBusMove);

  // Sides of an intersection (road-network.js step 9): a grid intersection's are 0 east, 1 west, 2 south, 3 north;
  // centreline junctions number their arms from 4. Where lane i of edge e meets a crosswalk, measured along the
  // crosswalk: along its road's lateral axis (x across north-south roads, z across east-west ones)
  const fittedA = {}, fittedB = {};
  const laneCoord = (edge, lane, atEnd = false) => {
    if (!edge.fittedLanes?.[lane]) return (edge.sx + edge.rx * edge.lanes[lane]) * edge.clx
      + (edge.sz + edge.rz * edge.lanes[lane]) * edge.clz;
    const p = fittedLanePoint(edge, lane, atEnd ? edge.len : 0, fittedA);
    return p.x * edge.clx + p.z * edge.clz;
  };
  function laneDelta(edge, from, to, station) {
    if (!edge.fittedLanes) return edge.lanes[to] - edge.lanes[from];
    const a = fittedLanePoint(edge, from, station, fittedA), b = fittedLanePoint(edge, to, station, fittedB);
    return (b.z - a.z) * a.dx - (b.x - a.x) * a.dz;
  }

  for (const n of nodes) {
    n.box = new Array(n.groupCount).fill(0); // vehicles crossing it from each road (group: on the grid avenue 0, street 1)
    n.crossing = new Array(n.sideCount).fill(0); // vehicles crossing (or about to cross) the crosswalk on each side
    n.approach = new Array(n.sideCount).fill(null); // the edge arriving over each side's crosswalk
    n.road = new Array(n.sideCount).fill(null); // an edge arriving or leaving over each side's crosswalk: the road it spans
  }
  for (const e of edges) {
    e.occ = e.lanes.map(() => []); // vehicles in each lane, sorted by position
    // e.inSide / e.outSide: the crosswalks crossed on the way into e.to / out of e.from; e.axisIndex: its group at e.to;
    // e.opposite: the oncoming edge of its road there (road-network.js)
    e.to.approach[e.inSide] = e;
    e.to.road[e.inSide] = e.from.road[e.outSide] = e;
    e.through = 0; // vehicles from e crossing e.to straight on or to the right
    e.lefts = 0; // and to the left
  }
  // Is the intersection box held by vehicles of any road but group g's?
  const boxBusy = (n, g) => {
    for (let k = 0; k < n.box.length; k++) if (k !== g && n.box[k] > 0) return true;
    return false;
  };

  // =========================================================================
  // 1. 3D LOFTED NYC YELLOW TAXIS, SEDANS, SUVS & NYPD CRUISERS (200 VEHICLES)
  // =========================================================================
  function createVehicle(bus, half, halfWidth, axle, driver, v0) {
    return {
      bus, half, halfWidth, axle, driver, v0,
      edge: null, lane: 0, s: 0, speed: 0, acc: 0, gap: Infinity, leaderSpeed: 0,
      move: null, out: 0, conn: null, cs: 0, trail: null, commit: null, claimed: false, yielding: false, yieldAt: 0,
      wait: 0, laneTimer: Math.random() * 0.5,
      dl: 0, dlv: 0, blink: 0, blinkPhase: Math.random() * 0.8,
      evade: 0, alarm: 0, panicUntil: 0, panicAcc: 0, reaction: 0.6 + Math.random() * 0.4,
      x: 0, y: 0, z: 0, prevX: 0, prevZ: 0, tx: 0, tz: 1, nose: 0, yaw: 0, yawRate: 0, steer: 0, delta: 0,
      pitch: 0, roll: 0, pitchVel: 0, rollVel: 0, vx: 0, vz: 0, yawOffset: 0, yawVel: 0, impactTime: 0,
      pAhead: Infinity, pRight: 0, pSpeed: 0, wheelSpin: Math.random() * Math.PI * 2
    };
  }

  // Every body kind shares one 3D wheel model, instanced separately and scaled to the kind's wheel radius
  const carWheelLeftGeo = buildSteerableWheelGeo(BODY_SPECS.sedan, -1);
  const carWheelRightGeo = buildSteerableWheelGeo(BODY_SPECS.sedan, 1);
  const carWheelStyles = new THREE.InstancedBufferAttribute(new Float32Array(NUM_CARS * 2), 1);
  carWheelLeftGeo.setAttribute('wheelStyle', carWheelStyles);
  carWheelRightGeo.setAttribute('wheelStyle', carWheelStyles);
  const carWheelMat = createCarWheelMaterial({ instanced: true });

  const taxiYellow = new THREE.Color(0xffbe14);
  const boroGreen = new THREE.Color(0x5cae3e);
  const policeWhite = new THREE.Color(0xf6f9fc);
  // NYC street fleet palettes: white/black/grey/silver dominate with TLC black cars, blue/red/green accents,
  // metallic vs solid clearcoat, chrome/blackout trim & multi-spoke wheel styles encoded in carState.w.
  const fleetStyles = {
    sedan: [
      { col: new THREE.Color(0x12151a), style: carStyleCode({ livery: 3, metallic: 0, trim: 1, wheel: 1 }) }, // TLC / Uber Black Car
      { col: new THREE.Color(0x161a20), style: carStyleCode({ livery: 3, metallic: 1, trim: 2, wheel: 2 }) }, // TLC Obsidian Blackout
      { col: new THREE.Color(0xf2f4f7), style: carStyleCode({ livery: 0, metallic: 0, trim: 0, wheel: 0 }) }, // Alpine White Sedan
      { col: new THREE.Color(0xe6eaef), style: carStyleCode({ livery: 4, metallic: 1, trim: 2, wheel: 2 }) }, // Pearl White Sport (black roof)
      { col: new THREE.Color(0xc8d0d8), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }, // Liquid Silver Metallic
      { col: new THREE.Color(0x9aa2ac), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 1 }) }, // Tungsten Silver Metallic
      { col: new THREE.Color(0x52575e), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 2 }) }, // Graphite Grey Metallic
      { col: new THREE.Color(0x363b42), style: carStyleCode({ livery: 0, metallic: 1, trim: 2, wheel: 3 }) }, // Charcoal Dark Grey
      { col: new THREE.Color(0x1c2026), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }, // Jet Black Metallic
      { col: new THREE.Color(0x1d3b6c), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) }, // Deep Navy Metallic
      { col: new THREE.Color(0x285086), style: carStyleCode({ livery: 4, metallic: 1, trim: 2, wheel: 2 }) }, // Atlantic Blue Sport (black roof)
      { col: new THREE.Color(0x741d22), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }  // Crimson Red Metallic
    ],
    suv: [
      { col: new THREE.Color(0x101318), style: carStyleCode({ livery: 3, metallic: 0, trim: 1, wheel: 1 }) }, // Executive Black Escalade / Suburban TLC
      { col: new THREE.Color(0x171b22), style: carStyleCode({ livery: 3, metallic: 1, trim: 2, wheel: 3 }) }, // Uber Black SUV (blackout)
      { col: new THREE.Color(0xf0f3f7), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }, // Pearl White Luxury SUV
      { col: new THREE.Color(0xe4e8ed), style: carStyleCode({ livery: 4, metallic: 0, trim: 2, wheel: 2 }) }, // Glacier White SUV (black roof)
      { col: new THREE.Color(0x3a434d), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 2 }) }, // Slate Grey Metallic SUV
      { col: new THREE.Color(0x5c636b), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) }, // Gunmetal Grey SUV
      { col: new THREE.Color(0xbec6cf), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }, // Silver Metallic Crossover
      { col: new THREE.Color(0x181c22), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 3 }) }, // Onyx Black SUV
      { col: new THREE.Color(0x20385c), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) }, // Midnight Blue SUV
      { col: new THREE.Color(0x28382e), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 0 }) }, // Forest Green Metallic SUV
      { col: new THREE.Color(0x682024), style: carStyleCode({ livery: 4, metallic: 1, trim: 2, wheel: 2 }) }, // Burgundy Crossover (black roof)
      { col: new THREE.Color(0x787670), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) }  // Urban Putty Grey Crossover
    ],
    // Minivans: family colours plus TLC / Uber XL black
    minivan: [
      { col: new THREE.Color(0x111419), style: carStyleCode({ livery: 3, metallic: 1, trim: 1, wheel: 1 }) }, // TLC / Uber XL Black
      { col: new THREE.Color(0xf0f2f5), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }, // Blizzard Pearl
      { col: new THREE.Color(0xaab2bb), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 1 }) }, // Celestial Silver
      { col: new THREE.Color(0x4a5058), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 2 }) }, // Modern Steel Grey
      { col: new THREE.Color(0x1a1d22), style: carStyleCode({ livery: 0, metallic: 1, trim: 2, wheel: 3 }) }, // Midnight Black
      { col: new THREE.Color(0x26354f), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }, // Obsidian Blue
      { col: new THREE.Color(0xe9ecef), style: carStyleCode({ livery: 0, metallic: 0, trim: 0, wheel: 1 }) }, // Super White
      { col: new THREE.Color(0x5a1f24), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }  // Velvet Red
    ],
    // Pickups: black, white & silver with chrome or blackout grilles
    pickup: [
      { col: new THREE.Color(0x14171b), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) }, // Agate Black (chrome)
      { col: new THREE.Color(0xf2f3f5), style: carStyleCode({ livery: 0, metallic: 0, trim: 1, wheel: 0 }) }, // Oxford White (chrome)
      { col: new THREE.Color(0x9da4ab), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 2 }) }, // Iconic Silver
      { col: new THREE.Color(0x3d434a), style: carStyleCode({ livery: 0, metallic: 1, trim: 2, wheel: 3 }) }, // Carbonized Grey (blackout)
      { col: new THREE.Color(0x1e2f4f), style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) }, // Antimatter Blue
      { col: new THREE.Color(0x8f1a1d), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) }, // Race Red (blackout)
      { col: new THREE.Color(0xf2f3f5), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) }, // Oxford White (blackout)
      { col: new THREE.Color(0x2c3a30), style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 0 }) }  // Forest Green
    ],
    // Delivery vans: mostly fleet white, black plastic trim; never two-tone, whose black roof would cover the van's
    // cargo box (part of its glasshouse loft)
    van: [
      { col: new THREE.Color(0xf4f5f6), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 0 }) }, // Fleet White
      { col: new THREE.Color(0xeef0f2), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) }, // Arctic White (dark wheels)
      { col: new THREE.Color(0xb9c0c7), style: carStyleCode({ livery: 0, metallic: 1, trim: 2, wheel: 0 }) }, // Brilliant Silver
      { col: new THREE.Color(0xf4f5f6), style: carStyleCode({ livery: 0, metallic: 0, trim: 0, wheel: 1 }) }, // Fleet White
      { col: new THREE.Color(0x8e959c), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) }, // Pebble Grey
      { col: new THREE.Color(0xf0f1f2), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) }, // Fleet White (dark wheels)
      { col: new THREE.Color(0x15181c), style: carStyleCode({ livery: 0, metallic: 1, trim: 2, wheel: 3 }) }, // Obsidian Black
      { col: new THREE.Color(0xf4f5f6), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 0 }) }, // Fleet White
      { col: new THREE.Color(0x1f3354), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 0 }) }, // Navy Blue
      { col: new THREE.Color(0xf4f5f6), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 1 }) }, // Fleet White
      { col: new THREE.Color(0x9b1c1f), style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 0 }) }  // Flame Red
    ]
  };
  // Of every 20 cars: 4 yellow cabs, 5 sedans, 6 SUVs, 2 delivery vans, 2 minivans & a pickup. NYPD cruisers are sedans
  // or Interceptor SUVs, green Boro cabs sedans or SUVs.
  const FLEET_MIX = ['taxi', 'sedan', 'van', 'sedan', 'suv', 'taxi', 'suv', 'minivan', 'suv', 'pickup',
    'taxi', 'sedan', 'suv', 'van', 'suv', 'taxi', 'minivan', 'sedan', 'suv', 'sedan'];

  const cars = [];
  const counts = Object.fromEntries(Object.keys(CAR_KINDS).map((kind) => [kind, 0]));
  const policeCounts = { sedan: 0, suv: 0 };

  for (let i = 0; i < NUM_CARS; i++) {
    const isPolice = (i % 50) === 6 || (i % 100) === 56;
    const isBoroTaxi = !isPolice && (i % 25) === 3;
    let bodyType = FLEET_MIX[i % FLEET_MIX.length];
    if (isPolice) bodyType = (i % 100) === 56 ? 'suv' : 'sedan';
    else if (isBoroTaxi) bodyType = i % 2 === 0 ? 'suv' : 'sedan';

    let col;
    let style;
    if (bodyType === 'taxi') {
      col = taxiYellow;
      style = carStyleCode({ livery: 0, metallic: 0, trim: 0, wheel: i % 2 });
    } else if (isPolice) {
      col = policeWhite;
      style = carStyleCode({ livery: 1, metallic: 0, trim: 2, wheel: 3 });
      policeCounts[bodyType]++;
    } else if (isBoroTaxi) {
      col = boroGreen;
      style = carStyleCode({ livery: 2, metallic: 0, trim: 0, wheel: 0 });
    } else {
      const palette = fleetStyles[bodyType];
      ({ col, style } = palette[counts[bodyType] % palette.length]);
    }
    counts[bodyType]++;

    const kind = CAR_KINDS[bodyType];
    const car = createVehicle(false, kind.half, kind.halfWidth, kind.axle, CAR_DRIVER, 10 + (i % 5) * 0.9);
    // paint as float32 values, so renderCar() can tell whether an instance slot's paint changes by comparing
    const paint = [Math.fround(col.r), Math.fround(col.g), Math.fround(col.b)];
    const parkingStyle = bodyType==='sedan' && !isPolice && !isBoroTaxi
      ? fleetStyles.sedan.findIndex(entry=>entry.col===col && entry.style===style) : null;
    Object.assign(car, { isPolice, bodyType, paint, style, halfL: kind.halfL, mass: kind.mass, engine: kind.engine,
      parkingStyle: parkingStyle>=0 && parkingStyle!==null ? parkingStyle : null, parkingTrip:null });
    cars.push(car);
  }

  // Per body kind: the full model (with separately instanced spinning wheels near the camera) and, beyond
  // CAR_PROXY_DISTANCE, the ~250-triangle stand-in, plus the contact shadow's footprint (width, length, centre z).
  // Instance slots are handed out every frame to the cars the camera can see (or whose shadow it may see), see
  // renderCar(). Per-instance paint & lamp / livery state the car material reads: brake lights, left (+x) & right (-x)
  // turn signals, livery (1 = NYPD).
  const bodies = {};
  for (const kind of Object.keys(CAR_KINDS)) {
    const spec = BODY_SPECS[kind];
    const n = Math.max(1, counts[kind]);
    const mat = createLoftedCarMaterial(spec);
    const lodMesh = (g) => {
      g.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      return new THREE.InstancedMesh(g, mat, n);
    };
    const halfWidth = Math.max(...spec.halfWidth.map((p) => p[1])) + spec.archFlare;
    bodies[kind] = {
      near: lodMesh(buildCarGeometry(spec, false)),
      far: lodMesh(buildCarProxyGeometry(spec)),
      shadow: [2 * halfWidth + 0.33, spec.zFront - spec.zRear + 0.55, (spec.zFront + spec.zRear) / 2]
    };
  }
  const bodyMeshes = Object.values(bodies).flatMap((b) => [b.near, b.far]);
  let parking;
  if (parkingData) {
    try {
      parking=createEdeParking(group,bodies.sedan.far,fleetStyles.sedan,network,parkingData,edge=>roadTraffic.isClosed(edge));
    } catch (error) {
      console.warn('[parking] simulation unavailable:',error);
    }
  }

  const carWheelLeftInst = new THREE.InstancedMesh(carWheelLeftGeo, carWheelMat, NUM_CARS * 2);
  const carWheelRightInst = new THREE.InstancedMesh(carWheelRightGeo, carWheelMat, NUM_CARS * 2);
  carWheelRightInst.userData.sharesPipelineWith = carWheelLeftInst;

  // 3D Collision Spark & Debris Particle Pool
  const MAX_SPARKS = 120;
  const sparkGeo = new THREE.BoxGeometry(0.038, 0.038, 0.26);
  const sparkMat = new THREE.MeshBasicNodeMaterial({ color: 0xffc438 });
  const sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
  const sparks = [];
  let sparkCursor = 0;
  for (let s = 0; s < MAX_SPARKS; s++) {
    sparks.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.4 });
  }
  function spawnCollisionSparks(x, y, z, nx, nz, impactSpeed) {
    const count = Math.min(24, Math.max(8, Math.floor(impactSpeed * 1.4)));
    const tx = -nz;
    const tz = nx;
    for (let k = 0; k < count; k++) {
      const sp = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
      const spread = (Math.random() - 0.5) * 2.2;
      const outBoost = (0.3 + Math.random() * 0.9) * Math.min(14.0, impactSpeed * 0.65);
      const tanBoost = spread * Math.min(12.0, impactSpeed * 0.55);
      sp.x = x + (Math.random() - 0.5) * 0.35;
      sp.y = y + (Math.random() - 0.5) * 0.18;
      sp.z = z + (Math.random() - 0.5) * 0.35;
      sp.vx = nx * outBoost + tx * tanBoost;
      sp.vy = 2.4 + Math.random() * 5.4;
      sp.vz = nz * outBoost + tz * tanBoost;
      sp.maxLife = 0.28 + Math.random() * 0.24;
      sp.life = sp.maxLife;
    }
  }

  // NYPD roof light bars per police-capable body kind (sedan & Interceptor SUV have different roof heights)
  const lightbarMat = createLightbarMaterial();
  const policeLightbars = {
    sedan: new THREE.InstancedMesh(buildLightbarGeometry(BODY_SPECS.sedan), lightbarMat, Math.max(1, policeCounts.sedan)),
    suv: new THREE.InstancedMesh(buildLightbarGeometry(BODY_SPECS.suv), lightbarMat, Math.max(1, policeCounts.suv))
  };
  const policeLightbarMeshes = [policeLightbars.sedan, policeLightbars.suv];
  const carShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_CARS);
  carShadowInst.renderOrder = 998;

  for (const m of bodyMeshes) m.castShadow = m.receiveShadow = true;
  for (const m of policeLightbarMeshes) m.castShadow = true;
  carWheelLeftInst.castShadow = carWheelLeftInst.receiveShadow = true;
  carWheelRightInst.castShadow = carWheelRightInst.receiveShadow = true;

  group.add(
    ...bodyMeshes,
    carWheelLeftInst,
    carWheelRightInst,
    sparkInst,
    ...policeLightbarMeshes
  );

  // =========================================================================
  // 2. CITY BUSES
  // =========================================================================
  const busBodyGeo = buildLoftedBusBodyGeometry();
  // Lamps/livery and destination atlas index use separate instance attributes.
  const busStates = new THREE.InstancedBufferAttribute(new Float32Array(NUM_BUSES * 4), 4);
  busBodyGeo.setAttribute('busState', busStates);
  // Destination signs above the windshield, by the front door & on the upper-right rear cap
  const busHeaderGeo = buildBusSignGeometry();
  const busSigns = new THREE.InstancedBufferAttribute(new Float32Array(NUM_BUSES), 1);
  busHeaderGeo.setAttribute('busSign', busSigns);

  const busBodyMat = createLoftedBusMaterial();
  const signRows = new Map();
  const signVariants = new Map();
  const destinations = [];
  for (const variant of busSchedule?.variants || []) {
    const label = `${variant.line} ${variant.headsign}`;
    if (!signRows.has(label)) {
      signRows.set(label, destinations.length);
      destinations.push(variant);
    }
    signVariants.set(variant.id, signRows.get(label));
  }
  const busDestTex = createBusDestinationTexture(destinations);
  const busDestMat = new THREE.MeshBasicNodeMaterial();
  {
    const { attribute, float, texture, uv, varying, vec2, vertexStage } = THREE.TSL;
    const vRow = varying(vertexStage(attribute('busSign', 'float')));
    const signUV = vec2(uv().x, float(1).sub(vRow.add(0.88).sub(uv().y.mul(0.75)).mul(64 / busDestTex.image.height)));
    busDestMat.colorNode = texture(busDestTex, signUV).rgb.mul(1.25);
  }

  const busWheelMat = createBusWheelMaterial();
  const busBodyInst = new THREE.InstancedMesh(busBodyGeo, busBodyMat, NUM_BUSES);
  const busHeaderInst = new THREE.InstancedMesh(busHeaderGeo, busDestMat, NUM_BUSES);
  const busWheelLeftInst = new THREE.InstancedMesh(buildBusWheelGeo(-1), busWheelMat, NUM_BUSES * 2);
  const busWheelRightInst = new THREE.InstancedMesh(buildBusWheelGeo(1), busWheelMat, NUM_BUSES * 2);
  const busShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_BUSES);
  busShadowInst.renderOrder = 998;

  busBodyInst.castShadow = busBodyInst.receiveShadow = true;
  busWheelLeftInst.castShadow = busWheelLeftInst.receiveShadow = true;
  busWheelRightInst.castShadow = busWheelRightInst.receiveShadow = true;

  const buses = [];
  for (let i = 0; i < NUM_BUSES && busPaths.size > 0; i++) {
    const b = createVehicle(true, 6.1, 1.3, 3.6, BUS_DRIVER, 11.1);
    Object.assign(b, { halfL: 5.72, mass: 12000, busRun: null });
    buses.push(b);
  }
  busBodyInst.name = 'EdeRouteBuses';
  busHeaderInst.name = 'EdeBusDestinations';
  group.add(busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst);

  // Bicycles: upright Dutch bikes following the mapped cycle network. The bike frame and
  // the rider's clothes are tinted per instance (their vertex colour is white), the wheels, legs and head are not.
  const BIKE_DRIVER = { a: 1.0, b: 2.0, T: 1.0, s0: 1.5, aLat: 2.0, bMax: 5, grip: 5, lock: 0.5, steerRate: 0.3 };
  const paintGeo = (g, r, gr, b) => {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const limb = (a, b, r, rgb) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const g = new THREE.CylinderGeometry(r, r, dir.length(), 6, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
    return paintGeo(g, ...rgb);
  };
  const WHITE = [1, 1, 1];
  const DARK = [0.07, 0.08, 0.1];
  const NAVY = [0.08, 0.1, 0.18];
  const SKIN = [0.82, 0.62, 0.5];
  const wheel = (z) => paintGeo(new THREE.TorusGeometry(0.34, 0.03, 6, 18).rotateY(Math.PI / 2).translate(0, 0.36, z), ...DARK);
  const bikeGeo = mergeGeometries([
    wheel(0.55), wheel(-0.55),
    limb([0, 0.98, -0.28], [0, 0.34, -0.145], 0.022, WHITE),
    limb([0, 0.34, -0.145], [0, 0.36, -0.55], 0.018, WHITE),
    limb([0, 0.98, -0.28], [0, 0.36, -0.55], 0.018, WHITE),
    limb([0, 0.98, -0.28], [0, 0.95, 0.42], 0.022, WHITE),
    limb([0, 0.34, -0.145], [0, 0.72, 0.45], 0.026, WHITE),
    limb([0, 0.98, 0.42], [0, 0.36, 0.55], 0.02, DARK),
    limb([-0.22, 1.02, 0.4], [0.22, 1.02, 0.4], 0.017, DARK),
    limb([0, 1.0, -0.38], [0, 1.0, -0.18], 0.05, DARK)
  ]);
  const riderGeo = mergeGeometries([
    paintGeo(new THREE.CapsuleGeometry(0.11, 0.3, 4, 8).rotateX(0.59).translate(0, 1.21, -0.14), ...WHITE),
    limb([0.18, 1.4, 0], [0.22, 1.02, 0.4], 0.035, WHITE),
    limb([-0.18, 1.4, 0], [-0.22, 1.02, 0.4], 0.035, WHITE),
    limb([0.1, 1.0, -0.28], [0.12, 0.78, 0.0], 0.065, NAVY),
    limb([-0.1, 1.0, -0.28], [-0.12, 0.78, 0.0], 0.065, NAVY),
    limb([0.12, 0.78, 0.0], [0.1, 0.38, -0.15], 0.05, NAVY),
    limb([-0.12, 0.78, 0.0], [-0.1, 0.38, -0.15], 0.05, NAVY)
  ]);
  const skinGeo = mergeGeometries([
    paintGeo(new THREE.SphereGeometry(0.105, 10, 8).translate(0, 1.58, 0.1), ...SKIN),
    paintGeo(new THREE.SphereGeometry(0.04, 6, 6).translate(0.22, 1.02, 0.4), ...SKIN),
    paintGeo(new THREE.SphereGeometry(0.04, 6, 6).translate(-0.22, 1.02, 0.4), ...SKIN)
  ]);
  const bikeMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
  const bikeInst = new THREE.InstancedMesh(bikeGeo, bikeMat, NUM_BIKES);
  const riderInst = new THREE.InstancedMesh(riderGeo, bikeMat, NUM_BIKES);
  const skinInst = new THREE.InstancedMesh(skinGeo, bikeMat, NUM_BIKES);
  const bikeMeshes = [bikeInst, riderInst, skinInst];
  const bikePalette = [0x15181c, 0x2b2f36, 0x6e1f24, 0x1d3b6c, 0xb9c0c8, 0x2f5d3a].map((c) => new THREE.Color(c));
  const jacketPalette = [0xd4442f, 0x1d3b6c, 0x2b2f36, 0x3b7a57, 0xe7b52b, 0x7a4a8a, 0xc7ccd4, 0x0f1114].map((c) => new THREE.Color(c));
  const white = new THREE.Color(1, 1, 1);
  const bikes = [];
  for (let i = 0; i < NUM_BIKES; i++) {
    const bike = createVehicle(false, 0.9, 0.3, 0.55, BIKE_DRIVER, 3 + Math.random() * 7);
    bike.bike = true;
    Object.assign(bike, { halfL: 0.95, mass: 95 });
    bike.slot = i;
    bikes.push(bike);
    bikeInst.setColorAt(i, bikePalette[(i * 7) % bikePalette.length]);
    riderInst.setColorAt(i, jacketPalette[(i * 5) % jacketPalette.length]);
    skinInst.setColorAt(i, white);
    for (const m of bikeMeshes) m.setMatrixAt(i, zero);
  }
  const bikeShown = new Uint8Array(NUM_BIKES);
  for (const m of bikeMeshes) {
    m.frustumCulled = false;
    m.castShadow = true;
  }
  group.add(...bikeMeshes);
  const vehicles = [...cars, ...buses, ...bikes];

  // =========================================================================
  // 3. PEDESTRIAN SYSTEM
  // =========================================================================
  const player = { active: false, entity: null, height: 0, x: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 1,
    halfW: 0.86, halfL: 2.18 };
  const nearEdges = [];
  const nearSignals = [];
  const activeTravel = network.activeTravel;
  const nearFoot = activeTravel ? [] : null;
  const nearBikes = [];
  const queryLocal = indexLocalRoads(edges.filter(e => !e.busExclusive), nodes.filter(n => n.signal));
  const carSpawns = [], vanSpawns = [], bikeSpawns = [], footSpawns = [];
  let carTarget = 0, bikeTarget = 0, pedTarget = 0;
  const pedestrianSystem = createPedestrianSystem(network, {
    player, nearEdges, nearSignals, nearFoot,
    pickFoot: () => pickByArea(footSpawns),
    mappedGround: (track, x, z) => gradeWayAt(track.wayId, x, z, 1.2)?.y
      ?? gradeHeightAt(x, z, terrainHeightAt(x, z), 'foot'),
    mayCross, mayCrossMapped, walkOn, visible, nearView, trips, railStop
  });
  group.add(...pedestrianSystem.meshes);

  // Add vehicle contact shadows last + pre-allocated Clustered SpotLight / PointLight pools
  group.add(carShadowInst, busShadowInst);

  const HEADLIGHT_POOL_SIZE = 96;
  const POLICE_LIGHT_POOL_SIZE = 6;
  const MAX_LIGHT_DIST = 115;
  const MAX_LIGHT_DIST_SQ = MAX_LIGHT_DIST * MAX_LIGHT_DIST;

  const trafficLightsGroup = new THREE.Group();
  trafficLightsGroup.name = 'TrafficClusteredLights';
  group.add(trafficLightsGroup);

  const headlightPool = [];
  for (let i = 0; i < HEADLIGHT_POOL_SIZE; i++) {
    const spot = createVehicleHeadlight();
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    trafficLightsGroup.add(spot, spot.target);
    headlightPool.push(spot);
  }

  const policeLightPool = [];
  for (let i = 0; i < POLICE_LIGHT_POOL_SIZE; i++) {
    const pt = new THREE.PointLight(0xff1828, 0, 12.0, 1.25);
    pt.position.set(0, -1000, 0);
    trafficLightsGroup.add(pt);
    policeLightPool.push(pt);
  }

  // Nothing shows until it has been placed
  const carInstances = [...bodyMeshes, carWheelLeftInst, carWheelRightInst, ...policeLightbarMeshes, carShadowInst];
  const busInstances = [busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst, busShadowInst];
  for (const inst of [...carInstances, ...busInstances, sparkInst]) {
    inst.frustumCulled = false;
    for (let i = 0; i < inst.count; i++) inst.setMatrixAt(i, zero);
  }

  scene.add(group);

  // =========================================================================
  // 4. WHO IS WHERE: LANE OCCUPANCY, INTERSECTIONS, VIEW, PLAYER
  // =========================================================================
  let clock = 0;
  let avePhase = 'green';
  let stPhase = 'red';
  let aveWalk = true;
  let stWalk = false;
  const phaseOf = (e) => (e.axisIndex === 0 ? avePhase : stPhase);
  let focusX = 0;
  let focusZ = 140;

  // Lane lists hold pooled { v, s } entries sorted by position s along the lane, rebuilt every frame
  const pool = [];
  let poolUsed = 0;
  const filled = [];
  function occupy(list, v, s) {
    let o = pool[poolUsed++];
    if (!o) pool.push((o = { v: null, s: 0 }));
    o.v = v;
    o.s = s;
    if (!list.length) filled.push(list);
    list.push(o);
    for (let k = list.length - 1; k > 0 && list[k - 1].s > s; k--) {
      list[k] = list[k - 1];
      list[k - 1] = o;
    }
  }

  // Half way through a lane change a vehicle still occupies the lane it is leaving (-1 left, 1 right)
  function straddle(v) {
    if (v.conn) return 0;
    if (v.dl > 0.5 && v.lane + 1 < v.edge.lanes.length) return 1;
    if (v.dl < -0.5 && v.lane > 0) return -1;
    return 0;
  }

  // A vehicle crossing an intersection, or committed to crossing it, holds it against crossing traffic and
  // pedestrians on the crosswalks it passes, and its place in the lane it heads for. The counters it raises are reset
  // next frame for just the nodes and edges touched (a few hundred out of thousands)
  const touchedNodes = [];
  const touchedEdges = [];
  const touchNode = (n) => {
    if (!n.touched) {
      n.touched = true;
      touchedNodes.push(n);
    }
    return n;
  };
  const touchEdge = (e) => {
    if (!e.touched) {
      e.touched = true;
      touchedEdges.push(e);
    }
    return e;
  };
  function claim(v) {
    if (v.claimed) return;
    v.claimed = true;
    const e = v.edge;
    const f = v.move.to;
    touchNode(e.to).box[e.axisIndex]++;
    if (!v.conn || v.cs < v.half + 2.5) e.to.crossing[e.inSide]++; // until its tail is past the crosswalk on its way in
    if (v.move.turn !== 'L') touchEdge(e).through++;
    if (!v.yielding) cross(v);
    occupy(f.occ[v.out], v, v.conn ? v.cs - v.conn.len : v.s - e.len - connector(e, v.lane, f, v.out).len);
  }

  // ...and, unless still waiting inside to turn left, the oncoming lanes and the crosswalk on its way out
  function cross(v) {
    const e = v.edge;
    if (v.move.turn === 'L') touchEdge(e).lefts++;
    touchNode(e.to).crossing[v.move.to.outSide]++;
    v.yielding = false;
  }

  function buildOccupancy() {
    for (const list of filled) list.length = 0;
    filled.length = 0;
    poolUsed = 0;
    for (const n of touchedNodes) {
      n.box.fill(0);
      n.crossing.fill(0);
      n.touched = false;
    }
    touchedNodes.length = 0;
    for (const e of touchedEdges) {
      e.through = e.lefts = 0;
      e.touched = false;
    }
    touchedEdges.length = 0;
    for (const v of vehicles) v.claimed = false;
    for (const v of vehicles) {
      const e = v.edge;
      if (!e || e.mapped) continue;
      if (v.parkingTrip?.phase==='maneuver') {
        const p = projectFittedLane(e, v.lane, v.x, v.z, 0, e.len, fittedA);
        const side = (v.z - p.z) * p.dx - (v.x - p.x) * p.dz;
        if (Math.abs(side) < 2.45 && p.station > 0 && p.station < e.len) occupy(e.occ[v.lane], v, p.station);
      } else if (!v.conn) {
        occupy(e.occ[v.lane], v, v.s);
        const side = straddle(v);
        if (side) occupy(e.occ[v.lane + side], v, v.s);
        if (v.commit === e.to) claim(v);
        if (v.s < v.half) touchNode(e.from).crossing[e.outSide]++; // its tail still over the crosswalk behind it
      } else {
        claim(v);
        occupy(e.occ[v.lane], v, e.len + v.cs); // until it is out of the intersection, still ahead of those behind it
      }
    }
  }

  // The camera's view, for drawing and protecting nearby spawn locations
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  let hasView = false;
  let camX = 0;
  let camY = 10;
  let camZ = 140;
  let camFwdX = 0;
  let camFwdZ = 1;
  function updateView(camera) {
    hasView = !!camera;
    if (!camera) return;
    camera.updateMatrixWorld();
    camX = camera.position.x;
    camY = camera.position.y;
    camZ = camera.position.z;
    const me = camera.matrixWorld.elements;
    camFwdX = -me[8];
    camFwdZ = -me[10];
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
  }
  // Could the camera see a sphere of radius r around ground point (x, z)? Side planes only: the near and far
  // planes depend on depth conventions, and the side planes alone already rule out everything behind the camera.
  function visible(x, z, r, y) {
    if (!hasView) return false;
    for (let k = 0; k < 4; k++) {
      const { normal, constant } = frustum.planes[k];
      if (normal.x * x + normal.y * (y + 1) + normal.z * z + constant < -r) return false;
    }
    return true;
  }

  function nearView(x, z, radius, distance, y = terrainHeightAt(x, z)) {
    if (!hasView || Math.hypot(x - camX, z - camZ) >= distance) return false;
    return Math.hypot(x - camX, y - camY, z - camZ) < distance && visible(x, z, radius, y);
  }

  // Revisit the area budget when the camera moves or new directional readings take effect.
  let nearX = Infinity, nearZ = Infinity, nextDemandCheck = 0;
  function nearLength(ax, az, dx, dz, len) {
    return localSegmentLength(focusX, focusZ, NEAR_RADIUS, ax, az, dx, dz, len);
  }

  function refreshNear() {
    if (Math.hypot(focusX - nearX, focusZ - nearZ) >= 35) {
      nearX = focusX;
      nearZ = focusZ;
      queryLocal(focusX, focusZ, NEAR_RADIUS + 35, nearEdges, nearSignals);
      activeTravel?.foot(focusX, focusZ, NEAR_RADIUS + 35, nearFoot);
      activeTravel?.bikes(focusX, focusZ, NEAR_RADIUS + 35, nearBikes);
    } else if (clock < nextDemandCheck) return;
    nextDemandCheck = clock + 1;
    carSpawns.length = vanSpawns.length = bikeSpawns.length = footSpawns.length = 0;
    let roadArea = 0, footArea = 0;
    for (const e of nearEdges) {
      if (roadTraffic.isClosed(e) || e.len < 15) continue;
      const areaPerLane = nearLength(e.sx, e.sz, e.dx, e.dz, e.len) * clamp(e.half, 2.4, 3.5) * roadTraffic.demand(e);
      if (!(areaPerLane > 0)) continue;
      const carLanes = e.ambientLanes.length, vanLanes = e.vanLanes.length;
      if (carLanes) carSpawns.push({ segment: e, end: (carSpawns.at(-1)?.end || 0) + carLanes * areaPerLane });
      if (vanLanes) vanSpawns.push({ segment: e, end: (vanSpawns.at(-1)?.end || 0) + vanLanes * areaPerLane });
      roadArea += areaPerLane * Math.max(carLanes, vanLanes);
    }
    for (const track of nearBikes) {
      if (track.noSpawn || track.len < 2) continue;
      const area = nearLength(track.ax, track.az, track.ux, track.uz, track.len) * clamp(track.width, 1.4, 4.5);
      if (area > 0) bikeSpawns.push({ segment: track, end: (bikeSpawns.at(-1)?.end || 0) + area });
    }
    for (const track of nearFoot || []) {
      if (track.noSpawn) continue;
      const area = nearLength(track.ax, track.az, track.ux, track.uz, track.len) *
        (track.populationWidth ?? (track.sidewalk ? 1.8 : clamp(track.width, 1, 6)));
      if (area > 0) {
        footArea += area;
        footSpawns.push({ segment: track, end: footArea });
      }
    }
    const activity = Math.min(1, 0.24 + 0.76 * roadTraffic.profile);
    carTarget = Math.min(NUM_CARS, Math.round(roadArea / 640));
    bikeTarget = Math.min(NUM_BIKES, Math.round((bikeSpawns.at(-1)?.end || 0) * activity / 285));
    pedTarget = Math.min(96, Math.round(footArea * activity / 320));
  }

  const crossingActors=new Map(), zebraIntent=new Set(), playerCrossings=[];
  let nextPlayerCrossingQuery=0;

  function rememberCrossings() {
    crossingActors.clear();
    zebraIntent.clear();
    function markZebra(track,dir) {
      for (const id of controls?.pathCrossings(track,dir)??[]) zebraIntent.add(id);
    }
    function remember(actor, track, distance) {
      if (!track?.crossing || distance <= 0.55 || distance >= track.len - 0.55) return;
      for (const id of track.crossing.wayIds || []) {
        if (!crossingActors.has(id)) crossingActors.set(id, []);
        crossingActors.get(id).push(actor);
      }
    }
    for (const bike of bikes) remember(bike, bike.edge, bike.s);
    for (const person of pedestrianSystem.peds) {
      if (!person.placed) continue;
      if (!person.waiting) remember(person,person.route,person.t);
      if (!controls) continue;
      if (person.route?.crossing) markZebra(person.route,person.dir);
      if (!person.pause && (person.dir>0?person.len-person.t:person.t)<2.7) {
        const leg=person.nextRoute?.[person.nextLeg];
        if (leg?.track.crossing) markZebra(leg.track,leg.dir);
      }
    }
    if (controls && player.active && player.entity?.type==='person') {
      if (clock>=nextPlayerCrossingQuery) {
        nextPlayerCrossingQuery=clock+.18;
        activeTravel?.foot(player.x,player.z,4,playerCrossings);
      }
      for (const track of playerCrossings) {
        if (!track.crossing || Math.abs(roadGround(track,player.x,player.z)-player.y)>1.8) continue;
        const dx=player.x-track.ax,dz=player.z-track.az;
        const along=dx*track.ux+dz*track.uz;
        if (along<-.7 || along>track.len+.7 || Math.abs(dx*track.uz-dz*track.ux)>1.4) continue;
        markZebra(track,1);
        markZebra(track,-1);
      }
    }
  }

  function mayCrossMapped(track, actor) {
    const crossing = track.crossing;
    if (!crossing) return true;
    if (crossing.control === 'signal' && phaseOf(crossing) !== 'red') return false;
    const { x, z, wayIds } = crossing;
    const y = roadGround(track, x, z);
    if (actor.bike) {
      for (const id of wayIds || []) {
        for (const walker of crossingActors.get(id) || []) {
          if (!walker.bike && Math.abs(walker.y - y) < 1.8 && Math.hypot(walker.x - x, walker.z - z) < track.len * 0.7) return false;
        }
      }
    }
    const zebras = !actor.bike && controls?.pathCrossings(track, actor.dir);
    const crossingTime = Math.min(9, (track.len + 1) / Math.max(1, actor.bike ? actor.speed : actor.speed || 1.3));
    for (const v of vehicles) {
      if (v === actor || !v.edge || v.edge.mapped || Math.abs(v.y - y) > 1.8) continue;
      const dx = x - v.x, dz = z - v.z;
      if (Math.abs(dx) > 65 || Math.abs(dz) > 65) continue;
      const nearRoad = !wayIds?.length || wayIds.includes(v.edge.wayId) || wayIds.includes(v.move?.to?.wayId);
      if (!nearRoad && Math.abs(dx) + Math.abs(dz) > 12) continue;
      const along = dx * v.tx + dz * v.tz;
      const aside = Math.abs(dx * v.tz - dz * v.tx);
      if (aside > Math.max(2.2, track.len * 0.65) || along < -(v.half + 2)) continue;
      if (zebras?.length && v.speed < 0.2 && along > v.half + 0.6 &&
          controls.crossings(v.edge, roadMode(v)).some(c => zebras.includes(c.id))) continue;
      if (along < v.half + 2 + Math.min(60, v.speed * (crossingTime + 1))) return false;
    }
    return true;
  }

  // Where the player is relative to v: metres ahead, metres to the right, and how fast it moves v's way
  function relateToPlayer(v) {
    v.pAhead = Infinity;
    if (!player.active || Math.abs(player.y - v.y) > 1.8) return;
    const dx = player.x - v.x;
    const dz = player.z - v.z;
    if (Math.abs(dx) > LOOKAHEAD + 10 || Math.abs(dz) > LOOKAHEAD + 10) return;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    v.pAhead = dx * fx + dz * fz;
    v.pRight = dz * fx - dx * fz;
    v.pSpeed = Math.max(0, player.vx * fx + player.vz * fz);
  }

  // Gap to the player if it is ahead in the lane whose centre is `off` metres to the right of v
  function playerGap(v, off) {
    if (v.pAhead < 0 || v.pAhead > LOOKAHEAD) return Infinity;
    if (Math.abs(v.pRight - off) > v.halfWidth + player.halfW + 0.4) return Infinity;
    return v.pAhead - v.half - player.halfL;
  }

  // =========================================================================
  // 5. DRIVING
  // =========================================================================
  // The lane nearest to `lane` that move m can be made from (m.out[i] is the lane lane i leads to, or -1)
  function nearestLane(m, lane) {
    let best = -1;
    for (let i = 0; i < m.out.length; i++) {
      if (m.out[i] >= 0 && (best < 0 || Math.abs(i - lane) < Math.abs(best - lane))) best = i;
    }
    return best;
  }

  // First vehicle ahead of position s in a lane list
  function ahead(list, s, v) {
    for (const o of list) if (o.s > s && o.v !== v) return o;
    return null;
  }

  // The front-most vehicle still approaching the end of a lane: not crossing at its end yet, though maybe still coming
  // out of the intersection at its start (at s < 0)
  function leadOf(list) {
    for (let k = list.length - 1; k >= 0; k--) if (!list[k].v.conn || list[k].s < 0) return list[k];
    return null;
  }

  // Intelligent Driver Model: acceleration on a free road, and the braking term for an obstacle `gap` metres
  // (bumper to bumper) ahead moving at `speed`
  function roadSpeed(v) {
    return Math.min(roadTraffic.limit(v.edge), v.conn ? roadTraffic.limit(v.move.to) : Infinity);
  }

  function freeAcc(v) {
    const cruise = v.liveCruise ?? roadTraffic.cruise(v.edge, v.v0);
    return v.driver.a * (1 - (v.speed / Math.max(0.5, Math.min(roadSpeed(v), cruise))) ** 4);
  }
  function brake(v, gap, speed, s0 = v.driver.s0, T = v.driver.T) {
    const { a, b } = v.driver;
    const desired = s0 + Math.max(0, v.speed * T + (v.speed * (v.speed - speed)) / (2 * Math.sqrt(a * b)));
    return -a * (desired / Math.max(gap, 0.1)) ** 2;
  }
  // ...and for a line d metres ahead to stop s0 short of: no time gap to keep to a line
  const stopAt = (v, d, s0 = 1) => brake(v, d, 0, s0, 0);

  // Braking for the vehicle ahead of position s in a lane list; remembers the nearest one
  function follow(v, list, s, skipCars = false) {
    let o = ahead(list, s, v);
    // bikes filter past slower cars in their own lane (alongside, see bikeSidestep) rather than queue behind them
    if (skipCars) while (o) o = ahead(list, o.s, v);
    if (!o) return 0;
    const gap = o.s - o.v.half - s - v.half;
    if (gap > LOOKAHEAD) return 0;
    if (gap < v.gap) {
      v.gap = gap;
      v.leaderSpeed = o.v.speed;
    }
    return brake(v, gap, o.v.speed);
  }

  // Can v, d metres before a line, still stop at it braking no harder than its driver comfortably does?
  const canStopBefore = (v, d) => freeAcc(v) + stopAt(v, d) > -v.driver.b;

  // Braking for a red (or an amber with room to stop) at the end of edge f, `d` metres ahead
  function signalAhead(v, f, d) {
    if (v.isPolice || !f.to.signal || d > LOOKAHEAD) return 0;
    const phase = phaseOf(f);
    if (phase === 'green' || (phase === 'amber' && !canStopBefore(v, d))) return 0;
    return stopAt(v, d);
  }

  function legalTurn(v,move) {
    const mode=roadMode(v);
    return Boolean((move.modes??(CAR|VAN|BUS))&mode) &&
      network.turnRestrictionState?.(v.turnHistory,move,mode)!==null;
  }

  // Ambient traffic favors going straight. Scheduled buses take their route or a validated detour.
  const weights = [];
  function chooseMove(v, fromLane) {
    const e = v.edge;
    if (v.busRun) return v.busDetour ? v.busDetour.steps[v.busDetour.index]?.move : v.busPath.legs[v.busLeg].move;
    if (v.parkingTrip?.phase==='approach') {
      const trip=v.parkingTrip;
      const hop=trip.route[trip.step];
      if (hop && hop.out[v.lane]>=0 && !roadTraffic.isClosed(hop.to) && legalTurn(v,hop)) return hop;
      if (!hop && e===trip.link.entrance.edge && v.lane===trip.link.entrance.lane) return null;
      parking.cancel(v,clock);
    }
    const trip=v.destinationTrip;
    const step=trip?.steps[trip.index];
    if (step?.from===e && step.lane===v.lane && !roadTraffic.isClosed(step.move.to) && legalTurn(v,step.move)) return step.move;
    if (step && (step.from!==e || step.lane!==v.lane)) v.destinationTrip=null;
    const moves = (v.bodyType === 'van' ? e.vanMoves : e.ambientMoves) || e.moves;
    let total = 0;
    for (let k = 0; k < moves.length; k++) {
      const m = moves[k];
      let w = roadTraffic.isClosed(m.to) || !legalTurn(v,m) ? 0 : m.turn === 'S' ? 3 : 1;
      if (fromLane) {
        if (m.out[v.lane] < 0) w = 0;
      } else if (Math.abs(nearestLane(m, v.lane) - v.lane) * 22 > e.len - v.s) {
        w *= 0.02; // too little road left to change lanes for it
      }
      weights[k] = w;
      total += w;
    }
    let r = Math.random() * total;
    let pick = null;
    for (let k = 0; k < moves.length; k++) {
      if (weights[k] <= 0) continue;
      pick = moves[k];
      r -= weights[k];
      if (r < 0) break;
    }
    // No move from this lane (a lane the road graph couldn't lead anywhere): take any move, changing lanes for it
    if (!pick && fromLane) return chooseMove(v, false);
    return pick;
  }

  // Could the vehicle of lane entry o, approaching the end of edge a, still stop easily before its line? Vehicles
  // already standing can; drivers who have been waiting a while accept any gap it can still stop for comfortably.
  function canStop(o, a, impatient) {
    const sp = o.v.speed;
    if (sp < 0.5) return true;
    const d = a.len - o.s - o.v.half;
    return impatient ? canStopBefore(o.v, d) : d > (sp * sp) / 5 + sp + 3;
  }

  // A left turn waits for oncoming traffic going straight or right (approach o); vehicles not on o yet haven't picked
  // their way on, and at a red, only police and those already committed to crossing still come. Waiting at the line, v
  // also takes turns with those waiting at theirs: whoever has waited longer goes first, if it has room to go.
  function yieldOncoming(o, impatient, v = null) {
    if (!o) return false;
    if (o.through > 0) return true;
    const red = o.to.signal && phaseOf(o) === 'red';
    for (const list of o.occ) {
      const lead = leadOf(list);
      if (!lead || (lead.v.edge === o && lead.v.move?.turn === 'L')) continue;
      if (red && !lead.v.isPolice) continue;
      if (!canStop(lead, o, impatient)) return true;
      const u = lead.v;
      const j = u.edge === o && u.move ? u.move.out[u.lane] : -1;
      if (v && v.wait > 0 && u.wait > v.wait && j >= 0 && o.len - lead.s - u.half < 2 && room(u.move.to, j, u)) return true;
    }
    return false;
  }

  // How far along curve c, out of two-way edge e, v can pull forward before its front corner reaches the
  // oncoming lanes (left of the centre line): where it waits for a gap to turn left
  const corner = { x: 0, z: 0, dx: 0, dz: 1 };
  function yieldPoint(v, c, e) {
    let cs = 0;
    for (; cs < c.len; cs += 0.5) {
      curvePoint(c, cs + v.half, corner);
      const x = corner.x + corner.dz * v.halfWidth;
      const z = corner.z - corner.dx * v.halfWidth;
      if ((x - e.x0) * e.rx + (z - e.z0) * e.rz < 0.3) break;
    }
    return cs - 0.5;
  }

  // At unsignalized corners, give way to the main road. Police passing a non-green signal yield to approaching
  // cross traffic as well as vehicles already in the intersection, instead of treating the light as a clear road.
  function yieldToCrossTraffic(v,n,mapped=null) {
    for (const a of mapped??n.in) {
      if (!mapped && (n.signal?a.axisIndex===v.edge.axisIndex:a.axisIndex!==0)) continue;
      for (const list of a.occ) {
        const lead = leadOf(list);
        if (lead && !canStop(lead, a, !n.signal && v.wait > 8)) return true;
      }
    }
    return false;
  }

  // Seconds v takes to cover dist metres from now, speeding up from rest if it has to
  const timeTo = (v, dist) => dist / Math.max(v.speed, Math.sqrt((v.driver.a * dist) / 2), 0.1);

  // Do people on crosswalk `side` have the WALK? Across the avenue with the cross street's traffic, across the street
  // with the avenue's.
  function walkOn(side) {
    return side >= 2 ? stWalk : aveWalk;
  }

  // May p step off the curb onto its crosswalk? On the WALK (early in the parallel traffic's green, so red for the
  // traffic arriving over it), once no vehicle is crossing it or committed to, and none is too close to stop
  function mayCross(p) {
    const n = p.node;
    if (!walkOn(p.side) || n.crossing[p.side] > 0) return false;
    const e = n.approach[p.side];
    if (!e) return true;
    for (const list of e.occ) {
      const lead = leadOf(list);
      if (lead && !canStop(lead, e, true)) return false;
    }
    return true;
  }

  // Will anyone on crosswalk `side` of n be within reach of the lane meeting it at `coord` between t0 and t1
  // seconds from now? Unless `onIt`, so is anyone waiting at the curb to step off, however far away: on the WALK, they
  // only wait for the vehicles already holding the crosswalk.
  function pedestrianOn(n, side, coord, t0, t1, onIt = false) {
    for (const p of n.walkers) {
      if (p.side !== side || (onIt && p.waiting)) continue;
      const toGo = (coord - p.coord) * p.dir; // metres p still has to walk to get there
      const avoiding = clock < p.avoidUntil;
      // Runners may enter a lane sooner, then slow or stop before clearing it.
      const fast = Math.max(p.speed, p.v, avoiding ? p.avoidSpeed : 0);
      const slow = Math.max(0.1, avoiding ? Math.min(p.speed, p.v, p.avoidSpeed) : p.speed);
      if (p.waiting || ((toGo + 2.6) / slow > t0 && (toGo - 2.6) / fast < t1)) return true;
    }
    return false;
  }

  // ...on the crosswalk v leaves the intersection over, while v, its front bumper d metres before it, passes? Once v
  // holds that crosswalk (it isn't waiting inside to turn), people at the curb wait for it.
  const pedsOut = (v, d) => d > 0 && pedestrianOn(v.edge.to, v.move.to.outSide, laneCoord(v.move.to, v.out), timeTo(v, d), timeTo(v, d + 3 + 2 * v.half), !v.yielding);

  // Must v, pulled into the intersection to turn, wait there: for people crossing its way out (`peds`) or, turning
  // left, for oncoming traffic?
  const holdsOn = (v, peds) => peds || (v.move.turn === 'L' && yieldOncoming(v.edge.opposite, false));

  // Of two vehicles on the same road headed for the same lane, the one whose front is nearer the line goes first (by
  // the front: a bus waiting at the line goes before the cars that pull up beside it)
  const precedence = (u, s) => s + u.half;

  // Would there be room for v in lane j of edge f if everyone headed there queued bumper to bumper behind its far
  // stop line? (An empty lane always has room, however short.) Vehicles take turns for it: whoever has waited longer
  // to go there from another side, or goes first from v's own road, counts as already in.
  function room(f, j, v) {
    let free = f.len - 1;
    for (const o of f.occ[j]) if (o.v !== v && o.s - o.v.half < f.len) free -= 2 * o.v.half + o.v.driver.s0;
    for (const a of f.from.in) {
      for (const list of a.occ) {
        const o = leadOf(list);
        if (!o || o.v.claimed || !o.v.move || o.v.move.to !== f || o.v.move.out[o.v.lane] !== j) continue;
        if (a === v.edge ? precedence(o.v, o.s) > precedence(v, v.s) : o.v.wait > v.wait) free -= 2 * o.v.half + o.v.driver.s0;
      }
    }
    return free >= Math.min(2 * v.half + 0.5, f.len - 1);
  }

  // Would v, crossing into lane j of f to arrive at position vs, come alongside another vehicle headed there, cut in
  // ahead of one closing in on it, or close in on one ahead in a lane beside (which it doesn't follow)? Turning buses
  // swing wide, so where a bus turns, the lanes either side count too, and for one turning beside v from v's road, so
  // does how far apart they start turning (the outer one has further to go: side by side on f may be one behind the
  // other at the line, and the other way round).
  function alongside(f, j, v, vs, turn) {
    for (let k = Math.max(0, j - 1); k <= Math.min(f.lanes.length - 1, j + 1); k++) {
      for (const o of f.occ[k]) {
        const swing = turn && (v.bus || o.v.bus);
        if (o.v === v || (k !== j && !swing)) continue;
        let lo = o.s - vs; // how far ahead of v o is
        let hi = lo;
        if (swing && o.v.edge === v.edge) {
          const atLine = (o.v.conn ? v.edge.len + o.v.cs : o.v.s) - v.s;
          lo = Math.min(lo, atLine);
          hi = Math.max(hi, atLine);
        }
        const closing = hi < 0 ? o.v.speed - v.speed : lo > 0 && k !== j ? v.speed - o.v.speed : 0;
        const w = o.v.half + v.half + 1 + 2 * Math.max(0, closing);
        if (lo < w && hi > -w) return true;
      }
    }
    return false;
  }

  // Is a bus at the line in the lane on the outside of v's turn? A bus starting to turn swings its tail out over it.
  function besideTail(v) {
    const e = v.edge;
    const k = v.lane + (v.move.turn === 'R' ? -1 : 1);
    const o = v.move.turn !== 'S' && k >= 0 && k < e.lanes.length ? leadOf(e.occ[k]) : null;
    return !!o && o.v.bus && o.v !== v && e.len - o.s - o.v.half < 2;
  }

  // The lead of another of v's lanes that goes first into lane j of f or, turning where a bus is involved, into a lane
  // beside it (turning buses swing wide): v falls in behind it. As an entry { v, s } of f's lane: where it would be on
  // f now.
  const merger = { v: null, s: 0 };
  function mergingAhead(v, f, j) {
    const e = v.edge;
    merger.v = null;
    for (let i = 0; i < e.lanes.length; i++) {
      const o = i === v.lane ? null : leadOf(e.occ[i]);
      if (!o || o.v === v || o.v.claimed || o.v.move?.to !== f || precedence(o.v, o.s) <= precedence(v, v.s)) continue;
      if (o.v.bus && besideTail(o.v)) continue; // it waits for the bus beside its tail
      const oj = o.v.move.out[o.v.lane];
      if (oj < 0 || (oj !== j && !(Math.abs(oj - j) === 1 && v.move.turn !== 'S' && (v.bus || o.v.bus)))) continue;
      const s = o.s - e.len - connector(e, o.v.lane, f, oj).len;
      if (!merger.v || s < merger.s) {
        merger.v = o.v;
        merger.s = s;
      }
    }
    return merger.v ? merger : null;
  }

  // May v, its front bumper d metres before the stop line, enter the intersection now? Sets the exit lane.
  // Once too close to stop, v is committed: it goes, and holds the intersection from then on.
  function mayEnter(v, d) {
    if (!v.move || roadTraffic.isClosed(v.move.to) || !legalTurn(v,v.move)) return false;
    const e=v.edge;
    const n=e.to;
    if (controls && controls.stopTarget(v,clock,roadMode(v))<Infinity) return false;
    if (v.pilotStopDistance<=Math.max(0,d)+0.35) return false;
    const phase = n.signal ? phaseOf(e) : 'green';
    // Could it still stop? For a light that isn't green, also by crawling up to it, closer than it stops for lines
    const stoppable = canStopBefore(v, d) || (phase !== 'green' && v.speed * v.speed < 2 * v.driver.b * d);
    if (stoppable) v.commit = null; // could stop after all: decide afresh
    if (v.commit === n) return true;
    if (v.move.out[v.lane] < 0) {
      // missed the lane for the planned move: go wherever this lane goes instead
      if (v.busRun || (d > 12 && !v.bike)) return false;
      v.move = chooseMove(v, true);
      if (!v.move) return false;
    }
    const m = v.move;
    const f = m.to;
    const j = m.out[v.lane];
    if (!(j >= 0 && j < f.lanes.length)) {
      if (!mayEnter.warned) {
        mayEnter.warned = true;
        console.warn('[traffic] lane leads nowhere', { lane: v.lane, lanes: e.lanes.length, out: m.out.slice(), moves: e.moves.length, x: Math.round(v.x), z: Math.round(v.z) });
      }
      return false;
    }
    if (v.bike) {
      // bikes wait for nothing: no lights, crossing traffic, pedestrians or room
      v.out = j;
      v.yielding = false;
      return true;
    }
    if (!v.isPolice && (phase === 'red' || (phase === 'amber' && stoppable))) return false;
    if (boxBusy(n, e.axisIndex)) return false; // crossing traffic inside
    const lead = ahead(e.occ[v.lane], v.s, v);
    if (lead && lead.v.yielding) return false; // the vehicle ahead waits inside to turn: wait behind the line
    if (v.bus && besideTail(v)) return false; // its tail would swing out over that bus as it starts to turn
    // At a signal, the first in line to turn pulls into the intersection to wait there for the people crossing the
    // road it turns into (they walk on the same green): short of their crosswalk or, turning left across oncoming
    // traffic, short of the oncoming lanes until there is a gap. The light changing stops both for it at the latest.
    const c = connector(e, v.lane, f, j);
    const first = n.signal && (!v.isPolice || phase === 'green') && m.turn !== 'S' && !lead;
    const across = m.turn === 'L' && !!e.opposite;
    const wait = first ? (across ? yieldPoint(v, c, e) : c.len - 3 - v.half) : -1; // < 0: no room inside to wait
    if (m.turn === 'L' ? across && wait < 0 && yieldOncoming(e.opposite, v.wait > 8, v) : e.opposite && e.opposite.lefts > 0) return false;
    const conflict=controls?.conflicts(e,roadMode(v));
    if (!n.signal && conflict!=null ? yieldToCrossTraffic(v,n,conflict) :
        (n.signal ? v.isPolice&&phase!=='green' : e.axisIndex!==0) && yieldToCrossTraffic(v,n)) return false;
    // nobody on the crosswalks while it passes over them, on the way in and on the way out, and a free place to
    // clear the intersection to, taking turns with lanes merging into it
    if (pedestrianOn(n, e.inSide, laneCoord(e, v.lane, true), 0, timeTo(v, d + 2.5 + 2 * v.half))) return false;
    if (wait < 0 && pedestrianOn(n, f.outSide, laneCoord(f, j), timeTo(v, d + c.len - 3), timeTo(v, d + c.len + 2 * v.half))) return false;
    const vs = v.s - e.len - c.len; // where on f it would be now
    if (!room(f, j, v) || alongside(f, j, v, vs, m.turn !== 'S') || mergingAhead(v, f, j)) return false;
    v.out = j;
    v.yielding = wait >= 0;
    v.yieldAt = wait;
    if (!stoppable) {
      v.commit = n;
      claim(v); // at once, so vehicles and pedestrians deciding later this frame know
    }
    return true;
  }

  // Overtake into an adjacent lane when it is clearly quicker (MOBIL), or work towards a lane the planned turn
  // can be made from; either only if neither v nor its new follower has to brake hard for it. Not while still
  // pulling out of an intersection or dodging the player, nor in the last 12 m before the next.
  function changeLanes(v) {
    const e = v.edge;
    const allowed = v.bodyType === 'van' ? e.vanLanes : e.ambientLanes;
    if (!v.move || v.conn || v.commit || v.off || clock < v.panicUntil) return;
    if (Math.abs(v.dl) > 0.5 || v.s < v.half || e.len - v.s - v.half < 12) return;
    let target = -1;
    if (v.move.out[v.lane] < 0) {
      const t = v.lane + Math.sign(nearestLane(v.move, v.lane) - v.lane);
      if ((!allowed || allowed.includes(t)) && laneSafe(v, t, -4)) target = t;
    } else if (v.bike || v.speed > 2) {
      // bikes never sit in a queue: they take any adjacent lane with room that lets them keep going
      let best = laneAcc(v, v.lane) + (v.bike ? 0.05 : 0.6);
      for (let t = v.lane - 1; t <= v.lane + 1; t += 2) {
        if (t < 0 || t >= e.lanes.length || v.move.out[t] < 0 || !laneSafe(v, t, v.bike ? -6 : -3)) continue;
        const acc = laneAcc(v, t);
        if (acc > best) {
          best = acc;
          target = t;
        }
      }
    }
    if (target < 0) return;
    v.dl -= laneDelta(e, v.lane, target, v.s); // same position relative to the new lane centre
    v.lane = target;
    v.trail = null;
  }

  // Can v move into lane t leaving itself and its new follower at least bSafe (negative) acceleration?
  function laneSafe(v, t, bSafe) {
    let lead = null;
    let back = null;
    const minGap = v.bike ? 0.6 : 1.5;
    for (const o of v.edge.occ[t]) {
      if (o.v === v) continue;
      if (o.s > v.s) {
        lead = o;
        break;
      }
      back = o;
    }
    if (lead) {
      const gap = lead.s - lead.v.half - v.s - v.half;
      if (gap < minGap || freeAcc(v) + brake(v, gap, lead.v.speed) < bSafe) return false;
    }
    if (back) {
      const f = back.v;
      const gap = v.s - v.half - back.s - f.half;
      if (gap < minGap || freeAcc(f) + brake(f, gap, v.speed) < bSafe) return false;
    }
    const off = laneDelta(v.edge, v.lane, t, v.s) - v.dl;
    const reach = v.half + player.halfL + 6;
    return !(Math.abs(v.pRight - off) < v.halfWidth + player.halfW + 0.4 && v.pAhead > -reach && v.pAhead < reach);
  }

  // Acceleration v would have in lane t behind the vehicle (or player) ahead there
  function laneAcc(v, t) {
    const o = ahead(v.edge.occ[t], v.s, v);
    let worst = o ? brake(v, o.s - o.v.half - v.s - v.half, o.v.speed) : 0;
    const pg = playerGap(v, laneDelta(v.edge, v.lane, t, v.s) - v.dl);
    if (pg < LOOKAHEAD) worst = Math.min(worst, brake(v, pg, v.pSpeed));
    return freeAcc(v) + worst;
  }

  // Fastest v can take curve c at without exceeding the sideways acceleration its driver accepts
  const bendSpeed = (v, c) => Math.sqrt(v.driver.aLat / Math.max(c.curv, 1e-3));
  function lineClearance(v) {
    if (!v.busRun) return v.half;
    const limit = Math.min(v.half, v.edge.len * 0.45);
    const stop = v.edge.busOnly && !v.edge.underpass && !v.conn && !v.busDetour && busStopHere(v);
    return stop ? clamp(v.edge.len - stop.at - 0.1, 0, limit) : limit;
  }

  function busStopHere(v) {
    const stop = v.busPath.stops[v.busStopIndex];
    return stop?.leg === v.busLeg ? stop : null;
  }

  function busStopTarget(v, stop) {
    return v.move ? Math.min(stop.at, v.edge.len - lineClearance(v) - 0.1) : stop.at;
  }

  // A bike with a vehicle in its lane ahead or alongside rides beside it, within the lane, instead of waiting behind it
  function bikeSidestep(v) {
    const e = v.edge;
    let blocker = null;
    for (const o of e.occ[v.lane]) {
      if (o.v === v) continue;
      if (o.s - o.v.half - 12 < v.s && o.s + o.v.half + v.half + 1.5 > v.s && (!blocker || o.s < blocker.s)) blocker = o;
    }
    if (!blocker) {
      v.off = 0;
      return;
    }
    const canRight = v.lane + 1 < e.lanes.length;
    const canLeft = v.lane > 0;
    let dir = canRight && (!canLeft || v.slot % 2) ? 1 : -1;
    const bo = blocker.v.off || 0;
    if (blocker.v.bike && bo !== 0) dir = bo > 0 ? -1 : 1; // pass a bike on its other side
    const mag = blocker.v.bike ? 0.8 : blocker.v.bus ? 1.8 : 1.35;
    if (!v.off || Math.abs(v.off) !== mag) v.off = dir * mag;
  }

  const drivingLimitResult={distance:Infinity,speed:Infinity,standingStop:false};
  function drivingLimits(v) {
    const e=v.edge, mode=roadMode(v), f=v.move?.to;
    const from=v.conn?e.len+v.cs:v.s;
    const target=controls?.stopTarget(v,clock,mode)??Infinity;
    let distance=Math.max(0,target-v.s);
    const giveWay=controls?.approach(e,mode);
    if (!v.conn && giveWay?.kind==='yield' && !e.to.signal) {
      const before=giveWay.at-v.half-.25-v.s;
      const priority=controls.conflicts(e,mode);
      if (before>=-.32 && before<LOOKAHEAD && priority?.length && yieldToCrossTraffic(v,e.to,priority)) {
        distance=Math.min(distance,Math.max(0,before));
      }
    }
    let speed=controls?.speedCap(e,from,v.half,mode)??Infinity;
    const lane=v.move?.out[v.lane];
    const curve=v.conn ?? (f && lane>=0 && e.len-v.s<LOOKAHEAD ? connector(e,v.lane,f,lane) : null);
    const nextStart=curve?e.len+curve.len:Infinity;
    if (controls && zebraIntent.size) {
      for (const crossing of controls.crossings(e,mode)) {
        const stop=crossing.from-v.half-1.35;
        if (zebraIntent.has(crossing.id) && stop>=from-.32) distance=Math.min(distance,Math.max(0,stop-from));
      }
      if (curve) for (const crossing of controls.crossings(f,mode)) {
        const stop=nextStart+crossing.from-v.half-1.35;
        if (zebraIntent.has(crossing.id) && stop>=from-.32) distance=Math.min(distance,Math.max(0,stop-from));
      }
    }
    if (curve && controls) speed=Math.min(speed,controls.speedCap(f,from-nextStart,v.half,mode));
    if (railStop) {
      const train=railStop({x:v.x,y:v.y,z:v.z,dx:v.tx,dz:v.tz,
        wayId:v.conn?[e.wayId,f.wayId]:e.wayId,layer:v.conn?f.layer:e.layer,mode});
      distance=Math.min(distance,Math.max(0,train-v.half-.35));
    }
    drivingLimitResult.distance=distance;
    drivingLimitResult.speed=speed;
    drivingLimitResult.standingStop=Number.isFinite(target);
    return drivingLimitResult;
  }

  // IDM acceleration for vehicles ahead in the lane (and, through the intersection, in the lane it leads to),
  // the stop line while v may not go, a red beyond, the player, and slowing down for turns and give-way lines
  function stopForMappedCrossings(v, edge) {
    let braking = 0;
    for (const actor of crossingActors.get(edge.wayId) || []) {
      if (Math.abs(actor.y - v.y) > 1.8) continue;
      const crossing = (actor.bike ? actor.edge : actor.route)?.crossing;
      if (!crossing) continue;
      const dx = crossing.x - v.x, dz = crossing.z - v.z;
      const distance = dx * v.tx + dz * v.tz;
      if (distance > 0 && distance < LOOKAHEAD && Math.abs(dx * v.tz - dz * v.tx) < edge.half + 2) {
        braking = Math.min(braking, stopAt(v, distance - v.half, 1.5));
      }
    }
    return braking;
  }

  function accelerate(v) {
    const e=v.edge;
    const limit=(controls||railStop) ? drivingLimits(v) : null;
    v.pilotStopDistance=limit?.distance??Infinity;
    let worst=0;
    let cap=Infinity;
    v.gap = Infinity;
    if (!v.conn) {
      worst = follow(v, e.occ[v.lane], v.s, v.bike);
      if (v.bike) bikeSidestep(v);
      const side = v.bike && v.off ? 0 : straddle(v);
      if (side) worst = Math.min(worst, follow(v, e.occ[v.lane + side], v.s));
      const d = e.len - v.s - lineClearance(v);
      if (v.move && d < LOOKAHEAD) {
        const go = mayEnter(v, d);
        const f = v.move?.to;
        const j = v.move?.out[v.lane] ?? -1;
        const c = j < 0 ? null : connector(e, v.lane, f, j);
        const vs = c ? v.s - e.len - c.len : 0; // position on f, measured from its start
        if (!go) {
          if (!limit?.standingStop) worst = Math.min(worst, stopAt(v, d));
        } else {
          worst = Math.min(worst, follow(v, f.occ[j], vs, v.bike), v.bike ? 0 : signalAhead(v, f, f.len - vs - v.half));
          // pulling in to wait inside: slow down for that spot already if it will have to wait there
          if (v.yielding && holdsOn(v, pedsOut(v, d + c.len - 3))) worst = Math.min(worst, stopAt(v, d + v.half + v.yieldAt, 0.5));
        }
        // easing off to fall in behind a vehicle from another lane merging ahead into the same lane (unless committed:
        // then the others wait for v)
        const o = c && !v.bike && !v.claimed && mergingAhead(v, f, j);
        if (o) worst = Math.min(worst, Math.max(-v.driver.b, brake(v, o.s - o.v.half - vs - v.half, o.v.speed)));
        let vt = c ? Math.min(bendSpeed(v, c), roadTraffic.limit(f)) : Infinity;
        const cautious = e.to.signal ? v.isPolice && phaseOf(e) !== 'green' : e.axisIndex !== 0;
        if (cautious) vt = Math.min(vt, 5);
        cap = Math.sqrt(vt * vt + 5 * Math.max(0, d));
      } else if (!v.move && !v.busRun && !e.motorwayExit && !limit?.standingStop) {
        worst = Math.min(worst, stopAt(v, d));
      }
    } else {
      const f = v.move.to;
      const vs = v.cs - v.conn.len;
      worst = Math.min(worst, follow(v, f.occ[v.out], vs, v.bike), follow(v, e.occ[v.lane], e.len + v.cs, v.bike), v.bike ? 0 : signalAhead(v, f, f.len - vs - v.half));
      // someone crossing the way out: wait for them inside the intersection, short of the 2.5 m crosswalk
      const d = v.conn.len - 3 - v.cs - v.half;
      const peds = pedsOut(v, d);
      if (v.yielding && v.cs < v.yieldAt && holdsOn(v, peds)) {
        worst = Math.min(worst, stopAt(v, v.yieldAt - v.cs, 0.5)); // waiting inside to turn
      } else {
        if (v.yielding) cross(v);
        if (peds && !v.bike) worst = Math.min(worst, stopAt(v, d, 0.5));
      }
      cap = bendSpeed(v, v.conn);
    }
    if (v.busRun) {
      cap = Math.min(cap, v.liveCruise ?? Infinity);
      if (e.busOnly && !e.underpass) cap = Math.min(cap, 5);
      const stop = !v.conn && !v.busDetour && busStopHere(v);
      if (stop) {
        const distance = busStopTarget(v, stop) - v.s;
        worst = Math.min(worst, stopAt(v, distance + 0.35, 0.35));
        cap = Math.min(cap, Math.sqrt(4 * Math.max(0, distance)));
      }
    }
    const parkAt=v.parkingTrip?.phase==='approach' ? parkingTarget(v) : null;
    if (parkAt!==null) {
      const remaining=parkAt-v.s;
      worst=Math.min(worst,stopAt(v,remaining+0.22,0.24));
      cap=Math.min(cap,Math.sqrt(3.6*Math.max(remaining,0)));
    }
    worst=Math.min(worst,stopForMappedCrossings(v,v.conn?v.move.to:e));
    if (limit) {
      if (limit.distance<LOOKAHEAD) worst=Math.min(worst,stopAt(v,limit.distance+.18,.18));
      cap=Math.min(cap,limit.speed,Math.sqrt(4.4*limit.distance));
    }
    cap = Math.min(cap, roadSpeed(v));
    const pg = playerGap(v, 0);
    if (pg > 0 && pg < LOOKAHEAD) { // (a player alongside, not yet clear ahead, isn't one to follow)
      worst = Math.min(worst, brake(v, pg, v.pSpeed));
      if (pg < v.gap) {
        v.gap = pg;
        v.leaderSpeed = v.pSpeed;
      }
    }
    const acc = Math.min(freeAcc(v) + worst, (cap - v.speed) * 2);
    v.acc = clamp(acc, -9, v.driver.a);
    // dodging the player: braking (as hard as it can, unless that would stop it before it has swerved out of the way),
    // or flooring it (unless it must brake for something ahead)
    if (clock < v.panicUntil) {
      if (v.panicAcc < 0) v.acc = Math.min(v.acc, v.evade ? -v.driver.b : -v.driver.bMax);
      else if (v.acc > -v.driver.b && v.speed < 1.5 * v.v0) v.acc = Math.max(v.acc, 1.5 * v.driver.a);
    }
  }

  // Dodging the player, as people do: late, and without second thoughts. A driver who sees the player about to hit it
  // (within AVOID_NOTICE seconds, both keeping on as they go) reacts only once that has lasted its reaction time, by
  // when it is almost too late. Then it commits to one manoeuvre: braking if the player would hit its front half (hard,
  // unless it swerves too: a car that stops can't get out of the way), flooring it if its rear half (braking would only
  // make that worse), and swerving to one side if the road is clear
  // there: away from the player (behind a player crossing its way, to the right if the player comes straight at it),
  // unless there is more room the other way.
  // It keeps that up for AVOID_HOLD seconds at least, and for as long as the player is still about to hit it.
  function react(v, dt) {
    const t = player.active && Math.abs(player.y - v.y) < 1.8 && v.impactTime === 0 ? threatTime(v) : Infinity;
    if (v.impactTime > 0 || (v.panicUntil && clock >= v.panicUntil)) {
      v.evade = v.panicUntil = v.panicAcc = v.alarm = 0; // hit after all, or over
    }
    if (v.panicUntil) {
      if (t < AVOID_NOTICE) v.panicUntil = Math.max(v.panicUntil, clock + 0.5);
      return;
    }
    if (t >= AVOID_NOTICE) {
      v.alarm = 0;
      return;
    }
    v.alarm += dt;
    if (v.alarm < v.reaction) return;
    v.panicUntil = clock + AVOID_HOLD;
    v.panicAcc = threat.ahead < 0 ? 1 : -1;
    if (v.speed < 2) return;
    // where the player will be across v's way a moment after it would hit: v swerves away from there, or the other way
    // if there is more room on that side
    const later = threat.aside + threat.across * 0.5;
    const side = Math.abs(later) < 0.3 ? 1 : -Math.sign(later);
    const room = swerveRoom(v, side);
    const other = swerveRoom(v, -side);
    v.evade = other > room ? -side * other : side * room;
  }

  // Seconds until the player would hit v (with a little margin), both keeping on straight as they go; Infinity if not
  // within AVOID_NOTICE. Where it would hit goes in `threat`: the player's position ahead of v and to its right then,
  // and its speed across v's heading.
  const threat = { ahead: 0, aside: 0, across: 0 };
  function threatTime(v) {
    const dx = player.x - v.x;
    const dz = player.z - v.z;
    if (Math.abs(dx) > 90 || Math.abs(dz) > 90) return Infinity;
    const hx = Math.sin(v.yaw);
    const hz = Math.cos(v.yaw);
    const ahead = dx * hx + dz * hz;
    const aside = dz * hx - dx * hz;
    const along = player.vx * hx + player.vz * hz - v.speed;
    const across = player.vz * hx - player.vx * hz;
    // the player's half extents along and across v's heading, as it is turned
    const c = Math.abs(player.fx * hx + player.fz * hz);
    const s = Math.abs(player.fz * hx - player.fx * hz);
    const reachAhead = v.halfL + player.halfL * c + player.halfW * s + 0.3;
    const reachAside = v.halfWidth + player.halfL * s + player.halfW * c + 0.3;
    let enter = 0;
    let exit = AVOID_NOTICE;
    for (let k = 0; k < 2; k++) {
      const p = k ? aside : ahead;
      const m = k ? across : along;
      const r = k ? reachAside : reachAhead;
      if (Math.abs(m) < 1e-6) {
        if (Math.abs(p) >= r) return Infinity;
        continue;
      }
      const t0 = (-r - p) / m;
      const t1 = (r - p) / m;
      enter = Math.max(enter, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
    }
    if (enter >= exit) return Infinity;
    threat.ahead = ahead + along * enter;
    threat.aside = aside + across * enter;
    threat.across = across;
    return enter;
  }

  // How far right (side 1) or left (-1) of its lane centre v can swerve: well over, a little, or not at all, as far as
  // the road is clear beside it there and a little way ahead
  function swerveRoom(v, side) {
    const rx = -v.tz;
    const rz = v.tx;
    for (const r of [2.2, 1.2]) {
      const off = side * (r + v.halfWidth) - v.dl;
      let clear = true;
      for (const a of [0, v.half + v.speed * 0.6]) {
        if (!network.isRoadClear(v.x + rx * off + v.tx * a, v.z + rz * off + v.tz * a, 0.2)) clear = false;
      }
      if (clear) return r;
    }
    return 0;
  }

  // Front bumper at the stop line: cross if allowed, or if going too fast to stop; otherwise wait there
  function enter(v) {
    const e = v.edge;
    if (!mayEnter(v, 0)) {
      const j = v.move?.out[v.lane] ?? -1;
      if (v.speed<4 || j<0 || roadTraffic.isClosed(v.move.to) || !legalTurn(v,v.move) ||
          controls?.approach(e,roadMode(v)) || v.pilotStopDistance<=0.35) {
        v.s = e.len - lineClearance(v);
        v.speed = 0;
        return;
      }
      v.out = j;
      v.yielding = false;
    }
    v.cs = v.s - e.len;
    v.conn = connector(e, v.lane, v.move.to, v.out);
    claim(v); // at once, so vehicles deciding later this frame know
  }

  function leave(v) {
    v.s = v.cs - v.conn.len;
    controls?.resetVehicle(v);
    v.turnHistory=network.turnRestrictionState?.(v.turnHistory,v.move,roadMode(v));
    if (v.destinationTrip?.steps[v.destinationTrip.index]?.move===v.move) v.destinationTrip.index++;
    v.edge = v.move.to;
    if (recentlyUsedRoads && !v.bus) recentlyUsedRoads.set(v.edge,clock);
    v.lane = v.out;
    v.trail = v.conn; // the rear axle is still on it
    v.conn = null;
    v.commit = null;
    if (v.busDetour) {
      v.busDetour.index++;
      if (v.busDetour.index===v.busDetour.steps.length) {
        v.busLeg=v.busDetour.rejoin;
        v.busDetour=null;
      }
    } else if (v.busRun) v.busLeg++;
    if (v.parkingTrip?.phase==='approach') v.parkingTrip.step++;
    v.move = chooseMove(v, false);
  }

  function parkingTarget(v) {
    const trip=v.parkingTrip;
    return trip?.phase==='approach' && !v.conn && v.edge===trip.link.entrance.edge &&
      v.lane===trip.link.entrance.lane ? trip.link.entrance.s : null;
  }

  function restoreDestination(v) {
    const trip=v.destinationTrip;
    if (!trip || v.conn || v.parkingTrip) return true;
    const remaining=trip.goal.edge===v.edge ? trip.goal.at-v.s : Infinity;
    if (trip.hub.parking && remaining<34 && clock>=(v.nextDestinationParking??0)) {
      v.nextDestinationParking=clock+1.5;
      if (parking?.routeArrival(v,clock,trip.hub.parking)) {
        trips.finished('road',trip);
        v.destinationTrip=null;
        v.move=chooseMove(v,true);
        return true;
      }
    }
    if (remaining<=v.half+1) {
      trips.finished('road',trip);
      v.destinationTrip=null;
    } else if (v.move && roadTraffic.isClosed(v.move.to)) {
      v.commit=null;
      const replanned=trips.road(v,trip);
      if (replanned===undefined) return false;
      v.destinationTrip=replanned;
      v.move=chooseMove(v,true);
    }
    return true;
  }

  function rejoinBus(v) {
    if (v.conn || !trips || clock<(v.nextDetourAt??0) || !v.move || !roadTraffic.isClosed(v.move.to)) return;
    const stop=v.busPath.stops[v.busStopIndex];
    if (!v.busDetour && stop?.leg===v.busLeg) return;
    const last=Math.min(stop?.leg??Infinity,v.busPath.legs.length-1,v.busLeg+6);
    const first=v.busDetour?.rejoin??v.busLeg+2;
    const targets=[];
    for (let i=first;i<=last;i++) {
      const leg=v.busPath.legs[i];
      if (leg.road!==v.edge && !roadTraffic.isClosed(leg.road)) targets.push({leg,index:i});
    }
    const detour=targets.length ? trips.busDetour(v,targets) : null;
    if (detour===undefined) return;
    v.nextDetourAt=clock+4;
    if (detour?.steps.length) {
      v.busDetour={...detour,index:0,rejoin:detour.goal.index};
      v.move=detour.steps[0].move;
      v.liveCruise=undefined;
      trips.stats.bus.rerouted++;
    } else trips.stats.bus.failed++;
  }

  function drive(v, dt) {
    const routeReady=!v.destinationTrip || restoreDestination(v);
    if (!v.conn && v.parkingTrip?.phase==='approach') {
      const trip=v.parkingTrip;
      const full=!parking.accepts(trip);
      const target=parkingTarget(v);
      if (full || clock>=trip.expires || roadTraffic.isClosed(trip.link.entrance.edge) ||
          (target!==null && v.s>target+0.5)) {
        const retries=trip.retries??0;
        parking.cancel(v,clock);
        if (full && retries<2 && parking.routeArrival(v,clock)) v.parkingTrip.retries=retries+1;
        v.move=chooseMove(v,true);
      }
    }
    if (routeReady && !v.conn && !v.busRun && (v.move ? roadTraffic.isClosed(v.move.to) : clock >= (v.nextRouteCheck ?? 0))) {
      v.commit = null;
      v.move = chooseMove(v, false);
      v.nextRouteCheck = clock + 1;
    }
    let stop = null;
    if (v.busRun) {
      if (v.busAtStop) {
        if (clock < v.busDwellUntil) {
          v.speed = v.acc = 0;
          return;
        }
        v.busAtStop = null;
        v.busStopIndex++;
      }
      rejoinBus(v);
      stop = !v.conn && !v.busDetour && busStopHere(v);
      v.off = 0;
      if (stop && stop.side > 1.8 && busStopTarget(v, stop) - v.s < 26) {
        const offset = clamp(stop.side - 1.65, 0, 0.9);
        const p = fittedLanePoint(v.edge, v.lane, stop.at, fittedA);
        if (network.isRoadClear(p.x - p.dz * offset, p.z + p.dx * offset, v.halfWidth)) v.off = offset;
      }
    } else if (!v.parkingTrip && !v.destinationTrip) {
      v.laneTimer -= dt;
      if (v.laneTimer <= 0) {
        v.laneTimer = (v.bike ? 0.15 : 0.4) + Math.random() * 0.3;
        changeLanes(v);
      }
    }
    accelerate(v);
    // Give the driver a moment to recover after an impact before accelerating again.
    v.impactTime = Math.max(0, v.impactTime - dt);
    if (v.impactTime > 0) v.acc = Math.min(0, v.acc);
    const speed = v.speed;
    v.speed = Math.min(roadSpeed(v), Math.max(0, v.speed + v.acc * dt));
    let ds = v.speed * Math.cos(v.nose) * dt * (v.stationScale ?? 1);
    if (v.impactTime === 0 && ds > v.gap - 0.3) {
      // never into the vehicle ahead
      ds = Math.max(0, v.gap - 0.3);
      v.speed = Math.min(v.speed, v.leaderSpeed);
    }
    if (Number.isFinite(v.pilotStopDistance) && ds>=v.pilotStopDistance) {
      ds=v.pilotStopDistance;
      v.speed=0;
    }
    v.acc = Math.max(-9, (v.speed - speed) / dt); // as driven, for the body to pitch with: none standing still
    v.wait = v.speed < 0.5 ? v.wait + dt : 0;
    if (!v.conn) {
      v.s += ds;
      const parkAt=v.parkingTrip?.phase==='approach' ? parkingTarget(v) : null;
      if (parkAt!==null && v.s>=parkAt-0.24) {
        v.s=parkAt;
        v.speed=0;
        v.dl=v.nose=v.steer=0;
        const trip=v.parkingTrip;
        trip.phase='maneuver';
        trip.distance=0;
        trip.expires=clock+90;
        return;
      }
      if (stop && v.s >= busStopTarget(v, stop) - 0.22 && (v.speed < 1.1 || v.s >= busStopTarget(v, stop))) {
        const [arrival, departure] = v.busRun.trip.stops[stop.index];
        v.s = Math.min(v.s, busStopTarget(v, stop));
        v.busAtStop = stop.stop;
        v.busDwellUntil = clock + clamp(departure - arrival, 6, 20);
        v.speed = 0;
      } else if (!v.busRun && !v.move && v.edge.motorwayExit && v.s - v.half >= v.edge.len) {
        v.edge = null;
        return;
      } else if (!v.busRun && !v.move && !v.edge.motorwayExit && v.s + v.half >= v.edge.len) {
        v.s = Math.max(0, v.edge.len - v.half);
        v.speed = 0;
      } else if (!stop && v.move && v.s + lineClearance(v) >= v.edge.len) {
        enter(v);
      } else if (v.busRun && !v.busDetour && !v.move && !stop && v.s >= v.busPath.legs[v.busLeg].to - 0.1) {
        finishBus(v);
        return;
      }
    } else {
      v.cs += ds;
      if (v.cs >= v.conn.len) leave(v);
    }
    steer(v, dt);
  }

  // The driver at the wheel. It steers for the bend in its path a moment ahead (on through the intersection ahead the
  // way it plans to cross it), to head along its path, and back onto it: onto its lane centre after lane changes and
  // knocks, or right of it by however far it swerves out of the player's way (Stanley steering). It turns the front
  // wheels no faster than a person does and no further than it is comfortable with (or, in a panic, than the tyres
  // grip). The car turns only as fast as its front wheels turn it, the tyres sliding at their grip; a knock's spin
  // turns it too, the tyres scrubbing that off. Heading off its path, it drifts across it.
  const bendA = { x: 0, z: 0, dx: 0, dz: 1 };
  const bendB = { x: 0, z: 0, dx: 0, dz: 1 };
  function steer(v, dt) {
    const panic = !!v.evade;
    const wheelbase = 2 * v.axle;
    const c = v.conn ? v.cs : v.s;
    // the bend a moment ahead, as the wheel takes a while to turn: its curvature (to the left) over 2 m
    const ahead = v.axle + 0.5 * v.speed;
    previewPoint(v, c + ahead, bendA);
    previewPoint(v, c + ahead + 2, bendB);
    let bend = Math.atan2(bendB.dx, bendB.dz) - Math.atan2(bendA.dx, bendA.dz);
    bend -= Math.round(bend / (Math.PI * 2)) * Math.PI * 2;
    // ...plus how far right of its path it heads, and how far right of where it should be it is (nose and dl - evade)
    const off = v.dl - (v.evade || 0) - (v.off || 0);
    const want = Math.atan((wheelbase * bend) / 2) + v.nose + Math.atan(((panic ? 3 : 1.2) * off) / (1 + v.speed));
    const lateral = panic ? v.driver.grip : 1.3 * v.driver.aLat; // the sideways acceleration it steers up to
    const most = Math.min(v.driver.lock, Math.atan((lateral * wheelbase) / Math.max(v.speed * v.speed, 1e-3)));
    const rate = v.driver.steerRate * (panic ? 2.5 : clamp(8 / Math.max(v.speed, 1), 1, 3)) * dt;
    v.delta += clamp(clamp(want, -most, most) - v.delta, -rate, rate);
    const slide = v.driver.grip / Math.max(v.speed, 0.1);
    v.yawRate = clamp((v.speed * Math.tan(v.delta)) / wheelbase, -slide, slide);
    v.yaw += (v.yawRate + v.yawVel) * dt;
    v.yaw -= Math.round(v.yaw / (Math.PI * 2)) * Math.PI * 2;
    v.yawVel *= Math.exp(-4 * dt);
    if (Math.abs(v.yawVel) < 1e-3) v.yawVel = 0;
    // across its path, heading off it (nose: how far right of its path it heads)
    let nose = Math.atan2(v.tx, v.tz) - v.yaw;
    nose -= Math.round(nose / (Math.PI * 2)) * Math.PI * 2;
    v.dlv = v.speed * Math.sin(nose);
    v.dl += v.dlv * dt;
  }

  function lanePoint(e, i, s, out) {
    if (e.fittedLanes?.[i]) return fittedLanePoint(e, i, s, out);
    out.x = e.sx + e.dx * s + e.rx * e.lanes[i];
    out.z = e.sz + e.dz * s + e.rz * e.lanes[i];
    out.dx = e.dx;
    out.dz = e.dz;
    out.stationScale = 1;
    return out;
  }

  // Point and direction c metres along v's path, as pathPoint, but on through the intersection ahead the way v plans
  // to cross it
  function previewPoint(v, c, out) {
    const e = v.edge;
    const j = v.conn || c <= e.len || !v.move ? -1 : v.move.out[v.lane];
    if (!(j >= 0)) return pathPoint(v, c, out);
    const k = connector(e, v.lane, v.move.to, j);
    if (c - e.len <= k.len) return curvePoint(k, c - e.len, out);
    return lanePoint(v.move.to, j, c - e.len - k.len, out);
  }

  // Point and direction at distance c along v's path: its lane, the curve through the intersection, and the
  // lane after it (or, just out of an intersection, the curve it came along)
  function pathPoint(v, c, out) {
    const e = v.edge;
    if (v.conn) {
      if (c < 0) return lanePoint(e, v.lane, e.len + c, out);
      if (c > v.conn.len) return lanePoint(v.move.to, v.out, c - v.conn.len, out);
      return curvePoint(v.conn, c, out);
    }
    if (c < 0 && v.trail) return curvePoint(v.trail, v.trail.len + c, out);
    return lanePoint(e, v.lane, c, out);
  }

  // World position from where v is along its path (dl to the right of it), the path's direction there, and how far
  // right of it v heads (nose)
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  function locate(v) {
    at.stationScale = 1;
    pathPoint(v, v.conn ? v.cs : v.s, at);
    v.stationScale = at.stationScale;
    v.tx = at.dx;
    v.tz = at.dz;
    v.x = at.x - at.dz * v.dl;
    v.z = at.z + at.dx * v.dl;
    const nose = Math.atan2(at.dx, at.dz) - v.yaw;
    v.nose = nose - Math.round(nose / (Math.PI * 2)) * Math.PI * 2;
  }

  // Move v along and across its path by (dx, dz), as far as the road allows
  function shove(v, dx, dz) {
    const along = (dx * v.tx + dz * v.tz) * (v.stationScale ?? 1);
    if (v.edge.mapped) {
      v.s = clamp(v.s + along, 0, v.edge.len);
      locateBike(v);
      return;
    }
    if (v.conn) v.cs = clamp(v.cs + along, -v.half, v.conn.len - 0.01);
    else v.s = clamp(v.s + along, 0, v.edge.len - v.half);
    v.dl = clamp(v.dl + dz * v.tx - dx * v.tz, -2.5, 2.5);
    locate(v);
  }

  // Steering shown on the front wheels, turn signals, and body pitch & roll from acceleration & turning (the heading
  // itself is the driver's doing, see steer)
  function pose(v, dt) {
    v.steer = v.delta;

    const turn = v.move?.turn ?? 'S';
    if (v.evade) v.blink = 0; // no time to signal a swerve
    else if (Math.abs(v.dl) > 0.3 && Math.abs(v.dlv) > 0.05) v.blink = v.dl > 0 ? -1 : 1;
    else if (turn !== 'S' && (v.conn || v.edge.len - v.s < 35)) v.blink = turn === 'R' ? 1 : -1;
    else v.blink = 0;

    v.pitchVel += ((-0.008 * v.acc - v.pitch) * 68.0 - v.pitchVel * 10.8) * dt;
    v.pitch = clamp(v.pitch + v.pitchVel * dt, -0.22, 0.22);
    v.rollVel += ((0.01 * v.speed * v.yawRate - v.roll) * 68.0 - v.rollVel * 10.8) * dt;
    v.roll = clamp(v.roll + v.rollVel * dt, -0.26, 0.26);
  }

  // Knock velocity from collisions carries v along and across its path, and dies down
  function knock(v, dt) {
    if (v.vx === 0 && v.vz === 0) return;
    shove(v, v.vx * dt, v.vz * dt);
    const damp = Math.exp(-3.5 * dt);
    v.vx *= damp;
    v.vz *= damp;
    if (v.vx * v.vx + v.vz * v.vz < 1e-4) v.vx = v.vz = 0;
  }

  const contactA = {}, contactB = {}, vehicleHit = {};
  const impacted = [];
  let collisionStep = 0;

  function readTrafficBody(v, body) {
    const heading = v.yaw + v.yawOffset;
    body.x = v.x; body.z = v.z;
    body.prevX = v.prevX; body.prevZ = v.prevZ;
    body.sin = Math.sin(heading); body.cos = Math.cos(heading);
    body.halfW = v.halfWidth;
    // Vehicles without their own collision size & mass count as sedans
    body.halfL = v.halfL ?? 2.18;
    body.mass = v.mass ?? 1600;
    body.vx = body.sin * v.speed + v.vx;
    body.vz = body.cos * v.speed + v.vz;
    body.angularVel = v.yawRate + v.yawVel;
  }

  function writeTrafficVelocity(v, body) {
    // Keep longitudinal momentum in the driving speed, so it does not disappear
    // with the short-lived tire slip. Traffic can be knocked backwards too.
    const hx = Math.sin(v.yaw + v.yawOffset);
    const hz = Math.cos(v.yaw + v.yawOffset);
    v.speed = Math.max(0, body.vx * hx + body.vz * hz);
    v.vx = body.vx - hx * v.speed;
    v.vz = body.vz - hz * v.speed;
    // the spin turns its heading (see steer)
    v.yawVel = body.angularVel - v.yawRate;
  }

  function impactSuspension(v, nx, nz, speed) {
    const along = nx * v.tx + nz * v.tz;
    const across = nx * v.tz - nz * v.tx;
    const kick = Math.min(10, speed);
    v.pitchVel += along * kick * 0.12;
    v.rollVel -= across * kick * 0.16;
    v.impactTime = Math.max(v.impactTime, 0.8);
  }

  function collideWithPlayer(v) {
    const pe = player.entity;
    if (v.edge.unmodeledTunnel || Math.abs(pe.position.y - v.y) > 1.8) return;
    if (v.parkingTrip?.phase==='maneuver') {
      collideParkedPlayer(v.x,v.y,v.z,v.yaw);
      return;
    }
    const reach = v.half + player.halfL + player.halfW;
    const prevX = pe.prevX ?? pe.position.x, prevZ = pe.prevZ ?? pe.position.z;
    const dx = pe.position.x - prevX - v.x + v.prevX;
    const dz = pe.position.z - prevZ - v.z + v.prevZ;
    if (Math.abs(pe.position.x - v.x) > reach + Math.abs(dx)
      || Math.abs(pe.position.z - v.z) > reach + Math.abs(dz)) return;
    const a = contactA, b = contactB, hit = vehicleHit;
    const heading = pe.heading || 0;
    a.x = pe.position.x; a.z = pe.position.z;
    a.prevX = prevX; a.prevZ = prevZ;
    a.sin = Math.sin(heading); a.cos = Math.cos(heading);
    a.halfW = player.halfW; a.halfL = player.halfL;
    a.mass = pe.type === 'car' ? 1700 : pe.type === 'cargobike' ? 140 : pe.type === 'cyclist' ? 95 : 80;
    a.vx = a.sin * (pe.speed || 0) + (pe.vx || 0);
    a.vz = a.cos * (pe.speed || 0) + (pe.vz || 0);
    a.angularVel = pe.type === 'car' ? pe.angularVel || 0 : 0;
    readTrafficBody(v, b);
    if (!sweptVehicleContact(a, b, hit) && !vehicleContact(a, b, hit)) return;
    const speed = resolveVehicleContact(a, b, hit);
    const pShare = b.mass / (a.mass + b.mass);
    pe.position.x = hit.ax + hit.nx * hit.depth * pShare;
    pe.position.z = hit.az + hit.nz * hit.depth * pShare;
    shove(v, hit.bx - v.x - hit.nx * hit.depth * (1 - pShare), hit.bz - v.z - hit.nz * hit.depth * (1 - pShare));
    // A route boundary can prevent traffic taking its full share of the correction.
    const remainder = Math.max(0, hit.depth * (1 - pShare) + (v.x - hit.bx) * hit.nx + (v.z - hit.bz) * hit.nz);
    pe.position.x += hit.nx * remainder;
    pe.position.z += hit.nz * remainder;
    if (pe.mesh) pe.mesh.position.copy(pe.position);
    if (speed <= 0) return;

    writeTrafficVelocity(v, b);
    pe.speed = a.vx * a.sin + a.vz * a.cos;
    if (pe.type === 'car') {
      pe.vx = a.vx - a.sin * pe.speed;
      pe.vz = a.vz - a.cos * pe.speed;
      pe.angularVel = a.angularVel;
      const kick = Math.min(12, hit.impulse / a.mass);
      pe.pitchVel += (hit.nx * a.sin + hit.nz * a.cos) * kick * 0.16;
      pe.rollVel -= (hit.nx * a.cos - hit.nz * a.sin) * kick * 0.2;
      pe.heaveVel += Math.min(0.7, kick * 0.06);
    }
    impactSuspension(v, -hit.nx, -hit.nz, hit.impulse / b.mass);
    const y = v.y + 0.58;
    if (pe.type !== 'person') reportCollision(pe, v, hit.x, y, hit.z, hit.nx, hit.nz, speed);
    if (speed > 2.2) spawnCollisionSparks(hit.x, y, hit.z, hit.nx, hit.nz, speed);
  }

  function collideParkedPlayer(x,y,z,heading) {
    const pe=player.entity;
    if (Math.abs(pe.position.y-y)>1.55 || Math.abs(pe.position.x-x)>6 || Math.abs(pe.position.z-z)>6) return;
    const a=contactA, b=contactB, hit=vehicleHit;
    const pyaw=pe.heading || 0;
    Object.assign(a,{x:pe.position.x,z:pe.position.z,prevX:pe.prevX??pe.position.x,prevZ:pe.prevZ??pe.position.z,
      sin:Math.sin(pyaw),cos:Math.cos(pyaw),halfW:player.halfW,halfL:player.halfL});
    Object.assign(b,{x,z,prevX:x,prevZ:z,sin:Math.sin(heading),cos:Math.cos(heading),halfW:0.94,halfL:2.25});
    if (!sweptVehicleContact(a,b,hit) && !vehicleContact(a,b,hit)) return;
    pe.position.x=hit.ax+hit.nx*(hit.depth+0.025);
    pe.position.z=hit.az+hit.nz*(hit.depth+0.025);
    if (pe.type==='car' || pe.type==='cyclist' || pe.type==='cargobike') {
      pe.speed*=0.12;
      pe.vx=pe.vz=0;
    }
    pe.mesh?.position.copy(pe.position);
  }

  // Only disturbed traffic needs pair contacts. Newly struck cars join the same
  // queue, and each pair is visited once before any instance matrices are written.
  function collideTraffic() {
    collisionStep++;
    impacted.length = 0;
    for (const v of vehicles) {
      if (v.edge && v.parkingTrip?.phase!=='maneuver' &&
          (v.impactTime > 0 || Math.abs(v.yawVel) > 0.05 || v.vx * v.vx + v.vz * v.vz > 0.04)) {
        v.contactStep = collisionStep;
        impacted.push(v);
      }
    }
    for (let i = 0; i < impacted.length; i++) {
      const v = impacted[i];
      for (const o of vehicles) {
        if (o === v || !o.edge || o.parkingTrip?.phase==='maneuver' || o.edge.unmodeledTunnel ||
            v.edge.unmodeledTunnel || o.contactDone===collisionStep || Math.abs(o.y-v.y)>1.8) continue;
        const reach = v.half + o.half + 0.5;
        const dx = v.x - o.x, dz = v.z - o.z;
        if (Math.abs(dx) > reach + Math.abs(dx - v.prevX + o.prevX)
          || Math.abs(dz) > reach + Math.abs(dz - v.prevZ + o.prevZ)) continue;
        readTrafficBody(v, contactA);
        readTrafficBody(o, contactB);
        const hit = vehicleHit;
        if (!sweptVehicleContact(contactA, contactB, hit) && !vehicleContact(contactA, contactB, hit)) continue;
        const speed = resolveVehicleContact(contactA, contactB, hit);
        const share = contactB.mass / (contactA.mass + contactB.mass);
        shove(v, hit.ax - v.x + hit.nx * hit.depth * share, hit.az - v.z + hit.nz * hit.depth * share);
        shove(o, hit.bx - o.x - hit.nx * hit.depth * (1 - share), hit.bz - o.z - hit.nz * hit.depth * (1 - share));
        if (speed <= 0) continue;
        writeTrafficVelocity(v, contactA);
        writeTrafficVelocity(o, contactB);
        impactSuspension(v, hit.nx, hit.nz, hit.impulse / contactA.mass);
        impactSuspension(o, -hit.nx, -hit.nz, hit.impulse / contactB.mass);
        const y = v.y + 0.56;
        reportCollision(v, o, hit.x, y, hit.z, hit.nx, hit.nz, speed);
        if (speed > 2.2) spawnCollisionSparks(hit.x, y, hit.z, hit.nx, hit.nz, speed);
        if (o.contactStep !== collisionStep) {
          o.contactStep = collisionStep;
          impacted.push(o);
        }
      }
      v.contactDone = collisionStep;
    }
  }

  // =========================================================================
  // 6. PLACING VEHICLES
  // =========================================================================
  // Room at s in a lane list: margin metres to the vehicles either side, and two seconds more for the one behind
  function laneClear(list,s,margin,self) {
    for (const o of list) if (o.v!==self && Math.abs(o.s-s)<o.v.half+margin+(o.s<s?2*o.v.speed:0)) return false;
    return true;
  }

  function place(v, e, lane, s) {
    v.edge = e;
    v.lane = lane;
    v.s = s;
    if (recentlyUsedRoads && !v.bus) recentlyUsedRoads.set(e,clock);
    v.turnHistory=null;
    v.destinationTrip=null;
    v.nextDestinationParking=0;
    v.pilotStopDistance=Infinity;
    controls?.resetVehicle(v);
    v.conn = null;
    v.trail = null;
    v.commit = null;
    v.yielding = false;
    v.wait = 0;
    v.speed = Math.min(roadTraffic.limit(e), roadTraffic.cruise(e, v.v0) * 0.5);
    v.acc = 0;
    v.impactTime = 0;
    v.dl = v.dlv = 0;
    v.evade = v.alarm = v.panicUntil = v.panicAcc = 0;
    v.vx = v.vz = v.yawOffset = v.yawVel = v.pitch = v.pitchVel = v.roll = v.rollVel = 0;
    locate(v);
    v.prevX = v.x;
    v.prevZ = v.z;
    v.yaw = Math.atan2(v.tx, v.tz); // (placed heading down its lane)
    v.nose = v.yawRate = v.steer = v.delta = 0;
    v.move = chooseMove(v, false);
    occupy(e.occ[lane], v, s);
  }

  const parkingSample={}, parkingLook={}, parkingBody={}, parkedCheck={};
  function parkingClear(v, sample, look) {
    const x=sample.x, z=sample.z, y=sample.y;
    const lx=look.x, lz=look.z;
    if (player.active && Math.abs(y-player.y)<1.5 &&
        ((player.x-lx)**2+(player.z-lz)**2<10 || (player.x-x)**2+(player.z-z)**2<6)) return false;
    for (const other of vehicles) {
      if (other===v || !other.edge || Math.abs(y-other.y)>1.55 || Math.abs(other.x-x)>17 || Math.abs(other.z-z)>17) continue;
      const ahead=other.bike ? 0.65 : 0.24;
      const dx=other.x+other.tx*other.speed*ahead-lx, dz=other.z+other.tz*other.speed*ahead-lz;
      const near=other.bike?2.65:other.half>4?4.1:3.45;
      if (dx*dx+dz*dz<near*near || (other.x-x)**2+(other.z-z)**2<near*near*0.72) return false;
    }
    for (const person of pedestrianSystem.peds) {
      if (person.placed && Math.abs(y-person.y)<1.55 &&
          ((person.x-lx)**2+(person.z-lz)**2<5.3 || (person.x-x)**2+(person.z-z)**2<4)) return false;
    }
    let nearbyClear=true;
    parkingBody.x=x; parkingBody.z=z;
    parkingBody.sin=Math.sin(sample.yaw); parkingBody.cos=Math.cos(sample.yaw);
    parkingBody.halfW=0.87; parkingBody.halfL=2.13;
    parking.forParked(x,z,5,({space})=>{
      if (!nearbyClear || space===v.parkingTrip.token.space || Math.abs(y-space.y)>1.55) return;
      const heading=space.heading;
      parkedCheck.x=space.x; parkedCheck.z=space.z;
      parkedCheck.sin=Math.sin(heading); parkedCheck.cos=Math.cos(heading);
      parkedCheck.halfW=0.88; parkedCheck.halfL=2.14;
      if (vehicleContact(parkingBody,parkedCheck,vehicleHit)) nearbyClear=false;
    });
    return nearbyClear;
  }

  function setManeuverPose(v,path,s) {
    const pose=parkingPose(path,s,parkingSample);
    Object.assign(v,{x:pose.x,y:pose.y,z:pose.z,yaw:pose.yaw,
      tx:Math.sin(pose.yaw)*(pose.reversing?-1:1),tz:Math.cos(pose.yaw)*(pose.reversing?-1:1)});
  }

  function moveParking(v,dt) {
    const trip=v.parkingTrip, incoming=trip.token.kind==='arrival';
    const path=incoming?trip.link.arrival:trip.link.departure;
    const finish=incoming?trip.link.entrance:trip.link.exit;
    if (clock>=trip.expires || (!incoming && roadTraffic.isClosed(finish.edge))) {
      parking.cancel(v,clock);
      v.edge=null;
      return;
    }
    const top=path.length>24?4.5:2.05;
    const last=v.speed;
    const next=Math.min(top,Math.sqrt(Math.max(.06,2.6*(path.length-trip.distance))),last+dt*1.35);
    const s=Math.min(path.length,trip.distance+dt*next);
    parkingPose(path,s,parkingSample);
    parkingPose(path,Math.min(path.length,s+1.7+next*.4),parkingLook);
    if (!parkingClear(v,parkingSample,parkingLook) ||
        (!incoming && path.length-s<4 && !laneClear(finish.edge.occ[finish.lane],finish.s,5.7,v))) {
      v.speed=0;
      v.acc=-Math.min(3,last/dt);
      return;
    }
    v.speed=next;
    v.acc=(next-last)/dt;
    trip.distance=s;
    setManeuverPose(v,path,s);
    v.blink=incoming?1:-1;
    if (s<path.length-0.001) return;
    parking.finish(v);
    if (incoming) v.edge=null;
    else {
      place(v,finish.edge,finish.lane,finish.s);
      v.speed=Math.min(3,next);
      if (trips) {
        v.destinationTrip=trips.road(v);
        if (v.destinationTrip) v.move=chooseMove(v,true);
      }
    }
  }

  function spawnParkingDeparture(v) {
    if (!parking?.enabled) return false;
    const trip=parking.selectDeparture(v,clock,(lane,space)=>
      laneClear(lane.edge.occ[lane.lane],lane.s,6) &&
      (!player.active || Math.abs(player.y-(space.virtual?lane.pose.y:space.y))>1.55 ||
        (player.x-space.x)**2+(player.z-space.z)**2>36));
    if (!trip) return false;
    const {exit,departure}=trip.link;
    place(v,exit.edge,exit.lane,exit.s);
    v.parkingTrip=trip;
    const seed=trip.token.occupant.appearanceSeed;
    const {col,style}=parking.appearance(seed);
    v.parkingStyle=(seed>>>0)%fleetStyles.sedan.length;
    v.paint=[Math.fround(col.r),Math.fround(col.g),Math.fround(col.b)];
    v.style=style;
    v.speed=v.acc=0;
    setManeuverPose(v,departure,0);
    v.prevX=v.x;
    v.prevZ=v.z;
    return true;
  }

  function spawnCar(v,rMin,rMax,protectView) {
    if (spawnParkingDeparture(v)) return true;
    if (!spawnVehicle(v,rMin,rMax,protectView)) return false;
    if (trips && !v.isPolice && Math.random()<0.65) {
      v.destinationTrip=trips.road(v);
      if (v.destinationTrip) v.move=chooseMove(v,true);
    }
    return true;
  }

  // Put v in a free lane around the focus. Normal replenishment protects the near view; teleports can fill it.
  function spawnVehicle(v, rMin, rMax, protectView) {
    const spawns=v.bodyType==='van'?vanSpawns:carSpawns;
    for (let attempt = 0; attempt < 6; attempt++) {
      let e=pickByArea(spawns);
      // Spread unmeasured traffic across its legal lane area. Keep measured directions
      // on the original count-weighted draw, including when considering alternatives.
      if (e && recentlyUsedRoads && !roadTraffic.hasObservedFlow(e)) {
        let last=recentlyUsedRoads.get(e)??-Infinity;
        for (let sample=0; sample<2 && clock-last<150; sample++) {
          const alternate=pickByArea(spawns);
          const used=recentlyUsedRoads.get(alternate)??-Infinity;
          if (used<last && !roadTraffic.hasObservedFlow(alternate) && !roadTraffic.isClosed(alternate)) {
            e=alternate;
            last=used;
          }
        }
      }
      if (!e || roadTraffic.isClosed(e) || e.len < 2 * v.half + 10) continue;
      const allowed = v.bodyType === 'van' ? e.vanLanes : e.ambientLanes;
      if (allowed && !allowed.length) continue;
      const lane = allowed ? allowed[Math.floor(Math.random() * allowed.length)] : Math.floor(Math.random() * e.lanes.length);
      const along = (focusX - e.sx) * e.dx + (focusZ - e.sz) * e.dz;
      const minS = Math.max(v.half + 5, along - rMax);
      const maxS = Math.min(e.len - v.half - 5, along + rMax);
      if (minS > maxS) continue;
      const s = minS + Math.random() * (maxS - minS);
      const { x, z } = lanePoint(e, lane, s, fittedA);
      const d = Math.hypot(x - focusX, z - focusZ);
      if (d < rMin || d > rMax || (protectView && nearView(x, z, v.half + 4, VEHICLE_SPAWN_DISTANCE, roadGround(e, x, z)))) continue;
      if (player.active && Math.hypot(x - player.x, z - player.z) < 25) continue;
      if (!laneClear(e.occ[lane], s, v.half + 8)) continue;
      place(v, e, lane, s);
      return true;
    }
    return false;
  }

  function bikePoint(track, s, dir) {
    const room = track.sharedRoad ? track.width * 0.25
      : track.kind !== 'connector' && track.allowed.every(Boolean) ? track.width * 0.2 : 0;
    const offset = Math.min(room, s * 0.6, (track.len - s) * 0.6);
    return { x: track.ax + track.ux * s - track.uz * dir * offset, z: track.az + track.uz * s + track.ux * dir * offset };
  }

  function locateBike(b) {
    const { x, z } = bikePoint(b.edge, b.s, b.dir);
    b.x = x; b.z = z;
    b.tx = b.edge.ux * b.dir;
    b.tz = b.edge.uz * b.dir;
    b.yaw = Math.atan2(b.tx, b.tz);
  }

  function spawnBike(b, rMin, rMax, protectView) {
    for (let i = 0; i < 6; i++) {
      const t = pickByArea(bikeSpawns);
      if (!t || t.len < 2) continue;
      const dir = t.allowed.every(Boolean) ? (Math.random() < 0.5 ? -1 : 1) : t.allowed[0] ? 1 : -1;
      const s = Math.random() * t.len;
      const { x, z } = bikePoint(t, s, dir);
      const d = Math.hypot(x - focusX, z - focusZ), y = roadGround(t, x, z);
      if (d < rMin || d > rMax || protectView && nearView(x, z, 5, VEHICLE_SPAWN_DISTANCE, y)) continue;
      if (player.active && Math.hypot(x - player.x, z - player.z) < 12) continue;
      if (bikes.some(v => v !== b && v.edge && Math.abs(v.x - x) < 5 && Math.abs(v.z - z) < 5 && Math.abs(v.y - y) < 1.8)) continue;
      Object.assign(b, { edge: t, s, dir, speed: b.v0 * 0.8, y, vx: 0, vz: 0, yawOffset: 0, yawVel: 0, impactTime: 0 });
      b.bikePath = null;
      b.destinationTrip=trips && Math.random()<0.8 ? trips.active('bike',t,dir,s) : null;
      if (b.destinationTrip) b.dir=b.destinationTrip.startDir;
      locateBike(b);
      b.prevX = x; b.prevZ = z;
      return true;
    }
    return false;
  }

  function bikeRoute(track, dir) {
    const end = dir > 0 ? 1 : 0;
    let next = null, best = -Infinity;
    for (const path of track.links[end]) {
      const leg = path.at(-1);
      const alignment = (track.ux * leg.track.ux + track.uz * leg.track.uz) * dir * leg.dir;
      const score = alignment + (leg.track.exclusive ? 0.6 : 0) + Math.random() * 0.65;
      if (score > best) {
        next = path;
        best = score;
      }
    }
    return next?.slice() ?? (track.allowed[end] ? [{ track, dir: -dir }] : []);
  }

  function nextBikeLeg(b) {
    const trip=b.destinationTrip, step=trip?.steps[trip.index];
    if (step?.from===b.edge && step.dir===b.dir) {
      trip.index++;
      return step.legs.slice();
    }
    if (step) b.destinationTrip=null;
    return bikeRoute(b.edge,b.dir);
  }

  function driveBike(b, dt) {
    const trip=b.destinationTrip;
    if (trip?.goal.track===b.edge && (b.s-trip.goal.at)*b.dir>=-0.7) {
      trips.finished('bike',trip);
      b.destinationTrip=null;
    }
    b.impactTime = Math.max(0, b.impactTime - dt);
    if (!b.impactTime) b.speed = Math.min(b.v0, b.speed + dt);
    let gap = b.dir > 0 ? b.edge.len - b.s : b.s;
    if (gap < 12) {
      b.bikePath ??= nextBikeLeg(b);
      const next = b.bikePath[0]?.track;
      if (next?.crossing && next.crossing !== b.edge.crossing && !mayCrossMapped(next, b)) {
        // Keep an entry distance below one object length while waiting for the crossing.
        b.speed = Math.min(b.speed, Math.sqrt(5 * Math.max(0, gap - 0.35)));
      }
    }
    const edge=b.edge;
    const rail=railStop ? Math.max(0,railStop({x:b.x,y:b.y,z:b.z,dx:edge.ux*b.dir,dz:edge.uz*b.dir,
      wayId:edge.wayId,layer:edge.layer,mode:BICYCLE})-.65) : Infinity;
    b.speed=Math.min(b.speed,Math.sqrt(4.8*rail));
    b.s+=b.dir*Math.min(rail,b.speed*dt);
    for (let i = 0; i < 8 && (b.s < 0 || b.s > b.edge.len); i++) {
      const e = b.edge;
      gap = b.dir > 0 ? b.s - e.len : -b.s;
      b.bikePath ??= nextBikeLeg(b);
      const next = b.bikePath[0];
      if (!next) { b.edge = null; return; }
      if (next.track.crossing && next.track.crossing !== e.crossing && !mayCrossMapped(next.track, b)) {
        b.s = b.dir > 0 ? Math.max(0, e.len - 0.35) : Math.min(e.len, 0.35);
        b.speed = 0;
        break;
      }
      b.bikePath.shift();
      if (!b.bikePath.length) b.bikePath = null;
      b.edge = next.track;
      b.dir = next.dir;
      b.s = next.dir > 0 ? gap : b.edge.len - gap;
    }
    b.s = clamp(b.s, 0, b.edge.len);
    locateBike(b);
    knock(b, dt);
    pose(b, dt);
  }

  const busTracker = busSchedule && createEdeBusTracker(busSchedule, busPaths);
  if (busTracker) roadTraffic.onBusFeed(busTracker.acceptFeed);
  const finishedBusRuns = new Map();
  const BUS_ACTIVATE_RADIUS = 350;
  const BUS_RETIRE_RADIUS = 430;
  let nextBusScan = 0;
  let lastBusFocusX = Infinity, lastBusFocusZ = Infinity;

  function retireBus(v) {
    v.edge = v.busRun = null;
    v.liveCruise = undefined;
  }

  function finishBus(v) {
    finishedBusRuns.set(v.busRun.key, clock);
    retireBus(v);
  }

  function spawnScheduledBuses() {
    if (!busPaths.size) return;
    const cameraX = hasView ? camX : focusX, cameraZ = hasView ? camZ : focusZ;
    const moved = Math.hypot(cameraX - lastBusFocusX, cameraZ - lastBusFocusZ);
    if (clock < nextBusScan && moved < 70) return;
    nextBusScan = clock + 0.5;
    lastBusFocusX = cameraX;
    lastBusFocusZ = cameraZ;
    const due = busTracker.tripsAt(clock);
    const live = new Map(due.filter(run => run.live).map(run => [run.tripKey, run]));
    const active = new Set();
    for (const bus of buses) {
      if (!bus.edge) continue;
      if (Math.hypot(bus.x - cameraX, bus.z - cameraZ) > BUS_RETIRE_RADIUS) {
        retireBus(bus);
        continue;
      }
      const run = live.get(bus.busRun.tripKey);
      const distance = busRouteDistance(bus.busPath, bus.busLeg, bus.conn ? bus.edge.len : bus.s);
      bus.liveCruise = run && !bus.busDetour ? busTrackingSpeed(distance, run) : undefined;
      active.add(bus.busRun.tripKey);
    }
    for (const [key, time] of finishedBusRuns) {
      if (clock - time > 7200) finishedBusRuns.delete(key);
    }
    const nearby = [];
    for (const run of due) {
      const path = busPaths.get(run.slice);
      if (!path || active.has(run.tripKey) || finishedBusRuns.has(run.key)) continue;
      let entry = busEntryAt(path, run.distance, true);
      if (!run.live && roadTraffic) {
        const blocked = path.legs.findIndex(({ road }, index) => index <= entry.leg && roadTraffic.isClosed(road));
        if (blocked === 0) continue;
        if (blocked > 0) {
          const previous = path.legs[blocked - 1];
          entry = busEntryAt(path, busRouteDistance(path, blocked - 1, previous.to - 12), true);
        }
      }
      const { road, lane } = path.legs[entry.leg];
      if (roadTraffic?.isClosed(road)) continue;
      const { x, z } = lanePoint(road, lane, entry.at, fittedA);
      const distance = Math.hypot(x - cameraX, z - cameraZ);
      if (distance <= BUS_ACTIVATE_RADIUS) nearby.push({ run, path, entry, road, lane, x, z, distance });
    }
    nearby.sort((a, b) => a.distance - b.distance);
    for (const { run, path, entry, road, lane, x, z } of nearby) {
      if (active.has(run.tripKey)) continue;
      const bus = buses.find(v => !v.edge);
      if (!bus) break;
      if (!laneClear(road.occ[lane], entry.at, bus.half + 2.5)) continue;
      if (player.active && Math.hypot(x - player.x, z - player.z) < bus.half + 3) continue;
      bus.busRun = run;
      bus.busPath = path;
      bus.busLeg = entry.leg;
      bus.busDetour=null;
      bus.nextDetourAt=0;
      bus.busStopIndex = entry.stop;
      bus.busAtStop = null;
      bus.off = 0;
      bus.variant = Number(run.variant.line) >= 100 ? 1 : 0;
      bus.signRow = signVariants.get(run.variant.id);
      bus.liveCruise = run.live ? busTrackingSpeed(busRouteDistance(path, entry.leg, entry.at), run) : undefined;
      place(bus, road, lane, entry.at);
      if (run.live) bus.speed = Math.min(bus.speed, bus.liveCruise);
      else if (entry.at < 1 && !run.slice.entryBoundary) bus.speed = 0;
      active.add(run.tripKey);
    }
  }

  // =========================================================================
  // 7. RENDERING
  // =========================================================================
  // Beyond CAR_PROXY_DISTANCE, cars use the ~250-triangle stand-in with built-in wheels instead of the full lofted
  // body + 4 separate wheel instances; vehicles outside the view frustum (with a margin for cast shadows and headlight
  // cones) are skipped altogether.
  const CAR_PROXY_DISTANCE = 90;
  const dirtyPaint = new Set();
  const dirtyState = new Set();
  let dirtyWheelStyles = false;
  const litVehicles = [];
  let litVehicleCount = 0;
  let wheelCars = 0;
  let visibleCars = 0;
  const policeDrawn = { sedan: 0, suv: 0 };
  let visibleBuses = 0;
  let updates = 0;

  function flagRange(attr, n) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }

  function roadGround(edge, x, z, next = null) {
    const a = gradeWayAt(edge.wayId, x, z, 1.2);
    const b = next && next.wayId !== edge.wayId ? gradeWayAt(next.wayId, x, z, 1.2) : null;
    return (b && (!a || b.distance < a.distance) ? b : a)?.y ?? terrainHeightAt(x, z);
  }

  function fitVehicleGrade(v, sinY, cosY) {
    if (v.parkingTrip?.phase==='maneuver') {
      v.roadPitch=v.roadRoll=0;
      return;
    }
    const ground = v.edge?.wayId ? (x, z) => roadGround(v.edge, x, z, v.conn && v.move?.to) : terrainHeightAt;
    const nose = ground(v.x + sinY * v.axle, v.z + cosY * v.axle);
    const side = ground(v.x + cosY * v.halfWidth, v.z - sinY * v.halfWidth);
    v.roadPitch = Math.atan2(v.y - nose, v.axle);
    v.roadRoll = Math.atan2(side - v.y, v.halfWidth);
  }

  // 3D spinning alloy wheels & tires (left & right, front & rear), exact 1:1 ground rolling, steering front wheels.
  // The wheel geometry is modelled at baseRadius (the sedan's 0.35 m car wheel), scaled to the vehicle's radius
  function placeWheels(v, i, rotY, roll, radius, halfTrack, halfBase, leftInst, rightInst, baseRadius = 0.35) {
    const ground = v.parkingTrip?.phase==='maneuver' ? ()=>v.y : v.edge?.wayId ? (x, z) => roadGround(v.edge, x, z, v.conn && v.move?.to) : terrainHeightAt;
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const scale = radius / baseRadius;
    dummy.scale.set(scale, scale, scale);
    for (let w = 0; w < 2; w++) {
      const wz = w === 0 ? halfBase : -halfBase;
      dummy.rotation.set(v.wheelSpin + w * 0.55, rotY + (w === 0 ? v.steer : 0), roll, 'YXZ');
      const leftX = v.x - halfTrack * cosY + wz * sinY;
      const leftZ = v.z + halfTrack * sinY + wz * cosY;
      dummy.position.set(leftX, ground(leftX, leftZ) + radius, leftZ);
      dummy.updateMatrix();
      leftInst.setMatrixAt(i * 2 + w, dummy.matrix);

      const rightX = v.x + halfTrack * cosY + wz * sinY;
      const rightZ = v.z - halfTrack * sinY + wz * cosY;
      dummy.position.set(rightX, ground(rightX, rightZ) + radius, rightZ);
      dummy.updateMatrix();
      rightInst.setMatrixAt(i * 2 + w, dummy.matrix);
    }
  }

  // Lamp state for the car & bus materials: brake lights while slowing down or standing, the turn signal on the side
  // v is heading for (left = +x)
  function writeLampState(v, array, o) {
    const blinkOn = v.blink !== 0 && (clock + v.blinkPhase) % 0.8 <= 0.4;
    array[o] = v.acc < -0.8 || v.speed < 0.3 ? 1 : 0;
    array[o + 1] = blinkOn && v.blink < 0 ? 1 : 0;
    array[o + 2] = blinkOn && v.blink > 0 ? 1 : 0;
  }

  function renderCar(c) {
    const rotY = c.yaw + c.yawOffset;
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const spec = BODY_SPECS[c.bodyType];
    const forwardDist = (c.x - c.prevX) * sinY + (c.z - c.prevZ) * cosY;
    const rawStep = forwardDist / spec.wheelRadius;
    c.wheelSpin = (c.wheelSpin + Math.sign(rawStep) * Math.min(Math.abs(rawStep), 0.48)) % (Math.PI * 2);
    if (hasView && !visible(c.x, c.z, 18, c.y)) return;
    fitVehicleGrade(c, sinY, cosY);

    const near = Math.hypot(c.x - focusX, c.z - focusZ) < CAR_PROXY_DISTANCE;
    const bodyInst = near ? bodies[c.bodyType].near : bodies[c.bodyType].far;
    const slot = bodyInst.count++;

    dummy.position.set(c.x, c.y, c.z);
    dummy.rotation.set(c.roadPitch + c.pitch, rotY, c.roadRoll + c.roll, 'YXZ');
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyInst.setMatrixAt(slot, dummy.matrix);
    if (c.isPolice) {
      const lb = policeLightbars[c.bodyType];
      if (lb) lb.setMatrixAt(policeDrawn[c.bodyType]++, dummy.matrix);
    }

    const attrs = bodyInst.geometry.attributes;
    const paint = attrs.paintColor.array;
    const o3 = slot * 3;
    if (paint[o3] !== c.paint[0] || paint[o3 + 1] !== c.paint[1] || paint[o3 + 2] !== c.paint[2]) {
      paint[o3] = c.paint[0];
      paint[o3 + 1] = c.paint[1];
      paint[o3 + 2] = c.paint[2];
      dirtyPaint.add(bodyInst);
    }
    const state = attrs.carState.array;
    const o4 = slot * 4;
    const blinkOn = c.blink !== 0 && (clock + c.blinkPhase) % 0.8 <= 0.4;
    const b0 = c.acc < -0.8 || c.speed < 0.3 ? 1 : 0;
    const b1 = blinkOn && c.blink < 0 ? 1 : 0;
    const b2 = blinkOn && c.blink > 0 ? 1 : 0;
    const b3 = c.style;
    if (state[o4] !== b0 || state[o4 + 1] !== b1 || state[o4 + 2] !== b2 || state[o4 + 3] !== b3) {
      state[o4] = b0;
      state[o4 + 1] = b1;
      state[o4 + 2] = b2;
      state[o4 + 3] = b3;
      dirtyState.add(bodyInst);
    }

    const visIdx = visibleCars++;
    const [shadowW, shadowL, shadowZ] = bodies[c.bodyType].shadow;
    const shadowX = c.x + sinY * shadowZ, shadowWorldZ = c.z + cosY * shadowZ;
    dummy.rotation.set(c.roadPitch, rotY, c.roadRoll, 'YXZ');
    const shadowY=c.parkingTrip?.phase==='maneuver'?c.y:roadGround(c.edge,shadowX,shadowWorldZ,c.conn&&c.move?.to);
    dummy.position.set(shadowX,shadowY+0.018,shadowWorldZ);
    dummy.scale.set(shadowW, 1.0, shadowL);
    dummy.updateMatrix();
    carShadowInst.setMatrixAt(visIdx, dummy.matrix);

    const dxCam = c.x - camX, dyCam = c.y - camY, dzCam = c.z - camZ;
    const distSq = dxCam * dxCam + dyCam * dyCam + dzCam * dzCam;
    if (distSq < MAX_LIGHT_DIST_SQ) {
      const d = Math.sqrt(distSq);
      const forwardDot = dxCam * camFwdX + dzCam * camFwdZ;
      const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
      if (effDist < MAX_LIGHT_DIST) {
        c._camDistSq = distSq;
        c._effDist = effDist;
        c._sinY = sinY;
        c._cosY = cosY;
        c._braking = b0;
        litVehicles[litVehicleCount++] = c;
      }
    }

    if (near) {
      const wi = wheelCars * 2;
      const ws = carWheelStyles.array;
      if (ws[wi] !== c.style || ws[wi + 1] !== c.style) {
        ws[wi] = ws[wi + 1] = c.style;
        dirtyWheelStyles = true;
      }
      placeWheels(c, wheelCars++, rotY, c.roadRoll + c.roll, spec.wheelRadius, spec.wheelX, spec.wheelZ, carWheelLeftInst, carWheelRightInst);
    }
  }

  function renderBike(b) {
    if (hasView && !visible(b.x, b.z, 6, b.y)) return;
    const yaw = b.yaw + b.yawOffset;
    fitVehicleGrade(b, Math.sin(yaw), Math.cos(yaw));
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(b.roadPitch + b.pitch, yaw, b.roadRoll + b.roll, 'YXZ');
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    for (const m of bikeMeshes) m.setMatrixAt(b.slot, dummy.matrix);
    bikeShown[b.slot] = 1;
  }

  function renderBus(b) {
    const rotY = b.yaw + b.yawOffset;
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const forwardDist = (b.x - b.prevX) * sinY + (b.z - b.prevZ) * cosY;
    const rawStep = forwardDist / BUS_SPEC.wheelRadius;
    b.wheelSpin = (b.wheelSpin + Math.sign(rawStep) * Math.min(Math.abs(rawStep), 0.48)) % (Math.PI * 2);
    if (b.edge.unmodeledTunnel) return;
    if (hasView && !visible(b.x, b.z, 22, b.y)) return;
    fitVehicleGrade(b, sinY, cosY);

    const i = visibleBuses++;
    dummy.position.set(b.x, b.y + 0.018, b.z);
    dummy.rotation.set(b.roadPitch, rotY, b.roadRoll, 'YXZ');
    dummy.scale.set(2.92, 1.0, 12.4);
    dummy.updateMatrix();
    busShadowInst.setMatrixAt(i, dummy.matrix);

    // Lofted Bus Body is defined in ground-relative Y (0.35m skirt to 3.23m roof fairing crown)
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(b.roadPitch + b.pitch, rotY, b.roadRoll + b.roll, 'YXZ');
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    busBodyInst.setMatrixAt(i, dummy.matrix);
    busHeaderInst.setMatrixAt(i, dummy.matrix);
    writeLampState(b, busStates.array, i * 4);
    busStates.array[i * 4 + 3] = (b.variant ?? i) + 1;
    busSigns.array[i] = b.signRow;

    const dxCam = b.x - camX, dyCam = b.y - camY, dzCam = b.z - camZ;
    const distSq = dxCam * dxCam + dyCam * dyCam + dzCam * dzCam;
    if (distSq < MAX_LIGHT_DIST_SQ) {
      const d = Math.sqrt(distSq);
      const forwardDot = dxCam * camFwdX + dzCam * camFwdZ;
      const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
      if (effDist < MAX_LIGHT_DIST) {
        b._camDistSq = distSq;
        b._effDist = effDist;
        b._sinY = sinY;
        b._cosY = cosY;
        b._braking = b.acc < -0.8 || b.speed < 0.3 ? 1 : 0;
        litVehicles[litVehicleCount++] = b;
      }
    }

    placeWheels(b, i, rotY, b.roadRoll, BUS_SPEC.wheelRadius, BUS_SPEC.wheelX, BUS_SPEC.wheelZ, busWheelLeftInst, busWheelRightInst, BUS_SPEC.wheelRadius);
  }

  function smoothDistFade(d, start, end) {
    const t = clamp((end - d) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function updateTrafficLights() {
    litVehicles.length = litVehicleCount;
    if (litVehicleCount > 1) {
      litVehicles.sort((a, b) => a._effDist - b._effDist);
    }

    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    // Front headlights are off during Midday (0.24) & Golden Hour (0.48); fade in smoothly for Dusk (1.25) & Night (1.55)
    const beamScale = clamp((glow - 0.60) * 1.45, 0.0, 1.28);
    const tailScale = clamp(0.18 + glow * 0.66, 0.24, 1.22);

    const maxDualVehicles = HEADLIGHT_POOL_SIZE >> 1;
    const vehCutoff = litVehicleCount > maxDualVehicles
      ? Math.min(MAX_LIGHT_DIST, litVehicles[maxDualVehicles]._effDist)
      : MAX_LIGHT_DIST;
    let spotUsed = 0;
    if (beamScale > 0.001) {
      for (let i = 0; i < litVehicleCount && spotUsed + 2 <= HEADLIGHT_POOL_SIZE; i++) {
        const v = litVehicles[i];
        const fade = smoothDistFade(v._effDist, vehCutoff * 0.62, vehCutoff);
        if (fade <= 0.001) continue;
        const spec = v.bus ? BUS_SPEC : BODY_SPECS[v.bodyType];
        const fullReach = HEADLIGHTS.distance;
        let maxReach = fullReach;
        if (player.active && v.pAhead > 0 && v.pAhead < 30) {
          const latWeight = smoothDistFade(Math.abs(v.pRight), 2.2, 5.5);
          const clampedReach = Math.max(4.5, v.pAhead - player.halfL - 1.5);
          maxReach = fullReach + (clampedReach - fullReach) * latWeight;
        }

        const baseInt = (v.bus ? HEADLIGHTS.busIntensity : HEADLIGHTS.intensity) * beamScale * fade;
        // Match the body instance, including suspension and impact rotation.
        dummy.position.set(v.x, v.y, v.z);
        dummy.rotation.set(v.roadPitch + v.pitch, v.yaw + v.yawOffset, v.roadRoll + v.roll, 'YXZ');
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        for (let side = -1; side <= 1; side += 2) {
          const spot = headlightPool[spotUsed++];
          placeVehicleHeadlight(spot, spec, side, dummy.matrix);
          spot.distance = maxReach;
          spot.intensity = baseInt;
        }
      }
    }
    for (let i = spotUsed; i < HEADLIGHT_POOL_SIZE; i++) {
      const spot = headlightPool[i];
      spot.intensity = 0;
      spot.position.set(0, -1000, 0);
    }

    // 1. NYPD emergency roof lightbar flashes (smoothly pulsing red/blue 360° PointLights on nearby patrol cruisers)
    let policeLightsUsed = 0;
    for (let i = 0; i < litVehicleCount && policeLightsUsed < POLICE_LIGHT_POOL_SIZE; i++) {
      const v = litVehicles[i];
      if (!v.isPolice || v._effDist >= 88) continue;
      const fade = smoothDistFade(v._effDist, 52, 88);
      if (fade <= 0.001) continue;
      const wave = Math.sin((clock + v.blinkPhase) * Math.PI * 6.0);
      const redPhase = wave >= 0;
      const pulse = 0.35 + 0.65 * Math.abs(wave);
      const side = redPhase ? -0.36 : 0.36;
      const pt = policeLightPool[policeLightsUsed++];
      pt.color.setHex(redPhase ? 0xff1828 : 0x1868ff);
      pt.position.set(v.x + side * v._cosY - 0.25 * v._sinY, v.y + (v.bodyType === 'suv' ? 2.05 : 1.85), v.z - side * v._sinY - 0.25 * v._cosY);
      pt.distance = 12.0;
      pt.intensity = 42.0 * tailScale * fade * pulse;
    }
    for (let i = policeLightsUsed; i < POLICE_LIGHT_POOL_SIZE; i++) {
      const pt = policeLightPool[i];
      pt.intensity = 0;
      pt.position.set(0, -1000, 0);
    }
  }

  function updateSparks(dt) {
    let count = 0;
    for (let s = 0; s < MAX_SPARKS; s++) {
      const sp = sparks[s];
      if (sp.life > 0) {
        sp.life -= dt;
        sp.vy -= 22.0 * dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.z += sp.vz * dt;
        const floor = terrainHeightAt(sp.x, sp.z) + 0.03;
        if (sp.y < floor) {
          sp.y = floor;
          sp.vy = Math.abs(sp.vy) * 0.45;
          sp.vx *= 0.78;
          sp.vz *= 0.78;
        }
        const tLife = Math.max(0, sp.life / sp.maxLife);
        const spdXZ = Math.hypot(sp.vx, sp.vz) || 0.001;
        const yawSp = Math.atan2(sp.vx, sp.vz);
        const pitchSp = -Math.atan2(sp.vy, spdXZ);
        dummy.position.set(sp.x, sp.y, sp.z);
        dummy.rotation.set(pitchSp, yawSp, 0, 'YXZ');
        dummy.scale.set(tLife, tLife, Math.max(0.4, Math.min(2.2, spdXZ * 0.16)) * tLife);
        dummy.updateMatrix();
        sparkInst.setMatrixAt(count++, dummy.matrix);
      }
    }
    // Keep one degenerate instance for shader warm-up, then hide the empty pool and stop uploading it.
    sparkInst.visible = count > 0 || updates <= 2;
    if (count === 0 && updates <= 2) sparkInst.setMatrixAt(count++, zero);
    sparkInst.count = count;
    if (count > 0) flagRange(sparkInst.instanceMatrix, count);
  }

  // =========================================================================
  // 8. UPDATE
  // =========================================================================
  let lastFocusX = Infinity;
  let lastFocusZ = Infinity;
  const carPopulation={cursor:0}, bikePopulation={cursor:0};
  let parkingCursor=0, nextParkingOffer=0;

  function populate(pool, population, target, spawn, innerRadius, jump) {
    let count = 0;
    for (const v of pool) {
      if (!v.edge) continue;
      if (Math.hypot(v.x-focusX,v.z-focusZ)>VEHICLE_RADIUS) {
        if (v.parkingTrip) parking.cancel(v);
        v.edge=null;
      } else count++;
    }
    let budget = jump ? 8 : 3;
    for (let scanned = 0; scanned < pool.length && budget > 0 && count !== target; scanned++) {
      const v = pool[population.cursor];
      population.cursor = (population.cursor + 1) % pool.length;
      if (count < target && !v.edge) {
        budget--;
        if (spawn(v, jump ? 0 : innerRadius, NEAR_RADIUS, !jump)) count++;
      } else if (count > target && v.edge && !v.parkingTrip && !nearView(v.x,v.z,v.half+4,NEAR_RADIUS,v.y)) {
        v.edge = null;
        count--;
        budget--;
      }
    }
  }

  function update(dt, elapsed, focusPos = null, playerEntity = null, activeMode = 'car', camera = null) {
    clock = elapsed;
    trips?.updateClock(elapsed);
    avePhase = signalPhase(elapsed, true);
    stPhase = signalPhase(elapsed, false);
    aveWalk = walkSignal(elapsed, true);
    stWalk = walkSignal(elapsed, false);
    focusX = focusPos ? focusPos.x : 0;
    focusZ = focusPos ? focusPos.z : 140;
    // a jump of the camera (teleport, first frame): everything far away can be placed anywhere around it
    const jump = Math.hypot(focusX - lastFocusX, focusZ - lastFocusZ) > 140;
    lastFocusX = focusX;
    lastFocusZ = focusZ;
    refreshNear();
    updateView(camera);

    player.active = false;
    if (playerEntity) {
      const heading = playerEntity.heading || 0;
      const speed = playerEntity.speed || 0;
      player.entity = playerEntity;
      player.x = playerEntity.position.x;
      player.z = playerEntity.position.z;
      player.y = playerEntity.position.y;
      player.height = player.y - gradeHeightAt(player.x, player.z, player.y, activeMode);
      player.active = activeMode !== 'helicopter' && player.height < 2.6;
      player.fx = Math.sin(heading);
      player.fz = Math.cos(heading);
      player.vx = player.fx * speed + (playerEntity.vx || 0);
      player.vz = player.fz * speed + (playerEntity.vz || 0);
    }
    player.halfW = activeMode === 'cargobike' ? 0.38 : activeMode === 'cyclist' ? 0.35 : activeMode === 'person' ? 0.32 : 0.86;
    player.halfL = activeMode === 'cargobike' ? 1.34 : activeMode === 'cyclist' ? 0.85 : activeMode === 'person' ? 0.32 : 2.18;

    // Departures consume the same free car slots as normal replenishment.
    parking?.tick(focusX,focusZ,clock,jump);
    populate(cars, carPopulation, carTarget, spawnCar, 100, jump);
    if (parking?.enabled && clock>=nextParkingOffer) {
      nextParkingOffer=clock+1.65;
      for (let i=0;i<cars.length;i++) {
        const car=cars[parkingCursor++%cars.length];
        if (!car.edge || car.conn || car.parkingTrip || car.destinationTrip || car.parkingStyle==null || car.commit ||
            Math.hypot(car.x-focusX,car.z-focusZ)>275) continue;
        if (parking.routeArrival(car,clock)) car.move=chooseMove(car,true);
        break;
      }
    }
    populate(bikes, bikePopulation, bikeTarget, spawnBike, 70, jump);
    spawnScheduledBuses();
    buildOccupancy();
    for (const m of bodyMeshes) m.count = 0;
    dirtyWheelStyles = false;
    litVehicleCount = 0;
    wheelCars = 0;
    visibleCars = 0;
    policeDrawn.sedan = 0;
    policeDrawn.suv = 0;
    visibleBuses = 0;
    bikeShown.fill(0);
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.edge) continue;

      v.prevX=v.x;
      v.prevZ=v.z;
      if (v.parkingTrip?.phase==='maneuver') {
        moveParking(v,dt);
        continue;
      }
      v.y=roadGround(v.edge,v.x,v.z,v.conn&&v.move?.to);
      if (v.edge.mapped) {
        driveBike(v, dt);
        if (v.edge) v.y = roadGround(v.edge, v.x, v.z);
        continue;
      }
      relateToPlayer(v);
      react(v, dt);
      drive(v, dt);
      if (!v.edge) continue;
      locate(v);
      knock(v, dt);
      pose(v, dt);
      v.y = roadGround(v.edge, v.x, v.z, v.conn && v.move?.to);
    }
    if (player.active) {
      for (const v of vehicles) if (v.edge) collideWithPlayer(v);
      parking?.forParked(player.x,player.z,8,({space})=>{
        collideParkedPlayer(space.x,space.y,space.z,space.heading);
      });
    }
    collideTraffic();
    parking?.flush();
    for (const v of vehicles) {
      if (!v.edge) continue;
      if (v.bus) renderBus(v);
      else if (v.bike) renderBike(v);
      else renderCar(v);
    }
    for (let i = 0; i < NUM_BIKES; i++) if (!bikeShown[i]) for (const m of bikeMeshes) m.setMatrixAt(i, zero);
    for (const m of bikeMeshes) m.instanceMatrix.needsUpdate = true;
    const hideEmpty = ++updates > 2;
    for (const m of bodyMeshes) {
      const n = m.count;
      m.visible = n > 0 || !hideEmpty;
      if (n === 0) {
        if (!hideEmpty) {
          m.setMatrixAt(0, zero);
          m.count = 1;
          flagRange(m.instanceMatrix, 1);
        }
        continue;
      }
      flagRange(m.instanceMatrix, n);
      if (dirtyPaint.has(m)) flagRange(m.geometry.attributes.paintColor, n);
      if (dirtyState.has(m)) flagRange(m.geometry.attributes.carState, n);
    }
    dirtyPaint.clear();
    dirtyState.clear();
    const syncInst = (inst, n) => {
      inst.visible = n > 0 || !hideEmpty;
      if (n === 0) {
        if (!hideEmpty) {
          inst.setMatrixAt(0, zero);
          inst.count = 1;
          flagRange(inst.instanceMatrix, 1);
        } else {
          inst.count = 0;
        }
        return;
      }
      inst.count = n;
      flagRange(inst.instanceMatrix, n);
    };
    syncInst(carWheelLeftInst, wheelCars * 2);
    syncInst(carWheelRightInst, wheelCars * 2);
    if (dirtyWheelStyles && wheelCars > 0) flagRange(carWheelStyles, wheelCars * 2);
    syncInst(policeLightbars.sedan, policeDrawn.sedan);
    syncInst(policeLightbars.suv, policeDrawn.suv);
    syncInst(carShadowInst, visibleCars);
    syncInst(busBodyInst, visibleBuses);
    syncInst(busHeaderInst, visibleBuses);
    syncInst(busWheelLeftInst, visibleBuses * 2);
    syncInst(busWheelRightInst, visibleBuses * 2);
    syncInst(busShadowInst, visibleBuses);
    if (visibleBuses > 0) {
      flagRange(busStates, visibleBuses);
      flagRange(busSigns, visibleBuses);
    }
    updateTrafficLights();

    // 2. Pedestrians
    pedestrianSystem.update(dt, elapsed, focusX, focusZ, jump, hasView, activeMode, pedTarget);
    rememberCrossings();

    // 3. Collision sparks, including the player's own impacts against buildings
    if (playerEntity && playerEntity.lastCollisionSpark) {
      const bs = playerEntity.lastCollisionSpark;
      spawnCollisionSparks(bs.x, terrainHeightAt(bs.x, bs.z) + bs.y, bs.z, bs.nx, bs.nz, bs.speed);
      playerEntity.lastCollisionSpark = null;
    }
    updateSparks(dt);
  }

  return {
    group,
    update,
    setCollisionListener,
    cars,
    buses,
    busPaths,
    roadTraffic,
    bikes,
    peds: pedestrianSystem.peds,
    parking,
    trips,
    controls,
    fitted,
    ...(pilot.profile && { spawnLaneProbe(edge, lane, station) {
      if (edges[edge.id] !== edge || !edge.ambientLanes?.includes(lane) || roadTraffic.isClosed(edge)) return null;
      const car = cars.find(v => !v.edge && v.bodyType === 'sedan' && !v.isPolice && v.parkingStyle != null);
      if (!car || station < car.half || station > edge.len - car.half || !laneClear(edge.occ[lane], station, car.half + 1)) return null;
      place(car, edge, lane, station);
      car.y = roadGround(edge, car.x, car.z);
      return car;
    } }),
    network
  };
}

// ============================================================================
// AMBIENT SHORE-HIGHWAY TRAFFIC (West Side Highway, Henry Hudson Parkway, FDR Drive)
// ============================================================================
// The shore highways city-grid.js lays along both rivers are not part of the road graph, so a lighter model fills
// them: cars follow each lane's centre line and keep their distance with the IDM. Nobody changes lanes, so the order
// in a lane never changes and every car's leader is simply the next one (cyclically: cars dip below the deck at the
// end of a lane as if into an underpass and come back up at its start; West St and the FDR's lanes are joined through
// the Battery Park Underpass, lane points well below ground). Cars queue behind the player standing or
// driving in their lane. Within HWY_NEAR_LOD m of the camera they use the full model with wheels and cast shadows,
// up to HWY_MID_LOD m a wheel-less body, further out a coarse ~250-triangle lofted proxy; beyond HWY_FAR_CULL m (or well behind
// the camera) they aren't drawn.
const HWY_DRIVER = { a: 1.6, b: 2.8, T: 1.3, s0: 3.0 };
const HWY_CAR_LEN = 4.6;
const HWY_NEAR_LOD = 170;
const HWY_MID_LOD = 450;
const HWY_FAR_CULL = 1600;
const HWY_RAMP = 32; // the dip at the lane ends: 2.4 m down over this many metres
const HWY_BOX_RUN = 16; // lane segments per bounding box of the player test

function createHighwayTraffic(scene, lanes) {
  const group = new THREE.Group();
  group.name = 'HighwayTraffic';
  scene.add(group);
  const KINDS = Object.keys(CAR_KINDS);
  const PALETTES = {
    taxi: [
      { hex: 0xffbe14, style: carStyleCode({ livery: 0, metallic: 0, trim: 0, wheel: 0 }) },
      { hex: 0xffbe14, style: carStyleCode({ livery: 0, metallic: 0, trim: 0, wheel: 1 }) }
    ],
    sedan: [
      { hex: 0x12151a, style: carStyleCode({ livery: 3, metallic: 0, trim: 1, wheel: 1 }) },
      { hex: 0x161a20, style: carStyleCode({ livery: 3, metallic: 1, trim: 2, wheel: 2 }) },
      { hex: 0xf2f4f7, style: carStyleCode({ livery: 0, metallic: 0, trim: 0, wheel: 0 }) },
      { hex: 0xe6eaef, style: carStyleCode({ livery: 4, metallic: 1, trim: 2, wheel: 2 }) },
      { hex: 0xcfd6de, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) },
      { hex: 0x8a8f96, style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 1 }) },
      { hex: 0x52575e, style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 2 }) },
      { hex: 0x1c2026, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 3 }) },
      { hex: 0x1d3b6c, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) },
      { hex: 0x6e1f24, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) },
      { hex: 0x5cae3e, style: carStyleCode({ livery: 2, metallic: 0, trim: 0, wheel: 0 }) }
    ],
    suv: [
      { hex: 0x101318, style: carStyleCode({ livery: 3, metallic: 0, trim: 1, wheel: 1 }) },
      { hex: 0x16191e, style: carStyleCode({ livery: 3, metallic: 1, trim: 2, wheel: 3 }) },
      { hex: 0xf0f3f7, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) },
      { hex: 0xe4e8ed, style: carStyleCode({ livery: 4, metallic: 0, trim: 2, wheel: 2 }) },
      { hex: 0x3a434d, style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 2 }) },
      { hex: 0xbec6cf, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) },
      { hex: 0x28382e, style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 1 }) },
      { hex: 0x20385c, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) },
      { hex: 0x5b2a2a, style: carStyleCode({ livery: 4, metallic: 1, trim: 2, wheel: 2 }) },
      { hex: 0x5cae3e, style: carStyleCode({ livery: 2, metallic: 0, trim: 0, wheel: 0 }) }
    ],
    minivan: [
      { hex: 0x111419, style: carStyleCode({ livery: 3, metallic: 1, trim: 1, wheel: 1 }) },
      { hex: 0xf0f2f5, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) },
      { hex: 0xaab2bb, style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 1 }) },
      { hex: 0x4a5058, style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 2 }) },
      { hex: 0x26354f, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) },
      { hex: 0x5a1f24, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 0 }) }
    ],
    pickup: [
      { hex: 0x14171b, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) },
      { hex: 0xf2f3f5, style: carStyleCode({ livery: 0, metallic: 0, trim: 1, wheel: 0 }) },
      { hex: 0x9da4ab, style: carStyleCode({ livery: 0, metallic: 1, trim: 0, wheel: 2 }) },
      { hex: 0x3d434a, style: carStyleCode({ livery: 0, metallic: 1, trim: 2, wheel: 3 }) },
      { hex: 0x1e2f4f, style: carStyleCode({ livery: 0, metallic: 1, trim: 1, wheel: 1 }) },
      { hex: 0x8f1a1d, style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) }
    ],
    // Vans: fleet white, silver, grey & black, black plastic trim; never two-tone (see the street palettes)
    van: [
      { hex: 0xf4f5f6, style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 0 }) },
      { hex: 0xf0f1f2, style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) },
      { hex: 0xf4f5f6, style: carStyleCode({ livery: 0, metallic: 0, trim: 0, wheel: 1 }) },
      { hex: 0xb9c0c7, style: carStyleCode({ livery: 0, metallic: 1, trim: 2, wheel: 0 }) },
      { hex: 0x8e959c, style: carStyleCode({ livery: 0, metallic: 0, trim: 2, wheel: 3 }) },
      { hex: 0x15181c, style: carStyleCode({ livery: 0, metallic: 1, trim: 2, wheel: 3 }) }
    ]
  };
  let seed = 20240917;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // Lanes: arc length and heading at every centre-line vertex, bounds for the player test, cars every 24-74 m
  const cars = [];
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
  for (const lane of lanes) {
    const P = lane.pts;
    lane.cum = [0];
    for (let i = 1; i < P.length; i++) lane.cum.push(lane.cum[i - 1] + P[i].distanceTo(P[i - 1]));
    lane.len = lane.cum[P.length - 1];
    lane.yaw = P.map((p, i) => {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(P.length - 1, i + 1)];
      return Math.atan2(b.x - a.x, b.z - a.z);
    });
    // Bounds of every run of HWY_BOX_RUN segments ([x0, x1, z0, z1] after one another): the shore lanes, joined
    // through the Battery Park Underpass, span the whole island, so the player test visits just the runs nearby
    lane.box = [];
    for (let s = 0; s + 1 < P.length; s += HWY_BOX_RUN) {
      const run = P.slice(s, Math.min(P.length, s + HWY_BOX_RUN + 1));
      lane.box.push(Math.min(...run.map((p) => p.x)), Math.max(...run.map((p) => p.x)), Math.min(...run.map((p) => p.z)), Math.max(...run.map((p) => p.z)));
    }
    lane.cars = [];
    for (let u = rand() * 30; u < lane.len - 12; u += 24 + rand() * 50) {
      const h = rand();
      // Fewer vans than in town: commercial vehicles are barred from the parkways
      const kind = h < 0.2 ? 'taxi' : h < 0.56 ? 'sedan' : h < 0.82 ? 'suv' : h < 0.89 ? 'minivan' : h < 0.95 ? 'pickup' : 'van';
      const entry = PALETTES[kind][Math.floor(rand() * PALETTES[kind].length)];
      const col = new THREE.Color(entry.hex);
      const spec = BODY_SPECS[kind];
      // (float32 values, so update() can tell whether an instance slot's paint changes by comparing with the buffer)
      const car = {
        lane, kind, u, v: lane.speed, acc: 0, seg: 0,
        placed: false, x: 0, y: -1000, z: 0, yaw: 0,
        len: spec.zFront - spec.zRear, engine: CAR_KINDS[kind].engine,
        col: [Math.fround(col.r), Math.fround(col.g), Math.fround(col.b)],
        style: entry.style
      };
      lane.cars.push(car);
      cars.push(car);
      counts[kind]++;
    }
  }

  // Per body type: [near (with wheels, casts shadows), mid (wheel-less), far (lofted proxy)] instanced meshes sharing
  // the traffic's cached car material (per-instance paintColor & carState)
  const meshes = {};
  for (const kind of KINDS) {
    const spec = BODY_SPECS[kind];
    const n = Math.max(1, counts[kind]);
    meshes[kind] = [0, 1, 2].map((lod) => {
      const geo = lod === 2 ? buildCarProxyGeometry(spec) : buildCarGeometry(spec, lod === 0);
      geo.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      const mesh = new THREE.InstancedMesh(geo, createLoftedCarMaterial(spec), n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = lod === 0;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    });
  }

  // Night lamp flares: a soft glow on every head- and tail-lamp, at least a couple of pixels wide, so the highways read
  // as streams of white and red lights from across the river once the lamp geometry shrinks below a pixel.
  // (flareCol is rgb + an unused w: 3-component attributes get re-padded to 4 on every upload)
  const flarePos = new Float32Array(cars.length * 4 * 4); // x, y, z, size
  const flareCol = new Float32Array(cars.length * 4 * 4); // r, g, b, -
  const flareGeo = new THREE.PlaneGeometry(1, 1);
  flareGeo.setAttribute('flarePos', new THREE.InstancedBufferAttribute(flarePos, 4));
  flareGeo.setAttribute('flareCol', new THREE.InstancedBufferAttribute(flareCol, 4));
  const flares = new THREE.Mesh(flareGeo, createCarFlareMaterial());
  flares.name = 'HighwayLampFlares';
  flares.frustumCulled = false;
  flares.visible = false;
  flares.renderOrder = 2;
  group.add(flares);
  let flareCount = 0;

  // Clustered SpotLight pool for nearby highway cars (within 105 m)
  const HWY_SPOT_POOL = 28;
  const HWY_LIGHT_DIST = 105;
  const HWY_LIGHT_DIST_SQ = HWY_LIGHT_DIST * HWY_LIGHT_DIST;
  const hwyLightsGroup = new THREE.Group();
  hwyLightsGroup.name = 'HighwayClusteredLights';
  group.add(hwyLightsGroup);

  const hwySpotPool = [];
  for (let i = 0; i < HWY_SPOT_POOL; i++) {
    const spot = createVehicleHeadlight();
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    hwyLightsGroup.add(spot, spot.target);
    hwySpotPool.push(spot);
  }
  const hwyLitCars = [];
  let hwyLitCount = 0;
  function addFlare(px, py, pz, size, r, g, b) {
    const o = flareCount * 4;
    flarePos[o] = px;
    flarePos[o + 1] = py;
    flarePos[o + 2] = pz;
    flarePos[o + 3] = size;
    const k = flareCount * 4;
    flareCol[k] = r;
    flareCol[k + 1] = g;
    flareCol[k + 2] = b;
    flareCount++;
  }
  const flareFacing = (f) => { const t = Math.min(1, Math.max(0, (f + 0.3) / 0.9)); return t * t * (3 - 2 * t); };

  const D = HWY_DRIVER;
  const brakeTerm = 2 * Math.sqrt(D.a * D.b);
  const ease = (x) => { const t = Math.min(1, Math.max(0, x / HWY_RAMP)); return t * t * (3 - 2 * t); };
  const easeSlope = (x) => { if (x <= 0 || x >= HWY_RAMP) return 0; const t = x / HWY_RAMP; return (6 * t * (1 - t)) / HWY_RAMP; };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1);
  const fwd = new THREE.Vector3();
  const dirtyPaint = new Set();
  const dirtyState = new Set();
  let updates = 0;
  // Flags the first n items of an attribute for upload (static usage: once per frame, not once per render pass)
  function flagRange(attr, n) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }

  // The player's arc position and speed along `lane` if they are in it (within 2 m of the centre line and near
  // its road height, not on its underground stretches), else null
  function playerInLane(lane, pl) {
    const B = lane.box;
    const P = lane.pts;
    for (let r = 0; r < B.length; r += 4) {
      if (pl.x < B[r] - 3 || pl.x > B[r + 1] + 3 || pl.z < B[r + 2] - 3 || pl.z > B[r + 3] + 3) continue;
      const end = Math.min(P.length - 1, (r / 4 + 1) * HWY_BOX_RUN);
      for (let i = (r / 4) * HWY_BOX_RUN; i < end; i++) {
        if (P[i].y < -1 && P[i + 1].y < -1) continue;
        const ax = P[i].x, az = P[i].z;
        const sx = P[i + 1].x - ax, sz = P[i + 1].z - az;
        const horizontalLengthSq = sx * sx + sz * sz;
        if (horizontalLengthSq === 0) continue;
        const L = lane.cum[i + 1] - lane.cum[i];
        const t = ((pl.x - ax) * sx + (pl.z - az) * sz) / horizontalLengthSq;
        if (t < 0 || t > 1) continue;
        const y = P[i].y + (P[i + 1].y - P[i].y) * t;
        if (Math.abs(pl.y - y) >= 2.6) continue;
        if (Math.abs((pl.z - az) * sx - (pl.x - ax) * sz) / Math.sqrt(horizontalLengthSq) < 2.0) {
          // Convert horizontal progress to distance along the sloped lane, as with u above.
          return { u: lane.cum[i] + t * L, v: Math.max(0, ((pl.vx * sx + pl.vz * sz) / horizontalLengthSq) * L) };
        }
      }
    }
    return null;
  }

  function update(dt, camera, entity, mode) {
    // 1. Car following (IDM) in every lane, the player counting as a leader
    const pl = entity && mode !== 'helicopter' ? {
      x: entity.position.x, y: entity.position.y, z: entity.position.z,
      vx: Math.sin(entity.heading || 0) * (entity.speed || 0) + (entity.vx || 0),
      vz: Math.cos(entity.heading || 0) * (entity.speed || 0) + (entity.vz || 0)
    } : null;
    for (const lane of lanes) {
      const list = lane.cars;
      const n = list.length;
      const pIn = pl ? playerInLane(lane, pl) : null;
      for (let k = 0; k < n; k++) {
        const c = list[k];
        let gap = Infinity;
        let dv = 0;
        if (n > 1) {
          const lead = list[(k + 1) % n];
          gap = lead.u - c.u;
          if (gap < 0) gap += lane.len;
          gap -= (c.len + lead.len) / 2;
          dv = c.v - lead.v;
        }
        // The player's car counts as HWY_CAR_LEN long
        if (pIn && pIn.u > c.u) {
          const playerGap = pIn.u - c.u - (c.len + HWY_CAR_LEN) / 2;
          if (playerGap < gap) {
            gap = playerGap;
            dv = c.v - pIn.v;
          }
        }
        const sStar = D.s0 + Math.max(0, c.v * D.T + (c.v * dv) / brakeTerm);
        c.acc = Math.max(-9, D.a * (1 - (c.v / lane.speed) ** 4 - (sStar / Math.max(gap, 0.1)) ** 2));
      }
      for (const c of list) {
        c.v = Math.max(0, c.v + c.acc * dt);
        c.u += c.v * dt;
        if (c.u >= lane.len) {
          c.u -= lane.len;
          c.seg = 0;
        }
      }
    }

    // 2. Instances: LOD by distance, far cars well behind the camera skipped; lamp flares at dusk & night
    const cam = camera.position;
    camera.getWorldDirection(fwd);
    for (const kind of KINDS) for (const mesh of meshes[kind]) mesh.count = 0;
    const flaresOn = cityUniforms.uInteriorGlow.value > 0.65;
    const pxAt1m = (2 * Math.tan(((camera.fov || 55) * Math.PI) / 360)) / Math.max(360, window.innerHeight || 800);
    flareCount = 0;
    hwyLitCount = 0;
    for (const c of cars) {
      const lane = c.lane;
      const cum = lane.cum;
      while (c.seg < cum.length - 2 && cum[c.seg + 1] < c.u) c.seg++;
      const i = c.seg;
      const segLen = cum[i + 1] - cum[i];
      const t = Math.min(1, Math.max(0, (c.u - cum[i]) / segLen));
      const a = lane.pts[i];
      const b = lane.pts[i + 1];
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const toEnd = lane.len - c.u;
      const dip = c.u < toEnd ? c.u : toEnd;
      const y = a.y + (b.y - a.y) * t - 2.4 * (1 - ease(dip));
      let dYaw = lane.yaw[i + 1] - lane.yaw[i];
      if (dYaw > Math.PI) dYaw -= Math.PI * 2;
      else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const yaw = lane.yaw[i] + dYaw * t;
      // Keep the current world pose available to audio, including cars behind the camera.
      c.x = x;
      c.y = y;
      c.z = z;
      c.yaw = yaw;
      c.placed = true;
      const dx = x - cam.x;
      const dz = z - cam.z;
      const dy = y - cam.y;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > HWY_FAR_CULL * HWY_FAR_CULL) continue;
      const lod = d2 < HWY_NEAR_LOD * HWY_NEAR_LOD ? 0 : d2 < HWY_MID_LOD * HWY_MID_LOD ? 1 : 2;
      if (lod > 0 && dx * fwd.x + dz * fwd.z < -40) continue;
      if (y < -3.6) continue; // in the Battery Park Underpass, out of sight behind the portals' screens
      const slope = (b.y - a.y) / segLen + 2.4 * easeSlope(dip) * (c.u < toEnd ? 1 : -1);
      euler.set(-Math.atan(slope), yaw, 0);
      q.setFromEuler(euler);
      m4.compose(pos.set(x, y, z), q, ONE);
      const mesh = meshes[c.kind][lod];
      const slot = mesh.count++;
      m4.toArray(mesh.instanceMatrix.array, slot * 16);
      // Paint & brake lights change only when a slot changes hands or a car brakes: flagged for upload just then
      const attrs = mesh.geometry.attributes;
      const paint = attrs.paintColor.array;
      const o3 = slot * 3;
      if (paint[o3] !== c.col[0] || paint[o3 + 1] !== c.col[1] || paint[o3 + 2] !== c.col[2]) {
        paint.set(c.col, o3);
        dirtyPaint.add(mesh);
      }
      const brake = c.acc < -1.2 ? 1 : 0; // brake lights
      const state = attrs.carState.array;
      const o4 = slot * 4;
      if (state[o4] !== brake || state[o4 + 3] !== c.style) {
        state[o4] = brake;
        state[o4 + 3] = c.style;
        dirtyState.add(mesh);
      }

      if (d2 < HWY_LIGHT_DIST_SQ && dip > 1) {
        const d = Math.sqrt(d2);
        const forwardDot = dx * fwd.x + dz * fwd.z;
        const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
        if (effDist < HWY_LIGHT_DIST) {
          c._d2 = d2;
          c._effDist = effDist;
          c._mesh = mesh;
          c._slot = slot;
          c._brake = brake;
          hwyLitCars[hwyLitCount++] = c;
        }
      }

      // Flares (from 40 m out, full by 120 m): sprites just off the lamp faces, white at the front and red at the back,
      // brightest seen head-on / from behind, dimmed by haze
      if (!flaresOn || d2 < 1600 || dip < 1) continue;
      const d = Math.sqrt(d2);
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      const facing = -(dx * sy + dz * cy) / d;
      const k = (Math.min(1, (d - 40) / 80) / (1 + (d / 2000) ** 2)) * ease(dip);
      const size = Math.max(0.6, d * pxAt1m * 3);
      const spec = BODY_SPECS[c.kind];
      for (let e = 0; e < 2; e++) {
        const front = e === 0;
        const w = k * (0.3 + 0.7 * flareFacing(front ? facing : -facing));
        const lz = front ? spec.zFront + 0.3 : spec.zRear - 0.3;
        const ly = y + (front ? spec.lamps[0] : spec.lamps[1]);
        for (let s = -1; s <= 1; s += 2) {
          const lx = s * spec.lampX[front ? 0 : 1];
          if (front) addFlare(x + lx * cy + lz * sy, ly, z - lx * sy + lz * cy, size, 4.4 * w, 4.1 * w, 3.6 * w);
          else addFlare(x + lx * cy + lz * sy, ly, z - lx * sy + lz * cy, size, 3.4 * w, 0.16 * w, 0.1 * w);
        }
      }
    }
    // Upload just the instances in use (the buffers hold every car of the kind), and nothing for empty meshes, which
    // are hidden too (an empty instanced mesh still costs a render object update in every pass). They stay visible
    // for the first couple of frames so that the shader precompile & warm-up frame (main.js) see all of them.
    const hideEmpty = ++updates > 2;
    for (const kind of KINDS) {
      for (const mesh of meshes[kind]) {
        const n = mesh.count;
        mesh.visible = n > 0 || !hideEmpty;
        if (n === 0) continue;
        flagRange(mesh.instanceMatrix, n);
        if (dirtyPaint.has(mesh)) flagRange(mesh.geometry.attributes.paintColor, n);
        if (dirtyState.has(mesh)) flagRange(mesh.geometry.attributes.carState, n);
      }
    }
    dirtyPaint.clear();
    dirtyState.clear();
    flares.visible = flareCount > 0;
    flares.count = flareCount;
    if (flareCount > 0) {
      flagRange(flareGeo.attributes.flarePos, flareCount);
      flagRange(flareGeo.attributes.flareCol, flareCount);
    }

    // Update clustered highway SpotLights (dual left/right beams for nearby cars)
    hwyLitCars.length = hwyLitCount;
    if (hwyLitCount > 1) {
      hwyLitCars.sort((a, b) => a._effDist - b._effDist);
    }
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const beamScale = clamp((glow - 0.60) * 1.45, 0.0, 1.28);
    const maxHwyVeh = HWY_SPOT_POOL >> 1;
    const hwyCutoff = hwyLitCount > maxHwyVeh
      ? Math.min(HWY_LIGHT_DIST, hwyLitCars[maxHwyVeh]._effDist)
      : HWY_LIGHT_DIST;
    let spotUsed = 0;
    if (beamScale > 0.001) {
      for (let i = 0; i < hwyLitCount && spotUsed + 2 <= HWY_SPOT_POOL; i++) {
        const c = hwyLitCars[i];
        const t = clamp((hwyCutoff - c._effDist) / Math.max(1, hwyCutoff * 0.38), 0, 1);
        const fade = (t * t * (3 - 2 * t)) * ease(Math.min(c.u, c.lane.len - c.u));
        if (fade <= 0.001) continue;
        const spec = BODY_SPECS[c.kind];
        const baseInt = HEADLIGHTS.intensity * beamScale * fade;
        // Reuse the exact rendered transform, including the road slope and underpass dip.
        c._mesh.getMatrixAt(c._slot, m4);
        for (let side = -1; side <= 1; side += 2) {
          const spot = hwySpotPool[spotUsed++];
          placeVehicleHeadlight(spot, spec, side, m4);
          spot.intensity = baseInt;
        }
      }
    }
    for (let i = spotUsed; i < HWY_SPOT_POOL; i++) {
      const spot = hwySpotPool[i];
      spot.intensity = 0;
      spot.position.set(0, -1000, 0);
    }
  }

  return { group, update, cars, lanes };
}

export { createTrafficSystem, createHighwayTraffic };
