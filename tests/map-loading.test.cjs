'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Geography=require('../src/coop-geography.js'),Places=require('../src/coop-local-places.js'),Blocks=require('../src/coop-city-blocks.js'),Districts=require('../src/coop-district-scene.js'),LBS=require('../src/map-model.js'),Stream=require('../src/lbs-map-stream.js');
function fixture(centers,roads=[]){
  const data={center:{lat:30,lon:120,crs:'WGS84'},radiusMeters:1000,features:[],places:[],gameNodes:[]},geo=Geography.create(data);
  const coordinates=points=>points.map(([x,y])=>{const p=geo.coordinate(x,y);return[p.lon,p.lat];});
  data.features=centers.map(([x,y,w=20,d=20],i)=>({id:i+1,kind:'building',tags:{building:'yes'},coordinates:coordinates([[x-w/2,y-d/2],[x+w/2,y-d/2],[x+w/2,y+d/2],[x-w/2,y+d/2],[x-w/2,y-d/2]])}));
  for(const [i,road]of roads.entries())data.features.push({id:100+i,kind:'road',name:'',tags:{},...road,coordinates:coordinates(road.points)});
  return data;
}

test('each building in the same closed street enclosure is an independent selection unit',()=>{
  const data=fixture([[100,100],[460,100],[820,100]],[{class:'residential',name:'真实道路',points:[[0,0],[1000,0],[1000,700],[0,700],[0,0]]}]),before=JSON.stringify(data),model=Districts.create(data,Places.create(data,{detail:true}));
  const owners=[100,460,820].map(east=>model.at({east,north:100}));assert.ok(owners.every(Boolean));assert.equal(new Set(owners.map(r=>r.id)).size,3);
  for(const [i,r]of owners.entries()){assert.equal(r.boundarySource,'building');assert.equal(r.buildingCount,1);assert.deepEqual(r.buildingIds,[String(i+1)]);assert.deepEqual(r.coordinates,data.features[i].coordinates);assert.equal(r.area,400);}
  assert.equal(model.at({east:360,north:350}),null);assert.equal(model.at({east:720,north:350}),null);assert.equal(JSON.stringify(data),before);
});

test('public streets, service lanes, private roads and bridges never combine neighbouring buildings',()=>{
  for(const road of [{class:'unclassified'},{class:'service',name:'公共巷道'},{class:'service'},{class:'service',name:'车库入口',tags:{service:'driveway'}},{class:'residential',tags:{access:'private'}},{class:'primary',tags:{bridge:'yes',layer:'1'}}]){
    const data=fixture([[70,100],[290,100]],[{class:'residential',name:'外围街道',points:[[0,0],[180,0],[360,0],[360,200],[180,200],[0,200],[0,0]]},{...road,points:[[180,0],[180,200]]}]),model=Districts.create(data,Places.create(data,{detail:true}));
    const left=model.at({east:70,north:100}),right=model.at({east:290,north:100});assert.ok(left&&right);assert.notEqual(left.id,right.id);assert.equal(model.at({east:180,north:100}),null);assert.equal(model.regions.length,2);
  }
});

test('missing road enclosures use only actual building footprints, including buildings across old grid seams',()=>{
  const data=fixture([[355,100,50,50],[450,100]]),before=JSON.stringify(data),model=Districts.create(data,Places.create(data));
  const owner=model.at({east:340,north:100});assert.ok(owner);assert.equal(owner.boundarySource,'building');for(const east of [350,365,375])assert.equal(model.at({east,north:100}).id,owner.id);
  assert.notEqual(model.at({east:450,north:100}).id,owner.id);assert.equal(model.at({east:405,north:100}),null);assert.ok(owner.area>=2499&&owner.area<=2501);assert.equal(JSON.stringify(data),before);
});

test('the real mapped seam failure is recovered without losing the cut or mutating source geometry',()=>{
  const input=require('./fixtures/map-seam.json'),before=JSON.stringify(input.args);
  const result=Blocks.overlay(input.method,...input.args);
  assert.ok(result.length>0);assert.ok(result.flat(4).every(Number.isFinite));
  assert.equal(JSON.stringify(input.args),before);
  assert.ok(result.every(r=>r[0].length>=4));
});

function streaming(){
  const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),timers=[],requests=[],commits=[],streamCommits=[],states=[],bases=[];
  let clock=1000,view={center:{lat:0,lon:0},radius:2000,span:1600};
  const combat={hidden:true},context=vm.createContext({
    L:LBS,LBSMapStream:Stream,missions:[],mapLocal:{},mapData:{center:{lat:0,lon:0},extentMeters:1000},mapCache:[],mapLocals:new WeakMap(),mapDistrictRegions:new WeakMap(),mapBuildRequest:null,streamTimer:null,streamRequest:null,streamVersion:0,streamLoading:false,streamQueued:false,twoDPointer:null,nextMapRequestAt:0,scene:{addBaseData:async source=>bases.push(source)},local:{},twoD:false,streamLatestView:null,streamPreviousView:null,streamDetailTimer:null,streamDetailRequest:null,mapInitialPreview:false,mapDetailRetry:null,mapBaseCache:[],
    mode:'demo',mapGPSFollow:true,mapInputActive:false,mapLastInputAt:-Infinity,mapSettleTimer:null,streamGPSAnchor:null,streamPreparedModel:null,mapEarlyDetails:null,
    $:id=>id==='combat'?combat:{dataset:{},classList:{toggle:()=>{}}},mapBuildings:true,currentMapView:()=>view,requestedMapView:()=>view,location:{protocol:'http:'},AbortController,Date,performance:{now:()=>clock},
    setTimeout:(callback,delay)=>{const item={callback,delay};timers.push(item);return item;},clearTimeout:item=>{if(item)item.cancelled=true;},cancelMapBuild:()=>{},
    mapAttribution:'ready',setMapStatus:(text,state='idle')=>states.push({text,state}),mapTrace:()=>({}),mapRecord:()=>{},
    fetch:(url,options)=>new Promise(resolve=>requests.push({url,signal:options.signal,resolve})),
    LBSMapWork:{prepareModel:async bytes=>({data:bytes.region||bytes,sourceData:bytes.region||bytes,local:{},metrics:{}})},
    commitStreamMapModel:async(model,controller)=>{assert.equal(controller.signal.aborted,false);streamCommits.push(model);context.mapData=model.data;context.mapLocal=model.local;context.streamPreparedModel=null;return true;},
    renderMap:async(next,latest)=>{commits.push({next,latest});context.mapData=next;return true;}
  });
  vm.runInContext(source.slice(source.indexOf('  function stopMapViewport(){'),source.indexOf('  async function initMap(')),context);
  const respond=(index,center,status=200)=>requests[index].resolve({status,ok:status===200,headers:{get:()=>null},json:async()=>({error:'unavailable'}),arrayBuffer:async()=>({byteLength:1,region:{center,extentMeters:4000,radiusMeters:2500,features:[],places:[]}})});
  return{context,requests,commits,streamCommits,states,timers,combat,bases,setView:next=>{view=next;},advance:ms=>{clock+=ms;},respond,get view(){return view;}};
}

test('the static demo never fetches maps or retries when panning beyond its bundled area',async()=>{
  const s=streaming();s.context.LBS_MAP_STATIC_DEMO=true;s.context.location.protocol='https:';
  s.context.startEarlyMapDetails(s.view);await s.context.loadMapDetails(s.view,0);
  await s.context.loadMapView(s.view,0,0);
  assert.equal(s.states.at(-1).text,'ready','preload reserves must not label the initial view as outside the demo');
  s.setView({...s.view,center:{lat:.1,lon:0}});await s.context.loadMapDetails(s.view,0);await s.context.loadMapView(s.view,0,0);
  assert.equal(s.requests.length,0);assert.equal(s.context.mapEarlyDetails,null);
  assert.equal(s.states.at(-1).state,'idle');assert.match(s.states.at(-1).text,/地图归位/);
  assert.equal(s.context.streamLoading,false);assert.equal(s.timers.length,0);
});

test('initial building download overlaps bundled model preparation and is consumed only once',async()=>{
  const s=streaming();let models=0;s.context.local=null;s.context.mapBuildRequest=new AbortController();s.context.scene.addBuildings=async()=>({added:1});
  s.context.LBSMapWork.prepareModel=async input=>{models++;return{data:input.region,sourceData:input.region,local:{},districtRegions:[],metrics:{}};};
  s.context.startEarlyMapDetails(s.view);assert.equal(s.requests.length,1);assert.match(s.requests[0].url,/stream=1/);
  s.context.local={};s.context.mapBuildRequest=null;const job=s.context.loadMapDetails(s.view,0);s.respond(0,s.view.center);await job;
  assert.equal(s.requests.length,1);assert.equal(models,1);assert.equal(s.streamCommits.length,1);assert.equal(s.context.mapEarlyDetails,null);
});

test('moving beyond an initial building download cancels it and discards its late response',async()=>{
  const s=streaming();let discarded=0;s.context.scene.addBuildings=async()=>({added:1});s.context.startEarlyMapDetails(s.view);
  s.setView({...s.view,center:{lat:.06,lon:0}});const job=s.context.loadMapDetails(s.view,0);assert.equal(s.requests.length,2);assert.equal(s.requests[0].signal.aborted,true);
  s.requests[0].resolve({body:{cancel:async()=>{discarded++;}}});s.respond(1,s.view.center);await job;
  assert.equal(discarded,1);assert.equal(s.streamCommits.length,1);assert.equal(s.streamCommits[0].data.center.lat,.06);
});

test('cancelling the adopted initial download cannot attach a late model',async()=>{
  const s=streaming();s.context.scene.addBuildings=async()=>({added:1});s.context.startEarlyMapDetails(s.view);
  const job=s.context.loadMapDetails(s.view,0);s.context.stopMapViewport();assert.equal(s.requests[0].signal.aborted,true);s.respond(0,s.view.center);await job;
  assert.equal(s.requests.length,1);assert.equal(s.streamCommits.length,0);assert.equal(s.context.mapCache.length,0);
});

