function getKey(){const el=document.getElementById('api-key');if(el&&el.value.trim())return el.value.trim();return sessionStorage.getItem('hcl_ak')||'';}  
function gv(id){return document.getElementById(id).value.trim();}

// ── Per-caller default model table ──
// Used only when appSettings.model === 'optimized' (the new default — see
// settings-page.js _spModels). Any other appSettings.model value is a
// deliberate user override and wins outright over everything below, via
// resolveModel()'s precedence chain. Keys must exactly match the `caller`
// tag passed as callAPI's last argument. Sourced from the v8.87 AI Model
// Defaults spreadsheet — keep these two in sync if either changes.
const CALLER_MODEL_DEFAULTS = {
  'dm-generate': 'claude-sonnet-4-6',
  'mi-suggest': 'claude-haiku-4-5',
  'mi-generate': 'claude-haiku-4-5',
  'mi-docx-gen': 'claude-haiku-4-5',
  'cc-gen-one': 'claude-sonnet-4-6',
  'cc-gen-all': 'claude-haiku-4-5',
  'cc-gen-features': 'claude-sonnet-4-6',
  'cc-regen-metric': 'claude-sonnet-4-6',
  'cc-refine-metric': 'claude-sonnet-4-6',
  'cc-gen-features-pi': 'claude-sonnet-4-6',
  'cc-dd-batch': 'claude-haiku-4-5',
  'cc-dd-single': 'claude-haiku-4-5',
  'cc-gen-features-cap': 'claude-sonnet-4-6',
  'drawer-gen-features': 'claude-sonnet-4-6',
  'diagnostic-leak': 'claude-sonnet-4-6',
  'fc-gen-stories': 'claude-sonnet-4-6',
  'md-dd-batch': 'claude-haiku-4-5',
  'pi-generate': 'claude-sonnet-4-6',
  'prototype-wireframe': 'claude-haiku-4-5',
  'prototype-brief': 'claude-sonnet-4-6',
  'doc-summary': 'claude-haiku-4-5',
  'ai-recommendations': 'claude-haiku-4-5'
};
const _MODEL_FALLBACK = 'claude-sonnet-4-6'; // used if caller tag is missing from the table above — should never happen, but never silently fail to a non-existent model

// ── Shared model resolver ──
// Single source of truth for "which model should this call actually use."
// Precedence: explicit modelOverride argument (used by the CC/FC multi-select
// threshold logic to force Haiku for 4+ items) > deliberate user override in
// Settings (anything other than 'optimized') > per-caller smart default >
// final hardcoded fallback. Called by callAPI() AND by the two call sites
// that build their own request body independently (home.js AI Recommendations,
// which uses a separate Netlify-function fetch path by design) rather than
// going through callAPI() — both must call this, not re-implement it, so a
// future change to precedence only needs to happen in one place.
// ── Multi-select model threshold ──
// Used by CC's ccGenerateFeaturesForSelected and FC's scGenerateStories
// batch path. Forces claude-haiku-4-5 for 4+ items ONLY when the user is
// still on the 'optimized' default — if they've explicitly chosen a model
// in Settings, that choice always wins, with no exception for batch size.
function resolveThresholdModel(itemCount){
  const settingsVal=(typeof appSettings!=='undefined')?appSettings.model:undefined;
  if(settingsVal && settingsVal!=='optimized') return null; // user has an explicit choice — don't touch it
  return itemCount>=4 ? 'claude-haiku-4-5' : null;
}

function resolveModel(modelOverride, caller){
  if(modelOverride) return modelOverride;
  const settingsVal=(typeof appSettings!=='undefined')?appSettings.model:undefined;
  if(settingsVal && settingsVal!=='optimized') return settingsVal;
  return CALLER_MODEL_DEFAULTS[caller] || _MODEL_FALLBACK;
}

