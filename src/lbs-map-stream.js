// Shared map-window planning. Browsing never changes the underlying WGS84 data.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./coop-geography.js'));else root.LBSMapStream=factory(root.CoopGeography);})(typeof globalThis!=='undefined'?globalThis:this,function(Geography){
 'use strict';
 const EARTH=6378137,RAD=Math.PI/180;
 const wrap=v=>((v+180)%360+360)%360-180;
 function distance(a,b){const x=(b.lat-a.lat)*RAD,y=wrap(b.lon-a.lon)*RAD,h=Math.sin(x/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin(y/2)**2;return EARTH*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
 function extent(region){return region.extentMeters||region.radiusMeters;}
 function reserve(view){return Math.max(0,Math.min(3200,Math.max(2000,view.radius*1.1),6000*1.45*.9-view.radius-900));}
 function covers(region,view,padding=0){return distance(region.center,view.center)+view.radius+80+padding<=extent(region)*.9;}
 function ready(region,view){return covers(region,view,reserve(view));}
 function heading(view,previous){if(!previous)return null;const geo=Geography.create({center:{...view.center,crs:'WGS84'},radiusMeters:1000}),p=geo.local(previous.center.lon,previous.center.lat),length=Math.hypot(p.east,p.north);return length>10?{east:-p.east/length,north:-p.north/length}:null;}
 function drawReady(region,view,previous){
  if(!covers(region,view))return false;const direction=heading(view,previous)||region.renderHeading;
  if(!direction)return covers(region,view,250);
  const geo=Geography.create({center:{...view.center,crs:'WGS84'},radiusMeters:1000});return covers(region,{...view,center:geo.coordinate(direction.east*650,direction.north*650)},150);
 }
 function plan(view,previous){
  let center={...view.center};
  if(previous){const geo=Geography.create({center:{...view.center,crs:'WGS84'},radiusMeters:1000}),delta=geo.local(previous.center.lon,previous.center.lat),length=Math.hypot(delta.east,delta.north);if(length>20){const ahead=Math.min(1400,Math.max(0,6000*1.45*.9-view.radius-reserve(view)-500));center=geo.coordinate(-delta.east/length*ahead,-delta.north/length*ahead);}}
  // Fixed cells let a small camera movement reuse the same server cache key.
  const cell=view.radius>6500?.0025:.005;center={lat:Number((Math.round(center.lat/cell)*cell).toFixed(4)),lon:Number(wrap(Math.round(center.lon/cell)*cell).toFixed(4)),crs:'WGS84'};
  center.lat=Math.max(-85,Math.min(85,center.lat));
  const padding=reserve(view)+800,meters=(distance(center,view.center)+view.radius+padding+80)/(.9*1.45);
  return{center,radius:Math.min(6000,Math.max(1000,Math.ceil(meters/500)*500))};
 }
 function subset(data,point,meters){
  const geo=Geography.create({center:{...point,crs:'WGS84'},radiusMeters:meters}),limit=meters*1.45;
  function near(ring){if(!ring?.length)return false;const b=[Infinity,Infinity,-Infinity,-Infinity];for(const c of ring){const p=geo.local(...c);b[0]=Math.min(b[0],p.east);b[1]=Math.min(b[1],p.north);b[2]=Math.max(b[2],p.east);b[3]=Math.max(b[3],p.north);}return b[0]<=limit&&b[2]>=-limit&&b[1]<=limit&&b[3]>=-limit;}
  const features=data.features.filter(f=>near(f.coordinates)),places=data.places.filter(p=>near(p.coordinates)||geo.distance(p.lon,p.lat)<=limit),ids=new Set(places.map(p=>p.id));
  return{...data,center:{...point,crs:'WGS84',name:'探索圆心',address:'纬度 '+point.lat.toFixed(4)+' / 经度 '+point.lon.toFixed(4)},radiusMeters:meters,extentMeters:limit,features,places,gameNodes:data.gameNodes.filter(n=>ids.has(n.placeId)),generation:{...data.generation,counts:{roads:features.filter(f=>f.kind==='road').length,buildings:features.filter(f=>f.kind==='building').length,places:places.length}}};
 }
 function renderPlan(view,previous){
  const meters=Math.min(6000,Math.max(1000,Math.ceil((view.radius+1000)/(.9*1.45*500))*500));
  const direction=heading(view,previous),geo=Geography.create({center:{...view.center,crs:'WGS84'},radiusMeters:1000}),advance=direction?Math.max(0,Math.min(550,meters*1.45*.9-view.radius-100)):0,center=direction?geo.coordinate(direction.east*advance,direction.north*advance):view.center;
  return{meters,center,direction};
 }
 function detailsReady(region,view){return covers(region,view,1200);}
 function detailRequestReady(region,view,previous){
  if(!detailsReady(region,view))return false;
  const direction=heading(view,previous);if(!direction)return true;
  const geo=Geography.create({center:{...view.center,crs:'WGS84'},radiusMeters:1000}),focus=geo.local(region.center.lon,region.center.lat);
  // A wide request can still cover the camera after its high-priority tiles
  // have fallen behind it. Refocus before distant outer tiles become visible.
  return focus.east*direction.east+focus.north*direction.north>=-1000;
 }
 function detailPlan(view,previous){
  // Downloads need a longer lead than geometry. Start the forward tiles while
  // the current view still has selectable bodies, rather than chasing its edge.
  const direction=heading(view,previous),geo=Geography.create({center:{...view.center,crs:'WGS84'},radiusMeters:1000}),advance=direction?Math.min(2500,view.radius*1.25):0,aim=direction?geo.coordinate(direction.east*advance,direction.north*advance):view.center;
  const cell=.005,center={lat:Math.max(-85,Math.min(85,Number((Math.round(aim.lat/cell)*cell).toFixed(4)))),lon:Number(wrap(Math.round(aim.lon/cell)*cell).toFixed(4)),crs:'WGS84'};
  const meters=Math.min(6000,Math.max(1000,Math.ceil((distance(center,view.center)+view.radius+1780)/(.9*1.45*500))*500));
  return{center,meters};
 }
 function geometryWindow(view,previous){
  const direction=heading(view,previous),geo=Geography.create({center:{...view.center,crs:'WGS84'},radiusMeters:1000}),reserve=Math.min(1600,Math.max(950,view.radius*.75));
  return{...view,center:direction?geo.coordinate(direction.east*600,direction.north*600):view.center,radius:view.radius+reserve};
 }
 function renderWindow(data,view,previous){
  const {meters,center,direction}=renderPlan(view,previous);return distance(data.center,center)+meters*1.45+40<=extent(data)?{...subset(data,center,meters),renderHeading:direction}:data;
 }
 return{distance,extent,reserve,covers,ready,drawReady,plan,subset,renderPlan,renderWindow,detailsReady,detailRequestReady,detailPlan,geometryWindow};
});
