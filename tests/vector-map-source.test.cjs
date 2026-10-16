'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {PbfWriter}=require('../src/vendor/vector-tile-3.0.0-pbf-5.1.2.cjs');
const {tilePlan,anonymizeVectorTile,decodeVectorTiles,createVectorMapSource}=require('../scripts/vector-map-source.cjs');
const {createMapService}=require('../scripts/district-map-service.cjs');
const quiet={warn(){},info(){}},z=14,x=13660,y=6745,point={lat:30.26,lon:(x+1)/2**z*360-180};
const vectorEndpoint='https://tiles.example/planet',metadata={tiles:['https://tiles.example/data/{z}/{x}/{y}.pbf'],maxzoom:14};

// Small standards-compliant MVT fixtures with buffered geometry on both sides
// of a tile boundary. They contain a lake island, a building and a named road.
function encode(layers){
 const tile=new PbfWriter();
 for(const [name,features]of Object.entries(layers))tile.writeMessage(3,(value,pbf)=>{
  pbf.writeStringField(1,name);const keys=[],values=[];
  for(const feature of features){const tags=[];for(const [key,value]of Object.entries(feature.properties)){let k=keys.indexOf(key);if(k<0){k=keys.length;keys.push(key);}let v=values.indexOf(value);if(v<0){v=values.length;values.push(value);}tags.push(k,v);}
   pbf.writeMessage(2,(value,pbf)=>{
    pbf.writeVarintField(1,feature.id||1);pbf.writePackedVarint(2,tags);pbf.writeVarintField(3,feature.type);
    const geometry=[];let px=0,py=0;const zigzag=n=>n<0?-2*n-1:2*n;
    for(let line of feature.geometry){if(feature.type===3)line=line.slice(0,-1);geometry.push(9,zigzag(line[0][0]-px),zigzag(line[0][1]-py));[px,py]=line[0];
     if(line.length>1){geometry.push(((line.length-1)<<3)|2);for(const [x,y]of line.slice(1)){geometry.push(zigzag(x-px),zigzag(y-py));px=x;py=y;}}
     if(feature.type===3)geometry.push(15);
    }
    pbf.writePackedVarint(4,geometry);
   },null);
  }
  for(const key of keys)pbf.writeStringField(3,key);
  for(const value of values)pbf.writeMessage(4,(value,pbf)=>{if(typeof value==='number')pbf.writeDoubleField(3,value);else if(typeof value==='boolean')pbf.writeBooleanField(7,value);else pbf.writeStringField(1,value);},value);
  pbf.writeVarintField(5,4096);pbf.writeVarintField(15,2);
 },null);
 return Buffer.from(tile.finish());
}
const outer=[[3800,1000],[4396,1000],[4396,3000],[3800,3000],[3800,1000]],hole=[[4000,1500],[4000,2500],[4200,2500],[4200,1500],[4000,1500]],building=[[4030,3200],[4160,3200],[4160,3350],[4030,3350],[4030,3200]],campus=[[3990,3100],[4200,3100],[4200,3500],[3990,3500],[3990,3100]],road=[[3800,3550],[4396,3550]];
function fixture(offset=0){const shift=rings=>rings.map(r=>r.map(([x,y])=>[x-offset,y]));return encode({
 water:[{id:10,type:3,properties:{class:'lake'},geometry:shift([outer,hole])}],
 building:[{id:11,type:3,properties:{render_height:24},geometry:shift([building])}],
 landuse:[{id:12,type:3,properties:{class:'hospital'},geometry:shift([campus])}],
 poi:[{id:13,type:1,properties:{class:'hospital',subclass:'hospital',name:'测试医院'},geometry:shift([[[4050,3250]]])}],
 transportation:[{id:14,type:2,properties:{class:'minor'},geometry:shift([road])},{id:15,type:2,properties:{class:'primary',brunnel:'bridge',layer:1},geometry:shift([road.map(([x,y])=>[x,y+100])])}],
 transportation_name:[{id:14,type:2,properties:{class:'minor',name:'测试路'},geometry:shift([road])}]
});}
const left={z,x,y,worldX:x,bytes:fixture()},right={z,x:x+1,y,worldX:x+1,bytes:fixture(4096)};

