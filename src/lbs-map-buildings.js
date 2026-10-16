// Display identity is independent of the current map window and selection groups.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./coop-geography.js'),require('./vendor/polygon-clipping-0.15.7.min.js'));else root.LBSMapBuildings=factory(root.CoopGeography,root.polygonClipping);})(typeof globalThis!=='undefined'?globalThis:this,function(Geography,clipping){
 'use strict';
 const wrap=v=>((v+180)%360+360)%360-180;
 function hash(value){let h=2166136261;for(const c of String(value))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
 function digest(value){let h=5381;for(const c of value)h=Math.imul(h,33)^c.charCodeAt(0);return hash(value).toString(16).padStart(8,'0')+(h>>>0).toString(16).padStart(8,'0');}
 function ringKey(ring){const points=ring.slice(0,-1).map(p=>p.map(v=>v.toFixed(7)).join(','));let start=0;for(let i=1;i<points.length;i++)if(points[i]<points[start])start=i;const a=points.map((_,i)=>points[(start+i)%points.length]).join(';'),b=points.map((_,i)=>points[(start-i+points.length)%points.length]).join(';');return a<b?a:b;}
 function fingerprint(b){return digest(ringKey(b.coordinates)+'|'+(b.holes||[]).map(ringKey).sort().join('|'));}
 function alias(b){return(b.modelOrigin||'osm')+':'+(b.modelRef||b.id);}
 function describe(b){
  let area=b.modelArea;if(!Number.isFinite(area)){const geo=Geography.create({center:{lon:b.lon,lat:b.lat,crs:'WGS84'},radiusMeters:1000}),rings=[b.coordinates,...(b.holes||[])].map(r=>r.map(c=>{const p=geo.local(...c);return[p.east,p.north];}));area=0;for(const [i,r]of rings.entries()){let a=0;for(let j=1;j<r.length;j++)a+=r[j-1][0]*r[j][1]-r[j][0]*r[j-1][1];area+=(i?-1:1)*Math.abs(a)/2;}}
  const shapeKey=b.shapeKey||fingerprint(b),modelId=b.modelId||'model-'+alias(b)+'|'+shapeKey;
  return{modelId,shapeKey,aliases:[...new Set([...(b.modelAliases||[]),alias(b)])].slice(-8),lon:b.lon,lat:b.lat,coordinates:b.coordinates,holes:b.holes||[],height:b.height,minHeight:b.minHeight||0,connectionHeight:b.connectionHeight??b.height,connectionMinHeight:b.connectionMinHeight??b.minHeight??0,heightSource:b.heightSource,kind:b.kind,modelOrigin:b.modelOrigin||'osm',source:b.source,area};
 }
 function create(initial=[],options={}){
  const records=new Map(),transient=new Map(),cells=new Map(),coverage=new Map(),aliases=new Map(),maxEntries=options.maxEntries||24000;let pinned=0;
  const cell=(lon,lat)=>Math.floor(lon/.001)+','+Math.floor(lat/.001);
  function coverageCells(b){const box=b.coordinates.reduce((r,c)=>[Math.min(r[0],c[0]),Math.min(r[1],c[1]),Math.max(r[2],c[0]),Math.max(r[3],c[1])],[Infinity,Infinity,-Infinity,-Infinity]),keys=[];if((Math.ceil((box[2]-box[0])/.001)+1)*(Math.ceil((box[3]-box[1])/.001)+1)>4096)return[cell(b.lon,b.lat)];for(let x=Math.floor(box[0]/.001);x<=Math.floor(box[2]/.001);x++)for(let y=Math.floor(box[1]/.001);y<=Math.floor(box[3]/.001);y++)keys.push(x+','+y);return keys;}
  function remove(r){records.delete(r.modelId);transient.delete(r.modelId);if(r.pinned)pinned--;const key=cell(r.lon,r.lat),bucket=cells.get(key);bucket?.delete(r);if(!bucket?.size)cells.delete(key);for(const key of r.coverageKeys){const bucket=coverage.get(key);bucket?.delete(r);if(!bucket?.size)coverage.delete(key);}for(const a of r.aliases)if(aliases.get(a)===r)aliases.delete(a);}
  function remember(buildings,{pin=false}={}){
   for(const b of buildings){if(b.underground||b.hidden3D||!b.coordinates?.length)continue;const value=describe(b),previous=records.get(value.modelId);if(previous){for(const a of value.aliases){aliases.set(a,previous);if(!previous.aliases.includes(a))previous.aliases.push(a);}records.delete(previous.modelId);records.set(previous.modelId,previous);if(!previous.pinned){transient.delete(previous.modelId);transient.set(previous.modelId,previous);}continue;}
    value.pinned=pin&&pinned<Math.min(1000,maxEntries/2);if(value.pinned)pinned++;records.set(value.modelId,value);for(const a of value.aliases)aliases.set(a,value);const key=cell(value.lon,value.lat);if(!cells.has(key))cells.set(key,new Set());cells.get(key).add(value);value.coverageKeys=coverageCells(value);for(const key of value.coverageKeys){if(!coverage.has(key))coverage.set(key,new Set());coverage.get(key).add(value);}
    if(!value.pinned)transient.set(value.modelId,value);while(records.size>maxEntries)remove(transient.values().next().value||records.values().next().value);
   }
  }
  function near(data){const center=data.center,limit=(data.extentMeters||data.radiusMeters*1.7)+800,scale=111319.49*Math.cos(center.lat*Math.PI/180);return[...records.values()].filter(b=>Math.abs(b.lat-center.lat)*111319.49<=limit&&Math.abs(wrap(b.lon-center.lon))*scale<=limit).map(r=>{const{coverageKeys,pinned,...value}=r;return{...value,id:r.modelId,modelArea:r.area,modelAliases:r.aliases};});}
  function resolve(buildings,geo){
   const claimed=new Set(),blocked=new Set(),stats={reused:0,created:0,retained:0,suppressed:0};
   const models=buildings.map(b=>{
    if(b.underground||b.hidden3D){const previous=aliases.get(alias(b));if(previous&&!b.incomplete)blocked.add(previous);return b;}const description=describe(b),direct=aliases.get(alias(b)),directPoint=direct&&geo.local(direct.lon,direct.lat);let fixed=direct&&!claimed.has(direct)&&Math.hypot(directPoint.east-b.east,directPoint.north-b.north)<3?direct:null;
    if(!fixed){
     const candidates=new Set(),lat=Math.floor(b.lat/.001),lon=Math.floor(b.lon/.001);
     for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(const r of cells.get((lon+x)+','+(lat+y))||[])candidates.add(r);
     let best=Infinity;
     for(const r of candidates){if(claimed.has(r)||Math.abs(r.minHeight-description.minHeight)>.2)continue;const local=geo.local(r.lon,r.lat),distance=Math.hypot(local.east-b.east,local.north-b.north),ratio=Math.min(r.area,description.area)/Math.max(r.area,description.area);if(distance>3||ratio<.84)continue;
      if(r.shapeKey!==description.shapeKey){
       const basis=Geography.create({center:{lon:b.lon,lat:b.lat,crs:'WGS84'},radiusMeters:1000}),shape=value=>[value.coordinates,...value.holes].map(r=>r.map(c=>{const p=basis.local(...c);return[p.east,p.north];}));let overlap=0;
       try{for(const polygon of clipping.intersection(shape(r),shape(description)))for(const [i,ring]of polygon.entries()){let a=0;for(let j=1;j<ring.length;j++)a+=ring[j-1][0]*ring[j][1]-ring[j][0]*ring[j-1][1];overlap+=(i?-1:1)*Math.abs(a)/2;}}catch{continue;}
       if(overlap/Math.max(r.area,description.area)<.84)continue;
      }
      const score=distance+Math.abs(r.height-description.height)*.002;if(score<best){best=score;fixed=r;}
     }
    }
    if(!fixed){
     // A fallback source may split a known body into different parts, or
     // replace several bodies by an enclosing outline. Keep its established
     // silhouette instead of drawing a second representation over it.
     const owners=new Set();for(const key of coverageCells(description))for(const r of coverage.get(key)||[])if(r.modelOrigin!==description.modelOrigin)owners.add(r);
     for(const r of owners){const basis=Geography.create({center:{lon:b.lon,lat:b.lat,crs:'WGS84'},radiusMeters:1000}),shape=value=>[value.coordinates,...value.holes].map(r=>r.map(c=>{const p=basis.local(...c);return[p.east,p.north];}));let overlap=0;try{for(const polygon of clipping.intersection(shape(r),shape(description)))for(const [i,ring]of polygon.entries()){let a=0;for(let j=1;j<ring.length;j++)a+=ring[j-1][0]*ring[j][1]-ring[j][0]*ring[j-1][1];overlap+=(i?-1:1)*Math.abs(a)/2;}}catch{continue;}if(overlap/Math.min(r.area,description.area)>.7){stats.suppressed++;return null;}}
    }
    if(fixed){claimed.add(fixed);stats.reused++;}else{fixed=description;stats.created++;}
    const point=geo.local(fixed.lon,fixed.lat);return{...b,...point,lon:fixed.lon,lat:fixed.lat,coordinates:fixed.coordinates,holes:fixed.holes,height:fixed.height,minHeight:fixed.minHeight,connectionHeight:fixed.connectionHeight,connectionMinHeight:fixed.connectionMinHeight,heightSource:fixed.heightSource,kind:fixed.kind,source:fixed.source||b.source,modelOrigin:fixed.modelOrigin,modelId:fixed.modelId,shapeKey:fixed.shapeKey,modelArea:fixed.area,modelAliases:[...new Set([...fixed.aliases,alias(b)])].slice(-8)};
   }).filter(Boolean);
   // Adjacent source windows may repeat one canonical body. Merge its aliases
   // before retaining old models so it cannot acquire a second selection ID.
   const unique=[],identities=new Map();
   for(const b of models){const previous=b.modelId&&identities.get(b.modelId);if(previous){previous.modelAliases=[...new Set([...(previous.modelAliases||[]),...(b.modelAliases||[])])].slice(-8);previous.sourceIds=[...new Set([...(previous.sourceIds||[previous.id]),...(b.sourceIds||[b.id])])];stats.suppressed++;continue;}unique.push(b);if(b.modelId)identities.set(b.modelId,b);}
   // A source/cache window omitting a previously seen body does not demolish it.
   for(const r of records.values())if(!claimed.has(r)&&!blocked.has(r)&&!identities.has(r.modelId)){const point=geo.local(r.lon,r.lat);unique.push({...r,...point,id:r.modelId,modelAliases:r.aliases,modelArea:r.area,retained:true});stats.retained++;}
   return{buildings:unique,stats};
  }
  remember(initial);return{remember,near,resolve,get size(){return records.size;}};
 }
 return{create,fingerprint,hash};
});