test('continuous panning keeps the network job, displays roads first, and commits only current building models',async()=>{
  const s=streaming(),first=s.context.loadMapView(s.view,0,0);
  s.setView({center:{lat:.05,lon:0},radius:2000,span:1600});s.context.scheduleMapView(s.view);
  assert.equal(s.requests.length,1);assert.equal(s.requests[0].signal.aborted,false);
  s.respond(0,{lat:0,lon:0});await first;assert.equal(s.commits.length,0);assert.equal(s.context.mapBaseCache.length,1);assert.equal(s.bases.length,1);
  const second=s.context.loadMapView(s.view,0,0);s.respond(1,{lat:.05,lon:0});await second;
  assert.equal(s.commits.length,0,'road delivery must not wait for building or district models');assert.equal(s.bases.length,2);
  s.advance(500);s.context.mapCache=[s.context.mapBaseCache[0]];await s.context.loadMapDetails(s.view,0);
  assert.equal(s.commits.length,1);assert.equal(s.commits[0].next.center.lat,.05);assert.equal(s.context.streamLoading,false);
});

test('transient map failures retry with a bound and returning to covered land does not render stale data',async()=>{
  const failed=streaming(),job=failed.context.loadMapView(failed.view,0,0);failed.respond(0,null,503);await job;
  assert.ok(failed.timers.some(t=>!t.cancelled&&t.delay>=2000));assert.equal(failed.states.at(-1).state,'loading');
  const last=failed.context.loadMapView(failed.view,0,3);failed.respond(1,null,503);await last;assert.equal(failed.states.at(-1).state,'error');
  const covered=streaming(),pending=covered.context.loadMapView(covered.view,0,0);
  covered.setView({center:{lat:0,lon:0},radius:100,span:500});covered.context.scheduleMapView(covered.view);
  assert.equal(covered.requests[0].signal.aborted,false);covered.respond(0,{lat:0,lon:0});await pending;
  assert.equal(covered.commits.length,0);assert.equal(covered.states.at(-1).state,'idle');
});

test('preloading starts before an edge is visible and is not postponed by an ongoing drag',async()=>{
  const s=streaming();s.context.mapData.extentMeters=3000;s.context.scene={dragging:true};
  assert.equal(Stream.covers(s.context.mapData,s.view),true);assert.equal(Stream.ready(s.context.mapData,s.view),false);
  s.context.scheduleMapView(s.view);const timer=s.timers.find(t=>t.delay===80);
  for(let i=1;i<=20;i++)s.context.scheduleMapView({...s.view,center:{lat:i*.00001,lon:0}});
  assert.equal(s.timers.filter(t=>t.delay===80).length,1);assert.equal(timer.cancelled,undefined);
  const work=timer.callback();assert.equal(s.requests.length,1,'pointer-down must not defer the preload until release');
  assert.match(s.requests[0].url,/preload=1/);s.respond(0,{lat:0,lon:0});await work;
});

test('window planning reuses fixed cells and keeps a preload reserve around the visible map',()=>{
  const view={center:{lat:30.21,lon:120.2},radius:1600,span:1800},plan=Stream.plan(view);
  assert.deepEqual(plan.center,Stream.plan({...view,center:{lat:30.2101,lon:120.2001}}).center);
  assert.ok(Stream.ready({center:plan.center,extentMeters:plan.radius*1.45},view));
  assert.ok(plan.radius<=6000&&plan.radius>=1000);
});

test('the 2D view follows input outside all loaded coverage without changing pan or zoom',()=>{
  const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),data=fixture([]),geo=Geography.create(data),attributes={},map={setAttribute:(key,value)=>{attributes[key]=value;}},context=vm.createContext({mapLocal:{geo},layout2D:()=>{},$:()=>map});
  vm.runInContext(source.slice(source.indexOf('  function set2DView('),source.indexOf('  let mapBuildRequest=')),context);
  const center=geo.coordinate(15000,-8000),view={center,span:4000};context.set2DView(view);
  const box=attributes.viewBox.split(' ').map(Number);assert.ok(Math.abs(box[0]+box[2]/2-15000)<.001);assert.ok(Math.abs(-box[1]-box[3]/2+8000)<.001);assert.equal(box[2],4000);assert.equal(view.center,center);
});

test('real 3D pointer pans continue beyond the loaded map and preserve zoom across passive updates',()=>{
  const THREE=require('../src/vendor/three-0.160.1.min.js'),source=fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),data=fixture([]),root={dataset:{}},geo=Geography.create(data);
  const context=vm.createContext({THREE,root,geo,camera:new THREE.OrthographicCamera(-1500,1500,1000,-1000,1,9000),target:new THREE.Vector3(),offset:new THREE.Vector3(620,1400,1600),ground:new THREE.Object3D(),plane:new THREE.Plane(new THREE.Vector3(0,1,0),-1),ray:new THREE.Raycaster(),uv:new THREE.Vector2(),hit:new THREE.Vector3(),canvas:{getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720})},
    span:1600,width:1280,height:720,active:true,framing:true,cameraDirty:true,projectionDirty:true,viewInput:false,viewChanged:false,labelsDirty:false,dirty:false,pendingPan:null,options:{streamMap:true,detailedCity:true}});
  vm.runInContext(source.slice(source.indexOf(' function invalidateCamera('),source.indexOf(' function resize(){'))+source.slice(source.indexOf(' function viewRadius(){'),source.indexOf(' function movePointer(e)')),context);
  context.updateCamera();const before=context.getView();
  for(let i=0;i<4;i++)vm.runInContext('cast({clientX:420,clientY:365});ray.ray.intersectPlane(plane,hit);pendingPan={clientX:1040,clientY:365,anchor:hit.clone()};applyPan();',context);
  const after=context.getView();assert.ok(Stream.distance(before.center,after.center)>5000);assert.equal(after.span,1600);assert.equal(Stream.covers({...data,extentMeters:1450},after),false);
  vm.runInContext('cameraDirty=true;updateCamera();',context);assert.equal(context.getView().span,1600);assert.ok(Math.abs(context.ground.position.x-context.target.x)<.001);
});

test('a spatial cache subset preserves original footprints and excludes distant buildings',()=>{
  const data=fixture([[100,100],[4000,4000]]),before=JSON.stringify(data),part=Stream.subset(data,data.center,1000);
  assert.equal(part.features.length,1);assert.equal(part.features[0],data.features[0]);assert.equal(JSON.stringify(data),before);
  assert.equal(part.extentMeters,1450);
});

test('worker-built districts restore view aliases and mission membership without changing source geometry',()=>{
  const Work=require('../src/lbs-map-work.js'),data=fixture([[100,100],[460,100]],[{class:'residential',points:[[180,-1000],[180,1000]]}]),geo=Geography.create(data),point=geo.coordinate(100,100),messages=[],scope={CoopGeography:Geography,CoopLocalPlaces:Places,CoopDistrictSelection:Districts,performance,postMessage:m=>messages.push(structuredClone(m))};
  Work.workerMain(scope);scope.onmessage({data:{type:'lbs-map:prepare',id:1,input:data,districts:true,extraPlaces:[{id:'mission-point',...point,kind:'generic'}]}});
  const result=messages.find(m=>m.type==='lbs-map:result');assert.ok(result);assert.ok(result.metrics.districtMs>=0);
  const before=JSON.stringify(result.districtRegions),local={...result.local,geo,buildings:result.local.buildings.map(b=>({...b,id:'view-'+b.id})),places:[{id:'mission-point',...point,...geo.local(point.lon,point.lat),kind:'generic'}]},restored=Districts.restore(result.districtRegions,local),direct=Districts.create(data,{...local,sourceBuildings:result.local.sourceBuildings});
  assert.equal(restored.at({east:100,north:100}).id,direct.at({east:100,north:100}).id);assert.equal(restored.forPlace(local.places[0]).id,direct.forPlace(local.places[0]).id);
  assert.ok(restored.regions.some(r=>r.buildingIds.some(id=>id.startsWith('view-'))));assert.equal(JSON.stringify(result.districtRegions),before);
});

test('scene micro-batches keep time slicing and release partial work on cancellation',async()=>{
  const Work=require('../src/lbs-map-work.js');let clock=0,pauses=0,closed=0;
  function* geometry(){try{for(let i=0;i<100;i++){clock+=.25;yield 'geometry';}return 'ready';}finally{closed++;}}
  const result=await Work.runBuild(geometry(),{batchSize:8,budgetMs:4,now:()=>clock,yieldTask:async()=>{pauses++;}});
  assert.equal(result.value,'ready');assert.ok(pauses>=6);assert.ok(result.metrics.maxContinuousMs<=4);assert.equal(closed,1);
  const controller=new AbortController();let phases=0;
  await assert.rejects(Work.runBuild(geometry(),{batchSize:8,budgetMs:4,signal:controller.signal,now:()=>clock,yieldTask:async()=>{},onPhase:()=>{if(++phases===2)controller.abort();}}),{name:'AbortError'});assert.equal(closed,2);
});

test('preloading data does not build distant models and a render window keeps the wider source for the next pan',()=>{
  const Work=require('../src/lbs-map-work.js'),data=fixture([[100,100],[4000,4000]]);data.radiusMeters=4000;data.extentMeters=5800;
  let builds=0;const results=[],scope={CoopGeography:Geography,CoopLocalPlaces:{create(){builds++;throw Error('data-only preload must not build models');}},performance,postMessage:m=>results.push(m)};
  Work.workerMain(scope);scope.onmessage({data:{type:'lbs-map:prepare',id:1,input:data,dataOnly:true}});
  assert.equal(builds,0);assert.equal(results.find(m=>m.type==='lbs-map:result').data,data);
  const cropped=Stream.renderWindow(data,{center:data.center,radius:1200,span:1600});assert.ok(cropped.extentMeters<data.extentMeters);assert.equal(cropped.features.length,1);assert.equal(data.features.length,2);assert.ok(Stream.drawReady(cropped,{center:data.center,radius:1200}));
});

test('cached polygon meshes preserve courtyards and reproject correctly without mutating cached buffers',()=>{
  const THREE=require('../src/vendor/three-0.160.1.min.js'),source=fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),context=vm.createContext({THREE,CoopGeography:Geography,CoopCityBlocks:Blocks,CoopLocalPlaces:Places,polygonClipping:require('../src/vendor/polygon-clipping-0.15.7.min.js')});vm.runInContext(source,context);
  const geo=Geography.create({center:{lat:30,lon:120,crs:'WGS84'},radiusMeters:2000}),coords=fixture([[100,100,80,80]]).features[0].coordinates;
  const a=context.districtCachedPolygon(geo,coords,12,[]);assert.equal(a.hit,false);a.geometry.translate(0,7,0);
  const nextGeo=Geography.create({center:{lat:30.002,lon:120.003,crs:'WGS84'},radiusMeters:2000}),hit=context.districtCachedPolygon(nextGeo,coords,12,[]),fresh=context.districtCachedPolygon(nextGeo,coords,12,[],false);assert.equal(hit.hit,true);
  const p=hit.geometry.attributes.position.array,q=fresh.geometry.attributes.position.array;assert.equal(p.length,q.length);for(let i=0;i<p.length;i++)assert.ok(Math.abs(p[i]-q[i])<.003,'cached geometry must stay within 3 mm of a fresh WGS84 projection');
  const hole=fixture([[100,100,20,20]]).features[0].coordinates,courtyard=context.districtCachedPolygon(geo,coords,12,[hole]);assert.equal(courtyard.hit,false);assert.ok(courtyard.geometry.attributes.position.count>a.geometry.attributes.position.count);
  a.geometry.dispose();hit.geometry.dispose();fresh.geometry.dispose();courtyard.geometry.dispose();
});

