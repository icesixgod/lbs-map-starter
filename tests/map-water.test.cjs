'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const Generator=require('../src/coop-map-generator.js'),Water=require('../src/coop-map-water.js'),Geography=require('../src/coop-geography.js'),Places=require('../src/coop-local-places.js');
const point={lat:30.23,lon:120.21,radius:1000},basis={center:{...point,crs:'WGS84'},radiusMeters:1000},geo=Geography.create(basis);
const ring=coords=>coords.map(([x,y])=>{const p=geo.coordinate(x,y);return{lon:p.lon,lat:p.lat};});
const square=(x0,y0,x1,y1)=>ring([[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]);
function contains(f,p){return Places.inside(p,f.coordinates)&&!(f.holes||[]).some(r=>Places.inside(p,r));}
function area(f){return[f.coordinates,...f.holes].reduce((sum,r,i)=>{const p=r.map(c=>geo.local(...c));let a=0;for(let j=1;j<p.length;j++)a+=p[j-1].east*p[j].north-p[j].east*p[j-1].north;return sum+(i?-1:1)*Math.abs(a)/2;},0);}
const catalog=require('../src/assets/district-water-surfaces.json');

test('both map queries fetch complete water surfaces while keeping other geometry bounded',()=>{
 for(const baseOnly of[true,false]){const q=Generator.query(point,1000,{baseOnly});assert.match(q,/relation\["natural"="water"\]\["type"="multipolygon"\]/);assert.match(q,/relation\["waterway"="riverbank"\]/);assert.match(q,/\.local out geom\([^)]+\);\.water out geom;/);assert.doesNotMatch(q,/\.water out geom\(/);if(baseOnly)assert.doesNotMatch(q,/building|amenity|shop/);}
});

test('a river spanning the output window is joined before clipping, preserving an island and a bridge',()=>{
 const outer=square(-20000,-900,20000,900),island=square(-90,-60,90,60),members=[{type:'way',ref:11,role:'outer',geometry:outer.slice(0,3)},{type:'way',ref:12,role:'outer',geometry:outer.slice(2).reverse()},{type:'way',ref:13,role:'inner',geometry:island}],bridge={type:'way',id:20,tags:{highway:'primary',bridge:'yes',layer:'1'},geometry:ring([[0,-1100],[0,1100]])};
 const raw={elements:[bridge,{type:'relation',id:10,tags:{type:'multipolygon',natural:'water',water:'river'},members}]},before=JSON.stringify(raw),d=Generator.normalize(raw,point),water=d.features.find(f=>f.kind==='water');
 assert.ok(water);assert.equal(water.holes.length,1);assert.equal(contains(water,[point.lon,point.lat]),false);const river=geo.coordinate(200,0);assert.equal(contains(water,[river.lon,river.lat]),true);assert.ok(Math.abs(area(water)-(3400*1800-180*120))<.1);
 for(const r of[water.coordinates,...water.holes])for(const c of r){const p=geo.local(...c);assert.ok(Math.abs(p.east)<=1700.00001&&Math.abs(p.north)<=1700.00001);}
 assert.deepEqual(d.features.find(f=>f.kind==='road').coordinates,bridge.geometry.map(p=>[p.lon,p.lat]));assert.equal(JSON.stringify(raw),before);assert.equal(d.generation.waterVersion,Generator.WATER_VERSION);
});

test('legacy riverbanks are surfaces and an open river centerline cannot paint surrounding land blue',()=>{
 const elements=[{type:'way',id:1,tags:{waterway:'riverbank'},geometry:square(-200,-100,200,100)},{type:'way',id:2,tags:{waterway:'river'},geometry:ring([[-500,0],[500,0]])},{type:'relation',id:3,tags:{type:'multipolygon',waterway:'riverbank'},members:[{type:'way',ref:4,role:'outer',geometry:square(400,100,600,300)}]}];
 const d=Generator.normalize({elements},point);assert.equal(d.features.filter(f=>f.kind==='water').length,2);assert.equal(d.features.find(f=>f.id===2).kind,'waterway');
});

test('missing or cropped endpoints are never joined with an invented riverbank',()=>{
 const broken=square(-1000,-600,1000,600);broken[2]=null;
 const d=Generator.normalize({elements:[{type:'way',id:1,tags:{natural:'water'},geometry:broken},{type:'relation',id:2,tags:{natural:'water',type:'multipolygon'},members:[{type:'way',ref:3,role:'outer',geometry:broken}]}]},point);
 assert.equal(d.features.length,0);
});

test('repeated full and cropped elements are deduplicated in favour of complete geometry',()=>{
 const complete={type:'way',id:1,tags:{natural:'water'},geometry:square(-800,-300,800,300)},partial={...complete,geometry:[complete.geometry[0],null,complete.geometry[2]]};
 for(const elements of[[partial,complete],[complete,partial]]){const d=Generator.normalize({elements},point);assert.equal(d.features.length,1);assert.deepEqual(d.features[0].coordinates,complete.geometry.map(p=>[p.lon,p.lat]));}
});

test('clipping and supplementing retains disconnected portions of the same source',()=>{
 const coordinates=ring([[-3000,-500],[-300,-500],[-300,2200],[300,2200],[300,-500],[3000,-500],[3000,3000],[-3000,3000],[-3000,-500]]).map(p=>[p.lon,p.lat]),feature={id:'relation/1',kind:'water',coordinates,holes:[],source:'https://www.openstreetmap.org/relation/1'},data={...basis,features:[]},parts=Water.clip(feature,data);
 assert.equal(parts.length,2);assert.notEqual(parts[0].id,parts[1].id);const updated=Water.supplement(data,parts);assert.equal(updated.features.length,2);assert.equal(Water.supplement(updated,parts).features.length,2);assert.equal(data.features.length,0);
});

test('the real Qiantang relation covers the missing river and leaves both shores and mapped islands dry',()=>{
 const d=Generator.normalize(catalog,{...point,radius:6000}),water=d.features.filter(f=>f.kind==='water'),wet=p=>water.some(f=>contains(f,p));
 assert.equal(catalog.elements[0].members.length,40);assert.ok(wet([120.21,30.232]));assert.equal(wet([120.21,30.216]),false);assert.equal(wet([120.21,30.25]),false);
 const island=water.flatMap(f=>f.holes)[0];assert.ok(island);const p=Places.center(island);assert.equal(wet([p.lon,p.lat]),false);assert.ok(water.every(f=>f.source==='https://www.openstreetmap.org/relation/8227206'));
 const snapshot=require('./fixtures/binjiang-map.json');assert.ok(snapshot.features.some(f=>f.kind==='water'&&f.source==='https://www.openstreetmap.org/relation/8227206'));
 const local=Places.create(snapshot),districts=require('../src/coop-district-scene.js').create(snapshot,local);assert.equal(districts.at(local.geo.local(120.21,30.225)),null,'water cannot become an actionable land district');
});

test('old full and base caches show corrected water immediately while offline refresh preserves roads',async t=>{
 const {createMapService}=require('../scripts/district-map-service.cjs'),cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'wasteland-water-'));t.after(()=>fs.rmSync(cacheDir,{recursive:true,force:true}));
 for(const baseOnly of[false,true]){
  const input={...point,radius:3000},data=Generator.normalize({elements:[{type:'way',id:7,tags:{highway:'primary',bridge:'yes'},geometry:ring([[0,-2000],[0,2000]])}]},input);delete data.generation.waterVersion;const before=JSON.stringify(data.features),key=Generator.cacheKey(input),dir=baseOnly?path.join(cacheDir,'base'):cacheDir;fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,key+'.json'),JSON.stringify({savedAt:Date.now(),data}));
  let calls=0;const service=createMapService({cacheDir:dir,baseOnly,cooldownMs:0,upstream:{async load(){calls++;throw Error('offline');}}});t.after(()=>service.close());
  const result=await service.load(input);assert.equal(result.delivery.stale,true);assert.ok(result.features.some(f=>f.kind==='water'&&contains(f,[120.21,30.232])));assert.equal(JSON.stringify(result.features.filter(f=>f.kind==='road')),before);assert.equal(result.generation.waterVersion,undefined,'repairing one known river does not claim all old water is current');assert.equal(calls,1);
  await new Promise(resolve=>setImmediate(resolve));assert.ok(service.peek(input).features.some(f=>f.kind==='water'));assert.equal(JSON.parse(fs.readFileSync(path.join(dir,key+'.json'))).data.generation.waterVersion,undefined);
 }
});

