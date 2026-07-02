// ── FEATURE CANVAS STATE (FC module — formerly Story Canvas) ──
// scCanvas: shared global store — also read by new Story Canvas and PI Canvas
// scStoryIdCounter: global, incremented by FC (AI gen) and new SC (manual add)
// scPiSelectedIds: global Set of feature IDs with ≥1 _stagedForPI story — read by PI Canvas

let scCanvas=[], scGroupMode='metric', scPanelFeatureId=null, scSelectedIds=new Set(), scModalBatchSize=0, scStoryIdCounter=0;
let scCapNavCollapsed=false, scCapNavFilter=null; // null = show all
// PI selection state — maintained by new Story Canvas, read by PI Canvas
let scPiSelectedIds=new Set();
// FC filter state
let fcStoriesFilter=new Set();         // Set of active filters: 'generated' | 'not-generated'
let fcOriginFilter=new Set();           // Set of active origin filters: 'origin-kpi' | 'origin-doc' | 'origin-custom' | 'origin-mi' | 'origin-diag'
// FC collapsed metric groups
let fcCollapsedGroups=new Set();
function fcToggleGroup(groupKey){
  if(fcCollapsedGroups.has(groupKey))fcCollapsedGroups.delete(groupKey);
  else fcCollapsedGroups.add(groupKey);
  fcRenderCanvas();
}
// Traceability panel state
let scPanelLineageOpen=false;

// ── Add Feature dropdown (C1, v7.84) ──
// Mirrors ccToggleAddCapDrop's pattern for CC's "Add Capability" dropdown.
function scToggleAddFeatDrop(evt){
  if(evt)evt.stopPropagation();
  const drop=document.getElementById('sc-addfeat-drop');
  if(!drop)return;
  const isOpen=drop.classList.contains('open');
  
  if(isOpen){
    drop.classList.remove('open');
    document.removeEventListener('mousedown',_scAddFeatDropOutside);
  } else {
    drop.classList.add('open');
    setTimeout(()=>document.addEventListener('mousedown',_scAddFeatDropOutside),0);
  }
}
function scCloseAddFeatDrop(){
  const drop=document.getElementById('sc-addfeat-drop');
  if(drop)drop.classList.remove('open');
  document.removeEventListener('mousedown',_scAddFeatDropOutside);
}
function _scAddFeatDropOutside(e){
  const drop=document.getElementById('sc-addfeat-drop');
  if(!drop){document.removeEventListener('mousedown',_scAddFeatDropOutside);return;}
  if(!drop.contains(e.target)){
    drop.classList.remove('open');
    document.removeEventListener('mousedown',_scAddFeatDropOutside);
  }
}

let scPanelLinkingMetric=false;
let scLineageTargetElId='sc-panel-feat-meta'; // FC default; SC sets to 'nsc-trace-meta'

// ── Capability Nav Panel ──
function fcRenderCapNav(){
  const tree=document.getElementById('sc-cap-nav-tree');
  const nav=document.getElementById('sc-cap-nav');
  if(!tree||!nav)return;

  nav.classList.toggle('collapsed',scCapNavCollapsed);
  const colBtn=document.getElementById('sc-cap-nav-collapse');
  if(colBtn){
    colBtn.title=scCapNavCollapsed?'Expand':'Collapse';
    colBtn.innerHTML=scCapNavCollapsed
      ?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/><polyline points="3 18 9 12 3 6"/></svg>'
      :'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/><polyline points="21 18 15 12 21 6"/></svg>';
  }

  if(!scCanvas.length){
    tree.innerHTML='<div class="sc-cap-nav-empty">No features on canvas yet.<br>Select features from the KPI Tree.</div>';
    return;
  }

  // CRITICAL: null guard is mandatory — fcRenderCapNav() is called before any tree is generated
  const stageOrder=gData?gData.stages.map(s=>s.label):[];
  // Dynamic colour map from STAGE_PALETTE (defined in kpi-tree.js) by stage index
  const stageColorMap={};
  if(gData&&gData.stages){gData.stages.forEach((s,i)=>{stageColorMap[s.label]=STAGE_PALETTE[i%STAGE_PALETTE.length];});}
  const stageColors=stageColorMap;

  // Build: stage → metric → cap → count
  // PI Plan caps are grouped under single "Custom Capabilities" metric
  const treeData={};
  scCanvas.forEach(f=>{
    const st=f.stage||'Other';
    const isPIStage=st==='PI Plan';
    const mt=isPIStage?'Custom Capabilities':(f.metric||'Unknown');
    const cp=f.cap||'Uncategorised';
    if(!treeData[st])treeData[st]={metrics:{}};
    if(!treeData[st].metrics[mt])treeData[st].metrics[mt]={caps:{}};
    if(!treeData[st].metrics[mt].caps[cp])treeData[st].metrics[mt].caps[cp]=0;
    treeData[st].metrics[mt].caps[cp]++;
  });

  const allActive=scCapNavFilter===null;
  let h=`<div class="sc-nav-all${allActive?' active':''}" onclick="scSetCapFilter(null)">
    <i class="ti ti-layout-grid" style="font-size:12px;" aria-hidden="true"></i>
    <span class="sc-nav-all-text">All Features</span>
    <span class="sc-nav-count${allActive?' active':''}">${scCanvas.length}</span>
  </div>`;

  const orderedStages=[...stageOrder.filter(s=>treeData[s]),...Object.keys(treeData).filter(s=>!stageOrder.includes(s))];

  orderedStages.forEach(stage=>{
    const sg=treeData[stage];
    if(!sg)return;
    const color=stageColors[stage]||'var(--blue)';

    // Stage — coloured bar + label
    h+=`<div class="sc-nav-stage">
      <div class="sc-nav-stage-bar" style="background:${color}"></div>
      <span class="sc-nav-stage-lbl" style="color:${color}">${e(stage)}</span>
    </div>`;

    Object.entries(sg.metrics).forEach(([metric,md])=>{
      // Check if any feature under this metric came from diagnostic
      const hasDiagFeature=scCanvas.some(f=>f.metric===metric&&f.stage===stage&&f.origin==='diagnostic');
      // Metric label — not interactive, just structural
      h+=`<div class="sc-nav-metric">${hasDiagFeature?'<span class="sc-nav-diag-dot" title="Contains diagnostic-origin features"></span>':''}<span class="sc-nav-metric-name">${e(metric)}</span></div>`;

      Object.entries(md.caps).forEach(([cap,count])=>{
        const isActive=scCapNavFilter===cap;
        const capSafe=e(cap).split("'").join('&#39;');
        h+=`<div class="sc-nav-cap${isActive?' active':''}" onclick="scSetCapFilter('${capSafe}')">
          <div class="sc-nav-cap-track">
            <div class="sc-nav-cap-node${isActive?' active':''}"></div>
          </div>
          <div class="sc-nav-cap-body">
            <span class="sc-nav-cap-name">${e(cap)}</span>
            <span class="sc-nav-count${isActive?' active':''}">${count}</span>
          </div>
        </div>`;
      });
    });
  });

  tree.innerHTML=h;
}

function scToggleCapNav(){
  scCapNavCollapsed=!scCapNavCollapsed;
  fcRenderCapNav();
}

function scSetCapFilter(capName){
  scCapNavFilter=capName;
  scSelectedIds.clear(); // selection is filter-scoped — prevents hidden cross-filter selections feeding Generate Stories
  // Update filter badge in toolbar
  const badge=document.getElementById('sc-filter-badge');
  const label=document.getElementById('sc-filter-label');
  if(badge&&label){
    if(capName){
      label.textContent=capName;
      badge.style.display='inline-flex';
    } else {
      badge.style.display='none';
    }
  }
  fcRenderCapNav();
  fcRenderCanvas();
  // v8.55: update panel nav counter if a panel is already open
  if(scPanelFeatureId)scUpdatePanelNav();
}