test('directional scene preparation starts with hundreds of metres of visible geometry still ahead',()=>{
  const data=fixture([[100,100],[2000,100]]);data.radiusMeters=4000;data.extentMeters=5800;
  const geo=Geography.create(data),view={center:data.center,radius:1905,span:1600},previous={...view,center:geo.coordinate(-200,0)},draw=Stream.renderWindow(data,view,previous);
  assert.ok(geo.local(draw.center.lon,draw.center.lat).east>500);assert.ok(Stream.drawReady(draw,view,previous));
  assert.ok(Stream.drawReady(draw,{...view,center:geo.coordinate(1000,0)},view),'the larger model window retains a kilometre of forward travel');
  const next={...view,center:geo.coordinate(1200,0)};assert.equal(Stream.drawReady(draw,next,view),false);assert.ok(Stream.covers(draw,{...next,center:geo.coordinate(1800,0)}),'preparation starts before a 600 m forward movement could expose the data edge');
  const edge={...view,center:geo.coordinate(1000,0)},source={...data,radiusMeters:3000,extentMeters:4350};assert.ok(Stream.covers(source,edge));assert.equal(Stream.ready(source,edge,view),false,'raw preloading begins with a larger reserve than building detail');
});

test('the drawn building reserve covers a full short pan and refills before its visible edge arrives',()=>{
 const view={center:{lat:30,lon:120},radius:1905,span:1600},geo=Geography.create({center:{...view.center,crs:'WGS84'},radiusMeters:1000}),initial=Stream.geometryWindow(view),next={...view,center:geo.coordinate(1600,0)};
 assert.ok(Stream.distance(initial.center,next.center)+next.radius<=initial.radius+260,'an ordinary full-width gesture can use already drawn and selectable bodies');
 const forward=Stream.geometryWindow(view,{...view,center:geo.coordinate(-200,0)});
 assert.ok(Math.abs(geo.local(forward.center.lon,forward.center.lat).east-600)<.01);assert.ok(forward.radius-view.radius>=1400);
 assert.ok(Stream.distance(initial.center,next.center)+next.radius+420>initial.radius+260,'refill is requested before the visible reserve is exhausted');
});


test('road preloading runs while a building build is pending and heavy work stops after leaving its window',async()=>{
  const s=streaming(),controller=new AbortController();controller.viewportRegion={center:{lat:0,lon:0},extentMeters:4000};s.context.streamDetailRequest=controller;s.context.mapBuildRequest={viewportRegion:controller.viewportRegion};
  s.context.cancelMapBuild=()=>{s.context.mapBuildRequest=null;};s.setView({center:{lat:.1,lon:0},radius:2000,span:1600});s.context.scheduleMapView(s.view);
  assert.equal(controller.signal.aborted,true);assert.ok(s.timers.some(t=>t.delay===80));
  const job=s.context.loadMapView(s.view,0,0);assert.equal(s.requests.length,1);assert.match(s.requests[0].url,/layer=base/);s.respond(0,s.view.center);await job;assert.equal(s.bases.length,1);
});

test('the cold building request is smaller than the road reserve and a failure leaves the base usable with bounded retries',async()=>{
  const s=streaming();s.context.mapBaseCache=[{center:s.view.center,extentMeters:8000}];
  const job=s.context.loadMapDetails(s.view,0);assert.equal(s.requests.length,1);assert.doesNotMatch(s.requests[0].url,/layer=base/);
  const radius=Number(new URL('http://localhost'+s.requests[0].url).searchParams.get('radius'));assert.ok(radius<Stream.plan(s.view).radius);s.respond(0,null,503);await job;
  assert.equal(s.context.mapDetailRetry.count,1);assert.equal(s.commits.length,0);assert.equal(s.context.mapBaseCache.length,1);assert.ok(s.timers.some(t=>t.delay>=4900));
  s.context.mapDetailRetry.count=3;s.context.streamDetailTimer=null;const count=s.timers.length;s.context.scheduleMapDetails(s.view);assert.equal(s.timers.length,count);s.context.scheduleMapView(s.view);assert.equal(s.states.at(-1).state,'error','the manual retry must remain visible while roads are already cached');
});

test('the inexpensive base mesh preserves mapped roads, water courtyards and source geometry without building vertices',()=>{
  const THREE=require('../src/vendor/three-0.160.1.min.js'),source=fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),context=vm.createContext({THREE,CoopGeography:Geography,CoopCityBlocks:Blocks,CoopLocalPlaces:Places,polygonClipping:require('../src/vendor/polygon-clipping-0.15.7.min.js')});vm.runInContext(source,context);
  const data=fixture([[500,500]],[{class:'primary',points:[[-100,0],[100,0]]},{class:'primary',tags:{tunnel:'yes'},points:[[-100,100],[100,100]]}]),water=fixture([[0,0,80,80]]).features[0],hole=fixture([[0,0,20,20]]).features[0];data.features.push({...water,kind:'water',holes:[hole.coordinates]});const before=JSON.stringify(data),geo=Geography.create(data),built=context.districtDrain(context.districtBaseGeometrySteps(geo,data));
  assert.equal(built.roads,1);assert.equal(built.land,1);assert.equal(JSON.stringify(data),before);const p=built.geometry.attributes.position;
  let waterArea=0;for(let i=0;i<p.count;i+=3){assert.ok(p.getY(i)<=.38+.00001);if(p.getY(i)<0)waterArea+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getX(i+2)-p.getX(i))*(p.getZ(i+1)-p.getZ(i)))/2;}
  assert.ok(Math.abs(waterArea-6000)<.1);built.geometry.dispose();
});

test('a lightweight parse can finish independently while a building worker is held or cancelled',async()=>{
  const Work=require('../src/lbs-map-work.js'),data=fixture([]),workers=[];
  function workerFactory(){const listeners=new Map(),worker={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name),terminate(){this.stopped=true;},postMessage(message){this.message=message;},deliver(){const scope={CoopGeography:Geography,CoopLocalPlaces:Places,LBSMapStream:Stream,performance,postMessage:message=>listeners.get('message')?.({data:message})};Work.workerMain(scope);scope.onmessage({data:this.message});}};workers.push(worker);return worker;}
  const controller=new AbortController(),heavy=Work.prepareModel(data,{signal:controller.signal,workerSource:'test-worker',workerFactory});
  const parsed=Work.prepareModel(data,{dataOnly:true,workerSource:'test-worker',workerFactory});assert.equal(workers.length,2);workers[1].deliver();assert.equal((await parsed).data,data);assert.equal(workers[0].stopped,undefined);
  controller.abort();await assert.rejects(heavy,{name:'AbortError'});assert.equal(workers[0].stopped,true);assert.equal(workers[1].stopped,true);
});

test('successive live frames reuse a worker without retaining the prior geographic model',async()=>{
  const Work=require('../src/lbs-map-work.js'),workers=[];Work.clearIdleWorkers();
  function workerFactory(){const listeners=new Map(),scope={CoopGeography:Geography,CoopLocalPlaces:Places,LBSMapStream:Stream,performance,postMessage:message=>listeners.get('message')?.({data:message})},worker={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),terminate(){this.stopped=true;},postMessage(message){scope.onmessage({data:message});}};Work.workerMain(scope);workers.push(worker);return worker;}
  try{const first=await Work.prepareModel(fixture([[0,0,40,40]]),{reuseWorker:true,workerSource:'live-test',workerFactory}),next=fixture([[0,0,60,60],[500,0,40,40]]);next.center={...next.center,lat:31};
    const second=await Work.prepareModel(next,{reuseWorker:true,workerSource:'live-test',workerFactory});assert.equal(workers.length,1);assert.equal(workers[0].stopped,undefined);assert.equal(second.metrics.workerReused,true);assert.equal(first.local.buildings.length,1);assert.equal(second.local.buildings.length,2);assert.equal(second.data.center.lat,31);
  }finally{Work.clearIdleWorkers();}assert.equal(workers[0].stopped,true);
});

test('cancelling a reused worker terminates it and the next frame starts with a fresh worker',async()=>{
  const Work=require('../src/lbs-map-work.js'),workers=[];let hold=false;Work.clearIdleWorkers();
  function workerFactory(){const listeners=new Map(),scope={CoopGeography:Geography,CoopLocalPlaces:Places,LBSMapStream:Stream,performance,postMessage:message=>listeners.get('message')?.({data:message})},worker={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),terminate(){this.stopped=true;},postMessage(message){if(!hold)scope.onmessage({data:message});}};Work.workerMain(scope);workers.push(worker);return worker;}
  try{await Work.prepareModel(fixture([]),{reuseWorker:true,workerSource:'live-test',workerFactory});hold=true;const controller=new AbortController(),pending=Work.prepareModel(fixture([]),{reuseWorker:true,workerSource:'live-test',workerFactory,signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(workers.length,1);assert.equal(workers[0].stopped,true);
    hold=false;await Work.prepareModel(fixture([]),{reuseWorker:true,workerSource:'live-test',workerFactory});assert.equal(workers.length,2);
  }finally{Work.clearIdleWorkers();}
});


test('maximum zoom still reaches a satisfied preload state instead of requesting the same capped area forever',()=>{
  for(const radius of[1905,4400,6200,7000,7400])for(const lon of[120.2011,120.2074]){
    const view={center:{lat:30.2131,lon},radius,span:5200},previous={...view,center:{lat:30.212,lon:lon-.002}},plan=Stream.plan(view,previous);
    assert.ok(Stream.ready({center:plan.center,extentMeters:plan.radius*1.45},view),String(radius));
  }
});


test('zooming out keeps road preloading active without building an oversized district scene',async()=>{
  const s=streaming();s.setView({...s.view,span:5200,radius:6200});s.context.scheduleMapView(s.view);assert.equal(s.context.streamDetailTimer,null);assert.ok(s.timers.some(t=>t.delay===80));
  await s.context.loadMapDetails(s.view,0);assert.equal(s.requests.length,0);const job=s.context.loadMapView(s.view,0,0);assert.equal(s.requests.length,1);assert.match(s.requests[0].url,/layer=base/);s.respond(0,s.view.center);await job;assert.equal(s.commits.length,0);
});


test('2D road layers keep the latest areas when their bounded cache evicts older layers',async()=>{
  const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),children=[],flat={querySelectorAll:()=>children,insertBefore:g=>children.unshift(g),get firstChild(){return children[0];}},local={geo:{}},context=vm.createContext({scene:null,twoD:true,mapLocal:local,$:()=>flat,document:{createElementNS:()=>({dataset:{},append(){},remove(){children.splice(children.indexOf(this),1);}})},mapSvgSteps:()=>{},LBSMapWork:{runBuild:async()=>({value:{querySelector:()=>null,childNodes:[]}})}});
  vm.runInContext(source.slice(source.indexOf('  async function showMapBase('),source.indexOf('  function scheduleMapView(')),context);
  for(let i=0;i<5;i++)await context.showMapBase({center:{lat:i,lon:0},radiusMeters:1000,features:[]});
  assert.deepEqual(children.map(g=>g.dataset.mapBase),['4:0:1000:0','3:0:1000:0','2:0:1000:0']);
});


