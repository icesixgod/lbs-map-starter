// Roads divide visual blocks; original mapped building footprints remain available.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/polygon-clipping-0.15.7.min.js'),require('./coop-building-merge.js'));else root.CoopCityBlocks=factory(root.polygonClipping,root.CoopBuildingMerge);})(typeof globalThis!=='undefined'?globalThis:this,function(clipping,BuildingMerge){
 const rules={maxSpan:360,streetSetback:6,bodyInset:12,maxHeight:24,maxBodies:2};
 const ordinaryKinds=new Set(['generic','residence','commercial','warehouse','hotel','mall']);
 const roadWidths={motorway:30,motorway_link:18,trunk:28,trunk_link:16,primary:20,primary_link:11,secondary:15,secondary_link:10,tertiary:10,tertiary_link:8,unclassified:7,road:7,residential:7,living_street:7,pedestrian:6,service:4};
 function roadWidth(f){return roadWidths[f.class]||{footway:2,path:1.6,cycleway:2,steps:2}[f.class]||5;}
 function streetWidth(f){return f.kind==='road'&&f.tags?.tunnel!=='yes'&&!(Number(f.tags?.layer)<0)&&!(Number(f.tags?.layer)>0)&&f.tags?.bridge!=='yes'&&!(f.class==='service'&&['driveway','parking_aisle'].includes(f.tags?.service))?(roadWidths[f.class]||0):0;}
 function overlay(operation,...polygons){
  try{return clipping[operation](...polygons);}catch(error){
   if(!/Unable to complete output ring|Unable to find segment/.test(error.message))throw error;
   // Retry numerical seam failures on a canonical local grid, up to 1 cm.
   // The original WGS84 footprints and coordinates stay untouched.
   for(const scale of[1e6,1e3,1e2])try{const canonical=value=>Array.isArray(value)?value.map(canonical):Math.round(value*scale)/scale;return clipping[operation](...polygons.map(canonical));}catch(retry){if(!/Unable to complete output ring|Unable to find segment/.test(retry.message))throw retry;error=retry;}
   throw error;
  }
 }
 function area(rings){return rings.reduce((sum,r,index)=>{let a=0;const [x,y]=r[0];for(let i=1;i<r.length;i++)a+=(r[i-1][0]-x)*(r[i][1]-y)-(r[i][0]-x)*(r[i-1][1]-y);return sum+(index?-1:1)*Math.abs(a)/2;},0);}
 function box(rings){return rings.flat().reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);}
 function rect(x,y,w,h){return[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]];}
 function inside(point,rings){let result=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
 function anchor(rings){const bounds=box([rings[0]]),y=bounds[1]+(bounds[3]-bounds[1])*.50001,xs=[];for(const r of rings)for(let i=1;i<r.length;i++){const a=r[i-1],b=r[i];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));}xs.sort((a,b)=>a-b);let best=0;for(let i=2;i+1<xs.length;i+=2)if(xs[i+1]-xs[i]>xs[best+1]-xs[best])best=i;return{east:(xs[best]+xs[best+1])/2,north:y};}
 function distance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],u=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return(p[0]-a[0]-u*dx)**2+(p[1]-a[1]-u*dy)**2;}
 function create(data,local){
  const {geo}=local,size=rules.maxSpan,extent=Math.max(1700,geo.radius*1.7),limit=Math.ceil(extent/size),cutters=new Map(),regions=new Map(),streets=[],idMap=new Map();
  const toLocal=r=>r.map(c=>{const p=geo.local(...c);return[p.east,p.north];}),toCoordinates=r=>r.map(([x,y])=>{const p=geo.coordinate(x,y);return[p.lon,p.lat];});
  const polygons=b=>BuildingMerge.footprints(b).map(f=>[f.coordinates,...f.holes].map(toLocal));
  function index(rings){const b=box(rings);for(let x=Math.max(-limit,Math.floor(b[0]/size));x<=Math.min(limit-1,Math.floor(b[2]/size));x++)for(let y=Math.max(-limit,Math.floor(b[1]/size));y<=Math.min(limit-1,Math.floor(b[3]/size));y++){const key=x+','+y;if(!cutters.has(key))cutters.set(key,[]);cutters.get(key).push(rings);}}
  function clipSegment(a,b){const delta=[b[0]-a[0],b[1]-a[1]];let lo=0,hi=1;for(let i=0;i<2;i++){if(Math.abs(delta[i])<1e-8){if(Math.abs(a[i])>extent)return null;}else{const t1=(-extent-a[i])/delta[i],t2=(extent-a[i])/delta[i];lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}}return lo<hi?[[a[0]+delta[0]*lo,a[1]+delta[1]*lo],[a[0]+delta[0]*hi,a[1]+delta[1]*hi]]:null;}
  for(const f of data.features){
   if(streetWidth(f)){
    const points=toLocal(f.coordinates),pad=streetWidth(f)/2+rules.streetSetback;
    for(let i=1;i<points.length;i++){const clipped=clipSegment(points[i-1],points[i]);if(!clipped)continue;const [a,b]=clipped,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<.1)continue;const nx=-dy/length*pad,ny=dx/length*pad,ex=dx/length*pad,ey=dy/length*pad;index([[[a[0]-ex+nx,a[1]-ey+ny],[b[0]+ex+nx,b[1]+ey+ny],[b[0]+ex-nx,b[1]+ey-ny],[a[0]-ex-nx,a[1]-ey-ny],[a[0]-ex+nx,a[1]-ey+ny]]]);streets.push({a,b,name:f.name||'',key:String(f.id)});}
   }else if(['water','park'].includes(f.kind)&&f.coordinates.length>=4)index([f.coordinates,...(f.holes||[])].map(toLocal));
  }
  const namedStreets=streets.filter(s=>s.name);
  // Only the nearest street is used; keep the same distance/name/key and stable-order ties.
  function nearestStreet(point){let best=null,bestDistance=Infinity;for(const s of namedStreets){const d=distance(point,s.a,s.b);if(!best||(d-bestDistance||s.name.localeCompare(best.name)||s.key.localeCompare(best.key))<0){best=s;bestDistance=d;}}return best;}
  const protectedIds=new Set(local.places.filter(p=>!ordinaryKinds.has(p.kind)||p.kind==='mall').flatMap(p=>p.buildingIds)),landmarks=local.buildings.filter(b=>b.underground||!ordinaryKinds.has(b.kind)||protectedIds.has(b.id)),landmarkIds=new Set(landmarks.map(b=>b.id));
  for(const b of landmarks){idMap.set(b.id,b.id);if(!b.underground)for(const p of polygons(b))index(p);}
  function tile(x,y){const key=x+','+y;if(!regions.has(key)){const boundary=rect(x*size,y*size,size,size),nearby=(cutters.get(key)||[]).flatMap(p=>overlay('intersection',boundary,p));const parts=(nearby.length?overlay('difference',boundary,...nearby):[boundary]).filter(p=>area(p)>1).sort((a,b)=>{const aa=box(a),bb=box(b);return aa[1]-bb[1]||aa[0]-bb[0]||area(b)-area(a);});regions.set(key,parts.map((rings,i)=>({id:'block-'+x+'-'+y+'-'+i,rings,members:[]})));}return regions.get(key);}
  const unassigned=[];
  for(const b of local.buildings.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
   if(landmarkIds.has(b.id))continue;
   const x=Math.floor(b.east/size),y=Math.floor(b.north/size),options=tile(x,y);let region=options.find(r=>inside([b.east,b.north],r.rings));
   if(!region){const shape=polygons(b);let best=0;for(const r of options){const overlap=overlay('intersection',shape,[r.rings]).reduce((n,p)=>n+area(p),0);if(overlap>best){region=r;best=overlap;}}}
   if(region)region.members.push(b);else{unassigned.push(b);idMap.set(b.id,b.id);}
  }
  const blocks=[];
  for(const options of regions.values())for(const region of options){
   if(!region.members.length)continue;
   const members=region.members,sourceShapes=members.flatMap(b=>BuildingMerge.footprints(b)),bounds=box(sourceShapes.flatMap(f=>[toLocal(f.coordinates)])),w=bounds[2]-bounds[0],h=bounds[3]-bounds[1],ix=Math.min(rules.bodyInset,w*.14),iy=Math.min(rules.bodyInset,h*.14);
   let bodies=overlay('intersection',rect(bounds[0]+ix,bounds[1]+iy,w-ix*2,h-iy*2),[region.rings]).filter(p=>area(p)>1).sort((a,b)=>area(b)-area(a)).slice(0,rules.maxBodies);
   if(!bodies.length){const p=anchor(region.rings);bodies=overlay('intersection',rect(p.east-8,p.north-8,16,16),[region.rings]).filter(p=>area(p)>1).slice(0,rules.maxBodies);}
   if(!bodies.length){for(const b of members){unassigned.push(b);idMap.set(b.id,b.id);}continue;}
   const weights=new Map();for(const b of members){for(const f of BuildingMerge.footprints(b)){const kind=f.kind||b.kind;weights.set(kind,(weights.get(kind)||0)+area([f.coordinates,...f.holes].map(toLocal)));}for(const kind of b.kinds||[])if(!weights.has(kind))weights.set(kind,0);}
   const ranked=[...weights].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])),kind=ranked[0][0],position=anchor(bodies[0]),coordinate=geo.coordinate(position.east,position.north),nearby=nearestStreet([position.east,position.north]),street=nearby?.name||'周边';
   const height=Math.round(Math.min(rules.maxHeight,Math.max(8,members.reduce((n,b)=>n+b.height,0)/members.length*.7))),sourceIds=[...new Set(members.flatMap(b=>b.sourceIds||[b.id]))],shapes=bodies.map(r=>({...position,coordinates:toCoordinates(r[0]),holes:r.slice(1).map(toCoordinates),height,kind}));
   const block={...members[0],...shapes[0],...position,...coordinate,id:region.id,kind,kinds:ranked.map(([kind])=>kind),height,heightSource:'block-summary',footprints:shapes,sourceFootprints:sourceShapes,sourceIds,sources:[...new Set(members.flatMap(b=>b.sources||[b.source]))],mergedCount:sourceIds.length,streetGroup:undefined,block:{key:region.id,street,buildings:sourceIds.length,bodies:shapes.length,coordinates:toCoordinates(region.rings[0]),holes:region.rings.slice(1).map(toCoordinates)},facilityId:null};
   blocks.push(block);for(const b of members)idMap.set(b.id,block.id);
  }
  const names=new Map();for(const b of blocks){const street=b.block.street;if(!names.has(street))names.set(street,[]);names.get(street).push(b);}
  for(const [street,items]of names)items.sort((a,b)=>b.north-a.north||a.east-b.east||a.id.localeCompare(b.id)).forEach((b,i)=>{b.name=street+' · 街区'+(items.length>1?' '+(i+1):'');b.facilityName=b.name;});
  const buildings=[...landmarks,...unassigned,...blocks],blockIds=new Set(blocks.map(b=>b.id)),places=local.places.filter(p=>!p.streetGroup).map(p=>({...p,buildingIds:[...new Set(p.buildingIds.map(id=>idMap.get(id)||id))]})).filter(p=>!ordinaryKinds.has(p.kind)||!p.buildingIds.some(id=>blockIds.has(id)));
  for(const b of blocks)if(geo.contains(b.lon,b.lat))places.push({...b,id:'place-'+b.id,placeIds:[],buildingIds:[b.id],shortName:b.name,address:b.block.street,distance:geo.distance(b.lon,b.lat),point:geo.project(b.lon,b.lat)});
  const counts={};for(const b of buildings)if(!b.underground&&geo.contains(b.lon,b.lat))counts[b.kind]=(counts[b.kind]||0)+1;
  return{buildings,places,counts,allPlaces:local.allPlaces.map(p=>({...p,buildingIds:[...new Set(p.buildingIds.map(id=>idMap.get(id)||id))]})),blockGrouping:{blocks:blocks.length,sourceBuildings:local.buildings.filter(b=>!b.underground).reduce((n,b)=>n+BuildingMerge.footprints(b).length,0),renderedBodies:buildings.filter(b=>!b.underground).reduce((n,b)=>n+BuildingMerge.footprints(b).length,0),landmarks:landmarks.filter(b=>!b.underground).length,rules}};
 }
 function visibleMarkers(entries,width,height,selectedId){
  const ordered=entries.slice().sort((a,b)=>Number(b.place.id===selectedId)-Number(a.place.id===selectedId)||Number(Boolean(a.place.block))-Number(Boolean(b.place.block))||((a.x-width/2)**2+(a.y-height/2)**2)-((b.x-width/2)**2+(b.y-height/2)**2)||String(a.place.id).localeCompare(String(b.place.id))),visible=new Set(),boxes=[],limit=width<600?10:18;
  for(const entry of ordered){const selected=entry.place.id===selectedId,w=selected?Math.min(width<600?185:260,55+(entry.place.name||'').length*11):40,h=selected?44:40,bounds=[entry.x-w/2-6,entry.y-h-6,entry.x+w/2+6,entry.y+6];if(!selected&&(visible.size>=limit||boxes.some(b=>bounds[0]<b[2]&&bounds[2]>b[0]&&bounds[1]<b[3]&&bounds[3]>b[1])))continue;visible.add(entry.place.id);boxes.push(bounds);}
  return visible;
 }
 return{create,rules,roadWidth,streetWidth,overlay,visibleMarkers};
});
