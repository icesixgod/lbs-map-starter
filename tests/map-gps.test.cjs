'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Geography=require('../src/coop-geography.js'),Places=require('../src/coop-local-places.js'),Blocks=require('../src/coop-city-blocks.js'),Buildings=require('../src/lbs-map-buildings.js'),Work=require('../src/lbs-map-work.js'),LBS=require('../src/map-model.js'),Three=require('../src/vendor/three-0.160.1.min.js');
const sceneSource=fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),clientSource=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8');
function fixture(count=1){const data={center:{lat:30.21,lon:120.21,crs:'WGS84'},radiusMeters:3000,extentMeters:4350,features:[],places:[],gameNodes:[]},geo=Geography.create(data);for(let i=0;i<count;i++){const x=i%20*30,y=Math.floor(i/20)*30;data.features.push({id:'body-'+i,kind:'building',tags:{building:'yes',height:'28',min_height:'4'},coordinates:[[x,y],[x+20,y],[x+20,y+20],[x,y+20],[x,y]].map(([east,north])=>{const p=geo.coordinate(east,north);return[p.lon,p.lat];}),holes:[]});}return data;}
function artFixture(THREE=Three){const materials=new Map();return{hash:Buildings.hash,materials,counts:{},textureState:'procedural',roofAnchor:()=>null,destroy(){},surface(){return new THREE.MeshStandardMaterial();},buildingMaterial(kind,roof,variant){const key=kind+roof+variant;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial());return materials.get(key);},*uvSteps(g,scale=25,anchor={east:0,north:0}){const p=g.attributes.position,uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){uv[i*2]=(p.getX(i)-anchor.east)/scale;uv[i*2+1]=p.getY(i)/scale;if(i%32===0)yield 'uv';}g.setAttribute('uv',new THREE.BufferAttribute(uv,2));},*dressSteps(){}};}
function sceneContext(extra={}){const context=vm.createContext({LBSMapGestures:require('../src/map-gestures.js'),THREE:Three,CoopGeography:Geography,CoopLocalPlaces:Places,CoopCityBlocks:Blocks,polygonClipping:require('../src/vendor/polygon-clipping-0.15.7.min.js'),...extra});vm.runInContext(sceneSource,context);return context;}

test('GPS fixes follow the player without resetting zoom and old fixes cannot move the map backwards',()=>{
 const geo=Geography.create(fixture(0)),nodes=new Map(),moves=[],requests=[];let view={center:geo.center,span:1280,radius:1524};
 const context=vm.createContext({L:LBS,mode:'gps',position:null,mapGPSFollow:true,mapGPSFixCount:0,gpsError:'',mapLocal:{geo},data:{},twoD:false,twoDPointer:null,Date,
  $:id=>id==='combat'?{hidden:true}:nodes.has(id)?nodes.get(id):(nodes.set(id,{dataset:{},textContent:'',hidden:false}),nodes.get(id)),currentMapView:()=>view,
  scene:{dragging:false,setPosition:(p,focus)=>moves.push({p,focus}),followPosition:p=>{view={...view,center:geo.coordinate(p.east,p.north)};}},scheduleMapView:()=>requests.push(view),layout2D(){},updateAction(){},set2DView:next=>{view=next;}});
 vm.runInContext(clientSource.slice(clientSource.indexOf('  function updatePosition('),clientSource.indexOf('  function renderBuildingSelection('))+clientSource.slice(clientSource.indexOf('  function receiveGPSPosition('),clientSource.indexOf('  async function startGPS(')),context);
 for(let i=0;i<20;i++){const p=geo.coordinate(i*4,0);context.receiveGPSPosition({coords:{latitude:p.lat,longitude:p.lon,accuracy:5,speed:4},timestamp:1000+i*100});}
 assert.equal(requests.length,20);assert.equal(context.mapGPSFixCount,20);assert.equal(view.span,1280);assert.ok(geo.local(view.center.lon,view.center.lat).east>75);assert.ok(moves.every(m=>m.focus===false));
 const latest=context.position;context.receiveGPSPosition({coords:{latitude:30,longitude:120,accuracy:5},timestamp:1000});assert.equal(context.position,latest);assert.equal(requests.length,20);
 context.mapGPSFollow=false;context.receiveGPSPosition({coords:{latitude:30.211,longitude:120.212,accuracy:5},timestamp:4000});assert.equal(requests.length,20,'manual browsing keeps its camera');assert.equal(moves.length,21,'the live player marker still updates');
 context.mapGPSFollow=true;context.twoD=true;context.receiveGPSPosition({coords:{latitude:30.212,longitude:120.213,accuracy:5},timestamp:5000});assert.equal(view.span,1280);assert.equal(view.center,context.position);
 context.receiveGPSPosition({coords:{latitude:91,longitude:120,accuracy:5},timestamp:6000});assert.equal(context.position,null);assert.equal(context.mapGPSFixCount,22);
});

