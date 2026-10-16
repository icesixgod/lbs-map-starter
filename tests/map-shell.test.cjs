'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

test('the standalone map contains no legacy gameplay engine, controls or embedded combat frame',()=>{
 const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
 assert.doesNotMatch(html,/\b(?:SoloCampaign|SoloExtraction|SoloProgression|WastelandSolo|CoopInvasion|CampaignStore)\b|<iframe\b|id="(?:combat|quick-battle|prepare-loadout|stock-strip|chapter-select|primary-action)"/);
 for(const id of ['district-canvas','map-2d','building-inspector','building-list','building-search','focus-building'])assert.ok(html.includes('id="'+id+'"'));
 const client=fs.readFileSync(path.join(root,'src/map-client.js'),'utf8');assert.doesNotMatch(client,/localStorage|indexedDB|acquireCampaignStore|openCombat|offerRaidRecovery/);
 assert.deepEqual(fs.readdirSync(path.join(root,'dist')).filter(name=>/\.(?:html|js)$/.test(name)),['index.html']);
});

test('the map server serves one map entry and no removed game modes or APIs',async t=>{
 const {createMapServer}=require('../scripts/serve.cjs'),app=createMapServer({mapOptions:{cacheDir:false,upstream:{close(){},load(){throw Error('this test must not request map data');}}}});
 t.after(()=>app.close());await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+app.server.address().port;
 const home=await fetch(url+'/');assert.equal(home.status,200);const html=await home.text();assert.match(html,/<title>LBS Map Starter · 街区地图<\/title>/);assert.equal(await(await fetch(url+'/index.html')).text(),html);
 for(const route of ['/solo-opening.html','/coop-demo.html','/wasteland-playable.html','/wasteland-wiki.html','/api/action','/api/campaign'])assert.equal((await fetch(url+route)).status,404,route);
});

test('the map model exposes geography and building styling without game progression rules',()=>{
 const map=require('../src/map-model.js');assert.equal(map.validPoint({lat:30.2,lon:120.2}),true);assert.equal(map.validPoint({lat:91,lon:120}),false);assert.equal(map.validPoint({lat:30,lon:181}),false);
 for(const key of ['tasks','arrival','freshCampaign','confirmAction','actionIntent','unlocked','complete'])assert.equal(map[key],undefined,key);
 assert.equal(map.districtTheme({kind:'hospital'}).id,'medical');assert.equal(map.districtTheme({kind:'residence'}).id,'residential');
});
