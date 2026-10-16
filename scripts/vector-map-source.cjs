'use strict';
const {createHash}=require('node:crypto');
const {setImmediate:yieldIO}=require('node:timers/promises');
const {VectorTile,PbfReader,PbfWriter,classifyRings}=require('../src/vendor/vector-tile-3.0.0-pbf-5.1.2.cjs');
const clipping=require('../src/vendor/polygon-clipping-0.15.7.min.js');
const Generator=require('../src/coop-map-generator.js'),Geography=require('../src/coop-geography.js');
const {category,inside,center}=require('../src/coop-local-places.js');
const DataPolicy=require('../src/map-data-policy.js');
const ENDPOINT='https://tiles.openfreemap.org/planet',UNIT=4096,RAD=Math.PI/180,DAY=86400000,MAX_DOWNLOADS=8;
const BUILDING_VERSION=1;
const BASE_ROADS=new Set(['motorway','trunk','primary','secondary','tertiary','minor','unclassified','residential','living_street']);
const AMENITIES=new Set(['hospital','clinic','doctors','dentist','school','kindergarten','college','university','police','library','bus_station','courthouse','marketplace','arts_centre','theatre','cinema']);
const VECTOR_LAYERS=['building','landuse','poi','transportation','waterway','water','landcover','park'];
const VECTOR_PROPERTIES=new Set(['class','subclass','render_height','render_min_height','hide_3d','brunnel','ramp','access','oneway','service','foot','bicycle','layer']);
function anonymizeVectorTile(bytes){
 const parsed=new VectorTile(new PbfReader(bytes)),writer=new PbfWriter();
 for(const name of VECTOR_LAYERS){const layer=parsed.layers[name];if(!layer)continue;
  writer.writeMessage(3,(_,pbf)=>{
   pbf.writeStringField(1,name);const keys=[],values=[],keyIds=new Map(),valueIds=new Map();
   for(let i=0;i<layer.length;i++){
    const feature=layer.feature(i),tags=[];
    for(const [key,value]of Object.entries(feature.properties))if(VECTOR_PROPERTIES.has(key)){
     if(!keyIds.has(key)){keyIds.set(key,keys.length);keys.push(key);}const typed=typeof value+':'+value;
     if(!valueIds.has(typed)){valueIds.set(typed,values.length);values.push(value);}tags.push(keyIds.get(key),valueIds.get(typed));
    }
    // The pinned vector-tile reader records the packed geometry's byte offset.
    // Copy the commands unchanged so sanitizing never rounds or moves a vertex.
    if(feature._geometry<0)continue;feature._pbf.pos=feature._geometry;const geometry=feature._pbf.readBytes();
    pbf.writeMessage(2,(_,out)=>{if(feature.id!=null)out.writeVarintField(1,feature.id);out.writePackedVarint(2,tags);out.writeVarintField(3,feature.type);out.writeBytesField(4,geometry);},null);
   }
   for(const key of keys)pbf.writeStringField(3,key);
   for(const value of values)pbf.writeMessage(4,(v,out)=>{if(typeof v==='number')out.writeDoubleField(3,v);else if(typeof v==='boolean')out.writeBooleanField(7,v);else out.writeStringField(1,String(v));},value);
   pbf.writeVarintField(5,layer.extent);pbf.writeVarintField(15,2);
  },null);
 }
 return Buffer.from(writer.finish());
}
const wrap=x=>((x+180)%360+360)%360-180;
function world(lon,lat,z){const n=2**z;return[(lon+180)/360*n,(1-Math.asinh(Math.tan(Math.max(-85.051128,Math.min(85.051128,lat))*RAD))/Math.PI)/2*n];}
function windowBounds(point,meters,z){const dy=meters*1.7/111319.49,dx=dy/Math.cos(point.lat*RAD),a=world(point.lon-dx,point.lat+dy,z),b=world(point.lon+dx,point.lat-dy,z);return[a[0],a[1],b[0],b[1]];}
function tilePlan(point,meters,maxZoom=14,maxTiles=128){
 for(let z=Math.min(14,maxZoom);z>=0;z--){
  const n=2**z,b=windowBounds(point,meters,z),tiles=[];
  const left=Math.floor(b[0]),right=Math.floor(b[2]),top=Math.max(0,Math.floor(b[1])),bottom=Math.min(n-1,Math.floor(b[3]));
  if((right-left+1)*(bottom-top+1)>maxTiles)continue;
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)tiles.push({z,x:((x%n)+n)%n,y,worldX:x});
  return tiles;
 }
 throw Error('地图瓦片范围过大');
}
function hash(value){return createHash('sha1').update(value).digest('hex').slice(0,16);}
function edgeKey(a,b){const x=a.join(','),y=b.join(',');return x<y?x+';'+y:y+';'+x;}
function ringKey(ring){
 const points=ring.slice(0,-1).map(p=>p.join(','));if(!points.length)return'';
 let start=0;for(let i=1;i<points.length;i++)if(points[i]<points[start])start=i;
 const forward=points.map((_,i)=>points[(start+i)%points.length]).join(';'),backward=points.map((_,i)=>points[(start-i+points.length)%points.length]).join(';');return forward<backward?forward:backward;
}
function segment(a,b,box){
 let lo=0,hi=1;const dx=b[0]-a[0],dy=b[1]-a[1],p=[-dx,dx,-dy,dy],q=[a[0]-box[0],box[2]-a[0],a[1]-box[1],box[3]-a[1]];
 for(let i=0;i<4;i++){if(!p[i]){if(q[i]<0)return null;}else{const t=q[i]/p[i];if(p[i]<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>=hi)return null;}}
 return[[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];
}
function poiTags(p){
 const type=p.subclass||p.class;
 if(AMENITIES.has(type))return{amenity:type};
 if(type==='mall'||type==='retail')return{shop:'mall'};
 if(['hotel','museum'].includes(type))return{tourism:type};
 if(type==='station'||type==='railway')return{railway:'station'};
 if(type==='government'||type==='town_hall')return{office:'government'};
 return null;
}
function decodeVectorTiles(tiles,point,meters,{baseOnly=false,buildingsOnly=false,metadata={}}={}){
 if(!tiles.length)throw Error('地图瓦片为空');
 const z=tiles[0].z,n=2**z,ox=Math.min(...tiles.map(t=>t.worldX??t.x))*UNIT,oy=Math.min(...tiles.map(t=>t.y))*UNIT;
 const requested=windowBounds(point,meters,z).map((v,i)=>v*UNIT-(i%2?oy:ox));
 const data=Generator.normalize({elements:[]},{...point,radius:meters}),geo=Geography.create(data),features=new Map(),places=new Map(),seams=new Map(),polygons=[];
 const coordinate=([x,y])=>[Number(wrap((x+ox)/(UNIT*n)*360-180).toFixed(9)),Number((Math.atan(Math.sinh(Math.PI*(1-2*(y+oy)/(UNIT*n))))/RAD).toFixed(9))];
 const source=c=>'https://www.openstreetmap.org/#map=18/'+c[1]+'/'+c[0];
 function addLine(kind,points,tags,name=''){
  const coordinates=points.map(coordinate).filter((p,i,a)=>!i||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);if(coordinates.length<2)return;
  const key=coordinates.map(p=>p.join(',')).join(';'),reverse=[...coordinates].reverse().map(p=>p.join(',')).join(';'),id='omt-'+kind+'-'+hash(JSON.stringify(tags)+'|'+name+'|'+(key<reverse?key:reverse));
  features.set(id,{id,kind,name,class:tags.highway||tags.waterway||'',tags:{...tags,...(name&&{name})},coordinates,holes:[],source:source(coordinates[0])});
 }
 const loadedTiles=new Set(tiles.map(t=>(t.worldX??t.x)+':'+t.y));
 function complete(rings){
  // Progressive batches need not form a rectangle. A footprint touching any
  // missing neighbour still waits for that tile before becoming selectable.
  return rings.every(ring=>ring.every(([x,y])=>{
   const wx=(x+ox)/UNIT,wy=(y+oy)/UNIT;
   for(const dx of[-1e-8,1e-8])for(const dy of[-1e-8,1e-8])if(!loadedTiles.has(Math.floor(wx+dx)+':'+Math.floor(wy+dy)))return false;
   return true;
  }));
 }
 function addPolygon(kind,rings,tags,name='',modelRef=null,hidden3D=false){
  const coordinates=rings[0].map(coordinate),holes=rings.slice(1).map(r=>r.map(coordinate));if(coordinates.length<4)return;
  const id='omt-'+kind+'-'+hash(JSON.stringify(tags)+'|'+ringKey(coordinates)+'|'+holes.map(ringKey).sort().join('|'));
  if(kind==='campus'){
   const c=center(coordinates);
   places.set(id,{id,name,tags,lon:c.lon,lat:c.lat,coordinates,holes,source:source(coordinates[0])});
  }else features.set(id,{id,kind,name,class:tags.building||'',tags,coordinates,holes,source:source(coordinates[0]),...(kind==='building'&&{modelRef,hidden3D,geometryComplete:complete(rings)})});
 }
 for(const tile of tiles){
  const parsed=new VectorTile(new PbfReader(tile.bytes)),tx=(tile.worldX??tile.x)*UNIT-ox,ty=tile.y*UNIT-oy;
  const box=[Math.max(tx,requested[0]),Math.max(ty,requested[1]),Math.min(tx+UNIT,requested[2]),Math.min(ty+UNIT,requested[3])];
  const boundary=[[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]],[box[0],box[1]]]],labels=new Map();
  const points=(feature,line)=>line.map(p=>[tx+p.x*UNIT/feature.extent,ty+p.y*UNIT/feature.extent]);
  const names=buildingsOnly?null:parsed.layers.transportation_name;
  for(let i=0;i<(names?.length||0);i++){const f=names.feature(i);if(f.type!==2||!f.properties.name)continue;for(const line of f.loadGeometry()){const p=points(f,line);for(let j=1;j<p.length;j++)labels.set(edgeKey(p[j-1],p[j]),f.properties.name);}}
  for(const name of buildingsOnly?['building','landuse','poi']:['transportation','waterway','water','landcover','park',...(baseOnly?[]:['building','landuse','poi'])]){
   const layer=parsed.layers[name];
   for(let i=0;i<(layer?.length||0);i++){
    const f=layer.feature(i),p=f.properties;
    if(name==='transportation'||name==='waterway'){
     if(f.type!==2)continue;
     if(name==='transportation'&&(!p.class||['rail','transit','aerialway','ferry'].includes(p.class)||baseOnly&&!BASE_ROADS.has(p.class)))continue;
     const highway=p.class==='minor'?'unclassified':p.class==='path'?(p.subclass||'path'):p.class;
     const tags=name==='waterway'?{waterway:p.class||'stream'}:{highway:highway+(p.ramp&&['motorway','trunk','primary','secondary','tertiary'].includes(highway)?'_link':'')};
     for(const key of ['access','oneway','service','foot','bicycle','layer'])if(p[key]!=null)tags[key]=String(p[key]);
     if(p.brunnel==='bridge')tags.bridge='yes';if(p.brunnel==='tunnel')tags.tunnel='yes';
     for(const line of f.loadGeometry()){
      const path=points(f,line);let part=[],lastName='';
      const flush=()=>{if(part.length>1)addLine(name==='waterway'?'waterway':'road',part,tags,lastName);part=[];};
      for(let j=1;j<path.length;j++){
       const clipped=segment(path[j-1],path[j],box),label=p.name||labels.get(edgeKey(path[j-1],path[j]))||'';
       if(!clipped){flush();continue;}
       if(part.length&&(label!==lastName||Math.hypot(part.at(-1)[0]-clipped[0][0],part.at(-1)[1]-clipped[0][1])>1e-7))flush();
       if(!part.length){part.push(clipped[0]);lastName=label;}part.push(clipped[1]);
      }
      flush();
     }
     continue;
    }
    if(name==='poi'){
     const tags=poiTags(p);if(f.type!==1||!tags)continue;
     for(const line of f.loadGeometry())for(const xy of points(f,line)){
      if(xy[0]<box[0]||xy[0]>=box[2]||xy[1]<box[1]||xy[1]>=box[3])continue;
      const c=coordinate(xy),id='omt-poi-'+hash(String(f.id)+'|'+c.join(',')+'|'+JSON.stringify(tags));places.set(id,{id,name:p.name||p['name:zh']||'',tags,lon:c[0],lat:c[1],coordinates:[],holes:[],source:source(c)});
     }
     continue;
    }
    if(f.type!==3)continue;
    let kind,tags,modelRef=null,hidden3D=false;
    if(name==='water'){kind='water';tags={natural:'water',water:p.class||'water'};}
    else if(name==='landcover'&&['park','garden'].includes(p.subclass)||name==='park'){kind='park';tags={leisure:'park'};}
    else if(name==='building'){kind='building';tags={building:'yes'};if(p.render_height>0)tags.height=String(p.render_height);if(p.render_min_height>0)tags.min_height=String(p.render_min_height);modelRef=Number.isSafeInteger(f.id)?'omt-building-'+f.id+'-'+(p.render_min_height||0)+'-'+(p.render_height||0):null;hidden3D=['true','yes','1'].includes(String(p.hide_3d).toLowerCase());}
    else if(name==='landuse'&&(tags=poiTags(p)))kind='campus';
    else continue;
    for(const raw of classifyRings(f.loadGeometry())){
     if(!raw.length)continue;const rings=raw.map(r=>points(f,r)),bounds=rings[0].reduce((b,c)=>[Math.min(b[0],c[0]),Math.min(b[1],c[1]),Math.max(b[2],c[0]),Math.max(b[3],c[1])],[Infinity,Infinity,-Infinity,-Infinity]);
     // A camera/query boundary must never slice a building into a new model.
     // Stitch its owning tiles, keep the whole body, and hide unfinished edge
     // bodies until the next preloaded tile supplies the missing footprint.
     const clipBox=kind==='building'?[tx,ty,tx+UNIT,ty+UNIT]:box,clipBoundary=kind==='building'?[[[tx,ty],[tx+UNIT,ty],[tx+UNIT,ty+UNIT],[tx,ty+UNIT],[tx,ty]]]:boundary;
     if(bounds[2]<=clipBox[0]||bounds[0]>=clipBox[2]||bounds[3]<=clipBox[1]||bounds[1]>=clipBox[3])continue;
     const touches=bounds[0]<=clipBox[0]||bounds[1]<=clipBox[1]||bounds[2]>=clipBox[2]||bounds[3]>=clipBox[3],parts=touches?clipping.intersection([rings],[clipBoundary]):[rings];
     if(!parts.length)continue;
     const key=kind+'|'+JSON.stringify(tags)+'|'+(p.name||'')+'|'+(modelRef||'')+'|'+hidden3D;
     if(touches){if(!seams.has(key))seams.set(key,{kind,tags,name:p.name||'',modelRef,hidden3D,parts:[]});seams.get(key).parts.push(...parts);}
     else for(const polygon of parts)polygons.push({kind,tags,name:p.name||'',modelRef,hidden3D,rings:polygon});
    }
   }
  }
 }
 // Remove tile boundaries from water, parks, campuses and building footprints.
 for(const group of seams.values())for(const rings of group.parts.length===1?group.parts:clipping.union(...group.parts))polygons.push({...group,rings});
 for(const {kind,rings,tags,name,modelRef,hidden3D}of polygons){if(kind==='building'){const b=rings[0].reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);if(b[2]<requested[0]||b[0]>requested[2]||b[3]<requested[1]||b[1]>requested[3])continue;}addPolygon(kind,rings,tags,name,modelRef,hidden3D);}
 for(const area of places.values())if(area.coordinates.length&&!area.name){const kind=category(area.tags),poi=[...places.values()].find(p=>!p.coordinates.length&&p.name&&category(p.tags)===kind&&inside([p.lon,p.lat],area.coordinates)&&!area.holes.some(h=>inside([p.lon,p.lat],h)));if(poi)area.name=poi.name;}
 data.features=[...features.values()].sort((a,b)=>a.id.localeCompare(b.id));data.places=[...places.values()].sort((a,b)=>a.id.localeCompare(b.id));
 const rank={hospital:0,clinic:1,school:2,mall:3,station:4,police:5,government:6,library:7};
 data.gameNodes=data.places.map(place=>({place,distance:geo.distance(place.lon,place.lat)})).filter(p=>p.distance<=meters).sort((a,b)=>(rank[category(a.place.tags)]??8)-(rank[category(b.place.tags)]??8)||a.distance-b.distance||a.place.id.localeCompare(b.place.id)).slice(0,32).map(({place})=>({id:'place-'+place.id,placeId:place.id,name:place.name||undefined,lon:place.lon,lat:place.lat}));
 data.source={...data.source,name:'OpenStreetMap contributors · OpenFreeMap / OpenMapTiles',provider:'openfreemap',attribution:'© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap',providerUrl:'https://openfreemap.org/',schemaUrl:'https://openmaptiles.org/',dataset:metadata.tiles?.[0]||null};
 data.generation.provider='openfreemap';data.generation.vectorZoom=z;data.generation.buildingVersion=BUILDING_VERSION;
 data.generation.counts={roads:data.features.filter(f=>f.kind==='road').length,buildings:data.features.filter(f=>f.kind==='building').length,places:data.gameNodes.length};
 return DataPolicy.cleanMap(data);
}
function createVectorMapSource(options={}){
 const fetchMap=options.fetchMap||globalThis.fetch,endpoint=options.vectorEndpoint||ENDPOINT,cache=new Map(),inflight=new Map(),waiters=[];
 let metadata=null,metadataAt=0,active=0,cacheBytes=0;
 function release(){active--;waiters.sort((a,b)=>a.priority()-b.priority());const next=waiters.shift();if(next){next.signal?.removeEventListener('abort',next.abort);active++;next.resolve(release);}}
 function acquire(signal,priority){
  signal?.throwIfAborted();if(active<MAX_DOWNLOADS){active++;return Promise.resolve(release);}
  return new Promise((resolve,reject)=>{const item={resolve,signal,priority,abort:()=>{const i=waiters.indexOf(item);if(i>=0)waiters.splice(i,1);reject(signal.reason);}};waiters.push(item);signal?.addEventListener('abort',item.abort,{once:true});});
 }
 async function request(url,signal,maxBytes,entry){
  const done=await acquire(signal,()=>entry.priority);entry.started=true;
  try{
   signal?.throwIfAborted();const response=await fetchMap(url,{headers:{'User-Agent':'LBSMapStarter/0.1.0'},signal});
   if(!response.ok){const value=response.headers.get('retry-after'),wait=Number.isFinite(Number(value))?Number(value)*1000:Math.max(0,Date.parse(value)-Date.now())||0;const error=Object.assign(Error('vector upstream '+response.status),{upstreamStatus:response.status,retryAfterMs:wait});await response.body?.cancel();if(response.status===404)metadata=null;throw error;}
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw Object.assign(Error('地图瓦片数据过大'),{status:413,retryable:false});chunks.push(chunk);}return Buffer.concat(chunks);
  }finally{done();}
 }
 function resource(url,signal,priority){
  signal?.throwIfAborted();const hit=cache.get(url);
  if(hit){cache.delete(url);cache.set(url,hit);return Promise.resolve(hit);}
  let entry=inflight.get(url);
  if(!entry){
   const controller=new AbortController();entry={controller,priority,consumers:0,started:false};inflight.set(url,entry);
   const timer=setTimeout(()=>controller.abort(Object.assign(Error('地图瓦片请求超时'),{name:'TimeoutError'})),options.resourceTimeoutMs??12000);
   entry.promise=request(url,controller.signal,url===endpoint?1000000:8000000,entry).then(raw=>{
    const bytes=url===endpoint?raw:anonymizeVectorTile(raw);
    if(url!==endpoint){cache.set(url,bytes);cacheBytes+=bytes.length;while(cacheBytes>32000000&&cache.size){const key=cache.keys().next().value;cacheBytes-=cache.get(key).length;cache.delete(key);}}
    return bytes;
   }).finally(()=>{clearTimeout(timer);if(inflight.get(url)===entry)inflight.delete(url);});
  }
  entry.priority=Math.min(entry.priority,priority);entry.consumers++;
  return new Promise((resolve,reject)=>{
   let settled=false;
   // Cancel queued obsolete work. Keep at most eight started downloads alive so
   // the next drag can reuse them instead of restarting the same cold tile.
   const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);entry.consumers--;if(!entry.consumers&&!entry.started){entry.controller.abort();if(inflight.get(url)===entry)inflight.delete(url);}error?reject(error):resolve(value);};
   const cancel=()=>finish(signal.reason);
   signal?.addEventListener('abort',cancel,{once:true});entry.promise.then(value=>finish(null,value),error=>finish(error));if(signal?.aborted)cancel();
  });
 }
 async function catalog(signal,priority=0){
  signal?.throwIfAborted();if(metadata&&Date.now()-metadataAt<DAY)return metadata;
  const value=JSON.parse((await resource(endpoint,signal,priority)).toString('utf8'));
  if(!Array.isArray(value.tiles)||!value.tiles.length||!Number.isInteger(value.maxzoom))throw Error('地图瓦片目录不完整');
  metadata=value;metadataAt=Date.now();return metadata;
 }
 async function load(point,meters,{baseOnly=false,signal,onData}={}){
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true});
  try{
   const priority=baseOnly?1:0;
   const source=await catalog(controller.signal,priority),tiles=tilePlan(point,meters,source.maxzoom),focus=world(point.lon,point.lat,tiles[0].z),score=t=>(t.worldX+.5-focus[0])**2+(t.y+.5-focus[1])**2;
   tiles.sort((a,b)=>score(a)-score(b));
   const template=source.tiles[0],results=new Array(tiles.length),publishedFeatures=new Set(),publishedPlaces=new Set();let cursor=0,total=0,loaded=0,cacheHits=0;
   function publish(){
    // Emit the first tiles immediately, then double the decoded batch size.
    // Re-decoding the growing reserve every four tiles becomes quadratic in
    // dense cities and can exhaust a hosted Worker's CPU budget.
    if(!onData||baseOnly||loaded===tiles.length||(loaded&(loaded-1))!==0)return;
    const data=decodeVectorTiles(results.filter(Boolean),point,meters,{buildingsOnly:true,metadata:source});
    data.features=data.features.filter(f=>f.kind==='building'&&f.geometryComplete&&!publishedFeatures.has(f.id));
    data.places=data.places.filter(p=>!publishedPlaces.has(p.id));
    // Each frame is prepared independently. Action points must not refer to
    // places omitted from this delta because an earlier frame already sent them.
    const placeIds=new Set(data.places.map(p=>p.id));data.gameNodes=data.gameNodes.filter(node=>placeIds.has(node.placeId));
    data.generation.counts={roads:0,buildings:data.features.length,places:data.places.length};
    for(const f of data.features)publishedFeatures.add(f.id);for(const p of data.places)publishedPlaces.add(p.id);
    if(data.features.length||data.places.length)onData({...data,delivery:{cache:'miss',partial:true,tiles:loaded,totalTiles:tiles.length,tileCacheHits:cacheHits}});
   }
   const workers=Array.from({length:Math.min(MAX_DOWNLOADS,tiles.length)},async()=>{
    try{while(cursor<tiles.length){controller.signal.throwIfAborted();const index=cursor++,tile=tiles[index],url=template.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);if(cache.has(url))cacheHits++;
     const bytes=await resource(url,controller.signal,priority);controller.signal.throwIfAborted();
     total+=bytes.length;if(total>48000000)throw Object.assign(Error('地图瓦片范围过大，请缩小范围重试。'),{status:413,retryable:false});results[index]={...tile,bytes};loaded++;publish();
     // Cached/shared tile promises resolve in microtasks. Yield to sockets and
     // cancellation after each tile so partial frames actually reach the UI
     // before another whole window has been decoded on the server.
     if(onData)await yieldIO();
    }}catch(error){controller.abort(error);throw error;}
   });
   const settled=await Promise.allSettled(workers),failed=settled.find(result=>result.status==='rejected');if(failed)throw controller.signal.reason||failed.reason;
   controller.signal.throwIfAborted();
   try{const data=decodeVectorTiles(results,point,meters,{baseOnly,metadata:source});data.delivery={partial:false,tiles:loaded,totalTiles:tiles.length,tileCacheHits:cacheHits};return data;}catch(error){cache.clear();cacheBytes=0;throw error;}
  }catch(error){controller.abort(error);throw error;}
  finally{signal?.removeEventListener('abort',abort);}
 }
 return{load,warmCatalog:()=>catalog(),close(){for(const entry of inflight.values())entry.controller.abort();}};
}
module.exports={ENDPOINT,BUILDING_VERSION,tilePlan,anonymizeVectorTile,decodeVectorTiles,createVectorMapSource};