test('the GPS camera interpolates each fix while preserving zoom and respecting an active pointer',()=>{
 const context=vm.createContext({THREE:Three,target:new Three.Vector3(),pointer:null,span:1280,framing:true,followTarget:null,followFrame:0,viewChanged:false,dirty:false,invalidateCamera(){},updateCamera(){}});
 vm.runInContext(sceneSource.slice(sceneSource.indexOf(' function followPosition('),sceneSource.indexOf(' function movePointer(')),context);
 assert.equal(context.followPosition({east:100,north:0}),true);let previous=0;for(let time=16;time<=800;time+=16){context.applyFollow(time);assert.ok(context.target.x>=previous&&context.target.x<=100);previous=context.target.x;}
 assert.ok(context.target.x>99.9);assert.equal(context.span,1280);context.pointer={};assert.equal(context.followPosition({east:200,north:0}),false);assert.ok(context.target.x<101);
 context.pointer=null;context.followPosition({east:20000,north:-1000});assert.equal(context.target.x,20000);assert.equal(context.target.z,1000);assert.equal(context.span,1280);
});

test('live building chunks retain heights, courtyards, facade identity and the original WGS84 origin',()=>{
 const data=fixture(1),geo=Geography.create(data),outer=data.features[0].coordinates;data.features[0].holes=[[[5,5],[15,5],[15,15],[5,15],[5,5]].map(([x,y])=>{const p=geo.coordinate(x,y);return[p.lon,p.lat];})];
 const shifted={...data,center:{...data.center,...geo.coordinate(1500,500)}},local=Places.create(shifted,{detail:true}),before=JSON.stringify(local.sourceBuildings),context=sceneContext(),art=artFixture(),result=context.districtDrain(context.districtBuildingChunkSteps(geo,local.sourceBuildings,art));
 assert.equal(JSON.stringify(local.sourceBuildings),before);assert.equal(result.ids.length,1);assert.equal(result.group.children.length,2);assert.ok(result.bytes>0);
 let roofArea=0;for(const mesh of result.group.children){const p=mesh.geometry.attributes.position;for(const value of p.array)assert.ok(Number.isFinite(value));for(let i=0;i<p.count;i++)assert.ok(p.getX(i)>=-.001&&p.getX(i)<=20.001,'a new source origin must not move the live model');if(Math.abs(p.getY(0)-29.3)<.001)for(let i=0;i<p.count;i+=3)roofArea+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getX(i+2)-p.getX(i))*(p.getZ(i+1)-p.getZ(i)))/2;else assert.ok(Math.min(...p.array.filter((_,i)=>i%3===1))>=4.99);}
 assert.ok(Math.abs(roofArea-300)<.1);assert.equal(outer,data.features[0].coordinates);for(const mesh of result.group.children)mesh.geometry.dispose();for(const m of art.materials.values())m.dispose();
});

test('cancelling an unfinished live chunk releases its private geometry',()=>{
 let disposed=0;class Geometry extends Three.BufferGeometry{dispose(){disposed++;super.dispose();}}
 const context=sceneContext({THREE:{...Three,BufferGeometry:Geometry}}),data=fixture(1),local=Places.create(data,{detail:true}),iterator=context.districtBuildingChunkSteps(local.geo,local.sourceBuildings,artFixture());
 iterator.next();iterator.next();iterator.return();assert.ok(disposed>0);
});

