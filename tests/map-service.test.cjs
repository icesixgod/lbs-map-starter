'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMapService:createService}=require('../scripts/district-map-service.cjs');
// These fixtures exercise the Overpass protocol; vector tiles have their own suite.
const overpass={endpoints:['https://overpass-api.de/api/interpreter']};
const createMapService=options=>createService({...overpass,...options});
const raw={elements:[{type:'way',id:1,tags:{building:'yes'},geometry:[{lat:30,lon:120},{lat:30,lon:120.0001},{lat:30.0001,lon:120.0001},{lat:30.0001,lon:120},{lat:30,lon:120}]}]};
const response=()=>new Response(JSON.stringify(raw));
const silent={warn(){},info(){}};

test('a cold stream publishes usable buildings without caching partial coverage or waiting for the large-window queue',async t=>{
 const Generator=require('../src/coop-map-generator.js'),calls=[],service=createMapService({cacheDir:false,upstream:{load:(point,meters,options)=>new Promise((resolve,reject)=>{calls.push({point,meters,options,resolve});options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})}});t.after(()=>service.close());
 const queued=service.load({lat:30,lon:120}),frames=[],controller=new AbortController(),current=service.stream({lat:31,lon:120,radius:1000},{signal:controller.signal,onData:data=>frames.push(data)});
 assert.equal(calls.length,2);assert.equal(calls[1].meters,1000,'first visible work does not fetch an additional kilometre before delivery');
 const near={elements:raw.elements.map(e=>({...e,geometry:e.geometry.map(p=>({...p,lat:p.lat+1}))}))},partial={...Generator.normalize(near,{lat:31,lon:120,radius:1000}),delivery:{partial:true}};calls[1].options.onData(partial);assert.equal(frames.length,1);assert.equal(service.peek({lat:31,lon:120}),null);
 calls[1].resolve({...partial,delivery:{partial:false}});assert.equal((await current).delivery.partial,false);assert.equal(service.peek({lat:31,lon:120}).features.length,1);
 calls[0].resolve(Generator.normalize(raw,{lat:30,lon:120,radius:1000}));await queued;
});

test('the HTTP stream sends its first line before completion and disconnecting cancels obsolete viewport work',async t=>{
 const Generator=require('../src/coop-map-generator.js'),{createMapServer}=require('../scripts/serve.cjs'),calls=[],app=createMapServer({mapOptions:{cacheDir:false,upstream:{load:(point,meters,options)=>new Promise((resolve,reject)=>{calls.push({options,resolve});options.onData({...Generator.normalize(raw,{...point,radius:meters}),delivery:{partial:true}});options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})}}});t.after(()=>app.close());
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+app.server.address().port;
 const response=await fetch(url+'/api/map?lat=30&lon=120&radius=1000&stream=1'),reader=response.body.getReader();assert.match(response.headers.get('content-type'),/ndjson/);
 const first=await reader.read();assert.equal(JSON.parse(new TextDecoder().decode(first.value)).delivery.partial,true);assert.equal(calls[0].options.signal.aborted,false);
 await reader.cancel();while(!calls[0].options.signal.aborted)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls[0].options.signal.aborted,true);
});

test('different uncached windows queue without a self-generated busy response and duplicate requests coalesce',async t=>{
  const calls=[],service=createMapService({cacheDir:false,cooldownMs:0,fetchMap:(url,options)=>new Promise(resolve=>calls.push({resolve,options}))});t.after(()=>service.close());
  const first=service.load({lat:30,lon:120}),same=service.load({lat:30,lon:120}),second=service.load({lat:31,lon:120});
  assert.equal(calls.length,1);calls[0].resolve(response());
  assert.equal((await first).delivery.cache,'miss');assert.equal((await same).delivery.cache,'miss');
  assert.equal(calls.length,2);calls[1].resolve(response());assert.equal((await second).center.lat,31);
});

