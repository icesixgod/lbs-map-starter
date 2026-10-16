'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Geography=require('../src/coop-geography.js'),Places=require('../src/coop-local-places.js'),Buildings=require('../src/lbs-map-buildings.js'),Blocks=require('../src/coop-city-blocks.js');
function fixture(bodies){const data={center:{lat:30.23,lon:120.21,crs:'WGS84'},radiusMeters:1000,extentMeters:1450,features:[],places:[],gameNodes:[]},geo=Geography.create(data);data.features=bodies.map(([id,x,y,w,h,height=12,tags={}])=>({id,kind:'building',tags:{building:'yes',height:String(height),...tags},coordinates:[[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2],[x-w/2,y-h/2]].map(([x,y])=>{const p=geo.coordinate(x,y);return[p.lon,p.lat];}),holes:[]}));return data;}
const signature=b=>({id:b.modelId,shape:b.shapeKey,height:b.height,minHeight:b.minHeight,kind:b.kind,variant:Buildings.hash(b.modelId)%3,coordinates:b.coordinates,holes:b.holes});

test('initial and streamed models retain each source body height instead of extruding an overlap union to the highest roof',()=>{
 const data=fixture([[1,0,0,80,60,8],[2,5,0,25,25,64,{min_height:'8'}]]),before=JSON.stringify(data),initial=Places.create(data),detail=Places.create(data,{detail:true});
 assert.equal(detail.buildings.length,2,'detailed maps keep each building body independently selectable');assert.deepEqual(detail.buildings.map(b=>b.height),[8,64]);
 for(const local of[initial,detail]){assert.equal(local.sourceBuildings.length,2);assert.deepEqual(local.sourceBuildings.map(b=>[b.id,b.height,b.minHeight]),[[1,8,0],[2,64,8]]);}
 assert.equal(JSON.stringify(data),before);
});

test('provider changes, shifted quantization, tag changes and new map origins reuse the existing building model',()=>{
 const data=fixture([[1,0,0,80,60,26,{building:'commercial'}]]),first=Places.create(data,{detail:true}),registry=Buildings.create(),a=registry.resolve(first.sourceBuildings,first.geo);registry.remember(a.buildings,{pin:true});
 const next=fixture([['new-provider-id',.35,-.2,80,60,5]]);next.source={provider:'openfreemap'};next.center={...next.center,...first.geo.coordinate(1600,800)};
 const local=Places.create(next,{detail:true}),before=JSON.stringify(next),b=registry.resolve(local.sourceBuildings,local.geo);assert.equal(b.stats.reused,1);assert.deepEqual(signature(b.buildings[0]),signature(a.buildings[0]));assert.equal(JSON.stringify(next),before);
 registry.remember(b.buildings);const restored=Buildings.create(registry.near(next)).resolve(local.sourceBuildings,local.geo);assert.deepEqual(signature(restored.buildings[0]),signature(a.buildings[0]));
});

test('touching neighbours and colocated vertical parts keep separate identities',()=>{
 const data=fixture([[1,-11,0,20,30,10],[2,11,0,20,30,22],[3,11,0,20,30,40,{min_height:'22'}]]),local=Places.create(data,{detail:true}),registry=Buildings.create(),first=registry.resolve(local.sourceBuildings,local.geo);registry.remember(first.buildings);
 const changed={...data,source:{provider:'openfreemap'},features:data.features.map(f=>({...f,id:'new-'+f.id}))},next=Places.create(changed,{detail:true}),second=registry.resolve([...next.sourceBuildings].reverse(),next.geo);assert.equal(second.stats.reused,3);assert.equal(new Set(second.buildings.map(b=>b.modelId)).size,3);assert.deepEqual(second.buildings.map(b=>b.height),[40,22,10]);
});

test('a multipart native source reference cannot move a distant wing onto its sibling',()=>{
 const local=Places.create(fixture([[1,-100,0,20,20],[2,100,0,20,20]]),{detail:true});for(const b of local.sourceBuildings)b.modelRef='shared-native-id';const registry=Buildings.create(),first=registry.resolve(local.sourceBuildings,local.geo);registry.remember(first.buildings);const next=registry.resolve(local.sourceBuildings,local.geo);assert.deepEqual(next.buildings.map(b=>b.lon),first.buildings.map(b=>b.lon));assert.equal(new Set(next.buildings.map(b=>b.modelId)).size,2);
});