// ── Shared tab-pending indicator ──
// Marks a tab with a purple dot to signal "new content sent here, not yet
// viewed". Cleared automatically the first time the user visits that tab
// (see switchTab below). Used for the DM->CC, CC->FC, FC->SC, SC->PI handoffs.
function markTabPending(tabId){
  const dot=document.getElementById('tab-'+tabId+'-dot');
  if(dot)dot.classList.add('on');
}
function clearTabPending(tabId){
  const dot=document.getElementById('tab-'+tabId+'-dot');
  if(dot)dot.classList.remove('on');
}

function switchTab(t){
  if(blockIfGenerating(()=>switchTab(t)))return;
  const prev=curTab;
  curTab=t;
  // Fix 1 (v8.39): update lastTab on user-initiated tab switches, debounced 300ms
  if(typeof _ssRestoring!=='undefined'&&!_ssRestoring&&t!=='home'){
    if(typeof _ssLastTabTimer!=='undefined')clearTimeout(_ssLastTabTimer);
    _ssLastTabTimer=setTimeout(function(){
      if(typeof sessionStoreUpdateLastTab==='function')sessionStoreUpdateLastTab(t);
    },300);
  }
  // v8.43: restore session name visibility on any non-home tab
  if(t!=='home'&&typeof hdrApplySessionNameVisibility==='function'&&(typeof _ssRestoring==='undefined'||!_ssRestoring)){
    hdrApplySessionNameVisibility();
  }
  // Clear any pending-content indicator for the tab being entered
  clearTabPending(t);
  // Close evidence drawer whenever navigating away from KPI tree
  if(t!=='mm'&&typeof dvCloseEvidenceDrawer==='function')dvCloseEvidenceDrawer();
  // Close DD panel on every tab switch
  if(typeof ccCloseDDPanel==='function')ccCloseDDPanel();
  // Update all tab buttons — includes home, fc (Feature Canvas) and sc (Story Canvas)
  ['mm','cc','pi','mi','la','fc','sc','home'].forEach(id=>{
    const el=document.getElementById('tab-'+id);
    if(el)el.classList.toggle('active',t===id);
  });
  const ob=document.getElementById('out-body');
  const fcTab=document.getElementById('fc-tab');
  const scTab=document.getElementById('sc-tab');
  const laTab=document.getElementById('la-tab');
  const miTab=document.getElementById('mi-tab');
  const ccTab=document.getElementById('cc-tab');
  const piTab=document.getElementById('pi-tab');
  const homeTab=document.getElementById('home-tab');
  const lp=document.getElementById('left-panel');

  // Show/hide main content areas
  if(homeTab)homeTab.style.display=(t==='home')?'flex':'none';
  ob.style.display=(t==='mm')?'':'none';
  if(fcTab)fcTab.classList.toggle('on',t==='fc');
  if(scTab)scTab.classList.toggle('on',t==='sc');
  if(laTab)laTab.classList.toggle('on',t==='la');
  if(miTab)miTab.classList.toggle('on',t==='mi');
  if(ccTab)ccTab.classList.toggle('on',t==='cc');
  if(piTab)piTab.classList.toggle('on',t==='pi');

  // Left panel: hidden on all tabs except mm post-launch (handled in mm case above)
  // For all non-mm tabs, always hide old left panel — Home has its own, others don't use it
  if(t!=='mm'){
    if(lp) lp.classList.add('sc-hidden');
  }

  if(t==='home'){
    const bar=document.getElementById('diag-action-bar');
    if(bar)bar.style.display='none';
    // v8.43: hide session name on Home without destroying its value
    if(typeof hdrApplySessionNameVisibility==='function'&&(typeof _ssRestoring==='undefined'||!_ssRestoring)){
      hdrApplySessionNameVisibility();
    }
    // Clear active session when navigating back to Home from a workflow tab.
    // Saves session to library before wiping — no data loss, fully resumable.
    // Scoped to prev!=='home' to avoid firing when Settings closes while on Home.
    if(sessionActive&&prev!=='home'&&typeof homeClearSession==='function'){
      homeClearSession();
      // Reset product dropdown — only on Home navigation, not on launch/resume/delete
      if(typeof activeProfileId!=='undefined') activeProfileId=null;
      var _prodSel=document.getElementById('home-product-sel');
      if(_prodSel) _prodSel.value='';
      // Reset session setup form fields — clears stale CVC, Additional Context,
      // MI toggle, AI Suggestions toggle, Approach/Mode pills, and manual cap list
      if(typeof _homeResetSetupForm==='function') _homeResetSetupForm();
    }
    // Hide all workflow tabs when on Home — visible only during active non-home tab
    ['tab-mm','tab-cc','tab-mi','tab-la','tab-fc'].forEach(function(id){
      const el=document.getElementById(id);
      if(el&&el.style.display!=='none') el.setAttribute('data-home-hidden','1');
      if(el) el.style.display='none';
    });
    // SC and PI use .revealed class — hide them too when on Home
    ['tab-sc','tab-pi'].forEach(function(id){
      const el=document.getElementById(id);
      if(el&&el.classList.contains('revealed')){
        el.setAttribute('data-home-hidden','1');
        el.classList.remove('revealed');
      }
    });
    if(typeof homeOnTabEnter==='function')homeOnTabEnter();
  } else if(t==='mm'){
    // Restore tabs that were hidden when entering Home — only if they were visible before
    ['tab-mm','tab-cc','tab-mi','tab-la','tab-fc'].forEach(function(id){
      const el=document.getElementById(id);
      if(el&&el.getAttribute('data-home-hidden')==='1'){
        el.style.display='';
        el.removeAttribute('data-home-hidden');
      }
    });
    // Restore SC and PI revealed state if they were hidden on Home entry
    ['tab-sc','tab-pi'].forEach(function(id){
      const el=document.getElementById(id);
      if(el&&el.getAttribute('data-home-hidden')==='1'){
        el.classList.add('revealed');
        el.removeAttribute('data-home-hidden');
      }
    });
    // Show session summary in left panel if session is active; hide otherwise
    const lp=document.getElementById('left-panel');
    if(sessionActive&&typeof mmRenderSessionPanel==='function'){
      mmRenderSessionPanel();
      // v8.44: sync left panel session name after mmRenderSessionPanel rebuilds #mm-ph-sub
      if(typeof mmUpdateSessionName==='function'){
        var _hdrEl=document.getElementById('hdr-product-name');
        var _hdrName=_hdrEl?(_hdrEl.textContent||'').trim():'';
        if(_hdrName)mmUpdateSessionName(_hdrName);
      }
    } else if(lp){
      lp.classList.add('sc-hidden');
    }
    if(gData){
      document.getElementById('mm-out').classList.add('on');
      // Hide empty state whenever gData exists — covers restore path where es was not hidden
      const esEl=document.getElementById('es');
      if(esEl) esEl.style.display='none';
      // Render DM tree if not yet rendered — covers resume from CC/FC where renderMM was never called
      const mmOut=document.getElementById('mm-out');
      if(mmOut&&!mmOut.querySelector('.mm-north-star')&&typeof renderMM==='function'){
        renderMM(gData);
        if(typeof mmRenderSessionPanel==='function'){
          mmRenderSessionPanel();
      // v8.44: sync left panel session name after mmRenderSessionPanel rebuilds #mm-ph-sub
      if(typeof mmUpdateSessionName==='function'){
        var _hdrEl=document.getElementById('hdr-product-name');
        var _hdrName=_hdrEl?(_hdrEl.textContent||'').trim():'';
        if(_hdrName)mmUpdateSessionName(_hdrName);
      }
        }
      }
      // Always re-paint evidence dots on mm tab entry — dots are DOM-only and lost on tab switch
      if(typeof kpiRenderEvidenceStates==='function') kpiRenderEvidenceStates();
    }
    const bar=document.getElementById('diag-action-bar');
    if(bar){
      bar.style.display='';
    } else if(gData&&typeof renderDiagnosticActionBar==='function'){
      // Bar was removed by homeClearSession on session change — re-render it
      renderDiagnosticActionBar();
    }
  }else if(t==='cc'){
    const bar=document.getElementById('diag-action-bar');
    if(bar)bar.style.display='none';
    if(typeof ccOnTabEnter==='function')ccOnTabEnter();
  }else if(t==='pi'){
    const bar=document.getElementById('diag-action-bar');
    if(bar)bar.style.display='none';
    if(typeof piOnTabEnter==='function')piOnTabEnter();
  }else if(t==='mi'){
    const bar=document.getElementById('diag-action-bar');
    if(bar)bar.style.display='none';
    if(typeof miGenerating!=='undefined'&&miGenerating) return;
    const miTabEl2=document.getElementById('mi-tab');
    if(!miGenerated){
      miRenderEmpty();
    } else {
      if(!miTabEl2||!miTabEl2.querySelector('.mi-layout')){
        miRenderScreen();
      } else {
        miRenderLeftPanel();
      }
    }
  }else if(t==='la'){
    const bar=document.getElementById('diag-action-bar');
    if(bar)bar.style.display='none';
    if(productLeakAnalysis)laRenderAnalysis();
  }
  // Feature Canvas tab entry
  if(t==='fc'){
    const bar=document.getElementById('diag-action-bar');
    if(bar)bar.style.display='none';
    if(typeof fcRenderCapNav==='function')fcRenderCapNav();
    if(typeof fcRenderCanvas==='function')fcRenderCanvas();
    // Always reveal SC/PI tabs when entering FC if their data exists
    const scTabReveal=document.getElementById('tab-sc');
    if(scTabReveal&&typeof scCanvas!=='undefined'&&scCanvas.some(f=>f.stories&&f.stories.length>0))scTabReveal.classList.add('revealed');
    const piTabReveal=document.getElementById('tab-pi');
    if(piTabReveal&&typeof featPI!=='undefined'&&featPI&&typeof piPlan!=='undefined'&&piPlan)piTabReveal.classList.add('revealed');
  }
  // Story Canvas tab entry
  if(t==='sc'){
    const bar=document.getElementById('diag-action-bar');
    if(bar)bar.style.display='none';
    if(typeof newScRender==='function')newScRender();
  }
  // Close export dropdowns when switching tabs
  const expDrop=document.getElementById('sc-export-drop');
  if(expDrop)expDrop.classList.remove('open');
  const fcExpDrop=document.getElementById('fc-export-drop');
  if(fcExpDrop)fcExpDrop.classList.remove('open');
  const nscFilterDrop=document.getElementById('nsc-filter-drop');
  if(nscFilterDrop)nscFilterDrop.classList.remove('open');
}