function scMakeFeatureId(metric,cap,feat){
  return (metric+'|'+cap+'|'+feat).replace(/['"]/g,'');
}

// ── Toggle feature on/off canvas from cap drawer ──
// Reads feature data from parent element's data-* attributes — avoids inline string escaping bugs
function scToggleFeatureFromDrawer(checkEl){
  const item=checkEl.closest('[data-fid]');
  if(!item)return;
  scToggleFeature(
    item.dataset.fid,
    item.dataset.metric,
    item.dataset.stage,
    item.dataset.cap,
    item.dataset.fname,
    item.dataset.fwhy,
    checkEl
  );
}

function scToggleFeature(fid,metric,stage,cap,fname,fwhy,checkEl){
  const idx=scCanvas.findIndex(x=>x.id===fid);
  if(idx>=0){
    // Remove from canvas
    if(typeof pcDeleteProto==='function')pcDeleteProto(fid);
    scCanvas.splice(idx,1);
    checkEl.classList.remove('checked');
    checkEl.closest('.feat-item').classList.remove('on-canvas');
    // If this feature's panel is open, close it
    if(scPanelFeatureId===fid) scClosePanel();
    // Remove from both selection sets
    scSelectedIds.delete(fid);
    scPiSelectedIds.delete(fid);
  } else {
    // Add to canvas — compute full metric path from gData hierarchy
    const metricPath=scGetMetricPath(metric);
    scCanvas.push({id:fid,metric,metricPath,stage,cap,name:fname,why:fwhy,stories:null,origin:'kpi'});
    checkEl.classList.add('checked');
    checkEl.closest('.feat-item').classList.add('on-canvas');
  }
  scUpdateCapDrawerFooter();
  fcUpdateTabBadge();
  fcRenderCanvas();
}

function scUpdateCapDrawerFooter(){
  const footer=document.getElementById('cap-drawer-footer');
  const count=document.getElementById('cap-canvas-count-num');
  count.textContent=scCanvas.length;
  footer.style.display=scCanvas.length>0?'flex':'none';
}

function fcUpdateTabBadge(){
  const badge=document.getElementById('fc-tab-badge');
  if(badge){badge.textContent=scCanvas.length;badge.classList.toggle('on',scCanvas.length>0);}
  // Reveal tab on first feature — one-way door, never re-hidden
  if(scCanvas.length>0){
    const tabBtn=document.getElementById('tab-fc');
    if(tabBtn)tabBtn.style.display='';
  }
}

// ── Canvas rendering ──
// Look up evidence for a metric name from the active diagnostic session
function scGetMetricEvidence(metricName){
  if(!diagnosticSessions||!diagnosticSessions.length||!activeDiagnosticId)return null;
  const session=diagnosticSessions.find(s=>s.id===activeDiagnosticId);
  if(!session||!session.tree)return null;
  for(var si=0;si<(session.tree.stages||[]).length;si++){
    var st=session.tree.stages[si];
    for(var li=0;li<(st.l1_metrics||[]).length;li++){
      var l1=st.l1_metrics[li];
      if(!l1)continue;
      if(l1.name===metricName)return l1.evidence||null;
      for(var l2i=0;l2i<(l1.l2_metrics||[]).length;l2i++){
        var l2=l1.l2_metrics[l2i];
        if(!l2)continue;
        if(l2.name===metricName)return l2.evidence||null;
        for(var l3i=0;l3i<(l2.l3_metrics||[]).length;l3i++){
          var l3=l2.l3_metrics[l3i];
          if(l3&&l3.name===metricName)return l3.evidence||null;
        }
      }
    }
  }
  return null;
}

// Build evidence chip HTML — returns empty string if no evidence
// Colour is driven by trend direction: Improving=green, Flat/Declining=amber, Unknown/none=grey
function scBuildEvidenceChip(metricName){
  const ev=scGetMetricEvidence(metricName);
  if(!ev||!ev.currentValue)return'';
  // Colour by trend direction
  var bgCls='sc-ev-chip-neutral';
  if(ev.trend==='Improving')bgCls='sc-ev-chip-improving';
  else if(ev.trend==='Declining'||ev.trend==='Flat')bgCls='sc-ev-chip-warning';
  // Build trend text with direction icon
  const trendMap={'Improving':'↑ Improving','Declining':'↓ Declining','Flat':'→ Flat','Unknown':'Unknown'};
  const trendHtml=ev.trend&&trendMap[ev.trend]?'<span class="sc-ev-trend">'+trendMap[ev.trend]+'</span>':'';
  return'<span class="sc-ev-chip '+bgCls+'">'+e(ev.currentValue)+(trendHtml?' '+trendHtml:'')+'</span>';
}

// Returns a flat ordered list of metric names in KPI tree order (L1, L2, L3 per stage) in KPI tree order (L1, L2, L3 per stage)
function scGetMetricOrder(){
  const order=[];
  if(!gData||!gData.stages)return order;
  gData.stages.forEach(function(st){
    (st.l1_metrics||[]).forEach(function(l1){
      if(l1&&l1.name){
        order.push(l1.name);
        (l1.l2_metrics||[]).forEach(function(l2){
          if(l2&&l2.name){
            order.push(l2.name);
            (l2.l3_metrics||[]).forEach(function(l3){if(l3&&l3.name)order.push(l3.name);});
          }
        });
      }
    });
  });
  return order;
}
// ── Metric path lookup ──
// Given a metric name and gData, returns the full path e.g. "L1 Name › L2 Name"
function scGetMetricPath(metricName){
  if(!gData||!gData.stages||!metricName)return metricName||'';
  for(var si=0;si<gData.stages.length;si++){
    var st=gData.stages[si];
    var l1s=st.l1_metrics||[];
    for(var li=0;li<l1s.length;li++){
      var l1=l1s[li];
      if(!l1)continue;
      if(l1.name===metricName)return l1.name;
      var l2s=l1.l2_metrics||[];
      for(var l2i=0;l2i<l2s.length;l2i++){
        var l2=l2s[l2i];
        if(!l2)continue;
        if(l2.name===metricName)return l1.name+' › '+l2.name;
        var l3s=l2.l3_metrics||[];
        for(var l3i=0;l3i<l3s.length;l3i++){
          var l3=l3s[l3i];
          if(!l3)continue;
          if(l3.name===metricName)return l1.name+' › '+l2.name+' › '+l3.name;
        }
      }
    }
  }
  return metricName;
}

// ── Metric breadcrumb builder (single line, right-truncate L1 first then L2) ──
function scBuildMetricBreadcrumb(metricPath){
  if(!metricPath)return'';
  var fullPath=metricPath;
  return'<div class="sc-metric-breadcrumb" data-tooltip="'+e(fullPath)+'">'+e(fullPath)+'</div>';
}

// Priority truncation for metric breadcrumb (single line)
function scFitMetricBreadcrumbs(){
  document.querySelectorAll('.sc-metric-breadcrumb').forEach(function(el){
    var fullPath=el.dataset.tooltip||'';
    if(el.scrollWidth<=el.clientWidth+2)return;
    var origSegs=fullPath.split(' › ').map(function(s){return s.trim();}).filter(Boolean);
    if(origSegs.length<=1)return;
    var segs=origSegs.slice();
    var MIN=6;
    var SEP=' › ';
    function render(){el.textContent=segs.join(SEP);}
    function fits(){return el.scrollWidth<=el.clientWidth+2;}
    // shorten L1 first
    for(var len=segs[0].length-3;len>=MIN;len-=3){
      segs[0]=origSegs[0].slice(0,len)+'…';
      render();if(fits())return;
    }
    segs[0]=origSegs[0].slice(0,MIN)+'…';
    // shorten L2 if 3 levels
    if(segs.length>=3){
      render();if(fits())return;
      for(var len2=segs[1].length-3;len2>=MIN;len2-=3){
        segs[1]=origSegs[1].slice(0,len2)+'…';
        render();if(fits())return;
      }
      segs[1]=origSegs[1].slice(0,MIN)+'…';
    }
    render();
  });
}

// ── Capability breadcrumb builder ──
// cap field format: "L1 Cap" or "L1 Cap › L2 Cap" or "L1 Cap › L2 Cap › L3 Cap"
// Returns HTML string for the breadcrumb line with full path in title attribute
function scBuildCapBreadcrumb(cap){
  if(!cap)return'';
  const segs=cap.split('›').map(s=>s.trim()).filter(Boolean);
  // Build full path for tooltip
  const fullPath=segs.join(' › ');
  // Build rendered HTML - segments joined with styled separator
  const rendered=segs.map(s=>e(s)).join('<span class="sc-bc-sep">›</span>');
  return'<div class="sc-cap-breadcrumb" data-tooltip="'+e(fullPath)+'" id="scbc-'+Math.random().toString(36).slice(2)+'">'+rendered+'</div>';
}

// Priority truncation: shorten L1 first, then L2, preserve L3
// Called after render via requestAnimationFrame
function scFitBreadcrumbs(){
  document.querySelectorAll('.sc-cap-breadcrumb').forEach(function(el){
    const MAX_LINES=2;
    const LINE_H=el.offsetHeight>0?el.scrollHeight/2:14;
    if(el.scrollHeight<=el.offsetHeight*MAX_LINES+2)return;
    const fullPath=el.dataset.tooltip||'';
    const origSegs=fullPath.split(' › ').map(s=>s.trim()).filter(Boolean);
    if(origSegs.length<=1)return;
    const segs=[...origSegs];
    const MIN=6;
    const SEP='<span class="sc-bc-sep">›</span>';
    function render(){el.innerHTML=segs.map(s=>e(s)).join(SEP);}
    function fits(){return el.scrollHeight<=el.clientHeight+4;}
    // Phase 1: shorten L1
    if(segs.length>=2){
      for(let len=segs[0].length-3;len>=MIN;len-=3){
        segs[0]=origSegs[0].slice(0,len)+'…';
        render();if(fits())return;
      }
      segs[0]=origSegs[0].slice(0,MIN)+'…';
    }
    // Phase 2: shorten L2
    if(segs.length>=3){
      render();if(fits())return;
      for(let len=segs[1].length-3;len>=MIN;len-=3){
        segs[1]=origSegs[1].slice(0,len)+'…';
        render();if(fits())return;
      }
      segs[1]=origSegs[1].slice(0,MIN)+'…';
    }
    // Phase 3: hard clamp L3 with CSS as last resort
    el.style.display='-webkit-box';
    el.style.webkitLineClamp='2';
    el.style.webkitBoxOrient='vertical';
    el.style.overflow='hidden';
    render();
  });
}

// Shared visible-set computation — capability filter + stories filter.
// Used by fcRenderCanvas (what's on screen) and scSelectAll (what "select all" should select),
// so the two never drift out of sync with each other.
function fcGetVisibleCanvas(){
  let visibleCanvas=scCapNavFilter ? scCanvas.filter(f=>f.cap===scCapNavFilter) : scCanvas;
  const _hasGen=fcStoriesFilter.has('generated');
  const _hasNotGen=fcStoriesFilter.has('not-generated');
  if(_hasGen&&!_hasNotGen) visibleCanvas=visibleCanvas.filter(f=>f.stories&&f.stories.length>0);
  else if(_hasNotGen&&!_hasGen) visibleCanvas=visibleCanvas.filter(f=>!f.stories||f.stories.length===0);
  if(fcOriginFilter.size){
    visibleCanvas=visibleCanvas.filter(f=>{
      const _o=f.origin||'kpi';
      const _isDoc=_o==='doc';
      const _isCustom=_o==='pi';
      const _isMI=_o==='market';
      const _isDiag=_o==='diagnostic';
      const _isKpi=!_isDoc&&!_isCustom&&!_isMI&&!_isDiag;
      if(fcOriginFilter.has('origin-doc')&&_isDoc)return true;
      if(fcOriginFilter.has('origin-custom')&&_isCustom)return true;
      if(fcOriginFilter.has('origin-mi')&&_isMI)return true;
      if(fcOriginFilter.has('origin-diag')&&_isDiag)return true;
      if(fcOriginFilter.has('origin-kpi')&&_isKpi)return true;
      return false;
    });
  }
  // both or neither = show all
  return visibleCanvas;
}

function fcRenderCanvas(){
  // Keep cap nav in sync
  if(curTab==='fc') fcRenderCapNav();
  const empty=document.getElementById('sc-empty-state');
  const content=document.getElementById('sc-content');
  const actionBar=document.getElementById('sc-action-bar');
  // Apply capability nav filter + stories filter
  let visibleCanvas=fcGetVisibleCanvas();

  if(scCanvas.length===0){
    empty.style.display='flex';
    content.style.display='none';
    actionBar.style.display='none';
    return;
  }
  empty.style.display='none';
  content.style.display='flex';
  actionBar.style.display='flex';

  // Filter empty state
  if(visibleCanvas.length===0&&scCanvas.length>0){
    document.getElementById('sc-cards-container').innerHTML=
      `<div style="padding:40px 20px;text-align:center;color:var(--t3);">
        <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:8px;">No features match the current filter</div>
        <div style="font-size:11px;margin-bottom:14px;">Try clearing the filter to see all features.</div>
        <button onclick="fcClearFilter()" style="background:none;border:1px solid var(--divider);border-radius:5px;padding:5px 12px;font-size:11px;cursor:pointer;color:var(--t2);">Clear filter</button>
      </div>`;
    scUpdateActionBar(visibleCanvas);
    scUpdateDoneBadge();
    return;
  }

  // Build groups — use visibleCanvas for display
  let groups=[];
  if(scGroupMode==='metric'){
    const map={};
    visibleCanvas.forEach(f=>{
      // All PI Plan caps merge under single Custom Capabilities group
      const isPIStage=f.stage==='PI Plan';
      const k=isPIStage?'PI Plan||Custom Capabilities':f.stage+'||'+f.metric;
      const label=isPIStage?'Custom Capabilities':(f.metricPath||f.metric);
      const metricKey=isPIStage?'Custom Capabilities':f.metric;
      if(!map[k])map[k]={label,metricKey,stage:f.stage,features:[]};
      map[k].features.push(f);
    });
    groups=Object.values(map);
  } else {
    const map={};
    visibleCanvas.forEach(f=>{
      const k=f.cap;
      if(!map[k])map[k]={label:f.cap,stage:f.stage,features:[]};
      map[k].features.push(f);
    });
    groups=Object.values(map);
  }

  // Dynamic colour map from STAGE_PALETTE by stage index
  const scRenderColorMap={};
  if(gData&&gData.stages){gData.stages.forEach((s,i)=>{scRenderColorMap[s.label]=STAGE_PALETTE[i%STAGE_PALETTE.length];});}

  // Sort groups: first by stage order, then by metric position within KPI tree
  if(gData&&gData.stages&&gData.stages.length){
    const stageOrder=gData.stages.map(s=>s.label);
    const metricOrder=scGetMetricOrder();
    groups.sort(function(a,b){
      const ai=stageOrder.indexOf(a.stage);
      const bi=stageOrder.indexOf(b.stage);
      if(ai!==bi){
        if(ai===-1)return 1;
        if(bi===-1)return -1;
        return ai-bi;
      }
      // Same stage — sort by metric position in KPI tree
      // Sort by bare metric name, not the full path label
      const ami=metricOrder.indexOf(a.metricKey||a.label);
      const bmi=metricOrder.indexOf(b.metricKey||b.label);
      if(ami===-1&&bmi===-1)return 0;
      if(ami===-1)return 1;
      if(bmi===-1)return -1;
      return ami-bmi;
    });
  }

  let h='';
  groups.forEach(g=>{
    const color=scRenderColorMap[g.stage]||STAGE_PALETTE[0];
    const featCount=g.features.length;
    const doneCount=g.features.filter(f=>f.stories&&f.stories.length>0).length;
    const countLabel=scGroupMode==='metric'
      ? featCount+' feature'+(featCount!==1?'s':'')+(doneCount>0?' · '+doneCount+' with stories':'')
      : featCount+' feature'+(featCount!==1?'s':'');
    const _fcGroupKey=g.stage+'||'+(g.metricKey||g.label);
    const _fcIsCollapsed=fcCollapsedGroups.has(_fcGroupKey);
    h+=`<div class="sc-metric-group">`;
    h+=`<div class="sc-metric-hdr" style="border-left:3px solid ${color};">`;
    h+=`<span class="sc-stage-pill" style="background:${color}">${e(g.stage)}</span>`;
    // Render metric hierarchy path with styled separators
    const metricSegs=(g.label||'').split('›').map(s=>s.trim()).filter(Boolean);
    const metricHtml=metricSegs.map((s,i)=>(i>0?'<span class="sc-metric-sep">›</span>':'')+`<span class="sc-metric-seg${i===metricSegs.length-1?' sc-metric-seg-last':''}">${e(s)}</span>`).join('');
    h+=`<div class="sc-metric-name" title="${e(g.label)}">${metricHtml}</div>`;
    // Evidence chip — only shown when diagnostic session has evidence for this metric
    h+=scBuildEvidenceChip(g.metricKey||g.label);
    h+=`<div class="sc-metric-count">${e(countLabel)}</div>`;
    h+=`<button class="nsc-chevron" onclick="fcToggleGroup('${e(_fcGroupKey)}')" title="${_fcIsCollapsed?'Expand':'Collapse'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${_fcIsCollapsed?'<polyline points="9 18 15 12 9 6"/>':'<polyline points="18 15 12 9 6 15"/>'}</svg></button>`;
    h+=`</div>`;
    if(_fcIsCollapsed){
      h+=`<div class="nsc-collapsed-hint">Features hidden — click ▶ to expand</div>`;
    } else {
    h+=`<div class="sc-cards">`;
    g.features.forEach(f=>{
      const hasDone=f.stories&&f.stories.length>0;
      const isSel=scSelectedIds.has(f.id);
      const isActive=scPanelFeatureId===f.id;
      const isDiag=f.origin==='diagnostic';
      const isMI=f.origin==='market';
      const isPI=f.origin==='pi';
      const _inScCount=hasDone?(f.stories||[]).filter(st=>st._inSC).length:0;
      const _stagedCount=hasDone?(f.stories||[]).filter(st=>st._stagedForPI).length:0;
      const isPiSel=scPiSelectedIds.has(f.id)||_inScCount>0;
      const piSelStoryCount=_inScCount>0?_inScCount:_stagedCount;
      const piSelIsPartial=isPiSel&&piSelStoryCount>0&&piSelStoryCount<(f.stories||[]).length;

      let cls='sc-card';
      if(isDiag)cls+=' sc-card-diagnostic';
      else if(isMI)cls+=' sc-card-market';
      else if(isPI)cls+=' sc-card-pi';
      else cls+=' sc-card-kpi';
      if(hasDone&&isPiSel)cls+=' sc-card-pi-sel';
      else if(hasDone)cls+=' sc-card-done';
      else if(isSel)cls+=' sc-card-sel';
      if(isActive)cls+=' sc-card-active';

      const cardClick=`scOpenPanel('${e(f.id)}')`;
      h+=`<div class="${cls}" id="sc-card-${e(f.id)}" onclick="${cardClick}" style="cursor:pointer;">`;
      h+=`<div class="sc-card-top">`;
      h+=scBuildCapBreadcrumb(f.cap);
      h+=`<div class="sc-card-actions">`;
      h+=`<button class="sc-card-pencil" onclick="event.stopPropagation();scShowEditFeatModal('${e(f.id)}')" title="Edit feature" aria-label="Edit feature"><i class="ti ti-pencil" style="font-size:10px;" aria-hidden="true"></i></button>`;
      if(!hasDone){
        // No-story cards: checkbox selects feature for story generation
        h+=`<div class="sc-card-check" onclick="event.stopPropagation();scToggleSelect('${e(f.id)}')" title="Select for story generation">`;
        if(isSel)h+=`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        h+=`</div>`;
      } else {
        // Done cards: checkbox selects stories for PI planning (full/partial/none)
        const piCheckTitle=isPiSel?'Deselect from PI planning':'Select for PI planning';
        h+=`<div class="sc-card-check${isPiSel?' sc-card-check-pi':''}" onclick="event.stopPropagation();scTogglePiSelect('${e(f.id)}')" title="${piCheckTitle}">`;
        if(isPiSel&&!piSelIsPartial){
          h+=`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        } else if(piSelIsPartial){
          h+=`<div style="width:8px;height:2px;background:#fff;border-radius:1px;"></div>`;
        }
        h+=`</div>`;
      }
      h+=`<button class="sc-card-remove" onclick="event.stopPropagation();scRemoveFeature('${e(f.id)}')" title="Remove from canvas">`;
      h+=`<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      h+=`</button>`;
      h+=`</div></div>`;
      // Origin icon + name
      const isDoc=f.origin==='doc';
      const _scOriginIcon=isDiag?'ti-microscope':isMI?'ti-world-search':isDoc?'ti-file-text':f.origin==='pi'?'ti-clipboard-list':'ti-hierarchy-2';
      const _scOriginTitle=isDiag?'From Product Diagnostics':isMI?'From Market Intelligence':isDoc?'From Session Document':f.origin==='pi'?'From Custom plan':'From KPI Tree Capability';
      const _scOriginClass=isDiag?'sc-origin-icon-diag':isMI?'sc-origin-icon-market':isDoc?'sc-origin-icon-doc':f.origin==='pi'?'sc-origin-icon-pi':'sc-origin-icon-kpi';
      h+=`<div class="sc-card-name-row"><span class="sc-origin-icon ${_scOriginClass}" title="${_scOriginTitle}" style="width:14px;height:14px;flex-shrink:0;border-radius:3px;"><i class="ti ${_scOriginIcon}" style="font-size:9px;" aria-hidden="true"></i></span><div class="sc-card-name">${e(f.name)}</div></div>`;
      h+=`<div class="sc-card-why">${e(f.why)}</div>`;
      h+=`<div class="sc-card-footer">`;
      if(hasDone){
        const storyLbl=f.stories.length+' stor'+(f.stories.length===1?'y':'ies');
        const inScCount=f.stories.filter(s=>s._inSC).length;
        h+=`<div class="sc-status-done"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span class="sc-story-badge">${storyLbl}</span></div>`;
        if(inScCount>0)h+=`<div class="sc-feat-insc-tag"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${inScCount} in Story Canvas</div>`;
      } else if(isSel){
        h+=`<div class="sc-status-none"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> No stories yet</div>`;

      } else {
        h+=`<div class="sc-status-none"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> No stories yet</div>`;
      }
      h+=`</div></div>`;
    });
    if(!_fcIsCollapsed){h+=`</div>`;}
    }
    h+=`</div>`;
  });
  document.getElementById('sc-cards-container').innerHTML=h;
  scUpdateActionBar(visibleCanvas);
  scUpdateDoneBadge();
  requestAnimationFrame(function(){requestAnimationFrame(scFitBreadcrumbs);});
}

function scUpdateDoneBadge(){
  const done=scCanvas.filter(f=>f.stories&&f.stories.length>0).length;
  const badge=document.getElementById('sc-done-badge');
  const countEl=document.getElementById('sc-done-count');
  badge.style.display=done>0?'flex':'none';
  countEl.textContent=done;
  document.getElementById('sc-feat-count-badge').textContent=scCanvas.length+' feature'+(scCanvas.length!==1?'s':'');
}

// ── FC: Compute how many stories are queued for SC send ──
// Rules: for each selected feature:
//   - if it has _stagedForPI stories → count only those (panel partial selection)
//   - else if it has stories → count all (card-level = send all)
//   - else → 0 (no stories, don't count)
function fcGetSCQueueCount(){
  let n=0;
  scSelectedIds.forEach(fid=>{
    const feat=scCanvas.find(x=>x.id===fid);
    if(!feat||!feat.stories||feat.stories.length===0)return;
    const piSel=feat.stories.filter(s=>s._stagedForPI).length;
    n+=piSel>0?piSel:feat.stories.length;
  });
  return n;
}

function scUpdateActionBar(visibleCanvas){
  if(!visibleCanvas)visibleCanvas=scCanvas;
  const visibleIds=new Set(visibleCanvas.map(f=>f.id));
  const sel=Array.from(scSelectedIds).filter(id=>visibleIds.has(id)).length;
  const done=scCanvas.filter(f=>f.stories&&f.stories.length>0).length;
  const doneVisible=visibleCanvas.filter(f=>f.stories&&f.stories.length>0).length;
  const total=visibleCanvas.length;
  const totalStories=scCanvas.reduce((a,f)=>a+(f.stories?f.stories.length:0),0);

  // Select All toggle state
  const chk=document.getElementById('sc-select-all-chk');
  const lbl=document.getElementById('sc-select-all-lbl');
  if(chk){
    chk.checked=total>0&&sel===total;
    chk.indeterminate=sel>0&&sel<total;
  }
  if(lbl)lbl.textContent=sel===total&&total>0?'Deselect all':'Select all';

  // Info count
  const infoEl=document.getElementById('sc-action-info');
  if(infoEl){
    const _fcThresholdActive=sel>=4&&(typeof resolveThresholdModel==='function')&&resolveThresholdModel(sel)!==null;
    if(sel>0)infoEl.innerHTML=`<strong>${sel}</strong> of ${total} selected${_fcThresholdActive?' <span style="color:var(--blue);">· 4+ items use a faster, lower-quality AI model</span>':''}`;
    else infoEl.innerHTML=doneVisible>0?`<strong>${doneVisible}</strong> feature${doneVisible!==1?'s':''} with stories`:'';
  }

  // Generate button
  const genBtn=document.getElementById('sc-gen-btn');
  if(genBtn){genBtn.disabled=sel===0;}
  const genLbl=document.getElementById('sc-gen-btn-label');
  if(genLbl)genLbl.textContent=sel>1?'Generate for '+sel+' Features':sel===1?'Generate Stories':'Generate Stories';

  // Export button — enable when any features are visible (FC exports Feature Brief, not stories)
  const expBtn=document.getElementById('sc-export-btn');
  if(expBtn&&!fcExportInFlight){expBtn.disabled=total===0;}
}

function scSetGroup(mode){
  scGroupMode=mode;
  document.getElementById('sc-grp-metric').classList.toggle('active',mode==='metric');
  document.getElementById('sc-grp-cap').classList.toggle('active',mode==='cap');
  fcRenderCanvas();
}

function scToggleSelect(fid){
  if(scSelectedIds.has(fid))scSelectedIds.delete(fid);
  else scSelectedIds.add(fid);
  // Refresh panel tag if this feature is currently open
  if(scPanelFeatureId===fid){
    const tagEl=document.querySelector('.sc-panel-tag');
    if(tagEl){
      const isSel=scSelectedIds.has(fid);
      tagEl.innerHTML=isSel
        ?'User Stories &nbsp;<span style="font-size:8px;background:var(--purple-pale);color:var(--purple);border:1px solid var(--purple-light);border-radius:10px;padding:1px 6px;font-weight:700;letter-spacing:0;">Selected for gen</span>'
        :'User Stories';
    }
  }
  fcRenderCanvas();
}

function scClearSelection(){
  scSelectedIds.clear();
  fcRenderCanvas();
}

function scSelectAll(){
  fcGetVisibleCanvas().forEach(f=>scSelectedIds.add(f.id));
  fcRenderCanvas();
}

function scToggleSelectAll(chk){
  if(chk.checked){scSelectAll();}
  else{scClearSelection();}
}

// ── FC Filter ──
function fcToggleFilterDrop(evt){
  if(evt)evt.stopPropagation();
  const drop=document.getElementById('fc-filter-drop');
  if(!drop)return;
  const isOpen=drop.classList.contains('open');
  
  if(isOpen){
    drop.classList.remove('open');
    document.removeEventListener('mousedown',fcFilterDropOutside);
  } else {
    drop.classList.add('open');
    setTimeout(()=>document.addEventListener('mousedown',fcFilterDropOutside),0);
  }
}
function fcFilterDropOutside(e){
  const drop=document.getElementById('fc-filter-drop');
  if(!drop){document.removeEventListener('mousedown',fcFilterDropOutside);return;}
  if(!drop.contains(e.target)){
    drop.classList.remove('open');
    document.removeEventListener('mousedown',fcFilterDropOutside);
  }
}
function fcSetOriginFilter(val){
  if(fcOriginFilter.has(val)){fcOriginFilter.delete(val);}
  else{fcOriginFilter.add(val);}
  const isActive=fcOriginFilter.size>0||fcStoriesFilter.size>0;
  const btn=document.getElementById('fc-filter-btn');
  if(btn)btn.classList.toggle('active',isActive);
  const badge=document.getElementById('sc-filter-badge');
  const label=document.getElementById('sc-filter-label');
  if(badge&&label){
    const total=fcOriginFilter.size+fcStoriesFilter.size;
    badge.style.display=total>0?'inline-flex':'none';
    label.textContent=total+' filter'+(total!==1?'s':'');
  }
  fcRenderCanvas();
  // Update panel nav counter if a panel is open
  if(scPanelFeatureId)scUpdatePanelNav();
}

function fcSetStoriesFilter(val){
  if(fcStoriesFilter.has(val)){fcStoriesFilter.delete(val);}
  else{fcStoriesFilter.add(val);}
  scSelectedIds.clear(); // selection is filter-scoped — same fix as scSetCapFilter
  const isActive=fcStoriesFilter.size>0&&fcStoriesFilter.size<2;
  const btn=document.getElementById('fc-filter-btn');
  if(btn)btn.classList.toggle('active',isActive);
  const badge=document.getElementById('sc-filter-badge');
  const label=document.getElementById('sc-filter-label');
  if(badge&&label){
    if(isActive){
      label.textContent='1 filter';
      badge.style.display='inline-flex';
    } else {
      badge.style.display='none';
    }
  }
  fcRenderCanvas();
  // Update panel nav counter if a panel is open — must fire after fcRenderCanvas
  // so fcGetVisibleCanvas() reflects the new filter state
  if(scPanelFeatureId)scUpdatePanelNav();
}
function fcClearFilter(){
  fcStoriesFilter=new Set();
  fcOriginFilter=new Set();
  ['fc-filter-origin-kpi','fc-filter-origin-doc','fc-filter-origin-custom','fc-filter-origin-mi','fc-filter-origin-diag'].forEach(function(id){
    const el=document.getElementById(id);
    if(el)el.checked=false;
  });
  scSelectedIds.clear(); // selection is filter-scoped — same fix as scSetCapFilter/fcSetStoriesFilter
  const btn=document.getElementById('fc-filter-btn');
  if(btn)btn.classList.remove('active');
  const badge=document.getElementById('sc-filter-badge');
  if(badge)badge.style.display='none';
  ['fc-filter-generated','fc-filter-not-generated'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.checked=false;
  });
  fcRenderCanvas();
  // Update panel nav counter if a panel is open
  if(scPanelFeatureId)scUpdatePanelNav();
}







function scRemoveFeature(fid){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat)return;
  const storyCount=feat.stories&&feat.stories.length>0?feat.stories.length:0;
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='sc-del-feat-overlay';
  const warningStrip=storyCount>0
    ?`<div style="display:flex;align-items:flex-start;gap:8px;background:var(--amber-bg,#FAEEDA);border:0.5px solid var(--amber,#BA7517);border-radius:6px;padding:8px 10px;margin-bottom:16px;">
        <i class="ti ti-alert-triangle" style="font-size:14px;color:var(--amber,#BA7517);margin-top:1px;flex-shrink:0;" aria-hidden="true"></i>
        <div style="font-size:11px;color:var(--amber-dark,#633806);line-height:1.5;">This will also delete <strong>${storyCount} associated stor${storyCount!==1?'ies':'y'}</strong>. This cannot be undone.</div>
      </div>`
    :`<div style="font-size:12px;color:var(--t3);line-height:1.6;margin-bottom:16px;">This cannot be undone.</div>`;
  overlay.innerHTML=`<div class="modal" style="max-width:380px;;position:relative;">
    <button onclick="document.getElementById('sc-del-feat-overlay').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
      <div style="font-size:13px;font-weight:500;color:var(--t1);">Delete "${e(feat.name)}"?</div>
    </div>
    <div style="padding:14px 20px 4px;">
      ${warningStrip}
    </div>
    <div class="modal-footer">
      <button class="modal-cancel-btn" onclick="document.getElementById('sc-del-feat-overlay').remove()">Cancel</button>
      <button class="modal-confirm-btn danger" onclick="document.getElementById('sc-del-feat-overlay').remove();scDoRemoveFeature('${e(fid)}')"><i class="ti ti-trash" style="font-size:12px;" aria-hidden="true"></i> Delete</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const _esc=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_esc,true);}};
  document.addEventListener('keydown',_esc,true);
  trapFocus(overlay);
}

function scDoRemoveFeature(fid){
  const idx=scCanvas.findIndex(x=>x.id===fid);
  if(idx<0)return;
  if(typeof pcDeleteProto==='function')pcDeleteProto(fid);
  scCanvas.splice(idx,1);
  scSelectedIds.delete(fid);
  scPiSelectedIds.delete(fid);
  if(scPanelFeatureId===fid)scClosePanel();
  fcUpdateTabBadge();
  scUpdateCapDrawerFooter();
  fcRenderCanvas();
  const chk=document.getElementById('fi-'+fid);
  if(chk){
    const checkEl=chk.querySelector('.feat-item-check');
    if(checkEl){checkEl.classList.remove('checked');chk.classList.remove('on-canvas');}
  }
}

// ── Story Panel ──
function scOpenPanel(fid){
  if(blockIfGenerating(()=>scOpenPanel(fid)))return;
  // Toggle-close: clicking the already-open feature closes the panel
  if(scPanelFeatureId===fid){scClosePanel();return;}
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat)return;
  scPanelFeatureId=fid;
  document.getElementById('sc-panel-feat-name').textContent=feat.name;
  // Show selection indicator in panel tag
  const tagEl=document.querySelector('.sc-panel-tag');
  if(tagEl){
    const isSel=scSelectedIds.has(fid);
    tagEl.innerHTML=isSel
      ?'User Stories &nbsp;<span style="font-size:8px;background:var(--purple-pale);color:var(--purple);border:1px solid var(--purple-light);border-radius:10px;padding:1px 6px;font-weight:700;letter-spacing:0;">Selected for gen</span>'
      :'User Stories';
  }
  scLineageTargetElId='sc-panel-feat-meta';
  scRenderLineage(feat);
  document.getElementById('sc-main').classList.add('panel-open');
  document.getElementById('sc-panel').classList.add('open');
  scRenderPanel(feat);
  scUpdatePanelNav();
  fcRenderCanvas(); // update active card ring
}

function scRenderLineage(feat,targetElId){
  const el=document.getElementById(targetElId||scLineageTargetElId||'sc-panel-feat-meta');
  if(!el)return;
  const fid=feat.id;
  const origin=feat.origin||'kpi';
  const isDiag=origin==='diagnostic';
  const isMI=origin==='market';
  const isPI=origin==='pi';
  const hasMetric=!!(feat.metric&&feat.metric.trim());
  const hasStage=!!(feat.stage&&feat.stage.trim()&&feat.stage!=='PI Plan');
  const _isCap=typeof gData!=='undefined'&&gData&&gData.approach==='capability-based';
  const _metricLbl=_isCap?'Parent Capability':'Metric';
  const _capDefaultLbl='Capability';

  // Build breadcrumb preview for collapsed state
  const segs=[feat.stage,feat.metric,feat.cap].filter(s=>s&&s.trim()&&s!=='PI Plan');
  const preview=segs.join(' › ')||feat.cap||'—';

  // Dot helper
  function dot(colorHex,sq,dashed){
    const br=sq?'border-radius:2px':'border-radius:50%';
    if(dashed)return`<span class="sc-panel-lineage-dot dashed"></span>`;
    return`<span class="sc-panel-lineage-dot ${sq?'sq':''}" style="background:${colorHex};${sq?'border-radius:2px':''}"></span>`;
  }

  // Collapsed state
  if(!scPanelLineageOpen){
    el.innerHTML=`<div class="sc-panel-lineage-hdr" onclick="scToggleLineage('${e(fid)}')">
      <i class="ti ti-git-branch" style="font-size:11px;color:#534AB7;flex-shrink:0;" aria-hidden="true"></i>
      <span class="sc-panel-lineage-label">Traceability</span>
      <span class="sc-panel-lineage-sep">|</span>
      <span class="sc-panel-lineage-preview">${e(preview)}</span>
      <i class="ti ti-chevron-down" style="font-size:11px;color:var(--t3);flex-shrink:0;" aria-hidden="true"></i>
    </div>`;
    return;
  }

  // Expanded state — build rows
  let rows='';

  // Stage row
  if(!hasStage){
    rows+=`<div class="sc-panel-lineage-row unlinked">
      <span class="sc-panel-lineage-key" style="color:var(--t3);">Stage</span>
      ${dot('','',true)}
      <span class="sc-panel-lineage-val" style="font-style:italic;color:var(--t3);">Not linked</span>
    </div>`;
  } else {
    rows+=`<div class="sc-panel-lineage-row">
      <span class="sc-panel-lineage-key" style="color:#0F6E56;">Stage</span>
      ${dot('#0F6E56',false,false)}
      <span class="sc-panel-lineage-val" style="color:#085041;">${e(feat.stage)}</span>
    </div>`;
  }

  // Metric row
  if(!hasMetric&&!scPanelLinkingMetric){
    rows+=`<div class="sc-panel-lineage-row unlinked">
      <span class="sc-panel-lineage-key" style="color:var(--t3);">${_metricLbl}</span>
      ${dot('','',true)}
      <span class="sc-panel-lineage-val"><span style="font-style:italic;color:var(--t3);">No ${_metricLbl.toLowerCase()} linked.</span>&nbsp;<a class="sc-panel-lineage-link" onclick="scShowLinkMetricModal('${e(fid)}')">Link one?</a></span>
    </div>`;
  } else if(!hasMetric&&scPanelLinkingMetric){
    // Inline picker — Stage row shows resolving hint
    rows='';
    rows+=`<div class="sc-panel-lineage-row unlinked">
      <span class="sc-panel-lineage-key" style="color:var(--t3);">Stage</span>
      ${dot('','',true)}
      <span class="sc-panel-lineage-val" style="font-style:italic;color:var(--t3);">Resolves on selection</span>
    </div>`;
    // Build metric dropdown from gData L1 metrics only
    let opts=`<option value="">Select a ${_metricLbl.toLowerCase()}…</option>`;
    if(typeof gData!=='undefined'&&gData&&gData.stages){
      gData.stages.forEach(st=>{
        if(!st.l1_metrics||!st.l1_metrics.length)return;
        opts+=`<optgroup label="${e(st.label)}">`;
        st.l1_metrics.forEach(m=>{
          opts+=`<option value="${e(m.name)}">${e(m.name)}</option>`;
        });
        opts+=`</optgroup>`;
      });
    }
    rows+=`<div class="sc-panel-lineage-row" style="flex-direction:column;align-items:flex-start;padding:6px 0 8px;">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;">
        ${dot('#185FA5',false,false)}
        <span class="sc-panel-lineage-key" style="color:#185FA5;width:auto;">${_metricLbl}</span>
        <span style="font-size:9px;color:var(--t3);">${_isCap?'— pick one from your Discovery Map':'— pick one from your KPI tree'}</span>
      </div>
      <div class="sc-panel-lineage-picker">
        <select id="sc-lineage-metric-sel" onchange="document.getElementById('sc-lineage-confirm').disabled=!this.value;">
          ${opts}
        </select>
        <div class="sc-panel-lineage-picker-btns">
          <button onclick="scCancelLinkMetric('${e(fid)}')" style="border:1px solid var(--divider);background:none;color:var(--t2);">Cancel</button>
          <button id="sc-lineage-confirm" onclick="scConfirmLinkMetric('${e(fid)}')" disabled style="border:none;background:var(--purple);color:#fff;font-weight:600;">Confirm</button>
        </div>
      </div>
    </div>`;
    // Cap and Feature rows still show
    const capLabel=isDiag?'Diagnostic finding':isMI?'Market signal':_capDefaultLbl;
    const capColor=isDiag?'#0F6E56':isMI?'#185FA5':'#534AB7';
    const capTextColor=isDiag?'#085041':isMI?'#0C447C':'#3C3489';
    rows+=`<div class="sc-panel-lineage-row">
      <span class="sc-panel-lineage-key" style="color:${capColor};">${e(capLabel)}</span>
      ${dot(capColor,false,false)}
      <span class="sc-panel-lineage-val" style="color:${capTextColor};">${e(feat.cap)}</span>
    </div>`;
    const featColor=isPI&&!hasMetric?'#854F0B':'#534AB7';
    const featTextColor=isPI&&!hasMetric?'#633806':'#3C3489';
    rows+=`<div class="sc-panel-lineage-row" style="border-bottom:none;">
      <span class="sc-panel-lineage-key" style="color:${featColor};">Feature</span>
      ${dot(featColor,true,false)}
      <span class="sc-panel-lineage-val" style="color:${featTextColor};">${e(feat.name)}</span>
    </div>`;
    el.innerHTML=`<div class="sc-panel-lineage-hdr" onclick="scToggleLineage('${e(fid)}')">
      <i class="ti ti-git-branch" style="font-size:11px;color:#534AB7;flex-shrink:0;" aria-hidden="true"></i>
      <span class="sc-panel-lineage-label">Traceability</span>
      <i class="ti ti-chevron-up" style="font-size:11px;color:var(--t3);flex-shrink:0;margin-left:auto;" aria-hidden="true"></i>
    </div>
    <div class="sc-panel-lineage-body">${rows}</div>`;
    return;
  } else {
    // Has metric
    const hierIcon=feat.metricPath&&feat.metricPath.includes(' › ')
      ?`<i class="ti ti-hierarchy-2 sc-panel-lineage-icon" title="${e(feat.metricPath)}" aria-label="${_isCap?'Parent capability path':'Parent metric path'}: ${e(feat.metricPath)}"></i>`:'';
    rows+=`<div class="sc-panel-lineage-row">
      <span class="sc-panel-lineage-key" style="color:#185FA5;">${_metricLbl}</span>
      ${dot('#185FA5',false,false)}
      <span class="sc-panel-lineage-val" style="color:#0C447C;">${e(feat.metric)}${hierIcon}</span>
    </div>`;
  }

  // Capability row
  const capLabel=isDiag?'Diagnostic finding':isMI?'Market signal':_capDefaultLbl;
  const capColor=isDiag?'#0F6E56':isMI?'#185FA5':'#534AB7';
  const capTextColor=isDiag?'#085041':isMI?'#0C447C':'#3C3489';
  rows+=`<div class="sc-panel-lineage-row">
    <span class="sc-panel-lineage-key" style="color:${capColor};">${e(capLabel)}</span>
    ${dot(capColor,false,false)}
    <span class="sc-panel-lineage-val" style="color:${capTextColor};">${e(feat.cap)}</span>
  </div>`;

  // Feature row
  const featColor=isPI&&!hasMetric?'#854F0B':'#534AB7';
  const featTextColor=isPI&&!hasMetric?'#633806':'#3C3489';
  rows+=`<div class="sc-panel-lineage-row" style="border-bottom:none;">
    <span class="sc-panel-lineage-key" style="color:${featColor};">Feature</span>
    ${dot(featColor,true,false)}
    <span class="sc-panel-lineage-val" style="color:${featTextColor};">${e(feat.name)}</span>
  </div>`;

  el.innerHTML=`<div class="sc-panel-lineage-hdr" onclick="scToggleLineage('${e(fid)}')">
    <i class="ti ti-git-branch" style="font-size:11px;color:#534AB7;flex-shrink:0;" aria-hidden="true"></i>
    <span class="sc-panel-lineage-label">Traceability</span>
    <i class="ti ti-chevron-up" style="font-size:11px;color:var(--t3);flex-shrink:0;margin-left:auto;" aria-hidden="true"></i>
  </div>
  <div class="sc-panel-lineage-body">${rows}</div>`;
}

function scToggleLineage(fid){
  scPanelLineageOpen=!scPanelLineageOpen;
  scPanelLinkingMetric=false;
  const feat=scCanvas.find(x=>x.id===fid);
  if(feat)scRenderLineage(feat);
}

function scShowLinkMetricModal(fid){
  // G3 — no KPI tree guard
  if(typeof gData==='undefined'||!gData||!gData.stages||!gData.stages.length){
    const _isCap=typeof gData!=='undefined'&&gData&&gData.approach==='capability-based';
    showToast(_isCap?'Generate your Discovery Map first to link a capability.':'Generate your KPI tree first to link a metric.','warn');
    return;
  }
  scPanelLinkingMetric=true;
  scPanelLineageOpen=true;
  const feat=scCanvas.find(x=>x.id===fid);
  if(feat)scRenderLineage(feat);
}

function scCancelLinkMetric(fid){
  scPanelLinkingMetric=false;
  const feat=scCanvas.find(x=>x.id===fid);
  if(feat)scRenderLineage(feat);
}

function scConfirmLinkMetric(fid){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat)return;
  const sel=document.getElementById('sc-lineage-metric-sel');
  if(!sel||!sel.value)return;
  const selectedMetric=sel.value;

  // Resolve stage from gData — capture both label and id
  let selectedStageLabel='', selectedStageId='';
  if(typeof gData!=='undefined'&&gData&&gData.stages){
    for(const st of gData.stages){
      if((st.l1_metrics||[]).find(m=>m.name===selectedMetric)){
        selectedStageLabel=st.label;
        selectedStageId=st.id;
        break;
      }
    }
  }
  if(!selectedStageLabel){
    showToast('Could not resolve stage for this metric — please try again.','warn');
    return;
  }

  // G4 — duplicate id guard
  const newId=scMakeFeatureId(selectedMetric,feat.cap,feat.name);
  if(scCanvas.find(x=>x.id===newId&&x!==feat)){
    showToast('A feature with this name already exists under that metric.','warn');
    return;
  }

  const oldId=feat.id;

  // Write metric, stage, metricPath, id
  feat.metric=selectedMetric;
  feat.stage=selectedStageLabel;
  feat.metricPath=(typeof scGetMetricPath==='function'?scGetMetricPath(selectedMetric):selectedMetric)||selectedMetric;
  feat.id=newId;
  // Migrate prototype to new feature ID
  if(typeof pcMigrateProtoFeatureId==='function')pcMigrateProtoFeatureId(oldId,newId);

  // G1 — reset panel id before re-open
  scPanelFeatureId=null;

  // Update scSelectedIds
  if(scSelectedIds.has(oldId)){scSelectedIds.delete(oldId);scSelectedIds.add(newId);}

  // Update scPiSelectedIds
  if(scPiSelectedIds.has(oldId)){scPiSelectedIds.delete(oldId);scPiSelectedIds.add(newId);}

  // G2 — update piPlan.submittedFeatureIds if present
  if(typeof piPlan!=='undefined'&&piPlan&&piPlan.submittedFeatureIds){
    const idx=piPlan.submittedFeatureIds.indexOf(oldId);
    if(idx>-1)piPlan.submittedFeatureIds[idx]=newId;
  }

  // G3 — propagate metric/stage to unlinked sibling features under same cap
  // Only PI-origin features with no metric yet — don't overwrite intentional links
  const metricPath=(typeof scGetMetricPath==='function'?scGetMetricPath(selectedMetric):selectedMetric)||selectedMetric;
  scCanvas.forEach(sib=>{
    if(sib===feat)return;
    if(sib.cap!==feat.cap)return;
    if(sib.origin!=='pi')return;
    if(sib.metric&&sib.metric.trim()&&sib.metric!==sib.cap)return; // already genuinely linked — don't overwrite
    const sibOldId=sib.id;
    sib.metric=selectedMetric;
    sib.stage=selectedStageLabel;
    sib.metricPath=metricPath;
    sib.id=scMakeFeatureId(selectedMetric,sib.cap+(sib.subCap?'/'+sib.subCap:''),sib.name);
    if(typeof pcMigrateProtoFeatureId==='function')pcMigrateProtoFeatureId(sibOldId,sib.id);
    if(scSelectedIds.has(sibOldId)){scSelectedIds.delete(sibOldId);scSelectedIds.add(sib.id);}
    if(scPiSelectedIds.has(sibOldId)){scPiSelectedIds.delete(sibOldId);scPiSelectedIds.add(sib.id);}
    if(typeof piPlan!=='undefined'&&piPlan&&piPlan.submittedFeatureIds){
      const si=piPlan.submittedFeatureIds.indexOf(sibOldId);
      if(si>-1)piPlan.submittedFeatureIds[si]=sib.id;
    }
  });

  // G4 — sync metric/stage back to capStore to prevent phantom duplicates on re-send
  if(typeof capStore!=='undefined'){
    Object.values(capStore).forEach(entry=>{
      (entry.capabilities||[]).forEach(cap=>{
        if(cap.name!==feat.cap)return;
        const featKey='top';
        const capFeats=cap.featStore&&cap.featStore[featKey];
        if(!capFeats)return;
        capFeats.forEach(cf=>{
          if(!cf.metric||!cf.metric.trim()||cf.metric===cap.name){
            cf.metric=selectedMetric;
            cf.stage=selectedStageLabel;
          }
        });
      });
    });
  }

  // G5 — migrate capStore entry from pi|| key to KPI metric key
  // So CC left nav reflects the linked metric group instead of Custom Capabilities
  if(selectedStageId&&typeof capStore!=='undefined'){
    const piKey=Object.keys(capStore).find(k=>
      k.startsWith('pi||')&&
      (capStore[k].capabilities||[]).some(c=>c.name===feat.cap)
    );
    if(piKey){
      const kpiKey=selectedStageId+'||'+selectedMetric;
      const piEntry=capStore[piKey];
      const capObj=piEntry.capabilities.find(c=>c.name===feat.cap);
      if(capObj){
        capObj._piFirst=false;
        if(!capStore[kpiKey]){
          capStore[kpiKey]={
            metricName:selectedMetric,
            stageLabel:selectedStageLabel,
            stageId:selectedStageId,
            capabilities:[]
          };
        }
        capStore[kpiKey].capabilities.push(capObj);
        piEntry.capabilities=piEntry.capabilities.filter(c=>c.name!==feat.cap);
        if(piEntry.capabilities.length===0)delete capStore[piKey];
      }
    }
  }

  scPanelLinkingMetric=false;
  scPanelLineageOpen=true;

  fcRenderCanvas();
  if(typeof fcRenderCapNav==='function')fcRenderCapNav();
  if(typeof curTab!=='undefined'&&curTab==='sc'){
    // SC context: update panel feat id and re-render SC panel
    if(typeof newScPanelFeatId!=='undefined')newScPanelFeatId=feat.id;
    if(typeof newScRenderMain==='function')newScRenderMain();
    const _scSt=feat.stories&&typeof newScPanelStoryId!=='undefined'?feat.stories.find(s=>s.id===newScPanelStoryId):null;
    if(_scSt&&typeof newScRenderPanelContent==='function')newScRenderPanelContent(_scSt,feat);
  } else {
    scOpenPanel(feat.id);
  }
  showToast('Metric linked — traceability chain complete.','success');
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
}


// User-facing close (X button) — guarded against in-flight generation.
// Programmatic callers (feature delete/remove/purge) call scClosePanel() directly,
// since those aren't "leave mid-generation" scenarios.
function scClosePanelUserAction(){
  if(guardAiGenNav(()=>scClosePanel()))return;
  scClosePanel();
}

function scClosePanel(){
  scPanelFeatureId=null;
  document.getElementById('sc-main').classList.remove('panel-open');
  document.getElementById('sc-panel').classList.remove('open');
  fcRenderCanvas();
}

function scUpdatePanelNav(){
  // Use fcGetVisibleCanvasSorted() — matches visual grid order (stage → metric)
  // so "Feature X of N" counter reflects card position, not insertion order
  const allFeats=fcGetVisibleCanvasSorted();
  const idx=allFeats.findIndex(f=>f.id===scPanelFeatureId);
  const navTotal=allFeats.length;
  const displayIdx=idx>=0?idx+1:1;
  document.getElementById('sc-panel-nav-info').textContent='Feature '+displayIdx+' of '+navTotal;
  document.getElementById('sc-panel-prev').disabled=idx<=0;
  document.getElementById('sc-panel-next').disabled=idx>=allFeats.length-1;
}

function scPanelNav(dir){
  // Use fcGetVisibleCanvasSorted() — navigate in visual grid order
  const allFeats=fcGetVisibleCanvasSorted();
  const idx=allFeats.findIndex(f=>f.id===scPanelFeatureId);
  const next=allFeats[idx+dir];
  if(next)scOpenPanel(next.id);
}

// ── Returns visible canvas sorted to match the visual grid order ──
// fcGetVisibleCanvas() returns features in scCanvas insertion order (generation time).
// The grid renders features sorted by stage index → metric index from gData.
// This function applies the same sort so nav counter and arrows match the visual grid.
function fcGetVisibleCanvasSorted(){
  const visible=fcGetVisibleCanvas();
  // Guard: if no KPI tree exists yet, insertion order is the only order we have
  if(!gData||!gData.stages||!gData.stages.length)return visible;
  const stageOrder=gData.stages.map(function(s){return s.label;});
  const metricOrder=scGetMetricOrder();
  return visible.slice().sort(function(a,b){
    const ai=stageOrder.indexOf(a.stage);
    const bi=stageOrder.indexOf(b.stage);
    if(ai!==bi){
      if(ai===-1)return 1;   // unknown stage → end
      if(bi===-1)return -1;
      return ai-bi;
    }
    // Same stage — sort by metric position in KPI tree
    const ami=metricOrder.indexOf(a.metric);
    const bmi=metricOrder.indexOf(b.metric);
    if(ami!==bmi){
      if(ami===-1)return 1;  // unknown metric → end of stage
      if(bmi===-1)return -1;
      return ami-bmi;
    }
    // Same stage + metric — preserve insertion order (stable sort tiebreak)
    return 0;
  });
}

function scRenderPanel(feat){
  const loading=document.getElementById('sc-panel-loading');
  const content=document.getElementById('sc-panel-content');
  loading.classList.remove('on');
  content.classList.remove('is-hidden');
  // Show/hide refine bar based on story existence
  const refineBar=document.getElementById('sc-refine-bar');
  if(refineBar)refineBar.style.display=(!feat.stories||feat.stories.length===0)?'none':'';
  // Always update panel footer CTA state regardless of story existence
  const _panelBtn=document.getElementById('fc-panel-sc-btn');
  if(_panelBtn){
    const hasStories=!!(feat.stories&&feat.stories.length>0);
    const allInSC=hasStories&&feat.stories.every(s=>s._inSC);
    const _stagedN=hasStories?feat.stories.filter(s=>s._stagedForPI).length:0;
    const _unsentN=hasStories?feat.stories.filter(s=>!s._inSC&&!s._inPIPlan).length:0;
    // Disable when no stories, or all already sent to SC
    _panelBtn.disabled=!hasStories||allInSC;
    if(hasStories&&!allInSC){
      const _panelN=_stagedN>0?_stagedN:_unsentN;
      _panelBtn.innerHTML=`<i class="ti ti-list-details" style="font-size:11px;" aria-hidden="true"></i> Send to Story Canvas${_panelN>0?' ('+_panelN+')':''}`;
    } else if(allInSC){
      _panelBtn.innerHTML=`<i class="ti ti-list-details" style="font-size:11px;" aria-hidden="true"></i> All sent to Story Canvas`;
    } else {
      _panelBtn.innerHTML=`<i class="ti ti-list-details" style="font-size:11px;" aria-hidden="true"></i> Send to Story Canvas`;
    }
  }
  const _splitSt=document.getElementById('sc-panel-split-status');
  if(_splitSt){
    if(feat.stories&&feat.stories.length>0){
      const _inScN=feat.stories.filter(s=>s._inSC).length;
      const _stagedN2=feat.stories.filter(s=>s._stagedForPI).length;
      if(_inScN===feat.stories.length){_splitSt.textContent='All '+_inScN+' in Story Canvas';}
      else if(_inScN>0){_splitSt.textContent=_inScN+' of '+feat.stories.length+' in Story Canvas';}
      else if(_stagedN2>0){_splitSt.textContent=_stagedN2+' of '+feat.stories.length+' selected';}
      else{_splitSt.textContent=feat.stories.length+' stor'+(feat.stories.length===1?'y':'ies');}
    } else {
      _splitSt.textContent='0 stories';
    }
  }
  if(!feat.stories||feat.stories.length===0){
    // Show empty state as direct child of sc-panel-scroll (sibling of sc-panel-loading)
    // This is the only reliable way to vertically centre content inside overflow-y:auto flex container
    const emptyEl=document.getElementById('sc-panel-empty');
    if(emptyEl){
      emptyEl.innerHTML=`<i class="ti ti-writing" style="font-size:28px;color:var(--label);margin-bottom:10px;" aria-hidden="true"></i>
        <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:4px;">No stories yet</div>
        <div style="font-size:11px;color:var(--t3);max-width:180px;line-height:1.4;margin-bottom:14px;text-align:center;">AI will generate user stories for this feature.</div>
        <button class="gen-btn" style="font-size:11px;padding:8px 14px;width:auto;" onclick="scPanelGenerateStories('${e(feat.id)}')"><i class="ti ti-sparkles" style="font-size:11px;" aria-hidden="true"></i> Generate Stories</button>`;
      emptyEl.classList.add('on');
    }
    content.classList.add('is-hidden');
    content.innerHTML='';
    return;
  }
  // Has stories — hide empty state, show content
  const _emptyEl=document.getElementById('sc-panel-empty');
  if(_emptyEl){_emptyEl.classList.remove('on');_emptyEl.innerHTML='';}
  content.classList.remove('is-hidden');
  const piSelCount=(feat.stories||[]).filter(st=>st._stagedForPI).length;
  let h='';
  h+=`<div class="sc-panel-pi-hdr">`;
  h+=`<span class="sc-panel-pi-lbl"><i class="ti ti-list-details" style="font-size:10px;margin-right:3px;" aria-hidden="true"></i>SC selection &middot; <strong>${piSelCount} of ${feat.stories.length}</strong> selected</span>`;
  h+=`<div style="display:flex;gap:5px;">`;
  h+=`<button class="sc-panel-pi-sel-btn" onclick="scSelectAllPiStories('${e(feat.id)}')">All</button>`;
  h+=`<button class="sc-panel-pi-sel-btn" onclick="scClearAllPiStories('${e(feat.id)}')">None</button>`;
  h+=`</div>`;
  h+=`</div>`;
  feat.stories.forEach((st,si)=>{
    const isPiChecked=!!st._stagedForPI;
    const isInSC=!!st._inSC;
    const itemCls='sc-story-item sc-story-item-pi-mode'+(isInSC?' sc-story-item-insc':'');
    const _clickHandler=isInSC?`scTogglePiStoryInSC('${e(feat.id)}',${si})`:`scTogglePiStory('${e(feat.id)}',${si})`;
    h+=`<div class="${itemCls}" onclick="${_clickHandler}">`;
    h+=`<div class="sc-story-pi-check${isInSC?' checked insc':isPiChecked?' checked':''}" onclick="event.stopPropagation();${_clickHandler}">`;
    if(isPiChecked||isInSC)h+=`<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    h+=`</div>`;
    h+=`<div style="flex:1;min-width:0;">`;
    h+=`<div class="sc-story-meta">`;
    h+=`<span class="sc-story-id">${e(st.id)}</span>`;
    h+=`<span class="sc-story-pts">${st.points?st.points+' pts':'—'}</span>`;
    if(st.priority)h+=`<span class="sc-story-pri">${e(st.priority)}</span>`;
    if(isInSC)h+=`<span class="sc-feat-insc-tag" style="margin-left:2px;"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> In Story Canvas</span>`;
    h+=`</div>`;
    h+=`<div class="sc-story-title-row">`;
    h+=`<div class="sc-story-title" id="sc-st-title-${si}">${e(st.title)}</div>`;
    h+=`<button class="sc-story-edit-btn" onmousedown="event.preventDefault()" onclick="event.stopPropagation();scEditStoryTitle('${e(feat.id)}',${si})" title="Edit title"><i class="ti ti-pencil" style="font-size:10px;" aria-hidden="true"></i></button>`;
    h+=`</div>`;
    h+=`<div class="sc-story-stmt-row">`;
    h+=`<div class="sc-story-stmt" id="sc-st-stmt-${si}">${e(st.statement)}</div>`;
    h+=`<button class="sc-story-edit-btn" onmousedown="event.preventDefault()" onclick="event.stopPropagation();scEditStoryStmt('${e(feat.id)}',${si})" title="Edit description" style="margin-top:2px;"><i class="ti ti-pencil" style="font-size:10px;" aria-hidden="true"></i></button>`;
    h+=`</div>`;
    if(st.scenarios&&st.scenarios.length>0){
      h+=`<div class="sc-ac-block"><div class="sc-ac-label">Acceptance criteria</div>`;
      st.scenarios.forEach((sc,sci)=>{
        h+=`<div class="sc-ac-scenario" id="sc-st-ac-${si}-${sci}">`;
        h+=`<div style="display:flex;justify-content:space-between;align-items:flex-start;">`;
        h+=`<div style="flex:1;white-space:pre-wrap;"><span class="sc-ac-kw">Scenario:</span> ${e(sc.name)}\n<span class="sc-ac-kw">Given</span> ${e(sc.given)}\n<span class="sc-ac-kw">When</span>  ${e(sc.when)}\n<span class="sc-ac-kw">Then</span>  ${e(sc.then)}${sc.and?`\n<span class="sc-ac-kw">And</span>   ${e(sc.and)}`:''}`;
        h+=`</div>`;
        h+=`<button class="sc-story-edit-btn" onmousedown="event.preventDefault()" onclick="event.stopPropagation();scEditStoryAC('${e(feat.id)}',${si},${sci})" title="Edit acceptance criteria" style="flex-shrink:0;margin-left:4px;margin-top:1px;"><i class="ti ti-pencil" style="font-size:10px;" aria-hidden="true"></i></button>`;
        h+=`</div>`;
        h+=`</div>`;
      });
      h+=`</div>`;
    }
    h+=`</div></div>`;
  });
  content.innerHTML=h;
}

// ── PI Selection (card ↔ panel bidirectional sync) ──
function scTogglePiSelect(fid){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||feat.stories.length===0)return;
  // None/partial → select all; all → deselect all
  const allSelected=feat.stories.every(st=>st._stagedForPI);
  if(allSelected){
    scPiSelectedIds.delete(fid);
    feat.stories.forEach(st=>{st._stagedForPI=false;});
  } else {
    scPiSelectedIds.add(fid);
    feat.stories.forEach(st=>{st._stagedForPI=true;});
  }
  fcRenderCanvas();
  if(scPanelFeatureId===fid)scRenderPanel(feat);
}

function scTogglePiStory(fid,storyIdx){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const st=feat.stories[storyIdx];
  st._stagedForPI=!st._stagedForPI;
  const anySelected=feat.stories.some(s=>s._stagedForPI);
  if(anySelected)scPiSelectedIds.add(fid);
  else scPiSelectedIds.delete(fid);
  fcRenderCanvas();
  if(scPanelFeatureId===fid)scRenderPanel(feat);
}

function scTogglePiStoryInSC(fid,storyIdx){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const warnId='sc-insc-warn-'+fid+'-'+storyIdx;
  // If warning already showing, dismiss it
  const existing=document.getElementById(warnId);
  if(existing){existing.remove();return;}
  // Find the clicked story item by index among all story items in panel
  const allItems=document.querySelectorAll('#sc-panel-content .sc-story-item');
  const targetEl=allItems[storyIdx];
  if(!targetEl)return;
  // Remove any other open warnings first
  document.querySelectorAll('.sc-insc-warn-strip').forEach(el=>el.remove());
  const warn=document.createElement('div');
  warn.id=warnId;
  warn.className='sc-insc-warn-strip';
  warn.innerHTML=`<div style="display:flex;align-items:flex-start;gap:8px;background:#FAEEDA;border:1px solid #C8870A;border-radius:6px;padding:8px 10px;margin:4px 0 2px;">
    <i class="ti ti-alert-triangle" style="font-size:13px;color:#C8870A;margin-top:1px;flex-shrink:0;" aria-hidden="true"></i>
    <div style="flex:1;min-width:0;">
      <div style="font-size:11px;color:#633806;line-height:1.5;margin-bottom:6px;">This story is in Story Canvas. Removing it here will also remove it from Story Canvas.</div>
      <div style="display:flex;gap:6px;">
        <button onclick="scConfirmRemoveInSCStory('${e(fid)}',${storyIdx})" style="font-size:10px;font-weight:700;padding:3px 10px;background:#C8870A;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:var(--font);">Yes, remove</button>
        <button onclick="document.getElementById('${warnId}').remove()" style="font-size:10px;font-weight:500;padding:3px 10px;background:none;color:#633806;border:1px solid #C8870A;border-radius:4px;cursor:pointer;font-family:var(--font);">Cancel</button>
      </div>
    </div>
  </div>`;
  targetEl.insertAdjacentElement('afterend',warn);
}

function scConfirmRemoveInSCStory(fid,storyIdx){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const st=feat.stories[storyIdx];
  st._inSC=false;
  st._stagedForPI=false;
  st._hiddenFromSC=true;
  if(typeof pcMarkStale==='function')pcMarkStale(fid);
  // Rebuild scPiSelectedIds
  const anySelected=feat.stories.some(s=>s._stagedForPI);
  if(anySelected)scPiSelectedIds.add(fid);
  else scPiSelectedIds.delete(fid);
  // Re-render FC canvas and SC
  fcRenderCanvas();
  if(typeof newScRender==='function')newScRender();
  if(typeof newScUpdateTabBadge==='function')newScUpdateTabBadge();
  // Re-render panel
  if(scPanelFeatureId===fid)scRenderPanel(feat);
  showToast('Story removed from Story Canvas.','info');
}

function scSelectAllPiStories(fid){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories)return;
  feat.stories.forEach(st=>{st._stagedForPI=true;});
  scPiSelectedIds.add(fid);
  fcRenderCanvas();
  if(scPanelFeatureId===fid)scRenderPanel(feat);
}

function scClearAllPiStories(fid){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories)return;
  feat.stories.forEach(st=>{st._stagedForPI=false;});
  scPiSelectedIds.delete(fid);
  fcRenderCanvas();
  if(scPanelFeatureId===fid)scRenderPanel(feat);
}

// ── Inline story title edit ──
function scEditStoryTitle(fid,storyIdx){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const titleEl=document.getElementById('sc-st-title-'+storyIdx);
  if(!titleEl)return;
  const current=feat.stories[storyIdx].title;
  titleEl.outerHTML=`<input class="sc-story-title-input" id="sc-st-inp-${storyIdx}"
    value="${e(current)}"
    onblur="scSaveStoryTitle('${e(fid)}',${storyIdx},this.value)"
    onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.value='${e(current)}';this.blur();}"
    style="width:100%;" />`;
  const inp=document.getElementById('sc-st-inp-'+storyIdx);
  if(inp){inp.focus();inp.select();inp.addEventListener('mousedown',function(e){e.stopPropagation();});}
}

function scSaveStoryTitle(fid,storyIdx,newVal){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const trimmed=newVal.trim();
  if(!trimmed||trimmed===feat.stories[storyIdx].title)return;
  feat.stories[storyIdx].title=trimmed;
  if(typeof pcMarkStale==='function')pcMarkStale(fid);
  scRenderPanel(feat);
}

function scEditStoryStmt(fid,storyIdx){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const el=document.getElementById('sc-st-stmt-'+storyIdx);
  if(!el)return;
  const current=feat.stories[storyIdx].statement;
  el.outerHTML=`<textarea class="sc-story-title-input" id="sc-st-stmt-inp-${storyIdx}"
    onblur="scSaveStoryStmt('${e(fid)}',${storyIdx},this.value)"
    onkeydown="if(event.key==='Escape'){this.value='${e(current)}';this.blur();}"
    style="width:100%;height:56px;resize:none;font-family:var(--font);font-size:11px;">${e(current)}</textarea>`;
  const inp=document.getElementById('sc-st-stmt-inp-'+storyIdx);
  if(inp){inp.focus();inp.select();inp.addEventListener('mousedown',function(e){e.stopPropagation();});}
}

function scSaveStoryStmt(fid,storyIdx,newVal){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const trimmed=newVal.trim();
  if(!trimmed||trimmed===feat.stories[storyIdx].statement)return;
  feat.stories[storyIdx].statement=trimmed;
  if(typeof pcMarkStale==='function')pcMarkStale(fid);
  scRenderPanel(feat);
}

function scACToText(sc){
  let t='Scenario: '+sc.name+'\nGiven '+sc.given+'\nWhen '+sc.when+'\nThen '+sc.then;
  if(sc.and)t+='\nAnd '+sc.and;
  return t;
}

function scTextToAC(text,fallback){
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  const get=kw=>{
    const line=lines.find(l=>l.toLowerCase().startsWith(kw.toLowerCase()));
    if(!line)return null;
    return line.substring(kw.length).trim();
  };
  const name=get('Scenario:')||get('scenario:')||fallback.name;
  const given=get('Given ')||get('given ')||fallback.given;
  const when=get('When ')||get('when ')||fallback.when;
  const then=get('Then ')||get('then ')||fallback.then;
  const and=get('And ')||get('and ')||undefined;
  return{name,given,when,then,...(and!==undefined?{and}:{})};
}

function scEditStoryAC(fid,storyIdx,scenarioIdx){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const sc=feat.stories[storyIdx].scenarios&&feat.stories[storyIdx].scenarios[scenarioIdx];
  if(!sc)return;
  const el=document.getElementById('sc-st-ac-'+storyIdx+'-'+scenarioIdx);
  if(!el)return;
  const currentText=scACToText(sc);
  const rows=currentText.split('\n').length+1;
  el.innerHTML=`<div style="display:flex;flex-direction:column;gap:4px;">
    <textarea id="sc-ac-txt-${storyIdx}-${scenarioIdx}"
      style="width:100%;border:1px solid var(--purple);border-radius:4px;padding:6px 8px;font-size:11px;font-family:var(--font);color:var(--t1);resize:vertical;line-height:1.5;"
      rows="${rows}"
      onblur="scSaveStoryAC('${e(fid)}',${storyIdx},${scenarioIdx})"
      onkeydown="if(event.key==='Escape'){event.preventDefault();scRenderPanel(scCanvas.find(x=>x.id==='${e(fid)}'));}">${e(currentText)}</textarea>
    <div style="font-size:9px;color:var(--label);line-height:1.4;">Edit freely. Start lines with <strong>Scenario:</strong> <strong>Given</strong> <strong>When</strong> <strong>Then</strong> <strong>And</strong> to preserve structure.</div>
  </div>`;
  const ta=document.getElementById('sc-ac-txt-'+storyIdx+'-'+scenarioIdx);
  if(ta){ta.focus();}
}

function scSaveStoryAC(fid,storyIdx,scenarioIdx){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat||!feat.stories||!feat.stories[storyIdx])return;
  const scenarios=feat.stories[storyIdx].scenarios;
  if(!scenarios||!scenarios[scenarioIdx])return;
  const ta=document.getElementById('sc-ac-txt-'+storyIdx+'-'+scenarioIdx);
  if(!ta)return;
  const parsed=scTextToAC(ta.value,scenarios[scenarioIdx]);
  scenarios[scenarioIdx]=parsed;
  if(typeof pcMarkStale==='function')pcMarkStale(fid);
  scRenderPanel(feat);
}


function scPanelGenerateStories(fid){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat){showToast('Feature not found.','warn');return;}
  scSelectedIds=new Set([fid]);
  scGenerateStories([fid]);
}

function scPanelGenerateStories(fid){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat){showToast('Feature not found.','warn');return;}
  scSelectedIds=new Set([fid]);
  scGenerateStories([fid]);
}

// ── FC: Send feature stories to Story Canvas ──
function fcPanelSendToSC(){
  if(!scPanelFeatureId)return;
  const feat=scCanvas.find(x=>x.id===scPanelFeatureId);
  if(!feat||!feat.stories||feat.stories.length===0){showToast('Generate stories first.','info');return;}
  // Mark _inSC: use panel selection if any staged, else mark all
  const hasStagedSel=feat.stories.some(s=>s._stagedForPI);
  let sentCount=0;
  feat.stories.forEach(s=>{
    if(!s._inSC&&!s._inPIPlan&&(hasStagedSel?s._stagedForPI:true)){
      s._inSC=true;
      s._stagedForPI=false;
      sentCount++;
    }
  });
  // Rebuild scPiSelectedIds
  if(typeof scPiSelectedIds!=='undefined'){
    scPiSelectedIds=new Set();
    scCanvas.forEach(f=>{if(f.stories&&f.stories.some(s=>s._stagedForPI))scPiSelectedIds.add(f.id);});
  }
  // Reveal SC tab silently (don't navigate away)
  const scTabBtn=document.getElementById('tab-sc');
  if(scTabBtn)scTabBtn.classList.add('revealed');
  // Signal new content in Story Canvas (cleared on first visit)
  if(sentCount>0&&typeof markTabPending==='function')markTabPending('sc');
  // Inline confirm — CC pattern: button turns green for 2 seconds
  const sendBtn=document.getElementById('fc-panel-sc-btn');
  if(sendBtn&&sentCount>0){
    const origHtml=sendBtn.innerHTML;
    sendBtn.innerHTML=`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${sentCount} sent`;
    sendBtn.style.cssText='background:var(--green);color:#fff;border:none;';
    sendBtn.disabled=true;
    setTimeout(()=>{
      sendBtn.innerHTML=origHtml;
      sendBtn.style.cssText='';
      sendBtn.disabled=false;
      scRenderPanel(feat);
      fcRenderCanvas();
    },2000);
  } else {
    scRenderPanel(feat);
    fcRenderCanvas();
  }
  if(sentCount>0)showToast(`${sentCount} stor${sentCount!==1?'ies':'y'} sent to Story Canvas.`,'success');
  if(sentCount>0&&typeof pcMarkStale==='function')pcMarkStale(scPanelFeatureId);
  if(sentCount>0&&!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
}

function scRefineStories(){
  if(!scPanelFeatureId)return;
  const feat=scCanvas.find(f=>f.id===scPanelFeatureId);
  if(!feat)return;
  const refinement=document.getElementById('sc-refine-txt').value.trim();
  // Mark this feature as pending re-generation
  scSelectedIds=new Set([scPanelFeatureId]);
  // Store refinement for injection into prompt
  feat._refinement=refinement;
  if(typeof pcMarkStale==='function')pcMarkStale(scPanelFeatureId);
  scGenerateStories([scPanelFeatureId]);
  // Clear the textarea after submission
  document.getElementById('sc-refine-txt').value='';
}

// ── Story Generation ──
function scClickGenerate(){
  const sel=Array.from(scSelectedIds);
  if(sel.length===0)return;
  if(sel.length>7){
    scShowBatchModal(sel);
  } else {
    scGenerateStories(sel);
  }
}

function scShowBatchModal(sel){
  const n=sel.length;
  const estStories=n*5;
  const estTokens=n*3000;
  const estTime=n<8?'~'+Math.round(n*10)+'s':'~'+Math.round(n*10/60)+' min';
  const estCost='~$'+((estTokens/1000000)*3).toFixed(2);
  document.getElementById('sc-modal-title').textContent=n+' features selected — recommend batching';
  document.getElementById('sc-modal-sub').textContent='Generating all '+n+' features at once will produce ~'+estStories+' user stories. Consider batching for faster, more focused results.';
  document.getElementById('sc-modal-features').textContent=n;
  document.getElementById('sc-modal-stories').textContent='~'+estStories;
  document.getElementById('sc-modal-time').textContent=estTime;
  document.getElementById('sc-modal-cost').textContent=estCost;
  // Build batch options — 3 options max
  const b1=Math.min(5,n);
  const b2=Math.min(7,n);
  const batches=n<=10?[[b1,'Conservative'],[n,'All at once']]:[[b1,'Conservative'],[b2,'Recommended'],[n,'All at once']];
  let bh='';
  batches.forEach((b,bi)=>{
    const isRec=b[1]==='Recommended';
    const bStories=b[0]*5;
    const bTime='~'+(b[0]*10<60?b[0]*10+'s':Math.round(b[0]*10/60)+'min');
    const bCost='~$'+((b[0]*3000/1000000)*3).toFixed(2);
    bh+=`<div class="sc-modal-batch${isRec?' rec':''}" onclick="scModalSelectBatch(${b[0]},this)">`;
    bh+=`<div class="sc-modal-batch-num">${b[0]}</div>`;
    bh+=`<div class="sc-modal-batch-lbl2">${b[1]}</div>`;
    bh+=`<div class="sc-modal-batch-meta">~${bStories} stories · ${bTime} · ${bCost}</div>`;
    if(isRec)bh+=`<div class="sc-modal-batch-tag">Best balance</div>`;
    bh+=`</div>`;
  });
  document.getElementById('sc-modal-batches').innerHTML=bh;
  // Default to recommended or first
  scModalBatchSize=n<=10?n:b2;
  const recLabel=n<=10?'Generate all '+n:('Generate batch of '+b2);
  document.getElementById('sc-modal-proceed-label').textContent=recLabel;
  document.getElementById('sc-modal-overlay').classList.add('on');
}

function scModalSelectBatch(n,el){
  scModalBatchSize=n;
  document.querySelectorAll('.sc-modal-batch').forEach(b=>b.classList.remove('rec'));
  el.classList.add('rec');
  document.getElementById('sc-modal-proceed-label').textContent='Generate '+(scModalBatchSize===scSelectedIds.size?'all '+scModalBatchSize:'batch of '+scModalBatchSize);
}

function scModalClose(){
  document.getElementById('sc-modal-overlay').classList.remove('on');
}

function scModalProceed(){
  scModalClose();
  const sel=Array.from(scSelectedIds);
  const batch=sel.slice(0,scModalBatchSize);
  scGenerateStories(batch);
}

async function scGenerateStories(featureIds){
  const key=getKey();
  if(aiGenInFlight.active){showToast("Still working on your last request. Hang tight, this won't take long.",'info');return;}
  const features=featureIds.map(id=>scCanvas.find(f=>f.id===id)).filter(Boolean);
  if(!features.length)return;
  // Open panel on first feature being generated
  const firstFeat=features[0];
  scPanelFeatureId=firstFeat.id;
  document.getElementById('sc-panel-feat-name').textContent=firstFeat.name;
  scLineageTargetElId='sc-panel-feat-meta';
  if(typeof scRenderLineage==='function')scRenderLineage(firstFeat);
  document.getElementById('sc-main').classList.add('panel-open');
  document.getElementById('sc-panel').classList.add('open');
  document.getElementById('sc-panel-loading').classList.add('on');
  document.getElementById('sc-panel-content').classList.add('is-hidden');
  document.getElementById('sc-panel-content').innerHTML='';
  const _genEmptyEl=document.getElementById('sc-panel-empty');
  if(_genEmptyEl){_genEmptyEl.classList.remove('on');_genEmptyEl.innerHTML='';}
  // Disable generate button during generation
  document.getElementById('sc-gen-btn').disabled=true;
  const _scCtx=(typeof getFullProductCtx==='function')?getFullProductCtx():{name:(productContext&&productContext.name)||'the product',icp:(productContext&&productContext.icp)||'product manager'};
  _scCtx.docContext=(typeof buildDocContext==='function')?buildDocContext('sc'):'';
  // Collect refinement from any feature in the batch (used when called from scRefineStories)
  const refinement=features.length===1&&features[0]._refinement?features[0]._refinement:'';
  const prompt=scBuildStoryPrompt(_scCtx,features,refinement);
  const _whatCooking=features.length===1
    ?`Stories for "${features[0].name}" are being generated. Leaving now discards them, you'll need to regenerate from scratch.`
    :`Stories for ${features.length} features are being generated. Leaving now discards this batch, you'll need to start again.`;
  try{
    const _signal=startAiGen(_whatCooking);
  // Dynamic token limit: scale with features × stories to prevent truncation at higher settings.
  // Model override: if projected output exceeds ~7k tokens (Haiku's safe ceiling),
  // force Sonnet regardless of batch size — Haiku's 8192 output limit would truncate.
  const _maxStories=(typeof appSettings!=='undefined'?appSettings.maxStories:5)||5;
  const _projectedTok=features.length*_maxStories*900;
  const _dynTok=Math.min(32000,Math.max(12000,_projectedTok+2000));
  const _batchModel=_projectedTok>7000?null:(typeof resolveThresholdModel==='function')?resolveThresholdModel(features.length):null;
  const txt=await callAPI(
    'You are a senior product manager and scrum master. Write grooming-ready user stories with Gherkin acceptance criteria. Respond ONLY with valid JSON. No markdown, no backticks, no preamble. Never use em dashes (—) in your output; use a hyphen (-) or rewrite the phrase.',
    prompt,
    _dynTok,
    _signal,
    _batchModel,
    'fc-gen-stories'
  );
    const clean=txt.replace(/```json|```/g,'').trim();
    let parsed;
    try{parsed=JSON.parse(clean);}catch(pe){
      // Attempt repair
      const last=clean.lastIndexOf(']');
      if(last>0){try{parsed=JSON.parse(clean.substring(0,last+1));}catch(pe2){throw new Error('Stories could not be parsed. Please try again.');}}
      else throw new Error('Stories could not be parsed. Please try again.');
    }
    if(!parsed||!Array.isArray(parsed))throw new Error('Invalid story format returned.');
    // Map stories back to features
    parsed.forEach(featBlock=>{
      const feat=scCanvas.find(f=>f.name===featBlock.feature);
      if(feat){
        const isRefine=!!(feat._refinement);
        const newStories=(featBlock.stories||[]).map((st)=>{
          scStoryIdCounter++;
          return{
            id:'ST-'+String(scStoryIdCounter).padStart(3,'0'),
            title:st.title,
            statement:st.statement,
            points:st.points||3,
            priority:st.priority||'Should Have',
            dor:'NOT READY',
            dorReason:'',
            scenarios:st.scenarios||[],
            _inSC:false,
            _hiddenFromSC:false
          };
        });
        if(isRefine&&feat.stories&&feat.stories.length>0){
          // Merge: keep existing stories, append new ones (avoiding duplicates by title)
          const existingTitles=new Set(feat.stories.map(s=>s.title.toLowerCase()));
          const toAdd=newStories.filter(s=>!existingTitles.has(s.title.toLowerCase()));
          // Item 21: carry PI selection to new stories
          if(scPiSelectedIds.has(feat.id)){toAdd.forEach(st=>{st._stagedForPI=true;});}
          feat.stories=[...feat.stories,...toAdd];
        } else {
          // Item 21: carry PI selection to replacement stories (Option B — keep selection)
          const wasPiSelected=scPiSelectedIds.has(feat.id);
          feat.stories=newStories;
          if(wasPiSelected){
            feat.stories.forEach(st=>{st._stagedForPI=true;});
            // Stories regenerated while PI-selected — user should review panel
            showToast('Stories regenerated — review PI selection in the panel.','info');
          }
        }
        // Clear the refinement flag after use
        delete feat._refinement;
      }
    });
    // Clear selection for generated features
    featureIds.forEach(id=>scSelectedIds.delete(id));
    // Mark prototypes stale for all regenerated features
    if(typeof pcMarkStale==='function')featureIds.forEach(id=>pcMarkStale(id));
    fcRenderCanvas();
    if(typeof newScUpdateTabBadge==='function')newScUpdateTabBadge();
    scRenderPanel(scCanvas.find(f=>f.id===scPanelFeatureId)||features[0]);
    scUpdatePanelNav();
    const feat=scCanvas.find(f=>f.id===scPanelFeatureId)||features[0];
    const _panelScBtn=document.getElementById('fc-panel-sc-btn');
    if(_panelScBtn)_panelScBtn.disabled=!(feat.stories&&feat.stories.length>0);
    if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
  }catch(err){
    if(err.name==='AbortError'){endAiGen();return;}
    const _errEmptyEl=document.getElementById('sc-panel-empty');
    if(_errEmptyEl){_errEmptyEl.classList.remove('on');_errEmptyEl.innerHTML='';}
    document.getElementById('sc-panel-content').classList.remove('is-hidden');
    document.getElementById('sc-panel-content').innerHTML='<div style="padding:16px;text-align:center;"><div style="color:var(--orange);font-size:13px;font-weight:600;margin-bottom:8px;">&#9888; Generation failed</div><div style="font-size:11px;color:var(--t3);">'+e(err.message)+'</div></div>';
  }finally{
    document.getElementById('sc-panel-loading').classList.remove('on');
    document.getElementById('sc-gen-btn').disabled=scSelectedIds.size===0;
    endAiGen();
  }
}

function scBuildStoryPrompt(ctx,features,refinement){
  const product=(ctx&&ctx.name)?ctx.name:'the product';
  const icp=(ctx&&ctx.icp)?ctx.icp:'product manager';
  const featList=features.map(f=>`- Feature: "${f.name}" (Capability: ${f.cap}, Metric: ${f.metric}, Stage: ${f.stage})\n  Why: ${f.why}`).join('\n');
  const _scDocText=(ctx&&ctx.docContext)?ctx.docContext:'';
  const _scHasDoc=String(_scDocText).trim().length>0;
  const _scEnrichment=_scHasDoc?'\n'+_docEnrichmentInstruction()+'\n'+_backlogEnrichmentInstruction():'';
  return `Product: ${product}
Primary user / ICP: ${icp}
${ctx&&ctx.productDesc?'Product description: '+ctx.productDesc:''}
${ctx&&ctx.problem?'Known problem: '+ctx.problem:''}
${ctx&&ctx.additionalContext?'Additional context: '+ctx.additionalContext:''}
${_scDocText}${_scEnrichment}
${refinement?'\nRefinement instruction: '+refinement+'\nApply this refinement to ALL stories generated below.':''}

Features to story-ify:
${featList}

Return a JSON array — one object per feature. Format EXACTLY:
[
  {
    "feature": "exact feature name",
    "stories": [
      {
        "title": "outcome-oriented title — [Persona] can [action] so that [outcome]",
        "statement": "As a [persona], I want to [action], so that [outcome].",
        "points": 3,
        "priority": "Must Have",
        "dor": "READY",
        "dor_reason": "",
        "scenarios": [
          {"name": "scenario name", "given": "precondition", "when": "action", "then": "outcome", "and": "additional outcome or empty string"},
          {"name": "edge case name", "given": "precondition", "when": "action", "then": "outcome", "and": ""}
        ]
      }
    ]
  }
]

Rules:
- Stories per feature: up to ${typeof appSettings!=='undefined'?appSettings.maxStories:5} per feature, varying by complexity — fewer for simple/single-interaction features, more for complex ones with multiple personas or edge cases. Do NOT default to the maximum for every feature — actively vary the count based on complexity
- title must be outcome-oriented, specific to ${product}
- points: Fibonacci 1/2/3/5/8/13 only
- priority: Must Have / Should Have / Could Have
- dor: READY or NOT READY
- dor_reason: only if NOT READY — state reason (e.g. "UX design needed", "API contract undefined")
- scenarios: minimum 2 per story, up to ${typeof appSettings!=='undefined'?appSettings.maxACs:3} — one happy path, one edge/error case always included
- given/when/then/and: concrete, testable language — never vague
- and: empty string if not needed
- Return ONLY the JSON array. No other text.`;
}

// ── Export ──
// ── FC Export — in-flight state ──
var fcExportInFlight=false;
function fcSyncExportBtn(){
  var btn=document.getElementById('sc-export-btn');
  if(!btn)return;
  btn.disabled=!!fcExportInFlight;
  btn.innerHTML=fcExportInFlight?
    '<i class="ti ti-loader-2" style="font-size:11px;animation:spin 1s linear infinite;" aria-hidden="true"></i> Exporting\u2026':
    '<i class="ti ti-download" style="font-size:11px;" aria-hidden="true"></i> Export';
}
async function scExportAll(){
  if(fcExportInFlight)return;
  var snap=(typeof fcGetVisibleCanvasSorted==='function')?fcGetVisibleCanvasSorted():(typeof fcGetVisibleCanvas==='function'?fcGetVisibleCanvas():[]);
  if(!snap.length){showToast('No features visible to export. Check your filter settings.','info');return;}
  var productName=typeof getProductCtx==='function'?getProductCtx().name:'Product';
  fcExportInFlight=true;fcSyncExportBtn();
  try{
    await fcDownloadBriefDOCX(snap,productName);
  }catch(err){
    showToast('Export failed: '+err.message,'error');
    console.error('[FC Export]',err);
  }finally{
    fcExportInFlight=false;fcSyncExportBtn();
  }
}
// Legacy alias — some paths still call scExportFeature
function scExportFeature(){scExportAll();}
function scToggleExportDrop(){}

// ── scPurgeStage — removes all features (and their stories) for a given stage ──
// Called from stage delete and stage edit (Case C) in kpi-tree.js
// Does NOT remove market-origin features — those are independent of KPI tree stages
function scPurgeStage(stageLabel){
  const toRemove=scCanvas.filter(f=>f.stage===stageLabel&&f.origin!=='market');
  if(!toRemove.length)return;
  const removeIds=new Set(toRemove.map(f=>f.id));
  // Delete prototypes for all removed features before filtering canvas
  if(typeof pcDeleteProto==='function')removeIds.forEach(id=>pcDeleteProto(id));
  // Close panel if open feature is being removed
  if(scPanelFeatureId&&removeIds.has(scPanelFeatureId))scClosePanel();
  // Clean selected IDs (both story-gen and PI selection)
  removeIds.forEach(id=>scSelectedIds.delete(id));
  removeIds.forEach(id=>scPiSelectedIds.delete(id));
  // Remove features (stories go with them — no separate store)
  scCanvas=scCanvas.filter(f=>!removeIds.has(f.id));
  scUpdateCapDrawerFooter();
  fcUpdateTabBadge();
  fcRenderCanvas();
  fcRenderCapNav();
  // Notify new Story Canvas
  if(typeof newScRender==='function')newScRender();
}








function scApplyPIPlannedBadges(assignments){
  // assignments: {storyId:{sprint,squad,...}} from piPlan.storyAssignments
  // Map story IDs back to feature IDs and mark features
  if(!assignments)return;
  scCanvas.forEach(f=>{
    if(!f.stories)return;
    const storyInPlan=f.stories.some(st=>assignments[st.id]);
    if(storyInPlan){
      f.piPlanned=true;
      // Find the sprint for this feature's first assigned story
      const firstStory=f.stories.find(st=>assignments[st.id]);
      f.piSprintAssigned=firstStory?assignments[firstStory.id].sprint:null;
    } else {
      f.piPlanned=false;
      f.piSprintAssigned=null;
    }
  });
  fcRenderCanvas();
  // Trigger new Story Canvas re-render if available
  if(typeof newScRender==='function')newScRender();
}

function scClearPIPlannedBadges(){
  scCanvas.forEach(f=>{f.piPlanned=false;f.piSprintAssigned=null;});
  fcRenderCanvas();
  if(typeof newScRender==='function')newScRender();
}

// ── Add Feature manually ──
function scShowAddFeatureModal(){
  // Build capability options: union of all cap names from capStore + unique caps already on scCanvas
  const capSet=new Set();
  if(typeof capStore!=='undefined'){
    Object.values(capStore).forEach(entry=>{
      (entry.capabilities||[]).forEach(cap=>{if(cap.name)capSet.add(cap.name);});
    });
  }
  // From scCanvas (covers caps removed from CC but still on SC)
  scCanvas.forEach(f=>{if(f.cap)capSet.add(f.cap);});
  const sortedCaps=[...capSet].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
  // Pre-select the active capability filter if one is set
  const defaultCap=scCapNavFilter||null;
  let capOpts=`<option value="" ${!defaultCap?'selected':''}>— Select a capability —</option>`;
  sortedCaps.forEach(c=>{capOpts+=`<option value="${e(c)}"${defaultCap===c?' selected':''}>${e(c)}</option>`;});
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='sc-add-feat-overlay';
  overlay.innerHTML=`<div class="modal" style="max-width:400px;;position:relative;">
    <button onclick="document.getElementById('sc-add-feat-overlay').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
      <div style="font-size:13px;font-weight:500;color:var(--t1);">Add Feature</div>
    </div>
    <div class="modal-body" style="font-size:11px;color:var(--t3);line-height:1.5;">Manually add a feature to the Story Canvas. It must be tagged to a capability.</div>
    <div style="display:flex;flex-direction:column;gap:10px;padding:0 20px 4px;">
      <div>
        <label style="font-size:10px;font-weight:500;color:var(--t2);display:block;margin-bottom:3px;">Feature Name<span style="color:var(--red);margin-left:1px;">*</span></label>
        <input id="sc-add-feat-name" type="text" placeholder="e.g. One-click re-onboarding"
          style="width:100%;height:30px;border:1px solid var(--divider);border-radius:5px;padding:0 8px;font-size:11px;font-family:var(--font);color:var(--t1);background:var(--bg);"
          oninput="scAddFeatValidate()" />
        <div id="sc-add-feat-name-err" style="display:none;font-size:9px;color:var(--red);margin-top:2px;align-items:center;gap:3px;">
          <i class="ti ti-alert-circle" style="font-size:9px;" aria-hidden="true"></i> A feature with this name already exists on the canvas.
        </div>
      </div>
      <div>
        <label style="font-size:10px;font-weight:500;color:var(--t2);display:block;margin-bottom:3px;">Why It Matters <span style="font-size:9px;color:var(--label);">(Optional)</span></label>
        <textarea id="sc-add-feat-why" placeholder="Describe the problem this feature solves…"
          style="width:100%;height:60px;border:1px solid var(--divider);border-radius:5px;padding:6px 8px;font-size:11px;font-family:var(--font);color:var(--t1);background:var(--bg);resize:none;"></textarea>
      </div>
      <div>
        <label style="font-size:10px;font-weight:500;color:var(--t2);display:block;margin-bottom:3px;">Capability<span style="color:var(--red);margin-left:1px;">*</span></label>
        <div style="position:relative;">
          <select id="sc-add-feat-cap"
            style="width:100%;height:30px;border:1px solid var(--divider);border-radius:5px;padding:0 8px;font-size:11px;font-family:var(--font);color:var(--t1);background:var(--bg);appearance:none;"
            onchange="scAddFeatValidate()">
            ${capOpts}
          </select>
          <i class="ti ti-chevron-down" style="position:absolute;right:8px;top:9px;font-size:10px;color:var(--label);pointer-events:none;" aria-hidden="true"></i>
        </div>
        <div style="font-size:9px;color:var(--label);margin-top:2px;">All features must belong to a capability.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="modal-cancel-btn" onclick="document.getElementById('sc-add-feat-overlay').remove()">Cancel</button>
      <button class="modal-confirm-btn" id="sc-add-feat-submit" disabled onclick="scDoAddFeat()">Add Feature</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const _escHandler=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_escHandler,true);}};
  document.addEventListener('keydown',_escHandler,true);
  trapFocus(overlay);
}

function scAddFeatValidate(){
  const nameEl=document.getElementById('sc-add-feat-name');
  const capEl=document.getElementById('sc-add-feat-cap');
  const errEl=document.getElementById('sc-add-feat-name-err');
  const submitEl=document.getElementById('sc-add-feat-submit');
  if(!nameEl||!capEl||!errEl||!submitEl)return;
  const val=nameEl.value.trim();
  const capVal=capEl.value;
  if(!val){
    nameEl.style.borderColor='var(--divider)';
    errEl.style.display='none';
    submitEl.disabled=true;
    return;
  }
  // Duplicate check — case insensitive across scCanvas
  const lower=val.toLowerCase();
  const isDupe=scCanvas.some(f=>f.name.toLowerCase()===lower);
  if(isDupe){
    nameEl.style.borderColor='var(--red)';
    errEl.style.display='flex';
    submitEl.disabled=true;
    return;
  }
  nameEl.style.borderColor=val?'var(--purple)':'var(--divider)';
  errEl.style.display='none';
  // Both name and capability required
  submitEl.disabled=!(val&&capVal);
}

function scDoAddFeat(){
  const nameEl=document.getElementById('sc-add-feat-name');
  const whyEl=document.getElementById('sc-add-feat-why');
  const capEl=document.getElementById('sc-add-feat-cap');
  if(!nameEl||!capEl)return;
  const name=nameEl.value.trim();
  const why=whyEl?whyEl.value.trim():'';
  const cap=capEl.value;
  if(!name||!cap)return;
  // Resolve metric and stage from capStore
  let metric=cap;
  let stage='PI Plan';
  let metricPath=cap;
  if(typeof capStore!=='undefined'){
    for(const[mk,entry]of Object.entries(capStore)){
      const found=(entry.capabilities||[]).find(c=>c.name===cap);
      if(found){
        metric=entry.metricName||cap;
        stage=entry.stageLabel||'PI Plan';
        metricPath=scGetMetricPath(metric);
        break;
      }
    }
  }
  const fid=scMakeFeatureId(metric,cap,name);
  // Guard against duplicate id
  if(scCanvas.find(x=>x.id===fid)){
    showToast('A feature with this name already exists on the canvas.','warn');
    return;
  }
  scCanvas.push({id:fid,metric,metricPath,stage,cap,name,why,stories:null,origin:'pi'});
  // Close modal
  const overlay=document.getElementById('sc-add-feat-overlay');
  if(overlay)overlay.remove();
  fcUpdateTabBadge();
  fcRenderCanvas();
  // Auto-scroll to new feature card and open its story panel
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      const _card=document.getElementById('sc-card-'+fid);
      if(_card)_card.scrollIntoView({behavior:'smooth',block:'center'});
      scOpenPanel(fid);
    });
  });
  showToast(`"${name}" added under ${cap}.`,'success');
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
}

// ── Upload Features from file (C2-C4, v7.84) ──
// Modal 1: file upload using the Feature/Description/Capability template.
function scShowUploadFeatModal(){
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='sc-upload-feat-overlay';
  overlay.innerHTML=`<div class="modal" style="max-width:420px;position:relative;">
    <button onclick="document.getElementById('sc-upload-feat-overlay').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
      <div style="font-size:13px;font-weight:500;color:var(--t1);">Upload Features</div>
    </div>
    <div class="modal-body" style="font-size:11px;color:var(--t3);line-height:1.5;">Upload a file of features to add. Each row must map to a capability already on the canvas - unmatched rows can be mapped manually or removed before adding.</div>
    <div style="padding:0 20px 4px;">
      <div class="cc-upload-row" id="sc-feat-upload-row" onclick="document.getElementById('sc-feat-upload-input').click()">
        <i class="ti ti-upload" style="font-size:13px;color:var(--purple);flex-shrink:0;" aria-hidden="true"></i>
        <span class="cc-upload-row-label">Click to upload</span>
        <span class="cc-upload-row-types">.xlsx &middot; .csv</span>
        <a href="assets/templates/capability-features-template.xlsx" class="cc-template-link" onclick="event.stopPropagation()" style="margin-left:auto;"><i class="ti ti-download" style="font-size:11px;" aria-hidden="true"></i> Template</a>
      </div>
      <input type="file" id="sc-feat-upload-input" accept=".xlsx,.csv" style="display:none" onchange="scHandleFeatUpload(this)">
      <div id="sc-feat-upload-result"></div>
    </div>
    <div class="modal-footer">
      <button class="modal-cancel-btn" onclick="document.getElementById('sc-upload-feat-overlay').remove()">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const _escHandler=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_escHandler,true);}};
  document.addEventListener('keydown',_escHandler,true);
  trapFocus(overlay);
}

