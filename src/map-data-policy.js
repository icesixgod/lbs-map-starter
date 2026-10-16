'use strict';

// Keep map geometry and semantic tags, never upstream labels or free-form text.
const VERSION=2;
// Road materials and infrastructure dimensions are unnecessary for this demo.
const tagKeys=new Set(['building','building:part','building:levels','building:min_level','height','min_height','roof:height','roof:shape','amenity','healthcare','shop','office','tourism','railway','leisure','natural','water','waterway','highway','landuse','service','access','layer','bridge','tunnel','location','oneway','foot','bicycle','area','type']);
const buildingDimensions=new Set(['height','min_height','roof:height','building:levels','building:min_level']);
const entityKeys=['id','placeId','kind','class','lon','lat','coordinates','holes','source','modelRef','hidden3D','geometryComplete'];
const mapKeys=['version','radiusMeters','extentMeters','source','generation','delivery','renderHeading'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
function tags(value={}){const building=[value.building,value['building:part']].some(v=>v&&v!=='no');return Object.fromEntries(Object.entries(value).filter(([key])=>tagKeys.has(key)&&(!buildingDimensions.has(key)||building)));}
function entity(value){const result=pick(value,entityKeys);if(value.tags)result.tags=tags(value.tags);return result;}
function cleanMap(data){
 const result={...pick(data,mapKeys),namePolicyVersion:VERSION,center:pick(data.center,['lat','lon','crs','osmWay'])};
 if(data.generation)result.generation=pick(data.generation,['version','mode','seed','waterVersion','provider','vectorZoom','buildingVersion','counts','baseOnly']);
 if(data.delivery)result.delivery=pick(data.delivery,['cache','stale','partial','tiles','totalTiles','tileCacheHits']);
 if(data.renderHeading)result.renderHeading=pick(data.renderHeading,['east','north']);
 for(const key of ['features','places','gameNodes'])result[key]=(data[key]||[]).map(entity);
 return result;
}
function rawElement(value){const result=pick(value,['type','id','ref','role','lat','lon','geometry','bounds','center','nodes','version','timestamp']);if(value.tags)result.tags=tags(value.tags);if(value.members)result.members=value.members.map(rawElement);return result;}
function cleanRaw(data){return{...pick(data,['version','source','osm3s']),elements:(data.elements||[]).map(rawElement)};}
module.exports={VERSION,tags,cleanMap,cleanRaw};
