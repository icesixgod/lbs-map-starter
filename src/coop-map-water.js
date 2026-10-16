// Assemble water in source coordinates first; crop the closed surface locally.
const Geography=require('./coop-geography.js');
const clipping=require('./vendor/polygon-clipping-0.15.7.min.js');
const VERSION=1;
function isWater(tags={}){return tags.natural==='water'||tags.waterway==='riverbank';}
function clip(feature,data){
 const geo=Geography.create(data),extent=Math.max(data.extentMeters||0,data.radiusMeters*1.7),rings=[feature.coordinates,...(feature.holes||[])].map(r=>r.map(c=>{const p=geo.local(...c);return[p.east,p.north];}));
 const box=rings[0].reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
 if(box[2]<-extent||box[0]>extent||box[3]<-extent||box[1]>extent)return[];
 if(box.every((v,i)=>i<2?v>=-extent:v<=extent))return[feature];
 const boundary=[[[-extent,-extent],[extent,-extent],[extent,extent],[-extent,extent],[-extent,-extent]]];let polygons;
 try{polygons=clipping.intersection(rings,boundary);}catch(error){
  if(!/Unable to complete output ring|Unable to find segment/.test(error.message))throw error;
  polygons=clipping.intersection(rings.map(r=>r.map(p=>p.map(v=>Math.round(v*1000)/1000))),boundary);
 }
 const coordinate=r=>r.map(([east,north])=>{const p=geo.coordinate(east,north);return[p.lon,p.lat];});
 return polygons.map((r,i)=>({...feature,id:i?feature.id+':clip-'+i:feature.id,coordinates:coordinate(r[0]),holes:r.slice(1).map(coordinate)}));
}
function supplement(data,surfaces){
 // Only old cached extracts use this catalog. Other source features stay intact.
 const parts=surfaces.flatMap(surface=>clip(surface,data));if(!parts.length)return data;
 const sources=new Set(parts.map(f=>f.source));
 return{...data,features:data.features.filter(f=>!(f.kind==='water'&&sources.has(f.source))).concat(parts)};
}
module.exports={VERSION,isWater,clip,supplement};