test('the first visible live batch can be picked before the remaining buildings finish without waiting for animation frames',async()=>{
 const Districts=require('../src/coop-district-scene.js'),handlers=new Map(),root={dataset:{}},data=fixture(0),local=Places.create(data,{detail:true}),art=artFixture();let frames=0,picked=null,firstBatch=false;
 class Renderer{constructor(){this.shadowMap={};}setPixelRatio(){}setSize(){}dispose(){}}
 const canvas={hidden:false,getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),setPointerCapture(){},hasPointerCapture:()=>false},container={dataset:{},contains:node=>node===canvas,addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
 const context=sceneContext({THREE:{...Three,WebGLRenderer:Renderer},performance,LBSMapWork:Work,AbortController,devicePixelRatio:1,requestAnimationFrame:()=>++frames,cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},
  document:{getElementById:()=>null,querySelector:()=>null},window:{addEventListener(){},removeEventListener(){}},CoopInvasion:{palette:{},rifts:[],createEffects:()=>({destroy(){}})},LBSCityArt:{palette:{},*createSteps(){return art;}}});
 const scene=context.districtDrain(context.buildDistrictScene(data,local,r=>{picked=r;},{canvas,container,root,staged:true,detailedCity:true,streamMap:true,detailView:{center:data.center,radius:1000,span:420},mapLabelCandidates:()=>[],districtSelection:Districts.create(data,local)}));
 scene.activate({root});const view={center:local.geo.coordinate(10,10),radius:1000,span:420};scene.setView(view,false);
 const nextData=fixture(160);nextData.center={...local.geo.coordinate(1600,500),crs:'WGS84'};const nextLocal=Places.create(nextData,{detail:true}),regions=context.districtDrain(Districts.projectSteps(Districts.create(nextData,nextLocal).regions,local.geo)),selection=Districts.restore(regions,{geo:local.geo,buildings:[],places:[]});scene.setDistrictSelection(selection);
 const camera=new Three.OrthographicCamera(-420*1280/720/2,420*1280/720/2,210,-210,1,9000);camera.position.set(630,1400,1590);camera.lookAt(10,0,-10);camera.updateMatrixWorld();const roof=new Three.Vector3(10,29.3,-10).project(camera),event={button:0,isPrimary:true,pointerId:1,target:canvas,clientX:(roof.x+1)*640,clientY:(1-roof.y)*360};
 const built=await scene.addBuildings(nextLocal,view,{onPhase:phase=>{if(firstBatch||phase.name!=='live-building-visible')return;firstBatch=true;const live=JSON.parse(root.dataset.mapLiveBuildings);assert.equal(live.active,true);assert.equal(live.added,16);assert.equal(scene.hasBuilding('body-0'),true);handlers.get('pointerdown')(event);handlers.get('pointerup')(event);assert.equal(picked?.id,selection.forPlace({...local.geo.local(nextLocal.buildings[0].lon,nextLocal.buildings[0].lat),buildingIds:['body-0']}).id);}});
 assert.equal(firstBatch,true);assert.equal(built.added,160);assert.equal(frames,1,'the only animation request belongs to the scene, not background building work');assert.equal(scene.canvas,canvas);await scene.destroyAsync({replaceCanvas:false,preserveMetadata:true});
});