test('neighboring windows use existing wider disk coverage without another upstream request',async t=>{
  const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'wasteland-map-cache-'));t.after(()=>fs.rmSync(cacheDir,{recursive:true,force:true}));let calls=0;
  const service=createMapService({cacheDir,cooldownMs:0,fetchMap:async()=>{calls++;return response();}});t.after(()=>service.close());
  const first=await service.load({lat:30,lon:120,radius:2000,preload:true});assert.equal(first.radiusMeters,2000);
  const neighbor=await service.load({lat:30.005,lon:120.005,radius:1500});assert.equal(neighbor.delivery.cache,'coverage');assert.equal(calls,1);assert.equal(neighbor.center.lat,30.005);
  assert.deepEqual(neighbor.features[0].coordinates,first.features[0].coordinates);
  const restarted=createMapService({cacheDir,fetchMap:async()=>{throw Error('cache should be sufficient');}});t.after(()=>restarted.close());
  const other=await restarted.load({lat:30.006,lon:120.006,radius:1500});assert.equal(other.delivery.cache,'coverage');
});

test('expired map coverage is immediately usable while refresh failure keeps the cached geometry',async t=>{
  let clock=1000,calls=0;const service=createMapService({cacheDir:false,cooldownMs:0,now:()=>clock,logger:silent,fetchMap:async()=>{calls++;return calls===1?response():new Response('',{status:503});}});t.after(()=>service.close());
  await service.load({lat:30,lon:120});clock+=8*24*3600000;
  const result=await service.load({lat:30,lon:120});assert.equal(result.delivery.stale,true);assert.equal(result.features.length,1);assert.equal(calls,2);
});

test('the HTTP map route preloads wider coverage and compresses reusable responses',async t=>{
  const {createMapServer}=require('../scripts/serve.cjs');let calls=0;
  const many={elements:Array.from({length:40},(_,i)=>({...raw.elements[0],id:i+1}))};
  const app=createMapServer({mapOptions:{...overpass,cacheDir:false,cooldownMs:0,fetchMap:async()=>{calls++;return new Response(JSON.stringify(many));}}});t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+app.server.address().port;
  const first=await fetch(url+'/api/map?lat=30&lon=120&radius=1000&preload=1');assert.equal(first.status,200);assert.equal(first.headers.get('content-encoding'),'gzip');assert.equal((await first.json()).radiusMeters,1000);
  const second=await fetch(url+'/api/map?lat=30.001&lon=120.001&radius=1000&preload=1');assert.equal(second.status,200);assert.equal((await second.json()).delivery.cache,'coverage');assert.equal(calls,1);
  const plain=await fetch(url+'/api/map?lat=30&lon=120&radius=1000',{headers:{'Accept-Encoding':'gzip;q=0'}});assert.equal(plain.headers.get('content-encoding'),null);assert.equal((await plain.json()).features.length,40);
});


test('the base route bypasses a pending building request and omits buildings from its query and response',async t=>{
  const {createMapServer}=require('../scripts/serve.cjs'),calls=[],road={type:'way',id:2,tags:{highway:'primary'},geometry:[{lat:31,lon:120},{lat:31.001,lon:120.001}]},app=createMapServer({mapOptions:{...overpass,cacheDir:false,cooldownMs:0,fetchMap:(url,options)=>new Promise(resolve=>calls.push({resolve,options}))}});t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+app.server.address().port;
  const full=fetch(url+'/api/map?lat=30&lon=120&radius=1000');while(calls.length<1)await new Promise(resolve=>setImmediate(resolve));
  const base=fetch(url+'/api/map?lat=31&lon=120&radius=2000&preload=1&layer=base');while(calls.length<2)await new Promise(resolve=>setImmediate(resolve));
  const query=new URLSearchParams(calls[1].options.body).get('data');assert.match(query,/highway/);assert.doesNotMatch(query,/building|amenity|shop|office/);
  calls[1].resolve(new Response(JSON.stringify({elements:[road,...raw.elements]})));const response=await base;assert.equal(response.status,200);const data=await response.json();assert.equal(data.generation.baseOnly,true);assert.equal(data.radiusMeters,3000);assert.equal(data.features.length,1);assert.equal(data.features[0].kind,'road');assert.deepEqual(data.places,[]);
  calls[0].resolve(new Response(JSON.stringify(raw)));assert.equal((await full).status,200);
  const cachedBase=await fetch(url+'/api/map?lat=30&lon=120&radius=1000&layer=base');const reused=await cachedBase.json();assert.equal(reused.delivery.cache,'coverage');assert.equal(reused.generation.counts.buildings,0);assert.equal(reused.features.length,0);assert.equal(calls.length,2,'existing full geometry can supply roads without a new upstream call');
});

