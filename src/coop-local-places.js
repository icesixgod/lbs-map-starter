// Place semantics and footprint matching are shared by the 2D and 3D district.
// A shop inside a tower is a tenant: it never turns the whole tower into a hospital.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./coop-geography.js'),require('./coop-building-merge.js'),require('./coop-street-building-groups.js'),require('./coop-city-blocks.js'));else root.CoopLocalPlaces=factory(root.CoopGeography,root.CoopBuildingMerge,root.CoopStreetBuildingGroups,root.CoopCityBlocks);})(typeof globalThis!=='undefined'?globalThis:this,function(Geography,BuildingMerge,StreetGroups,CityBlocks){
 const types={
  hospital:{label:'医院',icon:'✚',color:'#e5ac88',model:0,description:'门诊与住院楼、医疗十字和入口雨棚'},
  clinic:{label:'诊所',icon:'✚',color:'#e5ac88',model:0,description:'小型医疗建筑与医疗标志'},
  school:{label:'学校',icon:'▤',color:'#d6c286',model:8,description:'教学楼、校门与校园场地'},
  mall:{label:'商场',icon:'▥',color:'#8dbbb1',model:9,description:'商业体、玻璃门面与商业入口'},
  commercial:{label:'商务楼',icon:'▥',color:'#90aab2',model:null,description:'商务楼体与连续玻璃窗带'},
  residence:{label:'住宅',icon:'⌂',color:'#acb39b',model:2,description:'住宅楼体、窗户与屋顶设施'},
  station:{label:'交通设施',icon:'M',color:'#88babf',model:5,description:'地面出入口与交通标志'},
  government:{label:'公共办公',icon:'◎',color:'#c8b89a',model:null,description:'公共办公楼体与行政建筑入口'},
  police:{label:'警务设施',icon:'◇',color:'#8cabc9',model:4,description:'公共建筑与警务标志'},
  library:{label:'图书馆',icon:'▤',color:'#c1aa93',model:23,description:'文化建筑与图书馆入口'},
  culture:{label:'文化设施',icon:'◈',color:'#b8a1bf',model:null,description:'文化建筑楼体与公共入口'},
  hotel:{label:'旅馆',icon:'⌂',color:'#baaaa0',model:25,description:'住宿楼体与连续客房窗户'},
  warehouse:{label:'仓库',icon:'▥',color:'#a5b0ad',model:3,description:'低层仓库与装卸入口'},
  generic:{label:'普通建筑',icon:'▧',color:'#a5b0a2',model:null,description:'按地图轮廓生成的普通楼体'}
 };
 function category(t={}){
  if(t.amenity==='hospital'||t.healthcare==='hospital'||t.building==='hospital')return'hospital';
  if(['clinic','doctors','dentist'].includes(t.amenity)||['clinic','doctor','dentist'].includes(t.healthcare))return'clinic';
  if(['school','kindergarten','college','university'].includes(t.amenity)||['school','kindergarten'].includes(t.building))return'school';
  if(t.shop==='mall'||t.amenity==='marketplace'||t.building==='retail')return'mall';
  if(t.office==='government'||t.amenity==='courthouse')return'government';
  if(t.amenity==='police'||t.building==='police')return'police';
  if(t.amenity==='library')return'library';
  if(['theatre','cinema','arts_centre'].includes(t.amenity)||t.tourism==='museum'||t.leisure==='sports_centre')return'culture';
  if(t.railway==='station'||t.amenity==='bus_station'||['train_station','transportation'].includes(t.building))return'station';
  if(t.tourism==='hotel'||t.building==='hotel')return'hotel';
  if(['apartments','residential','house','dormitory'].includes(t.building))return'residence';
  if(t.building==='warehouse')return'warehouse';
  if(['commercial','office'].includes(t.building)||t.office)return'commercial';
  return'generic';
 }
 function inside(point,polygon){let result=false;const wrap=v=>((v+180)%360+360)%360-180;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const ay=polygon[i][1]-point[1],by=polygon[j][1]-point[1];if((ay>0)!==(by>0)){const ax=wrap(polygon[i][0]-point[0]),bx=wrap(polygon[j][0]-point[0]);if(0<(bx-ax)*(-ay)/(by-ay)+ax)result=!result;}}return result;}
 function center(coordinates,fallback){
  if(coordinates.length<3)return fallback;
  // Translate first to avoid cancellation at longitude 120 degrees.
  const [ox,oy]=coordinates[0],wrap=v=>((v+180)%360+360)%360-180;let area=0,x=0,y=0;
  for(let i=0;i<coordinates.length-1;i++){const a=[wrap(coordinates[i][0]-ox),coordinates[i][1]-oy],b=[wrap(coordinates[i+1][0]-ox),coordinates[i+1][1]-oy],cross=a[0]*b[1]-b[0]*a[1];area+=cross;x+=(a[0]+b[0])*cross;y+=(a[1]+b[1])*cross;}
  if(Math.abs(area)<1e-14)return fallback||{lon:ox,lat:oy};return{lon:wrap(ox+x/(3*area)),lat:oy+y/(3*area)};
 }
 const footprints=BuildingMerge.footprints;
 function contains(point,feature){return footprints(feature).some(f=>inside(point,f.coordinates)&&!f.holes.some(h=>inside(point,h)));}
 function estimatedHeight(id,kind){let hash=2166136261;for(const c of String(id))hash=Math.imul(hash^c.charCodeAt(0),16777619);const base={hospital:22,school:15,mall:18,commercial:32,residence:24,government:24,warehouse:7,station:4,generic:14}[kind]||18;return Math.round(base*(.8+(hash>>>0)%9*.05));}
 function spatialIndex(buildings,geo){
  const coverage=new Map(),centers=new Map(),sources=new Map(),cell=120;
  const box=coordinates=>coordinates.map(c=>geo.local(...c)).reduce((r,p)=>[Math.min(r[0],p.east),Math.min(r[1],p.north),Math.max(r[2],p.east),Math.max(r[3],p.north)],[Infinity,Infinity,-Infinity,-Infinity]);
  function cells(bounds,callback){const lowX=Math.max(-128,Math.floor(bounds[0]/cell)),lowY=Math.max(-128,Math.floor(bounds[1]/cell)),highX=Math.min(128,Math.floor(bounds[2]/cell)),highY=Math.min(128,Math.floor(bounds[3]/cell));for(let x=lowX;x<=highX;x++)for(let y=lowY;y<=highY;y++)callback(x+','+y);}
  function add(map,key,b){if(!map.has(key))map.set(key,[]);map.get(key).push(b);}
  for(const b of buildings){if(b.underground)continue;for(const f of footprints(b))cells(box(f.coordinates),key=>add(coverage,key,b));add(centers,Math.floor(b.east/cell)+','+Math.floor(b.north/cell),b);add(sources,b.source,b);}
  function inBox(bounds){const result=new Set();cells(bounds,key=>{for(const b of centers.get(key)||[])result.add(b);});return [...result];}
  return{point:p=>coverage.get(Math.floor(p.east/cell)+','+Math.floor(p.north/cell))||[],polygon:p=>inBox(box(p.coordinates)),source:p=>sources.get(p.source)||[],near:p=>inBox([p.east-150,p.north-150,p.east+150,p.north+150])};
 }
 function create(data,options={}){
  const geo=Geography.create(data),allPlaces=(data.places||[]).map(p=>{const c=center(p.coordinates,{lon:p.lon,lat:p.lat}),local=geo.local(c.lon,c.lat);return{...p,...c,...local,kind:category(p.tags),distance:geo.distance(c.lon,c.lat),source:p.source||'https://www.openstreetmap.org/'+p.id};});
  const campuses=allPlaces.filter(p=>p.coordinates.length>3&&['hospital','school'].includes(p.kind));
  let buildings=data.features.filter(f=>f.kind==='building').map(f=>{
   const c=center(f.coordinates),local=geo.local(c.lon,c.lat),ownKind=category(f.tags),campus=campuses.find(p=>p.source===(f.source||'https://www.openstreetmap.org/way/'+f.id)||contains([c.lon,c.lat],p));
   // Only a genuine campus boundary may override a generic footprint's use.
   const kind=campus&&['generic','school','hospital'].includes(ownKind)?campus.kind:ownKind;
   const levels=parseFloat(f.tags?.['building:levels']),tagHeight=parseFloat(f.tags?.height),hasHeight=Number.isFinite(tagHeight)&&tagHeight>0,hasLevels=Number.isFinite(levels)&&levels>0,height=hasHeight?tagHeight:hasLevels?levels*3.2:estimatedHeight(f.id,kind);
   const minimum=parseFloat(f.tags?.min_height??f.tags?.['building:min_level']*3.2),top=Math.min(220,height),minHeight=Number.isFinite(minimum)?Math.max(0,Math.min(top-.1,minimum)):0;
   return{...f,...c,...local,kind,height:top,minHeight,connectionHeight:height,connectionMinHeight:Number.isFinite(minimum)?Math.max(0,minimum):0,heightSource:hasHeight?'map-height':hasLevels?'map-levels':'estimated',modelOrigin:data.source?.provider||'osm',incomplete:f.geometryComplete===false,hidden3D:!!f.hidden3D||f.geometryComplete===false,underground:Number(f.tags?.layer)<0||['underground','underwater'].includes(f.tags?.location),facilityId:campus?.id||null,facilityName:campus?.name||f.name||'',source:f.source||'https://www.openstreetmap.org/way/'+f.id};
  });
  const index=spatialIndex(buildings,geo);
  for(const p of allPlaces){
   const contained=[...new Set(index.point(p))].filter(b=>contains([p.lon,p.lat],b));
   const matching=p.coordinates.length>3?index.polygon(p).filter(b=>contains([b.lon,b.lat],p)):[];
   const direct=index.source(p),candidates=direct.length?[...new Set([...direct,...matching])]:matching.length?matching:contained;
   if(candidates.length&&['mall','library','clinic'].includes(p.kind)&&(p.coordinates.length>3||p.kind==='mall'))for(const b of candidates){if(['generic','commercial'].includes(b.kind)){b.kind=p.kind;b.facilityId=p.id;b.facilityName=p.name;}}
   p.buildingIds=candidates.filter(b=>!['hospital','school'].includes(p.kind)||b.kind===p.kind).map(b=>b.id);
   // A subway's point is below ground; its visible models are tagged surface entrances.
   if(p.kind==='station'&&p.tags.railway==='station')p.buildingIds=index.near(p).filter(b=>b.kind==='station'&&Math.hypot(b.east-p.east,b.north-p.north)<150).map(b=>b.id);
  }
  // Detailed maps keep each body independent for both selection and rendering.
  const sourceBuildings=buildings,merged=options.detail?{buildings,idMap:new Map(buildings.map(b=>[b.id,b.id])),stats:{original:buildings.length,total:buildings.length,groups:0,removed:0}}:BuildingMerge.merge(buildings,geo),protectedIds=new Set(allPlaces.filter(p=>!StreetGroups.smallKinds.has(p.kind)).flatMap(p=>p.buildingIds));
  // The streamed map already draws the original footprints. Street grouping
  // only adds a costly summary that would immediately be expanded again.
  const grouped=options.detail?{buildings:merged.buildings,idMap:new Map(merged.buildings.map(b=>[b.id,b.id])),stats:{groups:0,removed:0}}:StreetGroups.group(merged.buildings,data.features,geo,protectedIds);buildings=grouped.buildings;
  for(const p of allPlaces)p.buildingIds=[...new Set(p.buildingIds.map(id=>grouped.idMap.get(merged.idMap.get(id))))];
  const candidates=(data.gameNodes||[]).map(n=>{const p=allPlaces.find(p=>p.id===n.placeId);if(!p)throw Error('Missing real local place: '+n.placeId);const name=n.name||p.name||types[p.kind].label;return{...p,placeId:p.id,id:n.id,name,shortName:n.shortName||name,address:n.address||'',point:geo.project(p.lon,p.lat)};}).filter(p=>p.distance<=geo.radius);
  // Duplicate facilities on a merged building get one marker, list entry and selectable name.
  const buildingById=new Map(buildings.map(b=>[b.id,b])),owners=new Map(),parents=candidates.map((_,i)=>i);
  function find(i){while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;}
  candidates.forEach((p,i)=>{for(const id of p.buildingIds)if(buildingById.get(id)?.mergedCount>1){if(owners.has(id))parents[find(i)]=find(owners.get(id));else owners.set(id,i);}});
  const placeGroups=new Map();candidates.forEach((p,i)=>{const key=find(i);if(!placeGroups.has(key))placeGroups.set(key,[]);placeGroups.get(key).push(p);});
  const featured=[];owners.clear();
  for(const group of placeGroups.values()){
   const p=group[0];p.buildingIds=[...new Set(group.flatMap(p=>p.buildingIds))];p.placeIds=group.map(p=>p.placeId);featured.push(p);
   for(const id of p.buildingIds)if(buildingById.get(id)?.mergedCount>1)owners.set(id,p);
  }
  for(const b of buildings)if(b.mergedCount>1){
   const p=owners.get(b.id);
   if(b.streetGroup){
    const fields={name:b.name,shortName:b.name,kind:b.kind,kinds:b.kinds,streetGroup:b.streetGroup,lon:b.lon,lat:b.lat,east:b.east,north:b.north,point:geo.project(b.lon,b.lat),distance:geo.distance(b.lon,b.lat),address:b.streetGroup.name,buildingIds:[b.id]};
    if(p)Object.assign(p,fields);else if(geo.contains(b.lon,b.lat))featured.push({...b,...fields,id:'street-group-'+String(b.id).replace(/[^a-z0-9]/gi,'-'),placeIds:[]});
   }else if(p){b.name=p.name;b.facilityName=p.name;}else if(!b.name)b.name=types[b.kind].label;
  }
  const counts={};for(const b of buildings.filter(b=>geo.contains(b.lon,b.lat)&&!b.underground))counts[b.kind]=(counts[b.kind]||0)+1;
  const local={geo,buildings,sourceBuildings,places:featured,allPlaces,counts,types,selectionLandmarks:data.center.osmWay&&data.center.name?[data.center]:[],buildingMerge:{...merged.stats,total:buildings.length,groups:merged.stats.groups+grouped.stats.groups,removed:merged.stats.removed+grouped.stats.removed,overlapGroups:merged.stats.groups,overlapRemoved:merged.stats.removed},streetGrouping:grouped.stats};
  if(options.detail)return local;
  const blocks=CityBlocks.create(data,local);
  return{...local,...blocks,sourcePlaces:featured};
 }
 function matches(kind,filter){if(typeof kind==='object')return(kind.kinds||[kind.kind]).some(k=>matches(k,filter));return filter==='all'||kind===filter||filter==='hospital'&&kind==='clinic'||filter==='mall'&&['commercial','hotel'].includes(kind);}
 return{create,category,inside,center,contains,footprints,types,matches};
});