test('tile planning covers Hangzhou and wraps the date line without unbounded polar requests',()=>{
 const tiles=tilePlan({lat:30.26,lon:120.155},4000);assert.ok(tiles.length>1&&tiles.length<=128);assert.ok(tiles.every(t=>t.z===14));
 for(const lon of [-179.999,179.999]){const tiles=tilePlan({lat:30,lon},6000);assert.ok(tiles.some(t=>t.x===0));assert.ok(tiles.some(t=>t.x===2**t.z-1));assert.ok(tiles.every(t=>t.x>=0&&t.x<2**t.z));}
 const polar=tilePlan({lat:85,lon:0},6000);assert.ok(polar.length<=128);assert.ok(polar[0].z<14);assert.ok(polar.every(t=>t.y>=0&&t.y<2**t.z));
});

test('adjacent vector tiles join lake holes and footprints, remove labels and preserve height and bridges',()=>{
 const data=decodeVectorTiles([left,right],point,1000),water=data.features.filter(f=>f.kind==='water'),buildings=data.features.filter(f=>f.kind==='building'),roads=data.features.filter(f=>f.kind==='road');
 assert.equal(water.length,1);assert.equal(water[0].holes.length,1);assert.deepEqual(water[0].coordinates[0],water[0].coordinates.at(-1));
 assert.equal(buildings.length,1);assert.equal(buildings[0].tags.height,'24');assert.equal(roads.filter(f=>!f.tags.bridge).length,2);assert.equal(roads.filter(f=>f.tags.bridge==='yes'&&f.tags.layer==='1').length,2);
 assert.ok(roads.every(f=>f.coordinates.length>=2&&f.coordinates.some(c=>c[0]!==f.coordinates[0][0]||c[1]!==f.coordinates[0][1])));
 const connected=roads.filter(f=>!f.tags.bridge),ends=connected.map(f=>[f.coordinates[0],f.coordinates.at(-1)].map(c=>c.join(',')));assert.ok(ends[0].some(c=>ends[1].includes(c)),'both road fragments must meet at the same WGS84 seam point');
 assert.equal(data.places.filter(p=>p.coordinates.length).length,1);assert.ok(data.gameNodes.length);assert.doesNotMatch(JSON.stringify(data),/测试医院|测试路/);
 assert.equal(data.center.lat,point.lat);assert.equal(data.center.lon,Number(point.lon.toFixed(4)));assert.equal(data.source.provider,'openfreemap');assert.match(data.source.attribution,/OpenMapTiles/);
 assert.ok(data.features.every(f=>f.coordinates.every(c=>Math.abs(c[0]-point.lon)<.04&&Math.abs(c[1]-point.lat)<.04)));
});

test('cached vector bytes contain only anonymous semantic properties and preserve packed geometry and feature IDs',()=>{
 const {VectorTile,PbfReader}=require('../src/vendor/vector-tile-3.0.0-pbf-5.1.2.cjs'),raw=encode({
  building:[{id:321,type:3,properties:{render_height:48,render_min_height:12,hide_3d:false,name:'原建筑名称','name:zh':'原中文名称',official_name:'旧机构名称',brand:'原品牌'},geometry:[building]}],
  poi:[{id:322,type:1,properties:{class:'hospital',name:'原医院名称','name:en':'Original Hospital'},geometry:[[[4050,3250]]]}],
  place:[{id:323,type:1,properties:{class:'country',name:'原地区名称'},geometry:[[[4050,3250]]]}],
  transportation:[{id:324,type:2,properties:{class:'primary',surface:'asphalt',width:20,maxheight:4},geometry:[[[4020,3200],[4040,3200]]]}]
 }),before=Buffer.from(raw),clean=anonymizeVectorTile(raw),original=new VectorTile(new PbfReader(raw)),parsed=new VectorTile(new PbfReader(clean));
 assert.deepEqual(raw,before);assert.doesNotMatch(clean.toString('utf8'),/原建筑名称|原中文名称|旧机构名称|原品牌|原医院名称|Original Hospital|原地区名称/);assert.equal(parsed.layers.place,undefined);
 const body=parsed.layers.building.feature(0),prior=original.layers.building.feature(0);assert.equal(body.id,321);assert.deepEqual({...body.properties},{render_height:48,render_min_height:12,hide_3d:false});assert.deepEqual(body.loadGeometry(),prior.loadGeometry());assert.equal(parsed.layers.poi.feature(0).properties.class,'hospital');assert.deepEqual({...parsed.layers.transportation.feature(0).properties},{class:'primary'});
});