test('overlapping GPS data windows emit each canonical body once and preserve its selection aliases',()=>{
 const data=fixture([[1,0,0,40,30,28],[2,100,0,30,25,12]]),initial=Places.create(data,{detail:true}),registry=Buildings.create();registry.remember(registry.resolve(initial.sourceBuildings,initial.geo).buildings);
 for(let i=0;i<5;i++){
  const next={...data,center:{...data.center,...initial.geo.coordinate(i*700,0)}},local=Places.create(next,{detail:true}),body=local.sourceBuildings[0],copy={...body,sourceIds:['tile-copy-'+i]},before=JSON.stringify(local.sourceBuildings),result=registry.resolve([...local.sourceBuildings,copy],local.geo);
  assert.equal(result.buildings.length,2);assert.equal(new Set(result.buildings.map(b=>b.modelId)).size,2);assert.ok(result.buildings[0].sourceIds.includes('tile-copy-'+i));assert.equal(JSON.stringify(local.sourceBuildings),before);
  const districts=require('../src/coop-district-scene.js').create(next,{...local,sourceBuildings:result.buildings,buildings:result.buildings});assert.equal(districts.regions.length,districts.byId.size);assert.equal(new Set(districts.regions.map(r=>r.id)).size,result.buildings.length);registry.remember(result.buildings);
 }
 const body=initial.sourceBuildings[0],result=registry.resolve([{...body,east:body.east+5}],initial.geo);assert.equal(new Set(result.buildings.map(b=>b.modelId)).size,result.buildings.length,'retaining a cached identity cannot emit it a second time');
});

test('different canonical buildings cannot collide in selection or expose model keys as names',()=>{
 const data=fixture([[1,-100,0,20,20],[2,100,0,20,20]]),local=Places.create(data,{detail:true});local.sourceBuildings[0].modelId='costarring';local.sourceBuildings[1].modelId='liquid';assert.equal(Buildings.hash('costarring'),Buildings.hash('liquid'),'these different keys collide under the old 32-bit hash');const regions=require('../src/coop-district-scene.js').create(data,local).regions;assert.equal(new Set(regions.map(r=>r.id)).size,2);assert.ok(regions.every(r=>!r.name.includes('costarring')&&!r.name.includes('liquid')));
});

test('an alternate source cannot remove an existing wing or redraw its footprint as a taller overlapping part',()=>{
 const data=fixture([[1,0,0,80,60,16],[2,150,0,30,30,24]]),local=Places.create(data,{detail:true}),registry=Buildings.create(),first=registry.resolve(local.sourceBuildings,local.geo);registry.remember(first.buildings);
 const alternate=fixture([['tower-part',5,0,20,20,120]]);alternate.source={provider:'openfreemap'};const next=Places.create(alternate,{detail:true}),second=registry.resolve(next.sourceBuildings,next.geo);assert.equal(second.stats.suppressed,1);assert.equal(second.stats.retained,2);assert.deepEqual(second.buildings.map(signature),first.buildings.map(signature));
});

test('an incomplete tile-edge fragment cannot hide a previously loaded complete body',()=>{
 const data=fixture([[1,0,0,80,60,16]]),local=Places.create(data,{detail:true}),registry=Buildings.create(),first=registry.resolve(local.sourceBuildings,local.geo);registry.remember(first.buildings);const result=registry.resolve([{...local.sourceBuildings[0],hidden3D:true,incomplete:true}],local.geo);assert.equal(result.stats.retained,1);assert.deepEqual(signature(result.buildings.find(b=>b.retained)),signature(first.buildings[0]));
});

test('appearance fingerprints ignore ring start and winding but retain courtyard differences',()=>{
 const b=fixture([[1,0,0,40,30]]).features[0],points=b.coordinates.slice(0,-1),rotated=points.slice(2).concat(points.slice(0,2));rotated.push(rotated[0]);assert.equal(Buildings.fingerprint(b),Buildings.fingerprint({...b,coordinates:[...b.coordinates].reverse()}));assert.equal(Buildings.fingerprint(b),Buildings.fingerprint({...b,coordinates:rotated}));assert.notEqual(Buildings.fingerprint(b),Buildings.fingerprint({...b,holes:[fixture([[2,0,0,10,10]]).features[0].coordinates]}));
});

