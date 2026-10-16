// Map ingestion has no city-specific IDs. The same data drives the 2D and 3D views.
const Geography=require('./coop-geography.js');
const Water=require('./coop-map-water.js');
const {category,center,inside}=require('./coop-local-places.js');
const DataPolicy=require('./map-data-policy.js');
const VERSION=1;
function location(input={}){
 const lat=typeof input.lat==='number'?input.lat:Number(String(input.lat??'').trim()),lon=typeof input.lon==='number'?input.lon:Number(String(input.lon??'').trim());
 if(input.lat==null||input.lon==null||String(input.lat).trim()===''||String(input.lon).trim()===''||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)throw Object.assign(Error('请输入有效 WGS84 经纬度：纬度 -85～85，经度 -180～180。'),{status:400});
 return{lat:Number(lat.toFixed(4)),lon:Number((lon===180?-180:lon).toFixed(4)),crs:'WGS84'};
}
function radius(value){
 if(value==null)return 1000;
 const meters=typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value.trim()):NaN;
 if(!Number.isFinite(meters)||meters<1000||meters>6000)throw Object.assign(Error('地图范围需为 1000～6000 米。'),{status:400});
 return Math.ceil(meters/500)*500;
}
function cacheKey(p,inputRadius=p.radius){const meters=radius(inputRadius);return 'v'+VERSION+'_'+p.lat.toFixed(4)+'_'+p.lon.toFixed(4)+(meters===1000?'':'_r'+meters);}
function query(p,inputRadius=p.radius,options={}){
 const meters=radius(inputRadius),extent=meters*1.45,area='(around:'+extent+','+p.lat+','+p.lon+')',dy=meters*1.7/111319.49,dx=dy/Math.cos(p.lat*Math.PI/180),wrap=v=>((v+180)%360+360)%360-180,bounds=[p.lat-dy,wrap(p.lon-dx),p.lat+dy,wrap(p.lon+dx)].map(v=>v.toFixed(7)).join(',');
 // A cropped relation loses the endpoints needed to close a large river.
 // Only water surfaces receive complete geometry; all other output stays local.
 const selectors=options.baseOnly?['way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]','way["leisure"="park"]']:['way["highway"]','nwr["building"]','way["waterway"]["waterway"!="riverbank"]','nwr["leisure"="park"]','nwr["amenity"]','nwr["healthcare"]','nwr["shop"]','nwr["office"]','nwr["tourism"]','nwr["railway"="station"]'];
 const water=['way["natural"="water"]','relation["natural"="water"]["type"="multipolygon"]','way["waterway"="riverbank"]','relation["waterway"="riverbank"]["type"="multipolygon"]'];
 return '[out:json][timeout:30][maxsize:67108864];('+selectors.map(s=>s+area+';').join('')+')->.local;('+water.map(s=>s+area+';').join('')+')->.water;(.local; - .water;)->.local;.local out geom('+bounds+');.water out geom;';
}
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
function coordinates(geometry){
 if(!Array.isArray(geometry)||geometry.some(p=>!Number.isFinite(p?.lon)||!Number.isFinite(p?.lat)||Math.abs(p.lon)>180||Math.abs(p.lat)>90))return[];
 return geometry.map(p=>[p.lon,p.lat]).filter((p,i,a)=>!i||!same(p,a[i-1]));
}
function fragments(geometry=[]){const result=[];let part=[];for(const p of geometry){if(Number.isFinite(p?.lon)&&Number.isFinite(p?.lat))part.push(p);else{if(part.length>=2)result.push(coordinates(part));part=[];}}if(part.length>=2)result.push(coordinates(part));return result;}
function rings(members,role){
 const remaining=members.filter(m=>m.type==='way'&&(m.role===role||role==='outer'&&!m.role)).map(m=>coordinates(m.geometry)).filter(c=>c.length>=2),closed=[];
 while(remaining.length){
  let ring=remaining.shift(),changed=true;
  while(!same(ring[0],ring[ring.length-1])&&changed){
   changed=false;
   for(let i=0;i<remaining.length;i++){
    let part=remaining[i];const first=ring[0],last=ring[ring.length-1];
    if(same(last,part[0]))ring=ring.concat(part.slice(1));
    else if(same(last,part[part.length-1]))ring=ring.concat(part.slice(0,-1).reverse());
    else if(same(first,part[part.length-1]))ring=part.slice(0,-1).concat(ring);
    else if(same(first,part[0]))ring=part.slice(1).reverse().concat(ring);
    else continue;
    remaining.splice(i,1);changed=true;break;
   }
  }
  if(ring.length>=4&&same(ring[0],ring[ring.length-1]))closed.push(ring);
 }
 return closed;
}
function normalize(raw,input){
 if(!Array.isArray(raw?.elements)||raw.remark)throw Object.assign(Error('地图服务返回了不完整数据，请稍后重试。'),{status:502});
 if(raw.elements.length>30000)throw Object.assign(Error('该区域数据过多，请换一个探索圆心。'),{status:413});
 const p=location(input),meters=radius(input.radius),data={version:3,name:'自动生成街区',center:{...p,name:'探索圆心',address:'纬度 '+p.lat.toFixed(4)+' / 经度 '+p.lon.toFixed(4)},radiusMeters:meters,extentMeters:meters*1.45,source:{name:'OpenStreetMap contributors',url:'https://www.openstreetmap.org/#map=16/'+p.lat+'/'+p.lon,license:'ODbL',licenseUrl:'https://www.openstreetmap.org/copyright',timestamp:raw.osm3s?.timestamp_osm_base||null},features:[],places:[],gameNodes:[],generation:{version:VERSION,mode:'map-data',seed:cacheKey(p,meters)}};
 data.generation.waterVersion=Water.VERSION;
 const geo=Geography.create(data),suppressed=new Set(),unique=new Map();
 const quality=e=>(e.geometry||[]).filter(p=>Number.isFinite(p?.lon)&&Number.isFinite(p?.lat)).length+(e.members||[]).reduce((n,m)=>n+(m.geometry||[]).filter(p=>Number.isFinite(p?.lon)&&Number.isFinite(p?.lat)).length,0);
 for(const e of raw.elements)if(['node','way','relation'].includes(e.type)&&Number.isSafeInteger(e.id)){const key=e.type+'/'+e.id,previous=unique.get(key);if(!previous||quality(e)>=quality(previous))unique.set(key,e);}
 const elements=[...unique.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,e])=>e);
 // Relations may contain disconnected wings and courtyards. Keep both instead of filling the courtyard.
 for(const e of elements.filter(e=>e.type==='relation')){
  const t=e.tags||{};
  if(!(t.building&&t.building!=='no'||Water.isWater(t)||t.leisure==='park'||t.amenity||t.healthcare))continue;
  const outer=rings(e.members||[],'outer'),inner=rings(e.members||[],'inner');
  if(!outer.length)continue;
  outer.forEach((c,i)=>add(e,c,inner.filter(h=>inside(h[0],c)),i));
  if(t.building&&t.building!=='no'||Water.isWater(t)||t.leisure==='park')for(const m of e.members||[])if(m.type==='way')suppressed.add(m.ref);
 }
 for(const e of elements.filter(e=>e.type!=='relation')){
  if(e.type==='way'&&suppressed.has(e.id))continue;
  const c=coordinates(e.geometry);
  if(!c.length&&e.geometry&&(e.tags?.highway||e.tags?.waterway)){fragments(e.geometry).forEach((c,i)=>add(e,c,[],i));continue;}
  add(e,c,[],0);
 }
 function add(e,c,holes,index){
  const t=e.tags||{},ref=e.type+'/'+e.id,id=e.type==='way'?e.id:ref+(index?':'+index:'');
  const closed=c.length>=4&&same(c[0],c[c.length-1]);
  const kind=t.highway?'road':t.building&&t.building!=='no'?'building':Water.isWater(t)?'water':t.waterway?'waterway':t.leisure==='park'?'park':null;
  const source='https://www.openstreetmap.org/'+ref;
  if(kind&&c.length>=2&&(['road','waterway'].includes(kind)||closed)){const feature={id,kind,name:t.name||'',class:t.highway||t.building||'',tags:t,coordinates:c,holes,source};data.features.push(...(kind==='water'?Water.clip(feature,data):[feature]));}
  if(category(t)==='generic')return;
  const point=e.type==='node'?e:closed?center(c):e.center;
  if(!point||!Number.isFinite(point.lon)||!Number.isFinite(point.lat))return;
  data.places.push({id:ref+(index?':'+index:''),name:t.name||'',tags:t,lon:point.lon,lat:point.lat,coordinates:closed?c:[],holes,source});
 }
 const rank={hospital:0,clinic:1,school:2,mall:3,station:4,police:5,government:6,library:7};
 const places=data.places.map(place=>({place,rank:rank[category(place.tags)]??8,distance:geo.distance(place.lon,place.lat)})).filter(entry=>entry.distance<=geo.radius).sort((a,b)=>a.rank-b.rank||a.distance-b.distance||a.place.id.localeCompare(b.place.id));
 data.gameNodes=places.slice(0,32).map(({place})=>({id:'place-'+place.id.replace(/[^a-z0-9]/gi,'-'),placeId:place.id,name:place.name||undefined,lon:place.lon,lat:place.lat,address:[place.tags['addr:street'],place.tags['addr:housenumber']].filter(Boolean).join(' ')}));
 data.generation.counts={roads:data.features.filter(f=>f.kind==='road').length,buildings:data.features.filter(f=>f.kind==='building').length,places:data.gameNodes.length};
 return DataPolicy.cleanMap(data);
}
module.exports={VERSION,WATER_VERSION:Water.VERSION,location,radius,cacheKey,query,normalize};