test('vector base maps omit buildings and facilities while geometry identities survive tile order changes',()=>{
 const base=decodeVectorTiles([left,right],point,1000,{baseOnly:true});assert.equal(base.generation.counts.buildings,0);assert.deepEqual(base.places,[]);assert.deepEqual(base.gameNodes,[]);assert.ok(base.features.some(f=>f.kind==='road'));
 const a=decodeVectorTiles([left,right],point,1000),b=decodeVectorTiles([right,left],point,1000);assert.deepEqual(a.features.map(f=>f.id),b.features.map(f=>f.id));
});

test('progressive building decoding preserves complete models without repeating road and water work',()=>{
 const full=decodeVectorTiles([left,right],point,1000),buildings=decodeVectorTiles([left,right],point,1000,{buildingsOnly:true});
 assert.deepEqual(buildings.features,full.features.filter(f=>f.kind==='building'));assert.deepEqual(buildings.places,full.places);assert.deepEqual(buildings.gameNodes,full.gameNodes);assert.equal(buildings.generation.counts.roads,0);
});

test('building outlines and lifted parts retain their separate heights and explicit 3D visibility',()=>{
 const shape=building.map(([x,y])=>[x-200,y]),bytes=encode({building:[{id:21,type:3,properties:{render_height:5,hide_3d:true},geometry:[shape]},{id:22,type:3,properties:{render_height:48,render_min_height:12},geometry:[shape]}]}),data=decodeVectorTiles([{...left,bytes}],point,1000),Places=require('../src/coop-local-places.js'),local=Places.create(data,{detail:true});
 assert.equal(data.features.filter(f=>f.kind==='building').length,2);assert.equal(local.sourceBuildings.find(b=>b.height===5).hidden3D,true);const tower=local.sourceBuildings.find(b=>b.height===48);assert.equal(tower.minHeight,12);assert.equal(tower.hidden3D,false);assert.equal(data.generation.buildingVersion,1);
});

test('changing the requested window does not clip a complete building or change its identity',()=>{
 const full=decodeVectorTiles([left,right],point,1000),first=full.features.find(f=>f.kind==='building'),shifted={...point,lon:point.lon+.012},next=decodeVectorTiles([left,right],shifted,1000).features.find(f=>f.kind==='building');assert.ok(next);assert.equal(next.id,first.id);assert.deepEqual(next.coordinates,first.coordinates);assert.equal(next.geometryComplete,true);
 const partial=decodeVectorTiles([left],point,1000).features.find(f=>f.kind==='building');assert.ok(partial);assert.equal(partial.geometryComplete,false,'an unfinished tile-edge body waits for the next tile instead of morphing on screen');
});

test('a missing interior tile cannot turn a progressive building fragment into a complete body',()=>{
 const gap={...right,x:x+2,worldX:x+2,bytes:encode({})},partial=decodeVectorTiles([left,gap],point,2000).features.find(f=>f.kind==='building');
 assert.ok(partial);assert.equal(partial.geometryComplete,false);
 const finished=decodeVectorTiles([left,gap,right],point,2000).features.find(f=>f.kind==='building');
 assert.equal(finished.geometryComplete,true);assert.deepEqual(finished.coordinates,decodeVectorTiles([left,right],point,2000).features.find(f=>f.kind==='building').coordinates);
});

test('an unavailable Overpass source fails over to live-format vector data through the map service',async t=>{
 const calls=[];const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://broken.example/api/interpreter',vectorEndpoint],vectorEndpoint,maxAttempts:2,logger:quiet,fetchMap:async(url,options)=>{
  calls.push({url,method:options.method||'GET'});return url.includes('broken')?new Response('bad gateway',{status:502}):url===vectorEndpoint?new Response(JSON.stringify(metadata)):new Response(fixture());
 }});t.after(()=>service.close());
 const data=await service.load({...point,radius:1000,preload:true});assert.equal(data.delivery.cache,'miss');assert.equal(data.source.provider,'openfreemap');assert.ok(data.generation.counts.roads>0&&data.generation.counts.buildings>0);
 assert.equal(calls[0].method,'POST');assert.equal(calls[1].url,vectorEndpoint);assert.ok(calls.slice(1).every(c=>c.method==='GET'));
 const count=calls.length;assert.equal((await service.load({...point,radius:1000})).delivery.cache,'hit');assert.equal(calls.length,count);
});

