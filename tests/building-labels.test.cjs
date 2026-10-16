'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Model=require('../src/map-model.js'),Places=require('../src/coop-local-places.js'),Geography=require('../src/coop-geography.js');
const source=fs.readFileSync(require.resolve('../src/map-client.js'),'utf8');

test('neutral building numbers survive renamed sources, replacements and connected-part aliases',()=>{
 const label=Model.createBuildingLabels(),first={id:'a',name:'中国银行'},second={id:'b',name:'浙江省人民医院'};
 assert.equal(label(first),'建筑 001');assert.equal(label(second),'建筑 002');assert.equal(label({...first,name:'其他名称'}),'建筑 001');
 const joined={id:'earlier-part',memberIds:['earlier-part','a','b'],name:'原始合并名称'};assert.equal(label(joined),'建筑 001');assert.equal(label(second),'建筑 001');assert.equal(label({id:'c'}),'建筑 003');
 assert.equal(first.name,'中国银行','presentation does not mutate the source geometry model');
});

test('markers, list search, details and 2D accessibility use neutral numbers without leaking source names or streets',()=>{
 const nodes=new Map(),markup=[],node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',value:'',hidden:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},querySelectorAll(){return[];}});return nodes.get(id);};
 const data={center:{lat:31,lon:121,crs:'WGS84'},radiusMeters:1000},geo=Geography.create(data),coordinates=[[0,0],[20,0],[20,20],[0,20],[0,0]].map(([x,y])=>{const p=geo.coordinate(x,y);return[p.lon,p.lat];});
 const region={id:'sample',name:'中国银行浙江省分行',street:'浙江省某路',kind:'commercial',height:20,area:400,lat:31,lon:121,coordinates,holes:[],rings:[[[0,0],[20,0],[20,20],[0,20],[0,0]]]},context=vm.createContext({
  URL,$:node,buildingLabel:Model.createBuildingLabels(),selectedDistrict:region,selected:null,inspectedId:null,twoD:false,filter:'all',buildingPage:0,districts:{regions:[region]},CoopLocalPlaces:Places,
  esc:s=>s,scene:{invalidateLabels(){}},setBuildingDetails(){},updateDistrictPaths(){},
  document:{createElementNS(){return{firstChild:null,appendChild(n){markup.push(n.html);n.parent.firstChild=null;},set innerHTML(html){this.firstChild={html,parent:this};}};}}
 });
 for(const [start,end]of [['  function buildMarkers(','  function mapLabelCandidates('],['  function renderBuildingList(','  $(\'building-list\').onclick='],['  function renderBuildingSelection(','  function renderDistrictContext('],['  function* mapSvgSteps(','  function selectMapDistrict(']])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),context);
 context.renderBuildingSelection();context.renderBuildingList();const iterator=context.mapSvgSteps({features:[]},{geo,buildings:[]},{regions:[region]});while(!iterator.next().done){}
 assert.equal(node('building-name').textContent,'建筑 001');assert.equal(node('building-marker').textContent,'建筑 001');assert.equal(node('building-marker').attributes['aria-label'],'查看建筑 001');assert.match(node('building-list').innerHTML,/建筑 001/);assert.match(markup.join(''),/aria-label="建筑 001"/);
 assert.doesNotMatch(JSON.stringify([...nodes.values()])+markup.join(''),/中国银行|浙江省|某路/);assert.equal(nodes.has('building-street'),false);
 node('building-search').value='中国银行';context.renderBuildingList();assert.equal(node('building-list').innerHTML,'');
 node('building-search').value='001';context.renderBuildingList();assert.match(node('building-list').innerHTML,/建筑 001/);
 node('building-search').value='商务楼';context.renderBuildingList();assert.match(node('building-list').innerHTML,/建筑 001/);
 const template=fs.readFileSync(require.resolve('../src/map.template.html'),'utf8');assert.doesNotMatch(template,/上游名称样本|building-street|输入建筑名称/);assert.match(source,/const homeName='默认街区'/);
});
