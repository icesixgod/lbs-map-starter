'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Policy=require('../src/map-data-policy.js'),Generator=require('../src/coop-map-generator.js'),{createMapService}=require('../scripts/district-map-service.cjs'),{createMapServer}=require('../scripts/serve.cjs');
const original='上游名称样本',forbidden=/name|address|addr:|brand|operator|description|note|wikipedia|wikidata|contact|website|shortName|facilityName|street/i;
function named(point={lat:30,lon:120}){
 const geometry=[[0,0],[.0001,0],[.0001,.0001],[0,.0001],[0,0]].map(([x,y])=>({lon:point.lon+x,lat:point.lat+y})),data=Generator.normalize({elements:[{type:'way',id:1,tags:{building:'hospital',height:'32',min_height:'4'},geometry}]},point);
 data.name=original;data.center.name=original;data.center.address=original;
 const labels={name:original,'name:zh':original,'name:en':original,alt_name:original,official_name:original,short_name:original,'addr:housename':original,'addr:province':original,'addr:full':original,brand:original,operator:original,description:original,wikipedia:original,'contact:website':original};
 Object.assign(data.features[0],{name:original,shortName:original,facilityName:original,address:original,street:original,description:original});Object.assign(data.features[0].tags,labels);
 data.places=[{id:'way/1',name:original,shortName:original,lon:point.lon,lat:point.lat,coordinates:data.features[0].coordinates,holes:[],tags:{amenity:'hospital',...labels}}];
 data.gameNodes=[{id:'place-1',placeId:'way/1',name:original,address:original,...point}];return data;
}
function anonymous(data){
 assert.doesNotMatch(JSON.stringify(data),new RegExp(original));
 for(const key of ['features','places','gameNodes'])for(const item of data[key]||[]){for(const field of Object.keys(item))assert.equal(forbidden.test(field),false,field);for(const field of Object.keys(item.tags||{}))assert.equal(forbidden.test(field),false,field);}
 for(const field of Object.keys(data.center||{}))assert.equal(forbidden.test(field),false,field);
}

test('data policy removes names, translations, aliases, addresses and descriptive POI tags without changing geometry or attribution',()=>{
 const input=named(),before=JSON.stringify(input),clean=Policy.cleanMap(input);anonymous(clean);assert.equal(JSON.stringify(input),before);assert.deepEqual(clean.features[0].coordinates,input.features[0].coordinates);assert.deepEqual(clean.features[0].tags,{building:'hospital',height:'32',min_height:'4'});assert.equal(clean.features[0].id,1);assert.equal(clean.source.name,'OpenStreetMap contributors');assert.equal(clean.places[0].tags.amenity,'hospital');assert.equal(clean.gameNodes[0].placeId,'way/1');assert.deepEqual(Policy.cleanMap(clean),clean);
 const raw=Policy.cleanRaw({elements:[{type:'relation',id:2,tags:{type:'multipolygon',natural:'water',name:original},members:[{type:'way',ref:3,role:'outer',geometry:[],tags:{alt_name:original}}]}]});assert.doesNotMatch(JSON.stringify(raw),new RegExp(original));assert.equal(raw.elements[0].members[0].ref,3);
});

test('bundled and regression data and the generated bootstrap contain no upstream feature labels',()=>{
 for(const file of ['../src/assets/default-map.json','./fixtures/binjiang-map.json']){
  const data=require(file);anonymous(data);assert.deepEqual(Policy.cleanMap(data),data);assert.match(data.source.name,/OpenStreetMap/);
 }
 const html=fs.readFileSync(require.resolve('../dist/index.html'),'utf8'),embedded=JSON.parse(html.match(/const LBS_DISTRICT_DATA=(.*?);<\/script>/)[1]);anonymous(embedded);assert.equal(embedded.namePolicyVersion,Policy.VERSION);
 const raw=require('../src/assets/district-water-surfaces.json');assert.deepEqual(Policy.cleanRaw(raw),raw);
});

test('old disk cache entries are sanitized before delivery and rewritten without original names',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lbs-map-names-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const data={...named(),radiusMeters:2000,extentMeters:2900},key=Generator.cacheKey(data.center,2000),file=path.join(dir,key+'.json');
 fs.writeFileSync(file,JSON.stringify({savedAt:Date.now(),data}));const service=createMapService({cacheDir:dir,upstream:{load(){assert.fail('usable geometry should be kept');}}});t.after(()=>service.close());
 const first=await service.load({lat:30,lon:120,radius:2000});anonymous(first);assert.equal(first.delivery.cache,'hit');anonymous(JSON.parse(fs.readFileSync(file,'utf8')).data);assert.deepEqual(first.features[0].coordinates,data.features[0].coordinates);
 anonymous(await service.load({lat:30.001,lon:120.001,radius:1000}));anonymous(service.peek({lat:30,lon:120,radius:2000}));
});

test('JSON, base-map and every NDJSON response frame omit upstream labels even from a custom source',async t=>{
 const app=createMapServer({mapOptions:{cacheDir:false,cooldownMs:0,upstream:{async load(point,meters,{onData}={}){const data=named(point);onData?.({...data,delivery:{partial:true}});return data;}}}});t.after(()=>app.close());
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port+'/api/map?lat=30&lon=120';
 const json=await(await fetch(base)).json();anonymous(json);assert.equal(json.features[0].tags.height,'32');anonymous(await(await fetch(base)).json());anonymous(await(await fetch(base+'&layer=base')).json());
 const response=await fetch(base.replace('lat=30','lat=31')+'&stream=1'),frames=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(frames.length,2);assert.equal(frames[0].delivery.partial,true);assert.equal(frames[1].delivery.partial,false);frames.forEach(anonymous);
});