test('a detailed worker model can render the lightweight 3D fallback without block-summary metadata',()=>{
  const Three=require('../src/vendor/three-0.160.1.min.js'),source=fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),root={dataset:{}},canvas={},data=fixture([[100,100]],[{class:'primary',points:[[-100,0],[100,0]]}]),local=Places.create(data,{detail:true});assert.equal(local.blockGrouping,undefined);
  class Renderer{constructor(){this.shadowMap={};}setPixelRatio(){}dispose(){this.disposed=true;}}
  let frames=0;const context=vm.createContext({THREE:{...Three,WebGLRenderer:Renderer},CoopGeography:Geography,CoopCityBlocks:Blocks,CoopLocalPlaces:Places,CoopInvasion:{palette:{},rifts:[],createEffects:()=>({destroy(){}})},LBSCityArt:{palette:{}},devicePixelRatio:1,requestAnimationFrame(){frames++;return 1;},cancelAnimationFrame(){},polygonClipping:require('../src/vendor/polygon-clipping-0.15.7.min.js')});vm.runInContext(source,context);
  const scene=context.districtDrain(context.buildDistrictScene(data,local,()=>{},{canvas,container:{},root,staged:true,detailedCity:true,streamMap:true,baseOnly:true,mapLabelCandidates:()=>[],districtTaskCount(){throw Error('external labels must not calculate every district task again');},districtSelection:Districts.create(data,local)}));
  assert.equal(scene.baseOnly,true);assert.equal(scene.activated,false);assert.equal(frames,0);assert.equal(JSON.parse(root.dataset.localModels).footprints,0);assert.equal(JSON.parse(root.dataset.localModels).renderedBodies,0);scene.destroy({replaceCanvas:false,preserveMetadata:true});
});


test('closing or opening a street loop does not change building selection boundaries',()=>{
  const outer={class:'residential',name:'环街',points:[[0,0],[500,0],[1000,0],[1000,700],[0,700],[0,0]]},data=fixture([[100,100],[820,100]],[outer,{class:'residential',points:[[500,0],[500,400]]}]),model=Districts.create(data,Places.create(data,{detail:true}));
  assert.notEqual(model.at({east:100,north:100}).id,model.at({east:820,north:100}).id);assert.equal(model.at({east:500,north:200}),null);
  const open=fixture([[100,100],[820,100]],[{...outer,points:outer.points.slice(0,-1)}]),fallback=Districts.create(open,Places.create(open,{detail:true}));assert.deepEqual(fallback.regions.map(r=>[r.id,r.coordinates]),model.regions.map(r=>[r.id,r.coordinates]));
});

test('building boundaries follow the mapped footprint beside slanted streets',()=>{
  const points=[[0,0],[900,70],[760,800],[30,650],[0,0]],data=fixture([[100,100],[460,350]],[{class:'unclassified',name:'斜向街道',points}]),model=Districts.create(data,Places.create(data,{detail:true})),r=model.at({east:460,north:350});assert.equal(r.boundarySource,'building');assert.notEqual(model.at({east:100,north:100}).id,r.id);assert.deepEqual(r.coordinates,data.features[1].coordinates);
});

test('individual building identity and membership stay stable when the loading center changes',()=>{
  const data=fixture([[100,100],[460,100]],[{class:'residential',name:'稳定道路',points:[[0,0],[1000,0],[1000,700],[0,700],[0,0]]}]),geo=Geography.create(data),point=geo.coordinate(460,100),moved={...data,center:{...geo.coordinate(180,-120),crs:'WGS84'}},left=Districts.create(data,Places.create(data)),rightLocal=Places.create(moved),right=Districts.create(moved,rightLocal),a=left.at({east:460,north:100}),b=right.at(rightLocal.geo.local(point.lon,point.lat));
  assert.equal(a.id,b.id);assert.equal(a.name,b.name);assert.deepEqual(a.buildingIds.filter(id=>['1','2'].includes(id)).sort(),b.buildingIds.filter(id=>['1','2'].includes(id)).sort());
});

test('nested street loops leave buildings independent and unbuilt land unselectable',()=>{
  const data=fixture([[100,100],[500,500]],[{class:'residential',name:'外环路',points:[[0,0],[1000,0],[1000,1000],[0,1000],[0,0]]},{class:'residential',name:'内环路',points:[[300,300],[700,300],[700,700],[300,700],[300,300]]}]),model=Districts.create(data,Places.create(data,{detail:true})),outside=model.at({east:100,north:100}),inside=model.at({east:500,north:500});assert.equal(outside.boundarySource,'building');assert.equal(inside.boundarySource,'building');assert.notEqual(outside.id,inside.id);assert.equal(outside.holes.length,0);assert.equal(model.at({east:300,north:500}),null);assert.equal(model.at({east:200,north:200}),null);
});

test('a campus keeps each mapped building selectable without making its open grounds a selection unit',()=>{
  const data=fixture([[120,120],[260,200]]),geo=Geography.create(data),campus=fixture([[200,200,350,350]]).features[0],point=geo.coordinate(200,200);data.places=[{id:'way/campus',name:'真实校园',tags:{amenity:'school'},coordinates:campus.coordinates,...point}];data.gameNodes=[{id:'school',placeId:'way/campus'}];const before=JSON.stringify(data),local=Places.create(data,{detail:true}),model=Districts.create(data,local);
  const a=model.at({east:120,north:120}),b=model.at({east:260,north:200});assert.equal(a.boundarySource,'building');assert.notEqual(a.id,b.id);assert.equal(a.buildingCount,1);assert.equal(b.buildingCount,1);assert.equal(a.kind,'school');assert.equal(b.kind,'school');assert.notEqual(a.name,b.name);assert.equal(model.at({east:200,north:200}),null);assert.equal(model.at({east:500,north:200}),null);assert.ok([a,b].includes(model.forPlace(local.places[0])));assert.equal(JSON.stringify(data),before);
});

test('courtyards, hidden source outlines, unfinished fragments and underground structures are not building selection units',()=>{
  const data=fixture([[100,100,80,80],[250,100],[300,100],[350,100]]),hole=fixture([[100,100,20,20]]).features[0].coordinates;
  data.features[0].holes=[hole];data.features[1].hidden3D=true;data.features[2].geometryComplete=false;data.features[3].tags.location='underground';
  const model=Districts.create(data,Places.create(data,{detail:true})),r=model.at({east:70,north:100});assert.ok(r);assert.equal(model.regions.length,1);assert.equal(r.area,6000);assert.equal(r.holes.length,1);assert.equal(model.at({east:100,north:100}),null);assert.equal(model.raycast({origin:{x:100,y:200,z:-100},direction:{x:0,y:-1,z:0}}),null);
});

test('3D roof and facade hits choose the visible building even when their ground projection lands outside it',()=>{
  const data=fixture([[100,100,40,40],[180,100,40,40]]);data.features[0].tags={building:'hospital',height:'50'};data.features[1].tags={building:'apartments',height:'25'};
  const model=Districts.create(data,Places.create(data,{detail:true})),r=model.at({east:100,north:100}),roof={origin:{x:100,y:151.3,z:-200},direction:{x:0,y:-1,z:1}},wall={origin:{x:100,y:64,z:-200},direction:{x:0,y:-.3,z:1}};
  assert.equal(model.at({east:100,north:48.7}),null);assert.equal(model.raycast(roof).id,r.id);assert.equal(model.raycast(wall).id,r.id);assert.equal(model.raycast(roof,'residence'),null);assert.equal(model.raycast(roof,'all',new Set(['2'])),null);assert.equal(model.at({east:180,north:100},'hospital'),null);
});

test('overlapping building bodies remain independent and explicit task membership chooses just one',()=>{
  const data=fixture([[100,100,80,60],[105,100,25,25]]);data.features[0].tags.height='8';data.features[1].tags={building:'commercial',height:'64',min_height:'8'};
  const local=Places.create(data,{detail:true}),model=Districts.create(data,local),upper=model.at({east:105,north:100}),lower=model.forPlace({...local.buildings[0],buildingIds:[1]});
  assert.equal(model.regions.length,2);assert.notEqual(upper.id,lower.id);assert.deepEqual(lower.buildingIds,['1']);assert.deepEqual(upper.buildingIds,['2']);assert.equal(model.raycast({origin:{x:105,y:200,z:-100},direction:{x:0,y:-1,z:0}}).id,upper.id);
});



test('a cached full map with insufficient forward coverage requests a new window instead of rebuilding itself forever',async()=>{
  const s=streaming(),geo=Geography.create({center:{...s.view.center,crs:'WGS84'},radiusMeters:2000}),view={...s.view,center:geo.coordinate(600,0),radius:1905};s.setView(view);s.context.streamPreviousView={...view,center:geo.coordinate(400,0)};const old={center:{lat:0,lon:0},extentMeters:2900,radiusMeters:2000};
  assert.ok(Stream.covers(old,view));assert.equal(Stream.drawReady(old,view,s.context.streamPreviousView),false);s.context.mapCache=[old];s.context.mapBaseCache=[{...old,extentMeters:8000}];
  const job=s.context.loadMapDetails(view,0);assert.equal(s.requests.length,1);s.respond(0,view.center);await job;assert.equal(s.commits.length,1);assert.notEqual(s.commits[0].next,old);
});

