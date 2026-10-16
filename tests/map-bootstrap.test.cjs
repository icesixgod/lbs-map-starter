'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),create=require('../src/lbs-map-bootstrap.js'),Stream=require('../src/lbs-map-stream.js');
const center={lat:30.2109395,lon:120.2072838};
function setup(protocol='http:',buildings='on',staticDemo=false){
 const calls=[],listeners=new Map(),root={LBS_MAP_STATIC_DEMO:staticDemo,location:{protocol},innerWidth:1280,innerHeight:720,performance:{now:()=>10},AbortController,localStorage:{getItem:()=>buildings},addEventListener:(type,fn)=>listeners.set(type,fn),fetch:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))};
 return{boot:create(root),calls,listeners};
}
test('HTML bootstrap begins a bounded live download immediately and transfers ownership exactly once',async()=>{
 const s=setup();s.boot.start(center);assert.equal(s.calls.length,1);assert.match(s.calls[0].url,/stream=1/);assert.equal(s.calls[0].options.priority,'high');
 const request=s.boot.take();assert.ok(Stream.covers(request.region,{center,radius:1905}));assert.equal(request.plan.meters,3000);assert.equal(request.startedAt,10);assert.equal(s.boot.take(),null);
 s.listeners.get('pagehide')();assert.equal(request.controller.signal.aborted,false,'the client owns a claimed request');s.calls[0].resolve({});assert.ok((await request.promise).response);
});
test('leaving before the client is ready cancels and drains an unclaimed bootstrap response',async()=>{
 const s=setup();let discarded=0;s.boot.start(center);s.listeners.get('pagehide')();assert.equal(s.calls[0].options.signal.aborted,true);assert.equal(s.boot.take(),null);
 s.calls[0].resolve({body:{cancel:async()=>{discarded++;}}});await Promise.resolve();await Promise.resolve();assert.equal(discarded,1);
});
test('offline files and hidden-building mode do not request live bootstrap data',()=>{
 for(const s of[setup('file:'),setup('http:','off')]){s.boot.start(center);assert.equal(s.calls.length,0);assert.equal(s.boot.take(),null);}
});
test('the hosted demo makes no bootstrap API request even over HTTPS',()=>{
 const s=setup('https:','on',true);s.boot.start(center);assert.equal(s.calls.length,0);assert.equal(s.boot.take(),null);
});