test('the real live-scene API appends without replacing the canvas, deduplicates bodies and cancels on disposal',async()=>{
 const frames=[],sizes=[];
 class Renderer{constructor(){this.shadowMap={};}setPixelRatio(){}setSize(width,height){sizes.push({width,height});}render(scene,camera){frames.push({scene,camera:camera.clone()});}dispose(){}}
 const art=artFixture(),data=fixture(0),local=Places.create(data,{detail:true}),root={dataset:{}},canvas={},context=sceneContext({THREE:{...Three,WebGLRenderer:Renderer},LBSMapWork:Work,AbortController,devicePixelRatio:1,requestAnimationFrame:callback=>setImmediate(()=>callback(performance.now())),cancelAnimationFrame:clearImmediate,CoopInvasion:{palette:{},rifts:[],createEffects:()=>({destroy(){}})},LBSCityArt:{palette:{},*createSteps(){return art;}}});
 const scene=context.districtDrain(context.buildDistrictScene(data,local,()=>{},{canvas,container:{},root,staged:true,detailedCity:true,streamMap:true,detailView:{center:data.center,radius:1000,span:1600},mapLabelCandidates:()=>[]}));
 const nearby=Places.create(fixture(40),{detail:true}),view={center:data.center,radius:1000,span:1600},first=await scene.addBuildings(nearby,view);assert.equal(first.added,40);assert.equal(scene.canvas,canvas);assert.equal(JSON.parse(root.dataset.mapLiveBuildings).models,40);assert.equal((await scene.addBuildings(nearby,view)).added,0);
 const nextView={...view,center:local.geo.coordinate(150,-75),span:1280};assert.equal(scene.preparePresentation(nextView,{width:0,height:720}),false);assert.equal(frames.length,0);
 assert.equal(scene.preparePresentation(nextView,{width:1280,height:720}),true);assert.equal(frames.length,1);assert.equal(sizes[0].width,1280);assert.equal(scene.activated,false,'first GPU upload happens before the live canvas is replaced');assert.ok(frames[0].scene.children.some(o=>o.isGroup));assert.equal(scene.view.span,1280);assert.ok(Math.abs(local.geo.local(scene.view.center.lon,scene.view.center.lat).east-150)<.001);
 const actual=scene.view,forwardData=fixture(1);forwardData.features[0].id='forward-reserve';forwardData.features[0].coordinates=forwardData.features[0].coordinates.map(([lon,lat])=>{const p=local.geo.local(lon,lat),c=local.geo.coordinate(p.east+150+actual.radius+1100,p.north-75);return[c.lon,c.lat];});
 const forwardView={...actual,center:local.geo.coordinate(450,-75),radius:actual.radius+740};assert.equal((await scene.addBuildings(Places.create(forwardData,{detail:true}),forwardView)).added,1,'the forward offset must remain inside the incremental build reserve');assert.equal(scene.buildingsCover(actual),true,'finishing the reserved window suppresses repeated builds');
 const farData=fixture(120);for(const f of farData.features)f.coordinates=f.coordinates.map(([lon,lat])=>{const p=local.geo.local(lon,lat),c=local.geo.coordinate(p.east+9000,p.north);return[c.lon,c.lat];});
 const farView={...view,center:local.geo.coordinate(9000,0),radius:1400},skipped=scene.addBuildings(Places.create(farData,{detail:true}),farView);scene.setView({...view,center:local.geo.coordinate(20000,0)},false);assert.equal((await skipped).added,0);assert.equal(scene.buildingsCover({...farView,radius:100}),false,'moving past unbuilt batches cannot publish coverage for them');
 scene.setView(view,false);let moved=false;const abandoned=await scene.addBuildings(Places.create(fixture(180),{detail:true}),view,{onPhase:phase=>{if(moved||phase.name!=='live-building-shape')return;moved=true;scene.setView({...view,center:local.geo.coordinate(20000,0)},false);}});assert.equal(moved,true);assert.equal(abandoned.added,0,'a camera move during triangulation must be checked again before attaching the batch');
 scene.setView(view,false);const more=Places.create(fixture(180),{detail:true}),pending=scene.addBuildings(more,view);scene.destroy({replaceCanvas:false,preserveMetadata:true});await assert.rejects(pending,{name:'AbortError'});
});