test('real Binjiang buildings keep their own footprints across a shifted loading origin',()=>{
  const data=require('./fixtures/binjiang-map.json'),before=JSON.stringify(data),local=Places.create(data,{detail:true}),first=Districts.create(data,local),moved={...data,center:{...data.center,...local.geo.coordinate(100,-80)}},nextLocal=Places.create(moved,{detail:true}),next=Districts.create(moved,nextLocal);
  assert.equal(first.regions.length,local.sourceBuildings.filter(b=>!b.underground&&!b.hidden3D&&!b.incomplete).length);assert.ok(first.regions.every(r=>r.boundarySource==='building'&&r.buildingCount===1));
  for(const a of first.regions){const b=next.byId.get(a.id);assert.ok(b);assert.equal(a.name,b.name);assert.deepEqual(a.coordinates,b.coordinates);assert.equal(a.area,b.area);}
  assert.equal(JSON.stringify(data),before);
});

test('a new drag cancels even a still-covered building job while road loading stays independent',async()=>{
  const s=streaming(),detail=new AbortController(),build=new AbortController();detail.viewportRegion={center:s.view.center,extentMeters:8000};build.viewportRegion=detail.viewportRegion;s.context.streamDetailRequest=detail;s.context.mapBuildRequest=build;
  s.context.cancelMapBuild=()=>{build.abort();s.context.mapBuildRequest=null;};s.context.mapInteraction(true);
  assert.equal(detail.signal.aborted,true);assert.equal(build.signal.aborted,true);assert.equal(s.context.mapDetailBusy(),true);
  await s.context.loadMapDetails(s.view,0);assert.equal(s.requests.length,0);
  const roads=s.context.loadMapView(s.view,0,0);assert.match(s.requests[0].url,/layer=base/);s.respond(0,s.view.center);await roads;assert.equal(s.bases.length,1);assert.equal(s.commits.length,0);
});

test('a legacy scene without live appends caches moving responses before replacing its canvas',async()=>{
  const s=streaming(),jobs=[];s.context.mapBaseCache=[{center:s.view.center,extentMeters:8000}];
  s.context.LBSMapWork.prepareModel=async(input,options)=>{jobs.push(options);return{data:input.region||input,sourceData:input.region||input,local:{},metrics:{}};};
  const pending=s.context.loadMapDetails(s.view,0);s.context.mapInteraction(true);s.respond(0,s.view.center);await pending;
  assert.deepEqual(jobs.map(j=>!!j.dataOnly),[true]);assert.equal(s.context.mapCache.length,1);assert.equal(s.commits.length,0);assert.equal(s.requests[0].signal.aborted,false);
  s.context.mapInteraction(false);await s.context.loadMapDetails(s.view,0);assert.equal(jobs.length,1,'release alone does not end the quiet period');
  s.advance(500);await s.context.loadMapDetails(s.view,0);assert.deepEqual(jobs.map(j=>!!j.dataOnly),[true,false]);assert.equal(s.commits.length,1);assert.equal(s.requests.length,1,'the interrupted fetch is reused');
});

test('dragging, repeated zoom input and incomplete coverage retain existing models in both views',()=>{
  for(const twoD of [false,true]){
    const s=streaming(),visibility=[],hidden=[],root={dataset:{},classList:{toggle:(name,value)=>{assert.equal(name,'map-hide-buildings');hidden.push(value);}}},element=s.context.$;
    s.context.twoD=twoD;s.context.$=id=>id==='lbs-scene-root'?root:element(id);s.context.scene={setBuildingsVisible:value=>visibility.push(value),buildingsCover:()=>true};
    s.context.mapInteraction(true);s.advance(600);assert.equal(s.context.mapDetailBusy(),true,'holding a drag still defers new geometry');assert.equal(visibility.at(-1),true);
    s.context.scene.buildingsCover=()=>false;s.setView({...s.view,center:{lat:.02,lon:0}});s.context.updateMapDetailVisibility();assert.equal(visibility.at(-1),true,'existing models remain visible beyond their coverage until replacement');
    s.context.mapInteraction(false);s.advance(300);assert.equal(s.context.mapDetailBusy(),true);s.context.mapInteraction(false);s.advance(300);assert.equal(s.context.mapDetailBusy(),true);s.advance(200);
    s.context.updateMapDetailVisibility();assert.equal(s.context.mapDetailBusy(),false);assert.ok(visibility.every(value=>value===true));assert.ok(hidden.every(value=>value===false));assert.equal(root.dataset.mapDetailStage,'buildings');
    s.context.mapBuildings=false;s.context.mapInteraction(true);assert.equal(visibility.at(-1),false);assert.equal(hidden.at(-1),true,'simple-map mode still hides buildings');
    s.context.mapBuildings=true;s.setView({...s.view,span:3000});s.context.updateMapDetailVisibility();assert.equal(visibility.at(-1),false,'the distant view still uses the simple map');
    s.setView({...s.view,span:1600});s.context.updateMapDetailVisibility();assert.equal(visibility.at(-1),true,'zooming back restores models even during motion');
  }
});

test('nearby GPU rebuilding reuses the existing geographic model without fetching or reconstructing districts',async()=>{
  const s=streaming();s.context.mapData={center:s.view.center,extentMeters:8000};s.context.mapCache=[s.context.mapData];s.context.scene={buildingsCover:()=>false};s.context.LBSMapWork.prepareModel=async()=>{throw Error('geographic model must be reused');};
  s.context.scheduleMapDetails(s.view,0);assert.ok(s.context.streamDetailTimer,'geographic coverage does not mean that a sparse GPU window covers the new view');await s.context.streamDetailTimer.callback();assert.equal(s.requests.length,0);assert.equal(s.commits.length,1);assert.equal(s.commits[0].next,s.context.mapData);
});

test('a paused build does no scene work and can resume or be cancelled while input owns the thread',async()=>{
  const Work=require('../src/lbs-map-work.js');let allowed=false,steps=0;function* geometry(){steps++;yield 'wall';steps++;return 'complete';}
  const controller=new AbortController(),cancelled=Work.runBuild(geometry(),{canRun:()=>allowed,signal:controller.signal});controller.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(steps,0);
  const resumed=Work.runBuild(geometry(),{canRun:()=>allowed});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(steps,0);allowed=true;assert.equal((await resumed).value,'complete');assert.equal(steps,2);
});

test('streamed wall strips preserve the outer footprint and courtyard with outward facing normals',()=>{
  const THREE=require('../src/vendor/three-0.160.1.min.js'),context=vm.createContext({THREE,CoopGeography:Geography,CoopCityBlocks:Blocks,CoopLocalPlaces:Places,polygonClipping:require('../src/vendor/polygon-clipping-0.15.7.min.js')});vm.runInContext(fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),context);
  const data=fixture([[0,0,80,80],[0,0,20,20]]),geo=Geography.create(data),outer=data.features[0].coordinates,hole=data.features[1].coordinates,before=JSON.stringify(data),g=context.districtWallGeometry(geo,outer,12,[hole]),p=g.attributes.position,n=g.attributes.normal;assert.equal(p.count,48);
  let surface=0;for(let i=0;i<p.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2),cross=b.sub(a).cross(c.sub(a)),normal=new THREE.Vector3().fromBufferAttribute(n,i);surface+=cross.length()/2;assert.ok(cross.normalize().dot(normal)>.9999);assert.equal(normal.y,0);}
  assert.ok(Math.abs(surface-4800)<.01);assert.equal(JSON.stringify(data),before);g.dispose();
});

test('nearby generation excludes distant models but keeps a large footprint crossing the visible window',()=>{
  const THREE=require('../src/vendor/three-0.160.1.min.js'),context=vm.createContext({THREE,CoopGeography:Geography,CoopCityBlocks:Blocks,CoopLocalPlaces:Places,polygonClipping:require('../src/vendor/polygon-clipping-0.15.7.min.js')});vm.runInContext(fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),context);
  const data=fixture([[0,0,40,40],[4000,0,40,40],[2500,0,4000,100]]),geo=Geography.create(data),before=JSON.stringify(data),near=context.districtNearbyBuildings(data.features,geo,{center:data.center,radius:1000});assert.deepEqual(Array.from(near,b=>b.id),[1,3]);assert.equal(JSON.stringify(data),before);
});

test('a failed distant road preload keeps the current covered map usable without a false full-map error',async()=>{
  const s=streaming();s.context.mapBaseCache=[{center:s.view.center,extentMeters:3500}];assert.ok(Stream.covers(s.context.mapBaseCache[0],s.view));assert.equal(Stream.ready(s.context.mapBaseCache[0],s.view),false);
  const pending=s.context.loadMapView(s.view,0,3);s.respond(0,null,503);await pending;assert.equal(s.states.at(-1).state,'preload');assert.equal(s.context.mapBaseCache.length,1);assert.equal(s.commits.length,0);
});

test('continuous input starts a shared building prefetch before release without blocking roads or generating models',async()=>{
  const s=streaming(),jobs=[];s.context.LBSMapWork.prepareModel=async(input,options)=>{jobs.push(options);return{data:input.region||input,sourceData:input.region||input,local:{},metrics:{}};};
  s.context.mapInteraction(true);s.context.scheduleMapDetails(s.view,80);const timer=s.context.streamDetailTimer;
  for(let i=0;i<8;i++)s.context.mapInteraction(true);
  assert.equal(timer.cancelled,undefined,'new input must not postpone the data prefetch');
  const buildings=timer.callback();assert.equal(s.requests.length,1);assert.doesNotMatch(s.requests[0].url,/layer=base/);
  await s.context.loadMapDetails(s.view,0);assert.equal(s.requests.length,1,'one full-data request serves the moving view');
  const roads=s.context.loadMapView(s.view,0,0);assert.equal(s.requests.length,2);assert.match(s.requests[1].url,/layer=base/);
  s.context.mapInteraction(true);assert.equal(s.requests[0].signal.aborted,false);s.respond(0,s.view.center);await buildings;
  assert.equal(s.context.mapCache.length,1);assert.deepEqual(jobs.map(j=>j.dataOnly),[true]);assert.equal(s.commits.length,0);
  s.respond(1,s.view.center);await roads;assert.equal(s.bases.length,2);
  s.context.mapInteraction(false);s.advance(500);await s.context.loadMapDetails(s.view,0);
  assert.equal(s.requests.length,2,'settled geometry reuses the prefetched data');assert.equal(s.commits.length,1);assert.equal(jobs.at(-1).dataOnly,false);
});