test('base and full requests share an eight-request limit and reuse downloaded vector tiles',async()=>{
 let active=0,max=0,calls=0;
 const source=createVectorMapSource({vectorEndpoint,fetchMap:async(url,options)=>{calls++;active++;max=Math.max(active,max);try{await delay(3,undefined,{signal:options.signal});return url===vectorEndpoint?new Response(JSON.stringify(metadata)):new Response(fixture());}finally{active--;}}});
 const [base,full]=await Promise.all([source.load(point,1500,{baseOnly:true}),source.load(point,1500)]);assert.ok(max<=8&&max>4);assert.equal(base.generation.counts.buildings,0);assert.ok(full.generation.counts.buildings>0);
 assert.equal(calls,1+tilePlan(point,1500).length,'concurrent cold layers must download the directory and each tile only once');
 const count=calls;await source.load(point,1500);assert.equal(calls,count);assert.equal(active,0);
});

test('warming the provider catalog downloads no map tiles and the first map still has zero tile hits',async()=>{
 const calls=[],source=createVectorMapSource({vectorEndpoint,fetchMap:async url=>{calls.push(url);return url===vectorEndpoint?new Response(JSON.stringify(metadata)):new Response(fixture());}});
 await source.warmCatalog();assert.deepEqual(calls,[vectorEndpoint]);const data=await source.load(point,1000);
 assert.equal(calls.filter(url=>url===vectorEndpoint).length,1);assert.equal(data.delivery.tileCacheHits,0);assert.equal(data.delivery.tiles,tilePlan(point,1000).length);source.close();
});