// Reveal a new tab (show it in the tab row) and navigate to it
function revealAndSwitchTab(tabId){
  const el=document.getElementById('tab-'+tabId);
  if(el){
    // Use class pattern for tab-gated tabs (sc, pi); style.display for others (dv, la, mi)
    if(el.classList.contains('tab-gated')){
      el.classList.add('revealed');
    } else {
      el.style.display='';
    }
    switchTab(tabId);
  }
}

// ── Direction A loader — vertical timeline ──
function showLoad(stagesConfig){
  document.getElementById('es').style.display='none';
  document.getElementById('er').classList.remove('on');
  document.getElementById('mm-out').classList.remove('on');
  document.getElementById('dd-out').classList.remove('on');
  document.getElementById('dd-ls').classList.remove('on');
  document.getElementById('ls').classList.add('on');

  const stages=stagesConfig||LOADER_STAGES_KPI;

  function buildTimelineHTML(activeIdx){
    const timelineHtml=stages.map((st,i)=>{
      const nodeState=i<activeIdx?'done':i===activeIdx?'active':'pending';
      const isLast=i===stages.length-1;
      return`<div class="mi-loader-stage">
        <div class="mi-loader-stage-left">
          <div class="mi-loader-node ${nodeState}"></div>
          ${!isLast?`<div class="mi-loader-connector ${i<activeIdx?'done':i===activeIdx?'active':''}"></div>`:''}
        </div>
        <div class="mi-loader-stage-right">
          <div class="mi-loader-stage-name ${nodeState}">${st.label}</div>
          ${i===activeIdx?`<div class="mi-loader-submsg" id="ls-submsg">${st.messages[0]}</div>`:''}
        </div>
      </div>`;
    }).join('');
    return`<div id="load-headline" style="font-size:15px;font-weight:600;color:var(--t1);margin-bottom:14px;text-align:center;">${stages[activeIdx].label}…</div>
      <div class="mi-loader-timeline">${timelineHtml}</div>`;
  }

  const stepsEl=document.getElementById('load-steps');
  const subEl=document.getElementById('load-sub');
  if(subEl)subEl.style.display='none';
  if(stepsEl)stepsEl.innerHTML=buildTimelineHTML(0);

  let stageIdx=0,msgIdx=0,msgTimer=null;

  function activateStage(idx){
    stageIdx=idx;msgIdx=0;
    if(stepsEl)stepsEl.innerHTML=buildTimelineHTML(idx);
    const msgs=stages[idx].messages;
    if(msgTimer)clearInterval(msgTimer);
    msgTimer=setInterval(()=>{
      msgIdx=(msgIdx+1)%msgs.length;
      const el=document.getElementById('ls-submsg');
      if(el)el.textContent=msgs[msgIdx];
    },3200);
  }

  activateStage(0);

  window._loaderAdvanceStage=function(){
    if(stageIdx<stages.length-1)activateStage(stageIdx+1);
  };

  ltimer={h:null,s:msgTimer,_clearMsg:()=>{if(msgTimer)clearInterval(msgTimer);}};
}
function hideLoad(){
  if(ltimer){if(ltimer.s)clearInterval(ltimer.s);if(ltimer._clearMsg)ltimer._clearMsg();ltimer=null;}
  window._loaderAdvanceStage=null;
  document.getElementById('ls').classList.remove('on');
  const subEl=document.getElementById('load-sub');
  if(subEl)subEl.style.display='';
}
function showDDLoad(){
  document.getElementById('dd-out').classList.remove('on');
  document.getElementById('dd-ls').classList.add('on');
  let hi=0;
  document.getElementById('dd-load-headline').textContent=DD_HEADS[0];
  document.getElementById('dd-load-sub').textContent=DD_SUBS[0];
  const hT=setInterval(()=>{hi=(hi+1)%DD_HEADS.length;document.getElementById('dd-load-headline').textContent=DD_HEADS[hi];document.getElementById('dd-load-sub').textContent=DD_SUBS[hi%DD_SUBS.length];},3500);
  const sc=document.getElementById('dd-load-steps');
  sc.innerHTML=DD_STEPS.map((s,i)=>`<div class="ls" id="ddlst${i}"><div class="ls-dot"></div>${s}</div>`).join('');
  document.getElementById('ddlst0').classList.add('act');
  let i=0;
  const sT=setInterval(()=>{if(i<DD_STEPS.length-1){document.getElementById('ddlst'+i).classList.remove('act');document.getElementById('ddlst'+i).classList.add('done');i++;document.getElementById('ddlst'+i).classList.add('act');}},3000);
  ddLtimer={h:hT,s:sT};
}
function hideDDLoad(){
  if(ddLtimer){clearInterval(ddLtimer.h);clearInterval(ddLtimer.s);ddLtimer=null;}
  document.getElementById('dd-ls').classList.remove('on');
}

