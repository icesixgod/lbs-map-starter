// Collapse overlapping ground footprints before either map view creates models or hit targets.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/polygon-clipping-0.15.7.min.js'));else root.CoopBuildingMerge=factory(root.polygonClipping);})(typeof globalThis!=='undefined'?globalThis:this,function(clipping){
 function footprints(building){return building.footprints||[{coordinates:building.coordinates,holes:building.holes||[]}];}
 function ringArea(ring){let sum=0;const [x,y]=ring[0];for(let i=1;i<ring.length;i++)sum+=(ring[i-1][0]-x)*(ring[i][1]-y)-(ring[i][0]-x)*(ring[i-1][1]-y);return Math.abs(sum)/2;}
 function area(polygons){return polygons.reduce((total,rings)=>total+ringArea(rings[0])-rings.slice(1).reduce((n,r)=>n+ringArea(r),0),0);}
 function anchor(rings){
  // An interior scanline keeps the shared label and rooftop details out of courtyards or concave gaps.
  const ys=rings[0].map(c=>c[1]),y=Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*.50001,xs=[];
  for(const ring of rings)for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));}
  xs.sort((a,b)=>a-b);let best=0;for(let i=2;i+1<xs.length;i+=2)if(xs[i+1]-xs[i]>xs[best+1]-xs[best])best=i;
  return{east:(xs[best]+xs[best+1])/2,north:y};
 }
 function merge(buildings,geo){
  const entries=buildings.map((b,index)=>{
   const polygons=footprints(b).map(f=>[f.coordinates,...f.holes].map(r=>r.map(c=>{const p=geo.local(...c);return[p.east,p.north];}))),points=polygons.flatMap(p=>p[0]);
   const box=points.reduce((r,[x,y])=>[Math.min(r[0],x),Math.min(r[1],y),Math.max(r[2],x),Math.max(r[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
   return{b,index,polygons,box,area:area(polygons)};
  }),parents=entries.map((_,i)=>i);
  function find(i){while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;}
  // Sweep bounding boxes; exact intersections exclude neighbours, touching edges and courtyards.
  const sorted=entries.filter(e=>e.b.coordinates.length>=4).sort((a,b)=>a.box[0]-b.box[0]);let active=[];
  for(const entry of sorted){
   active=active.filter(a=>a.box[2]>entry.box[0]);
   for(const other of active){
    if(other.b.underground!==entry.b.underground||other.box[3]<=entry.box[1]||entry.box[3]<=other.box[1]||find(other.index)===find(entry.index))continue;
    if(area(clipping.intersection(other.polygons,entry.polygons))>1e-6)parents[find(entry.index)]=find(other.index);
   }
   active.push(entry);
  }
  const groups=new Map(),idMap=new Map();for(const e of entries){const key=find(e.index);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  const merged=[];let mergedGroups=0,removed=0;
  for(const members of groups.values()){
   if(members.length===1){const b=members[0].b;merged.push(b);for(const id of b.sourceIds||[b.id])idMap.set(id,b.id);continue;}
   // A real name wins over an unnamed duplicate; semantic use then area break ties deterministically.
   const named=b=>b.name?2:b.facilityName?1:0,ranked=members.slice().sort((a,b)=>named(b.b)-named(a.b)||Number(b.b.kind!=='generic')-Number(a.b.kind!=='generic')||b.area-a.area||String(a.b.id).localeCompare(String(b.b.id))),primary=ranked[0].b;
   const polygons=clipping.union(...members.map(m=>m.polygons)).sort((a,b)=>area([b])-area([a]));
   const shapes=polygons.map(rings=>({coordinates:rings[0].map(([x,y])=>{const c=geo.coordinate(x,y);return[c.lon,c.lat];}),holes:rings.slice(1).map(r=>r.map(([x,y])=>{const c=geo.coordinate(x,y);return[c.lon,c.lat];}))}));
   const measured=ranked.filter(m=>m.b.heightSource!=='estimated'),heightMember=(measured.length?measured:ranked).reduce((best,m)=>m.b.height>best.b.height?m:best);
   const local=anchor(polygons[0]),position=geo.coordinate(local.east,local.north),sourceIds=[...new Set(members.flatMap(m=>m.b.sourceIds||[m.b.id]))],b={...primary,...shapes[0],...local,...position,footprints:shapes,name:primary.name||primary.facilityName||'',height:heightMember.b.height,heightSource:heightMember.b.heightSource,sourceIds,sources:[...new Set(members.flatMap(m=>m.b.sources||[m.b.source]))],mergedCount:sourceIds.length};
   merged.push(b);for(const id of sourceIds)idMap.set(id,b.id);mergedGroups++;removed+=members.length-1;
  }
  return{buildings:merged,idMap,stats:{original:buildings.length,total:merged.length,groups:mergedGroups,removed}};
 }
 return{merge,footprints};
});