test('a sufficient full-data reserve suppresses repeated prefetches and simple or distant views stay lightweight',async()=>{
  const s=streaming();s.context.mapData={center:s.view.center,extentMeters:8000};s.context.mapCache=[s.context.mapData];s.context.scene={buildingsCover:()=>true};s.context.mapInteraction(true);
  for(let i=0;i<20;i++)s.context.scheduleMapDetails(s.view,0);
  await s.context.loadMapDetails(s.view,0);assert.equal(s.context.streamDetailTimer,null);assert.equal(s.requests.length,0);
  s.context.mapCache=[];s.context.mapBuildings=false;s.context.scheduleMapDetails(s.view,0);await s.context.loadMapDetails(s.view,0);assert.equal(s.requests.length,0);
  s.context.mapBuildings=true;s.setView({...s.view,span:5200,radius:6200});s.context.scheduleMapDetails(s.view,0);await s.context.loadMapDetails(s.view,0);assert.equal(s.requests.length,0);
});

test('a completed prefetch builds the latest settled window instead of the camera position where its request began',async()=>{
  const s=streaming(),jobs=[];s.context.LBSMapWork.prepareModel=async(input,options)=>{jobs.push(options);return{data:input.region||input,sourceData:input.region||input,local:{},metrics:{}};};
  const pending=s.context.loadMapDetails(s.view,0);s.setView({...s.view,center:{lat:.005,lon:0}});s.respond(0,{lat:0,lon:0});await pending;
  assert.deepEqual(jobs.map(j=>j.dataOnly),[true,false]);assert.equal(jobs[1].window,s.view);assert.equal(s.commits[0].latest,s.view);
});

test('a superseded region cannot receive a late prefetch parse or publish its coverage',async()=>{
  const s=streaming();let finishParse;s.context.LBSMapWork.prepareModel=()=>new Promise(resolve=>{finishParse=resolve;});
  const pending=s.context.loadMapDetails(s.view,0);s.respond(0,s.view.center);for(let i=0;i<6&&!finishParse;i++)await Promise.resolve();assert.ok(finishParse);
  s.context.stopMapViewport();finishParse({sourceData:{center:s.view.center,extentMeters:8000}});await pending;
  assert.equal(s.context.mapCache.length,0);assert.equal(s.bases.length,0);assert.equal(s.commits.length,0);
});

test('directional geometry and fixed-cell full-data reserves cover short pans before any replacement is needed',()=>{
  const data=fixture([[2500,0],[5000,0]]),geo=Geography.create(data),view={center:data.center,radius:1905,span:1600},previous={...view,center:geo.coordinate(-200,0)},window=Stream.geometryWindow(view,previous),plan=Stream.detailPlan(view,previous);
  assert.ok(geo.local(window.center.lon,window.center.lat).east>290);assert.ok(window.radius+260>=view.radius+990);
  const source={center:plan.center,extentMeters:plan.meters*1.45};assert.ok(Stream.detailsReady(source,view));assert.ok(geo.local(plan.center.lon,plan.center.lat).east>2000,'the download focus leads the moving camera by over two kilometres');assert.ok(plan.meters<=6000);
  assert.deepEqual(Stream.detailPlan(view).center,Stream.detailPlan({...view,center:geo.coordinate(5,5)}).center);
  const THREE=require('../src/vendor/three-0.160.1.min.js'),context=vm.createContext({THREE,CoopGeography:Geography,CoopLocalPlaces:Places});vm.runInContext(fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),context);
  assert.equal(context.districtNearbyBuildings(data.features,geo,view).length,0);assert.equal(context.districtNearbyBuildings(data.features,geo,window).length,1,'the nearby reserve contains real buildings beyond the original window');
  for(const east of[0,400,800]){const next={...view,center:geo.coordinate(east,0)};assert.ok(Stream.distance(window.center,next.center)+next.radius<=window.radius+260,'a short pan retains already-built models');}
});

test('a nearby GPU replacement retains the geographic model, selected district, labels and hidden 2D DOM',async()=>{
  const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),data=fixture([]),local={geo:Geography.create(data),buildings:[]},view={center:data.center,span:1600,radius:1905},region={id:'selected-block'},projected=new Map([['mission',{id:'mission'}]]),root={dataset:{}},nodes=new Map();let attached,highlighted,deactivated=0,sceneOptions;
  const unchanged=()=>{throw Error('a nearby GPU replacement must retain existing geography and UI');};
  const presentation=[],canvas={cloneNode:()=>({}),getBoundingClientRect:()=>({width:1280,height:720}),replaceWith:node=>{presentation.push('attach');attached=node;}},flat={replaceChildren:unchanged,toggleAttribute(){},setAttribute(){}};
  const nextScene={canvas:{},buildMetrics:{},preparePresentation(nextView,rect){presentation.push('draw');assert.equal(nextView,view);assert.equal(rect.width,1280);assert.equal(deactivated,0);},setView(){},activate(){},setVisible(){},setSelected:place=>{highlighted=place;}};
  const context=vm.createContext({
    AbortController,performance,document:{createElement:()=>({dataset:{}}),querySelectorAll:()=>[]},$:id=>id==='lbs-scene-root'?root:id==='district-canvas'?canvas:id==='map-2d'?flat:(nodes.has(id)?nodes.get(id):(nodes.set(id,{hidden:true,setAttribute(){}}),nodes.get(id))),
    homeName:'默认街区',data:{},local:{},missions:[],mapData:data,mapLocal:local,mapLocals:new WeakMap(),mapDistrictRegions:new WeakMap(),mapScoped:new WeakSet(),mapBuildRequest:null,mapBaseCache:[],mapInitialPreview:false,
    districts:{regions:[region]},mapTasksByDistrict:new Map(),viewMissionPlaces:projected,mapLabelUI:{destroy:unchanged},mapMarkerDistrictId:region.id,selectedDistrict:region,selected:{id:'mission'},filter:'all',twoD:false,mapRenderPreference:false,mapBuildings:true,streamPreviousView:null,streamQueued:false,streamRequest:null,
    scene:{deactivate(){deactivated++;},destroyAsync:async()=>({})},LBSMapStream:Stream,LBSMapWork:{runBuild:unchanged,prepareModel:unchanged},L:{districtTheme:()=>({})},CoopDistrictSelection:{},
    cancelMapBuild(){},mapInteraction(){},scheduleMapView(){},checkMapBuild:controller=>{assert.equal(controller.signal.aborted,false);assert.equal(context.mapBuildRequest,controller);},mapCovers:()=>true,requestedMapView:()=>view,currentMapView:()=>view,mapDetailBusy:()=>false,
    preparedMap:()=>null,cachedMapMetrics:()=>({totalWallMs:0}),mapTrace:()=>({startedAt:performance.now(),events:[]}),mapRecord(){},mapRifts:()=>[],createDistrictSceneAsync:async(next,places,onSelect,options)=>{sceneOptions=options;return nextScene;},selectMapDistrict(){},mapLabelCandidates(){},layoutProjectedMapLabels(){},
    cancel2DPan(){},renderDistrictContext:unchanged,buildMarkers:unchanged,updateDistrictPaths:unchanged,select:unchanged,updatePosition(){},set2DView(){},setMapStatus(){},updateMapDetailVisibility(){},showMapBase:async()=>{},selectedMapPlace:()=>({id:'mission',districtId:region.id}),mapAttribution:'ready'
  });
  vm.runInContext(source.slice(source.indexOf('  async function renderMap('),source.indexOf('  function stopMapStream(){')),context);
  assert.equal(await context.renderMap(data,view,{local},{requireCoverage:true}),true);assert.deepEqual(presentation,['draw','attach']);assert.equal(deactivated,1);assert.equal(attached,nextScene.canvas);assert.equal(context.mapLocal,local);assert.equal(context.viewMissionPlaces,projected);assert.equal(projected.size,1);assert.equal(context.selectedDistrict,region);assert.equal(context.mapMarkerDistrictId,region.id);assert.equal(highlighted.districtId,region.id);assert.equal(JSON.parse(root.dataset.mapLoadTiming).geographyReused,true);assert.ok(sceneOptions.detailView.radius>view.radius);
});

test('a prepared 2D layer stays detached during 3D commits and is mounted only once for its own region',()=>{
  const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),data={},child={},mounts=[];let scans=0;
  const flat={replaceChildren:(...nodes)=>mounts.push(nodes),querySelectorAll:()=>{scans++;return[];}},context=vm.createContext({mapData:data,mapPreparedSvg:{data,svg:{childNodes:[child]}},$:()=>flat});
  vm.runInContext(source.slice(source.indexOf('  function mountPreparedMapSvg(){'),source.indexOf('  function layout2D(){')),context);
  context.updateDistrictPaths();assert.equal(scans,0,'a pending layer must not style stale hidden paths');context.mountPreparedMapSvg();assert.equal(mounts.length,1);assert.equal(mounts[0][0],child);assert.equal(context.mapPreparedSvg,null);assert.equal(scans,1);
  context.mountPreparedMapSvg();assert.equal(mounts.length,1);context.mapPreparedSvg={data:{},svg:{childNodes:[]}};context.mountPreparedMapSvg();assert.equal(mounts.length,1,'a prepared layer from another region cannot replace this map');
});

test('a failed reserve prefetch retains the current buildings without reporting that the map is unavailable',async()=>{
  const s=streaming();s.context.mapData={center:s.view.center,extentMeters:4000};s.context.scene={buildingsCover:()=>true};s.context.mapDetailRetry={count:2,view:s.view,until:Date.now()};
  assert.equal(s.context.mapNeedsDetails(s.view),false);const pending=s.context.loadMapDetails(s.view,0);s.respond(0,null,503);await pending;
  assert.equal(s.context.mapDetailRetry.count,3);assert.equal(s.states.at(-1).state,'preload');s.context.mapReadyStatus();assert.equal(s.states.at(-1).state,'preload');assert.equal(s.commits.length,0);assert.equal(s.context.mapData.extentMeters,4000);
});

test('continuous GPS following never enters the drag quiet period or aborts the active geometry append',async()=>{
  const s=streaming();s.context.mode='gps';s.context.mapData={center:s.view.center,extentMeters:8000};s.context.mapCache=[s.context.mapData];let finish,appended=0;
  s.context.scene={buildingsCover:()=>false,addBuildings:()=>new Promise(resolve=>{finish=()=>{appended++;resolve({added:32});};})};
  const pending=s.context.loadMapDetails(s.view,0);assert.ok(finish);
  for(let i=0;i<30;i++){s.advance(100);s.setView({...s.view,center:{lat:i*.0001,lon:0}});s.context.scheduleMapView(s.view);assert.equal(s.context.mapDetailBusy(),false);assert.equal(s.context.streamDetailRequest.signal.aborted,false);}
  finish();await pending;assert.equal(appended,1);assert.equal(s.commits.length,0,'the live canvas stays attached');assert.equal(s.context.mapLastInputAt,-Infinity);
});

