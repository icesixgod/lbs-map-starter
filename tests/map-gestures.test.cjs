'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Gestures=require('../src/map-gestures.js'),Geography=require('../src/coop-geography.js');

function surface(){
 const handlers=new Map(),captured=new Set(),node={hidden:false,dataset:{},contains:target=>target===node,closest:()=>null,
  getBoundingClientRect:()=>({left:0,top:0,right:390,bottom:780,width:390,height:780}),
  setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id),
  addEventListener:(name,handler)=>handlers.set(name,handler),removeEventListener:name=>handlers.delete(name)};
 return{node,handlers,captured,send(type,id,x,y,extra={}){const event={button:0,pointerType:'touch',isPrimary:id===1,pointerId:id,clientX:x,clientY:y,target:node,detail:type==='click'?1:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};handlers.get(type)?.(event);return event;}};
}

test('a small finger wobble selects once; dragging never selects or fires a compatibility click',()=>{
 const s=surface(),taps=[],pans=[],interactions=[];let ends=0;
 const input=Gestures.bind({surface:s.node,origin:e=>e.target===s.node?s.node:null,tap:p=>taps.push(p),pan:p=>pans.push({...p}),end:()=>ends++,interaction:value=>interactions.push(value)});
 s.send('pointerdown',1,80,120);s.send('pointermove',1,84,124);s.send('pointerup',1,84,124);
 assert.equal(taps.length,1);assert.equal(pans.length,0);assert.equal(s.captured.size,0);
 s.send('pointerdown',1,80,120);s.send('pointermove',1,100,125);s.send('pointermove',1,130,140);s.send('pointerup',1,140,145);
 assert.equal(taps.length,1);assert.equal(pans.at(-1).clientX,140);assert.deepEqual(interactions,[true,false]);assert.equal(ends,2);
 assert.equal(s.send('click',1,140,145).prevented,true);assert.equal(s.send('click',-1,140,145,{detail:0,pointerType:''}).prevented,undefined,'keyboard activation is preserved');input.destroy();
});

test('two fingers zoom about their midpoint and lifting either finger resumes a drag without a tap',()=>{
 for(const firstLift of [1,2]){
  const s=surface(),starts=[],pinches=[],taps=[],interactions=[];
  Gestures.bind({surface:s.node,origin:()=>s.node,start:p=>starts.push({...p}),pinchStart:p=>pinches.push({...p}),pinch:p=>pinches.push({...p}),tap:p=>taps.push(p),interaction:value=>interactions.push(value)});
  s.send('pointerdown',1,100,300);s.send('pointerdown',2,200,300);s.send('pointermove',2,300,300);
  assert.equal(pinches.at(-1).ratio,.5);assert.equal(pinches.at(-1).clientX,200);assert.equal(pinches.at(-1).clientY,300);
  s.send('pointerup',firstLift,firstLift===1?100:300,300);
  const remaining=firstLift===1?2:1,last=starts.at(-1);assert.equal(last.id,remaining);assert.equal(last.x,last.clientX);assert.equal(last.moved,true);
  s.send('pointermove',remaining,last.x+25,320);s.send('pointerup',remaining,last.x+25,320);
  assert.equal(taps.length,0);assert.deepEqual(interactions,[true,false]);assert.equal(s.captured.size,0);
  for(const id of [1,2])assert.equal(s.send('click',id,100,300).prevented,true);
  s.send('pointerdown',1,120,200);s.send('pointerup',1,120,200);assert.equal(taps.length,1,'the next independent tap still works');
 }
});

test('a cancelled or lost second finger releases the whole gesture and never leaves a stuck drag',()=>{
 for(const reason of ['pointercancel','lostpointercapture','blur']){
  const s=surface(),blur=surface(),ends=[],interactions=[];let taps=0;
  const input=Gestures.bind({surface:s.node,origin:()=>s.node,blurTarget:blur.node,tap:()=>taps++,end:(p,state)=>ends.push(state),interaction:value=>interactions.push(value)});
  s.send('pointerdown',1,100,300);s.send('pointerdown',2,200,300);
  if(reason==='blur')blur.handlers.get('blur')();else s.send(reason,2,200,300);
  assert.equal(input.active,false);assert.equal(s.captured.size,0);assert.equal(ends.length,1);assert.equal(ends[0].cancelled,true);assert.deepEqual(interactions,[true,false]);
  s.send('pointerup',1,100,300);s.send('pointerup',2,200,300);assert.equal(taps,0);input.destroy();assert.equal(s.handlers.size,0);assert.equal(blur.handlers.size,0);
 }
});

test('map gestures ignore UI controls, orphan secondary fingers and non-primary mouse buttons',()=>{
 const s=surface();let taps=0,enabled=true;
 const input=Gestures.bind({surface:s.node,origin:e=>e.target===s.node?s.node:null,enabled:()=>enabled,tap:()=>taps++});
 s.send('pointerdown',2,100,300);assert.equal(input.active,false);
 s.send('pointerdown',1,100,300,{button:2});s.send('pointerdown',1,100,300,{target:{}});assert.equal(input.active,false);
 s.send('pointerdown',1,100,300);enabled=false;s.send('pointermove',1,180,300);assert.equal(input.active,false);assert.equal(taps,0);
});