test('the selected building stays highlighted when a streamed window replaces its region object',async()=>{
 const Districts=require('../src/coop-district-scene.js'),data=fixture(1),local=Places.create(data,{detail:true}),selection=Districts.create(data,local),root={dataset:{}};let drawn;
 class Renderer{constructor(){this.shadowMap={};}setPixelRatio(){}setSize(){}render(scene){drawn=scene;}dispose(){}}
 const context=sceneContext({THREE:{...Three,WebGLRenderer:Renderer},LBSMapWork:Work,devicePixelRatio:1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},LBSCityArt:{palette:{}}});
 const scene=context.districtDrain(context.buildDistrictScene(data,local,()=>{},{canvas:{},container:{},root,staged:true,detailedCity:true,streamMap:true,baseOnly:true,mapLabelCandidates:()=>[],districtSelection:selection,districtStyle:LBS.districtTheme}));
 const view={center:data.center,span:900,radius:1000},original=selection.regions[0];scene.setSelected(original);scene.preparePresentation(view,{width:1280,height:720});
 function highlight(){let fill;drawn.traverse(object=>{if(object.isMesh&&object.renderOrder===3)fill=object;});return fill;}
 const fill=highlight();assert.ok(fill);assert.equal(fill.material.opacity,.3);
 const replacement=Districts.restore(selection.regions,local);assert.notEqual(replacement.regions[0],original);assert.equal(replacement.regions[0].id,original.id);
 scene.setDistrictSelection(replacement);scene.setSelected(replacement.regions[0]);scene.preparePresentation(view,{width:1280,height:720});assert.equal(highlight().material.opacity,.3);assert.equal(highlight().material.color.getHexString(),'ff9f1c');
 await scene.destroyAsync({replaceCanvas:false,preserveMetadata:true});
});

test('whole-building selection follows facades and courtyard walls, preserves raised floors and releases the previous highlight',async()=>{
 const Districts=require('../src/coop-district-scene.js'),data=fixture(2),geo=Geography.create(data);
 data.features[0].holes=[[[5,5],[15,5],[15,15],[5,15],[5,5]].map(([x,y])=>{const p=geo.coordinate(x,y);return[p.lon,p.lat];})];
 const local=Places.create(data,{detail:true}),selection=Districts.create(data,local),art=artFixture(),root={dataset:{}};let drawn;
 class Renderer{constructor(){this.shadowMap={};}setPixelRatio(){}setSize(){}render(scene){drawn=scene;}dispose(){}}
 const context=sceneContext({THREE:{...Three,WebGLRenderer:Renderer},LBSMapWork:Work,devicePixelRatio:1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},LBSCityArt:{palette:{},*createSteps(){return art;}}});
 const view={center:data.center,span:900,radius:1000},scene=context.districtDrain(context.buildDistrictScene(data,local,()=>{},{canvas:{},container:{},root,staged:true,detailedCity:true,streamMap:true,detailView:view,mapLabelCandidates:()=>[],districtSelection:selection,districtStyle:LBS.districtTheme}));
 const first=selection.regions.find(r=>r.holes.length),second=selection.regions.find(r=>!r.holes.length);
 const bodies=()=>{const found=[];drawn.traverse(object=>{if(object.userData.selectedBuildingBody)found.push(object);});return found;};
 scene.setSelected(first);scene.preparePresentation(view,{width:390,height:780});drawn.updateMatrixWorld(true);
 const body=bodies()[0];assert.equal(bodies().length,1);assert.equal(body.userData.selectedBuildingBody,first.id);assert.equal(body.material.depthTest,true);assert.equal(body.material.depthWrite,false);assert.equal(body.material.polygonOffset,true);
 body.geometry.computeBoundingBox();const box=body.geometry.boundingBox;
 assert.ok(Math.abs(box.min.y-5)<.001);assert.ok(Math.abs(box.max.y-29.3)<.001);assert.equal(body.geometry.attributes.position.count,48,'both outer and courtyard walls cover the full height');
 const ray=new Three.Raycaster(new Three.Vector3(10,14,-10),new Three.Vector3(1,0,0)),innerWall=ray.intersectObject(body)[0];
 assert.ok(innerWall&&Math.abs(innerWall.distance-5)<.001,'the courtyard faces remain selectable surfaces without filling the empty space');
 const flatFill=[];drawn.traverse(object=>{if(object.isMesh&&object.renderOrder===3&&!object.userData.selectedBuildingBody)flatFill.push(object);});
 ray.set(new Three.Vector3(10,50,-10),new Three.Vector3(0,-1,0));assert.equal(flatFill.flatMap(mesh=>ray.intersectObject(mesh)).length,0,'selection leaves the courtyard roof open');
 scene.setSelected(first);scene.invalidateLabels();assert.equal(bodies()[0].geometry,body.geometry,'repainting the same selection reuses its geometry');
 scene.setBuildingsVisible(false);assert.equal(body.parent.visible,false);scene.setBuildingsVisible(true);assert.equal(body.parent.visible,true);
 scene.setFilter('hospital');assert.equal(body.parent.visible,false);scene.setFilter('all');assert.equal(body.parent.visible,true);
 let released=0;body.geometry.addEventListener('dispose',()=>released++);
 const replacement=Districts.restore(selection.regions.map(r=>({...r,coordinates:r.coordinates.map(p=>[...p]),holes:r.holes.map(ring=>ring.map(p=>[...p]))})),local);
 scene.setDistrictSelection(replacement);scene.setSelected(replacement.byId.get(first.id));assert.equal(bodies().length,1);assert.equal(bodies()[0].userData.selectedBuildingBody,first.id);assert.equal(released,1,'a streamed replacement releases the old wall overlay');
 scene.setSelected(replacement.byId.get(second.id));assert.equal(bodies().length,1);assert.equal(bodies()[0].userData.selectedBuildingBody,second.id);
 const last=bodies()[0];last.geometry.addEventListener('dispose',()=>released++);scene.setSelected(null);assert.equal(bodies().length,0);assert.equal(released,2);
 await scene.destroyAsync({replaceCanvas:false,preserveMetadata:true});
});

