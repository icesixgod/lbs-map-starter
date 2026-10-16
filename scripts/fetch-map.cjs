// Example: node scripts/fetch-map.cjs 51.5074 -0.1278 data/london-map.json
const fs=require('node:fs'),path=require('node:path');
const {createMapService}=require('./district-map-service.cjs');
async function main(){
 const [lat,lon,destination]=process.argv.slice(2),service=createMapService();
 try{const data=await service.load({lat,lon});if(destination){const filename=path.resolve(destination);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,JSON.stringify(data));}console.log(JSON.stringify({center:data.center,counts:data.generation.counts,delivery:data.delivery,destination:destination?path.resolve(destination):null},null,2));}finally{service.close();}
}
main().catch(e=>{console.error(e.message);if(e.cause)console.error('地图服务诊断：',e.cause.message);process.exitCode=1;});
