// Run with the lane profiling build served locally and a Chrome remote-debugging tab.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
const [phase, origin = 'http://127.0.0.1:8995', output = '/tmp/ede-lane-evidence', port = '9297', selection = ''] = process.argv.slice(2);
if (phase !== 'before' && phase !== 'after') throw Error('Choose before or after');
const endpoint = new URL(origin);
endpoint.searchParams.set('perf', '1');
endpoint.searchParams.set('bench', '1');
endpoint.searchParams.set('laneFits', phase === 'before' ? 'off' : 'on');
const fit = JSON.parse(gunzipSync(await readFile(new URL('../assets/ede-fitted-lanes.json.gz', import.meta.url))));
await mkdir(output,{recursive:true});
const sites=[
  ['maanderbroek',-4175,2183,23,['w6960104','w750476158','w493246904','w6960103','w6960105','w380485855','w6960114']],
  ['exit24',-1410,3494,17,['w723962252','w723962249','w6921137','w25551033','w1212023125','w1121900829','w469675212']],
  ['akulaan',115,2281,9,['w1156964960','w620928502']],
  ['kolkakkerweg',-909,865,9,['w6953286']],
  ['albertstunnel',105,2057,3,['w6952984','w1063323754']],
  ['nachtegaallaan',-808,782,9,['w6953282']],
  ['frans-halslaan',-1447,3239,13,['w840619077']],
];
const [target]= (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(page=>page.type==='page');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let id=0;
const pending=new Map(), errors=[];
socket.addEventListener('message',({data})=>{
  const reply=JSON.parse(data),callback=pending.get(reply.id);
  if(reply.method==='Runtime.exceptionThrown')errors.push(reply.params.exceptionDetails.text);
  if(callback){pending.delete(reply.id);callback(reply);}
});
function send(method,params={}){
  return new Promise((resolve,reject)=>{
    const k=++id;
    pending.set(k,({error,result})=>error?reject(Error(error.message)):resolve(result));
    socket.send(JSON.stringify({id:k,method,params}));
  });
}
async function ev(expression){
  const {result,exceptionDetails}=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(exceptionDetails)throw Error(result.description||exceptionDetails.text);
  return result.value;
}

try {
  await send('Network.enable');
  await send('Page.bringToFront');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  const {identifier}=await send('Page.addScriptToEvaluateOnNewDocument',{source:`if (location.protocol.startsWith('http')){
    localStorage.removeItem('slop-ede-player-state'); Date.now=()=>1795089600000;
    let seed=0x45de; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  }`});
  await send('Page.navigate',{url:endpoint.href});
  for(let i=0;!(await ev('window.__slopwaw?.ready').catch(()=>false));i++){
    if(i===180)throw Error(await ev("document.querySelector('#loading-status')?.textContent||'Startup timeout'"));
    await delay(250);
  }
  const evidence={phase,lanes:[],traces:[],sites:[],errors};
  if (selection) {
    const existing = await readFile(output+'/'+phase+'.json','utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing) {
      const previous = JSON.parse(existing);
      for (const field of ['lanes','traces','sites']) evidence[field].push(...previous[field].filter(item=>!selection.includes(item.site)));
    }
  }
  for(const site of sites.filter(item=>!selection||selection.includes(item[0]))){
    const data=await ev(`(${async ([site,x,z,height,ways],phase,accepted)=>{
      const game=__slopwaw, traffic=game.trafficSystem, network=traffic.network;
      const {terrainHeightAt}=await import('/js/terrain.js');
      const {gradeWayAt}=await import('/js/ede-grade.js');
      const {fittedLanePoint}=await import('/js/ede-lane-geometry.js');
      if (phase==='after' && !traffic.fitted.edges) throw Error(JSON.stringify(traffic.fitted));
      const ground=(site==='albertstunnel'?gradeWayAt(ways[0],x,z,10)?.y:undefined)??terrainHeightAt(x,z);
      game.time('midday');
      game.setCamera(x+1,ground+height+3,z-12,x,ground,z+4);
      const wanted=new Set(ways);
      const nearStation = edge => Math.max(0, Math.min(edge.len, (x-edge.sx)*edge.dx + (z-edge.sz)*edge.dz));
      const nearest=edge=>Math.hypot(edge.sx + edge.dx * nearStation(edge) - x, edge.sz + edge.dz * nearStation(edge) - z);
      const lanes = [], choices = [];
      const edgeKey = e => [e.from.x,e.from.z,e.to.x,e.to.z].map(c=>c.toFixed(2)).join(',')+'|'+e.wayId+'|'+(e.layer??0);
      for (const edge of network.edges) {
        if (!wanted.has(edge.wayId) || nearest(edge)>250) continue;
        const key = edgeKey(edge);
        for (let lane=0;lane<edge.lanes.length;lane++) {
          const count = Math.max(1,Math.ceil(edge.len/2));
          const points = Array.from({length:count+1},(_,i)=>{
            const p=fittedLanePoint(edge,lane,edge.len*i/count,{});
            return [p.x,p.z];
          });
          const row = {site,phase,wayId:edge.wayId,layer:edge.layer??0,lane,key,
            accepted:!!edge.fittedLanes?.[lane],points};
          lanes.push(row);
          if (!edge.ambientLanes.includes(lane) || edge.len < 9) continue;
          const distance = nearest(edge);
          const fitLane = Boolean(accepted[key]?.includes(lane));
          if (distance < 150) choices.push({edge,row,distance,fitLane});
        }
      }
      choices.sort((a,b)=> Number(b.fitLane)-Number(a.fitLane) || (a.distance-b.distance) ||
        b.edge.len-a.edge.len || b.row.lane-a.row.lane);
      const priority = {
        maanderbroek: ['w380485855','w6960104','w6960114'],
        exit24: ['w723962249','w723962252','w469675212'],
      };
      const knownEdges = {
        kolkakkerweg: '-859.20,857.60,-978.80,873.80|w6953286|0',
      };
      const selected = (priority[site] ?? ways).map(way=>choices.find(c=>
        c.edge.wayId===way && (!knownEdges[site] || c.row.key===knownEdges[site]))).filter(Boolean).slice(0,3);
      const traces = [], wait = () => new Promise(requestAnimationFrame);
      for (let n=0;n<120;n++) await wait();
      for (const {edge,row} of selected) {
        const along = (x-edge.sx)*edge.dx+(z-edge.sz)*edge.dz;
        const probeStarts = { w380485855: 15, w723962249: 15, w840619077: 15, w6953286: 25 };
        const start = probeStarts[edge.wayId] ?? along - (edge.motorway ? 38 : 20);
        let car, station;
        for (let n=0;n<260 && !car;n++) {
          await wait();
          const shift = [0, 8, 16, -8][Math.floor(n / 65)];
          station = Math.min(edge.len-5,Math.max(3,start+shift));
          car=traffic.spawnLaneProbe(edge,row.lane,station);
        }
        if (!car) continue;
        const trace = {...row, points:[], poses:[], stations:[], vehicle:'sedan', station};
        if (edge.layer) trace.heightCheck = { samples: 0, profileMisses: 0, maxResidual: 0 };
        for (let n=0;n<150;n++) {
          await wait();
          if (!car.edge || car.edge!==edge) break;
          if (n%3) continue;
          trace.points.push([car.x,car.z]);
          trace.poses.push([car.x,car.z,car.yaw,car.halfL??car.half,car.halfWidth]);
          trace.stations.push(car.conn ? edge.len+car.cs : car.s);
          if (trace.heightCheck && !car.conn) {
            const profile = gradeWayAt(edge.wayId, car.x, car.z, 1.2);
            trace.heightCheck.samples++;
            if (!profile) trace.heightCheck.profileMisses++;
            else trace.heightCheck.maxResidual = Math.max(trace.heightCheck.maxResidual, Math.abs(car.y-profile.y));
          }
        }
        if (trace.points.length>=3) traces.push(trace);
      }
      return {lanes,traces, attempted:selected.map(c=>[c.row.key,c.row.lane]), bound:traffic.fitted??null,
        roadEdges:network.edges.length,busPaths:traffic.busPaths.size};
    }})(${JSON.stringify(site)},${JSON.stringify(phase)},${JSON.stringify(Object.fromEntries(Object.entries(fit.edges).filter(([k]) => site[4].some(way=>k.split('|')[1]===way)).map(([key,edge])=>[key,edge.lanes.flatMap((lane,i)=>lane?[i]:[])])))})`);
    evidence.lanes.push(...data.lanes);evidence.traces.push(...data.traces);
    evidence.sites.push({site:site[0],bound:data.bound,lanes:data.lanes.length,tracks:data.traces.length,roadEdges:data.roadEdges,busPaths:data.busPaths,attempted:data.attempted});
    console.log(evidence.sites.at(-1));
    await writeFile(output+'/'+phase+'.json',JSON.stringify(evidence));
    const shot=await send('Page.captureScreenshot',{format:'jpeg',quality:88});
    await writeFile(output+'/'+phase+'-'+site[0]+'.jpg',Buffer.from(shot.data,'base64'));
  }
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier});
} finally {socket.close();}