function scHandleFeatUpload(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();
  const resultEl=document.getElementById('sc-feat-upload-result');
  if(resultEl)resultEl.innerHTML='<div class="cc-parse-loading"><div class="cc-spin-sm"></div> Reading file…</div>';
  if(ext==='csv'){
    const reader=new FileReader();
    reader.onload=ev=>_scParseFeatCSV(ev.target.result);
    reader.readAsText(file);
  } else if(ext==='xlsx'){
    const reader=new FileReader();
    reader.onload=ev=>{
      if(typeof XLSX==='undefined'){
        const s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload=()=>_scParseFeatXLSX(ev.target.result);
        s.onerror=()=>_scShowFeatUploadError('Could not load XLSX library. Check internet connection.');
        document.head.appendChild(s);
      } else {
        _scParseFeatXLSX(ev.target.result);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    _scShowFeatUploadError('Unsupported file type. Use .xlsx or .csv.');
  }
  input.value='';
}

function _scParseFeatXLSX(arrayBuffer){
  try{
    const wb=XLSX.read(arrayBuffer,{type:'array'});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const data=XLSX.utils.sheet_to_json(ws,{defval:''});
    if(!data||data.length===0){_scShowFeatUploadError('File appears empty.');return;}
    const firstRow=data[0];
    const keys=Object.keys(firstRow).map(k=>k.toLowerCase().trim());
    const featKey=Object.keys(firstRow)[keys.indexOf('feature')]||Object.keys(firstRow)[keys.indexOf('features')];
    const descKey=Object.keys(firstRow)[keys.indexOf('description')];
    const capKey=Object.keys(firstRow)[keys.indexOf('capability')]||Object.keys(firstRow)[keys.indexOf('capabilities')];
    if(!featKey){_scShowFeatUploadError('Could not find a "Feature" column.');return;}
    const rows=[];
    data.forEach(row=>{
      const name=String(row[featKey]||'').trim();
      if(!name)return;
      rows.push({
        name,
        description:descKey?String(row[descKey]||'').trim():'',
        capRaw:capKey?String(row[capKey]||'').trim():''
      });
    });
    _scFinalizeFeatUpload(rows);
  }catch(err){
    _scShowFeatUploadError('Could not read file: '+err.message);
  }
}

function _scParseFeatCSV(text){
  try{
    const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length>0);
    if(lines.length===0){_scShowFeatUploadError('File appears empty.');return;}
    const header=lines[0].split(',').map(h=>h.trim().toLowerCase());
    const featIdx=header.indexOf('feature')>=0?header.indexOf('feature'):header.indexOf('features');
    const descIdx=header.indexOf('description');
    const capIdx=header.indexOf('capability')>=0?header.indexOf('capability'):header.indexOf('capabilities');
    if(featIdx<0){_scShowFeatUploadError('Could not find a "Feature" column.');return;}
    const rows=[];
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(',').map(c=>c.trim());
      const name=cols[featIdx]||'';
      if(!name)continue;
      rows.push({
        name,
        description:descIdx>=0?(cols[descIdx]||''):'',
        capRaw:capIdx>=0?(cols[capIdx]||''):''
      });
    }
    _scFinalizeFeatUpload(rows);
  }catch(err){
    _scShowFeatUploadError('Could not read file: '+err.message);
  }
}