test('small GPS camera steps accumulate a real heading for forward preloading',()=>{
  const s=streaming();s.context.mode='gps';s.context.mapData={center:s.view.center,extentMeters:8000};s.context.mapCache=[s.context.mapData];s.context.scene={buildingsCover:()=>true};
  for(let i=0;i<100;i++){s.setView({...s.view,center:{lat:i*.00001,lon:0}});s.context.scheduleMapView(s.view);}
  assert.ok(Stream.distance(s.view.center,s.context.streamPreviousView.center)>10);const ahead=Stream.geometryWindow(s.view,s.context.streamPreviousView).center;assert.ok(ahead.lat>s.view.center.lat);assert.ok(Stream.distance(s.view.center,ahead)>290);assert.equal(s.context.mapDetailBusy(),false);s.context.stopMapViewport();assert.equal(s.context.streamGPSAnchor,null);
});

test('live model batches become visible during an ongoing drag without a quiet period or canvas replacement',async()=>{
  const s=streaming(),calls=[];s.context.mapData={center:s.view.center,extentMeters:8000};s.context.mapCache=[s.context.mapData];s.context.scene={buildingsCover:()=>false,addBuildings:async(model,view,options)=>{calls.push({model,view,signal:options.signal});s.context.mapInteraction(true);return{added:32};}};
  s.context.mapInteraction(true);await s.context.loadMapDetails(s.view,0);
  assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);assert.equal(calls[0].model,s.context.mapLocal);assert.equal(s.context.mapInputActive,true);assert.equal(s.commits.length,0);
});

test('a new geographic window attaches selection during movement with one worker and keeps the live canvas after release',async()=>{
  const s=streaming(),jobs=[];let added=0,covered=false;s.context.LBSMapWork.prepareModel=async(input,options)=>{jobs.push(options);return{data:input.region||input,sourceData:input.region||input,local:{},metrics:{}};};s.context.scene={buildingsCover:()=>covered,addBuildings:async()=>{added++;covered=true;return{added:16};}};
  s.context.mapInteraction(true);const pending=s.context.loadMapDetails(s.view,0);s.respond(0,s.view.center);await pending;
  assert.deepEqual(jobs.map(j=>j.dataOnly),[false]);assert.equal(jobs[0].districts,true);assert.equal(added,1);assert.equal(s.context.mapInputActive,true);assert.equal(s.commits.length,0);assert.equal(s.streamCommits.length,1);assert.equal(s.context.mapData,s.streamCommits[0].data);
  await s.context.loadMapDetails(s.view,0);assert.equal(jobs.length,1,'continued movement reuses its committed selection and model');assert.equal(s.requests.length,1);
  s.context.mapInteraction(false);s.advance(500);await s.context.loadMapDetails(s.view,0);assert.equal(s.commits.length,0,'release must not rebuild the buildings or replace the canvas');assert.equal(jobs.length,1);assert.equal(s.context.streamPreparedModel,null);
});

test('cold stream frames render and attach picking during a held drag before the full response is available',async()=>{
 const s=streaming(),events=[],Work=require('../src/lbs-map-work.js');let send,finish,covered=false;
 s.context.mapTrace=()=>({startedAt:1000});s.context.mapAbortError=()=>Object.assign(Error('cancelled'),{name:'AbortError'});
 s.context.LBSMapWork.readMapFrames=Work.readMapFrames;s.context.LBSMapWork.prepareModel=async bytes=>{const data=JSON.parse(new TextDecoder().decode(bytes));return{data,sourceData:data,local:{},metrics:{}};};
 const commit=s.context.commitStreamMapModel;s.context.commitStreamMapModel=async(model,controller)=>{events.push('selection');return commit(model,controller);};
 s.context.scene={buildingsCover:()=>covered,addBuildings:async(model,view,options)=>{events.push('visible');options.onPhase({name:'live-building-visible'});covered=true;return{added:16};}};
 const body=new ReadableStream({start(controller){send=data=>controller.enqueue(new TextEncoder().encode(JSON.stringify(data)+'\n'));finish=()=>controller.close();}});
 s.context.mapInteraction(true);const job=s.context.loadMapDetails(s.view,0);assert.match(s.requests[0].url,/stream=1/);
 s.requests[0].resolve(new Response(body,{headers:{'Content-Type':'application/x-ndjson'}}));
 const data={center:s.view.center,radiusMeters:2500,extentMeters:4000,features:[],places:[],gameNodes:[],delivery:{partial:true,cache:'miss',tiles:1,totalTiles:25,tileCacheHits:0}};
 send(data);while(events.length<2)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,['selection','visible']);assert.equal(s.context.mapInputActive,true);assert.equal(s.context.mapCache.length,0,'one tile is not a complete viewport cache');assert.equal(s.context.mapModelFor(s.view),null);
 s.advance(100);s.setView({...s.view,center:{lat:.001,lon:0}});s.context.scheduleMapView(s.view);assert.equal(s.requests[0].signal.aborted,false);
 send({...data,delivery:{partial:false,cache:'miss',tiles:25,totalTiles:25,tileCacheHits:0}});finish();await job;
 assert.equal(s.context.mapCache.length,1);assert.equal(s.context.mapInputActive,true);assert.equal(s.commits.length,0);assert.equal(s.streamCommits.length,2);
});

test('a moving preload also streams buildings, and leaving a cold window cancels it before waiting for headers',async()=>{
 const s=streaming();s.context.mapData={center:s.view.center,extentMeters:3500};s.context.scene={buildingsCover:()=>true,addBuildings:async()=>({added:0})};
 assert.equal(s.context.mapNeedsDetails(s.view),false);assert.equal(Stream.detailsReady(s.context.mapData,s.view),false);
 const job=s.context.loadMapDetails(s.view,0);assert.match(s.requests[0].url,/stream=1/);
 s.setView({...s.view,center:{lat:.05,lon:0}});s.context.scheduleMapView(s.view);assert.equal(s.requests[0].signal.aborted,true);
 s.respond(0,{lat:0,lon:0});await job;assert.equal(s.streamCommits.length,0);
});

test('map frame reading preserves fragmented UTF-8, yields to each model, and cancels malformed or superseded streams',async()=>{
 const Work=require('../src/lbs-map-work.js'),bytes=new TextEncoder().encode('{"name":"建筑"}\n{"name":"医院"}\n'),frames=[],response=new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=2)c.enqueue(bytes.subarray(i,i+2));c.close();}}));
 const result=await Work.readMapFrames(response,{onFrame:async input=>{frames.push(JSON.parse(new TextDecoder().decode(input)).name);await Promise.resolve();}});assert.deepEqual(frames,['建筑','医院']);assert.equal(result.frames,2);
 let cancelled=false;const controller=new AbortController(),open=new Response(new ReadableStream({cancel(){cancelled=true;}})),reading=Work.readMapFrames(open,{signal:controller.signal,onFrame:()=>{throw Error('no frame');}});controller.abort();await assert.rejects(reading,{name:'AbortError'});assert.equal(cancelled,true);
 await assert.rejects(Work.readMapFrames(new Response('123456789\n'),{maxFrameBytes:8,onFrame:()=>{throw Error('oversized frame must not reach the worker');}}),/too large/);
});

test('a moving stream retargets while the old viewport still has a kilometre of data ahead',async()=>{
 const s=streaming();s.context.scene={addBuildings:async()=>({added:0})};
 const job=s.context.loadMapDetails(s.view,0),region=s.context.streamDetailRequest.viewportRegion;
 s.setView({...s.view,center:{lat:.01,lon:0}});assert.ok(Stream.covers(region,s.view));assert.equal(Stream.detailsReady(region,s.view),false);
 s.context.scheduleMapView(s.view);assert.equal(s.requests[0].signal.aborted,true);s.respond(0,{lat:0,lon:0});await job;
 assert.ok(s.timers.some(timer=>timer.delay===0),'superseded streaming work immediately yields to the new forward window');
});

test('a moving download refocuses before the camera reaches its low-priority outer tiles',()=>{
 const data=fixture([]),geo=Geography.create(data),view={center:geo.coordinate(1400,0),radius:2033,span:1600},previous={...view,center:geo.coordinate(1100,0)},region={center:data.center,extentMeters:7250};
 assert.ok(Stream.detailsReady(region,view),'the wide old window still has coverage and spare data');
 assert.equal(Stream.detailRequestReady(region,view,previous),false,'its nearest downloads are already behind the moving camera');
 const turned={...view,center:geo.coordinate(1700,0)};assert.equal(Stream.detailRequestReady(region,view,turned),true,'moving back towards that focus keeps the shared request');
 const forward={...region,center:Stream.detailPlan(view,previous).center};assert.ok(Stream.detailRequestReady(forward,view,previous));
});

test('arrived frames batch behind a busy model without dropping data or delaying the first frame',async()=>{
 const Work=require('../src/lbs-map-work.js'),calls=[];let send,finish,release;
 const response=new Response(new ReadableStream({start(c){send=n=>c.enqueue(new TextEncoder().encode(JSON.stringify({n})+'\n'));finish=()=>c.close();}}));
 const reading=Work.readMapFrames(response,{batchReady:true,onFrame:async input=>{
  const batch=Array.isArray(input)?input:[input];calls.push(batch.map(bytes=>JSON.parse(new TextDecoder().decode(bytes)).n));
  if(calls.length===1)await new Promise(resolve=>{release=resolve;});
 }});
 send(1);while(!release)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[[1]]);
 send(2);send(3);send(4);finish();await new Promise(resolve=>setImmediate(resolve));release();
 assert.equal((await reading).frames,4);assert.deepEqual(calls,[[1],[2,3,4]]);
 let cancelled=false;const broken=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('1\n2\n3\n'));},cancel(){cancelled=true;}}));
 await assert.rejects(Work.readMapFrames(broken,{batchReady:true,maxQueuedBytes:1,onFrame:()=>{throw Error('stop consumer');}}),/stop consumer/);assert.equal(cancelled,true);
});

