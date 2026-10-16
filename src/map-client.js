(function(){
  'use strict';
  const $=id=>document.getElementById(id),L=LBSMapModel;
  const homeName=LBS_DISTRICT_DATA.center.name||'默认起点';
  if(globalThis.LBS_MAP_STATIC_DEMO===true){
    $('project-caption').textContent='开源街区地图';$('project-source').hidden=false;
    $('region-button').hidden=true;$('gps-button').hidden=true;
    $('map-hint').textContent='拖动浏览 · 滚轮缩放 · 点击建筑查看详情 · 上海街区演示';
  }
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data=LBS_DISTRICT_DATA,local,mapData=data,mapLocal,selected=null,selectedDistrict=null,districts=null,scene=null,mode='map',position=null,watch=null,gpsError='',twoD=false,filter='all';
  let toastTimer,returnFocus=null,request=null,requestVersion=0,buildingPage=0;
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
  function selectedMapPlace(){return selectedDistrict;}
  function openBrief(){if(selectedDistrict){$('building-inspector').hidden=false;scene?.invalidateLabels?.();}}
  function closeBrief(restore=true){
    const hadFocus=$('building-inspector').contains(document.activeElement);selected=null;selectedDistrict=null;$('building-inspector').hidden=true;$('building-marker').hidden=true;scene?.setSelected(null,false);updateDistrictPaths();
    for(const button of $('building-list').querySelectorAll('button'))button.setAttribute('aria-pressed','false');
    if(restore&&hadFocus)$('building-list-toggle').focus({preventScroll:true});
  }
  $('building-close').onclick=()=>closeBrief();$('building-marker').onclick=openBrief;
  function buildMarkers(){const marker=$('building-marker');marker.textContent=selectedDistrict?.name||'';marker.setAttribute('aria-label',selectedDistrict?'查看建筑：'+selectedDistrict.name:'查看已选建筑');marker.hidden=!selectedDistrict;scene?.invalidateLabels?.();if(twoD)layout2D();}
  function mapLabelCandidates(bounds){const r=selectedDistrict;return r&&CoopLocalPlaces.matches(r,filter)&&r.east>=bounds[0]&&r.east<=bounds[2]&&r.north>=bounds[1]&&r.north<=bounds[3]?[r]:[];}
  function layoutProjectedMapLabels(candidates,view){const c=candidates.find(c=>c.id===selectedDistrict?.id),marker=$('building-marker');marker.hidden=!c;if(c){marker.style.left=c.x+'px';marker.style.top=c.y+'px';}}
  function toggleBuildingList(open=$('building-browser').hidden){
    $('building-browser').hidden=!open;$('building-list-toggle').setAttribute('aria-expanded',String(open));
    if(open){renderBuildingList();$('building-search').focus({preventScroll:true});}
  }
  $('building-list-toggle').onclick=()=>toggleBuildingList($('building-browser').hidden);
  $('building-list-close').onclick=()=>{toggleBuildingList(false);$('building-list-toggle').focus({preventScroll:true});};
  $('building-search').oninput=()=>{buildingPage=0;renderBuildingList();};
  $('building-prev').onclick=()=>{buildingPage--;renderBuildingList();};$('building-next').onclick=()=>{buildingPage++;renderBuildingList();};
  function updateDistrictChoices(){
    $('building-count').textContent=(districts?.regions.length||0).toLocaleString()+' 栋已载入建筑';
    if(!$('building-browser').hidden)renderBuildingList();
  }
  function renderBuildingList(){
    const query=$('building-search').value.trim().toLocaleLowerCase(),items=(districts?.regions||[]).filter(r=>CoopLocalPlaces.matches(r,filter)&&(!query||(r.name+' '+(CoopLocalPlaces.types[r.kind]?.label||'')+' '+(r.street||'')).toLocaleLowerCase().includes(query)));
    const pages=Math.max(1,Math.ceil(items.length/30));buildingPage=Math.max(0,Math.min(pages-1,buildingPage));
    $('building-list-status').textContent=items.length?'共 '+items.length.toLocaleString()+' 栋 · 点击名称定位建筑':'没有符合条件的建筑';
    $('building-list').innerHTML=items.slice(buildingPage*30,buildingPage*30+30).map(r=>'<button data-building-id="'+esc(r.id)+'" aria-pressed="'+(r.id===selectedDistrict?.id)+'"><span>'+esc(r.name)+'</span><small>'+esc(CoopLocalPlaces.types[r.kind]?.label||'建筑')+'</small></button>').join('');
    $('building-page').textContent=(buildingPage+1)+' / '+pages;$('building-prev').disabled=buildingPage===0;$('building-next').disabled=buildingPage===pages-1;
  }
  $('building-list').onclick=event=>{const button=event.target.closest('button[data-building-id]'),region=districts?.byId.get(button?.dataset.buildingId);if(!region)return;selectMapDistrict(region);focusSelectedBuilding();if(window.matchMedia('(max-width:580px)').matches)toggleBuildingList(false);};
  function updatePosition(focus=false){
    if(!mapLocal)return;
    if(position&&L.validPoint(position)){
      const p=mapLocal.geo.local(position.lon,position.lat);scene?.setPosition(p,focus);
      if(mode==='gps'&&mapGPSFollow&&!scene?.dragging&&!twoDPointer){const view=currentMapView();if(twoD)set2DView({...view,center:position});else scene?.followPosition?.(p);scheduleMapView();}
      $('location-title').textContent='设备位置 / WGS84';$('location-detail').textContent=position.lat.toFixed(5)+', '+position.lon.toFixed(5)+' · ±'+Math.round(position.accuracy)+' m';$('location-signal').textContent=Date.now()-position.time<=30000?'GPS':'过期';
    }else{
      scene?.setPosition(null);$('player-marker').hidden=true;$('location-title').textContent=mode==='gps'?'等待设备定位':data.generation?'当前探索区域':homeName;$('location-detail').textContent=gpsError||'WGS84 · 未使用设备定位';$('location-signal').textContent=mode==='gps'?'未定位':'MAP';
    }
    if(twoD)layout2D();
  }
  function renderBuildingSelection(){
    const r=selectedDistrict;if(!r){$('building-inspector').hidden=true;return;}
    selected=r;$('building-name').textContent=r.name;$('building-kind').textContent=CoopLocalPlaces.types[r.kind]?.label||'普通建筑';
    $('building-height').textContent=Number.isFinite(r.height)?Math.round(r.height*10)/10+' m':'—';$('building-area').textContent=Number.isFinite(r.area)?r.area.toLocaleString()+' m²':'—';
    $('building-height-note').textContent=r.heightSource==='map-height'?'高度来自地图标注':r.heightSource==='map-levels'?'高度按地图标注楼层估算':'高度为地图展示估算值';
    $('building-lat').textContent=r.lat.toFixed(6);$('building-lon').textContent=r.lon.toFixed(6);$('building-street').textContent=r.street||'';$('building-street').hidden=!r.street;
    const link=$('building-source');let url=null;try{const parsed=new URL(r.source);if(parsed.protocol==='https:'||parsed.protocol==='http:')url=parsed.href;}catch{}link.hidden=!url;if(url)link.href=url;else link.removeAttribute('href');
    $('building-inspector').hidden=false;updateDistrictPaths();buildMarkers();
    for(const button of $('building-list').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.buildingId===r.id));
  }
  function renderDistrictContext(){updateDistrictChoices();renderBuildingSelection();}
  function focusSelectedBuilding(){if(!selectedDistrict||!mapLocal)return;const view={...currentMapView(),center:{lat:selectedDistrict.lat,lon:selectedDistrict.lon},span:900};mapGPSFollow=false;scene?.setView(view);if(twoD)set2DView(view);scheduleMapView();}
  $('focus-building').onclick=focusSelectedBuilding;
  function mountPreparedMapSvg(){if(mapPreparedSvg?.data!==mapData)return;const prepared=mapPreparedSvg;mapPreparedSvg=null;$('map-2d').replaceChildren(...prepared.svg.childNodes);updateDistrictPaths();}
  function updateDistrictPaths(){if(mapPreparedSvg?.data===mapData)return;for(const p of $('map-2d').querySelectorAll('[data-district]')){const active=p.dataset.district===selectedDistrict?.id;p.classList.toggle('selected',active);p.setAttribute('aria-pressed',String(active));}}
  function layout2D(){
    if(!twoD||!mapLocal)return;const svg=$('map-2d'),rect=svg.getBoundingClientRect(),box=svg.viewBox.baseVal,scale=Math.min(rect.width/box.width,rect.height/box.height),ox=(rect.width-box.width*scale)/2,oy=(rect.height-box.height*scale)/2;if(!(scale>0))return;
    const visibleBounds=[box.x-ox/scale,-box.y-(rect.height-oy)/scale,box.x+(rect.width-ox)/scale,-box.y+oy/scale],screen=p=>({x:ox+(p.east-box.x)*scale,y:oy+(-p.north-box.y)*scale}),meters=box.width<1500?100:box.width>3500?500:200;
    $('map-scale-label').textContent=meters+' m';$('map-scale-line').style.width=(meters*scale)+'px';
    for(const p of svg.querySelectorAll('[data-district]')){const r=districts?.byId.get(p.dataset.district),visible=r&&CoopLocalPlaces.matches(r,filter);p.toggleAttribute('hidden',!visible);p.setAttribute('tabindex',visible&&r.bounds[2]>=visibleBounds[0]&&r.bounds[0]<=visibleBounds[2]&&r.bounds[3]>=visibleBounds[1]&&r.bounds[1]<=visibleBounds[3]?'0':'-1');}
    const ring=$('player-ring-2d');$('player-marker').hidden=!position;if(position){const p=mapLocal.geo.local(position.lon,position.lat),s=screen(p);$('player-marker').style.left=s.x+'px';$('player-marker').style.top=s.y+'px';$('player-marker').hidden=s.x<0||s.y<0||s.x>rect.width||s.y>rect.height;ring?.setAttribute('cx',p.east);ring?.setAttribute('cy',-p.north);ring?.removeAttribute('hidden');}else ring?.setAttribute('hidden','');
    layoutProjectedMapLabels(mapLabelCandidates(visibleBounds).map(r=>({id:r.id,...screen(r)})),{width:rect.width,height:rect.height});
  }
  let mapCache=[],mapBaseCache=[],mapLocals=new WeakMap(),mapDistrictRegions=new WeakMap(),streamTimer=null,streamRequest=null,streamVersion=0,streamLoading=false,streamQueued=false,twoDPointer=null,nextMapRequestAt=0,twoDLayoutFrame=0,streamLatestView=null,streamPreviousView=null,streamDetailTimer=null,streamDetailRequest=null,mapInitialPreview=false,mapDetailRetry=null;
  let mapInputActive=false,mapLastInputAt=-Infinity,mapSettleTimer=null,mapGPSFollow=true,mapGPSFixCount=0,streamGPSAnchor=null,streamPreparedModel=null,mapEarlyDetails=null;
  let mapBuildings=true;
  const mapAttribution=globalThis.LBS_MAP_STATIC_DEMO===true?'内置街区演示 · 在线补载与 GPS 请在本地运行时体验':'地图资料来自 OpenStreetMap / OpenMapTiles';
  function setMapStatus(message,phase='idle'){
    $('map-status').textContent=message;const badge=$('map-load-state');badge.hidden=phase==='idle';badge.dataset.state=phase;$('map-load-text').textContent=message;$('retry-map').hidden=phase!=='error';$('lbs-app').dataset.mapLoadState=phase;
  }
  $('retry-map').onclick=()=>{mapDetailRetry=null;scheduleMapView(currentMapView(),0);};
  function currentMapView(){
    if(!mapLocal)return{center:mapData.center,span:1600,radius:1200};
    if(!twoD&&scene)return scene.view;
    const b=$('map-2d').viewBox.baseVal,rect=$('district-map').getBoundingClientRect(),scale=Math.min(rect.width/b.width,rect.height/b.height);
    return{center:mapLocal.geo.coordinate(b.x+b.width/2,-b.y-b.height/2),span:b.height,radius:Math.ceil(scale>0?Math.hypot(rect.width,rect.height)/(2*scale):Math.hypot(b.width,b.height)/2)};
  }
  function requestedMapView(){return currentMapView();}
  function set2DView(view){
    const p=mapLocal.geo.local(view.center.lon,view.center.lat),size=view.span;
    $('map-2d').setAttribute('viewBox',[p.east-size/2,-p.north-size/2,size,size].join(' '));layout2D();
  }
  let mapBuildRequest=null,mapBuildSerial=0,mapInitSerial=0,mapScoped=new WeakSet(),mapRenderPreference=false,sceneModelData=null,preparedMapCache=[],mapPreparedSvg=null,mapSvgDirty=false;
  const preparedMapCacheLimit=2,preparedMapCacheUnits=100000;
  const mapBuildHistory=[];
  function preparedMap(next,basis){const index=preparedMapCache.findIndex(e=>e.data===next&&e.basisData===basis.data);if(index<0)return null;const entry=preparedMapCache.splice(index,1)[0];preparedMapCache.unshift(entry);return entry;}
  function rememberPreparedMap(next,basis,scoped,nextDistricts){
    const model=scoped.value.local;let units=model.buildings.length+model.places.length+(model.allPlaces?.length||0)+(model.sourcePlaces?.length||0);if(units>preparedMapCacheUnits)return;
    for(const b of model.sourceBuildings||model.buildings){for(const f of CoopLocalPlaces.footprints(b))units+=f.coordinates.length+(f.holes||[]).reduce((n,r)=>n+r.length,0);if(units>preparedMapCacheUnits)return;}
    for(const r of nextDistricts.regions){units+=1+r.rings.reduce((n,ring)=>n+ring.length,0)+r.coordinates.length+r.holes.reduce((n,ring)=>n+ring.length,0)+r.buildingIds.length+r.placeIds.length;if(units>preparedMapCacheUnits)return;}
    preparedMapCache=preparedMapCache.filter(e=>e.data!==next);preparedMapCache.unshift({data:next,basisData:basis.data,scoped:scoped.value,districts:nextDistricts,units});
    while(preparedMapCache.length>preparedMapCacheLimit||preparedMapCache.reduce((n,e)=>n+e.units,0)>preparedMapCacheUnits)preparedMapCache.pop();
  }
  function cachedMapMetrics(phase){return{phase,cacheHit:true,totalWallMs:0,cpuMs:0,maxContinuousMs:0,atomicMaxMs:0,yields:0,turns:0,units:0};}
  function mapTrace(kind){const t={id:++mapBuildSerial,kind,startedAt:performance.now(),events:[],lastPhase:null,lastEvent:0};mapBuildHistory.push(t);if(mapBuildHistory.length>6)mapBuildHistory.shift();return t;}
  const mapTraceMilestones=new Set(['network-start','network-headers','network-body-ready','new-map-input-attached','all-content-ready','cancelled','failed','obsolete-model-region','obsolete-prepared-region']);
  function mapRecord(t,name,details={}){
    const now=performance.now();if(!mapTraceMilestones.has(name)&&t.lastPhase===name&&now-t.lastEvent<80)return;t.lastPhase=name;t.lastEvent=now;t.events.push({name,ms:now-t.startedAt,...details});
    if(t.events.length>160){
      // Keep each current milestone's complete latest record within this trace.
      const latest=new Map();t.events.forEach((event,i)=>{if(mapTraceMilestones.has(event.name))latest.set(event.name,i);});
      const discard=t.events.findIndex((event,i)=>i>0&&latest.get(event.name)!==i);t.events.splice(discard,1);
    }
  }
  function mapAbortError(){const e=Error('Map preparation stopped');e.name='AbortError';return e;}
  function checkMapBuild(controller){if(controller.signal.aborted||mapBuildRequest!==controller)throw mapAbortError();}
  function cancelMapBuild(){mapBuildRequest?.abort();mapBuildRequest=null;}
  function* scopeMapSteps(next,nextLocal,basis,fresh){
    const unscoped=nextLocal;nextLocal={...unscoped,buildings:[],places:[],allPlaces:[],sourcePlaces:[]};const copies=new Map();
    function copy(value){if(!copies.has(value))copies.set(value,{...value});return copies.get(value);}
    for(const b of unscoped.buildings){nextLocal.buildings.push(copy(b));yield 'copy-view-buildings';}
    for(const key of['places','allPlaces','sourcePlaces'])for(const p of unscoped[key]||[]){nextLocal[key].push(copy(p));yield 'copy-view-places';}
    return{local:nextLocal};
  }
  function* mapSvgSteps(next,nextLocal,nextDistricts){
    const prepared=document.createElementNS('http://www.w3.org/2000/svg','svg'),group=document.createElementNS('http://www.w3.org/2000/svg','g');let pieces=[];
    function flush(){if(!pieces.length)return;group.innerHTML=pieces.join('');pieces=[];while(group.firstChild)prepared.appendChild(group.firstChild);}
    function* path(coords){const parts=[];for(let i=0;i<coords.length;i++){const p=nextLocal.geo.local(...coords[i]);parts.push((i?'L':'M')+p.east.toFixed(1)+' '+(-p.north).toFixed(1));if(i%64===63)yield 'svg-coordinates';}return parts.join(' ');}
    for(const kind of['water','park','road'])for(const f of next.features){if(f.kind===kind&&f.coordinates.length>1){let holes='';if(kind!=='road')for(const ring of f.holes||[])holes+=' '+(yield* path(ring))+'Z';pieces.push('<path class="'+esc(f.kind)+'" fill-rule="evenodd"'+(kind==='road'?' style="stroke-width:'+CoopCityBlocks.roadWidth(f)+'"':'')+' d="'+(yield* path(f.coordinates))+(kind==='road'?'':'Z'+holes)+'"/>');}if(pieces.length>=80)flush();yield 'svg-features';}
    for(const b of nextLocal.sourceBuildings||nextLocal.buildings){if(!b.underground&&!b.incomplete){let holes='';for(const ring of b.holes||[])holes+=(yield* path(ring))+'Z ';pieces.push('<path class="footprint" data-building="'+esc(b.id)+'" fill-rule="evenodd" d="'+(yield* path(b.coordinates))+'Z '+holes.trimEnd()+'"/>');}if(pieces.length>=80)flush();yield 'svg-buildings';}
    pieces.push('<circle id="player-ring-2d" r="80" fill="#54b3ed30" stroke="#6cbcdf" stroke-width="4"/>');
    for(const region of nextDistricts.regions){let holes='';for(const ring of region.holes)holes+=(yield* path(ring))+'Z ';pieces.push('<path class="district-region" data-district="'+esc(region.id)+'" data-boundary-source="'+esc(region.boundarySource||'building')+'" role="button" tabindex="0" aria-label="'+esc(region.name)+'，'+region.buildingCount+'栋地图建筑" aria-pressed="false" fill-rule="evenodd" d="'+(yield* path(region.coordinates))+'Z '+holes.trimEnd()+'"/>');if(pieces.length>=80)flush();yield 'svg-districts';}flush();yield 'svg-ready';return prepared;
  }
  function selectMapDistrict(region,focus=false){
    if(!region)return;selectedDistrict=region;selected=region;scene?.setSelected(region,false);renderBuildingSelection();if(focus)focusSelectedBuilding();
  }
  // Prepare new selection in the live scene's coordinate system. Old visible
  // bodies keep their selection even when the latest source omits them.
  function* streamMapModelSteps(model,currentLocal,currentDistricts,currentScene,basis){
    const geo=currentLocal.geo,byBuilding=new Map(),copies=new Map();
    function copy(value){if(!copies.has(value))copies.set(value,{...value,...geo.local(value.lon,value.lat)});return copies.get(value);}
    for(const b of model.local.sourceBuildings||model.local.buildings){byBuilding.set(b.modelId||String(b.id),copy(b));yield 'live-model-buildings';}
    for(const b of currentLocal.sourceBuildings||currentLocal.buildings){const id=b.modelId||String(b.id);if(!byBuilding.has(id)&&currentScene.hasBuilding(id))byBuilding.set(id,b);yield 'live-model-retain';}
    const buildings=[...byBuilding.values()],nextLocal={...model.local,geo,buildings,sourceBuildings:buildings};
    for(const key of['places','allPlaces','sourcePlaces']){nextLocal[key]=[];for(const p of model.local[key]||[]){nextLocal[key].push(copy(p));yield 'live-model-places';}}
    const scoped=yield*scopeMapSteps(model.data,nextLocal,basis,true);
    const incoming=model.districtRegions?yield*CoopDistrictSelection.projectSteps(model.districtRegions,geo):(yield*CoopDistrictSelection.createSteps(model.data,scoped.local)).regions,regions=new Map(incoming.map(r=>[r.id,r]));
    for(const r of currentDistricts.regions){if(!regions.has(r.id)&&(r.id===selectedDistrict?.id||r.buildingIds.some(id=>currentScene.hasBuilding(id))))regions.set(r.id,r);yield 'live-model-selection-retain';}
    const nextDistricts=yield*CoopDistrictSelection.restoreSteps([...regions.values()],scoped.local);
    return{...scoped,districts:nextDistricts};
  }
  async function commitStreamMapModel(model,controller,trace){
    const currentScene=scene,basis={data,local};
    const built=await LBSMapWork.runBuild(streamMapModelSteps(model,mapLocal,districts,currentScene,basis),{signal:controller.signal,budgetMs:3});
    if(controller.signal.aborted||scene!==currentScene||!model.data.delivery?.partial&&!mapCovers(model.data,currentMapView()))return false;
    const start=performance.now(),next=built.value;mapData=model.data;mapLocal=next.local;districts=next.districts;mapLocals.set(mapData,mapLocal);mapDistrictRegions.set(mapData,districts.regions);mapScoped.add(mapData);
    if(selectedDistrict){selectedDistrict=districts.byId.get(selectedDistrict.id)||districts.forPlace(selectedDistrict);selected=selectedDistrict;}updateDistrictChoices();renderBuildingSelection();
    scene.setDistrictSelection(districts);sceneModelData=mapData;mapPreparedSvg=null;mapSvgDirty=true;streamPreparedModel=null;
    if(selected)scene.setSelected(selectedMapPlace(),false);
    const root=$('lbs-scene-root');root.dataset.districtSelection=String(districts.regions.length);root.dataset.mapCoverage=JSON.stringify({center:mapData.center,extent:mapData.extentMeters||mapData.radiusMeters,roads:mapData.features.filter(f=>f.kind==='road').length,buildings:mapLocal.buildings.length});
    trace.selection=built.metrics;trace.commitMs=performance.now()-start;mapRecord(trace,'new-map-input-attached',{incremental:true,commitMs:trace.commitMs});root.dataset.mapLoadTiming=JSON.stringify({incremental:true,totalMs:Math.round(performance.now()-trace.startedAt),modelMs:Math.round(trace.model?.totalWallMs||0),selectionMs:Math.round(built.metrics.totalWallMs),commitMs:Math.round(trace.commitMs)});
    return true;
  }
  async function prepareStreamMapSvg(){
    if(!mapSvgDirty)return;const next=mapData,nextLocal=mapLocal,nextDistricts=districts;
    const svg=await LBSMapWork.runBuild(mapSvgSteps(next,nextLocal,nextDistricts),{budgetMs:3});
    if(mapData!==next||mapLocal!==nextLocal)return false;mapPreparedSvg={data:next,svg:svg.value};mapSvgDirty=false;return true;
  }
  async function renderMap(next,view=null,prepared=null,options={}){
    cancelMapBuild();const controller=new AbortController();mapBuildRequest=controller;const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
    const trace=options.trace||mapTrace(options.basis?'initialize':'viewport'),basis=options.basis||{data,local},fresh=next!==basis.data&&!mapScoped.has(next);let nextScene=null,committed=false;
    controller.viewportRegion=options.requireCoverage?next:null;
    function needed(){checkMapBuild(controller);if(options.requireCoverage&&!mapCovers(next,requestedMapView())){streamQueued=true;mapRecord(trace,'obsolete-prepared-region');return false;}return true;}
    try{
      if(!needed())return false;const reuseGeography=!!options.requireCoverage&&next===mapData&&!!mapLocal&&!!districts&&!options.basis,cached=preparedMap(next,basis);let nextLocal=reuseGeography?mapLocal:cached?.scoped.local||prepared?.local||(next===basis.data?basis.local:mapLocals.get(next));if(cached)mapRecord(trace,'prepared-model-cache-hit',{units:cached.units});
      if(!nextLocal){const model=await LBSMapWork.prepareModel(next,{signal:controller.signal,districts:true,onPhase:p=>mapRecord(trace,p.name)});nextLocal=model.local;trace.model=model.metrics;}
      if(!needed())return false;const scoped=reuseGeography?{value:{local:mapLocal},metrics:cachedMapMetrics('live-scope')}:cached?{value:cached.scoped,metrics:cachedMapMetrics('scope-cache')}:await LBSMapWork.runBuild(scopeMapSteps(next,nextLocal,basis,fresh),{signal:controller.signal,budgetMs:3,canRun:()=>!mapDetailBusy()});nextLocal=scoped.value.local;trace.scope=scoped.metrics;if(!needed())return false;
      if(next!==basis.data){mapLocals.set(next,nextLocal);mapScoped.add(next);}
      const workerRegions=prepared?.districtRegions||mapDistrictRegions.get(next),districtModel=reuseGeography?{value:districts,metrics:cachedMapMetrics('live-districts')}:cached?{value:cached.districts,metrics:cachedMapMetrics('district-cache')}:await LBSMapWork.runBuild(workerRegions?CoopDistrictSelection.restoreSteps(workerRegions,nextLocal):CoopDistrictSelection.createSteps(next,nextLocal),{signal:controller.signal,budgetMs:3,canRun:()=>!mapDetailBusy(),onPhase:p=>mapRecord(trace,p.name)}),nextDistricts=districtModel.value;trace.district=districtModel.metrics;if(!needed())return false;if(!reuseGeography&&!cached&&!options.basis)rememberPreparedMap(next,basis,scoped,nextDistricts);
      const svg=reuseGeography?{metrics:cachedMapMetrics('live-svg')}:await LBSMapWork.runBuild(mapSvgSteps(next,nextLocal,nextDistricts),{signal:controller.signal,budgetMs:3,canRun:()=>!mapDetailBusy()});trace.svg=svg.metrics;if(!needed())return false;
      let useTwoD=options.force3D?false:mapRenderPreference||options.force2D===true;
      if(!useTwoD){
        try{
          const canvas=$('district-canvas').cloneNode(false),metadata=document.createElement('div'),detailView=LBSMapStream.geometryWindow(view||currentMapView(),streamPreviousView);
          nextScene=await createDistrictSceneAsync(next,nextLocal,selectMapDistrict,{mapLabelCandidates,layoutMapLabels:layoutProjectedMapLabels,districtSelection:nextDistricts,districtStyle:L.districtTheme,onEmptySelect:()=>closeBrief(false),rootId:'lbs-scene-root',root:metadata,canvas,positionMarker:'player-marker',warmLight:true,detailedCity:true,streamMap:true,baseOnly:!mapBuildings||detailView.span>2600,baseData:mapBaseCache,detailView,displayView:view||currentMapView(),staged:true,signal:controller.signal,onBuildPhase:p=>mapRecord(trace,'scene-'+(p.name||p.stage)),canBuild:()=>!mapDetailBusy(),onInteraction:mapInteraction,onViewChange:v=>scheduleMapView(v),onPresented:p=>mapRecord(trace,'new-map-first-render',p||{}),onContentReady:p=>mapRecord(trace,'all-content-ready',p||{})});
          trace.scene=nextScene.buildMetrics;
        }catch(error){if(error.name==='AbortError')throw error;trace.sceneError={name:error.name,message:error.message};useTwoD=true;mapRecord(trace,'scene-fallback-2d');}
      }
      checkMapBuild(controller);
      while(mapDetailBusy()){await new Promise(resolve=>setTimeout(resolve,16));checkMapBuild(controller);}
      if(options.requireCoverage&&!mapCovers(next,requestedMapView())){streamQueued=true;mapRecord(trace,'obsolete-prepared-region');return false;}
      if(options.requireCoverage||options.basis&&scene)view=requestedMapView();
      const commitStart=performance.now(),oldScene=scene;nextScene?.preparePresentation?.(view||currentMapView(),$('district-canvas').getBoundingClientRect?.());cancel2DPan(null,false);if(oldScene?.deactivate)oldScene.deactivate();else oldScene?.destroy();
      if(options.basis){data=basis.data;local=nextLocal;selected=null;selectedDistrict=null;filter='all';mapCache=[...mapCache.filter(r=>r!==next),next].slice(0,6);mapLocals=new WeakMap();mapDistrictRegions=new WeakMap();mapScoped=new WeakSet();preparedMapCache=[];}
      if(!reuseGeography){districts=nextDistricts;mapData=next;mapLocal=nextLocal;mapPreparedSvg={data:next,svg:svg.value};mapSvgDirty=false;}
      mapInitialPreview=false;scene=nextScene;sceneModelData=scene?next:null;twoD=useTwoD;if(trace.sceneError)mapRenderPreference=true;
      if(!reuseGeography&&selectedDistrict){selectedDistrict=districts.byId.get(selectedDistrict.id)||districts.forPlace(selectedDistrict);selected=selectedDistrict;}
      if(twoD)mountPreparedMapSvg();
      $('district-canvas').hidden=twoD;$('map-2d').toggleAttribute('hidden',!twoD);
      if(scene){$('district-canvas').replaceWith(nextScene.canvas||nextScene.preparedCanvas);if(view)scene.setView(view,false);scene.activate({root:$('lbs-scene-root')});scene.setSelected(selectedMapPlace(),false);}
      $('district-title').textContent=mapData.generation?'周边街区':homeName;setMapStatus((mapData.delivery?.stale?'地图使用旧缓存 · ':'')+mapAttribution);
      $('lbs-scene-root').dataset.mapCoverage=JSON.stringify({center:next.center,extent:next.extentMeters||next.radiusMeters,roads:next.features.filter(f=>f.kind==='road').length,buildings:nextLocal.buildings.length});
      $('district-canvas').hidden=twoD;$('map-2d').toggleAttribute('hidden',!twoD);scene?.setVisible(!twoD);updateMapDetailVisibility(view||currentMapView());$('view-toggle').textContent=twoD?'3D 地图':'2D 地图';$('view-toggle').setAttribute('aria-pressed',String(twoD));
      if(view){scene?.setView(view,false);set2DView(view);}else $('map-2d').setAttribute('viewBox','-1700 -1700 3400 3400');
      for(const b of document.querySelectorAll('[data-filter]')){b.classList.toggle('selected',b.dataset.filter===filter);b.setAttribute('aria-pressed',String(b.dataset.filter===filter));}
      if(filter!=='all')scene?.setFilter(filter);if(!reuseGeography)renderDistrictContext();updatePosition();
      if(options.basis)rememberPreparedMap(next,basis,scoped,nextDistricts);trace.commitMs=performance.now()-commitStart;committed=true;mapRecord(trace,'new-map-input-attached',{commitMs:trace.commitMs});$('lbs-scene-root').dataset.mapLoadTiming=JSON.stringify({cache:next.delivery?.cache||'bundled',geographyReused:reuseGeography,totalMs:Math.round(performance.now()-trace.startedAt),commitMs:Math.round(trace.commitMs),modelMs:Math.round(trace.model?.totalWallMs||0),sceneMs:Math.round(trace.scene?.totalWallMs||0),districtMs:Math.round(trace.district?.totalWallMs||0)});
      for(const source of mapBaseCache)showMapBase(source).catch(()=>{});if(oldScene?.destroyAsync)oldScene.destroyAsync({replaceCanvas:false,preserveMetadata:true}).then(metrics=>{trace.oldSceneDispose=metrics;}).catch(error=>mapRecord(trace,'old-scene-dispose-error',{errorMessage:error.message}));return true;
    }catch(error){mapRecord(trace,error.name==='AbortError'?'cancelled':'failed',{errorName:error.name,errorMessage:error.message});throw error;}
    finally{if(!committed&&nextScene){if(nextScene.destroyAsync)await nextScene.destroyAsync({replaceCanvas:false,preserveMetadata:true});else nextScene.destroy();}options.signal?.removeEventListener('abort',abort);if(mapBuildRequest===controller){mapBuildRequest=null;if(!streamRequest&&streamQueued){streamQueued=false;scheduleMapView();}}}
  }
  function stopMapStream(){
    mapInitSerial++;stopMapViewport();cancelMapBuild();cancelAnimationFrame(twoDLayoutFrame);twoDLayoutFrame=0;
  }
  function stopMapViewport(){
    cancelEarlyMapDetails();
    streamVersion++;clearTimeout(streamTimer);streamTimer=null;streamRequest?.abort();streamRequest=null;streamLoading=false;streamQueued=false;streamLatestView=null;streamPreviousView=null;clearTimeout(streamDetailTimer);streamDetailTimer=null;streamDetailRequest?.abort();streamDetailRequest=null;if(mapBuildRequest?.viewportRegion)cancelMapBuild();
    clearTimeout(mapSettleTimer);mapSettleTimer=null;mapInputActive=false;mapLastInputAt=-Infinity;streamGPSAnchor=null;streamPreparedModel=null;
  }
  function mapDetailWait(){return Math.max(0,450-(performance.now()-mapLastInputAt));}
  function mapDetailBusy(){return mapInputActive||!!scene?.dragging||!!twoDPointer||mapDetailWait()>0;}
  function mapInteraction(active){
    if(active&&mode==='gps'){mapGPSFollow=false;streamGPSAnchor=null;}
    mapInputActive=active;mapLastInputAt=performance.now();clearTimeout(mapSettleTimer);mapSettleTimer=null;
    if(streamDetailRequest&&!streamDetailRequest.streaming&&!streamDetailRequest.fetching&&!streamDetailRequest.parsing)streamDetailRequest.abort();
    if(mapBuildRequest?.viewportRegion)cancelMapBuild();
    $('lbs-scene-root').dataset.mapInteraction=active?'moving':'settling';updateMapDetailVisibility();
    if(!active){const version=streamVersion;mapSettleTimer=setTimeout(()=>{mapSettleTimer=null;if(version!==streamVersion||mapInputActive)return;$('lbs-scene-root').dataset.mapInteraction='idle';updateMapDetailVisibility();scheduleMapView();scheduleMapDetails(currentMapView(),0);},450);}
  }
  function mapReadyStatus(){if(mapDetailBusy())setMapStatus('正在沿视野补齐周边建筑…','detail');else if(mapDetailRetry?.count>=3){if(mapNeedsDetails(currentMapView()))setMapStatus('道路可用，建筑未载入，可重试地图。','error');else setMapStatus('当前街区可用，周边建筑稍后补齐。','preload');}else setMapStatus(mapAttribution);}
  function mapRoadFailureStatus(){
    const covered=[mapData,...mapBaseCache,...mapCache].some(r=>mapCovers(r,currentMapView()));
    setMapStatus(covered?'道路已显示，周边道路稍后补齐。':'周边道路暂未载入，可继续拖动或重试。',covered?'preload':'error');
  }
  function mapCovers(region,view){return LBSMapStream.covers(region,view);}
  function updateMapDetailVisibility(view=currentMapView()){
    // Keep committed models visible while moving or waiting for a new window.
    // Coverage determines when to build more geometry, not whether to hide it.
    const visible=mapBuildings&&view.span<=2600,root=$('lbs-scene-root');scene?.setBuildingsVisible?.(visible);root.classList.toggle('map-hide-buildings',!visible);root.dataset.mapDetailStage=visible&&!mapInitialPreview?'buildings':'roads';
  }
  function mapCanStreamBuildings(){return mapBuildings&&!twoD&&typeof scene?.addBuildings==='function';}
  function mapModelFor(view){if(streamPreparedModel&&LBSMapStream.drawReady(streamPreparedModel.data,view,streamPreviousView))return streamPreparedModel;return !mapInitialPreview&&!mapData.delivery?.partial&&LBSMapStream.drawReady(mapData,view,streamPreviousView)?{data:mapData,local:mapLocal}:null;}
  function mapNeedsDetails(view){const model=mapModelFor(view);return !model||mapBuildings&&!twoD&&scene?.buildingsCover?.(view)===false||model.data!==mapData;}
  function mapDetailURL(plan,progressive){return '/api/map?lat='+plan.center.lat.toFixed(4)+'&lon='+plan.center.lon.toFixed(4)+'&radius='+plan.meters+'&preload=1'+(progressive?'&stream=1':'');}
  function cancelEarlyMapDetails(){
    const early=mapEarlyDetails;mapEarlyDetails=null;if(!early)return;
    early.controller.abort();early.promise.then(result=>result.response?.body?.cancel().catch(()=>{}));
  }
  function startEarlyMapDetails(view){
    cancelEarlyMapDetails();const bootstrap=globalThis.LBSMapBoot?.take();
    const useful=globalThis.LBS_MAP_STATIC_DEMO!==true&&location.protocol!=='file:'&&mapBuildings&&!twoD&&view.span<=2600&&!mapCache.some(r=>LBSMapStream.detailsReady(r,view));
    if(bootstrap){if(useful&&mapCovers(bootstrap.region,view)){mapEarlyDetails=bootstrap;return;}bootstrap.controller.abort();bootstrap.promise.then(result=>result.response?.body?.cancel().catch(()=>{}));}
    if(!useful)return;
    const plan=LBSMapStream.detailPlan(view,null),controller=new AbortController();
    // Download while the bundled model and its first scene are being prepared.
    // Keep the response for the ordinary stream consumer; do not parse twice.
    mapEarlyDetails={plan,controller,startedAt:performance.now(),region:{center:plan.center,extentMeters:plan.meters*1.45},promise:fetch(mapDetailURL(plan,true),{signal:controller.signal}).then(response=>({response}),error=>({error}))};
  }
  function handoffMapDetails(controller,view){
    if(controller.handoffStop.signal.aborted)return;
    if(controller.handoff===mapEarlyDetails&&mapEarlyDetails&&mapCovers(mapEarlyDetails.region,view))return;
    cancelEarlyMapDetails();const plan=LBSMapStream.detailPlan(view,streamPreviousView),nextController=new AbortController();
    const next={plan,controller:nextController,startedAt:performance.now(),region:{center:plan.center,extentMeters:plan.meters*1.45},promise:fetch(mapDetailURL(plan,true),{signal:nextController.signal}).then(response=>({response}),error=>({error}))};
    mapEarlyDetails=next;controller.handoff=next;
    next.promise.then(result=>{
      if(streamDetailRequest!==controller||controller.handoff!==next||mapEarlyDetails!==next)return;
      // Keep drawing the old stream until the next one has actual data. Then
      // drain its already-arrived batches without killing their model worker.
      if(result.error||!result.response?.ok){cancelEarlyMapDetails();controller.abort();}
      else controller.handoffStop.abort();
    });
  }
  async function streamMapDetails(response,controller,trace,version){
    const root=$('lbs-scene-root'),stats={active:true,frames:0,firstFrameMs:null,firstVisibleMs:null,added:0,startedDuringMotion:controller.startedDuringMotion,view:currentMapView().center};let complete=false;
    function record(){root.dataset.mapStreamTiming=JSON.stringify({...stats,ms:Math.round(performance.now()-trace.startedAt),duringMotion:mapDetailBusy()});}
    record();
    try{
      await LBSMapWork.readMapFrames(response,{signal:controller.signal,stopSignal:controller.handoffStop?.signal,batchReady:true,onFrame:async input=>{
        if(version!==streamVersion||controller.signal.aborted)throw mapAbortError();
        controller.receivedData=true;if(stats.firstFrameMs===null)stats.firstFrameMs=Math.round(performance.now()-trace.startedAt);
        const view=currentMapView();controller.parsing=true;
        const model=await LBSMapWork.prepareModel(input,{signal:controller.signal,window:view,previousView:streamPreviousView,districts:true,});controller.parsing=false;
        if(version!==streamVersion||controller.signal.aborted)throw mapAbortError();
        const raw=model.sourceData||model.data,partial=raw.delivery?.partial===true;trace.model=model.metrics;stats.frames+=model.metrics.inputFrames||1;stats.tiles=raw.delivery?.tiles;stats.totalTiles=raw.delivery?.totalTiles;stats.tileCacheHits=raw.delivery?.tileCacheHits;stats.cache=raw.delivery?.cache;
        if(!partial){complete=true;mapCache=[raw,...mapCache.filter(r=>r.center.lat!==raw.center.lat||r.center.lon!==raw.center.lon||r.radiusMeters!==raw.radiusMeters)].slice(0,6);showMapBase(raw).catch(()=>{});}
        // A partial frame contains complete individual bodies, not complete
        // viewport coverage. Attach their picking before adding their meshes.
        if((partial||mapCovers(model.data,currentMapView()))&&await commitStreamMapModel(model,controller,trace)){
          const built=await scene.addBuildings(mapLocal,LBSMapStream.geometryWindow(currentMapView(),streamPreviousView),{signal:controller.signal,onPhase:phase=>{
            if(phase.name==='live-building-visible'){
              if(stats.firstVisibleMs===null){stats.firstVisibleMs=Math.round(performance.now()-trace.startedAt);stats.firstVisibleDuringMotion=mapDetailBusy();}
              if(scene.dragging)stats.batchesDuringDrag=(stats.batchesDuringDrag||0)+1;record();
            }
          }});stats.added+=built?.added||0;mapDetailRetry=null;
        }
        record();
      }});
      if(!complete&&!controller.handoffStop?.signal.aborted)throw Error('建筑数据传输未完成');
    }catch(error){stats.error={name:error.name,message:error.message};throw error;
    }finally{stats.active=false;stats.complete=complete;stats.cancelled=controller.signal.aborted;stats.retargeted=!!controller.handoffStop?.signal.aborted;record();const history=JSON.parse(root.dataset.mapStreamHistory||'[]');history.push(JSON.parse(root.dataset.mapStreamTiming));root.dataset.mapStreamHistory=JSON.stringify(history.slice(-6));}
  }
  function scheduleMapDetails(view=currentMapView(),delay=40){
    if(!local||!mapLocal)return;
    if(view.span>2600){if(streamDetailRequest&&(streamDetailRequest.progressive||!streamDetailRequest.fetching))streamDetailRequest.abort();if(mapBuildRequest?.viewportRegion)cancelMapBuild();return;}
    if(streamDetailRequest&&(streamDetailRequest.progressive||!streamDetailRequest.fetching&&!streamDetailRequest.parsing)&&!(streamDetailRequest.progressive?LBSMapStream.detailRequestReady(streamDetailRequest.viewportRegion,view,streamPreviousView):mapCovers(streamDetailRequest.viewportRegion,view))){
      if(streamDetailRequest.progressive&&streamDetailRequest.receivedData&&streamDetailRequest.handoffStop&&mapCovers(streamDetailRequest.viewportRegion,view))handoffMapDetails(streamDetailRequest,view);
      else{streamDetailRequest.abort();if(mapBuildRequest?.viewportRegion)cancelMapBuild();}
    }
    const dataReady=mapCache.some(r=>LBSMapStream.detailsReady(r,view));
    if((mapDetailBusy()&&!mapCanStreamBuildings()||!mapNeedsDetails(view))&&(dataReady||!mapBuildings))return;
    if(mapDetailRetry){if(LBSMapStream.distance(mapDetailRetry.view.center,view.center)>500)mapDetailRetry=null;else if(mapDetailRetry.count>=3)return;else delay=Math.max(delay,mapDetailRetry.until-Date.now());}
    if(streamDetailTimer||streamDetailRequest||mapBuildRequest)return;
    const version=streamVersion;streamDetailTimer=setTimeout(()=>{streamDetailTimer=null;return loadMapDetails(currentMapView(),version);},delay);
  }
  async function loadMapDetails(view,version){
    if(version!==streamVersion||streamDetailRequest||mapBuildRequest||!local||view.span>2600)return;
    const streaming=mapCanStreamBuildings(),preload=mapDetailBusy()&&!streaming||!mapNeedsDetails(view);
    if(preload&&(mapCache.some(r=>LBSMapStream.detailsReady(r,view))||!mapBuildings))return;
    let source=preload?null:mapCache.find(r=>LBSMapStream.drawReady(r,view,streamPreviousView)),preparedModel=null;if(!source&&(globalThis.LBS_MAP_STATIC_DEMO===true||location.protocol==='file:'))return;
    const controller=new AbortController(),plan=LBSMapStream.detailPlan(view,streamPreviousView),trace=mapTrace(preload?'preload-buildings':'viewport-details');streamDetailRequest=controller;controller.handoffStop=new AbortController();controller.streaming=streaming;controller.startedDuringMotion=mapDetailBusy()||mode==='gps'&&mapGPSFollow;controller.viewportRegion={center:plan.center,extentMeters:plan.meters*1.45};
    try{
      // A new camera window can reuse the existing geographic model and selection
      // index. Only its nearby GPU geometry needs to be prepared again.
      const readyModel=mapModelFor(view);
      if(!preload&&readyModel){
        if(streaming){if(readyModel.data!==mapData&&!await commitStreamMapModel(readyModel,controller,trace))return;await scene.addBuildings(mapLocal,LBSMapStream.geometryWindow(currentMapView(),streamPreviousView),{signal:controller.signal});mapDetailRetry=null;return;}
        await renderMap(readyModel.data,currentMapView(),readyModel,{signal:controller.signal,requireCoverage:true,trace});if(streamPreparedModel===readyModel)streamPreparedModel=null;return;
      }
      if(!source){
        controller.fetching=true;controller.progressive=streaming;let response;
        if(streaming&&mapEarlyDetails&&mapCovers(mapEarlyDetails.region,view)){
          const early=mapEarlyDetails;mapEarlyDetails=null;controller.early=early;controller.viewportRegion=early.region;trace.startedAt=early.startedAt;
          controller.abortEarly=()=>early.controller.abort();controller.signal.addEventListener('abort',controller.abortEarly,{once:true});
          const result=await early.promise;if(result.error)throw result.error;response=result.response;
        }else{cancelEarlyMapDetails();response=await fetch(mapDetailURL(plan,controller.progressive),{signal:controller.signal});}
        if(controller.signal.aborted){response.body?.cancel().catch(()=>{});throw mapAbortError();}
        if(!response.ok)throw Object.assign(Error('建筑稍后补齐'),{status:response.status});
        if(controller.progressive&&response.headers.get('content-type')?.includes('application/x-ndjson')){await streamMapDetails(response,controller,trace,version);return;}
        controller.progressive=false;const input=await response.arrayBuffer();controller.fetching=false;controller.parsing=true;
        // Decode and prepare the moving 3D window in one worker. A data-only
        // parse followed by a second worker copied the entire source twice.
        const buildNow=streaming&&!preload,parsed=await LBSMapWork.prepareModel(input,{signal:controller.signal,dataOnly:!buildNow,window:buildNow?currentMapView():null,previousView:streamPreviousView,districts:buildNow,});source=parsed.sourceData||parsed.data;if(buildNow)preparedModel=parsed;controller.parsing=false;
        if(version!==streamVersion||controller.signal.aborted)return;
        mapCache=[source,...mapCache.filter(r=>r.center.lat!==source.center.lat||r.center.lon!==source.center.lon||r.radiusMeters!==source.radiusMeters)].slice(0,6);showMapBase(source).catch(()=>{});
        if(version!==streamVersion||controller.signal.aborted)return;
        $('lbs-scene-root').dataset.mapDetailPreload=JSON.stringify({center:source.center,extent:source.extentMeters,ms:Math.round(performance.now()-trace.startedAt),startedDuringMotion:controller.startedDuringMotion,duringMotion:mapDetailBusy(),cached:true});
      }
      if(version!==streamVersion||controller.signal.aborted||mapDetailBusy()&&!streaming||!mapNeedsDetails(currentMapView()))return;
      const latest=currentMapView(),stale=!mapCovers(controller.viewportRegion,latest),model=preparedModel||await LBSMapWork.prepareModel(source,{signal:controller.signal,dataOnly:stale,window:stale?null:latest,previousView:streamPreviousView,districts:!stale,});trace.model=model.metrics;
      const raw=model.sourceData||model.data;mapCache=[raw,...mapCache.filter(r=>r.center.lat!==raw.center.lat||r.center.lon!==raw.center.lon||r.radiusMeters!==raw.radiusMeters)].slice(0,6);
      showMapBase(raw).catch(()=>{});
      if(version!==streamVersion||controller.signal.aborted)return;
      if(stale||!mapCovers(model.data,currentMapView()))return;mapDetailRetry=null;
      if(model.districtRegions)mapDistrictRegions.set(model.data,model.districtRegions);
      if(streaming&&scene){streamPreparedModel=model;if(!await commitStreamMapModel(model,controller,trace))return;await scene.addBuildings(mapLocal,LBSMapStream.geometryWindow(currentMapView(),streamPreviousView),{signal:controller.signal});return;}
      else if(mapDetailBusy())return;
      await renderMap(model.data,currentMapView(),model,{signal:controller.signal,requireCoverage:true,trace});
      if(streamPreparedModel===model)streamPreparedModel=null;
    }catch(error){if(error.name!=='AbortError'){mapRecord(trace,'failed',{errorMessage:error.message});const count=(mapDetailRetry?.count||0)+1;mapDetailRetry={count,view,until:Date.now()+Math.min(30000,count*5000)};if(mapNeedsDetails(currentMapView()))setMapStatus(count>=3?'道路可用，建筑未载入，可重试地图。':'道路可用，建筑稍后补齐。',count>=3?'error':'detail');else setMapStatus('当前街区可用，周边建筑稍后补齐。','preload');}}
    finally{if(controller.abortEarly)controller.signal.removeEventListener('abort',controller.abortEarly);if(streamDetailRequest===controller){streamDetailRequest=null;if(version===streamVersion){if(!streamRequest&&!mapNeedsDetails(currentMapView()))mapReadyStatus();scheduleMapDetails(currentMapView(),(controller.signal.aborted||controller.handoff)&&streaming?0:80);}}}
  }
  async function showMapBase(source){
    const currentScene=scene;if(currentScene?.addBaseData)await currentScene.addBaseData(source);
    if(!twoD||!mapLocal)return;
    const currentLocal=mapLocal,key=[source.center.lat,source.center.lon,source.radiusMeters,source.features.length].join(':'),flat=$('map-2d');
    if([...flat.querySelectorAll('[data-map-base]')].some(g=>g.dataset.mapBase===key))return;
    const svg=await LBSMapWork.runBuild(mapSvgSteps(source,{geo:currentLocal.geo,buildings:[]},{regions:[]}),{budgetMs:3,batchSize:8});
    if(!twoD||mapLocal!==currentLocal)return;svg.value.querySelector('#player-ring-2d')?.remove();const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.dataset.mapBase=key;group.append(...svg.value.childNodes);flat.insertBefore(group,flat.firstChild);
    const groups=flat.querySelectorAll('[data-map-base]');for(const old of [...groups].slice(3))old.remove();
  }
  function scheduleMapView(view=currentMapView(),delay=80,retries=0){
    if(!mapLocal)return;
    if(streamLatestView&&!(mode==='gps'&&mapGPSFollow)&&(LBSMapStream.distance(streamLatestView.center,view.center)>5||Math.abs(streamLatestView.span-view.span)>2))mapInteraction(!!scene?.dragging||!!twoDPointer);
    // Smooth GPS frames move less than the drag threshold. Accumulate a short
    // geographic baseline so directional preloading still follows walking.
    if(mode==='gps'&&mapGPSFollow){if(!streamGPSAnchor)streamGPSAnchor=streamLatestView||view;if(LBSMapStream.distance(streamGPSAnchor.center,view.center)>20){streamPreviousView=streamGPSAnchor;streamGPSAnchor=view;}}
    else if(streamLatestView&&LBSMapStream.distance(streamLatestView.center,view.center)>5)streamPreviousView=streamLatestView;streamLatestView=view;
    updateMapDetailVisibility(view);scheduleMapDetails(view);
    if([...mapBaseCache,...mapCache].some(region=>LBSMapStream.ready(region,view,streamPreviousView))){streamQueued=false;if(!streamRequest&&!streamDetailRequest&&!mapInitialPreview)mapReadyStatus();return;}
    // Network preloading is independent of building generation and pointer input.
    if(streamRequest){streamQueued=true;return;}
    if(streamTimer)return;const version=streamVersion;
    streamTimer=setTimeout(()=>{streamTimer=null;loadMapView(streamLatestView||currentMapView(),version,retries);},Math.max(delay,nextMapRequestAt-Date.now()));
  }
  async function loadMapView(view,version,retries){
    if(version!==streamVersion||streamRequest||!mapLocal)return;
    const current=currentMapView();if(current.radius>view.radius||LBSMapStream.distance(current.center,view.center)>40)view=current;
    const cached=[...mapBaseCache,...mapCache].find(region=>LBSMapStream.ready(region,view,streamPreviousView));
    if(cached){scheduleMapDetails(view);mapReadyStatus();return;}
    if(globalThis.LBS_MAP_STATIC_DEMO===true){setMapStatus(LBSMapStream.distance(mapData.center,view.center)>LBSMapStream.extent(mapData)?'已到演示区域边缘 · 点击“地图归位”返回街区':mapAttribution);return;}
    if(location.protocol==='file:'){setMapStatus('周边地图需要联网加载，请通过 localhost:8789 打开地图。','error');return;}
    if(!L.validPoint(view.center)){setMapStatus('此位置超出地图支持的纬度范围。','error');return;}
    const plan=LBSMapStream.plan(view,streamPreviousView),controller=new AbortController(),trace=mapTrace('network-viewport');streamRequest=controller;streamLoading=true;streamQueued=false;let followUp=null,succeeded=false;
    const phase=[...mapBaseCache,...mapCache].some(r=>mapCovers(r,view))?'preload':'loading';setMapStatus('正在预加载周边道路…',phase);
    controller.viewportRegion={center:plan.center,extentMeters:plan.radius*1.45};
    $('lbs-scene-root').dataset.mapPreloadPlan=JSON.stringify({center:plan.center,radius:plan.radius,view:view.center,viewRadius:view.radius,reserve:LBSMapStream.reserve(view),dataOnly:true});
    try{
      mapRecord(trace,'network-start');const response=await fetch('/api/map?lat='+plan.center.lat.toFixed(4)+'&lon='+plan.center.lon.toFixed(4)+'&radius='+plan.radius+'&preload=1&layer=base',{signal:controller.signal});mapRecord(trace,'network-headers',{httpStatus:response.status});
      if(response.status===429){if(version!==streamVersion)return;if(retries<12){const seconds=Number(response.headers.get('Retry-After'))||5;nextMapRequestAt=Date.now()+Math.min(30,Math.max(1,seconds))*1000;setMapStatus('周边道路正在排队加载…',phase);followUp={delay:120,retries:retries+1};}else mapRoadFailureStatus();return;}
      if(!response.ok){const error=await response.json();throw Object.assign(Error(error.error||'周边地图加载失败'),{status:response.status});}
      const input=await response.arrayBuffer();mapRecord(trace,'network-body-ready',{bytes:input.byteLength});if(version!==streamVersion)return;
      const model=await LBSMapWork.prepareModel(input,{signal:controller.signal,dataOnly:true,onPhase:p=>mapRecord(trace,p.name)}),source=model.sourceData||model.data;if(version!==streamVersion)return;
      if(!L.validPoint(source.center)||!Array.isArray(source.features)||!Array.isArray(source.places)||!Number.isFinite(source.radiusMeters)||!Number.isFinite(source.extentMeters))throw Error('周边地图数据不完整');
      mapBaseCache=[source,...mapBaseCache.filter(r=>r.center.lat!==source.center.lat||r.center.lon!==source.center.lon||r.radiusMeters!==source.radiusMeters)].slice(0,6);
      $('lbs-scene-root').dataset.mapDataTiming=JSON.stringify({cache:source.delivery?.cache||'memory',ms:Math.round(performance.now()-trace.startedAt),dataOnly:true});succeeded=true;
      await showMapBase(source);scheduleMapDetails(currentMapView(),0);
    }catch(error){mapRecord(trace,error.name==='AbortError'?'cancelled':'failed',{errorMessage:error.message});if(error.name!=='AbortError'&&version===streamVersion){if(retries<3&&(error.status>=500||error.name==='TypeError')){followUp={delay:2000*(retries+1),retries:retries+1};setMapStatus('正在重试附近道路，可继续拖动…',phase);}else mapRoadFailureStatus();}}
    finally{if(streamRequest===controller){streamRequest=null;streamLoading=false;const queued=streamQueued;streamQueued=false;if(version===streamVersion){const latest=currentMapView();if([...mapBaseCache,...mapCache].some(r=>LBSMapStream.ready(r,latest,streamPreviousView)))mapReadyStatus();else if(followUp||queued||succeeded)scheduleMapView(latest,followUp?.delay??80,followUp?.retries??0);}}}
  }
  async function startMapPreview(next,signal){
    const started=performance.now(),preview={geo:CoopGeography.create(next),types:CoopLocalPlaces.types,places:[],allPlaces:[],buildings:[],counts:{},buildingMerge:{},blockGrouping:{renderedBodies:0}},oldScene=scene;
    mapCache=[next];mapBaseCache=[next];mapDetailRetry=null;mapInitialPreview=true;mapPreparedSvg=null;mapSvgDirty=false;
    try{
      const canvas=$('district-canvas').cloneNode(false),metadata=document.createElement('div'),previewScene=await createDistrictSceneAsync(next,preview,()=>{},{rootId:'lbs-scene-root',root:metadata,canvas,positionMarker:'player-marker',detailedCity:true,streamMap:true,baseOnly:true,staged:true,signal,onInteraction:mapInteraction,onViewChange:scheduleMapView});
      previewScene.setView?.({center:next.center,span:1600},false);
      oldScene?.deactivate();mapData=next;mapLocal=preview;scene=previewScene;sceneModelData=null;twoD=false;$('district-canvas').replaceWith(previewScene.canvas);$('district-canvas').hidden=false;$('map-2d').setAttribute('hidden','');scene.activate({root:$('lbs-scene-root')});
      if(oldScene?.destroyAsync)oldScene.destroyAsync({replaceCanvas:false,preserveMetadata:true});
    }catch(error){if(error.name==='AbortError')throw error;mapData=next;mapLocal=preview;scene=null;twoD=true;oldScene?.destroyAsync?.({replaceCanvas:false,preserveMetadata:true});const svg=await LBSMapWork.runBuild(mapSvgSteps(next,preview,{regions:[]}),{budgetMs:3,batchSize:8});$('map-2d').replaceChildren(...svg.value.childNodes);$('district-canvas').hidden=true;$('map-2d').removeAttribute('hidden');set2DView({center:next.center,span:1600});}
    $('lbs-scene-root').dataset.mapDetailStage='roads';$('lbs-scene-root').dataset.mapPreviewTiming=JSON.stringify({ms:Math.round(performance.now()-started),buildings:0});
    setMapStatus('道路已就绪，正在准备建筑…','detail');scheduleMapView();
  }
  async function initMap(next,reset=false,prepared=null,signal=null){
    stopMapStream();await startMapPreview(next,signal);startEarlyMapDetails(currentMapView());const initVersion=mapInitSerial,controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();mapBuildRequest=controller;const trace=mapTrace('initialize');
    try{
      const model=prepared||await LBSMapWork.prepareModel(next,{signal:controller.signal,districts:true,onPhase:p=>mapRecord(trace,p.name)});trace.model=model.metrics;if(controller.signal.aborted||initVersion!==mapInitSerial)throw mapAbortError();
      const basis={data:model.data,local:model.local};
      if(mapBuildRequest===controller)mapBuildRequest=null;await renderMap(model.data,null,model,{basis,trace,signal});if(initVersion!==mapInitSerial)return;updatePosition();
    }catch(error){if(initVersion===mapInitSerial)cancelEarlyMapDetails();if(error.name!=='AbortError'){setMapStatus('周边街区加载失败 · 拖动或缩放地图可重试','error');mapRecord(trace,'failed',{errorName:error.name,errorMessage:error.message});}throw error;}
    finally{signal?.removeEventListener('abort',abort);if(mapBuildRequest===controller)mapBuildRequest=null;}
  }
  function stopGPS(){if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}$('gps-button').querySelector('span').textContent='启用 GPS';}
  function receiveGPSPosition(fix){
    if(mode!=='gps')return;const value={lat:fix.coords.latitude,lon:fix.coords.longitude,accuracy:fix.coords.accuracy,speed:fix.coords.speed,time:Number.isFinite(fix.timestamp)?fix.timestamp:Date.now()};
    if(!L.validPoint(value)){gpsError='当前定位超出地图支持范围。';position=null;updatePosition();return;}
    if(position&&value.time<position.time)return;
    position=value;gpsError='';mapGPSFixCount++;$('lbs-scene-root').dataset.mapGPS=JSON.stringify({following:mapGPSFollow,fixes:mapGPSFixCount,time:value.time,lat:value.lat,lon:value.lon});updatePosition();
  }
  async function startGPS(){
    if(globalThis.LBS_MAP_STATIC_DEMO===true)return;
    if(!local)return;
    if(watch!==null){stopGPS();mode='map';position=null;gpsError='定位已停止。';updatePosition();return;}
    if(!window.isSecureContext){toast('设备定位需要 HTTPS 或 localhost，也可手动探索坐标。');return;}
    if(!navigator.geolocation){toast('当前浏览器没有提供定位能力，可使用坐标探索。');return;}
    mode='gps';mapGPSFollow=true;streamGPSAnchor=null;gpsError='正在等待 GPS 信号…';updatePosition();$('gps-button').querySelector('span').textContent='停止定位';
    watch=navigator.geolocation.watchPosition(receiveGPSPosition,e=>{if(mode!=='gps')return;position=null;gpsError=e.code===1?'定位权限被拒绝，可手动探索坐标。':e.code===3?'定位超时，等待新的信号或重新启用 GPS。':'暂时无法获取位置，请检查设备定位服务。';updatePosition();toast(gpsError);if(e.code===1)stopGPS();},{enableHighAccuracy:true,maximumAge:0,timeout:12000});
  }
  $('gps-button').onclick=startGPS;
  $('recenter').onclick=()=>{if(!mapLocal)return;mapGPSFollow=true;if(position)updatePosition(mode==='gps'?false:!twoD);else scene?.setView({center:data.center,span:1600});if(twoD){set2DView({center:position||data.center,span:mode==='gps'?currentMapView().span:3400});scheduleMapView();}};
  function queue2DLayout(){if(twoDLayoutFrame)return;twoDLayoutFrame=requestAnimationFrame(()=>{twoDLayoutFrame=0;if(twoD)layout2D();});}
  function zoom(factor){if(!mapLocal||!Number.isFinite(factor)||factor<=0)return;if(!twoD){scene?.zoom(factor);return;}mapInteraction(false);const b=$('map-2d').viewBox.baseVal,size=Math.max(450,Math.min(5200,b.width*factor));if(size===b.width)return;set2DView({center:mapLocal.geo.coordinate(b.x+b.width/2,-b.y-b.height/2),span:size});scheduleMapView();}
  $('zoom-out').onclick=()=>zoom(1.25);$('zoom-in').onclick=()=>zoom(.8);
  function reuseMapScene(view){
    if(!scene?.activated||sceneModelData!==mapData||scene.canvas!==$('district-canvas'))return false;
    cancel2DPan(null,false);cancelAnimationFrame(twoDLayoutFrame);twoDLayoutFrame=0;stopMapViewport();cancelMapBuild();mapRenderPreference=false;twoD=false;
    $('district-canvas').hidden=false;$('map-2d').setAttribute('hidden','');$('view-toggle').textContent='2D 地图';$('view-toggle').setAttribute('aria-pressed','false');scene.setView(view,false);scene.setVisible(true);scene.invalidateLabels?.();scheduleMapView();return true;
  }
  $('view-toggle').onclick=async()=>{if(!mapLocal)return;const view=currentMapView();if(twoD){if(reuseMapScene(view))return;if(mapRenderPreference===false&&mapBuildRequest){mapRenderPreference=true;cancelMapBuild();return;}mapRenderPreference=false;$('map-status').textContent='正在载入街区，当前地图仍可使用…';try{await renderMap(mapData,view,{local:mapLocal},{requireCoverage:false,force3D:true});}catch(error){if(error.name!=='AbortError')toast('三维地图暂时不可用，当前地图仍可使用。');}return;}mapRenderPreference=true;stopMapViewport();cancelMapBuild();cancel2DPan(null,false);await prepareStreamMapSvg();mountPreparedMapSvg();twoD=true;$('district-canvas').hidden=true;$('map-2d').removeAttribute('hidden');scene?.setVisible(false);$('view-toggle').textContent='3D 地图';$('view-toggle').setAttribute('aria-pressed','true');set2DView(view);for(const source of mapBaseCache.slice(0,2))showMapBase(source);scheduleMapView();};
  for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;for(const node of document.querySelectorAll('[data-filter]')){node.classList.toggle('selected',node===b);node.setAttribute('aria-pressed',String(node===b));}buildingPage=0;if(selectedDistrict&&!CoopLocalPlaces.matches(selectedDistrict,filter))closeBrief(false);updateDistrictChoices();scene?.setFilter(filter==='clinic'?'hospital':filter);if(twoD)layout2D();};
  new ResizeObserver(()=>{if(twoD)layout2D();}).observe($('map-2d'));
  const flatMap=$('map-2d'),mapSurface=$('district-map');let twoDClickBlock=null;
  function flatInputTarget(e){const marker=e.target.closest?.('button.place-marker,[data-place-marker]');return marker&&$('map-markers').contains(marker)?marker:flatMap.contains(e.target)?flatMap:null;}
  function flatDistrictAt(e){const b=flatMap.viewBox.baseVal,r=flatMap.getBoundingClientRect(),scale=Math.min(r.width/b.width,r.height/b.height);if(!(scale>0)||e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return null;const x=(e.clientX-r.left-(r.width-b.width*scale)/2)/scale,y=(e.clientY-r.top-(r.height-b.height*scale)/2)/scale;return districts.at({east:b.x+x,north:-b.y-y},filter==='clinic'?'hospital':filter);}
  function pan2D(e){
    const p=twoDPointer;if(!p||p.id!==e.pointerId)return;
    if(!p.moved&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>6){p.moved=true;mapInteraction(true);}if(!p.moved)return;
    const x=p.box.x-(e.clientX-p.x)/p.scale,y=p.box.y-(e.clientY-p.y)/p.scale;set2DView({center:mapLocal.geo.coordinate(x+p.box.width/2,-y-p.box.height/2),span:p.box.height});scheduleMapView();
  }
  mapSurface.addEventListener('pointerdown',e=>{
    if(e.button===0&&e.isPrimary!==false&&!twoDPointer)twoDClickBlock=null;
    if(!twoD||e.button!==0||e.isPrimary===false||twoDPointer)return;const capture=flatInputTarget(e);if(!capture)return;
    const b=flatMap.viewBox.baseVal,r=flatMap.getBoundingClientRect(),scale=Math.min(r.width/b.width,r.height/b.height);if(!(scale>0))return;
    const region=capture===flatMap?flatDistrictAt(e):null;
    twoDClickBlock=null;twoDPointer={id:e.pointerId,x:e.clientX,y:e.clientY,box:{x:b.x,y:b.y,width:b.width,height:b.height},scale,moved:false,capture,region};capture.setPointerCapture(e.pointerId);
  });
  mapSurface.addEventListener('pointermove',pan2D);
  function end2DPan(e){if(twoDPointer?.id!==e.pointerId)return;pan2D(e);const p=twoDPointer;twoDPointer=null;if(p.moved){twoDClickBlock=p;mapInteraction(false);scheduleMapView();}else if(p.region)selectMapDistrict(p.region);else if(p.capture===flatMap)closeBrief(false);}
  function cancel2DPan(e=null,notify=true){const p=twoDPointer;if(!p||e&&p.id!==e.pointerId)return;twoDClickBlock=p;twoDPointer=null;if(p.capture.hasPointerCapture?.(p.id))p.capture.releasePointerCapture(p.id);if(p.moved){if(notify){mapInteraction(false);scheduleMapView();}else mapInputActive=false;}}
  mapSurface.addEventListener('pointerup',end2DPan);mapSurface.addEventListener('pointercancel',cancel2DPan);mapSurface.addEventListener('lostpointercapture',cancel2DPan);
  mapSurface.addEventListener('click',e=>{if(!twoDClickBlock||!(e.detail>0||e.pointerType))return;if(e.pointerId>0&&e.pointerId!==twoDClickBlock.id)return;const target=flatInputTarget(e);if(target!==flatMap&&target!==twoDClickBlock.capture)return;e.preventDefault();e.stopImmediatePropagation();},true);
  flatMap.addEventListener('keydown',e=>{const id=e.target.closest?.('[data-district]')?.dataset.district;if(!twoD||!id||!['Enter',' '].includes(e.key))return;e.preventDefault();if(!e.repeat){const region=districts.byId.get(id);if(region&&CoopLocalPlaces.matches(region,filter==='clinic'?'hospital':filter))selectMapDistrict(region);}});
  flatMap.addEventListener('click',e=>{if(!twoD||e.detail>0||e.pointerType)return;const id=e.target.closest?.('[data-district]')?.dataset.district,region=districts.byId.get(id);if(region&&CoopLocalPlaces.matches(region,filter==='clinic'?'hospital':filter))selectMapDistrict(region);});
  window.addEventListener('blur',()=>cancel2DPan());
  mapSurface.addEventListener('wheel',e=>{if(!twoD||!flatInputTarget(e)||!Number.isFinite(e.deltaY))return;e.preventDefault();zoom(Math.exp(Math.max(-50,Math.min(50,e.deltaY*.001))));},{passive:false});
  function closeSheet(){
    requestVersion++;request?.abort();request=null;$('sheet').hidden=true;$('lbs-app').inert=false;
    (returnFocus?.isConnected?returnFocus:$('region-button')).focus({preventScroll:true});
  }
  $('sheet-close').onclick=closeSheet;$('sheet').addEventListener('pointerdown',event=>{if(event.target===$('sheet'))closeSheet();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(!$('sheet').hidden)closeSheet();else if(!$('building-browser').hidden){toggleBuildingList(false);$('building-list-toggle').focus({preventScroll:true});}else closeBrief();}
    if(event.key==='Tab'&&!$('sheet').hidden){const nodes=[...$('sheet').querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')],first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  function showRegion(){
    const center=currentMapView().center;returnFocus=document.activeElement;
    $('sheet-body').innerHTML='<p>输入 WGS84 坐标，查看周边道路与建筑。</p><form id="coordinate-form" class="coordinate-form"><label>纬度（−85 至 85）<input id="region-lat" type="number" step="any" min="-85" max="85" required value="'+center.lat+'"></label><label>经度（−180 至 180）<input id="region-lon" type="number" step="any" min="-180" max="180" required value="'+center.lon+'"></label><button id="generate-region" type="submit" class="primary">载入周边地图</button></form><p id="region-status" class="form-status" role="status"></p>';
    $('sheet-actions').innerHTML='<button id="region-home">返回'+esc(homeName)+'</button>';
    $('sheet').hidden=false;$('lbs-app').inert=true;$('region-lat').focus();
    $('region-home').onclick=async()=>{requestVersion++;request?.abort();request=new AbortController();const version=requestVersion;$('region-home').disabled=true;try{await initMap(LBS_DISTRICT_DATA,true,null,request.signal);if(version===requestVersion)closeSheet();}catch(error){if(error.name!=='AbortError')toast(error.message);}finally{if(version===requestVersion)$('region-home').disabled=false;}};
    $('coordinate-form').onsubmit=async event=>{
      event.preventDefault();const latInput=$('region-lat').value,lonInput=$('region-lon').value,p={lat:Number(latInput),lon:Number(lonInput)};
      if(latInput.trim()===''||lonInput.trim()===''||!L.validPoint(p)){toast('请输入有效 WGS84 坐标。');return;}
      if(globalThis.LBS_MAP_STATIC_DEMO===true||location.protocol==='file:'){$('region-status').textContent='在线地图需要本地服务，请在项目目录运行 npm start，并从本地服务访问。';return;}
      stopMapStream();request?.abort();request=new AbortController();const version=++requestVersion;$('generate-region').disabled=true;$('coordinate-form').setAttribute('aria-busy','true');$('region-status').textContent='正在读取道路与建筑…';
      try{
        const response=await fetch('/api/map?lat='+p.lat+'&lon='+p.lon,{signal:request.signal});if(!response.ok){const error=await response.json();throw Error(error.error||'地图载入失败');}
        const model=await LBSMapWork.prepareModel(await response.arrayBuffer(),{signal:request.signal,districts:true,area:{center:p,radiusMeters:1000}});if(version!==requestVersion)return;
        await initMap(model.data,true,model,request.signal);if(version!==requestVersion)return;closeSheet();toast('周边地图与建筑已载入。');
      }catch(error){if(error.name!=='AbortError'&&version===requestVersion){$('region-status').textContent=error.message;toast(error.message);}}
      finally{if(version===requestVersion){$('generate-region').disabled=false;$('coordinate-form').setAttribute('aria-busy','false');}}
    };
  }
  $('region-button').onclick=showRegion;
  window.addEventListener('pagehide',()=>{stopGPS();request?.abort();stopMapStream();scene?.deactivate();});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  const ready=initMap(data,true).then(()=>scheduleMapView()).catch(error=>{if(error.name!=='AbortError'){setMapStatus('地图初始化未完成 · '+error.message,'error');toast('地图初始化未完成 · '+error.message);}});
  window.lbsMap={ready,get mode(){return mode;},get position(){return position;},get selected(){return selectedDistrict;},get selectedDistrict(){return selectedDistrict;},get districts(){return districts;},get local(){return mapLocal;},get scene(){return scene;},get mapData(){return mapData;},get mapView(){return currentMapView();},get mapLoading(){return streamLoading||!!mapBuildRequest;},get mapBuildHistory(){return JSON.parse(JSON.stringify(mapBuildHistory));},selectBuilding(id){const region=districts?.byId.get(id);if(region)selectMapDistrict(region);return !!region;},clearSelection:()=>closeBrief(false),snapshot:()=>({mode,selected:selectedDistrict?.id||null,buildings:districts?.regions.length||0,view:currentMapView(),twoD})};
})();