function _scShowFeatUploadError(msg){
  const resultEl=document.getElementById('sc-feat-upload-result');
  if(resultEl)resultEl.innerHTML=`<div class="cc-parse-error"><i class="ti ti-alert-circle" style="font-size:11px;" aria-hidden="true"></i> ${e(msg)}</div>`;
}

// Modal 2: review/map table — every row must map to an existing capability
// (mapTo: metricKey|cap pair, encoded as "capName") or be removed before confirm.
let _scUploadFeatRows=[];

function _scGetAllCapNames(){
  const capSet=new Set();
  if(typeof capStore!=='undefined'){
    Object.values(capStore).forEach(entry=>{(entry.capabilities||[]).forEach(c=>{if(c.name)capSet.add(c.name);});});
  }
  scCanvas.forEach(f=>{if(f.cap)capSet.add(f.cap);});
  return[...capSet].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
}

function _scFinalizeFeatUpload(rows){
  if(!rows||rows.length===0){_scShowFeatUploadError('No features found. Check the format.');return;}
  const capNames=_scGetAllCapNames();
  _scUploadFeatRows=rows.map(r=>{
    let mapTo=null;
    if(r.capRaw){
      const match=capNames.find(c=>ccFuzzyMatch(c.toLowerCase(),r.capRaw.toLowerCase()));
      if(match)mapTo=match;
    }
    return{name:r.name,description:r.description,mapTo,removed:false};
  });
  const uploadOverlay=document.getElementById('sc-upload-feat-overlay');
  if(uploadOverlay)uploadOverlay.remove();
  scShowFeatReviewModal();
}