test('a failed primary switches to a backup without duplicating a coalesced job and caches the result',async t=>{
  const primary='https://primary.example/api/interpreter',backup='https://backup.example/api/interpreter',calls=[],logs=[];
  const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:[primary,backup],logger:{warn:(...args)=>logs.push(args),info(){}},fetchMap:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))});t.after(()=>service.close());
  const first=service.load({lat:30,lon:120,radius:2000,preload:true}),duplicate=service.load({lat:30,lon:120,radius:2000,preload:true});
  assert.equal(calls.length,1);calls[0].resolve(new Response('bad gateway',{status:502}));
  while(calls.length<2)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[1].url,backup);assert.equal(calls[1].options.body,calls[0].options.body);assert.notEqual(calls[1].options.signal,calls[0].options.signal);
  calls[1].resolve(response());const [data,same]=await Promise.all([first,duplicate]);assert.deepEqual(data,same);assert.equal(data.radiusMeters,2000);assert.equal(data.features.length,1);
  assert.equal((await service.load({lat:30,lon:120,radius:2000})).delivery.cache,'hit');assert.equal(calls.length,2);assert.equal(logs[0][1].status,502);assert.equal(logs[0][1].host,'primary.example');
});

test('temporary network errors retry with backoff even when only one source is configured',async t=>{
  const timestamps=[];const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://primary.example/api/interpreter'],retryDelayMs:15,logger:silent,fetchMap:async()=>{timestamps.push(performance.now());if(timestamps.length===1)throw new TypeError('fetch failed');return response();}});t.after(()=>service.close());
  const data=await service.load({lat:30,lon:120});assert.equal(data.features.length,1);assert.equal(timestamps.length,2);assert.ok(timestamps[1]-timestamps[0]>=10,'retry must yield for backoff');
});

test('an individual source timeout is cancelled before a fresh attempt can succeed',async t=>{
  const calls=[];const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://slow.example/api/interpreter','https://backup.example/api/interpreter'],attemptTimeoutMs:25,timeoutMs:1000,logger:silent,fetchMap:(url,options)=>{
    calls.push({url,signal:options.signal});if(calls.length>1)return Promise.resolve(response());
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }});t.after(()=>service.close());
  assert.equal((await service.load({lat:30,lon:120})).features.length,1);assert.equal(calls.length,2);assert.ok(calls[0].signal.aborted);assert.equal(calls[1].signal.aborted,false);
});

test('invalid JSON and Overpass errors inside HTTP 200 fail over without caching incomplete data',async t=>{
  const calls=[],replies=[new Response('<html>gateway error</html>'),new Response(JSON.stringify({elements:raw.elements,remark:'runtime error: Query timed out'})),response()];
  const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://primary.example/api/interpreter','https://backup-one.example/api/interpreter','https://backup-two.example/api/interpreter'],logger:silent,fetchMap:async url=>{calls.push(url);return replies.shift();}});t.after(()=>service.close());
  assert.equal((await service.load({lat:30,lon:120})).features.length,1);assert.equal(calls.length,3);assert.equal(service.peek({lat:30,lon:120}).features.length,1);
});

test('limited sources are skipped while later windows keep using a successful backup',async t=>{
  const calls=[];const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://limited.example/api/interpreter','https://backup.example/api/interpreter'],logger:silent,fetchMap:async url=>{calls.push(url);return url.includes('limited')?new Response('',{status:429,headers:{'Retry-After':'120'}}):response();}});t.after(()=>service.close());
  await service.load({lat:30,lon:120});await service.load({lat:31,lon:120});
  assert.deepEqual(calls,['https://limited.example/api/interpreter','https://backup.example/api/interpreter','https://backup.example/api/interpreter']);
});

test('rate-limit cooldowns honour seconds and HTTP dates and can be cancelled during backoff',async t=>{
  for(const status of [406,429])for(const header of ['120',new Date(Date.now()+120000).toUTCString()]){
    let calls=0;const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://limited.example/api/interpreter'],retryDelayMs:0,logger:silent,fetchMap:async()=>{calls++;return new Response('',{status,headers:{'Retry-After':header}});}});t.after(()=>service.close());
    const active=assert.rejects(service.load({lat:30,lon:120}),error=>error.name==='AbortError'&&error.status===499),queued=assert.rejects(service.load({lat:31,lon:120}),error=>error.name==='AbortError'&&error.status===499);
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,1);service.close();await Promise.all([active,queued]);assert.equal(calls,1);
  }
});

