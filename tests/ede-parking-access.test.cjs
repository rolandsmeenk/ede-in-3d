const assert = require('node:assert/strict');
const test = require('node:test');

const link = (space,edge,lane=0,s=40) => ({space,link:{entrance:{edge,lane,s}}});
const bay = (fields={}) => ({id:'bay', x:36, y:0, z:4, layer:0, wayId:'street', heading:Math.PI/2, ...fields});
function road(fields={}) {
  return {id:1, wayId:'street', sx:0, sz:0, dx:1, dz:0, rx:0, rz:1, lanes:[0], ambientLanes:[0],
    len:100, half:2.6, layer:0, ambientMoves:[], ...fields};
}

test('street parking attaches only on the correct grade and does not cross protected bike or foot space', async () => {
  const { createParkingAccess, parkingPose } = await import('../js/ede-parking-access.js');
  const edge=road();
  const bicycle={ax:0,az:2.3,ux:1,uz:0,len:100,width:1.65,layer:0};
  const tracks={bikes:(_x,_z,_radius,out)=>out.push(bicycle),foot:()=>{}};
  const network={edges:[edge],activeTravel:tracks};
  const access=createParkingAccess(network);
  assert.equal(access.link(bay()),null);
  assert.equal(access.link(bay({id:'upper',layer:1,driveway:true})),null);
  assert.equal(access.link(bay({id:'raised',y:7,driveway:true})),null);
  const driveway=bay({id:'mapped',driveway:true});
  const route=access.link(driveway);
  assert.equal(route.entrance.edge,edge);
  const entered=parkingPose(route.arrival,route.arrival.length,{});
  const leaving=parkingPose(route.departure,0,{});
  assert.ok(Math.hypot(entered.x-driveway.x,entered.z-driveway.z)<0.01);
  assert.ok(Math.hypot(entered.x-leaving.x,entered.z-leaving.z)<0.01);
  assert.equal(leaving.reversing,true);
});

test('a full parking area uses another reachable lane and respects the search budget and closures', async () => {
  const { findParkingArrival } = await import('../js/ede-parking-access.js');
  const edge=road(), next=road({id:2}), target=road({id:3}), unreachable=road({id:4});
  const first={to:next,out:[0]}, second={to:target,out:[0]};
  edge.ambientMoves=[first,{to:unreachable,out:[-1]}];
  next.ambientMoves=[second];
  const full=link({id:'full',areaId:'A'},next);
  const free=link({id:'free',areaId:'B'},target);
  const fake=link({id:'illegal',areaId:'C'},unreachable);
  const opportunities=new Map([[next,[full]],[target,[free]],[unreachable,[fake]]]);
  const car={edge,lane:0,s:10,speed:7};
  const available=item=>item!==full;
  assert.deepEqual(findParkingArrival(car,opportunities,{available}),{item:free,route:[first,second]});
  assert.equal(findParkingArrival(car,opportunities,{available,closed:e=>e===target}),null);
  assert.equal(findParkingArrival(car,opportunities,{available,maxDepth:1}),null);
});

test('parking-only lot traffic uses its shared-node driveway and returns to a legal lane', async () => {
  const { createParkingAccess, parkingPose } = await import('../js/ede-parking-access.js');
  const edge=road();
  const a='lot';
  const aisles=[
    {id:'gate',areaId:a,pts:[25,0,25,12],yield:true,approachWayId:'street',junction:[25,0]},
    {id:'aisle',areaId:a,pts:[25,12,70,12]}
  ];
  const access=createParkingAccess({edges:[edge]},aisles);
  const space=bay({id:'inside',x:45,z:16,wayId:'aisle',areaId:a});
  const route=access.link(space);
  assert.equal(route.entrance.edge,edge);
  assert.equal(route.exit.edge,edge);
  assert.ok(route.arrival.samples.some(p=>p.x===25 && p.z===12));
  assert.ok(route.departure.samples.some(p=>p.x===25 && p.z===12));
  assert.ok(Math.abs(parkingPose(route.departure,route.departure.length,{}).z)<0.01);
});