test('cold downloads start at the camera and publish complete buildings before the outer tiles finish',async()=>{
 const calls=[],frames=[],pending=[],body=encode({building:[{id:99,type:3,properties:{render_height:18},geometry:[[[1900,1900],[2100,1900],[2100,2100],[1900,2100],[1900,1900]]]}]}),source=createVectorMapSource({vectorEndpoint,fetchMap:async(url,options)=>{
  calls.push(url);if(url===vectorEndpoint)return new Response(JSON.stringify(metadata));
  if(calls.length===2)return new Response(body);
  return new Promise((resolve,reject)=>{pending.push(()=>resolve(new Response(body)));options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
 }});
 let done=false;const job=source.load(point,2000,{onData:data=>frames.push(data)}).then(data=>{done=true;return data;});
 while(!frames.length)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(done,false);assert.equal(frames[0].delivery.tiles,1);assert.equal(frames[0].delivery.tileCacheHits,0);assert.ok(frames[0].features.length>0);assert.ok(frames[0].features.every(f=>f.geometryComplete));
 const first=calls[1].match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/).slice(1).map(Number),planned=tilePlan(point,2000),n=2**first[0],fx=(point.lon+180)/360*n,fy=(1-Math.asinh(Math.tan(point.lat*Math.PI/180))/Math.PI)/2*n,score=t=>(t.worldX+.5-fx)**2+(t.y+.5-fy)**2;
 assert.equal(score({worldX:first[1],y:first[2]}),Math.min(...planned.map(score)));
 pending.shift()();while(frames.length<2)await new Promise(resolve=>setImmediate(resolve));assert.equal(frames[1].delivery.tiles,2,'a downloaded nearby tile must not wait for a group of four');assert.equal(done,false);
 while(!done){for(const finish of pending.splice(0))finish();await new Promise(resolve=>setImmediate(resolve));}
 const full=await job,ids=new Set(full.features.map(f=>f.id));assert.equal(full.delivery.tiles,full.delivery.totalTiles);assert.ok(frames.flatMap(f=>f.features).every(f=>ids.has(f.id)),'progressive models keep the identity of the completed window');
 const published=frames.flatMap(f=>f.features.map(b=>b.id));assert.equal(new Set(published).size,published.length,'complete models are only sent once before the final window');
});

test('progressive decoding stays within a linear tile-work budget as the reserve grows',async t=>{
 const frames=[],body=encode({building:[{id:99,type:3,properties:{render_height:18},geometry:[[[1900,1900],[2100,1900],[2100,2100],[1900,2100],[1900,1900]]]}]}),source=createVectorMapSource({vectorEndpoint,fetchMap:async url=>url===vectorEndpoint?new Response(JSON.stringify(metadata)):new Response(body)});t.after(()=>source.close());
 const full=await source.load(point,6000,{onData:data=>frames.push(data)}),reference=await source.load(point,6000);
 assert.ok(full.delivery.totalTiles>=32,'exercise a wide reserve rather than a single tile');
 assert.equal(frames[0].delivery.tiles,1,'the nearest buildings still stream immediately');
 const tileWork=frames.reduce((sum,data)=>sum+data.delivery.tiles,full.delivery.totalTiles);
 assert.ok(tileWork<=3*full.delivery.totalTiles,'partial frames must not repeatedly decode the whole growing window');
 assert.deepEqual(full.features,reference.features,'batching must retain the complete final map');
 const published=frames.flatMap(data=>data.features.map(f=>f.id));assert.equal(new Set(published).size,published.length);
});

test('shared downloaded tiles still yield to socket delivery before an entire progressive window finishes',async()=>{
 const body=encode({building:[{id:99,type:3,properties:{render_height:18},geometry:[[[1900,1900],[2100,1900],[2100,2100],[1900,2100],[1900,1900]]]}]}),source=createVectorMapSource({vectorEndpoint,fetchMap:async url=>url===vectorEndpoint?new Response(JSON.stringify(metadata)):new Response(body)});
 await source.load(point,2000);let done=false,first,delivered;const observed=new Promise(resolve=>{delivered=resolve;});
 const job=source.load(point,2000,{onData:data=>{if(first)return;first=data;setImmediate(()=>{delivered({done,tiles:data.delivery.tiles});});}}).then(data=>{done=true;return data;});
 const beforeCompletion=await observed;assert.equal(beforeCompletion.done,false,'writing a partial frame must let the socket run before more cached tile decoding');assert.equal(beforeCompletion.tiles,1);assert.ok(first.features.length);await job;source.close();
});

test('successive building frames keep action points inside their own delta of real places',async()=>{
 const Places=require('../src/coop-local-places.js'),frames=[],source=createVectorMapSource({vectorEndpoint,fetchMap:async url=>url===vectorEndpoint?new Response(JSON.stringify(metadata)):new Response(fixture())});
 await source.load(point,2000,{onData:data=>frames.push(data)});
 assert.ok(frames.length>1);assert.ok(frames.some(data=>data.gameNodes.length));
 for(const data of frames){const ids=new Set(data.places.map(p=>p.id));assert.ok(data.gameNodes.every(node=>ids.has(node.placeId)),'a delta cannot refer to a facility sent in a previous frame');assert.doesNotThrow(()=>Places.create(data,{detail:true}));}
 source.close();
});

test('a missing tile cannot mark an incomplete window as cached and a later request can recover',async t=>{
 let fail=true;const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:[vectorEndpoint],vectorEndpoint,maxAttempts:1,logger:quiet,fetchMap:async url=>url===vectorEndpoint?new Response(JSON.stringify(metadata)):fail?new Response('',{status:503}):new Response(fixture())});t.after(()=>service.close());
 await assert.rejects(service.load({...point,radius:1000}),error=>error.status===503);assert.equal(service.peek({...point,radius:1000}),null);
 fail=false;assert.ok((await service.load({...point,radius:1000})).features.length>0);
});

test('cancelling one tile window does not abort a different window waiting on the shared network limit',async()=>{
 let started=0,active=0;const source=createVectorMapSource({vectorEndpoint,fetchMap:async(url,options)=>{
  if(url===vectorEndpoint)return new Response(JSON.stringify(metadata));started++;active++;
  try{await delay(15,undefined,{signal:options.signal});return new Response(fixture());}finally{active--;}
 }}),controller=new AbortController();
 const cancelled=assert.rejects(source.load(point,1000,{signal:controller.signal}),error=>error.name==='AbortError'),other=source.load({...point,lat:30.265},1000);
 while(!started)await new Promise(resolve=>setImmediate(resolve));controller.abort();await cancelled;assert.ok((await other).generation.counts.roads>0);assert.equal(active,0);
});
