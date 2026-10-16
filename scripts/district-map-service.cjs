const fs=require('node:fs'),path=require('node:path');
const Generator=require('../src/coop-map-generator.js'),Stream=require('../src/lbs-map-stream.js');
const DataPolicy=require('../src/map-data-policy.js');
const Water=require('../src/coop-map-water.js'),waterCatalog=require('../src/assets/district-water-surfaces.json');
const {createMapUpstream}=require('./map-upstream.cjs');
const {BUILDING_VERSION}=require('./vector-map-source.cjs');
const WEEK=7*24*3600000;
function createMapService(options={}){
 const cacheDir=options.cacheDir===false?null:options.cacheDir||path.join(__dirname,'../.cache/maps',options.baseOnly?'base':''),upstream=options.upstream||createMapUpstream(options);
 const cache=new Map(),pending=new Map(),controllers=new Set(),queue=[];
 let active=null,nextRequest=0,queueTimer=null,closed=false,streaming=0;
 const maxEntries=options.maxEntries||64,now=options.now||Date.now;
 function fresh(entry){return now()-entry.savedAt<WEEK&&entry.data.generation.waterVersion===Generator.WATER_VERSION&&(entry.data.generation.provider!=='openfreemap'||entry.data.generation.baseOnly||options.baseOnly||entry.data.generation.buildingVersion===BUILDING_VERSION);}
 function repairWater(entry){
  if(entry.data.generation.waterVersion===Generator.WATER_VERSION)return entry;
  const catalog=options.waterCatalog||waterCatalog,surfaces=Generator.normalize(catalog,{...entry.data.center,radius:entry.data.radiusMeters}).features,data=Water.supplement(entry.data,surfaces);
  return data===entry.data?entry:{...entry,data:{...data,source:{...data.source,waterSurfaces:catalog.source}}};
 }
 function remember(key,entry){cache.delete(key);cache.set(key,entry);while(cache.size>maxEntries)cache.delete(cache.keys().next().value);}
 function read(key){
  if(cache.has(key)){const entry=cache.get(key);remember(key,entry);return entry;}
  if(!cacheDir)return null;
  try{const file=path.join(cacheDir,key+'.json');if(fs.statSync(file).size>16000000)return null;let entry=JSON.parse(fs.readFileSync(file,'utf8'));if(entry.data?.generation?.version!==Generator.VERSION||Generator.cacheKey(entry.data.center,entry.data.radiusMeters)!==key||!Number.isFinite(entry.savedAt))return null;entry=repairWater(entry);entry={...entry,data:DataPolicy.cleanMap(entry.data)};write(key,entry);return entry;}catch{return null;}
 }
 function write(key,entry){
  entry={savedAt:entry.savedAt,data:DataPolicy.cleanMap(entry.data)};remember(key,entry);if(!cacheDir)return;
  try{fs.mkdirSync(cacheDir,{recursive:true});const file=path.join(cacheDir,key+'.json'),temporary=file+'.next';fs.writeFileSync(temporary,JSON.stringify(entry));fs.renameSync(temporary,file);
   const files=fs.readdirSync(cacheDir).filter(n=>/^v\d+_-?\d+\.\d+_-?\d+\.\d+(?:_r\d+)?\.json$/.test(n)).map(n=>({n,time:fs.statSync(path.join(cacheDir,n)).mtimeMs})).sort((a,b)=>b.time-a.time);for(const f of files.slice(maxEntries))fs.unlinkSync(path.join(cacheDir,f.n));
  }catch(e){console.warn('Map cache could not be saved:',e.message);}
 }
 function covering(point,meters,wide=false){
  const candidates=new Map();
  for(const [key,entry]of cache)candidates.set(key,{key,center:entry.data.center,extent:entry.data.extentMeters||entry.data.radiusMeters*1.45});
  // Inspect filenames first: distant city caches never need to be parsed.
  if(cacheDir)try{for(const name of fs.readdirSync(cacheDir)){const m=/^v(\d+)_(-?\d+\.\d+)_(-?\d+\.\d+)(?:_r(\d+))?\.json$/.exec(name);if(m&&Number(m[1])===Generator.VERSION&&!candidates.has(name.slice(0,-5)))candidates.set(name.slice(0,-5),{key:name.slice(0,-5),center:{lat:Number(m[2]),lon:Number(m[3])},extent:Number(m[4]||1000)*1.45});}}catch{}
  const fits=[...candidates.values()].filter(c=>Stream.distance(c.center,point)+meters*1.45+40<=c.extent).sort((a,b)=>wide?b.extent-a.extent:a.extent-b.extent);
  let stale=null;
  for(const c of fits){const entry=read(c.key);if(!entry||Stream.distance(entry.data.center,point)+meters*1.45+40>entry.data.extentMeters)continue;if(now()-entry.savedAt<WEEK)return{entry,key:c.key};stale??={entry,key:c.key};}
  return stale;
 }
 function deliver(entry,kind,point=null,meters=null){const data=DataPolicy.cleanMap(point?Stream.subset(entry.data,point,meters):entry.data);return{...data,delivery:{cache:kind,stale:!fresh(entry)}};}
 function abortError(){return Object.assign(Error('地图请求已取消'),{name:'AbortError',status:499});}
 function drain(){
  clearTimeout(queueTimer);queueTimer=null;if(closed||active||!queue.length)return;
  const wait=nextRequest-now();if(wait>0){queueTimer=setTimeout(drain,wait);return;}
  // Visible work precedes background refreshes; the upstream remains serial.
  queue.sort((a,b)=>Number(a.background)-Number(b.background));const job=queue.shift();active=job;
  const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(Object.assign(Error('地图数据请求总时间已超时'),{code:'MAP_REQUEST_TIMEOUT'})),options.timeoutMs??40000);let contactedUpstream=false;
  (async()=>{
   try{
    // Another queued job may already have filled this window.
    const exact=read(job.key),cover=covering(job.point,job.meters)?.entry,hit=exact&&fresh(exact)?exact:cover;
    if(hit&&fresh(hit)){job.resolve(deliver(hit,'coverage',job.point,job.meters));return;}
    contactedUpstream=true;const data=DataPolicy.cleanMap(await upstream.load(job.point,job.fetchRadius,{baseOnly:!!options.baseOnly,signal:controller.signal}));controller.signal.throwIfAborted();const entry={savedAt:now(),data};
    if(options.baseOnly){data.features=data.features.filter(f=>f.kind!=='building');data.places=[];data.gameNodes=[];data.generation.baseOnly=true;data.generation.counts.buildings=0;data.generation.counts.places=0;}
    write(Generator.cacheKey(job.point,job.fetchRadius),entry);const result=job.fetchRadius===job.meters||options.baseOnly?data:Stream.subset(data,job.point,job.meters);if(job.fetchRadius!==job.meters&&!options.baseOnly)write(job.key,{savedAt:entry.savedAt,data:result});
    job.resolve({...DataPolicy.cleanMap(result),delivery:{cache:'miss',stale:false}});
   }catch(e){
    if(closed){job.reject(abortError());return;}
    const fallback=read(job.key)||covering(job.point,job.meters)?.entry;
    if(fallback)job.resolve(deliver(fallback,'stale',job.point,job.meters));
    else job.reject(Object.assign(Error(e.status?e.message:'地图数据暂时无法获取，请稍后重试；当前街区仍可浏览。'),{status:e.status||503,cause:e}));
   }finally{clearTimeout(timer);controllers.delete(controller);pending.delete(job.key);active=null;if(contactedUpstream)nextRequest=now()+(options.cooldownMs??5000);drain();}
  })();
 }
 function enqueue(point,meters,background=false,preload=false){
  const key=Generator.cacheKey(point,meters),existing=pending.get(key);if(existing){if(!background)existing.background=false;return existing.promise;}
  if(queue.length>=(options.maxQueued??8))return Promise.reject(Object.assign(Error('地图预加载队列已满，请稍后重试。'),{status:503}));
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;}),job={key,point,meters,fetchRadius:preload?Math.min(6000,meters+1000):meters,background,promise,resolve,reject};
  pending.set(key,job);queue.push(job);drain();return promise;
 }
 async function load(input){
  if(closed)throw Object.assign(Error('地图服务已停止'),{status:503});
  const point=Generator.location(input),meters=Generator.radius(input.radius),key=Generator.cacheKey(point,meters),cached=read(key);
  if(cached&&fresh(cached))return deliver(cached,'hit');
  const cover=covering(point,meters);
  if(cover){const result=deliver(cover.entry,'coverage',point,meters);if(!result.delivery.stale)write(key,{savedAt:cover.entry.savedAt,data:{...result,delivery:undefined}});else enqueue(point,meters,true,!!input.preload).catch(()=>{});return result;}
  if(cached){enqueue(point,meters,true,!!input.preload).catch(()=>{});return deliver(cached,'stale');}
  return enqueue(point,meters,false,!!input.preload);
 }
 async function stream(input,{signal,onData}={}){
  if(closed)throw Object.assign(Error('地图服务已停止'),{status:503});
  if(upstream.progressive===false){const data=await load(input);signal?.throwIfAborted();return{...data,delivery:{...data.delivery,partial:false}};}
  signal?.throwIfAborted();const point=Generator.location(input),meters=Generator.radius(input.radius),key=Generator.cacheKey(point,meters),exact=read(key),hit=exact&&fresh(exact)?exact:covering(point,meters)?.entry;
  if(hit&&fresh(hit))return{...deliver(hit,'coverage',point,meters),delivery:{cache:'coverage',stale:false,partial:false}};
  if(streaming>=2)throw Object.assign(Error('地图正在加载，请稍后重试。'),{status:503});
  // Vector tiles have their own shared eight-download limit. Visible streams
  // must not wait behind the large-window queue or its Overpass cooldown.
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});controllers.add(controller);streaming++;
  const timer=setTimeout(()=>controller.abort(Object.assign(Error('地图数据请求总时间已超时'),{code:'MAP_REQUEST_TIMEOUT'})),options.timeoutMs??40000);
  try{
   const data=DataPolicy.cleanMap(await upstream.load(point,meters,{signal:controller.signal,onData:part=>{controller.signal.throwIfAborted();onData?.(DataPolicy.cleanMap(part));}}));controller.signal.throwIfAborted();
   write(key,{savedAt:now(),data});return{...data,delivery:{...data.delivery,cache:'miss',stale:false,partial:false}};
  }catch(error){
   if(controller.signal.aborted)throw controller.signal.reason;
   if(hit)return{...deliver(hit,'stale',point,meters),delivery:{cache:'stale',stale:true,partial:false}};
   throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controllers.delete(controller);streaming--;}
 }
 function peek(input,wide=false){const point=Generator.location(input),meters=Generator.radius(input.radius),exact=read(Generator.cacheKey(point,meters)),cover=wide?covering(point,meters,true)?.entry||exact:exact||covering(point,meters)?.entry;return cover?deliver(cover,'coverage',wide?null:point,meters):null;}
 return{load,stream,peek,close(){closed=true;clearTimeout(queueTimer);for(const job of queue.splice(0)){pending.delete(job.key);job.reject(abortError());}for(const controller of controllers)controller.abort(abortError());if(!options.upstream)upstream.close?.();}};
}
module.exports={createMapService};