test('a stream handoff drains arrived batches before releasing the old response',async()=>{
 const Work=require('../src/lbs-map-work.js'),stop=new AbortController(),calls=[];let send,release,cancelled=false;
 const response=new Response(new ReadableStream({start(c){send=n=>c.enqueue(new TextEncoder().encode(JSON.stringify({n})+'\n'));},cancel(){cancelled=true;}}));
 const reading=Work.readMapFrames(response,{batchReady:true,stopSignal:stop.signal,onFrame:async input=>{
  calls.push((Array.isArray(input)?input:[input]).map(bytes=>JSON.parse(new TextDecoder().decode(bytes)).n));
  if(calls.length===1)await new Promise(resolve=>{release=resolve;});
 }});
 send(1);while(!release)await new Promise(resolve=>setImmediate(resolve));send(2);send(3);await new Promise(resolve=>setImmediate(resolve));stop.abort();release();
 const result=await reading;assert.deepEqual(calls,[[1],[2,3]]);assert.equal(result.stopped,true);assert.equal(result.frames,3);assert.equal(cancelled,true);
});

test('a moving stream keeps its current models until the next request is ready and adopts it once',async()=>{
 const s=streaming(),Work=require('../src/lbs-map-work.js');let send,cancelled=false,visible=0;
 s.context.LBSMapWork.readMapFrames=Work.readMapFrames;s.context.LBSMapWork.prepareModel=async bytes=>{const data=bytes.region||JSON.parse(new TextDecoder().decode(bytes));return{data,sourceData:data,local:{},metrics:{}};};
 s.context.scene={addBuildings:async()=>{visible++;return{added:1};}};
 const body=new ReadableStream({start(c){send=data=>c.enqueue(new TextEncoder().encode(JSON.stringify(data)+'\n'));},cancel(){cancelled=true;}});
 const job=s.context.loadMapDetails(s.view,0),old=s.context.streamDetailRequest;
 s.requests[0].resolve(new Response(body,{headers:{'Content-Type':'application/x-ndjson'}}));
 send({center:s.view.center,radiusMeters:2500,extentMeters:4350,features:[],places:[],gameNodes:[],delivery:{partial:true}});
 while(!visible)await new Promise(resolve=>setImmediate(resolve));
 s.setView({...s.view,center:{lat:.01,lon:0}});s.context.scheduleMapView(s.view);assert.equal(s.requests.length,2,'the replacement starts before the current response has ended');
 const next=s.context.mapEarlyDetails;assert.ok(next);assert.equal(old.signal.aborted,false);assert.equal(old.handoffStop.signal.aborted,false);
 s.context.scheduleMapDetails(s.view);assert.equal(s.requests.length,2,'repeated frames share the same pending handoff');
 s.respond(1,s.view.center);await job;assert.equal(cancelled,true);assert.equal(old.signal.aborted,false);assert.equal(old.handoffStop.signal.aborted,true);assert.equal(s.context.mapEarlyDetails,next);assert.equal(s.context.mapCache.length,0);
 await s.context.loadMapDetails(s.view,0);assert.equal(s.requests.length,2);assert.equal(s.context.mapEarlyDetails,null);assert.equal(s.streamCommits.length,2);
});

test('replacing the map cancels an unclaimed handoff and discards its late response',async()=>{
 const s=streaming(),old=new AbortController();old.handoffStop=new AbortController();s.context.streamDetailRequest=old;
 s.context.handoffMapDetails(old,s.view);assert.equal(s.requests.length,1);let discarded=0;
 s.context.stopMapViewport();assert.equal(old.signal.aborted,true);assert.equal(s.requests[0].signal.aborted,true);
 s.requests[0].resolve({ok:true,body:{cancel:async()=>{discarded++;}}});await new Promise(resolve=>setImmediate(resolve));assert.equal(discarded,1);assert.equal(s.context.mapEarlyDetails,null);
});

test('the worker merges arrived building deltas and a complete frame replaces partial coverage',()=>{
 const Work=require('../src/lbs-map-work.js'),a={...fixture([[0,0]]),delivery:{partial:true}},b={...fixture([[100,0]]),delivery:{partial:true}};b.features[0].id=2;
 const results=[],scope={CoopGeography:Geography,CoopLocalPlaces:Places,LBSMapStream:Stream,TextDecoder,performance,postMessage:value=>results.push(value)},bytes=data=>new TextEncoder().encode(JSON.stringify(data)).buffer;
 Work.workerMain(scope);scope.onmessage({data:{type:'lbs-map:prepare',id:1,input:[bytes(a),bytes(b)]}});
 const merged=results.find(r=>r.type==='lbs-map:result');assert.ok(merged);assert.equal(merged.sourceData.features.length,2);assert.equal(merged.local.sourceBuildings.length,2);assert.equal(merged.metrics.inputFrames,2);
 results.length=0;scope.onmessage({data:{type:'lbs-map:prepare',id:2,input:[bytes(a),bytes({...b,delivery:{partial:false}})],dataOnly:true}});
 assert.deepEqual(results.find(r=>r.type==='lbs-map:result').sourceData.features.map(f=>f.id),[2]);
 results.length=0;scope.onmessage({data:{type:'lbs-map:prepare',id:3,input:[bytes(a),bytes({...b,center:{...b.center,lat:31}})]}});assert.match(results.find(r=>r.type==='lbs-map:error').error.message,/changed its window/);
});

test('live selection commits reproject new windows and retain visible old buildings without waiting for release',async()=>{
  const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),Work=require('../src/lbs-map-work.js'),oldData=fixture([[0,0],[200,0]]);
  oldData.features.forEach((f,i)=>{f.id='old-'+i;});const oldLocal=Places.create(oldData,{detail:true}),oldDistricts=Districts.create(oldData,oldLocal),selectedDistrict=oldDistricts.at({east:0,north:0});
  const nextData=fixture([[1200,100],[1250,100]]);nextData.features.forEach((f,i)=>{f.id='new-'+i;});nextData.center={...oldLocal.geo.coordinate(1500,700),crs:'WGS84'};nextData.extentMeters=8000;
  const nextLocal=Places.create(nextData,{detail:true}),model={data:nextData,local:nextLocal,districtRegions:Districts.create(nextData,nextLocal).regions},mission={id:'fixed-mission',...oldLocal.geo.coordinate(0,0),place:{id:'fixed-place',...oldLocal.geo.coordinate(0,0),buildingIds:['old-0']}};
  const before=JSON.stringify(model),oldBefore=JSON.stringify(oldDistricts.regions),root={dataset:{}},events=[],canvas={},scene={canvas,hasBuilding:id=>id==='old-0',setDistrictSelection:value=>events.push({type:'selection',value}),setSelected:value=>events.push({type:'selected',value})};
  const context=vm.createContext({performance,AbortController,LBSMapWork:Work,CoopDistrictSelection:Districts,data:oldData,local:oldLocal,missions:[mission],mapData:oldData,mapLocal:oldLocal,districts:oldDistricts,scene,selectedDistrict,selected:{place:mission.place},
    mapLocals:new WeakMap(),mapDistrictRegions:new WeakMap(),mapScoped:new WeakSet(),viewMissionPlaces:new Map(),streamPreparedModel:model,mapPreparedSvg:{data:oldData},mapSvgDirty:false,mapLabelMembershipModel:oldDistricts,
    $:()=>root,mapCovers:()=>true,currentMapView:()=>({center:nextData.center,radius:1000,span:1600}),mapRecord:()=>{},selectedMapPlace:()=>({...mission.place,...oldLocal.geo.local(mission.place.lon,mission.place.lat),districtId:selectedDistrict.id}),
    updateDistrictChoices(){},renderBuildingSelection(){},mapDetailBusy:()=>{throw Error('live selection must not wait for the drag quiet period');},createDistrictSceneAsync:()=>{throw Error('live selection must not rebuild the scene');}
  });
  vm.runInContext(source.slice(source.indexOf('  function* scopeMapSteps('),source.indexOf('  function* mapSvgSteps('))+source.slice(source.indexOf('  function* streamMapModelSteps('),source.indexOf('  async function prepareStreamMapSvg(')),context);
  assert.equal(await context.commitStreamMapModel(model,new AbortController(),{startedAt:performance.now()}),true);
  assert.equal(context.scene,scene);assert.equal(context.scene.canvas,canvas);assert.equal(context.mapLocal.geo,oldLocal.geo);assert.equal(context.mapData,nextData);assert.equal(context.streamPreparedModel,null);assert.equal(context.mapSvgDirty,true);assert.equal(context.mapPreparedSvg,null);
  assert.equal(events[0].type,'selection');assert.equal(events[0].value,context.districts);assert.equal(events[1].type,'selected');
  assert.ok(context.districts.at({east:1200,north:100}));assert.equal(context.districts.at({east:0,north:0}).id,selectedDistrict.id);assert.equal(context.districts.at({east:200,north:0}),null,'old unrendered bodies can leave the bounded model');
  assert.equal(context.districts.raycast({origin:{x:1200,y:1000,z:-100},direction:{x:0,y:-1,z:0}}).id,context.districts.at({east:1200,north:100}).id);
  assert.equal(context.selectedDistrict.id,selectedDistrict.id);assert.equal(context.selected,context.selectedDistrict);
  assert.ok(Math.abs(context.mapLocal.buildings.find(b=>b.id==='new-0').east-1200)<.001);assert.equal(JSON.stringify(model),before);assert.equal(JSON.stringify(oldDistricts.regions),oldBefore);
  const committed=context.mapData,controller=new AbortController();controller.abort();await assert.rejects(context.commitStreamMapModel(model,controller,{startedAt:performance.now()}),{name:'AbortError'});assert.equal(context.mapData,committed);
});

test('streaming defers hidden 2D geometry until requested and discards a result from a superseded region',async()=>{
  const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),data={},model={},svg={childNodes:[]};let builds=0,supersede=false;
  const context=vm.createContext({mapSvgDirty:false,mapData:data,mapLocal:model,districts:{},mapPreparedSvg:null,viewRifts:()=>[],mapSvgSteps:()=>{builds++;return null;},LBSMapWork:{runBuild:async()=>{if(supersede)context.mapData={};return{value:svg};}}});
  vm.runInContext(source.slice(source.indexOf('  async function prepareStreamMapSvg('),source.indexOf('  async function renderMap(')),context);
  await context.prepareStreamMapSvg();assert.equal(builds,0);context.mapSvgDirty=true;assert.equal(await context.prepareStreamMapSvg(),true);assert.equal(builds,1);assert.equal(context.mapPreparedSvg.svg,svg);assert.equal(context.mapSvgDirty,false);
  context.mapSvgDirty=true;context.mapPreparedSvg=null;supersede=true;assert.equal(await context.prepareStreamMapSvg(),false);assert.equal(context.mapPreparedSvg,null);assert.equal(context.mapSvgDirty,true);
});