async function callAPI(sys,usr,maxTok,signal,modelOverride,caller){
  const key=getKey();

  // ── Proxy URL ─────────────────────────────────────────────────────────────────
  // Hosted: Render proxy via PROXY_URL from env.js.
  // Dev env.js  → pgt-proxy-dev.onrender.com
  // Prod env.js → product-diagnostics-proxy.onrender.com
  // Local dev falls back to localhost:3001 regardless of env.js value.
  // Note: onrender.com must be whitelisted on corporate networks for generation to work.
  // AI Recommendations uses the Netlify function path (home.js) — works without whitelisting.
  const host=window.location.hostname;
  const isLocal=host===''||host==='localhost'||host==='127.0.0.1';
  const LOCAL_PROXY_URL='http://localhost:3001/api/anthropic';
  const hostedProxyUrl=(typeof PROXY_URL!=='undefined'&&PROXY_URL)?PROXY_URL:'https://product-diagnostics-proxy.onrender.com/api/anthropic';

  // ── JWT token ─────────────────────────────────────────────────────────────────
  // authGetFreshToken() guarantees a non-expired token: getSession() first,
  // then forced refreshSession() if within the 90s expiry margin, then login
  // redirect if both fail. Fixes "Session expired or invalid" on Render proxy
  // after overnight use or sign-out + sign-in cycle. (v8.33)
  let authToken = '';
  try {
    if(typeof authGetFreshToken==='function'){
      authToken = await authGetFreshToken();
    }
  } catch(e) {
    console.warn('callAPI: could not retrieve session token', e);
  }

  const headers = {
    'Content-Type': 'application/json'
  };
  // Only attach Authorization when a BYOK key is present.
  // When empty, the proxy uses the org key from its env var.
  // Avoids sending 'Bearer ' (empty) which can cause proxy/log ambiguity.
  if(key && key.trim()) headers['Authorization'] = 'Bearer ' + key.trim();
  if(authToken) headers['X-Auth-Token'] = authToken;

  const body = JSON.stringify({
    model:resolveModel(modelOverride, caller),
    max_tokens:maxTok,
    system:sys,
    messages:[{role:'user',content:usr}],
    _caller:caller||''
  });

  let r;
  if(isLocal){
    r=await fetch(LOCAL_PROXY_URL,{method:'POST',headers,body,signal});
  }else{
    r=await fetch(hostedProxyUrl,{method:'POST',headers,body,signal});
  }

  const data=await r.json().catch(function(){
    // Proxy returned non-JSON (HTML timeout page or platform error)
    throw new Error('Generation timed out or proxy unavailable. Please try again.');
  });
  if(data.error){
    const _etype=data.error.type||'';
    const _emsg=data.error.message||'Unknown error';
    const _elabels={'api_error':'Anthropic API error — ','overloaded_error':'Anthropic overloaded — ','invalid_request_error':'Invalid request — ','proxy_error':'Proxy error — ','permission_error':'API key permission error — ','auth_error':'','rate_limit_error':''};
    const _eprefix=_elabels.hasOwnProperty(_etype)?_elabels[_etype]:(_etype?'['+_etype+'] ':'');
    throw new Error(_eprefix+_emsg);
  }
  return data.content&&data.content[0]?data.content[0].text:'';
}