test('a bounded registry retains pinned starting models and keeps distant areas out of worker messages',()=>{
 const local=Places.create(fixture([[1,0,0,20,20],[2,200,0,20,20],[3,5000,0,20,20],[4,6000,0,20,20]]),{detail:true}),registry=Buildings.create([],{maxEntries:3}),first=registry.resolve(local.sourceBuildings,local.geo).buildings;registry.remember([first[0]],{pin:true});registry.remember(first.slice(1));assert.equal(registry.size,3);assert.equal(registry.near({...fixture([]),extentMeters:100}).length,1);assert.equal(registry.near(fixture([]))[0].modelId,first[0].modelId);
});

test('real map workers share canonical models without letting data-only prefetches or raw cache data rewrite them',async()=>{
 const Work=require('../src/lbs-map-work.js'),data=fixture([[77001,0,0,40,30,28,{building:'commercial'}]]),changed=fixture([['remote-id',.1,0,40,30,5]]);changed.source={provider:'openfreemap'};const before=JSON.stringify(changed);
 function workerFactory(){const listeners=new Map();return{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),terminate(){},postMessage(message){const scope={CoopGeography:Geography,CoopLocalPlaces:Places,LBSMapBuildings:Buildings,performance,postMessage:value=>listeners.get('message')?.({data:structuredClone(value)})};Work.workerMain(scope);scope.onmessage({data:message});}};}
 const options={workerSource:'fixture',workerFactory};await Work.prepareModel(changed,{...options,dataOnly:true});const a=await Work.prepareModel(data,options),b=await Work.prepareModel(changed,options);assert.deepEqual(signature(b.local.sourceBuildings[0]),signature(a.local.sourceBuildings[0]));assert.equal(b.local.buildingIdentity.reused,1);assert.equal(JSON.stringify(changed),before);assert.deepEqual(b.sourceData,changed);
});

function geometryContext(){const THREE=require('../src/vendor/three-0.160.1.min.js'),context=vm.createContext({THREE,CoopGeography:Geography,CoopCityBlocks:Blocks,CoopLocalPlaces:Places,polygonClipping:require('../src/vendor/polygon-clipping-0.15.7.min.js')});vm.runInContext(fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),context);return context;}
test('wall geometry keeps the same top and bottom as geographic origins change and cached meshes are reused',()=>{
 const context=geometryContext(),data=fixture([[1,0,0,80,60,64,{min_height:'8'}]]),geo=Geography.create(data),other=Geography.create({...data,center:{...data.center,...geo.coordinate(1500,800)}}),c=data.features[0].coordinates,a=context.districtCachedPolygon(geo,c,56,[],true,true),b=context.districtCachedPolygon(other,c,56,[],true,true);assert.equal(b.hit,true);
 for(const g of[a.geometry,b.geometry]){g.translate(0,9,0);g.computeBoundingBox();assert.equal(g.boundingBox.min.y,9);assert.equal(g.boundingBox.max.y,65);g.dispose();}
});

test('building-relative facade UVs keep floors and windows fixed when the map origin moves',()=>{
 const context=geometryContext(),THREE=context.THREE,data=fixture([[1,0,0,80,60,64]]),local=Places.create(data,{detail:true}),b=local.sourceBuildings[0],other=Geography.create({...data,center:{...data.center,...local.geo.coordinate(1500,800)}});const artScope=vm.createContext({THREE:{...THREE,TextureLoader:class{load(){return new THREE.Texture();}}},LBS_CITY_ASSETS:{atlas:'fixture'},CoopLocalPlaces:Places});vm.runInContext(fs.readFileSync(require.resolve('../src/lbs-city-art.js'),'utf8')+'\nthis.artModule=LBSCityArt;',artScope);const art=artScope.artModule.create(new THREE.Scene(),{geo:local.geo,sourceBuildings:[],artFeatures:[],streamMap:true},{root:{dataset:{}},onLoad(){},part(){}}),uv=[];
 for(const geo of[local.geo,other]){const g=context.districtWallGeometry(geo,b.coordinates,b.height);g.translate(0,1,0);const steps=art.uvSteps(g,25,geo.local(b.lon,b.lat));while(!steps.next().done){}uv.push([...g.attributes.uv.array]);g.dispose();}
 assert.equal(uv[0].length,uv[1].length);for(let i=0;i<uv[0].length;i++)assert.ok(Math.abs(uv[0][i]-uv[1][i])<.001);const material=art.buildingMaterial('generic',false),shader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <map_fragment>\n#include <color_fragment>'};material.onBeforeCompile(shader);assert.match(shader.vertexShader,/vLBSWallUV=uv\*25\.0/);assert.match(shader.fragmentShader,/vLBSWallUV\/vec2\(6\.8,4\.4\)/);art.destroy();
});