function flatFixture(){
 const s=surface(),blur=surface(),geo=Geography.create({center:{lat:31,lon:121,crs:'WGS84'},radiusMeters:3000,features:[],places:[]}),box={x:-800,y:-800,width:1600,height:1600};
 const flat={...s.node,viewBox:{baseVal:box},contains:target=>target===flat,setAttribute(name,value){if(name==='viewBox'){const [x,y,width,height]=value.split(' ').map(Number);Object.assign(box,{x,y,width,height});}}};
 let selected=0;
 const context=vm.createContext({LBSMapGestures:Gestures,mapLocal:{geo},filter:'all',twoD:true,twoDPointer:null,window:blur.node,$:id=>id==='map-2d'?flat:id==='district-map'?s.node:{contains:()=>false},districts:{at:()=>({id:'building'})},layout2D(){},mapInteraction(){},scheduleMapView(){},selectMapDistrict(){selected++;},closeBrief(){}});
 const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('  function set2DView('),source.indexOf('  let mapBuildRequest='))+source.slice(source.indexOf("  const flatMap=$('map-2d')"),source.indexOf("  flatMap.addEventListener('keydown'")),context);
 return{...s,flat,box,context,selected:()=>selected,send(type,id,x,y,extra={}){return s.send(type,id,x,y,{target:flat,...extra});}};
}

test('the actual 2D map keeps the geographic pinch anchor fixed, clamps zoom and continues one-finger panning',()=>{
 const s=flatFixture(),screenPoint=(x,y)=>{const b=s.box,scale=Math.min(390/b.width,780/b.height);return{x:b.x+b.width/2+(x-195)/scale,y:b.y+b.height/2+(y-390)/scale};};
 s.send('pointerdown',1,100,300);s.send('pointerdown',2,200,300);const anchor=screenPoint(150,300);
 s.send('pointermove',2,300,300);assert.equal(s.box.height,800);const after=screenPoint(200,300);assert.ok(Math.abs(anchor.x-after.x)<1e-6);assert.ok(Math.abs(anchor.y-after.y)<1e-6);
 s.send('pointerup',1,100,300);const before={...s.box};s.send('pointermove',2,300,300);assert.ok(Math.abs(s.box.x-before.x)<1e-6);assert.ok(Math.abs(s.box.y-before.y)<1e-6,'no jump when one finger lifts');
 s.send('pointermove',2,330,320);assert.ok(s.box.x<before.x);s.send('pointerup',2,330,320);assert.equal(s.selected(),0);assert.equal(s.context.twoDPointer,null);
 s.send('pointerdown',1,100,300);s.send('pointerdown',2,200,300);s.send('pointermove',2,3000,300);assert.equal(s.box.height,450);s.send('pointermove',2,101,300);assert.equal(s.box.height,5200);
 s.send('pointercancel',2,101,300);s.send('pointerdown',1,195,390);s.send('pointerup',1,195,390);assert.equal(s.selected(),1);
});

test('the actual 3D camera keeps the ground anchor under both fingers and does not pick after a pinch',()=>{
 const Three=require('../src/vendor/three-0.160.1.min.js'),source=fs.readFileSync(require.resolve('../src/coop-district-scene.js'),'utf8'),s=surface(),blur=surface(),geo=Geography.create({center:{lat:31,lon:121,crs:'WGS84'},radiusMeters:3000,features:[],places:[]});
 let selected=0;
 const context=vm.createContext({THREE:Three,LBSMapGestures:Gestures,root:{dataset:{}},geo,canvas:s.node,container:s.node,window:blur.node,
  camera:new Three.OrthographicCamera(-400,400,800,-800,1,9000),target:new Three.Vector3(),offset:new Three.Vector3(620,1400,1600),ground:new Three.Object3D(),plane:new Three.Plane(new Three.Vector3(0,1,0),-1),ray:new Three.Raycaster(),uv:new Three.Vector2(),hit:new Three.Vector3(),
  span:1600,width:390,height:780,active:true,disposed:false,framing:false,cameraDirty:true,projectionDirty:true,viewInput:false,viewChanged:false,labelsDirty:false,dirty:false,pendingPan:null,pointer:null,followTarget:null,dragStats:{gestures:0},lastDragFrame:0,inputInstalled:false,
  options:{streamMap:true,detailedCity:true,districtSelection:{regions:[],raycast:()=>null,at:()=>({id:'building'})}},buildingsVisible:true,visibleBuildingIds:new Set(),filter:'all',performance,onSelect(){selected++;}});
 vm.runInContext(source.slice(source.indexOf(' function invalidateCamera('),source.indexOf(' function resize(){'))+source.slice(source.indexOf(' function viewRadius(){'),source.indexOf(' let lastStats=')),context);
 context.updateCamera();context.installInput();
 const groundAt=(x,y)=>{context.cast({clientX:x,clientY:y});context.ray.ray.intersectPlane(context.plane,context.hit);return context.hit.clone();};
 s.send('pointerdown',1,100,300);s.send('pointerdown',2,200,300);const anchor=groundAt(150,300);s.send('pointermove',2,300,300);
 assert.equal(context.span,800);assert.ok(groundAt(200,300).distanceTo(anchor)<1e-6);
 s.send('pointerup',1,100,300);const before=context.target.clone();s.send('pointermove',2,300,300);context.applyPan();assert.ok(context.target.distanceTo(before)<1e-6);
 s.send('pointermove',2,330,320);s.send('pointerup',2,330,320);assert.ok(context.target.distanceTo(before)>20);assert.equal(selected,0);assert.equal(context.pointer,null);
 s.send('pointerdown',1,100,300);s.send('pointerdown',2,200,300);s.send('pointermove',2,4000,300);assert.equal(context.span,420);s.send('pointermove',2,101,300);assert.equal(context.span,5200);s.send('pointercancel',2,101,300);assert.equal(context.pointer,null);
 context.destroyInput();assert.equal(s.handlers.size,0);
});
