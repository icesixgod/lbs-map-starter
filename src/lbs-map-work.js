// Prepare a geographic model off the UI thread; drain scene generators in real tasks.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(root,require('./coop-geography.js'),require('./coop-local-places.js'),require('./lbs-map-buildings.js'));else root.LBSMapWork=factory(root,root.CoopGeography,root.CoopLocalPlaces,root.LBSMapBuildings);})(typeof globalThis!=='undefined'?globalThis:this,function(root,Geography,Places,Buildings){
 const now=()=>root.performance?.now?.()??Date.now(),epoch=()=>Number.isFinite(root.performance?.timeOrigin)?root.performance.timeOrigin+now():Date.now();
 const isBuffer=value=>Object.prototype.toString.call(value)==='[object ArrayBuffer]';
 const active=new Set(),idleWorkers=[],buildingRegistry=Buildings.create();let serial=0;
 function disposeWorker(entry){root.clearTimeout?.(entry.timer);try{entry.worker.terminate()?.catch?.(()=>{});}catch{}if(entry.url)try{root.URL.revokeObjectURL(entry.url);}catch{}}
 function clearIdleWorkers(){for(const entry of idleWorkers.splice(0))disposeWorker(entry);}
 function parkWorker(entry){clearIdleWorkers();idleWorkers.push(entry);entry.timer=root.setTimeout?.(()=>{const index=idleWorkers.indexOf(entry);if(index>=0){idleWorkers.splice(index,1);disposeWorker(entry);}},30000);entry.timer?.unref?.();}
 root.addEventListener?.('pagehide',clearIdleWorkers);
 function abortError(){const error=Error('Map preparation cancelled');error.name='AbortError';return error;}
 function throwIfAborted(signal){if(signal?.aborted)throw abortError();}
 function errorFrom(value){const error=Error(value?.message||'Map worker failed');error.name=value?.name||'Error';if(value?.stack)error.workerStack=value.stack;return error;}
 function listen(worker,name,handler){
  if(typeof worker.addEventListener==='function'){worker.addEventListener(name,handler);return()=>worker.removeEventListener(name,handler);}
  const key='on'+name;worker[key]=handler;return()=>{if(worker[key]===handler)worker[key]=null;};
 }
 function prepareModel(input,options={}){
  if(options.signal?.aborted)return Promise.reject(abortError());
  if(active.size>=2){const error=Error('Two map workers are already being prepared');error.name='MapWorkBusyError';return Promise.reject(error);}
  const buffers=isBuffer(input)?[input]:Array.isArray(input)&&input.every(isBuffer)?input:null;
  const started=now(),id=++serial,metrics={jobId:id,phase:'worker-create',inputMode:buffers?'array-buffer':'object',inputBytes:buffers?buffers.reduce((n,b)=>n+b.byteLength,0):null,inputPostMs:0,mainReceiveTaskMs:0,mainRehydrateMs:0,totalWallMs:0};
  return new Promise((resolve,reject)=>{
   const job={id};active.add(job);let worker,url,source,settled=false,result;const remove=[],reuseWorker=options.reuseWorker??!options.workerFactory;
   const phase=name=>{metrics.phase=name;options.onPhase?.({stage:'model',name,ms:now()-started,jobId:id});};
   function cleanup(error){
    for(const fn of remove)fn();remove.length=0;
    active.delete(job);
    if(worker){const entry={worker,url,source,factory:options.workerFactory};if(reuseWorker&&!error)parkWorker(entry);else disposeWorker(entry);}
   }
   function finish(error,value){if(settled)return;settled=true;metrics.totalWallMs=now()-started;cleanup(error);if(error){if(typeof error!=='object')error=Error(String(error));error.metrics=metrics;reject(error);}else resolve(value);}
   const cancel=()=>finish(abortError());
   try{
    source=options.workerSource??root.LBS_MAP_WORKER_SOURCE??(typeof LBS_MAP_WORKER_SOURCE==='string'?LBS_MAP_WORKER_SOURCE:null);
    if(typeof source!=='string'||!source.trim())throw Error('Embedded map worker source is unavailable');
    const idleIndex=reuseWorker?idleWorkers.findIndex(entry=>entry.source===source&&entry.factory===options.workerFactory):-1;
    if(idleIndex>=0){const entry=idleWorkers.splice(idleIndex,1)[0];root.clearTimeout?.(entry.timer);worker=entry.worker;url=entry.url;metrics.workerReused=true;}
    else if(options.workerFactory){if(active.size+idleWorkers.length>=2)clearIdleWorkers();worker=options.workerFactory(source);}
    else{
     if(active.size+idleWorkers.length>=2)clearIdleWorkers();
     if(typeof root.Worker!=='function'||typeof root.Blob!=='function'||!root.URL?.createObjectURL)throw Error('Map workers are unavailable');
     url=root.URL.createObjectURL(new root.Blob([source],{type:'text/javascript'}));worker=new root.Worker(url);
    }
    if(!worker||typeof worker.postMessage!=='function'||typeof worker.terminate!=='function')throw TypeError('Invalid map worker');
    remove.push(listen(worker,'message',event=>{
     if(settled)return;const message=event.data;if(message?.id!==id)return;
     const taskStart=now();
     try{
      throwIfAborted(options.signal);
      if(message.type==='lbs-map:phase')phase(message.name);
      else if(message.type==='lbs-map:error')finish(errorFrom(message.error));
      else if(message.type==='lbs-map:result'){
       if(!message.data||!message.local||!Array.isArray(message.localKeys))throw Error('Map worker returned an incomplete result');
       Object.assign(metrics,message.metrics);metrics.resultDeliveryLagMs=Math.max(0,epoch()-message.postEpochMs);
       const rehydrate=now(),geo=Geography.create(message.data),local=Object.fromEntries(message.localKeys.map(key=>[key,key==='geo'?geo:key==='types'?Places.types:message.local[key]]));metrics.mainRehydrateMs=now()-rehydrate;
       result={data:message.data,sourceData:message.sourceData,local,districtRegions:message.districtRegions,metrics};phase('model-ready');throwIfAborted(options.signal);
      }else if(message.type==='lbs-map:complete'){
       if(!result)throw Error('Map worker completed without a model');Object.assign(metrics,message.metrics);metrics.phase='model-ready';throwIfAborted(options.signal);if(!options.dataOnly)buildingRegistry.remember(result.local.sourceBuildings||[],{pin:!options.window});
       metrics.mainReceiveTaskMs+=now()-taskStart;finish(null,result);return;
      }
      metrics.mainReceiveTaskMs+=now()-taskStart;
     }catch(error){finish(error);}
    }));
    remove.push(listen(worker,'error',event=>{event.preventDefault?.();finish(event.error||Error(event.message||'Map worker failed'));}));
    remove.push(listen(worker,'messageerror',()=>finish(Error('Map worker result could not be cloned'))));
    if(options.signal){options.signal.addEventListener('abort',cancel,{once:true});remove.push(()=>options.signal.removeEventListener('abort',cancel));}
    phase('worker-post');throwIfAborted(options.signal);const postStart=now();
    const knownArea=options.window?{center:options.window.center,radiusMeters:options.window.radius,extentMeters:options.window.radius+1600}:options.area||(!isBuffer(input)?input:null);
    worker.postMessage({type:'lbs-map:prepare',id,input,districts:!!options.districts,dataOnly:!!options.dataOnly,window:options.window||null,previousView:options.previousView||null,extraPlaces:options.extraPlaces||[],knownBuildings:!options.dataOnly&&knownArea?buildingRegistry.near(knownArea):[]},buffers||[]);metrics.inputPostMs=now()-postStart;throwIfAborted(options.signal);
   }catch(error){finish(error);}
  });
 }
 function yieldTask(){
  if(typeof root.scheduler?.yield==='function')return root.scheduler.yield();
  if(typeof root.MessageChannel==='function')return new Promise(resolve=>{const channel=new root.MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(0);});
  return new Promise(resolve=>root.setTimeout(resolve,0));
 }
 function yieldWithSignal(task,signal){
  throwIfAborted(signal);if(!signal)return Promise.resolve(task);
  return new Promise((resolve,reject)=>{
   const cancel=()=>{signal.removeEventListener('abort',cancel);reject(abortError());};signal.addEventListener('abort',cancel,{once:true});
   Promise.resolve(task).then(value=>{signal.removeEventListener('abort',cancel);resolve(value);},error=>{signal.removeEventListener('abort',cancel);reject(error);});
   if(signal.aborted)cancel();
  });
 }
 async function readMapFrames(response,options={}){
  if(!options.batchReady)return readMapFramesSerial(response,options);
  // Read ahead while the worker/GPU handles its current frame. Merge only
  // already-arrived deltas, with bounded buffering and no batching delay.
  const controller=new AbortController(),abort=()=>controller.abort(),queue=[];
  let queuedBytes=0,receivedFrames=0,ended=false,failure=null,wake=null,space=null;
  const notify=()=>{const resolve=wake;wake=null;resolve?.();};
  options.signal?.addEventListener('abort',abort,{once:true});options.stopSignal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted||options.stopSignal?.aborted)abort();
  const producer=readMapFramesSerial(response,{...options,signal:controller.signal,onFrame:async frame=>{
   queue.push(frame);receivedFrames++;queuedBytes+=frame.byteLength;notify();
   if(queuedBytes>=(options.maxQueuedBytes??8000000))await new Promise(resolve=>{space=resolve;});
  }}).then(result=>{ended=true;notify();return result;},error=>{if(!(options.stopSignal?.aborted&&!options.signal?.aborted&&error.name==='AbortError'))failure=error;ended=true;notify();return{frames:receivedFrames,stopped:!failure};});
  try{
   for(;;){
    throwIfAborted(options.signal);if(failure)throw failure;
    if(queue.length){const frames=queue.splice(0);queuedBytes=0;const resume=space;space=null;resume?.();await options.onFrame(frames.length===1?frames[0]:frames);}
    else if(ended)return await producer;
    else await new Promise(resolve=>{wake=resolve;});
   }
  }finally{controller.abort();const resume=space;space=null;resume?.();await producer;options.signal?.removeEventListener('abort',abort);options.stopSignal?.removeEventListener('abort',abort);}
 }
 async function readMapFramesSerial(response,{signal,onFrame,maxFrameBytes=48000000}={}){
  const reader=response.body.getReader();let pieces=[],size=0,frames=0,finished=false;
  async function flush(){
   if(!size){pieces=[];return;}const bytes=new Uint8Array(size);let offset=0;for(const part of pieces){bytes.set(part,offset);offset+=part.length;}pieces=[];size=0;
   throwIfAborted(signal);await onFrame(bytes.buffer);frames++;throwIfAborted(signal);
  }
  try{
   for(;;){
    const {value,done}=await yieldWithSignal(reader.read(),signal);if(done)break;
    let start=0;
    while(start<value.length){const end=value.indexOf(10,start),part=value.subarray(start,end<0?value.length:end);size+=part.length;if(size>maxFrameBytes)throw Error('Map stream frame is too large');pieces.push(part);if(end<0)break;await flush();start=end+1;}
   }
   await flush();finished=true;return{frames};
  }finally{if(!finished)await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 async function runBuild(iterator,options={}){
  const clock=options.now||now,budget=options.budgetMs??4,batchSize=Math.max(1,Math.min(8,Math.floor(options.batchSize||1))),started=clock(),metrics={phase:'build',totalWallMs:0,cpuMs:0,maxContinuousMs:0,atomicMaxMs:0,atomicUpperBound:batchSize>1,yields:0,turns:0,units:0};let turnStart=null,cancelled=false;
  function endTurn(){if(turnStart===null)return;const continuous=clock()-turnStart;metrics.cpuMs+=continuous;metrics.maxContinuousMs=Math.max(metrics.maxContinuousMs,continuous);metrics.turns++;turnStart=null;}
  async function cancel(error){
   if(cancelled)return;cancelled=true;endTurn();metrics.phase='cancelled';metrics.totalWallMs=clock()-started;
   try{await iterator?.return?.();}catch(cleanupError){error.cleanupError=cleanupError;}
   try{await options.onCancel?.(error);}catch(cleanupError){error.cleanupError??=cleanupError;}
   error.metrics=metrics;
  }
  try{
   if(!iterator||typeof iterator.next!=='function')throw TypeError('Map build requires a synchronous iterator');
   if(!Number.isFinite(budget)||budget<=0)throw RangeError('Map build budget must be positive');
   for(;;){
    while(options.canRun&&!options.canRun()){throwIfAborted(options.signal);await yieldWithSignal(new Promise(resolve=>root.setTimeout(resolve,32)),options.signal);}
    throwIfAborted(options.signal);turnStart=clock();let step;
    for(;;){
     const atomicStart=clock();let finishedAt;
     try{for(let batch=0;batch<batchSize;batch++){
      throwIfAborted(options.signal);step=iterator.next();metrics.units++;
      if(!step||typeof step!=='object'||typeof step.then==='function')throw TypeError('Map build requires synchronous iterator steps');
      if(step.done)break;const value=step.value;metrics.phase=typeof value==='string'?value:value?.name||value?.phase||value?.stage||metrics.phase;
     }}finally{finishedAt=clock();metrics.atomicMaxMs=Math.max(metrics.atomicMaxMs,finishedAt-atomicStart);}
     throwIfAborted(options.signal);
     if(step.done){endTurn();metrics.phase='build-ready';metrics.totalWallMs=clock()-started;throwIfAborted(options.signal);return{value:step.value,metrics};}
     options.onPhase?.({stage:metrics.phase,name:metrics.phase,ms:finishedAt-started,units:metrics.units});throwIfAborted(options.signal);
     if(finishedAt-turnStart>=budget)break;
    }
    endTurn();metrics.yields++;await yieldWithSignal((options.yieldTask||yieldTask)(),options.signal);throwIfAborted(options.signal);
   }
  }catch(error){if(!error||typeof error!=='object')error=Error(String(error));await cancel(error);throw error;}
 }
 // LBS_MAP_WORKER_HANDLER_BEGIN
 function workerMain(scope){
  const clock=()=>scope.performance?.now?.()??Date.now(),wall=()=>Number.isFinite(scope.performance?.timeOrigin)?scope.performance.timeOrigin+clock():Date.now();
  const isBuffer=value=>Object.prototype.toString.call(value)==='[object ArrayBuffer]';let handled=false;
  scope.onmessage=event=>{
   const message=event.data;if(message?.type!=='lbs-map:prepare'||!Number.isSafeInteger(message.id)||handled)return;handled=true;
   const id=message.id,started=clock(),metrics={parseMs:0,validateMs:0,modelMs:0};
   try{
    let data=message.input;
    const buffers=isBuffer(data)?[data]:Array.isArray(data)&&data.every(isBuffer)?data:null;
    if(buffers){
     scope.postMessage({type:'lbs-map:phase',id,name:'worker-parse'});const parseStart=clock(),decoder=new scope.TextDecoder('utf-8',{fatal:true});let merged=null;
     for(const buffer of buffers){
      const frame=JSON.parse(decoder.decode(buffer));if(frame?.error)throw Error(frame.error);
      if(!frame||!Array.isArray(frame.features))throw Error('Invalid district map frame');
      if(!merged||frame.delivery?.partial!==true)merged=frame;
      else{
       if(frame.center?.lat!==merged.center?.lat||frame.center?.lon!==merged.center?.lon||frame.radiusMeters!==merged.radiusMeters)throw Error('Map stream changed its window');
       merged={...frame,features:[...merged.features,...frame.features],places:[...(merged.places||[]),...(frame.places||[])],gameNodes:[...(merged.gameNodes||[]),...(frame.gameNodes||[])]};
      }
     }
     data=merged;metrics.parseMs=clock()-parseStart;metrics.inputFrames=buffers.length;
    }
    if(data?.error)throw Error(data.error);
    const validateStart=clock();
    if(!data||typeof data!=='object'||!Array.isArray(data.features)||data.places!=null&&!Array.isArray(data.places)||data.gameNodes!=null&&!Array.isArray(data.gameNodes)||data.extentMeters!=null&&(!Number.isFinite(data.extentMeters)||data.extentMeters<=0))throw Error('Invalid district map data');
    scope.CoopGeography.create(data);metrics.validateMs=clock()-validateStart;scope.postMessage({type:'lbs-map:phase',id,name:'worker-model'});
    const sourceData=data;if(message.window)data=scope.LBSMapStream.renderWindow(data,message.window,message.previousView);
    const modelStart=clock(),built=message.dataOnly?{}:scope.CoopLocalPlaces.create(data,{detail:!!message.districts});
    if(!message.dataOnly&&scope.LBSMapBuildings){const registry=scope.LBSMapBuildings.create(message.knownBuildings||[]),stable=registry.resolve(built.sourceBuildings||built.buildings,built.geo);built.sourceBuildings=stable.buildings;if(message.districts)built.buildings=stable.buildings;built.buildingIdentity=stable.stats;}
    const {geo,types,...local}=built;metrics.modelMs=clock()-modelStart;let districtRegions;
    if(message.districts){
     scope.postMessage({type:'lbs-map:phase',id,name:'worker-districts'});const districtStart=clock(),places=[...built.places],ids=new Set(places.map(p=>p.id));
     for(const p of message.extraPlaces||[])if(!ids.has(p.id)){places.push({...p,...geo.local(p.lon,p.lat)});ids.add(p.id);}
     districtRegions=scope.CoopDistrictSelection.create(data,{...built,places}).regions;metrics.districtMs=clock()-districtStart;
    }
    metrics.workerBuildWallMs=clock()-started;
    const postStart=clock();scope.postMessage({type:'lbs-map:result',id,data,sourceData,local,districtRegions,localKeys:Object.keys(built),metrics,postEpochMs:wall()});const workerPostMs=clock()-postStart;
    scope.postMessage({type:'lbs-map:complete',id,metrics:{workerPostMs,workerTotalWallMs:clock()-started}});
   }catch(error){scope.postMessage({type:'lbs-map:error',id,error:{name:error.name,message:error.message,stack:error.stack}});}finally{handled=false;}
  };
 }
 // LBS_MAP_WORKER_HANDLER_END
 return{prepareModel,readMapFrames,runBuild,workerMain,clearIdleWorkers};
});
