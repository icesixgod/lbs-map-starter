// Start the first live map download before parsing the rest of the application.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.LBSMapBoot=factory(root);})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 let pending=null;
 function discard(request){if(!request)return;request.controller.abort();request.promise.then(result=>result.response?.body?.cancel().catch(()=>{}));}
 function cancel(){const request=pending;pending=null;discard(request);}
 function start(center){
  cancel();if(root.LBS_MAP_STATIC_DEMO===true||!['http:','https:'].includes(root.location?.protocol)||typeof root.fetch!=='function')return;
  try{if(root.localStorage?.getItem('lbs:map:buildings')==='off')return;}catch{}
  const ratio=Math.hypot(620,1400,1600)/1400,aspect=(root.innerWidth||1280)/Math.max(1,root.innerHeight||720),span=Math.min(1600,14800/Math.hypot(aspect,ratio)),radius=Math.ceil(span/2*Math.hypot(aspect,ratio)),cell=.005;
  const aim=center;
  const plan={center:{lat:Math.max(-85,Math.min(85,Number((Math.round(aim.lat/cell)*cell).toFixed(4)))),lon:Number((((Math.round(aim.lon/cell)*cell+180)%360+360)%360-180).toFixed(4))},meters:Math.min(6000,Math.max(1000,Math.ceil((radius+2000)/(.9*1.45*500))*500))},controller=new root.AbortController(),startedAt=root.performance.now();
  const url='/api/map?lat='+plan.center.lat.toFixed(4)+'&lon='+plan.center.lon.toFixed(4)+'&radius='+plan.meters+'&preload=1&stream=1';
  pending={plan,controller,startedAt,region:{center:plan.center,extentMeters:plan.meters*1.45},promise:root.fetch(url,{signal:controller.signal,priority:'high'}).then(response=>({response}),error=>({error}))};
 }
 function take(){const request=pending;pending=null;return request;}
 root.addEventListener?.('pagehide',cancel);
 return{start,take,cancel};
});
