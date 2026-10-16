/* LBS city art v3: mapped footprints and semantic pick targets remain shared. */
const LBSCityArt = (() => {
 const palette={hospital:'#cccec2',clinic:'#cccec2',school:'#cec7b5',mall:'#b9bcb2',commercial:'#acb7b9',residence:'#c7c3b6',government:'#c8c7ba',police:'#b4bec0',library:'#c1bcae',culture:'#beb8b0',hotel:'#c5bfb3',warehouse:'#a9b0a8',station:'#90adaa',generic:'#c5c3b7'};
 function hash(value){let n=2166136261;for(const c of String(value))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
 // Roads and their dressing use the same bounded segment, including long crossing ways.
 function clipSegment(a,b,limit=1695){
  const delta={east:b.east-a.east,north:b.north-a.north};let lo=0,hi=1;
  for(const key of['east','north']){const p=a[key],d=delta[key];if(Math.abs(d)<1e-8){if(Math.abs(p)>limit)return null;}else{const t1=(-limit-p)/d,t2=(limit-p)/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}}
  if(lo>=hi)return null;
  return[{east:a.east+delta.east*lo,north:a.north+delta.north*lo},{east:a.east+delta.east*hi,north:a.north+delta.north*hi}];
 }
 function drain(iterator){let step;do{step=iterator.next();}while(!step.done);return step.value;}
 function create(scene,local,helpers){return drain(createSteps(scene,local,helpers));}
 function* createSteps(scene,local,{part,collect,collectSteps,polygon,onLoad,root,onOwnedTexture}){
  root.dataset.cityArtVersion='3';root.dataset.cityTexture='loading';
  const extent=local.artExtent||1695;
  const detailCenter=local.detailCenter||{east:0,north:0},detailRadius=local.streamMap?local.detailRadius||1800:Infinity;
  function detailed(x,n,pad=0){return Math.hypot(x-detailCenter.east,n-detailCenter.north)<=detailRadius+pad;}
  function clipDetails(a,b){if(!local.streamMap)return[a,b];const clipped=clipSegment({east:a.east-detailCenter.east,north:a.north-detailCenter.north},{east:b.east-detailCenter.east,north:b.north-detailCenter.north},detailRadius);return clipped?.map(p=>({east:p.east+detailCenter.east,north:p.north+detailCenter.north}));}
  let textureState='loading';
  const texture=new THREE.TextureLoader().load(LBS_CITY_ASSETS.atlas,()=>{textureState='ready';root.dataset.cityTexture=textureState;onLoad(textureState);},undefined,()=>{textureState='fallback';root.dataset.cityTexture=textureState;onLoad(textureState);});
  onOwnedTexture?.(texture);
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  const cache=new Map(),counts={windows:0,balconies:0,facadeColumns:0,roofUnits:0,trees:0,vehicles:0,streetDetails:0,sidewalks:0,roadSegments:0,roadsideProps:0};
  function surface(color,tile=1,strength=tile===3?.32:.43){
   const key=color+':'+tile+':'+strength;if(cache.has(key))return cache.get(key);
   const m=new THREE.MeshStandardMaterial({color,roughness:tile===2?.84:.96,map:texture});
   const origin=tile===0?'vec2(0.01,0.51)':tile===1?'vec2(0.51,0.51)':tile===2?'vec2(0.01,0.01)':'vec2(0.51,0.01)';
   m.name='lbs-city-v3-'+tile;
   m.onBeforeCompile=shader=>{
    // Expand the r160 map include before replacing its atlas sample.
    const fragment=THREE.ShaderChunk.map_fragment.replace('vec4 sampledDiffuseColor = texture2D( map, vMapUv );','vec4 sampledDiffuseColor = texture2D( map, fract(vMapUv) * 0.48 + '+origin+' ); sampledDiffuseColor.rgb = mix(vec3(1.0),sampledDiffuseColor.rgb,'+strength.toFixed(2)+');');
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',fragment);
   };
   m.customProgramCacheKey=()=>tile+':'+strength;cache.set(key,m);return m;
  }
  function buildingMaterial(kind,roof,variant=0){
   if(roof)return surface(['#929d9a','#9da49b','#959e9b'][variant%3],3,.28);
   const tint=new THREE.Color(palette[kind]||palette.generic).multiplyScalar([.99,1.02,1.045][variant%3]);
   const base=surface('#'+tint.getHexString(),kind==='warehouse'?2:1,kind==='warehouse'?.28:.4);
   if(!local.streamMap)return base;
   const key='facade:'+kind+':'+variant;if(cache.has(key))return cache.get(key);
   // A window pattern on the existing wall replaces thousands of tiny meshes.
   // Each building supplies UVs anchored to its own fixed geographic center.
   // Replacing a map's local origin must not move its floors and windows.
   const facade=base.clone();facade.onBeforeCompile=shader=>{
    base.onBeforeCompile(shader);
    const varying='varying vec2 vLBSWallUV; varying vec3 vLBSWallNormal;\n';
    shader.vertexShader=varying+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLBSWallUV=uv*25.0; vLBSWallNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader=varying+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 lbsCell=vLBSWallUV/vec2(6.8,4.4);
      vec2 lbsUV=fract(lbsCell);
      float lbsWindow=step(.20,lbsUV.x)*step(lbsUV.x,.77)*step(.22,lbsUV.y)*step(lbsUV.y,.70)*(1.0-step(.5,abs(vLBSWallNormal.y)))*step(2.0,vLBSWallUV.y);
      float lbsShade=fract(sin(dot(floor(lbsCell/vec2(3.0,4.0)),vec2(12.9898,78.233)))*43758.5453);
      diffuseColor.rgb=mix(diffuseColor.rgb,mix(vec3(.13,.20,.24),vec3(.26,.34,.36),lbsShade),lbsWindow*.90);
    `);
   };facade.customProgramCacheKey=()=>base.customProgramCacheKey()+':stream-facade-v2';cache.set(key,facade);return facade;
  }
  function uv(geometry,scale=25){return drain(uvSteps(geometry,scale));}
  function* uvSteps(geometry,scale=25,anchor={east:0,north:0}){
   const p=geometry.attributes.position,n=geometry.attributes.normal,uvs=new Float32Array(p.count*2);
   for(let i=0;i<p.count;i++){if(i%256===0)yield 'geometry-uv';const vertical=Math.abs(n.getY(i))>.6;uvs[i*2]=(vertical||Math.abs(n.getZ(i))>.5?p.getX(i)-anchor.east:p.getZ(i)+anchor.north)/scale;uvs[i*2+1]=(vertical?p.getZ(i)+anchor.north:p.getY(i))/scale;}
   geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  }
  const shapes=[];
  for(const b of local.sourceBuildings){yield 'building-occupancy';if(b.underground)continue;for(const f of CoopLocalPlaces.footprints(b)){const points=[];for(let i=0;i<f.coordinates.length;i++){if(i%256===0)yield 'building-occupancy-points';points.push(local.geo.local(...f.coordinates[i]));}shapes.push({b,f,points});}}
  const occupancy=new Map(),cell=80;
  let indexUnits=0;
  for(const s of shapes){yield 'building-occupancy';const xs=s.points.map(p=>p.east),ns=s.points.map(p=>p.north);for(let x=Math.floor(Math.min(...xs)/cell);x<=Math.floor(Math.max(...xs)/cell);x++)for(let z=Math.floor(Math.min(...ns)/cell);z<=Math.floor(Math.max(...ns)/cell);z++){if(indexUnits++%128===0)yield 'building-occupancy-cells';const key=x+','+z;if(!occupancy.has(key))occupancy.set(key,[]);occupancy.get(key).push(s);}}
  const water=dataPolygons('water'),waterOccupancy=new Map(),waterFallback=[];
  // Keep the exact water/hole test, but only run it for polygons touching
  // this cell. Remote rings near the longitude wrap keep the full test.
  for(const f of water){yield 'water-occupancy';
   if(f.coordinates.some(c=>Math.abs(((c[0]-local.geo.center.lon+180)%360+360)%360-180)>=90)){waterFallback.push(f);continue;}
   const points=f.coordinates.map(c=>local.geo.local(...c)),xs=points.map(p=>p.east),ns=points.map(p=>p.north),epsilon=.00001;
   const lowX=Math.max(Math.floor(-extent/cell),Math.floor((Math.min(...xs)-epsilon)/cell)),highX=Math.min(Math.floor(extent/cell),Math.floor((Math.max(...xs)+epsilon)/cell)),lowN=Math.max(Math.floor(-extent/cell),Math.floor((Math.min(...ns)-epsilon)/cell)),highN=Math.min(Math.floor(extent/cell),Math.floor((Math.max(...ns)+epsilon)/cell));
   for(let x=lowX;x<=highX;x++)for(let n=lowN;n<=highN;n++){if(indexUnits++%128===0)yield 'water-occupancy-cells';const key=x+','+n;if(!waterOccupancy.has(key))waterOccupancy.set(key,[]);waterOccupancy.get(key).push(f);}
  }
  function dataPolygons(kind){return local.artFeatures.filter(f=>f.kind===kind&&f.coordinates.length>3);}
  function blocked(x,n){const key=Math.floor(x/cell)+','+Math.floor(n/cell),p=local.geo.coordinate(x,n),point=[p.lon,p.lat],inWater=f=>CoopLocalPlaces.inside(point,f.coordinates)&&!(f.holes||[]).some(h=>CoopLocalPlaces.inside(point,h));return(occupancy.get(key)||[]).some(s=>CoopLocalPlaces.inside(point,s.f.coordinates)&&!(s.f.holes||[]).some(h=>CoopLocalPlaces.inside(point,h)))||(waterOccupancy.get(key)||[]).some(inWater)||waterFallback.some(inWater);}
  function clearAt(x,n,padding=0){return Math.abs(x)+padding<extent-5&&Math.abs(n)+padding<extent-5&&(padding?[[0,0],[padding,0],[-padding,0],[0,padding],[0,-padding]].every(([dx,dn])=>!blocked(x+dx,n+dn)):!blocked(x,n));}
  function roofAnchor(shape,w,d){
   const center=CoopLocalPlaces.center(shape.coordinates),p=local.geo.local(center.lon,center.lat),points=shape.coordinates.map(c=>local.geo.local(...c));
   const candidates=[p,{east:(Math.min(...points.map(p=>p.east))+Math.max(...points.map(p=>p.east)))/2,north:(Math.min(...points.map(p=>p.north))+Math.max(...points.map(p=>p.north)))/2}];
   for(const q of candidates){if([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[0,0]].every(([dx,dn])=>{const c=local.geo.coordinate(q.east+dx,q.north+dn),point=[c.lon,c.lat];return CoopLocalPlaces.inside(point,shape.coordinates)&&!(shape.holes||[]).some(h=>CoopLocalPlaces.inside(point,h));}))return{x:q.east,z:-q.north};}
   return null;
  }
  function tree(x,n,seed,scale=1){
   if(!detailed(x,n))return;
   if(!clearAt(x,n,3.1*scale))return;
   const z=-n,h=(8+(seed%9)*.8)*scale,lean=((seed>>>4)%5-2)*.35*scale;
   part(x,h*.27,z,1.1*scale,h*.54,1.1*scale,'#645c4c','scenery');
   const tones=['#667450','#7d895a','#8d9766','#566749'],tone=seed%4;
   // Unequal, offset crown volumes make small groups rather than identical beads.
   part(x+lean,h*.73,z,6.2*scale,6.6*scale,5.8*scale,tones[tone],'scenery');
   part(x-2.1*scale,h*.63,z+1.5*scale,4.8*scale,4.6*scale,4.4*scale,tones[(tone+1)%4],'scenery');
   if(seed%3!==0)part(x+1.4*scale,h*.96,z-1.1*scale,4.1*scale,3.5*scale,4.2*scale,tones[(tone+2)%4],'scenery');
   counts.trees++;
  }
  function vehicle(x,n,angle,ux,un,seed){
   if(!clearAt(x,n,4))return;
   const z=-n,tint=['#827f70','#9b9a89','#748583','#806e5c'][seed%4],long=seed%13===0;
   part(x,1.5,z,long?10:6.8,1.8,3.1,tint,'scenery',angle);
   part(x-.45*ux,2.9,z+.45*un,long?7.4:3.7,1.5,2.7,'#455a60','scenery',angle);
   part(x-.45*ux,3.72,z+.45*un,long?7.7:3.9,.2,2.8,tint,'scenery',angle);
   for(const sign of[-1,1])part(x+ux*(long?3.2:2.1)*sign,.82,z-un*(long?3.2:2.1)*sign,1.15,1.35,3.4,'#383d3b','scenery',angle);
   counts.vehicles++;
  }
  function streetSurface(a,b,width){return drain(streetSurfaceSteps(a,b,width));}
  function* emitSurface(geometry,key){if(collectSteps)yield*collectSteps(geometry,key);else{collect(geometry,key);yield 'street-surfaces';}}
  function* streetSurfaceSteps(a,b,width){
   const clipped=clipDetails(a,b);if(!clipped)return;[a,b]=clipped;
   const dx=b.east-a.east,dn=b.north-a.north,length=Math.hypot(dx,dn),angle=Math.atan2(dx,-dn),nx=-dn/length,nn=dx/length;
   if(width<7)return;
   const pavement=new THREE.PlaneGeometry(width+6,length);pavement.rotateX(-Math.PI/2);pavement.rotateY(angle);pavement.translate((a.east+b.east)/2,.54,-(a.north+b.north)/2);yield*emitSurface(pavement,'pavement');
   for(const sign of[-1,1]){const curb=new THREE.PlaneGeometry(.65,length);curb.rotateX(-Math.PI/2);curb.rotateY(angle);curb.translate((a.east+b.east)/2+nx*(width/2+.5)*sign,.74,-((a.north+b.north)/2+nn*(width/2+.5)*sign));yield*emitSurface(curb,'curb');}
   counts.sidewalks++;
  }
  function dress(){return drain(dressSteps());}
  function* dressSteps(){
   for(const f of dataPolygons('park')){yield 'park-dressing';
    const p=f.coordinates.map(c=>local.geo.local(...c)),xs=p.map(q=>q.east),ns=p.map(q=>q.north);let index=0;
    for(let x=Math.max(-extent+15,Math.min(...xs),detailCenter.east-detailRadius);x<Math.min(extent-15,Math.max(...xs),detailCenter.east+detailRadius);x+=33)for(let n=Math.max(-extent+15,Math.min(...ns),detailCenter.north-detailRadius);n<Math.min(extent-15,Math.max(...ns),detailCenter.north+detailRadius);n+=33){yield 'park-dressing-points';const seed=hash(f.id+':'+index++);if(seed%8<2)continue;const east=x+(seed%19)-9,north=n+((seed>>>5)%19)-9,coord=local.geo.coordinate(east,north);if(CoopLocalPlaces.inside([coord.lon,coord.lat],f.coordinates)&&!(f.holes||[]).some(h=>CoopLocalPlaces.inside([coord.lon,coord.lat],h)))tree(east,north,seed,.9+(seed%5)*.09);}
   }
   for(const f of local.artFeatures.filter(f=>f.kind==='road'&&['primary','secondary','tertiary','residential'].includes(f.class)&&f.tags?.tunnel!=='yes'&&!(Number(f.tags?.layer)<0))){
    const roadWidth={primary:20,secondary:15,tertiary:10,residential:7}[f.class];
    for(let i=1;i<f.coordinates.length;i++){yield 'street-dressing';
     let clipped=clipSegment(local.geo.local(...f.coordinates[i-1]),local.geo.local(...f.coordinates[i]),extent-20);if(!clipped)continue;clipped=clipDetails(...clipped);if(!clipped)continue;
     const [a,b]=clipped,dx=b.east-a.east,dn=b.north-a.north,len=Math.hypot(dx,dn);if(len<8)continue;
     const ux=dx/len,un=dn/len,nx=-un,nn=ux,angle=Math.atan2(dn,dx),seed=hash(f.id+':'+i),midpoint={east:(a.east+b.east)/2,north:(a.north+b.north)/2};counts.roadSegments++;
     if(roadWidth>=10)for(let d=9;d<len-5;d+=19){yield 'road-markings';const x=a.east+ux*d,n=a.north+un*d;if(clearAt(x,n)){part(x,.79,-n,6,.12,.3,'#c1bfa9','scenery',angle);counts.streetDetails++;}}
     for(let d=17;d<len-5;d+=51){yield 'street-trees';const treeSeed=hash(f.id+':'+i+':'+Math.floor(d));for(const sign of[-1,1]){if((treeSeed+sign) % 5===0)continue;const shift=((treeSeed>>>4)%11)-5,x=a.east+ux*(d+shift)+nx*(roadWidth/2+4.5)*sign,n=a.north+un*(d+shift)+nn*(roadWidth/2+4.5)*sign;tree(x,n,treeSeed+sign,.78+(treeSeed%5)*.085);}}
     if(roadWidth>=10&&len>30){
      // Crossings stay at each original way segment's start, never across its center.
      if(seed%3!==0)for(let c=0;c<5;c++){yield 'crossing-markings';const x=a.east+ux*(7+c*1.75),n=a.north+un*(7+c*1.75);if(clearAt(x,n))part(x,.83,-n,1.05,.12,roadWidth*.78,'#c8c5b1','scenery',angle);}
      if(seed%5===0)vehicle(midpoint.east+nx*roadWidth*.27,midpoint.north+nn*roadWidth*.27,angle,ux,un,seed);
     }
     if(roadWidth>=15&&seed%4===0){const x=midpoint.east+nx*(roadWidth/2+2),n=midpoint.north+nn*(roadWidth/2+2);if(clearAt(x,n,1.5)){part(x,5.3,-n,.55,10.6,.55,'#606761','scenery');part(x+nx*1.1,10.5,-n-nn*1.1,2.7,.45,1,'#bbbda8','scenery',angle);counts.roadsideProps++;}}
     if(len>28&&seed%7===0){const x=midpoint.east-nx*(roadWidth/2+4.5),n=midpoint.north-nn*(roadWidth/2+4.5);if(clearAt(x,n,2.8)){part(x,1.15,-n,5,.35,1.6,'#746f5e','scenery',angle);part(x,1.9,-n,5,1.25,.35,'#8b8570','scenery',angle);for(const sign of[-1,1])part(x+ux*1.9*sign,.6,-n-un*1.9*sign,.4,1.2,1.5,'#515c56','scenery',angle);counts.roadsideProps++;}}
     if(len>35&&seed%11===0){const x=midpoint.east+nx*(roadWidth/2+2.8),n=midpoint.north+nn*(roadWidth/2+2.8);if(clearAt(x,n,2)){part(x,1.1,-n,3.8,1.4,1.2,'#a6a699','scenery',angle);part(x,1.85,-n,3.4,.2,1.2,'#9e825c','scenery',angle);counts.roadsideProps++;}}
    }
   }
   root.dataset.cityDressing=JSON.stringify(counts);
   root.dataset.cityArtMaterials=String(cache.size);
  }
  return{surface,buildingMaterial,uv,uvSteps,dress,dressSteps,streetSurface,streetSurfaceSteps,roofAnchor,clipSegment,hash,palette,counts,materials:cache,get textureState(){return textureState;},destroy(){texture.dispose();}};
 }
 return{create,createSteps,palette,hash,clipSegment};
})();
