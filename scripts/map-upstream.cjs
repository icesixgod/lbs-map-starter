'use strict';
const {setTimeout:delay}=require('node:timers/promises');
const Generator=require('../src/coop-map-generator.js');
const {createVectorMapSource,ENDPOINT:VECTOR_ENDPOINT}=require('./vector-map-source.cjs');

const DEFAULT_ENDPOINTS=[
 VECTOR_ENDPOINT,
 'https://overpass-api.de/api/interpreter',
 'https://overpass.private.coffee/api/interpreter',
 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
function configuredEndpoints(options){
 const configured=options.endpoints??process.env.LBS_MAP_ENDPOINTS,primary=options.endpoint??process.env.LBS_MAP_ENDPOINT;
 const values=configured==null?(primary?[primary,...DEFAULT_ENDPOINTS]:DEFAULT_ENDPOINTS):Array.isArray(configured)?configured:String(configured).split(/[\s,;]+/);
 const endpoints=[...new Set(values.map(value=>String(value).trim()).filter(Boolean))];
 if(!endpoints.length)throw Error('至少需要一个地图数据源');
 return endpoints.map(value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol))throw Error('地图数据源必须使用 HTTP 或 HTTPS');return{url:url.href,host:url.host,failures:0,retryAt:0};});
}
function retryAfter(value,now){
 if(!value)return 0;
 const seconds=Number(value);if(Number.isFinite(seconds))return Math.max(0,seconds*1000);
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;
}
function createMapUpstream(options={}){
 const endpoints=configuredEndpoints(options),fetchMap=options.fetchMap||globalThis.fetch,now=options.now||Date.now,logger=options.logger??console;
 const vector=createVectorMapSource(options);
 const maxAttempts=options.maxAttempts??Math.max(3,Math.min(6,endpoints.length*2)),attemptTimeoutMs=options.attemptTimeoutMs??12000,vectorTimeoutMs=options.vectorTimeoutMs??30000,retryDelayMs=options.retryDelayMs??1000;
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||!Number.isFinite(attemptTimeoutMs)||attemptTimeoutMs<=0||!Number.isFinite(vectorTimeoutMs)||vectorTimeoutMs<=0||!Number.isFinite(retryDelayMs)||retryDelayMs<0)throw Error('地图重试次数和超时配置无效');
 let preferred=0;
 async function load(point,meters,{baseOnly=false,signal,onData}={}){
  const body=new URLSearchParams({data:Generator.query(point,meters,{baseOnly})}).toString(),counts=new Map();let lastError;
  for(let attempt=0;attempt<maxAttempts;attempt++){
   signal?.throwIfAborted();
   // Try unused sources before retrying one, and keep using a working backup.
   let selected;
   while(true){
    const ordered=endpoints.map((source,i)=>({source,index:i,order:(i-preferred+endpoints.length)%endpoints.length})),available=ordered.filter(({source})=>source.retryAt<=now());
    selected=(available.length?available:ordered).sort((a,b)=>available.length?(counts.get(a.source)||0)-(counts.get(b.source)||0)||a.order-b.order:a.source.retryAt-b.source.retryAt||a.order-b.order)[0];
    const wait=selected.source.retryAt-now();if(wait<=0)break;
    // Another layer may update a shared source's cooldown while this job waits.
    await delay(Math.min(wait,2147483647),undefined,{signal});signal?.throwIfAborted();
   }
   const {source,index}=selected;
   signal?.throwIfAborted();counts.set(source,(counts.get(source)||0)+1);
   const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
   signal?.addEventListener('abort',abort,{once:true});
   const isVector=source.url===(options.vectorEndpoint||VECTOR_ENDPOINT),timer=setTimeout(()=>controller.abort(Object.assign(Error('地图数据源请求超时'),{name:'TimeoutError',code:'MAP_UPSTREAM_TIMEOUT'})),isVector?vectorTimeoutMs:attemptTimeoutMs);
   try{
    let data;
    if(isVector)data=await vector.load(point,meters,{baseOnly,signal:controller.signal,onData});
    else{
    const response=await fetchMap(source.url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'LBSMapStarter/0.1.0'},body,signal:controller.signal});
    if(!response.ok){
     const error=Object.assign(Error('upstream '+response.status),{upstreamStatus:response.status,retryable:![400,422].includes(response.status),retryAfterMs:retryAfter(response.headers.get('retry-after'),now())});
     await response.body?.cancel();throw error;
    }
    let size=0;const chunks=[];
    for await(const chunk of response.body){
     size+=chunk.length;if(size>(options.maxResponseBytes??48000000)){controller.abort();throw Object.assign(Error('该区域地图数据过大，请缩小范围后重试。'),{status:413,retryable:false});}chunks.push(chunk);
    }
    controller.signal.throwIfAborted();
    // HTTP 200 can still contain an Overpass runtime error or truncated JSON.
    data=Generator.normalize(JSON.parse(Buffer.concat(chunks).toString('utf8')),{...point,radius:meters});
    }
    signal?.throwIfAborted();source.failures=0;source.retryAt=0;preferred=index;
    if(attempt>0)logger.info?.('Map upstream recovered',{host:source.host,layer:baseOnly?'base':'full',attempts:attempt+1});
    return data;
   }catch(error){
    if(signal?.aborted)throw signal.reason;
    // A local size/validation limit or a malformed query will not improve on retry.
    const retryable=error.retryable??(!error.status||error.status===502);
    logger.warn?.('Map upstream request failed',{host:source.host,layer:baseOnly?'base':'full',attempt:attempt+1,status:error.upstreamStatus,reason:error.message,code:error.code||error.cause?.code});
    if(!retryable)throw error;
    source.failures++;const limited=[406,429].includes(error.upstreamStatus),backoff=Math.min(8000,retryDelayMs*2**Math.min(5,source.failures-1));
    source.retryAt=now()+Math.max(backoff,error.retryAfterMs||0,limited?30000:0);preferred=(index+1)%endpoints.length;lastError=error;
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  throw lastError;
 }
 const progressive=endpoints.some(source=>source.url===(options.vectorEndpoint||VECTOR_ENDPOINT));
 return{load,progressive,warmCatalog:()=>progressive?vector.warmCatalog():Promise.resolve(),close:()=>vector.close()};
}
module.exports={createMapUpstream};
