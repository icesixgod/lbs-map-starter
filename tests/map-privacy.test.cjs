'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8');
function session(flags={}){
 const nodes=new Map(),calls=[],cleared=[],events={};let cancelled=0;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},hidden:id==='sheet',checked:false,disabled:id==='gps-confirm',focus(){},querySelector(){return $('gps-label');}});return nodes.get(id);};
 const document={hidden:false,activeElement:{},addEventListener:(name,callback)=>{events[name]=callback;}};
 const c=vm.createContext({$,document,window:{isSecureContext:true},local:{},mode:'map',position:null,watch:null,gpsError:'',gpsSession:0,mapGPSFollow:false,mapGPSFixCount:0,streamGPSAnchor:null,returnFocus:null,Date,
  L:{validPoint:p=>Math.abs(p.lat)<=85&&Math.abs(p.lon)<=180},updatePosition(){},toast(){},stopMapViewport(){cancelled++;},
  closeSheet(){$('sheet').hidden=true;$('lbs-app').inert=false;},
  navigator:{geolocation:{watchPosition(ok,error,options){calls.push({ok,error,options});return calls.length;},clearWatch:id=>cleared.push(id)}},...flags});
 vm.runInContext(source.slice(source.indexOf('  function stopGPS('),source.indexOf("  $('gps-button').onclick=startGPS;")),c);
 vm.runInContext(source.split('\n').find(line=>line.includes("document.addEventListener('visibilitychange'")),c);
 const consent=()=>{for(const id of ['gps-device-consent','gps-network-consent']){$(id).checked=true;$(id).onchange();}$('gps-confirm').onclick();};
 return {c,$,calls,cleared,document,events,consent,get cancelled(){return cancelled;}};
}
test('local GPS does not request device permission until both purposes are explicitly accepted',async()=>{
 const s=session();await s.c.startGPS();assert.equal(s.calls.length,0);assert.equal(s.$('sheet').hidden,false);assert.equal(s.$('gps-confirm').disabled,true);
 s.$('gps-confirm').onclick();assert.equal(s.calls.length,0);
 s.$('gps-device-consent').checked=true;s.$('gps-device-consent').onchange();assert.equal(s.$('gps-confirm').disabled,true);
 s.$('gps-cancel').onclick();assert.equal(s.calls.length,0);assert.equal(s.$('sheet').hidden,true);
 s.$('gps-device-consent').checked=false;await s.c.startGPS();s.consent();assert.equal(s.calls.length,1);assert.equal(s.c.mode,'gps');assert.equal(s.$('sheet').hidden,true);
});
test('public and static displays cannot start GPS even through the local start action',async()=>{
 for(const flag of ['LBS_MAP_PUBLIC_DEMO','LBS_MAP_STATIC_DEMO']){const s=session({[flag]:true});await s.c.startGPS();s.c.enableGPS();assert.equal(s.calls.length,0);assert.equal(s.$('sheet').hidden,true);assert.equal(s.c.mode,'map');}
});
test('stopping GPS clears the fix, cancels automatic map work and rejects late callbacks across sessions',async()=>{
 const s=session();await s.c.startGPS();s.consent();const fix={coords:{latitude:30,longitude:120,accuracy:5,speed:2},timestamp:1000};s.calls[0].ok(fix);
 assert.equal(s.c.position.lat,30);assert.equal(s.c.position.speed,undefined);assert.deepEqual(JSON.parse(s.$('lbs-scene-root').dataset.mapGPS),{following:true,fixes:1});
 s.c.stopGPS();assert.deepEqual(s.cleared,[1]);assert.equal(s.c.position,null);assert.equal(s.c.watch,null);assert.equal(s.c.mode,'map');assert.equal(s.$('lbs-scene-root').dataset.mapGPS,undefined);assert.equal(s.cancelled,1);
 s.calls[0].ok(fix);assert.equal(s.c.position,null);
 for(const id of ['gps-device-consent','gps-network-consent'])s.$(id).checked=false;
 await s.c.startGPS();s.consent();s.calls[0].ok(fix);assert.equal(s.c.position,null,'an obsolete watcher cannot write into a newly accepted session');
 s.document.hidden=true;s.events.visibilitychange();assert.deepEqual(s.cleared,[1,2]);assert.equal(s.c.mode,'map');assert.equal(s.c.position,null);s.calls[1].ok(fix);assert.equal(s.c.position,null);
});
