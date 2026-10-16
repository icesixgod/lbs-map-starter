// Shared pointer lifecycle for the SVG and WebGL maps. A pinch stays a gesture
// until the last finger lifts, so its final pointerup can never select a building.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LBSMapGestures=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function bind(options){
    const {surface,origin,enabled=()=>true,blurTarget}=options,points=new Map(),blocked=new Map();
    let pinch=null,moved=false,interacting=false;
    function release(p){try{if(p.node.hasPointerCapture?.(p.id))p.node.releasePointerCapture(p.id);}catch{/* A streamed marker may have been removed. */}}
    function interact(){moved=true;for(const p of points.values())p.moved=true;if(!interacting){interacting=true;options.interaction?.(true);}}
    function centroid(){const [a,b]=points.values();return{clientX:(a.clientX+b.clientX)/2,clientY:(a.clientY+b.clientY)/2,distance:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY))};}
    function finish(p,cancelled=false){pinch=null;options.end?.(p,{cancelled});if(interacting){interacting=false;options.interaction?.(false);}}
    function cancel(){const held=[...points.values()];if(!held.length)return;for(const p of held)blocked.set(p.id,p.node);points.clear();finish(held[0],true);for(const p of held)release(p);}
    function down(e){
      if(!enabled()||e.button!==0||points.has(e.pointerId))return;
      const node=origin(e);if(!node)return;
      if(points.size){if(points.size>=2||e.pointerType!=='touch'||[...points.values()].some(p=>p.pointerType!=='touch'))return;}
      else{if(e.isPrimary===false)return;blocked.clear();moved=false;}
      const p={id:e.pointerId,node,pointerType:e.pointerType,x:e.clientX,y:e.clientY,clientX:e.clientX,clientY:e.clientY,moved};
      points.set(p.id,p);node.setPointerCapture?.(p.id);
      if(points.size===1){if(options.start?.(p)===false)cancel();}
      else{interact();pinch=centroid();pinch.initialDistance=pinch.distance;pinch.ratio=1;options.pinchStart?.(pinch);}
    }
    function move(e){
      const p=points.get(e.pointerId);if(!p)return;if(!enabled()){cancel();return;}
      p.clientX=e.clientX;p.clientY=e.clientY;
      if(pinch){Object.assign(pinch,centroid());pinch.ratio=pinch.initialDistance/pinch.distance;options.pinch?.(pinch);return;}
      if(!moved&&Math.hypot(p.clientX-p.x,p.clientY-p.y)>(p.pointerType==='touch'?8:6))interact();
      if(moved)options.pan?.(p);
    }
    function up(e){
      const p=points.get(e.pointerId);if(!p)return;move(e);if(!points.has(p.id))return;
      points.delete(p.id);if(moved)blocked.set(p.id,p.node);
      if(points.size){pinch=null;const remaining=points.values().next().value;remaining.x=remaining.clientX;remaining.y=remaining.clientY;remaining.moved=true;options.start?.(remaining);}
      else{if(!moved)options.tap?.(p);finish(p);}
      release(p);
    }
    function lost(e){if(points.has(e.pointerId))cancel();}
    function click(e){
      if(!(e.detail>0||e.pointerType))return;const node=origin(e);if(!node)return;
      if(blocked.has(e.pointerId)||[...blocked.values()].includes(node)){e.preventDefault();e.stopImmediatePropagation();}
    }
    const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',lost],['lostpointercapture',lost],['click',click,true]];
    for(const [name,handler,settings]of listeners)surface.addEventListener(name,handler,settings);
    blurTarget?.addEventListener('blur',cancel);
    return{cancel,get active(){return points.size>0;},destroy(){cancel();for(const [name,handler,settings]of listeners)surface.removeEventListener(name,handler,settings);blurTarget?.removeEventListener('blur',cancel);blocked.clear();}};
  }
  return{bind};
});