function scShowFeatReviewModal(){
  const capNames=_scGetAllCapNames();
  const optsBase=`<option value="">— Select a capability —</option>`+capNames.map(c=>`<option value="${e(c)}">${e(c)}</option>`).join('');

  const rowsHtml=_scUploadFeatRows.map((r,idx)=>{
    if(r.removed)return ''; // removed rows are dropped from the table entirely
    const isUnresolved=!r.mapTo;
    let opts=`<option value=""${!r.mapTo?' selected':''}>— Select a capability —</option>`;
    capNames.forEach(c=>{opts+=`<option value="${e(c)}"${r.mapTo===c?' selected':''}>${e(c)}</option>`;});
    return `<div class="cc-cap-review-row${isUnresolved?' cc-cap-review-row-error':''}">
      <div class="cc-cap-review-name">${e(r.name)}</div>
      <div class="cc-cap-review-desc">${e(r.description||'—')}</div>
      <div class="cc-cap-review-mapsto${isUnresolved?' cc-cap-review-mapsto-error':''}">
        <select onchange="_scUploadFeatRows[${idx}].mapTo=this.value||null;scRefreshFeatReviewSummary()">${opts}</select>
        <a class="cc-cap-review-remove" onclick="_scUploadFeatRows[${idx}].removed=true;scRefreshFeatReviewSummary()" title="Remove this row"><i class="ti ti-x" aria-hidden="true"></i></a>
      </div>
    </div>`;
  }).join('');

  const remaining=_scUploadFeatRows.filter(r=>!r.removed);
  const unresolvedCount=remaining.filter(r=>!r.mapTo).length;
  const resolvedCount=remaining.length-unresolvedCount;

  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='sc-feat-review-overlay';
  overlay.innerHTML=`<div class="modal" style="max-width:620px;position:relative;">
    <button onclick="document.getElementById('sc-feat-review-overlay').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
      <div style="font-size:13px;font-weight:500;color:var(--t1);">Review features before adding</div>
      <div style="font-size:11px;color:var(--t3);margin-top:4px;">${remaining.length} feature${remaining.length===1?'':'s'} found. Every feature must map to a capability.</div>
    </div>
    <div style="padding:12px 16px 0;max-height:50vh;overflow-y:auto;" id="sc-feat-review-rows">
      <div class="cc-cap-review-row cc-cap-review-hdr">
        <div>Feature</div><div>Description</div><div>Maps to</div>
      </div>
      ${rowsHtml}
    </div>
    <div style="padding:0 16px;">
      <div id="sc-feat-review-summary" class="${unresolvedCount>0?'cc-parse-error':'cc-parse-ok'}" style="margin:12px 0 0;">${scFeatReviewSummaryText(resolvedCount,unresolvedCount)}</div>
    </div>
    <div class="modal-footer">
      <button class="modal-cancel-btn" onclick="document.getElementById('sc-feat-review-overlay').remove()">Cancel</button>
      <button class="modal-confirm-btn" id="sc-feat-review-confirm" ${unresolvedCount>0?'disabled':''} onclick="scConfirmFeatUpload()">Add ${resolvedCount} feature${resolvedCount===1?'':'s'}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const _escHandler=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_escHandler,true);}};
  document.addEventListener('keydown',_escHandler,true);
  trapFocus(overlay);
}

function scFeatReviewSummaryText(resolvedCount,unresolvedCount){
  if(unresolvedCount>0){
    return `<i class="ti ti-alert-circle" style="font-size:11px;" aria-hidden="true"></i> ${unresolvedCount} feature${unresolvedCount===1?'':'s'} need${unresolvedCount===1?'s':''} a capability before you can continue - map or remove ${unresolvedCount===1?'it':'them'}.`;
  }
  return `<i class="ti ti-check" style="font-size:11px;" aria-hidden="true"></i> All ${resolvedCount} feature${resolvedCount===1?'':'s'} mapped to a capability.`;
}

function scRefreshFeatReviewSummary(){
  const overlay=document.getElementById('sc-feat-review-overlay');
  const scrollEl=overlay?overlay.querySelector('#sc-feat-review-rows'):null;
  const scrollTop=scrollEl?scrollEl.scrollTop:0;
  if(overlay)overlay.remove();
  scShowFeatReviewModal();
  const newScrollEl=document.getElementById('sc-feat-review-rows');
  if(newScrollEl)newScrollEl.scrollTop=scrollTop;
}

// Confirm: batched equivalent of scDoAddFeat() per resolved row.
function scConfirmFeatUpload(){
  const remaining=_scUploadFeatRows.filter(r=>!r.removed&&r.mapTo);
  if(remaining.length===0){
    const overlay=document.getElementById('sc-feat-review-overlay');
    if(overlay)overlay.remove();
    _scUploadFeatRows=[];
    return;
  }

  let added=0,skippedDupes=0;
  const affectedCaps=new Set();

  remaining.forEach(r=>{
    const cap=r.mapTo;
    let metric=cap,stage='PI Plan',metricPath=cap;
    if(typeof capStore!=='undefined'){
      for(const[mk,entry]of Object.entries(capStore)){
        const found=(entry.capabilities||[]).find(c=>c.name===cap);
        if(found){
          metric=entry.metricName||cap;
          stage=entry.stageLabel||'PI Plan';
          metricPath=scGetMetricPath(metric);
          break;
        }
      }
    }
    const fid=scMakeFeatureId(metric,cap,r.name);
    if(scCanvas.find(x=>x.id===fid)){skippedDupes++;return;}
    scCanvas.push({id:fid,metric,metricPath,stage,cap,name:r.name,why:r.description||'',stories:null,origin:'pi'});
    affectedCaps.add(cap);
    added++;
  });

  const overlay=document.getElementById('sc-feat-review-overlay');
  if(overlay)overlay.remove();
  _scUploadFeatRows=[];

  fcUpdateTabBadge();
  fcRenderCanvas();

  let msg=`${added} feature${added===1?'':'s'} added`;
  if(affectedCaps.size===1)msg+=` under ${[...affectedCaps][0]}`;
  else if(affectedCaps.size>1)msg+=` across ${affectedCaps.size} capabilities`;
  if(skippedDupes>0)msg+=` (${skippedDupes} skipped - already on canvas)`;
  showToast(msg,added>0?'success':'warn');
}


// ── Edit Feature modal ──
function scShowEditFeatModal(fid){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat)return;

  // Build cap options
  const capSet=new Set();
  if(typeof capStore!=='undefined'){
    Object.values(capStore).forEach(entry=>{(entry.capabilities||[]).forEach(cap=>{if(cap.name)capSet.add(cap.name);});});
  }
  scCanvas.forEach(f=>{if(f.cap)capSet.add(f.cap);});
  const sortedCaps=[...capSet].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
  let capOpts='';
  sortedCaps.forEach(c=>{capOpts+=`<option value="${e(c)}"${c===feat.cap?' selected':''}>${e(c)}</option>`;});

  const hasStories=feat.stories&&feat.stories.length>0;
  const storyCount=hasStories?feat.stories.length:0;

  let warnHtml='';
  if(hasStories){
    warnHtml=`<div id="sc-edit-warn-strip" style="display:none;">
      <div style="background:#FAEEDA;border:0.5px solid #FAC775;border-radius:5px;padding:8px 10px;margin-top:4px;display:flex;gap:6px;align-items:flex-start;">
        <i class="ti ti-alert-triangle" style="font-size:11px;color:#633806;flex-shrink:0;margin-top:1px;" aria-hidden="true"></i>
        <span style="font-size:11px;color:#633806;line-height:1.4;">This feature has ${storyCount} stor${storyCount!==1?'ies':'y'}. Changing the description may make them inaccurate — they will need to be regenerated.</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;margin-bottom:14px;">
        <button class="modal-cancel-btn" style="flex:1;font-size:11px;padding:5px 12px;" onclick="scDoEditFeat('${e(fid)}','clear')">Clear Stories</button>
        <button class="modal-confirm-btn" style="flex:1;font-size:11px;padding:5px 12px;" onclick="scDoEditFeat('${e(fid)}','keep')">Keep Existing</button>
      </div>
    </div>`;
  }

  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='sc-edit-feat-overlay';
  overlay.innerHTML=`<div class="modal" style="max-width:400px;overflow-y:auto;max-height:80vh;position:relative;">
    <button onclick="document.getElementById('sc-edit-feat-overlay').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
      <div style="font-size:13px;font-weight:500;color:var(--t1);">Edit Feature</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;padding:14px 20px 4px;">
      <div>
        <label style="font-size:10px;font-weight:500;color:var(--t2);display:block;margin-bottom:3px;">Feature Name<span style="color:var(--red);margin-left:1px;">*</span></label>
        <input id="sc-edit-feat-name" type="text" value="${e(feat.name)}"
          style="width:100%;height:30px;border:1px solid var(--divider);border-radius:5px;padding:0 8px;font-size:11px;font-family:var(--font);color:var(--t1);background:var(--bg);"
          oninput="scEditFeatValidate('${e(feat.name)}')" />
        <div id="sc-edit-feat-name-err" style="display:none;font-size:9px;color:var(--red);margin-top:2px;align-items:center;gap:3px;">
          <i class="ti ti-alert-circle" style="font-size:9px;" aria-hidden="true"></i> A feature with this name already exists on the canvas.
        </div>
      </div>
      <div>
        <label style="font-size:10px;font-weight:500;color:var(--t2);display:block;margin-bottom:3px;">Why It Matters <span style="font-size:9px;color:var(--label);">(Optional)</span></label>
        <textarea id="sc-edit-feat-why"
          style="width:100%;height:60px;border:1px solid var(--divider);border-radius:5px;padding:6px 8px;font-size:11px;font-family:var(--font);color:var(--t1);background:var(--bg);resize:none;"
          oninput="(function(){var s=document.getElementById('sc-edit-warn-strip');if(s)s.style.display='';var f=document.getElementById('sc-edit-feat-footer');if(s&&f)f.style.display='none';})()">${e(feat.why||'')}</textarea>
      </div>
      <div>
        <label style="font-size:10px;font-weight:500;color:var(--t2);display:block;margin-bottom:3px;">Capability<span style="color:var(--red);margin-left:1px;">*</span></label>
        <div style="position:relative;">
          <select id="sc-edit-feat-cap"
            style="width:100%;height:30px;border:1px solid var(--divider);border-radius:5px;padding:0 8px;font-size:11px;font-family:var(--font);color:var(--t1);background:var(--bg);appearance:none;">
            ${capOpts}
          </select>
          <i class="ti ti-chevron-down" style="position:absolute;right:8px;top:9px;font-size:10px;color:var(--label);pointer-events:none;" aria-hidden="true"></i>
        </div>
        <div style="font-size:9px;color:var(--label);margin-top:2px;">Changing this moves the feature to the selected capability.</div>
      </div>
      ${warnHtml}
    </div>
    <div class="modal-footer" id="sc-edit-feat-footer">
      <button class="modal-cancel-btn" onclick="document.getElementById('sc-edit-feat-overlay').remove()">Cancel</button>
      <button class="modal-confirm-btn" id="sc-edit-feat-submit" onclick="scDoEditFeat('${e(fid)}','keep')">Save Changes</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const _esc=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_esc,true);}};
  document.addEventListener('keydown',_esc,true);
  trapFocus(overlay);
  const nameEl=document.getElementById('sc-edit-feat-name');
  if(nameEl){nameEl.focus();nameEl.select();}
}

