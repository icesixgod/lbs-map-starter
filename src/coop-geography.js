// Pure WGS84 geography shared by the neighborhood map and its validation.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CoopGeography=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const EARTH=6378137,RAD=Math.PI/180;
 function create(data){
  const center=data.center,radius=data.radiusMeters;
  if(center.crs!=='WGS84'||!Number.isFinite(center.lat)||!Number.isFinite(center.lon)||Math.abs(center.lat)>85||Math.abs(center.lon)>180||!Number.isFinite(radius)||radius<=0)throw Error('Invalid district geography');
  const longitudeScale=EARTH*RAD*Math.cos(center.lat*RAD),latitudeScale=EARTH*RAD;
  const wrap=value=>((value+180)%360+360)%360-180;
  function local(lon,lat){return{east:wrap(lon-center.lon)*longitudeScale,north:(lat-center.lat)*latitudeScale};}
  function coordinate(east,north){return{lon:wrap(center.lon+east/longitudeScale),lat:center.lat+north/latitudeScale};}
  function distance(lon,lat){const a=(lat-center.lat)*RAD,b=(lon-center.lon)*RAD,h=Math.sin(a/2)**2+Math.cos(center.lat*RAD)*Math.cos(lat*RAD)*Math.sin(b/2)**2;return EARTH*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
  const width=580,height=500,scale=210/radius;
  function project(lon,lat){const p=local(lon,lat);return{x:width/2+p.east*scale,y:height/2-p.north*scale};}
  function projectLocal(east,north){return{x:width/2+east*scale,y:height/2-north*scale};}
  const nodes=(data.gameNodes||[]).map(n=>{const c=Number.isFinite(n.lon)&&Number.isFinite(n.lat)?{lon:n.lon,lat:n.lat}:coordinate(n.east,n.north);return{...n,...c,distance:distance(c.lon,c.lat),point:project(c.lon,c.lat)};});
  return{center,radius,width,height,scale,local,coordinate,distance,project,projectLocal,nodes,contains:(lon,lat)=>distance(lon,lat)<=radius};
 }
 return{create};
});
