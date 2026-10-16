// Each mapped building is one selection unit, shared by the 2D and 3D maps.
// This model preserves mapped coordinates, footprints and building uses.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./coop-local-places.js'));else root.CoopDistrictSelection=factory(root.CoopLocalPlaces);})(typeof globalThis!=='undefined'?globalThis:this,function(LocalPlaces){
 'use strict';
 const bounds=rings=>rings.flat().reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
 function area(rings){return rings.reduce((n,ring,i)=>{let a=0;const [x,y]=ring[0];for(let j=1;j<ring.length;j++)a+=(ring[j-1][0]-x)*(ring[j][1]-y)-(ring[j][0]-x)*(ring[j-1][1]-y);return n+(i?-1:1)*Math.abs(a)/2;},0);}
 function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),cross=(p[0]-a[0])*dy-(p[1]-a[1])*dx,dot=(p[0]-a[0])*dx+(p[1]-a[1])*dy;if(length>0&&Math.abs(cross)<=1e-6*length&&dot>=-1e-6&&dot<=length*length+1e-6)return{inside:true,edge:true};if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return{inside,edge:false};}
 function contains(rings,p){if(!p||!p.every(Number.isFinite)||!rings.length)return false;return inRing(p,rings[0]).inside&&!rings.slice(1).some(r=>inRing(p,r).inside);}
 function anchor(rings){const b=bounds(rings);for(const fraction of[.50001,.37,.63,.21,.79]){const y=b[1]+(b[3]-b[1])*fraction,xs=[];for(const r of rings)for(let i=1;i<r.length;i++){const a=r[i-1],c=r[i];if((a[1]>y)!==(c[1]>y))xs.push(a[0]+(c[0]-a[0])*(y-a[1])/(c[1]-a[1]));}xs.sort((a,b)=>a-b);let best=null;for(let i=0;i+1<xs.length;i+=2){const p=[(xs[i]+xs[i+1])/2,y];if(contains(rings,p)&&(!best||xs[i+1]-xs[i]>best.width))best={p,width:xs[i+1]-xs[i]};}if(best)return{east:best.p[0],north:best.p[1]};}return null;}
 function create(data,local){const iterator=createSteps(data,local);let step;do{step=iterator.next();}while(!step.done);return step.value;}
 function hash(value){let n=2166136261;for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619);return(n>>>0).toString(16);}

 function spatial(){
  const size=240,cells=new Map(),large=new Set();
  function visit(box,fn){const x0=Math.floor(box[0]/size),y0=Math.floor(box[1]/size),x1=Math.floor(box[2]/size),y1=Math.floor(box[3]/size);for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)fn(x+','+y);}
  function add(r){const b=r.bounds;if((Math.ceil((b[2]-b[0])/size)+1)*(Math.ceil((b[3]-b[1])/size)+1)>4096){large.add(r);return;}visit(b,key=>{if(!cells.has(key))cells.set(key,[]);cells.get(key).push(r);});}
  function near(box){const found=new Set(large);visit(box,key=>{for(const r of cells.get(key)||[])found.add(r);});return[...found].filter(r=>r.bounds[0]<=box[2]&&r.bounds[2]>=box[0]&&r.bounds[1]<=box[3]&&r.bounds[3]>=box[1]);}
  function at(p,filter='all'){return near([p.east,p.north,p.east,p.north]).filter(r=>LocalPlaces.matches(r,filter)&&contains(r.rings,[p.east,p.north])).sort((a,b)=>(b.height||0)-(a.height||0)||a.area-b.area||a.id.localeCompare(b.id))[0]||null;}
  return{add,near,at};
 }
 function* createSteps(data,local){
  const {geo}=local,regions=[],facilityLabels=new Map();
  // The same canonical bodies feed the renderer and selection, including
  // buildings retained while a source or loading window changes.
  for(const b of local.sourceBuildings||local.buildings){
   if(b.underground||b.hidden3D||b.incomplete||(b.coordinates?.length||0)<4)continue;
   const rings=[b.coordinates,...(b.holes||[])].map(ring=>ring.map(c=>{const p=geo.local(...c);return[p.east,p.north];})),point=anchor(rings);
   if(!point)continue;
   const identity=String(b.modelId||b.id),kind=b.kind||LocalPlaces.category(b.tags),label=LocalPlaces.types[kind]?.label||'建筑';
   const buildingIds=[...new Set([b.id,b.modelId,...(b.sourceIds||[]),...(b.modelAliases||[]).map(id=>id.slice(id.indexOf(':')+1))].filter(id=>id!=null).map(String))];
   const name=b.name||b.tags?.['addr:housename']||(b.facilityName?b.facilityName+' · ':'')+(b.tags?.['addr:street']||'')+(b.tags?.['addr:housenumber']||'')+label;
   const footprintArea=b.modelArea??area(rings)*Math.cos((b.lat??geo.center.lat)*Math.PI/180)/Math.cos(geo.center.lat*Math.PI/180);
   regions.push({id:'district-building-'+encodeURIComponent(identity),boundarySource:'building',source:b.source,name,kind,kinds:[kind],street:b.tags?.['addr:street']||'',rings,bounds:bounds(rings),...point,...geo.coordinate(point.east,point.north),area:Math.round(footprintArea),coordinates:b.coordinates,holes:b.holes||[],heightSource:b.heightSource,height:kind==='station'?Math.max((b.minHeight||0)+.1,Math.min(b.height,6)):b.height,minHeight:b.minHeight||0,buildingIds,buildingCount:1,placeIds:[]});
   if(!b.name&&b.facilityName){if(!facilityLabels.has(name))facilityLabels.set(name,[]);facilityLabels.get(name).push(regions.at(-1));}
   yield 'district-source-buildings';
  }
  for(const [name,buildings]of facilityLabels)if(buildings.length>1)buildings.sort((a,b)=>b.lat-a.lat||a.lon-b.lon||a.id.localeCompare(b.id)).forEach((b,i)=>{b.name=name+' · 建筑 '+(i+1);});
  regions.sort((a,b)=>a.id.localeCompare(b.id));
  return yield*restoreSteps(regions,local);
 }
 function restore(input,local){
  const steps=restoreSteps(input,local);let step;do{step=steps.next();}while(!step.done);return step.value;
 }
 function* projectSteps(input,geo){
  const regions=[];
  for(const r of input){
   const rings=[];
   for(const ring of[r.coordinates,...(r.holes||[])]){const points=[];for(let i=0;i<ring.length;i++){const p=geo.local(...ring[i]);points.push([p.east,p.north]);if(i%64===63)yield 'district-project-points';}rings.push(points);}
   regions.push({...r,rings,bounds:bounds(rings),...geo.local(r.lon,r.lat)});yield 'district-project-regions';
  }
  return regions;
 }
 function* restoreSteps(input,local){
  const regions=[],lookup=spatial(),owners=new Map();
  function link(id,r){id=String(id);if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(r);}
  for(const original of input){const r={...original,buildingIds:[...original.buildingIds],kinds:[...original.kinds],placeIds:[...original.placeIds]};regions.push(r);lookup.add(r);for(const id of r.buildingIds)link(id,r);yield 'district-region-links';}
  // A simplified/grouped view can refer to several genuine footprints. Link
  // aliases to their original owners without moving any district boundary.
  for(const b of local.buildings){const linked=new Set((b.sourceIds||[b.id]).flatMap(id=>[...(owners.get(String(id))||[])]));if(!linked.size){const r=lookup.at(b);if(r)linked.add(r);}for(const r of linked){if(!r.buildingIds.includes(String(b.id)))r.buildingIds.push(String(b.id));link(b.id,r);}yield 'district-building-links';}
  const byId=new Map(regions.map(r=>[r.id,r]));
  for(const p of local.places){const r=forPlace(p);if(r&&!r.placeIds.includes(String(p.id)))r.placeIds.push(String(p.id));yield 'district-place-links';}
  function at(p,filter='all'){if(!p||!Number.isFinite(p.east)||!Number.isFinite(p.north))return null;return lookup.at(p,filter);}
  function distanceToRegion(p,r){if(contains(r.rings,[p.east,p.north]))return 0;let best=Infinity;for(const ring of r.rings)for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],u=Math.max(0,Math.min(1,((p.east-a[0])*dx+(p.north-a[1])*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(p.east-a[0]-u*dx,p.north-a[1]-u*dy));}return best;}
  function forPlace(p){
   if(!p||!Number.isFinite(p.east)||!Number.isFinite(p.north))return null;
   if(p.districtId&&byId.has(p.districtId))return byId.get(p.districtId);if(byId.has(p.id))return byId.get(p.id);
   const related=[...new Set([p.modelId,...(p.buildingIds||[p.id])].filter(id=>id!=null).flatMap(id=>[...(owners.get(String(id))||[])]))],direct=at(p);
   if(direct&&(!related.length||related.includes(direct)))return direct;
   if(related.length)return related.sort((a,b)=>distanceToRegion(p,a)-distanceToRegion(p,b)||a.id.localeCompare(b.id))[0];
   return lookup.near([p.east-80,p.north-80,p.east+80,p.north+80]).map(r=>({r,distance:distanceToRegion(p,r)})).filter(e=>e.distance<=80).sort((a,b)=>a.distance-b.distance||a.r.id.localeCompare(b.r.id))[0]?.r||null;
  }
  // Intersect the building prisms directly. This keeps batched rendering fast
  // and makes a click on a roof or facade select the visible building.
  const maxHeight=regions.reduce((n,r)=>Math.max(n,(r.height||0)+1.3),1);
  function raycast(ray,filter='all',visibleIds=null){
   const o=ray.origin,d=ray.direction;if(!o||!d||Math.abs(d.y)<1e-9)return null;
   const low=Math.max(0,Math.min((1-o.y)/d.y,(maxHeight-o.y)/d.y)),high=Math.max((1-o.y)/d.y,(maxHeight-o.y)/d.y);if(high<0)return null;
   const ox=o.x,oy=-o.z,dx=d.x,dy=-d.z,box=[Math.min(ox+dx*low,ox+dx*high),Math.min(oy+dy*low,oy+dy*high),Math.max(ox+dx*low,ox+dx*high),Math.max(oy+dy*low,oy+dy*high)];
   let found=null,nearest=Infinity;
   for(const r of lookup.near(box)){
    if(!LocalPlaces.matches(r,filter)||visibleIds&&!r.buildingIds.some(id=>visibleIds.has(id)))continue;
    const top=(r.height||0)+1.3,bottom=(r.minHeight||0)+1,t=(top-o.y)/d.y;let distance=t>=0&&contains(r.rings,[ox+dx*t,oy+dy*t])?t:Infinity;
    for(const ring of r.rings)for(let i=1;i<ring.length;i++){
     const a=ring[i-1],b=ring[i],ex=b[0]-a[0],ey=b[1]-a[1],cross=dx*ey-dy*ex;if(Math.abs(cross)<1e-9)continue;
     const ax=a[0]-ox,ay=a[1]-oy,u=(ax*ey-ay*ex)/cross,v=(ax*dy-ay*dx)/cross,y=o.y+d.y*u;
     if(u>=0&&v>=0&&v<=1&&y>=bottom&&y<=top)distance=Math.min(distance,u);
    }
    if(distance<nearest){nearest=distance;found=r;}
   }
   return found;
  }
  return{regions,byId,at,forPlace,raycast,size:null,source:'mapped-building-footprints'};
 }

 return{create,createSteps,restore,restoreSteps,projectSteps,contains,anchor};
});
// Road-delimited blocks use sparse silhouettes; landmarks retain their mapped footprints.
function districtDrain(iterator){let step;do{step=iterator.next();}while(!step.done);return step.value;}
function createDistrictScene(data,localPlaces,onSelect,options={}){return districtDrain(buildDistrictScene(data,localPlaces,onSelect,{...options,staged:false}));}
async function createDistrictSceneAsync(data,localPlaces,onSelect,options={}){
 let cancelBuild=null;
 const iterator=buildDistrictScene(data,localPlaces,onSelect,{...options,__registerCancel:fn=>{cancelBuild=fn;}});
 const result=await LBSMapWork.runBuild(iterator,{signal:options.signal,budgetMs:options.streamMap?2:3,batchSize:1,canRun:options.canBuild,onPhase:options.onBuildPhase,onCancel:async error=>{error.sceneCleanupMetrics=await cancelBuild?.();}});
 result.value.buildMetrics=result.metrics;return result.value;
}
// Extend the live scene without replacing its camera, canvas or pointer capture.
// This inexpensive base mesh deliberately contains no buildings.
function* districtBaseGeometrySteps(geo,data){
 const positions=[],colors=[],palette={road:new THREE.Color('#505c59'),path:new THREE.Color('#a3aa94'),line:new THREE.Color('#aeb7a2'),park:new THREE.Color('#879c71'),water:new THREE.Color('#497e83'),pavement:new THREE.Color('#a9ad9c')};let roads=0,land=0;
 function vertex(x,y,z,color){positions.push(x,y,z);colors.push(color.r,color.g,color.b);}
 function strip(a,b,width,y,color){const dx=b.east-a.east,dz=a.north-b.north,length=Math.hypot(dx,dz);if(length<.2)return;const x=-dz/length*width/2,z=dx/length*width/2,ax=a.east,az=-a.north,bx=b.east,bz=-b.north;for(const p of[[ax+x,az+z],[bx+x,bz+z],[ax-x,az-z],[ax-x,az-z],[bx+x,bz+z],[bx-x,bz-z]])vertex(p[0],y,p[1],color);}
 for(const f of data.features){
  if(f.kind==='road'){
   if(f.tags?.tunnel==='yes'||Number(f.tags?.layer)<0)continue;
   const width=CoopCityBlocks.roadWidth(f),path=['footway','path','steps'].includes(f.class);let a;
   for(const c of f.coordinates){const b=geo.local(...c);if(a){if(width>=7)strip(a,b,width+5,.34,palette.pavement);strip(a,b,width,.36,path?palette.path:palette.road);if(width>=10)strip(a,b,.32,.38,palette.line);}a=b;yield 'base-road-segments';}roads++;
  }else if(['park','water'].includes(f.kind)&&f.coordinates.length>=4){
   const ring=coords=>coords.map(c=>{const p=geo.local(...c);return new THREE.Vector2(p.east,-p.north);}),outer=ring(f.coordinates),holes=(f.holes||[]).map(ring),triangles=THREE.ShapeUtils.triangulateShape(outer,holes),points=[...outer,...holes.flat()],color=palette[f.kind];
   for(const face of triangles){for(const i of face)vertex(points[i].x,f.kind==='water'?-.15:-.3,points[i].y,color);yield 'base-land-triangles';}land++;
  }yield 'base-features';
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));yield*districtSphere(geometry);return{geometry,roads,land};
}
// Generated arrays use the same r160 arithmetic/order, paused between bounded groups.
function* districtNormals(geometry){
 const index=geometry.index,position=geometry.getAttribute('position');if(!position)return;
 let normal=geometry.getAttribute('normal');if(!normal){normal=new THREE.BufferAttribute(new Float32Array(position.count*3),3);geometry.setAttribute('normal',normal);}else for(let i=0;i<normal.count;i++){if(i%256===0)yield 'geometry-normals-clear';normal.setXYZ(i,0,0,0);}
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),na=new THREE.Vector3(),nb=new THREE.Vector3(),nc=new THREE.Vector3(),cb=new THREE.Vector3(),ab=new THREE.Vector3();
 if(index)for(let i=0;i<index.count;i+=3){if(i%768===0)yield 'geometry-normals';const ia=index.getX(i),ib=index.getX(i+1),ic=index.getX(i+2);a.fromBufferAttribute(position,ia);b.fromBufferAttribute(position,ib);c.fromBufferAttribute(position,ic);cb.subVectors(c,b);ab.subVectors(a,b);cb.cross(ab);na.fromBufferAttribute(normal,ia);nb.fromBufferAttribute(normal,ib);nc.fromBufferAttribute(normal,ic);na.add(cb);nb.add(cb);nc.add(cb);normal.setXYZ(ia,na.x,na.y,na.z);normal.setXYZ(ib,nb.x,nb.y,nb.z);normal.setXYZ(ic,nc.x,nc.y,nc.z);}
 else for(let i=0;i<position.count;i+=3){if(i%768===0)yield 'geometry-normals';a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);cb.subVectors(c,b);ab.subVectors(a,b);cb.cross(ab);normal.setXYZ(i,cb.x,cb.y,cb.z);normal.setXYZ(i+1,cb.x,cb.y,cb.z);normal.setXYZ(i+2,cb.x,cb.y,cb.z);}
 for(let i=0;i<normal.count;i++){if(i%256===0)yield 'geometry-normals-normalize';na.fromBufferAttribute(normal,i);na.normalize();normal.setXYZ(i,na.x,na.y,na.z);}normal.needsUpdate=true;
}
function* districtSphere(geometry){
 if(!geometry.boundingSphere)geometry.boundingSphere=new THREE.Sphere();const position=geometry.attributes.position;
 if(!position)return;if(position.isGLBufferAttribute||Object.keys(geometry.morphAttributes).length){geometry.computeBoundingSphere();yield 'geometry-bounds';return;}
 const box=new THREE.Box3(),point=new THREE.Vector3();box.makeEmpty();
 for(let i=0;i<position.count;i++){if(i%512===0)yield 'geometry-bounds-box';point.fromBufferAttribute(position,i);box.expandByPoint(point);}box.getCenter(geometry.boundingSphere.center);
 let radiusSq=0;for(let i=0;i<position.count;i++){if(i%512===0)yield 'geometry-bounds-radius';point.fromBufferAttribute(position,i);radiusSq=Math.max(radiusSq,geometry.boundingSphere.center.distanceToSquared(point));}geometry.boundingSphere.radius=Math.sqrt(radiusSq);
}
function* districtInstanceSphere(mesh){
 if(!mesh.boundingSphere)mesh.boundingSphere=new THREE.Sphere();if(!mesh.geometry.boundingSphere)yield*districtSphere(mesh.geometry);mesh.boundingSphere.makeEmpty();const matrix=new THREE.Matrix4(),sphere=new THREE.Sphere();
 for(let i=0;i<mesh.count;i++){if(i%256===0)yield 'instance-bounds';mesh.getMatrixAt(i,matrix);sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(matrix);mesh.boundingSphere.union(sphere);}
}
function* districtNonIndexed(geometry,ownGeometry){
 if(!geometry.index)return geometry;const result=ownGeometry(new THREE.BufferGeometry()),indices=geometry.index.array;
 function* attribute(source){const output=new source.array.constructor(indices.length*source.itemSize);let cursor=0;for(let i=0;i<indices.length;i++){if(i%256===0)yield 'merge-expand-indices';let offset=source.isInterleavedBufferAttribute?indices[i]*source.data.stride+source.offset:indices[i]*source.itemSize;for(let j=0;j<source.itemSize;j++)output[cursor++]=source.array[offset++];}return new THREE.BufferAttribute(output,source.itemSize,source.normalized);}
 for(const key in geometry.attributes)result.setAttribute(key,yield*attribute(geometry.attributes[key]));
 for(const key in geometry.morphAttributes){const attributes=[];for(const a of geometry.morphAttributes[key])attributes.push(yield*attribute(a));result.morphAttributes[key]=attributes;}result.morphTargetsRelative=geometry.morphTargetsRelative;for(const g of geometry.groups)result.addGroup(g.start,g.count,g.materialIndex);return result;
}
const districtPolygonCache=new Map();let districtPolygonCacheBytes=0;
// One separate roof and linear wall strips avoid extruding a hidden bottom and
// triangulating a duplicate roof for every streamed building.
function districtWallGeometry(geo,coordinates,height,holes=[]){
 const rings=[coordinates,...holes].map(r=>r.map(c=>{const p=geo.local(...c);return[p.east,p.north];})),segments=rings.reduce((n,r)=>n+r.length-1,0),positions=new Float32Array(segments*18),normals=new Float32Array(segments*18);let cursor=0;
 for(const [index,ring]of rings.entries()){
  let area=0;for(let i=1;i<ring.length;i++)area+=(ring[i-1][0]-ring[0][0])*(ring[i][1]-ring[0][1])-(ring[i][0]-ring[0][0])*(ring[i-1][1]-ring[0][1]);
  const sign=(area>=0?1:-1)*(index?-1:1);
  for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dn=b[1]-a[1],length=Math.hypot(dx,dn);if(length<1e-7)continue;const p=[a[0],0,-a[1]],q=[b[0],0,-b[1]],r=[b[0],height,-b[1]],s=[a[0],height,-a[1]],vertices=sign>0?[p,q,r,p,r,s]:[p,r,q,p,s,r];for(const v of vertices){positions.set(v,cursor);normals.set([dn/length*sign,0,dx/length*sign],cursor);cursor+=3;}}
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions.subarray(0,cursor),3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals.subarray(0,cursor),3));return geometry;
}
function districtNearbyBuildings(buildings,geo,view){
 if(!view)return buildings;const center=geo.local(view.center.lon,view.center.lat),radius=view.radius+260;
 return buildings.filter(b=>!b.underground&&!b.hidden3D&&CoopLocalPlaces.footprints(b).some(f=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const c of f.coordinates){const p=geo.local(...c);minX=Math.min(minX,p.east);minY=Math.min(minY,p.north);maxX=Math.max(maxX,p.east);maxY=Math.max(maxY,p.north);}return Math.hypot(Math.max(minX-center.east,0,center.east-maxX),Math.max(minY-center.north,0,center.north-maxY))<=radius;}));
}
function districtCachedPolygon(geo,coordinates,height=0,holes=[],cache=true,wallsOnly=false){
 const key=cache?JSON.stringify([height,coordinates,holes,wallsOnly]):null,entry=cache&&districtPolygonCache.get(key);let geometry;
 if(entry){
  districtPolygonCache.delete(key);districtPolygonCache.set(key,entry);geometry=new THREE.BufferGeometry();
  for(const [name,attribute]of Object.entries(entry.attributes))geometry.setAttribute(name,new THREE.BufferAttribute(attribute.array.slice(),attribute.itemSize));
  if(entry.index)geometry.setIndex(new THREE.BufferAttribute(entry.index.slice(),1));
  const origin=geo.local(entry.center.lon,entry.center.lat),scale=Math.cos(geo.center.lat*Math.PI/180)/Math.cos(entry.center.lat*Math.PI/180);
  geometry.scale(scale,1,1);geometry.translate(origin.east,0,-origin.north);return{geometry,hit:true};
 }
 if(wallsOnly)geometry=districtWallGeometry(geo,coordinates,height,holes);
 else{const points=coordinates.map(c=>geo.local(...c)),shape=new THREE.Shape();shape.moveTo(points[0].east,points[0].north);for(const p of points.slice(1))shape.lineTo(p.east,p.north);
 for(const ring of holes){const path=new THREE.Path(),points=ring.map(c=>geo.local(...c));path.moveTo(points[0].east,points[0].north);for(const p of points.slice(1))path.lineTo(p.east,p.north);shape.holes.push(path);}
 geometry=height?new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false}):new THREE.ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);}
 if(cache){
  const attributes=Object.fromEntries(Object.entries(geometry.attributes).map(([name,a])=>[name,{array:a.array.slice(),itemSize:a.itemSize}])),index=geometry.index?.array.slice(),bytes=key.length*2+Object.values(attributes).reduce((n,a)=>n+a.array.byteLength,0)+(index?.byteLength||0);
  if(bytes<24*1024*1024){districtPolygonCache.set(key,{attributes,index,bytes,center:geo.center});districtPolygonCacheBytes+=bytes;while(districtPolygonCacheBytes>24*1024*1024||districtPolygonCache.size>6000){const [oldKey,old]=districtPolygonCache.entries().next().value;districtPolygonCache.delete(oldKey);districtPolygonCacheBytes-=old.bytes;}}
 }
 return{geometry,hit:false};
}
// A small live batch uses the same footprints, heights and facade materials as
// the prepared scene. Its WGS84 geometry is projected into the live scene's
// origin, so a newer data window cannot shift already displayed buildings.
function* districtBuildingChunkSteps(geo,buildings,art){
 const owned=new Set(),batches=new Map(),group=new THREE.Group();let complete=false;
 const own=g=>{owned.add(g);return g;};
 try{
  for(const b of buildings){
   if(b.underground||b.hidden3D)continue;
   const variant=art.hash(b.modelId||b.id)%3,anchor=geo.local(b.lon,b.lat);
   for(const shape of CoopLocalPlaces.footprints(b)){
    if(shape.coordinates.length<4)continue;
    const kind=shape.kind||b.kind,minHeight=shape.minHeight??b.minHeight??0,top=shape.height??b.height,height=kind==='station'?Math.max(minHeight+.1,Math.min(top,6)):top;
    for(const roof of[false,true]){
     yield 'live-building-shape';const g=own(districtCachedPolygon(geo,shape.coordinates,roof?0:height-minHeight+.3,shape.holes||[],true,!roof).geometry);g.translate(0,roof?height+1.3:minHeight+1,0);yield*art.uvSteps(g,25,anchor);
     const key=kind+':'+variant+':'+roof;if(!batches.has(key))batches.set(key,{kind,variant,roof,geometries:[]});batches.get(key).geometries.push(g);
    }
   }
  }
  for(const {kind,variant,roof,geometries}of batches.values()){
   const flat=[];let length=0;
   for(const g of geometries){const expanded=yield*districtNonIndexed(g,own);flat.push(expanded);length+=expanded.attributes.position.array.length;yield 'live-building-expand';}
   const p=new Float32Array(length),n=new Float32Array(length),uv=new Float32Array(length/3*2);let cursor=0;
   for(const g of flat){const positions=g.attributes.position.array,normals=g.attributes.normal.array,coords=g.attributes.uv.array;for(let i=0;i<positions.length;i+=1536){yield 'live-building-copy';const end=Math.min(i+1536,positions.length);p.set(positions.subarray(i,end),cursor+i);n.set(normals.subarray(i,end),cursor+i);uv.set(coords.subarray(i/3*2,end/3*2),(cursor+i)/3*2);}cursor+=positions.length;}
   const geometry=own(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.BufferAttribute(n,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));yield*districtSphere(geometry);
   const mesh=new THREE.Mesh(geometry,art.buildingMaterial(kind,roof,variant));mesh.userData.kind=kind;mesh.userData.kinds=[kind];mesh.castShadow=!roof;mesh.receiveShadow=true;group.add(mesh);
  }
  const kept=new Set(group.children.map(mesh=>mesh.geometry));for(const g of owned)if(!kept.has(g))g.dispose();complete=true;
  return{group,ids:buildings.map(b=>b.modelId||String(b.id)),pickIds:buildings.flatMap(b=>[String(b.id),b.modelId].filter(Boolean)),bytes:[...kept].reduce((n,g)=>n+Object.values(g.attributes).reduce((sum,a)=>sum+a.array.byteLength,0),0)};
 }finally{if(!complete)for(const g of owned)g.dispose();}
}
function* buildDistrictScene(data,localPlaces,onSelect,options={}){
 const canvas=options.canvas||document.getElementById('district-canvas'),container=options.container||document.getElementById('district-map');let root=options.root||document.getElementById(options.rootId||'coop-app');
 const staged=!!options.staged;let activated=false,deactivated=false,inputInstalled=false,observer=null,art=null,api=null,complete=false,firstPresentation=null,contentNotified=false,disposalPromise=null,liveBuildingJob=null;let clearInteractive=()=>{};const cancelledMetadata={},ownedGeometries=new Set(),ownedMaterials=new Set(),ownedTextures=new Set(),ownedInstances=new Set();
 const metadataRoot={get dataset(){return disposed?cancelledMetadata:root.dataset;}};
 const ownGeometry=g=>{ownedGeometries.add(g);return g;},ownMaterial=m=>{ownedMaterials.add(m);return m;};
 const {geo,places,types}=localPlaces,fastCity=options.streamMap&&options.detailedCity,sourceBuildings=options.detailedCity?(localPlaces.sourceBuildings||localPlaces.buildings):localPlaces.buildings,buildings=options.baseOnly?[]:fastCity?districtNearbyBuildings(sourceBuildings,geo,options.detailView):sourceBuildings,features=options.baseOnly||fastCity?[]:data.features,scene=new THREE.Scene();scene.background=new THREE.Color(options.detailedCity?'#858b82':'#101827');scene.fog=new THREE.FogExp2(options.detailedCity?'#959b91':'#111b2c',options.detailedCity?.000018:.00008);
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,fastCity?1.25:1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=options.detailedCity?1.05:1.15;
 scene.add(new THREE.HemisphereLight(options.detailedCity?0xd5dde0:options.warmLight?0xd2d6d0:0xa6bce1,options.detailedCity?0x616960:options.warmLight?0x454b48:0x192036,options.detailedCity?1.55:1.8));const sun=new THREE.DirectionalLight(options.detailedCity?0xfff1d8:options.warmLight?0xffead0:0xa7c6e3,options.detailedCity?2.65:2.1);sun.position.set(-800,1500,500);scene.add(sun);if(options.detailedCity)scene.add(new THREE.AmbientLight(0xcbd5d5,.3));
 if(options.detailedCity){renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;sun.castShadow=true;sun.shadow.mapSize.set(fastCity?1024:2048,fastCity?1024:2048);Object.assign(sun.shadow.camera,{left:-1900,right:1900,top:1900,bottom:-1900,near:1,far:5500});sun.shadow.bias=-.0002;sun.shadow.normalBias=1.2;}
 const camera=new THREE.OrthographicCamera(-1500,1500,1000,-1000,1,9000),target=new THREE.Vector3(options.detailedCity?40:0,0,options.detailedCity?150:0),offset=new THREE.Vector3(620,options.detailedCity?1400:1700,1600);
 let span=1850,framing=true,active=!staged,filter='all',selected=places[0],dirty=true,pointer=null,disposed=false,frame=0,lastFrame=0,viewChanged=false,lastViewNotice=0,viewInput=false,followTarget=null,followFrame=0;
 const mapExtent=options.streamMap?Math.max(1695,data.extentMeters||1450):1695;
 options.__registerCancel?.(()=>destroyAsync({replaceCanvas:false,preserveMetadata:true}));
 function deactivateOwned(){if(deactivated)return api;deactivated=true;active=false;liveBuildingJob?.controller.abort();cancelAnimationFrame(frame);observer?.disconnect();clearInteractive();return api;}
 function* disposeSteps({replaceCanvas=true,preserveMetadata=false}={}){
  if(disposed)return;deactivateOwned();disposed=true;if(art){art.destroy();ownedTextures.clear();}
  if(art)for(const m of art.materials.values()){ownedMaterials.add(m);yield 'dispose-material-index';}
  const stack=[scene];while(stack.length){const o=stack.pop();if(o.geometry)ownedGeometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])ownedMaterials.add(m);if(o.isInstancedMesh)ownedInstances.add(o);for(let i=o.children.length-1;i>=0;i--)stack.push(o.children[i]);yield 'dispose-scene-index';}
  for(const mesh of ownedInstances){mesh.dispose();yield 'dispose-instances';}sun.shadow.dispose();
  for(const g of ownedGeometries){g.dispose();yield 'dispose-geometries';}for(const m of ownedMaterials){m.dispose();yield 'dispose-materials';}for(const t of ownedTextures){t.dispose();yield 'dispose-textures';}
  renderer.dispose();if(activated&&replaceCanvas)canvas.replaceWith(canvas.cloneNode(false));if(!preserveMetadata&&(activated||staged))root.dataset.districtSceneReady='false';ownedGeometries.clear();ownedMaterials.clear();ownedTextures.clear();ownedInstances.clear();
 }
 function disposeOwned(settings){return districtDrain(disposeSteps(settings));}
 function destroyAsync(settings={}){if(disposalPromise)return disposalPromise;disposalPromise=LBSMapWork.runBuild(disposeSteps({replaceCanvas:false,preserveMetadata:true,...settings}),{budgetMs:4,onPhase:settings.onPhase}).then(result=>{if(api)api.disposeMetrics=result.metrics;return result.metrics;});return disposalPromise;}
 try{
 yield 'scene-setup';
 const visibleBuildingIds=new Set(buildings.flatMap(b=>[b.id,b.modelId].filter(id=>id!=null).map(String)));
 const batches=new Map(),batchKinds=new Map(),decorations=new Map(),footprints=new Map(),pickable=[],cube=ownGeometry(new THREE.BoxGeometry(1,1,1)),windowPlane=ownGeometry(new THREE.PlaneGeometry(1,1)),transform=new THREE.Object3D();
 const materials={};function material(kind){return materials[kind]||(materials[kind]=ownMaterial(new THREE.MeshStandardMaterial({color:LBSCityArt.palette[kind]||kind,roughness:.9})));}
 function collect(geometry,key,kinds){return districtDrain(collectSteps(geometry,key,kinds));}
 function* collectSteps(geometry,key,kinds,anchor){ownGeometry(geometry);if(kinds)batchKinds.set(key,kinds);if(!options.streamMap||!geometry.getAttribute('normal'))yield*districtNormals(geometry);if(art)yield*art.uvSteps(geometry,25,anchor);if(!batches.has(key))batches.set(key,[]);batches.get(key).push(geometry);}
 let polygonCacheHits=0,polygonCacheMisses=0;
 function polygon(coordinates,height=0,holes=[]){const result=districtCachedPolygon(geo,coordinates,height,holes,!!options.streamMap,!!(fastCity&&height));if(result.hit)polygonCacheHits++;else polygonCacheMisses++;return ownGeometry(result.geometry);}
 const detailCenter=options.detailView?geo.local(options.detailView.center.lon,options.detailView.center.lat):{east:0,north:0},detailRadius=fastCity?650:Math.max(900,Math.min(2600,(options.detailView?.radius||1500)+300));
 function part(x,y,z,w,h,d,tint,kind,angle=0){if(options.streamMap&&!types[kind.split('|')[0]]&&Math.hypot(x-detailCenter.east,-z-detailCenter.north)>detailRadius)return;if(options.detailedCity)kind=kind.replace(/\|v\d$/, '');if(!decorations.has(kind))decorations.set(kind,new Map());const colors=decorations.get(kind);const entry=options.detailedCity&&d===.28?tint+'|window':tint;if(!colors.has(entry))colors.set(entry,[]);transform.position.set(x,y,z);transform.rotation.set(0,angle,0);transform.scale.set(w,h,d);transform.updateMatrix();colors.get(entry).push(transform.matrix.clone());}
 if(options.detailedCity&&!options.baseOnly)art=yield*LBSCityArt.createSteps(scene,{...localPlaces,sourceBuildings:buildings,artFeatures:data.features,artExtent:mapExtent,streamMap:!!options.streamMap,detailCenter,detailRadius},{part,collect,collectSteps,polygon,root:metadataRoot,onOwnedTexture:t=>ownedTextures.add(t),onLoad:()=>{dirty=true;notifyContentReady();}});
 if(art&&!fastCity)for(const b of localPlaces.buildings.filter(b=>b.block)){yield 'block-plates';const plate=polygon(b.block.coordinates,0,b.block.holes);plate.translate(0,.5,0);yield*collectSteps(plate,'lot|v'+(art.hash(b.id)%3));}
 const groundGeometry=ownGeometry(new THREE.PlaneGeometry(Math.max(24000,mapExtent*3),Math.max(24000,mapExtent*3)));groundGeometry.rotateX(-Math.PI/2);if(art)yield*art.uvSteps(groundGeometry,85);const ground=new THREE.Mesh(groundGeometry,art?art.surface('#aaa99b',1,.32):material(options.detailedCity?'#aaa99b':'#253143'));ground.position.y=-1;ground.receiveShadow=!!art;scene.add(ground);
 const baseLayers=new Map(),basePending=new Map();let buildingsVisible=true;
 const baseKey=d=>[d.center.lat,d.center.lon,d.radiusMeters,d.features.length].join(':');
 function installBase(source,built){
  if(disposed){built.geometry.dispose();return;}const key=baseKey(source);if(baseLayers.has(key)){built.geometry.dispose();return;}
  const mesh=new THREE.Mesh(ownGeometry(built.geometry),ownMaterial(new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide})));scene.add(mesh);baseLayers.set(key,{mesh,source,roads:built.roads});
  while(baseLayers.size>6){const [oldKey,old]=baseLayers.entries().next().value;baseLayers.delete(oldKey);scene.remove(old.mesh);old.mesh.geometry.dispose();ownedGeometries.delete(old.mesh.geometry);old.mesh.material.dispose();ownedMaterials.delete(old.mesh.material);}
  root.dataset.mapBaseCoverage=JSON.stringify({center:source.center,extent:source.extentMeters||source.radiusMeters,roads:built.roads,buildings:0,layers:baseLayers.size,regions:[...baseLayers.values()].map(({source})=>({center:source.center,extent:source.extentMeters||source.radiusMeters}))});dirty=true;
 }
 function addBaseData(source){
  if(disposed||baseLayers.has(baseKey(source)))return Promise.resolve();const key=baseKey(source);if(basePending.has(key))return basePending.get(key);
  const job=LBSMapWork.runBuild(districtBaseGeometrySteps(geo,source),{budgetMs:2,batchSize:1}).then(result=>{installBase(source,result.value);if(activated)root.dataset.mapBaseTiming=JSON.stringify({ms:Math.round(result.metrics.totalWallMs),cpuMs:Math.round(result.metrics.cpuMs),roads:result.value.roads});}).finally(()=>basePending.delete(key));basePending.set(key,job);return job;
 }
 const liveModelIds=new Set(buildings.filter(b=>!b.hidden3D&&!b.underground).map(b=>b.modelId||String(b.id))),liveChunks=[],liveCoverage=[];let liveBytes=0,liveWindows=0;
 function releaseLiveChunk(chunk){scene.remove(chunk.group);for(const mesh of chunk.group.children){mesh.geometry.dispose();ownedGeometries.delete(mesh.geometry);}for(const id of chunk.ids)liveModelIds.delete(id);for(const id of chunk.pickIds)visibleBuildingIds.delete(id);liveBytes-=chunk.bytes;}
 function pruneLiveBuildings(){
  const view=getView(),point=geo.local(view.center.lon,view.center.lat);
  while(liveChunks.length>96||liveBytes>48*1024*1024){let index=-1,farthest=view.radius+500;for(let i=0;i<liveChunks.length;i++){const distance=Math.min(...liveChunks[i].group.children.map(mesh=>{const sphere=mesh.geometry.boundingSphere;return Math.hypot(sphere.center.x-point.east,sphere.center.z+point.north)-sphere.radius;}));if(distance>farthest){index=i;farthest=distance;}}if(index<0)break;releaseLiveChunk(liveChunks.splice(index,1)[0]);liveCoverage.length=0;}
 }
 function* liveBuildingSteps(nextLocal,view,signal){
  const candidates=[];let pending=null,added=0,covered=true;
  try{
   const currentView=getView(),point=geo.local(currentView.center.lon,currentView.center.lat);
   for(const b of nextLocal.sourceBuildings||nextLocal.buildings){if(!liveModelIds.has(b.modelId||String(b.id))&&districtNearbyBuildings([b],geo,view).length){const p=geo.local(b.lon,b.lat);candidates.push({b,distance:Math.hypot(p.east-point.east,p.north-point.north)});}yield 'live-building-select';}
   candidates.sort((a,b)=>a.distance-b.distance);
   // Present a small first group quickly, then amortize materials and uploads
   // across larger groups instead of producing dozens of tiny draw batches.
   for(let i=0;i<candidates.length;){
    // Include the 1600 m reserve plus the 600 m forward offset. Otherwise a
    // still-relevant forward batch is skipped and its window repeats forever.
    const current=getView(),selected=candidates.slice(i,i+(i===0?16:128)).map(entry=>entry.b);i+=selected.length;const batch=districtNearbyBuildings(selected,geo,{...current,radius:current.radius+2200});if(batch.length!==selected.length)covered=false;if(!batch.length)continue;
    pending=yield*districtBuildingChunkSteps(geo,batch,art);if(signal.aborted){const error=Error('Live map cancelled');error.name='AbortError';throw error;}
    const latest=getView();if(!districtNearbyBuildings(batch,geo,{...latest,radius:latest.radius+2200}).length){covered=false;for(const mesh of pending.group.children)mesh.geometry.dispose();pending=null;continue;}
    for(const mesh of pending.group.children){mesh.visible=buildingsVisible;ownedGeometries.add(mesh.geometry);if(filter!=='all'){mesh.material.transparent=true;mesh.material.opacity=CoopLocalPlaces.matches({kind:mesh.userData.kind},filter)?1:.2;}}
    scene.add(pending.group);for(const id of pending.ids)liveModelIds.add(id);for(const id of pending.pickIds)visibleBuildingIds.add(id);added+=pending.ids.length;liveBytes+=pending.bytes;liveChunks.push(pending);pending=null;renderer.shadowMap.needsUpdate=true;dirty=true;
    root.dataset.mapLiveBuildings=JSON.stringify({active:true,added,models:liveModelIds.size,chunks:liveChunks.length,bytes:liveBytes,windows:liveWindows,duringDrag:!!pointer?.moved});yield 'live-building-visible';
   }
   if(covered){liveCoverage.push(view);if(liveCoverage.length>6)liveCoverage.shift();}liveWindows++;pruneLiveBuildings();renderer.shadowMap.needsUpdate=true;dirty=true;if(covered)root.dataset.mapBuildingCoverage=JSON.stringify({center:view.center,radius:view.radius+260,refillReserve:420});
   root.dataset.mapLiveBuildings=JSON.stringify({active:false,added,models:liveModelIds.size,chunks:liveChunks.length,bytes:liveBytes,windows:liveWindows,duringDrag:!!pointer?.moved});return{added,models:liveModelIds.size};
  }finally{if(pending)for(const mesh of pending.group.children)mesh.geometry.dispose();}
 }
 function addBuildings(nextLocal,view,settings={}){
  if(disposed||!fastCity||!art)return Promise.resolve({added:0});if(liveBuildingJob)return liveBuildingJob.promise;
  const controller=new AbortController(),cancel=()=>controller.abort();settings.signal?.addEventListener('abort',cancel,{once:true});if(settings.signal?.aborted)controller.abort();
  const job={controller};liveBuildingJob=job;job.promise=LBSMapWork.runBuild(liveBuildingSteps(nextLocal,view,controller.signal),{signal:controller.signal,budgetMs:3,batchSize:1,onPhase:settings.onPhase}).then(result=>{root.dataset.mapLiveBuildingTiming=JSON.stringify({ms:Math.round(result.metrics.totalWallMs),cpuMs:Math.round(result.metrics.cpuMs),maxTaskMs:Math.round(result.metrics.maxContinuousMs),...result.value});return result.value;}).finally(()=>{settings.signal?.removeEventListener('abort',cancel);if(liveBuildingJob===job)liveBuildingJob=null;});return job.promise;
 }
 function buildingsCover(view){
  if(options.baseOnly)return false;if(!fastCity||!options.detailView)return true;
  const p=geo.local(view.center.lon,view.center.lat);return[options.detailView,...liveCoverage].some(region=>{const c=geo.local(region.center.lon,region.center.lat);return Math.hypot(p.east-c.east,p.north-c.north)+view.radius+420<=region.radius+260;});
 }
 if(options.baseOnly||fastCity)installBase(data,yield*districtBaseGeometrySteps(geo,data));
 for(const source of options.baseData||[])if(!baseLayers.has(baseKey(source)))installBase(source,yield*districtBaseGeometrySteps(geo,source));
 for(const f of features){yield 'land-surfaces';
  if(f.coordinates.length<3||!['park','water'].includes(f.kind))continue;const g=polygon(f.coordinates,0,f.holes);g.translate(0,f.kind==='water'?.1:.2,0);yield*collectSteps(g,f.kind==='water'?(art?'#49767d':'#133149'):(art?'#85916a':'#2c454d'));
 }
 // Campus boundaries are actual mapped areas, never randomly placed sports grounds.
 for(const p of localPlaces.allPlaces.filter(p=>['school','hospital'].includes(p.kind)&&p.coordinates.length>3)){yield 'campus-surfaces';const g=polygon(p.coordinates,0,p.holes);g.translate(0,.4,0);yield*collectSteps(g,art?'#afb0a1':p.kind==='school'?'#3b455c':'#3d5160');}
 for(const f of features.filter(f=>f.kind==='road')){yield 'roads';
  if(f.tags?.tunnel==='yes'||Number(f.tags?.layer)<0)continue;
  const width=CoopCityBlocks.roadWidth(f);
  for(let i=1;i<f.coordinates.length;i++){yield 'road-segments';const originalA=geo.local(...f.coordinates[i-1]),originalB=geo.local(...f.coordinates[i]),delta={east:originalB.east-originalA.east,north:originalB.north-originalA.north};let lo=0,hi=1,valid=true;for(const key of['east','north']){const p=originalA[key],d=delta[key];if(Math.abs(d)<1e-8){if(Math.abs(p)>mapExtent)valid=false;}else{const t1=(-mapExtent-p)/d,t2=(mapExtent-p)/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}}if(!valid||lo>=hi)continue;const a={east:originalA.east+delta.east*lo,north:originalA.north+delta.north*lo},b={east:originalA.east+delta.east*hi,north:originalA.north+delta.north*hi},length=Math.hypot(a.east-b.east,a.north-b.north);if(length<.3)continue;if(art)yield*art.streetSurfaceSteps(a,b,width);const g=ownGeometry(new THREE.PlaneGeometry(width,length));g.rotateX(-Math.PI/2);g.rotateY(Math.atan2(b.east-a.east,-b.north+a.north));g.translate((a.east+b.east)/2,.65,-(a.north+b.north)/2);yield*collectSteps(g,['footway','path','steps'].includes(f.class)?(art?'pavement':'#536582'):'#304158');}
 }
 for(const b of buildings){yield 'buildings';
  if(b.underground||b.hidden3D||b.coordinates.length<4)continue;
  if(b.block){const plate=polygon(b.block.coordinates,0,b.block.holes);plate.translate(0,.75,0);yield*collectSteps(plate,'#2c3c50');const pick=new THREE.Mesh(polygon(b.block.coordinates,0,b.block.holes),new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}));pick.position.y=.8;pick.userData.building=b;scene.add(pick);pickable.push(pick);}
  for(const shape of CoopLocalPlaces.footprints(b)){yield 'building-footprints';
 const modelKind=shape.kind||b.kind,variant=art?art.hash(b.modelId||b.id)%3:0,modelKey=(b.block?modelKind+'|'+b.kinds.slice().sort().join(','):modelKind)+(art?'|v'+variant:''),minHeight=shape.minHeight??b.minHeight??0,height=modelKind==='station'?Math.max(minHeight+.1,Math.min(shape.height??b.height,6)):shape.height??b.height,anchor=geo.local(b.lon,b.lat);
  const g=polygon(shape.coordinates,height-minHeight+(fastCity?.3:0),shape.holes);g.translate(0,minHeight+1,0);yield*collectSteps(g,modelKey,b.kinds||[b.kind],anchor);
  if(!options.districtSelection){const pick=new THREE.Mesh(g,new THREE.MeshBasicMaterial({visible:false}));pick.userData.building=art?(localPlaces.buildings.find(parent=>parent.id===b.id||(parent.sourceIds||[parent.id]).some(id=>(b.sourceIds||[b.id]).includes(id)))||b):b;scene.add(pick);pickable.push(pick);footprints.set(b.id,pick);}
  const roof=polygon(shape.coordinates,0,shape.holes);roof.translate(0,height+1.3,0);yield*collectSteps(roof,'roof-'+modelKey,b.kinds||[b.kind],anchor);
  // Windows follow footprint edges. They are facade details, not a replacement footprint.
  const coords=shape.coordinates.map(c=>geo.local(...c));let area=0;for(let i=1;i<coords.length;i++)area+=coords[i-1].east*coords[i].north-coords[i].east*coords[i-1].north;
  for(let edge=1;edge<coords.length;edge++){yield 'building-edges';
   const a=coords[edge-1],c=coords[edge],dx=c.east-a.east,dz=-c.north+a.north,length=Math.hypot(dx,dz);if(length<8)continue;const angle=Math.atan2(-dz,dx),bays=Math.min(art?20:b.block?4:8,Math.floor(length/(art?6.8:b.block?16:8))),floors=Math.min(art?36:b.block?3:10,Math.max(1,Math.floor(height/(art?4.4:5)))),normal=area>0?1:-1;
   if(!options.streamMap)for(let floor=0;floor<floors;floor++)for(let n=0;n<bays;n++){yield 'building-windows';
    // A quiet service strip and stable column groups break up the former micro-grid.
    if(art&&bays>8&&n%8===variant+2)continue;
    const u=(n+.5)/bays,x=a.east+dx*u,z=-a.north+dz*u,y=3+floor*(height-4)/floors,glassTower=art&&['commercial','mall'].includes(modelKind),wide=Math.min(art?(glassTower?5.7:3.7):4,length/bays*(art?(glassTower?.83:.59):.55)),tint=art?((floor*17+n*7+variant)%43===0?'#8e927d':['#344950','#455a62','#53666a'][(Math.floor(n/3)+Math.floor(floor/4)+variant)%3]):'#75a5bc';
    part(x-dz/length*normal*.28,y,z+dx/length*normal*.28,wide,Math.min(art?2.1:2.7,height*.2),.28,tint,modelKey,angle);
    if(art){art.counts.windows++;if(modelKind==='residence'&&floor%3===1&&(n+variant)%4===0){part(x-dz/length*normal*.7,y-1.15,z+dx/length*normal*.7,wide+.9,.28,1.35,'#afb3a6',modelKey,angle);art.counts.balconies++;}}
   }
   if(art){
    const x=(a.east+c.east)/2,z=-(a.north+c.north)/2;
    part(x-dz/length*normal*.12,1.35,z+dx/length*normal*.12,length,.8,.7,'#929b90',modelKey,angle);
    part(x-dz/length*normal*.12,height+1.7,z+dx/length*normal*.12,length,.8,.8,'#d0cec0',modelKey,angle);
    if(height>30&&length>22)for(let n=3;n<bays;n+=4){const u=n/bays;part(a.east+dx*u-dz/length*normal*.18,height*.5+.9,-a.north+dz*u+dx/length*normal*.18,.7,height-.8,.55,'#c5c5b8',modelKey,angle);art.counts.facadeColumns++;}
   }
  }
  yield 'building-roofs';
  const xs=coords.map(p=>p.east),zs=coords.map(p=>-p.north),w=Math.max(...xs)-Math.min(...xs),d=Math.max(...zs)-Math.min(...zs),x=shape.east??b.east,z=-(shape.north??b.north),y=height+2,unit=Math.min(w,d)*.27;
  if(art&&unit>2){
   const rw=Math.min(w*.24,11),rd=Math.min(d*.24,9),anchor=art.roofAnchor(shape,rw+1,rd+1);
   if(anchor){part(anchor.x,height+2.6,anchor.z,rw,2.6,rd,'#8d9995',modelKey);part(anchor.x,height+4,anchor.z,rw+.6,.35,rd+.6,'#bcc1b5',modelKey);art.counts.roofUnits++;
    const vent=art.roofAnchor(shape,Math.min(w*.6,21),Math.min(d*.5,15));if(vent&&unit>4){const vx=vent.x+Math.min(w*.2,7),vz=vent.z+Math.min(d*.12,4);part(vx,height+2.25,vz,3.1,1.6,3.1,'#65787b',modelKey);part(vx,height+3.1,vz,3.35,.2,3.35,'#a7b4b0',modelKey);art.counts.roofUnits++;}
   }
  }
  if(unit>2&&modelKind==='hospital'){part(x,y,z,unit*1.35,1.6,unit*1.35,'#a35d50',modelKind);part(x,y+1,z,unit,.9,unit*.25,'#f4e6d2',modelKind);part(x,y+1,z,unit*.25,.9,unit,'#f4e6d2',modelKind);}
  else if(unit>2&&modelKind==='school'){part(x,y,z,unit*1.6,1.4,unit*.75,'#d2bb81',modelKind);part(x,y+.9,z,unit*.9,.3,unit*.45,'#5b7364',modelKind);}
  else if(unit>2&&modelKind==='mall'){part(x,y,z,unit*1.7,2.5,unit,'#3e696b',modelKind);part(x,y+1.5,z,unit*1.3,.3,unit*.7,'#f2d19e',modelKind);}
  else if(modelKind==='station'){part(x,y,z,Math.min(10,w),.8,Math.min(8,d),'#79b8b8',modelKind);}
  if(['hospital','school','mall'].includes(modelKind)&&unit>3){const a=coords[0],c=coords[1],dx=c.east-a.east,dz=-c.north+a.north,length=Math.hypot(dx,dz);if(length>8){const sign=area>0?1:-1;part((a.east+c.east)/2-dz/length*sign*1.6,3,-(a.north+c.north)/2+dx/length*sign*1.6,Math.min(10,length*.45),.7,3.4,types[modelKind].color,modelKind,Math.atan2(-dz,dx));}}
  }
 }
 if(art)yield*art.dressSteps();
 // Static geometry is merged by material; hundreds of real buildings stay inexpensive to draw.
 for(const [key,geometries]of batches){
  yield 'merge-batches';const flat=[];let length=0;for(const g of geometries){const expanded=g.index?yield*districtNonIndexed(g,ownGeometry):g;flat.push(expanded);length+=expanded.attributes.position.array.length;yield 'merge-flatten';}const positions=new Float32Array(length),normals=new Float32Array(length),uvs=art?new Float32Array(length/3*2):null;let cursor=0;
  for(const g of flat){const p=g.attributes.position.array,n=g.attributes.normal.array,u=g.attributes.uv?.array;for(let offset=0;offset<p.length;offset+=3072){yield 'merge-copy';const end=Math.min(p.length,offset+3072);positions.set(p.subarray(offset,end),cursor+offset);normals.set(n.subarray(offset,end),cursor+offset);if(uvs)uvs.set(u.subarray(offset/3*2,end/3*2),(cursor+offset)/3*2);}cursor+=p.length;}
  const merged=ownGeometry(new THREE.BufferGeometry());merged.setAttribute('position',new THREE.BufferAttribute(positions,3));merged.setAttribute('normal',new THREE.BufferAttribute(normals,3));yield*districtSphere(merged);
  if(uvs)merged.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  const isRoof=key.startsWith('roof-'),kind=(isRoof?key.slice(5):key).split('|')[0],variant=Number(key.match(/\|v(\d)/)?.[1]||0),tint=isRoof?new THREE.Color(LBSCityArt.palette[kind]||'#708296').multiplyScalar(1.03):null,m=new THREE.Mesh(merged,art&&types[kind]?art.buildingMaterial(kind,isRoof,variant):art&&kind==='lot'?art.surface(['#b7b6a7','#afb2a3','#c1bfb1'][variant%3],1,.27):art&&kind==='#304158'?art.surface('#485353',3,.35):art&&kind==='pavement'?art.surface('#b6b7a7',1,.23):art&&kind==='curb'?material('#cecfc0'):isRoof?new THREE.MeshStandardMaterial({color:tint,roughness:1}):material(kind));m.userData.kind=types[kind]?kind:null;m.userData.kinds=batchKinds.get(key)||[kind];m.castShadow=!!art&&!!types[kind];m.receiveShadow=!!art;scene.add(m);
  for(let i=0;i<geometries.length;i++){if(i%128===0)yield 'merge-dispose';geometries[i].dispose();ownedGeometries.delete(geometries[i]);if(flat[i]!==geometries[i]){flat[i].dispose();ownedGeometries.delete(flat[i]);}}
 }
 for(const [kind,colors]of decorations)for(const [tint,matrices]of colors){const glass=tint.endsWith('|window'),instanceMaterial=ownMaterial(material(tint.split('|')[0]).clone());if(glass)instanceMaterial.side=THREE.DoubleSide;const m=new THREE.InstancedMesh(glass?windowPlane:cube,instanceMaterial,matrices.length);ownedInstances.add(m);for(let i=0;i<matrices.length;i++){if(i%256===0)yield 'instance-matrices';m.setMatrixAt(i,matrices[i]);}yield*districtInstanceSphere(m);m.userData.kind=types[kind.split('|')[0]]?kind.split('|')[0]:null;m.userData.kinds=kind.includes('|')&&!kind.split('|')[1].startsWith('v')?kind.split('|')[1].split(','):[m.userData.kind];m.castShadow=!!art&&!glass;m.receiveShadow=!!art;scene.add(m);}
 if(art)root.dataset.cityArtMaterials=String(art.materials.size);
 if(options.streamMap)root.dataset.mapGeometryCache=JSON.stringify({hits:polygonCacheHits,misses:polygonCacheMisses,bytes:districtPolygonCacheBytes});
 if(options.streamMap){const center=options.displayView?geo.local(options.displayView.center.lon,options.displayView.center.lat):detailCenter;root.dataset.mapBuildingIdentity=JSON.stringify(localPlaces.buildingIdentity||{});root.dataset.mapBuildingModels=JSON.stringify(buildings.filter(b=>!b.hidden3D&&!b.underground).slice().sort((a,b)=>Math.hypot(a.east-center.east,a.north-center.north)-Math.hypot(b.east-center.east,b.north-center.north)).slice(0,48).map(b=>({id:b.modelId||String(b.id),shape:b.shapeKey||String(b.id),lon:b.lon,lat:b.lat,kind:b.kind,height:b.height,minHeight:b.minHeight||0,variant:art?art.hash(b.modelId||b.id)%3:0})));}
 if(art)root.dataset.cityGeometry=JSON.stringify({version:3,mergedBatches:batches.size,instanceBatches:[...decorations.values()].reduce((n,colors)=>n+colors.size,0),instances:[...decorations.values()].reduce((n,colors)=>n+[...colors.values()].reduce((sum,list)=>sum+list.length,0),0),...art.counts});
 const selection=new THREE.Group();scene.add(selection);
 const districtBoundaries=new THREE.Group();scene.add(districtBoundaries);
 const districtStyled=typeof options.districtStyle==='function',districtVisuals=new Map();
 const selectionHeight=r=>options.baseOnly||!buildingsVisible?0:r.height||0;
 const districtBoundaryMaterial=options.districtSelection&&!districtStyled?ownMaterial(new THREE.LineBasicMaterial({color:0xffedce,transparent:true,opacity:.42,depthTest:false,depthWrite:false})):null;
 const districtBoundaryEntries=[];
 if(options.districtSelection){if(!(options.streamMap&&districtStyled))for(const r of options.districtSelection.regions){
  let visual=null,boundaryMaterial=districtBoundaryMaterial;
  if(districtStyled){yield 'district-region-fills';const geometry=polygon(r.coordinates,0,r.holes);yield*districtSphere(geometry);const fill=new THREE.Mesh(geometry,ownMaterial(new THREE.MeshBasicMaterial({transparent:true,opacity:.1,side:THREE.DoubleSide,depthTest:false,depthWrite:false})));fill.userData.districtFill=r.id;fill.renderOrder=1;districtBoundaries.add(fill);boundaryMaterial=ownMaterial(new THREE.LineBasicMaterial({transparent:true,opacity:.42,depthTest:false,depthWrite:false}));visual={region:r,fill,lines:[]};districtVisuals.set(r.id,visual);}
  for(const ring of r.rings){yield 'district-boundaries';const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring.map(([x,y])=>new THREE.Vector3(x,0,-y))),boundaryMaterial);line.position.y=selectionHeight(r)+1.8;line.renderOrder=2;districtBoundaries.add(line);districtBoundaryEntries.push({line,region:r});if(visual){line.userData.districtBoundary=r.id;visual.lines.push(line);}}
 }root.dataset.districtSelection=String(options.districtSelection.regions.length);}
 function updateDistrictStyles(){
  if(!districtStyled)return;const selectedRegion=options.districtSelection?.forPlace(selected);
  if(options.streamMap&&(!selectedRegion||!districtVisuals.has(selectedRegion.id))){
   for(const visual of districtVisuals.values())for(const mesh of [visual.fill,...visual.lines]){districtBoundaries.remove(mesh);mesh.geometry.dispose();ownedGeometries.delete(mesh.geometry);mesh.material.dispose();ownedMaterials.delete(mesh.material);}districtVisuals.clear();
   if(selectedRegion){const r=selectedRegion,geometry=polygon(r.coordinates,0,r.holes);const fill=new THREE.Mesh(geometry,ownMaterial(new THREE.MeshBasicMaterial({transparent:true,opacity:.3,side:THREE.DoubleSide,depthTest:false,depthWrite:false})));districtBoundaries.add(fill);const lines=r.rings.map(ring=>{const line=new THREE.Line(ownGeometry(new THREE.BufferGeometry().setFromPoints(ring.map(([x,y])=>new THREE.Vector3(x,0,-y)))),ownMaterial(new THREE.LineBasicMaterial({transparent:true,opacity:1,depthTest:false,depthWrite:false})));districtBoundaries.add(line);return line;});districtVisuals.set(r.id,{region:r,fill,lines});}
  }
  for(const visual of districtVisuals.values()){const r=visual.region,style=options.districtStyle(r)||{},visible=CoopLocalPlaces.matches(r,filter),chosen=visible&&selectedRegion?.id===r.id,color=chosen?(style.selectedColor||'#ff9f1c'):(style.color||'#ffedce'),opacity=chosen?(style.selectedOpacity??.3):(style.fillOpacity??.1);
   visual.fill.visible=visible;visual.fill.position.y=selectionHeight(r)+1.6;visual.fill.material.color.set(color);visual.fill.material.opacity=opacity;visual.fill.renderOrder=chosen?3:1;
   for(const line of visual.lines){line.visible=visible;line.position.y=selectionHeight(r)+1.8;line.material.color.set(chosen?(style.selectedStrokeColor||'#c65300'):color);line.material.opacity=chosen?1:.42;line.renderOrder=chosen?7:2;}
  }
 }
 // Optional device position on the map.
 const playerPosition=new THREE.Group();playerPosition.visible=false;scene.add(playerPosition);
 if(options.positionMarker){
  const disc=new THREE.Mesh(new THREE.CircleGeometry(80,48),new THREE.MeshBasicMaterial({color:0x48a5e7,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}));disc.rotation.x=-Math.PI/2;disc.position.y=3;if(art){disc.material.depthTest=false;disc.renderOrder=4;disc.material.opacity=.18;}playerPosition.add(disc);
  const ring=new THREE.Mesh(new THREE.RingGeometry(78,80,48),new THREE.MeshBasicMaterial({color:0x66bde9,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=3.2;if(art){ring.material.depthTest=false;ring.renderOrder=5;}playerPosition.add(ring);
  const pin=new THREE.Mesh(new THREE.ConeGeometry(10,32,5),new THREE.MeshStandardMaterial({color:0x9edbff,emissive:0x236fb0,emissiveIntensity:.8}));pin.position.y=20;pin.rotation.z=Math.PI;playerPosition.add(pin);
 }
 let highlightedDistrict;
 function highlight(){
  if(districtStyled&&options.districtSelection){updateDistrictStyles();labelsDirty=true;dirty=true;return;}
  if(options.districtSelection){const region=options.districtSelection.forPlace(selected);if(region===highlightedDistrict){selection.visible=!!region&&CoopLocalPlaces.matches(region,filter);labelsDirty=true;dirty=true;return;}}
  return districtDrain(highlightSteps());
 }
 function* highlightSteps(){
  if(districtStyled&&options.districtSelection){updateDistrictStyles();labelsDirty=true;dirty=true;return;}
  while(selection.children.length){const child=selection.children[0];child.geometry.dispose();ownedGeometries.delete(child.geometry);child.material.dispose();selection.remove(child);}
  if(!selected){highlightedDistrict=undefined;return;}
  if(options.districtSelection){const region=options.districtSelection.forPlace(selected);highlightedDistrict=region;selection.visible=!!region&&CoopLocalPlaces.matches(region,filter);if(region){const g=polygon(region.coordinates,0,region.holes);g.translate(0,selectionHeight(region)+1.6,0);const fill=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xff9f1c,transparent:true,opacity:.3,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));fill.renderOrder=3;selection.add(fill);for(const ring of region.rings){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring.map(([x,y])=>new THREE.Vector3(x,selectionHeight(region)+1.8,-y))),new THREE.LineBasicMaterial({color:0xc65300,depthTest:false,depthWrite:false}));line.renderOrder=7;selection.add(line);}}labelsDirty=true;dirty=true;return;}
  const ids=selected.buildingIds||[selected.id];
  const selectedSources=new Set(ids.flatMap(id=>{const parent=localPlaces.buildings.find(b=>b.id===id);return parent?.sourceIds||[id];}));
  const highlighted=art?buildings.filter(b=>(b.sourceIds||[b.id]).some(id=>selectedSources.has(id))):buildings.filter(b=>ids.includes(b.id));
  for(const b of highlighted){yield 'selection-highlights';if(b.underground)continue;if(b.block){const g=polygon(b.block.coordinates,0,b.block.holes);g.translate(0,1.1,0);selection.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:types[selected.kind]?.color||'#f0b563',transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false})));}for(const shape of CoopLocalPlaces.footprints(b)){const g=polygon(shape.coordinates,0,shape.holes),kind=shape.kind||b.kind,height=shape.height??b.height;g.translate(0,(kind==='station'?Math.min(height,6):height)+2,0);selection.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:types[selected.kind]?.color||'#f0b563',transparent:true,opacity:art?.16:.45,side:THREE.DoubleSide,depthWrite:false})));}}
  const marker=new THREE.Mesh(new THREE.RingGeometry(art?25:22,art?29:26,40),new THREE.MeshBasicMaterial({color:types[selected.kind]?.color||'#f0b563',side:THREE.DoubleSide}));marker.rotation.x=-Math.PI/2;marker.position.set(selected.east,2.5,-selected.north);selection.add(marker);if(art){const beacon=new THREE.Mesh(new THREE.ConeGeometry(10,26,4),new THREE.MeshStandardMaterial({color:0xffad59,emissive:0xa95312,emissiveIntensity:.7}));beacon.position.set(selected.east,23,-selected.north);beacon.rotation.z=Math.PI;selection.add(beacon);const glow=new THREE.Mesh(new THREE.CircleGeometry(43,32),new THREE.MeshBasicMaterial({color:0xffae55,transparent:true,opacity:.15,depthWrite:false}));glow.rotation.x=-Math.PI/2;glow.position.set(selected.east,2.2,-selected.north);selection.add(glow);}labelsDirty=true;dirty=true;
 }
 // Cache marker nodes and reuse their vectors; layout changes are applied once per frame.
 const projectedPlaces=options.mapLabelCandidates?[]:options.districtSelection?options.districtSelection.regions:places;
 let markerEntries=[];let playerEntry=null;
 function bindMarkers(){markerEntries=(options.mapLabelCandidates?[]:projectedPlaces).map(p=>({node:document.querySelector('[data-place-marker="'+p.id+'"]'),position:new THREE.Vector3(p.east,45,-p.north),place:p,limit:1.05}));
playerEntry=options.positionMarker?{node:document.getElementById(options.positionMarker),position:new THREE.Vector3(),limit:1,live:true}:null;if(playerEntry)markerEntries.push(playerEntry);}
 if(!staged)bindMarkers();
 const projected=new THREE.Vector3();let width=0,height=0,cameraDirty=true,projectionDirty=true,labelsDirty=true,pendingPan=null,labelLeaders=null;
 // LBS-TASK-011. Insert next to the cached projection vector, inside createDistrictScene.
 const labelRayA=new THREE.Vector3(),labelRayB=new THREE.Vector3();
 function labelWorldBounds(){
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(const [x,y]of[[-1,-1],[1,-1],[1,1],[-1,1]]){
   labelRayA.set(x,y,-1).unproject(camera);labelRayB.set(x,y,1).unproject(camera).sub(labelRayA);
   const t=(45-labelRayA.y)/labelRayB.y,east=labelRayA.x+labelRayB.x*t,north=-(labelRayA.z+labelRayB.z*t);
   bounds[0]=Math.min(bounds[0],east);bounds[1]=Math.min(bounds[1],north);bounds[2]=Math.max(bounds[2],east);bounds[3]=Math.max(bounds[3],north);
  }
  return bounds;
 }
 function clearLabelOffsets(){if(labelLeaders)labelLeaders.style.display='none';for(const entry of markerEntries)if(entry.node){delete entry.node.dataset.labelDisplaced;delete entry.node.dataset.labelOffset;}}
 function protectCompactLabels(candidates){
  const mapRect=canvas.getBoundingClientRect(),stage=container.closest('.map-stage'),gap=4,occupied=[];
  if(!stage)return;
  const rectOf=node=>{const r=node.getBoundingClientRect();return{left:r.left-mapRect.left,top:r.top-mapRect.top,right:r.right-mapRect.left,bottom:r.bottom-mapRect.top};};
  const intersects=(a,b)=>a.left<b.right+gap&&a.right>b.left-gap&&a.top<b.bottom+gap&&a.bottom>b.top-gap;
  // Use only occupied controls, rather than reserving the transparent map-top box.
  const labelSurface=stage.closest('#lbs-app')||stage;
  for(const node of labelSurface.querySelectorAll('.map-tools button,.map-filter,.map-panel,.map-hint,.location-card,.map-bottom,.map-compass,.map-scale,.map-status,.topbar' )){
   const r=rectOf(node);if(r.right>r.left&&r.bottom>r.top&&r.right>0&&r.left<width&&r.bottom>0&&r.top<height)occupied.push(r);
  }
  const controls=occupied.length,priority=candidates.find(c=>c.place.id===selected?.id||c.node.classList.contains('selected'));
  const entries=[...(playerEntry&&!playerEntry.node.hidden?[{...playerEntry,x:Number.parseFloat(playerEntry.node.style.left),y:Number.parseFloat(playerEntry.node.style.top),priority:true}]:[]),...(priority?[{...priority,priority:true}]:[]),...candidates.filter(c=>c!==priority)];
  const lines=[];let hidden=0,displaced=0;
  for(const entry of entries){
   const {node,x,y}=entry;if(node.hidden)continue;
   node.dataset.worldAnchor=x.toFixed(2)+','+y.toFixed(2);
   // Include the player's caption, which extends beyond its small icon box.
   let body=rectOf(node);if(entry.live)for(const child of node.querySelectorAll('span')){const r=rectOf(child);body={left:Math.min(body.left,r.left),top:Math.min(body.top,r.top),right:Math.max(body.right,r.right),bottom:Math.max(body.bottom,r.bottom)};}
   const extent={left:body.left-x,top:body.top-y,right:body.right-x,bottom:body.bottom-y},minX=gap-extent.left,maxX=width-gap-extent.right,minY=gap-extent.top,maxY=height-gap-extent.bottom;
   if(minX>maxX||minY>maxY){if(!entry.priority){node.hidden=true;hidden++;}continue;}
   const clampX=p=>THREE.MathUtils.clamp(p,minX,maxX),clampY=p=>THREE.MathUtils.clamp(p,minY,maxY),xs=new Set([clampX(x)]),ys=new Set([clampY(y)]);
   if(entry.priority&&!entry.live){xs.add(clampX(x-8-extent.right));xs.add(clampX(x+8-extent.left));ys.add(clampY(y-8-extent.bottom));ys.add(clampY(y+8-extent.top));}
   for(const r of occupied){xs.add(clampX(r.left-gap-extent.right));xs.add(clampX(r.right+gap-extent.left));ys.add(clampY(r.top-gap-extent.bottom));ys.add(clampY(r.bottom+gap-extent.top));}
   let best=null;const shiftLimit=entry.priority?Math.min(150,width*.42):24;
   for(const px of xs)for(const py of ys){
    const dx=px-x,dy=py-y;if(Math.abs(dx)>shiftLimit||Math.abs(dy)>(entry.priority?height*.45:24))continue;
    const box={left:px+extent.left,top:py+extent.top,right:px+extent.right,bottom:py+extent.bottom};if(occupied.some(r=>intersects(box,r)))continue;
    // A shifted building label keeps its original map anchor visible.
    if(entry.priority&&!entry.live&&Math.hypot(dx,dy)>2&&Math.hypot(x-THREE.MathUtils.clamp(x,box.left,box.right),y-THREE.MathUtils.clamp(y,box.top,box.bottom))<7.9)continue;
    const score=dx*dx+dy*dy;if(!best||score<best.score)best={px,py,dx,dy,box,score};
   }
   if(!best){if(!entry.priority){node.hidden=true;hidden++;}continue;}
   node.style.left=best.px+'px';node.style.top=best.py+'px';occupied.push(best.box);
   if(Math.hypot(best.dx,best.dy)>2){
    node.dataset.labelDisplaced='true';node.dataset.labelOffset=best.dx.toFixed(2)+','+best.dy.toFixed(2);displaced++;
    const endX=THREE.MathUtils.clamp(x,best.box.left,best.box.right),endY=THREE.MathUtils.clamp(y,best.box.top,best.box.bottom);
    if(Math.hypot(endX-x,endY-y)>2)lines.push({x,y,endX,endY,color:entry.live?'#78c9f2':entry.priority?'#ffad62':'#d4d5be'});
   }
  }
  if(!labelLeaders){labelLeaders=document.createElementNS('http://www.w3.org/2000/svg','svg');labelLeaders.setAttribute('aria-hidden','true');labelLeaders.dataset.mapLabelLeaders='true';labelLeaders.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:3';container.appendChild(labelLeaders);}
  labelLeaders.setAttribute('viewBox','0 0 '+width+' '+height);labelLeaders.replaceChildren();labelLeaders.style.display=lines.length?'block':'none';
  for(const line of lines){const path=document.createElementNS('http://www.w3.org/2000/svg','line');for(const[name,value]of Object.entries({x1:line.x,y1:line.y,x2:line.endX,y2:line.endY,stroke:line.color,'stroke-width':1.5,'stroke-linecap':'round'}))path.setAttribute(name,String(value));labelLeaders.appendChild(path);}
  root.dataset.cityLabelLayout=JSON.stringify({mode:'dom-control-avoidance',controls,displaced,secondaryHidden:hidden,leaders:lines.length});
 }
 function labels(){
  if(!active||!width||!height)return;
  if(options.mapLabelCandidates&&options.layoutMapLabels){
   const bounds=labelWorldBounds(),candidates=[];
   for(const entry of markerEntries){const {node,position,limit}=entry;if(!node)continue;projected.copy(position).project(camera);node.style.left=(projected.x+1)*width/2+'px';node.style.top=(1-projected.y)*height/2+'px';node.hidden=Math.abs(projected.x)>limit||Math.abs(projected.y)>limit||Boolean(entry.live&&!playerPosition.visible);}
   for(const group of options.mapLabelCandidates(bounds)){projected.set(group.east,45,-group.north).project(camera);if(Math.abs(projected.x)<=1&&Math.abs(projected.y)<=1&&projected.z>=-1&&projected.z<=1)candidates.push({id:group.id,x:(projected.x+1)*width/2,y:(1-projected.y)*height/2});}
   const node=playerEntry?.node;options.layoutMapLabels(candidates,{width,height,player:{x:node?parseFloat(node.style.left):0,y:node?parseFloat(node.style.top):0,visible:!!node&&!node.hidden}});
   if(art){const scaleLine=document.getElementById('map-scale-line'),scaleLabel=document.getElementById('map-scale-label'),meters=span<1100?100:span>3200?500:200;if(scaleLine)scaleLine.style.width=(meters*height/span)+'px';if(scaleLabel)scaleLabel.textContent=meters+' m';}labelsDirty=false;return;
  }
  if(art)clearLabelOffsets();
  const candidates=[];for(const entry of markerEntries){const {node,position,place,limit}=entry;if(!node)continue;projected.copy(position).project(camera);const x=(projected.x+1)*width/2,y=(1-projected.y)*height/2;node.style.left=x+'px';node.style.top=y+'px';node.hidden=Math.abs(projected.x)>limit||Math.abs(projected.y)>limit||Boolean(place&&!CoopLocalPlaces.matches(place,filter))||Boolean(entry.live&&!playerPosition.visible)||Boolean(place&&options.markerVisible&&!options.markerVisible(place));if(place&&!node.hidden)candidates.push({node,place,x,y});}
  const visible=CoopCityBlocks.visibleMarkers(candidates,width,height,options.districtSelection?.forPlace(selected)?.id||selected?.id);for(const entry of candidates)entry.node.hidden=!visible.has(entry.place.id);
  if(art&&width<=800)protectCompactLabels(candidates);
  if(art){const scaleLine=document.getElementById('map-scale-line'),scaleLabel=document.getElementById('map-scale-label'),meters=span<1100?100:span>3200?500:200;if(scaleLine)scaleLine.style.width=(meters*height/span)+'px';if(scaleLabel)scaleLabel.textContent=meters+' m';}labelsDirty=false;
 }
 function invalidateCamera(projection=false){cameraDirty=true;projectionDirty=projectionDirty||projection;labelsDirty=true;dirty=true;}
 function updateCamera(){
  if(!cameraDirty||!width||!height)return;
  if(projectionDirty){const aspect=width/height;if(framing)span=options.streamMap?1600:Math.min(4400,(options.detailedCity?1600:1850)*Math.max(1,.95/aspect));if(options.streamMap)span=Math.min(span,14800/Math.hypot(aspect,offset.length()/offset.y));camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();projectionDirty=false;}
  camera.position.copy(target).add(offset);camera.lookAt(target);camera.updateMatrixWorld();
  // Loaded coverage never changes input coordinates or camera zoom.
  if(options.streamMap)ground.position.set(target.x,-1,target.z);
  viewInput=false;cameraDirty=false;if(active&&options.streamMap)root.dataset.mapView=JSON.stringify({center:geo.coordinate(target.x,-target.z),span,radius:viewRadius()});
 }
 function resize(){
  updateDistrictStyles();
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  if(width!==rect.width||height!==rect.height){if(width){viewChanged=true;viewInput=true;}width=rect.width;height=rect.height;renderer.setSize(width,height,false);invalidateCamera(true);}else invalidateCamera();
 }
 // Fill the detached canvas before replacing the visible one. Its first GPU
 // upload must not expose an empty canvas while GPS continues to move.
 function preparePresentation(view,rect){
  if(disposed||activated||!rect?.width||!rect?.height)return false;
  width=rect.width;height=rect.height;renderer.setSize(width,height,false);
  if(view){const p=geo.local(view.center.lon,view.center.lat);framing=false;target.set(p.east,0,-p.north);span=THREE.MathUtils.clamp(view.span,420,5200);}
  invalidateCamera(true);updateCamera();renderer.render(scene,camera);return true;
 }
 // Input, observer and animation belong to activation, never a detached build.
 const ray=new THREE.Raycaster(),uv=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-1),hit=new THREE.Vector3();
 function viewRadius(){
  let radius=0;
  const cornerRay=new THREE.Raycaster(),point=new THREE.Vector3();
  for(const x of[-1,1])for(const y of[-1,1]){cornerRay.setFromCamera(new THREE.Vector2(x,y),camera);if(cornerRay.ray.intersectPlane(plane,point))radius=Math.max(radius,Math.hypot(point.x-target.x,point.z-target.z));}
  return Math.ceil(radius);
 }
 function getView(){updateCamera();return{center:geo.coordinate(target.x,-target.z),span,radius:viewRadius()};}
 function cast(e){const r=canvas.getBoundingClientRect();uv.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);ray.setFromCamera(uv,camera);}
 // Explicit reference mode exposes projected, unobstructed roofs to DOM-based
 // interaction checks. Ordinary map sessions do not perform this extra work.
 const mapProbe=typeof location!=='undefined'&&new URLSearchParams(location.search).get('mapProbe')==='reference';
 function publishProbeTargets(){
  if(!mapProbe||pointer||!options.districtSelection||!buildingsVisible)return;
  const rect=canvas.getBoundingClientRect(),point=new THREE.Vector3(),probeRay=new THREE.Raycaster(),targets=[];
  for(const region of options.districtSelection.regions){
   if(!region.buildingIds.some(id=>visibleBuildingIds.has(id)))continue;
   point.set(region.east,(region.height||0)+1.3,-region.north).project(camera);
   const x=Math.round(rect.left+(point.x+1)*rect.width/2),y=Math.round(rect.top+(1-point.y)*rect.height/2);
   if(x<80||x>rect.right-90||y<rect.top+140||y>rect.bottom-170||point.z< -1||point.z>1)continue;
   probeRay.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
   if(options.districtSelection.raycast(probeRay.ray,filter,visibleBuildingIds)?.id!==region.id)continue;
   targets.push({id:region.id,x,y,lat:region.lat,lon:region.lon,height:region.height,area:region.area});
  }
  root.dataset.mapProbeTargets=JSON.stringify({view:getView(),targets});
 }
 function applyPan(){
  if(!pendingPan)return;updateCamera();const pan=pendingPan;pendingPan=null;cast(pan);
  // Keep the original ground point under the pointer. Updating it before the
  // camera moved made consecutive events alternately undo the previous movement.
  if(ray.ray.intersectPlane(plane,hit)){target.add(pan.anchor).sub(hit);if(!options.streamMap){target.x=THREE.MathUtils.clamp(target.x,-1300,1300);target.z=THREE.MathUtils.clamp(target.z,-1300,1300);}viewChanged=true;viewInput=true;invalidateCamera();updateCamera();}
 }
 function followPosition(point){
  if(!point||pointer)return false;framing=false;followTarget=new THREE.Vector3(point.east,0,-point.north);followFrame=0;
  if(target.distanceTo(followTarget)>Math.max(600,span)){target.copy(followTarget);followTarget=null;viewChanged=true;invalidateCamera();updateCamera();}
  dirty=true;return true;
 }
 function applyFollow(now){
  if(!followTarget||pointer)return;const elapsed=followFrame?Math.max(0,Math.min(64,now-followFrame)):16.67;followFrame=now;
  target.lerp(followTarget,1-Math.exp(-elapsed/100));if(target.distanceToSquared(followTarget)<.0004){target.copy(followTarget);followTarget=null;}viewChanged=true;invalidateCamera();
 }
 function movePointer(e){
  pointer.clientX=e.clientX;pointer.clientY=e.clientY;
  if(!pointer.moved&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>6){pointer.moved=true;dragStats.gestures++;lastDragFrame=0;options.onInteraction?.(true);}
  if(pointer.moved){framing=false;pendingPan=pointer;dirty=true;}
 }
 // Capture on the original canvas/button so an unmoved label keeps its native click.
 let suppressedClick=null;
 function inputActive(){return active&&!disposed&&!canvas.hidden&&container.dataset.mapMode!=='2d';}
 function inputOrigin(e){const node=e.target===canvas?canvas:e.target?.closest?.('.place-marker,[data-place-marker]');return node&&container.contains(node)?node:null;}
 function suppressPointerClick(p){suppressedClick={id:p.id,node:p.node};}
 function releasePointer(p){try{if(p.node.hasPointerCapture(p.id))p.node.releasePointerCapture(p.id);}catch(e){/* A streamed marker may already have been removed. */}}
 function cancelPointer(){const p=pointer;pointer=null;pendingPan=null;if(!p)return;suppressPointerClick(p);releasePointer(p);if(p.moved){viewChanged=true;dirty=true;options.onInteraction?.(false);}}
 function pointerDown(e){
  if(disposed||e.button!==0||e.isPrimary===false||pointer)return;suppressedClick=null;
  if(!inputActive())return;const node=inputOrigin(e);if(!node)return;
  followTarget=null;applyPan();updateCamera();cast(e);if(!ray.ray.intersectPlane(plane,hit))return;
  pointer={id:e.pointerId,node,x:e.clientX,y:e.clientY,clientX:e.clientX,clientY:e.clientY,anchor:hit.clone(),moved:false};
  node.setPointerCapture(e.pointerId);
 }
 function pointerMove(e){if(inputActive()&&pointer?.id===e.pointerId)movePointer(e);}
 function pointerUp(e){
  if(!inputActive()||pointer?.id!==e.pointerId)return;
  movePointer(e);const p=pointer;if(p.moved){applyPan();suppressPointerClick(p);}pointer=null;
  if(p.moved){viewChanged=true;dirty=true;options.onInteraction?.(false);return;}if(p.node!==canvas)return;
  updateCamera();cast(e);if(options.districtSelection){const started=performance.now();let region=buildingsVisible&&!options.baseOnly?options.districtSelection.raycast?.(ray.ray,filter,visibleBuildingIds):null;const buildingHit=!!region;if(!region&&ray.ray.intersectPlane(plane,hit))region=options.districtSelection.at({east:hit.x,north:-hit.z},filter);root.dataset.mapPickTiming=JSON.stringify({x:e.clientX,y:e.clientY,district:region?.id||null,hit:buildingHit?'building':region?'ground':'empty',regions:options.districtSelection.regions.length,models:visibleBuildingIds.size,ms:performance.now()-started});if(region)onSelect(region,false);else options.onEmptySelect?.();return;}const found=ray.intersectObjects(pickable).find(p=>CoopLocalPlaces.matches(p.object.userData.building,filter));if(found)onSelect(found.object.userData.building,false);
 }
 function pointerCancel(e){if(pointer?.id===e.pointerId)cancelPointer();}
 function pointerClick(e){
  if(disposed||!(e.detail>0||e.pointerType))return;const node=inputOrigin(e);if(!node)return;
  const p=suppressedClick;if(p&&(typeof e.pointerId==='number'&&e.pointerId>=0?e.pointerId===p.id:node===p.node)){e.preventDefault();e.stopImmediatePropagation();}
 }
 function wheel(e){if(!inputActive()||!inputOrigin(e)||!Number.isFinite(e.deltaY))return;e.preventDefault();zoom(Math.exp(THREE.MathUtils.clamp(e.deltaY*.001,-50,50)));}
 function zoom(factor){if(!Number.isFinite(factor)||factor<=0)return;const next=THREE.MathUtils.clamp(span*factor,420,5200);if(next===span)return;options.onInteraction?.(false);framing=false;span=next;viewChanged=true;viewInput=true;invalidateCamera(true);}
 const inputListeners=[['pointerdown',pointerDown],['pointermove',pointerMove],['pointerup',pointerUp],['pointercancel',pointerCancel],['lostpointercapture',pointerCancel],['click',pointerClick,true],['wheel',wheel,{passive:false}]];
 function installInput(){for(const[type,handler,settings]of inputListeners)container.addEventListener(type,handler,settings);window.addEventListener('blur',cancelPointer);inputInstalled=true;}
 function destroyInput(){for(const[type,handler,settings]of inputListeners)container.removeEventListener(type,handler,settings);window.removeEventListener('blur',cancelPointer);cancelPointer();suppressedClick=null;}
 let lastStats=0,lastDragFrame=0;const dragStats={gestures:0,frames:0,maxFrameMs:0};
 // Detailed LBS animation follows native display refresh; static and hidden views keep skipping redraws.
 function animate(now){if(disposed)return;frame=requestAnimationFrame(animate);if(!active||document.hidden)return;applyFollow(now);if(!dirty)return;applyPan();updateCamera();if(pointer?.moved){if(lastDragFrame)dragStats.maxFrameMs=Math.max(dragStats.maxFrameMs,now-lastDragFrame);lastDragFrame=now;dragStats.frames++;root.dataset.mapDragStats=JSON.stringify({...dragStats,maxFrameMs:Math.round(dragStats.maxFrameMs)});}else lastDragFrame=0;if(viewChanged&&(!pointer||now-lastViewNotice>=50)){viewChanged=false;lastViewNotice=now;const view=getView();root.dataset.mapView=JSON.stringify(view);options.onViewChange?.(view);}if(labelsDirty)labels();renderer.render(scene,camera);if(mapProbe)publishProbeTargets();if(!firstPresentation){firstPresentation={firstFrameAt:performance.now()};options.onPresented?.({...firstPresentation});notifyContentReady();}if(art&&(!lastStats||now-lastStats>1000)){root.dataset.cityRenderStats=JSON.stringify({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,pixelRatio:renderer.getPixelRatio(),staticShadows:true});lastStats=now;}dirty=false;lastFrame=now;}
 if(fastCity&&options.detailView)root.dataset.mapBuildingCoverage=JSON.stringify({center:options.detailView.center,radius:options.detailView.radius+260,refillReserve:420});
 yield*highlightSteps();root.dataset.districtSceneReady='true';root.dataset.localModels=JSON.stringify({footprints:options.baseOnly?0:art?buildings.reduce((n,b)=>n+CoopLocalPlaces.footprints(b).length,0):(localPlaces.blockGrouping?.renderedBodies??buildings.length),blockGrouping:localPlaces.blockGrouping,buildingMerge:localPlaces.buildingMerge,counts:localPlaces.counts,source:'OpenStreetMap',facades:art?'grouped-facades-v3':'block-summary',renderedBodies:buildings.reduce((n,b)=>n+CoopLocalPlaces.footprints(b).length,0),shadows:!!art,unknownUse:'generic'});
 function notifyContentReady(){if(!firstPresentation||contentNotified||disposed)return;const textureState=art?.textureState||'procedural';if(!['ready','fallback','procedural'].includes(textureState))return;contentNotified=true;options.onContentReady?.({...firstPresentation,textureState,textureReady:textureState==='ready'||textureState==='procedural',textureFallback:textureState==='fallback',contentReadyAt:performance.now()});}
 clearInteractive=()=>{if(activated&&art){clearLabelOffsets();labelLeaders?.remove();}if(inputInstalled){destroyInput();inputInstalled=false;}};
 function activate({root:liveRoot}={}){if(disposed)throw Error('Cannot activate a disposed district scene');if(activated&&!deactivated)return api;if(staged){liveRoot=liveRoot||document.getElementById(options.rootId||'coop-app');if(liveRoot&&liveRoot!==root){Object.assign(liveRoot.dataset,root.dataset);root=liveRoot;}bindMarkers();}activated=true;deactivated=false;active=true;observer=new ResizeObserver(resize);observer.observe(container);installInput();resize();frame=requestAnimationFrame(animate);root.dataset.districtSceneReady='true';return api;}
 api={activate,preparePresentation,deactivate:deactivateOwned,destroyAsync,addBaseData,addBuildings:fastCity&&!options.baseOnly?addBuildings:null,baseOnly:!!options.baseOnly,buildingsCover,setBuildingsVisible(value){if(value===buildingsVisible)return;buildingsVisible=value;scene.traverse(o=>{if(o.isMesh&&(types[o.userData.kind]||ownedInstances.has(o)))o.visible=value;});renderer.shadowMap.enabled=!!art&&value;renderer.shadowMap.needsUpdate=true;if(options.districtSelection)highlight();dirty=true;},canvas,preparedCanvas:canvas,invalidateLabels(){updateDistrictStyles();labelsDirty=true;dirty=true;},resize,destroy:disposeOwned,setVisible(value){active=value;if(value)resize();else{cancelPointer();if(art)clearLabelOffsets();}},setSelected(p,focus=false){selected=p;highlight();if(focus){framing=false;target.set(p.east,0,-p.north);span=900;viewChanged=true;viewInput=true;invalidateCamera(true);}},setFilter(kind){filter=kind;for(const entry of districtBoundaryEntries)entry.line.visible=CoopLocalPlaces.matches(entry.region,kind);if(options.districtSelection)highlight();scene.traverse(o=>{if(o.userData.kind&&o.material){o.material.transparent=true;o.material.opacity=CoopLocalPlaces.matches({kind:o.userData.kind,kinds:o.userData.kinds},kind)?1:.2;}});labelsDirty=true;dirty=true;},zoom,reset(){framing=true;target.set(0,0,0);cancelPointer();viewChanged=true;viewInput=true;invalidateCamera(true);},followPosition,setPosition(p,focus=false){if(!playerEntry)return;playerPosition.visible=!!p;if(p){playerPosition.position.set(p.east,0,-p.north);playerEntry.position.set(p.east,38,-p.north);if(focus){framing=false;target.set(p.east,0,-p.north);span=1100;viewChanged=true;viewInput=true;invalidateCamera(true);}}labelsDirty=true;dirty=true;},setView(view,notify=true){const p=geo.local(view.center.lon,view.center.lat);framing=false;target.set(p.east,0,-p.north);span=THREE.MathUtils.clamp(view.span,420,5200);cancelPointer();viewChanged=notify;viewInput=true;invalidateCamera(true);updateCamera();},get view(){return getView();},get dragging(){return !!pointer;},get visible(){return active;},get span(){return span;},get activated(){return activated;}};
 api.hasBuilding=id=>visibleBuildingIds.has(String(id));
 api.setDistrictSelection=model=>{options.districtSelection=model;highlightedDistrict=undefined;labelsDirty=true;dirty=true;root.dataset.districtSelection=String(model.regions.length);};
 complete=true;if(!staged)activate();return api;
 }finally{if(!complete){if(options.__registerCancel)deactivateOwned();else disposeOwned();}}
}