test('all-source failure has a finite attempt budget and leaves the queue ready for the next window',async t=>{
  let calls=0;const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://primary.example/api/interpreter','https://backup.example/api/interpreter'],maxAttempts:4,retryDelayMs:0,logger:silent,fetchMap:async()=>{calls++;return calls<=4?new Response('',{status:503}):response();}});t.after(()=>service.close());
  const failed=assert.rejects(service.load({lat:30,lon:120}),error=>error.status===503&&error.cause.upstreamStatus===503),next=service.load({lat:31,lon:120});
  await failed;assert.equal((await next).center.lat,31);assert.equal(calls,5);
});

test('the total request deadline stops retries and closing cancels an active fetch',async t=>{
  for(const close of [false,true]){
    let calls=0;const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://slow.example/api/interpreter'],timeoutMs:25,attemptTimeoutMs:1000,logger:silent,fetchMap:(url,options)=>{calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}});t.after(()=>service.close());
    const result=assert.rejects(service.load({lat:30,lon:120}),error=>close?error.name==='AbortError'&&error.status===499:error.status===503&&error.cause.code==='MAP_REQUEST_TIMEOUT');
    if(close)service.close();await result;assert.equal(calls,1);
  }
});

test('invalid requests, permanent query errors and payload limits do not cause retry storms',async t=>{
  for(const mode of ['coordinates','query','size','elements']){
    let calls=0;const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['https://primary.example/api/interpreter','https://backup.example/api/interpreter'],logger:silent,...(mode==='size'?{maxResponseBytes:16}:{}),fetchMap:async()=>{calls++;return mode==='query'?new Response('',{status:400}):mode==='elements'?new Response(JSON.stringify({elements:Array(30001).fill({})})):response();}});t.after(()=>service.close());
    await assert.rejects(service.load({lat:mode==='coordinates'?'bad':30,lon:120}),error=>error.status===(mode==='coordinates'?400:mode==='query'?503:413));assert.equal(calls,mode==='coordinates'?0:1);
  }
});

test('real HTTP failure switches sources and shares the healthy source between base and full layers',async t=>{
  const http=require('node:http'),{createMapServer}=require('../scripts/serve.cjs'),calls=[];
  const primary=http.createServer((req,res)=>{calls.push('primary');res.writeHead(502);res.end('bad gateway');}),backup=http.createServer((req,res)=>{calls.push('backup');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(raw));});
  t.after(()=>{primary.closeAllConnections();backup.closeAllConnections();primary.close();backup.close();});
  await Promise.all([primary,backup].map(server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))));
  const app=createMapServer({mapOptions:{cacheDir:false,cooldownMs:0,endpoints:[primary,backup].map(server=>'http://127.0.0.1:'+server.address().port+'/api/interpreter'),logger:silent}});t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+app.server.address().port;
  const base=await fetch(url+'/api/map?lat=30&lon=120&radius=3000&preload=1&layer=base');assert.equal(base.status,200);assert.equal((await base.json()).generation.baseOnly,true);
  const full=await fetch(url+'/api/map?lat=30&lon=120');assert.equal(full.status,200);assert.equal((await full.json()).features.length,1);assert.deepEqual(calls,['primary','backup','backup']);
});

test('a response that stalls after headers is timed out and can recover through a backup',async t=>{
  const http=require('node:http'),stall=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.write('{"elements":[');});t.after(()=>{stall.closeAllConnections();stall.close();});
  await new Promise(resolve=>stall.listen(0,'127.0.0.1',resolve));let calls=0;
  const service=createMapService({cacheDir:false,cooldownMs:0,endpoints:['http://127.0.0.1:'+stall.address().port+'/api/interpreter','https://backup.example/api/interpreter'],attemptTimeoutMs:75,timeoutMs:2000,logger:silent,fetchMap:(url,options)=>{calls++;return calls===1?fetch(url,options):Promise.resolve(response());}});t.after(()=>service.close());
  assert.equal((await service.load({lat:30,lon:120})).features.length,1);assert.equal(calls,2);
});
