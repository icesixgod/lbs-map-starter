// Map presentation only. Building geometry and uses come from the map source.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LBSMapModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function validPoint(p){return !!p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=85&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180;}
 function createBuildingLabels(){
  const assigned=new Map();let serial=0;
  return function(region){
   if(!region)return'建筑';
   const ids=[region.id,...(region.memberIds||[])].filter(id=>id!=null).map(String),existing=ids.map(id=>assigned.get(id)).filter(Number.isFinite),number=existing.length?Math.min(...existing):++serial;
   for(const id of ids)assigned.set(id,number);
   return'建筑 '+String(number).padStart(3,'0');
  };
 }
 const DISTRICT_THEMES=Object.freeze([
  {id:'medical',color:'#b6d4c6',kinds:['hospital','clinic']},
  {id:'education',color:'#e1c997',kinds:['school']},
  {id:'industrial',color:'#d8b593',kinds:['warehouse']},
  {id:'commercial',color:'#bad0dd',kinds:['mall','commercial','hotel']},
  {id:'civic',color:'#c9bddb',kinds:['government','police','library','culture','station']},
  {id:'residential',color:'#c7cea7',kinds:['residence','generic']}
 ].map(theme=>Object.freeze({...theme,kinds:Object.freeze(theme.kinds),fillOpacity:.1,selectedOpacity:.3,selectedColor:'#ff9f1c',selectedStrokeColor:'#c65300'})));
 function districtTheme(region){return DISTRICT_THEMES.find(theme=>theme.kinds.some(kind=>region?.kind===kind||region?.kinds?.includes(kind)))||DISTRICT_THEMES.at(-1);}
 return{validPoint,createBuildingLabels,DISTRICT_THEMES,districtTheme};
});
