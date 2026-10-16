'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Geography=require('../src/coop-geography.js'),Places=require('../src/coop-local-places.js'),Districts=require('../src/coop-district-scene.js'),Buildings=require('../src/lbs-map-buildings.js');
function fixture(bodies){
 const data={center:{lat:31,lon:121,crs:'WGS84'},radiusMeters:2000,features:[],places:[],gameNodes:[]},geo=Geography.create(data);
 data.features=bodies.map(([id,x,y,w,d,height=20,min=0])=>({id,kind:'building',tags:{building:'yes',height:String(height),min_height:String(min)},coordinates:[[x-w/2,y-d/2],[x+w/2,y-d/2],[x+w/2,y+d/2],[x-w/2,y+d/2],[x-w/2,y-d/2]].map(([x,y])=>{const p=geo.coordinate(x,y);return[p.lon,p.lat];}),holes:[]}));return data;
}
function model(data){const local=Places.create(data,{detail:true});return{local,districts:Districts.create(data,local)};}

test('edge-connected chains form one building while a real lane keeps the next building separate',()=>{
 const data=fixture([[1,0,0,20,20],[2,20,0,20,20],[3,40,0,20,20],[4,62,0,20,20]]),before=JSON.stringify(data),{local,districts}=model(data),group=districts.at({east:0,north:0});
 assert.equal(districts.regions.length,2);assert.equal(group.partCount,3);assert.equal(group.area,1200);assert.equal(group.buildingCount,1);assert.equal(local.sourceBuildings.length,4);
 for(const x of [0,20,40])assert.equal(districts.at({east:x,north:0}).id,group.id);
 for(const part of group.parts)assert.equal(districts.byId.get(part.id),group);
 assert.notEqual(districts.at({east:62,north:0}).id,group.id);assert.equal(districts.at({east:51,north:0}),null);assert.equal(JSON.stringify(data),before);
});

test('vertical contact groups a podium and tower without filling the space below a detached overhead building',()=>{
 const data=fixture([[1,0,0,80,60,8],[2,5,0,20,20,64,8],[3,5,0,20,20,100,70]]),{local,districts}=model(data),lower=districts.forPlace({...local.buildings[0],buildingIds:['1']}),upper=districts.forPlace({...local.buildings[2],buildingIds:['3']});
 assert.equal(districts.regions.length,2);assert.equal(lower.partCount,2);assert.notEqual(lower.id,upper.id);assert.deepEqual(lower.parts.map(p=>[p.height,p.minHeight]),[[8,0],[64,8]]);
 assert.equal(districts.raycast({origin:{x:5,y:200,z:0},direction:{x:0,y:-1,z:0}}).id,upper.id);
 assert.equal(districts.raycast({origin:{x:5,y:66,z:-100},direction:{x:0,y:0.001,z:1}}),null,'air between the volumes is not a wall');
 assert.equal(districts.raycast({origin:{x:5,y:30,z:-100},direction:{x:0,y:0.001,z:1}}).id,lower.id);
});

test('height caps and cached models cannot join vertically separated source parts',()=>{
 const data=fixture([[1,0,0,20,20,275],[2,0,0,16,16,295,255],[3,0,0,8,8,355,340]]),local=Places.create(data,{detail:true}),registry=Buildings.create(),stable=registry.resolve(local.sourceBuildings,local.geo);registry.remember(stable.buildings);
 const retained=registry.resolve([],local.geo).buildings,next=Districts.create(data,{...local,buildings:retained,sourceBuildings:retained});assert.equal(next.regions.length,2);assert.equal(next.regions.find(r=>r.parts).partCount,2);
 assert.deepEqual(retained.map(b=>[b.connectionHeight,b.connectionMinHeight]),[[275,0],[295,255],[355,340]]);assert.ok(retained.every(b=>b.height===220));
});

test('a courtyard keeps its empty interior and detached annex; sub-metre tile seams share selection without inventing ground',()=>{
 const data=fixture([[1,0,0,80,80],[2,0,0,20,20]]),geo=Geography.create(data),hole=fixture([[3,0,0,40,40]]).features[0].coordinates;data.features[0].holes=[hole];
 const courtyard=model(data).districts;assert.equal(courtyard.regions.length,2);assert.notEqual(courtyard.at({east:30,north:0}).id,courtyard.at({east:0,north:0}).id);assert.equal(courtyard.at({east:15,north:0}),null);
 const seam=fixture([[1,0,0,20,20],[2,20.5,0,20,20]]),joined=model(seam).districts,r=joined.regions[0];assert.equal(joined.regions.length,1);assert.equal(r.footprints.length,2);assert.equal(joined.at({east:10.25,north:0}),null);assert.equal(joined.at({east:20.5,north:0}).id,r.id);
 const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8'),markup=[],document={createElementNS(){return{firstChild:null,appendChild(n){markup.push(n.html);n.parent.firstChild=null;},set innerHTML(html){this.firstChild={html,parent:this};}};}},context=vm.createContext({document,esc:s=>s,buildingLabel:require('../src/map-model.js').createBuildingLabels(),CoopCityBlocks:{roadWidth:()=>20}});
 vm.runInContext(source.slice(source.indexOf('  function* mapSvgSteps('),source.indexOf('  function selectMapDistrict(')),context);const iterator=context.mapSvgSteps({...seam,features:[]},{geo:Geography.create(seam),buildings:[]},joined);while(!iterator.next().done){}
 const path=markup.join('').match(/<path class="district-region"[^>]+>/g);assert.equal(path.length,1);assert.equal((path[0].match(/M/g)||[]).length,2,'both disconnected projections use the same 2D hit target');
});