function scEditFeatValidate(originalName){
  const nameEl=document.getElementById('sc-edit-feat-name');
  const errEl=document.getElementById('sc-edit-feat-name-err');
  const submitEl=document.getElementById('sc-edit-feat-submit');
  if(!nameEl||!errEl)return;
  const val=nameEl.value.trim();
  if(!val){nameEl.style.borderColor='var(--divider)';errEl.style.display='none';if(submitEl)submitEl.disabled=true;return;}
  const isDupe=val!==originalName&&scCanvas.some(f=>f.name.toLowerCase()===val.toLowerCase());
  if(isDupe){
    nameEl.style.borderColor='var(--red)';errEl.style.display='flex';if(submitEl)submitEl.disabled=true;
  } else {
    nameEl.style.borderColor='var(--purple)';errEl.style.display='none';if(submitEl)submitEl.disabled=false;
  }
}

function scDoEditFeat(fid, mode){
  const feat=scCanvas.find(x=>x.id===fid);
  if(!feat)return;
  const nameEl=document.getElementById('sc-edit-feat-name');
  const whyEl=document.getElementById('sc-edit-feat-why');
  const capEl=document.getElementById('sc-edit-feat-cap');
  if(!nameEl||!capEl)return;
  const newName=nameEl.value.trim()||feat.name;
  const newWhy=whyEl?whyEl.value.trim():'';
  const newCap=capEl.value;
  const oldName=feat.name;

  feat.name=newName;
  feat.why=newWhy;
  const oldCap=feat.cap;
  feat.cap=newCap;
  // Mark prototype stale on any metadata change
  if(typeof pcMarkStale==='function')pcMarkStale(fid);

  // If cap association changed, resolve new stage/metric from capStore
  if(newCap!==oldCap){
    if(typeof capStore!=='undefined'){
      for(const[mk,entry]of Object.entries(capStore)){
        const found=(entry.capabilities||[]).find(c=>c.name===newCap);
        if(found){
          feat.metric=entry.metricName||newCap;
          feat.stage=entry.stageLabel||'PI Plan';
          feat.metricPath=typeof scGetMetricPath==='function'?scGetMetricPath(feat.metric):feat.metric;
          break;
        }
      }
    }
    // Reset left nav filter to All so user sees the feature in its new group
    scCapNavFilter=null;
    scSelectedIds.clear(); // selection is filter-scoped — same fix as scSetCapFilter
  }

  // Sync name+why change back to cap.featStore source
  if(typeof capStore!=='undefined'){
    Object.values(capStore).forEach(entry=>{
      (entry.capabilities||[]).forEach(cap=>{
        if(cap.featStore&&cap.featStore.top){
          const srcFeat=cap.featStore.top.find(f=>f.name===oldName);
          if(srcFeat){srcFeat.name=newName;srcFeat.why=newWhy;}
        }
      });
    });
  }

  if(mode==='clear'){
    // Delete prototype entirely when all stories cleared — no point keeping stale data
    if(typeof pcDeleteProto==='function')pcDeleteProto(fid);
    feat.stories=[];
    feat.piPlanned=false;
    feat.piSprintAssigned=null;
    feat.piSubmitted=false;
    feat.piSubmittedStoryCount=0;
    scSelectedIds.delete(fid);
    scPiSelectedIds.delete(fid);
    // Item 27: if feature was in PI plan, remove its stories from plan
    if(typeof piPlan!=='undefined'&&piPlan){
      // Remove all this feature's story IDs from storyAssignments and backlogStoryIds
      // (feat.stories is now [], so we need to remove by checking featureId on piFindStory)
      // We stored stories before clearing — use the old stories to clean up
      const oldStoryIds=Object.keys(piPlan.storyAssignments||{}).filter(sid=>{
        const s=scCanvas.find(f=>f.stories&&f.stories.some(st=>st.id===sid));
        return !s; // story no longer exists on canvas
      });
      oldStoryIds.forEach(sid=>{
        delete piPlan.storyAssignments[sid];
        if(piPlan.backlogStoryIds)piPlan.backlogStoryIds=piPlan.backlogStoryIds.filter(id=>id!==sid);
      });
    }
    // Close story panel if this feature is open
    if(scPanelFeatureId===fid){
      const updatedFeat=scCanvas.find(x=>x.id===fid)||scCanvas.find(x=>x.id===newId);
      if(updatedFeat)scRenderPanel(updatedFeat);
    }
  }

  const overlay=document.getElementById('sc-edit-feat-overlay');
  if(overlay)overlay.remove();

  fcRenderCanvas();
  if(typeof fcRenderCapNav==='function')fcRenderCapNav();
  // Refresh panel in place if this feature is currently open
  if(scPanelFeatureId===fid)scOpenPanel(fid);
  if(mode==='clear'){
    if(hasPiPlan){
      showToast('Stories cleared. This feature was in your PI plan — regenerate PI to update.','warn');
    } else {
      showToast('Feature updated. Stories cleared — select the card to regenerate.','success');
    }
  } else {
    showToast('Feature updated.','success');
  }
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
}