function isValidTree(p){
  // Hard check: must have nsm, stages array with at least 3 valid stages
  if(!p||!p.nsm||!p.stages||!Array.isArray(p.stages))return false;
  const validStages=p.stages.filter(s=>s&&s.id&&s.label&&Array.isArray(s.l1_metrics)&&s.l1_metrics.length>0);
  if(validStages.length<3)return false;
  // Soft check: measurementModel missing triggers amber warning, not a hard error
  if(!p.measurementModel||!p.measurementModel.modelName){
    console.warn('isValidTree: measurementModel missing — banner will show soft warning');
  }
  return true;
}

function parseJSON(txt){
  const clean=txt.replace(/```json|```/g,'').trim();
  try{const p=JSON.parse(clean);if(isValidTree(p))return p;return repairJSON(clean);}catch(e){return repairJSON(clean);}
}
function repairJSON(s){
  let last=s.lastIndexOf('}');
  while(last>0){
    const a=s.substring(0,last+1);let b=0,br=0;
    for(let i=0;i<a.length;i++){if(a[i]==='{')b++;else if(a[i]==='}')b--;if(a[i]==='[')br++;else if(a[i]===']')br--;}
    let c='';for(let i=0;i<br;i++)c+=']';for(let i=0;i<b;i++)c+='}';
    try{const p=JSON.parse(a+c);if(isValidTree(p))return p;}catch(e){}
    last=s.lastIndexOf('}',last-1);
  }
  return null;
}