test('late connected parts and reprojection preserve old selection aliases without duplicating members',()=>{
 const data=fixture([[1,0,0,20,20],[2,20,0,20,20],[3,40,0,20,20]]),partial={...data,features:data.features.slice(1)},old=model(partial),complete=model(data),oldId=old.districts.regions[0].id;
 const mixed=Districts.restore([...complete.districts.regions,...old.districts.regions],complete.local);assert.equal(mixed.regions.length,1);assert.equal(mixed.regions[0].partCount,3);assert.equal(mixed.byId.get(oldId),mixed.regions[0]);
 const nextData={...data,center:{...complete.local.geo.coordinate(1500,-800),crs:'WGS84'}},nextLocal=Places.create(nextData,{detail:true}),iterator=Districts.projectSteps(mixed.regions,nextLocal.geo);let step;do{step=iterator.next();}while(!step.done);
 const projected=Districts.restore(step.value,nextLocal),p=nextLocal.geo.local(121,31);assert.equal(projected.at(p).id,mixed.regions[0].id);assert.deepEqual(projected.regions[0].parts.map(p=>p.coordinates),mixed.regions[0].parts.map(p=>p.coordinates));assert.equal(projected.byId.get(oldId).partCount,3);
});

test('all 56 mapped landmark parts form one anonymous building and retain their original geometry and heights',()=>{
 const data=require('../src/assets/default-map.json'),before=JSON.stringify(data),{local,districts}=model(data),tower=districts.at({east:0,north:0});
 assert.ok(tower);assert.equal(tower.partCount,56);assert.ok(tower.bounds[2]-tower.bounds[0]<100);assert.ok(tower.bounds[3]-tower.bounds[1]<100);
 assert.ok(tower.parts.some(p=>p.connectionHeight===468));assert.ok(tower.parts.some(p=>p.connectionMinHeight===0));assert.equal(tower.height,Math.max(...tower.parts.map(p=>p.height)));
 const bodies=new Map(local.sourceBuildings.map(b=>[String(b.id),b]));for(const part of tower.parts){const b=bodies.get(part.buildingIds[0]);assert.ok(b);assert.deepEqual(part.coordinates,b.coordinates);assert.equal(part.height,b.height);assert.equal(part.minHeight,b.minHeight);assert.equal(districts.byId.get(part.id),tower);}
 assert.equal(JSON.stringify(data),before);
});

test('a partial streamed group retains visible old members even when the incoming group has the same root ID',()=>{
 const data=fixture([[1,0,0,20,20],[2,20,0,20,20],[3,40,0,20,20]]),old=model(data),partial={...data,features:data.features.slice(0,1)},incoming=model(partial),source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8');
 old.local.selectionLandmarks=[{osmWay:123,name:'示例建筑',...data.center}];
 const context=vm.createContext({CoopDistrictSelection:Districts,selectedDistrict:null});
 vm.runInContext(source.slice(source.indexOf('  function* scopeMapSteps('),source.indexOf('  function* mapSvgSteps('))+source.slice(source.indexOf('  function* streamMapModelSteps('),source.indexOf('  async function commitStreamMapModel(')),context);
 const iterator=context.streamMapModelSteps({data:partial,local:incoming.local,districtRegions:incoming.districts.regions},old.local,old.districts,{hasBuilding:id=>String(id)==='2'},{data,local:old.local});let step;do{step=iterator.next();}while(!step.done);
 const next=step.value;assert.equal(next.districts.regions.length,1);assert.equal(next.districts.regions[0].partCount,2);assert.equal(next.districts.regions[0].id,incoming.districts.regions[0].id);assert.equal(new Set(next.districts.regions[0].memberIds).size,2);
 assert.ok(next.districts.byId.has(old.districts.regions[0].parts[1].id));assert.ok(!next.districts.byId.has(old.districts.regions[0].parts[2].id),'an unselected member that is no longer rendered may leave the bounded model');assert.equal(next.local.sourceBuildings.length,2);assert.equal(next.local.selectionLandmarks[0].name,'示例建筑');assert.equal(old.districts.regions[0].partCount,3);
});
