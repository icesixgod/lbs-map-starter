// Small buildings share a street name and selection; mapped streets keep the groups apart.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./coop-building-merge.js'));else root.CoopStreetBuildingGroups=factory(root.CoopBuildingMerge);})(typeof globalThis!=='undefined'?globalThis:this,function(BuildingMerge){
 const rules={maxArea:1200,maxHeight:35,neighbourDistance:140,maxSpan:320,maxStreetDistance:240};
 const smallKinds=new Set(['generic','residence','commercial','warehouse','hotel']);
 function ringArea(ring){let sum=0;const [x,y]=ring[0];for(let i=1;i<ring.length;i++)sum+=(ring[i-1][0]-x)*(ring[i][1]-y)-(ring[i][0]-x)*(ring[i-1][1]-y);return Math.abs(sum)/2;}
 function distanceSquared(p,a,b){const x=b[0]-a[0],y=b[1]-a[1],u=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));return(p[0]-a[0]-u*x)**2+(p[1]-a[1]-u*y)**2;}
 function cross(a,b,c){return(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
 function segmentDistance(a,b,c,d){
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  if(abC*abD<0&&cdA*cdB<0)return 0;
  return Math.min(distanceSquared(a,c,d),distanceSquared(b,c,d),distanceSquared(c,a,b),distanceSquared(d,a,b));
 }
 function group(buildings,features,geo,protectedIds=new Set()){
  const widths={primary:20,primary_link:11,secondary:15,secondary_link:10,tertiary:10,residential:7,living_street:7,pedestrian:6,service:4},roads=[];
  for(const f of features){
   if(f.kind!=='road'||f.tags?.tunnel==='yes'||Number(f.tags?.layer)<0||['footway','path','steps','cycleway','motorway','motorway_link'].includes(f.class)||f.class==='service'&&!f.name)continue;
   const points=f.coordinates.map(c=>{const p=geo.local(...c);return[p.east,p.north];});
   for(let i=1;i<points.length;i++)if(Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1])>.1)roads.push({a:points[i-1],b:points[i],width:widths[f.class]||5,name:f.name||'',key:f.name||'way/'+f.id});
  }
  const idMap=new Map(buildings.map(b=>[b.id,b.id])),stats={groups:0,buildings:0,removed:0,rules};
  if(!roads.length)return{buildings,idMap,stats};
  // Reuse the road index for nearest streets and group boundaries. The extra margin covers eligible edge buildings.
  const cells=new Map(),cellSize=120,extent=geo.radius+rules.maxSpan+rules.maxStreetDistance,limit=Math.ceil((extent+rules.maxStreetDistance)/cellSize),roadOrder=new Map(roads.map((r,i)=>[r,i]));
  function visit(box,callback){for(let x=Math.max(-limit,Math.floor(box[0]/cellSize));x<=Math.min(limit,Math.floor(box[2]/cellSize));x++)for(let y=Math.max(-limit,Math.floor(box[1]/cellSize));y<=Math.min(limit,Math.floor(box[3]/cellSize));y++)callback(x+','+y);}
  for(const r of roads){const pad=r.width/2+1;visit([Math.min(r.a[0],r.b[0])-pad,Math.min(r.a[1],r.b[1])-pad,Math.max(r.a[0],r.b[0])+pad,Math.max(r.a[1],r.b[1])+pad],key=>{if(!cells.has(key))cells.set(key,[]);cells.get(key).push(r);});}
  function nearbyRoads(point){if(roads.length<64)return roads;const buckets=[],reach=rules.maxStreetDistance;let work=0;visit([point[0]-reach,point[1]-reach,point[0]+reach,point[1]+reach],key=>{const bucket=cells.get(key);if(bucket){buckets.push(bucket);work+=bucket.length;}});if(work>=roads.length)return roads;const candidates=new Set();for(const bucket of buckets)for(const r of bucket)candidates.add(r);return candidates;}
  function earlierRoad(a,b){return a.key<b.key||!(b.key<a.key)&&roadOrder.get(a)<roadOrder.get(b);}
  function divided(a,b){const candidates=new Set();visit([Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])],key=>{for(const r of cells.get(key)||[])candidates.add(r);});for(const r of candidates)if(segmentDistance(a,b,r.a,r.b)<=(r.width/2+1)**2)return true;return false;}
  const entries=[];
  for(const b of buildings){
   if(b.underground||!smallKinds.has(b.kind)||b.facilityId||b.height>rules.maxHeight||Math.abs(b.east)>extent||Math.abs(b.north)>extent||(b.sourceIds||[b.id]).some(id=>protectedIds.has(id)))continue;
   const polygons=BuildingMerge.footprints(b).map(f=>[f.coordinates,...f.holes].map(r=>r.map(c=>{const p=geo.local(...c);return[p.east,p.north];}))),area=polygons.reduce((total,r)=>total+ringArea(r[0])-r.slice(1).reduce((n,h)=>n+ringArea(h),0),0);
   if(area>rules.maxArea)continue;
   const point=[b.east,b.north];let street=null,best=Infinity,namedStreet=null,namedDistance=Infinity;
   for(const r of nearbyRoads(point)){const distance=distanceSquared(point,r.a,r.b);if(distance>rules.maxStreetDistance**2)continue;if(distance<best||distance===best&&earlierRoad(r,street)){street=r;best=distance;}if(r.name&&(distance<namedDistance||distance===namedDistance&&earlierRoad(r,namedStreet))){namedStreet=r;namedDistance=distance;}}
   street=namedStreet||street;
   if(!street)continue;
   const box=polygons.flatMap(p=>p[0]).reduce((r,[x,y])=>[Math.min(r[0],x),Math.min(r[1],y),Math.max(r[2],x),Math.max(r[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
   entries.push({b,point,box,area,street});
  }
  entries.sort((a,b)=>a.street.key.localeCompare(b.street.key)||b.point[1]-a.point[1]||a.point[0]-b.point[0]||String(a.b.id).localeCompare(String(b.b.id)));
  const streetGroups=new Map();
  for(const entry of entries){
   if(!streetGroups.has(entry.street.key))streetGroups.set(entry.street.key,[]);const options=streetGroups.get(entry.street.key);let chosen=null,nearest=Infinity;
   for(const candidate of options){
    const box=[Math.min(candidate.box[0],entry.box[0]),Math.min(candidate.box[1],entry.box[1]),Math.max(candidate.box[2],entry.box[2]),Math.max(candidate.box[3],entry.box[3])];if(box[2]-box[0]>rules.maxSpan||box[3]-box[1]>rules.maxSpan)continue;
    const distance=Math.min(...candidate.members.map(m=>(m.point[0]-entry.point[0])**2+(m.point[1]-entry.point[1])**2));if(distance>rules.neighbourDistance**2||distance>=nearest||candidate.members.some(m=>divided(m.point,entry.point)))continue;
    chosen=candidate;nearest=distance;
   }
   if(chosen){chosen.members.push(entry);chosen.box=[Math.min(chosen.box[0],entry.box[0]),Math.min(chosen.box[1],entry.box[1]),Math.max(chosen.box[2],entry.box[2]),Math.max(chosen.box[3],entry.box[3])];}else options.push({members:[entry],box:entry.box});
  }
  const replacements=new Map(),removedIds=new Set(),names=new Map();
  for(const groups of streetGroups.values()){
   const combined=groups.filter(g=>g.members.length>1);
   combined.forEach((g,i)=>{
    const ranked=g.members.slice().sort((a,b)=>b.area-a.area||String(a.b.id).localeCompare(String(b.b.id))),primary=ranked[0].b,weights=new Map();for(const m of ranked)weights.set(m.b.kind,(weights.get(m.b.kind)||0)+m.area);
    const kind=[...weights].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0],name=(ranked[0].street.name||'无名街道')+' · 建筑群'+(combined.length>1?' '+(i+1):''),sourceIds=[...new Set(ranked.flatMap(m=>m.b.sourceIds||[m.b.id]))];
    const shapes=ranked.flatMap(m=>BuildingMerge.footprints(m.b).map(f=>({...f,height:m.b.height,heightSource:m.b.heightSource,kind:m.b.kind,east:m.b.east,north:m.b.north}))),streetGroup={name:ranked[0].street.name||'无名街道',key:ranked[0].street.key,buildings:ranked.length};
    const b={...primary,...shapes[0],kind,kinds:[...weights.keys()],name,facilityName:name,footprints:shapes,height:Math.max(...ranked.map(m=>m.b.height)),sourceIds,sources:[...new Set(ranked.flatMap(m=>m.b.sources||[m.b.source]))],mergedCount:sourceIds.length,streetGroup};
    replacements.set(primary.id,b);for(const m of ranked){idMap.set(m.b.id,b.id);if(m.b.id!==primary.id)removedIds.add(m.b.id);}stats.groups++;stats.buildings+=ranked.length;stats.removed+=ranked.length-1;
    if(!names.has(streetGroup.name))names.set(streetGroup.name,[]);names.get(streetGroup.name).push(b);
   });
  }
  for(const [street,groups]of names)groups.sort((a,b)=>b.north-a.north||a.east-b.east||String(a.id).localeCompare(String(b.id))).forEach((b,i)=>{b.name=street+' · 建筑群'+(groups.length>1?' '+(i+1):'');b.facilityName=b.name;});
  return{buildings:buildings.filter(b=>!removedIds.has(b.id)).map(b=>replacements.get(b.id)||b),idMap,stats};
 }
 return{group,rules,smallKinds};
});