test('a connected building highlights every original volume without extruding its union to the tallest roof',async()=>{
 const Districts=require('../src/coop-district-scene.js'),data=fixture(2);data.features[0].tags={building:'yes',height:'8'};
 data.features[1].coordinates=data.features[0].coordinates.map(p=>[...p]);data.features[1].tags={building:'yes',height:'64',min_height:'8'};
 const local=Places.create(data,{detail:true}),selection=Districts.create(data,local),group=selection.regions[0],art=artFixture(),root={dataset:{}};let drawn;
 assert.equal(selection.regions.length,1);assert.equal(group.partCount,2);
 class Renderer{constructor(){this.shadowMap={};}setPixelRatio(){}setSize(){}render(scene){drawn=scene;}dispose(){}}
 const context=sceneContext({THREE:{...Three,WebGLRenderer:Renderer},LBSMapWork:Work,devicePixelRatio:1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},LBSCityArt:{palette:{},*createSteps(){return art;}}});
 const view={center:data.center,span:900,radius:1000},scene=context.districtDrain(context.buildDistrictScene(data,local,()=>{},{canvas:{},container:{},root,staged:true,detailedCity:true,streamMap:true,detailView:view,mapLabelCandidates:()=>[],districtSelection:selection,districtStyle:LBS.districtTheme}));
 const overlays=key=>{const found=[];drawn.traverse(o=>{if(o.userData[key])found.push(o);});return found;};
 scene.setSelected(selection.byId.get(group.parts[1].id));scene.preparePresentation(view,{width:390,height:844});
 const bodies=overlays('selectedBuildingBody'),roofs=overlays('selectedBuildingRoof');assert.equal(bodies.length,2);assert.equal(roofs.length,2);
 for(let i=0;i<2;i++){const part=group.parts[i],body=bodies[i],roof=roofs[i];body.geometry.computeBoundingBox();roof.geometry.computeBoundingBox();assert.equal(body.userData.selectedBuildingBody,group.id);assert.equal(roof.userData.selectedBuildingRoof,group.id);assert.ok(Math.abs(body.geometry.boundingBox.min.y-(part.minHeight+1))<.001);assert.ok(Math.abs(body.geometry.boundingBox.max.y-(part.height+1.3))<.001);assert.ok(Math.abs(roof.geometry.boundingBox.min.y-(part.height+1.6))<.001);}
 scene.setSelected(selection.byId.get(group.parts[0].id));assert.equal(overlays('selectedBuildingBody')[0].geometry,bodies[0].geometry,'selecting another part reuses the same whole-building highlight');
 let released=0;for(const body of bodies)body.geometry.addEventListener('dispose',()=>released++);scene.setSelected(null);assert.equal(overlays('selectedBuildingBody').length,0);assert.equal(released,2);
 await scene.destroyAsync({replaceCanvas:false,preserveMetadata:true});
});