test('the HTTP base and full routes both include a cold water relation without building work in the base layer',async t=>{
 const {createMapServer}=require('../scripts/serve.cjs'),queries=[],app=createMapServer({mapOptions:{endpoints:['https://overpass-api.de/api/interpreter'],cacheDir:false,cooldownMs:0,fetchMap:async(url,options)=>{queries.push(new URLSearchParams(options.body).get('data'));return new Response(JSON.stringify(catalog));}}});t.after(()=>app.close());await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+app.server.address().port;
 for(const layer of['&layer=base','']){const response=await fetch(url+'/api/map?lat=30.23&lon=120.21&radius=3000'+layer);assert.equal(response.status,200);const d=await response.json();assert.ok(d.features.some(f=>f.kind==='water'&&contains(f,[120.21,30.232])));assert.equal(d.delivery.stale,false);}
 assert.equal(queries.length,2);assert.doesNotMatch(queries[0],/building/);
});

test('2D rendering preserves island holes and draws crossing roads above water regardless of source order',()=>{
 const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),start=source.indexOf('  function* mapSvgSteps('),end=source.indexOf('  function selectMapDistrict(',start),markup=[];
 const document={createElementNS(){return{firstChild:null,appendChild(n){markup.push(n.html);n.parent.firstChild=null;},set innerHTML(html){this.firstChild={html,parent:this};}};}},context=vm.createContext({document,esc:s=>s,CoopCityBlocks:{roadWidth:()=>20}});vm.runInContext(source.slice(start,end),context);
 const coordinates=square(-600,-500,600,500).map(p=>[p.lon,p.lat]),hole=square(-40,-40,40,40).map(p=>[p.lon,p.lat]),iterator=context.mapSvgSteps({features:[{kind:'road',coordinates:coordinates.slice(0,2)},{kind:'water',coordinates,holes:[hole]}]},{geo,buildings:[]},{regions:[]});while(!iterator.next().done){}
 const html=markup.join('');assert.ok(html.indexOf('class="water"')<html.indexOf('class="road"'));const water=html.match(/<path class="water"[^>]+>/)[0];assert.match(water,/fill-rule="evenodd"/);assert.equal((water.match(/M/g)||[]).length,2);
});
