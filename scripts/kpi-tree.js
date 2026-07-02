// Stage colour palette — 8 colours, assigned by index position
// Used by renderMM() and referenced by feature-canvas.js and export-docx.js
const STAGE_PALETTE=['#0F5FDC','#5F1EBE','#007873','#C8870A','#A32D2D','#0e7490','#6D3B9E','#2E6B5E'];

function getStagePaletteHex(idx){
  // Returns hex without # for use in DOCX exports
  return STAGE_PALETTE[idx%STAGE_PALETTE.length].replace('#','');
}

async function generate(extra){
  const key=getKey();
  // Read product context from sessionContext (set at Launch Session)
  const _sc=typeof sessionContext!=='undefined'?sessionContext:null;
  const _p=_sc&&_sc.productProfile?_sc.productProfile:{};
  const name=_p.productName||'';
  const desc=_p.productDesc||'';
  if(!name||!desc){showToast('Product name and description are required. Check your product profile in Settings.','warn');return;}

  // Only warn about data reset on fresh generate — not on Refine (extra is truthy)
  const hasDownstream=gData&&(diagnosticSessions.length>0||(productLeakAnalysis&&productLeakAnalysis.length>0)||scCanvas.length>0||ddGenerated);
  if(hasDownstream&&!extra){
    showConfirm(
      'This will clear all existing diagnostic data, experiments, and Story Canvas features. This cannot be undone.',
      'Regenerate Discovery Map?',
      ()=>generateConfirmed(extra),
      'Yes, regenerate',
      'danger'
    );
    return;
  }
  generateConfirmed(extra);
}

async function generateConfirmed(extra){
  if(aiGenInFlight.active){showToast("Still working on your last request. Hang tight, this won't take long.",'info');return;}
  const key=getKey();
  // Build fd from sessionContext — set at Launch Session click
  const _sc=typeof sessionContext!=='undefined'?sessionContext:null;
  const _p=_sc&&_sc.productProfile?_sc.productProfile:{};
  const _cp=_sc&&_sc.companyProfile?_sc.companyProfile:{};
  const name=_p.productName||'';
  const desc=_p.productDesc||'';
  if(!name||!desc){showToast('Product name and description are required. Check your product profile in Settings.','warn');return;}
  // Full reset of all downstream state
  diagnosticSessions=[];
  activeDiagnosticId=null;
  productLeakAnalysis=[];
  diagEvidenceDrawerMetricId=null;
  leakDetailExperiment=null;
  leakSelectedIds=new Set();
  if(typeof laSentIds!=='undefined')laSentIds=new Map();
  leakFilters={priority:'',linkedMetric:'',experimentType:'',selectedOnly:false};
  scCanvas=[];
  scSelectedIds=new Set();
  scPanelFeatureId=null;
  scCapNavFilter=null;
  capStore={};capStoreInvalidated=true;capActiveMetricKey=null;capActiveCapIdx=null;capActiveSubCapIdx=null;
  ddGenerated=false;
  productContext=null;
  miData=null;miGenerated=false;miProductMode='market';miCapabilities=[];
  const dvTabEl=document.getElementById('tab-dv');
  const laTabEl=document.getElementById('tab-la');
  const miTabEl=document.getElementById('tab-mi');
  if(dvTabEl)dvTabEl.style.display='none';
  if(laTabEl)laTabEl.style.display='none';
  if(miTabEl)miTabEl.style.display='none';
  // Hide downstream tabs on full regen — data cleared, re-revealed as PM progresses (v8.37)
  const fcTabEl=document.getElementById('tab-fc');
  const scTabEl=document.getElementById('tab-sc');
  const piTabEl=document.getElementById('tab-pi');
  if(fcTabEl)fcTabEl.style.display='none';
  if(scTabEl)scTabEl.classList.remove('revealed');
  if(piTabEl)piTabEl.classList.remove('revealed');
  const analyzeBar=document.getElementById('dv-analyze-bar');
  if(analyzeBar)analyzeBar.remove();
  const dvLeft=document.getElementById('dv-left');
  const dvTree=document.getElementById('dv-tree-area');
  const laTab=document.getElementById('la-tab');
  if(dvLeft)dvLeft.innerHTML='';
  if(dvTree)dvTree.innerHTML='';
  if(laTab)laTab.innerHTML='';
  fcRenderCanvas();
  if(typeof newScRender==='function')newScRender();
  if(typeof newScUpdateTabBadge==='function')newScUpdateTabBadge();
  if(curTab==='dv'||curTab==='la'||curTab==='fc'||curTab==='sc')switchTab('mm');

  const btn=document.getElementById('gen-btn');
  if(btn)btn.disabled=true;
  ddGenerated=false;
  if(settingsOpen)toggleSettings();

  // Industry fallback: product profile -> company profile -> empty (ST-14)
  const industry=_p.industry||_cp.companyIndustry||'';

  // Build context object from sessionContext
  const fd={
    name,
    url:_p.refLink||_cp.companyUrl||'',
    description:desc,
    industry,
    productType:_p.productType||'B2C Product',
    kpis:_p.kpis||'',
    problem:_p.problem||'',
    icp:_p.icp||'',
    // Session additional context takes highest priority; falls back to profile context
    additionalContext:(_sc&&_sc.additionalContext)||_p.additionalContext||'',
    customValueChain:(_sc&&_sc.customValueChain)||'',
    approach:(_sc&&_sc.approach)||'outcome-based',
    companyStrategy:_cp.companyStrategy||'',
    companyContext:_cp.companyContext||'',
    docContext:(typeof buildDocContext==='function')?buildDocContext('dm'):''
  };

  // Check if MI is enabled for this session
  const runMIFirst=!!((_sc&&_sc.marketIntelligence)&&featMI);

  if(runMIFirst){
    // Show alert modal — await user choice
    const choice = await new Promise(resolve=>{
      const alertDiv=document.createElement('div');
      alertDiv.className='mi-alert-overlay';
      alertDiv.id='mi-kpi-alert';
      alertDiv.innerHTML=`<div class="mi-alert-modal">
        <div class="mi-alert-icon"><i class="ti ti-alert-triangle"></i></div>
        <div class="mi-alert-title">Market Intelligence is enabled.</div>
        <div class="mi-alert-body">This will take 3–5 minutes — we'll research the market, analyse competitors, and use those findings to build your KPI tree. Worth the wait.</div>
        <div class="mi-alert-note">Research is AI-generated from training data. Verify statistics independently before client use.</div>
        <div class="mi-alert-btns">
          <button class="mi-alert-secondary" id="mi-alert-skip">Generate without Market Intelligence</button>
          <button class="mi-alert-primary" id="mi-alert-continue">Continue</button>
        </div>
      </div>`;
      document.body.appendChild(alertDiv);
      document.getElementById('mi-alert-continue').onclick=()=>{alertDiv.remove();resolve('with-mi');};
      document.getElementById('mi-alert-skip').onclick=()=>{alertDiv.remove();resolve('skip-mi');};
    });

    if(choice==='with-mi'){
      // Stage 1: Market Research
      showLoad(LOADER_STAGES_MI);
      const _miSignal=startAiGen(`Your Market Intelligence research for ${fd.name||'this product'} is being put together. Leaving now discards it, you'll need to regenerate from scratch.`);
      try{
        const sys=(typeof SYS_MI!=='undefined'?SYS_MI:'');
        const _miCtx=Object.assign({},fd);
        _miCtx.docContext=(typeof buildDocContext==='function')?buildDocContext('mi'):'';
        const usr=buildMarketIntelPrompt(_miCtx, null);
        const miTxt=await callAPI(sys, usr, 8000, _miSignal, 'claude-haiku-4-5', 'mi-suggest');
        const miClean=miTxt.replace(/```json|```/g,'').trim();
        let miParsed;
        try{miParsed=JSON.parse(miClean);}
        catch(e){
          const s=miClean.indexOf('{');const l=miClean.lastIndexOf('}');
          if(s>=0&&l>s)try{miParsed=JSON.parse(miClean.substring(s,l+1));}catch(e2){}
        }
        if(miParsed&&miParsed.capabilities){
          miData=miParsed;miGenerated=true;
          miProductMode=miParsed.productMode||'market';
          miCapabilities=miParsed.capabilities||[];
          const miTabEl=document.getElementById('tab-mi');
          if(miTabEl)miTabEl.style.display='';
        }
      }catch(miErr){
        if(miErr.name==='AbortError'){endAiGen();return;}
        showToast('Market Intelligence could not be generated — continuing with KPI tree. You can run it manually from the MI tab.','warn');
      }
      // Advance to Stage 2: KPI Tree Analysis
      if(window._loaderAdvanceStage) window._loaderAdvanceStage();
    } else {
      // Skip MI — normal KPI loader (mode-aware: capability vs. metric copy)
      showLoad(fd.approach==='capability-based'?LOADER_STAGES_KPI_CAP:LOADER_STAGES_KPI);
    }
  } else {
    showLoad(fd.approach==='capability-based'?LOADER_STAGES_KPI_CAP:LOADER_STAGES_KPI);
  }

  const _isManual=fd.approach==='capability-based'&&_sc&&_sc.generationMode==='manual'&&Array.isArray(_sc.manualList)&&_sc.manualList.length>0;

  const _whatCooking=fd.approach==='capability-based'
    ?`Your capability hierarchy for ${fd.name||'this product'} is being mapped out. Leaving now discards it, you'll need to regenerate from scratch.`
    :`Your Discovery Map (KPI tree) for ${fd.name||'this product'} is being mapped out. Leaving now discards it, you'll need to regenerate from scratch.`;
  const _signal=startAiGen(_whatCooking);
  try{
    const txt=await callAPI(
      'You are a senior enterprise product consultant. Respond ONLY with valid JSON. No markdown, no backticks, no preamble. Never use em dashes (—) in your output; use a hyphen (-) or rewrite the phrase.',
      _isManual
        ?buildTreePromptManual(fd,_sc.manualList,!!_sc.allowAISuggestions)
        :buildTreePrompt(fd,extra),
      20000,
      _signal,
      null,
      'dm-generate'
    );
    // Advance to final stage while we parse and render
    if(window._loaderAdvanceStage) window._loaderAdvanceStage();
    const parsed=parseJSON(txt);
    if(!parsed)throw new Error('Response could not be parsed. Please try again.');
    if(_isManual)_mmReconcileManualCaps(parsed,_sc.manualList,!!_sc.allowAISuggestions);
    gData=parsed;
    gData.approach=fd.approach;
    // Store the depth used for this generation — refinements must use the same depth
    // to avoid schema mismatch between the prompt schema and the existing tree structure
    gData.kpiDepth=(typeof appSettings!=='undefined'?appSettings.kpiDepth:1)||1;

    // Reset banner state — always expanded on new generation
    mmBannerCollapsed=false;

    // Populate productContext — single source of truth for all downstream calls
    productContext={
      name:fd.name,
      url:fd.url,
      description:fd.description,
      industry:fd.industry,
      productType:fd.productType,
      kpis:fd.kpis,
      problem:fd.problem,
      icp:fd.icp,
      additionalContext:fd.additionalContext,
      measurementModelName:(parsed.measurementModel&&parsed.measurementModel.modelName)||'',
      frameworks:(parsed.measurementModel&&parsed.measurementModel.frameworks)||[],
      nsmMetric:(parsed.nsm&&parsed.nsm.metric)||''
    };

    hideLoad();
    renderMM(parsed);
    capStore={};capStoreInvalidated=true;capActiveMetricKey=null;capActiveCapIdx=null;capActiveSubCapIdx=null;
    if(curTab==='cc')ccRenderEmpty();
    // v8.39: show session name in header, not just product name
    if(typeof hdrSetSessionName==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
      var _ssRaw=localStorage.getItem('pgt_session_'+_activeSessionId);
      var _ssMeta=_ssRaw?JSON.parse(_ssRaw):null;
      var _sesName=(_ssMeta&&_ssMeta.meta&&_ssMeta.meta.name)||fd.name||'';
      hdrSetSessionName(_sesName);
    }
    document.getElementById('mm-out').classList.add('on');
    document.getElementById('dd-out').classList.remove('on');
    curTab='mm';
    document.getElementById('tab-mm').classList.add('active');
    const tabDdEl=document.getElementById('tab-dd');if(tabDdEl)tabDdEl.classList.remove('active');
    if(typeof renderDDEmpty==='function'&&document.getElementById('dd-out'))renderDDEmpty();
    if(btn)btn.disabled=false;
    renderDiagnosticActionBar();
    // Reveal Capability Canvas tab now that Discovery Map results exist
    const ccTabEl=document.getElementById('tab-cc');
    if(ccTabEl) ccTabEl.style.display='';
    // Signal new/updated content in Capability Canvas (cleared on first visit)
    if(typeof markTabPending==='function')markTabPending('cc');
    // Reveal MI tab if feature is enabled — PM may not have run MI yet but should see it's available
    if(featMI){
      const miTabEl=document.getElementById('tab-mi');
      if(miTabEl) miTabEl.style.display='';
      // If MI was pre-generated (session launched with MI enabled), render the screen now
      // so the tab shows results immediately on first visit — productContext is set by this point
      if(miGenerated&&typeof miRenderScreen==='function'){
        miRenderScreen();
        if(typeof miRenderLeftPanel==='function') miRenderLeftPanel();
      }
    }
    // Auto-save session after successful DM generation
    if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
    endAiGen();
  }catch(err){
    if(err.name==='AbortError'){endAiGen();return;}
    hideLoad();if(btn)btn.disabled=false;
    document.getElementById('er').classList.add('on');
    document.getElementById('er-msg').textContent='Error: '+err.message;
    endAiGen();
  }
}
function regen(){
  const refinementText=gv('regen-in');
  // Check if downstream data exists — warn before wiping
  const hasDownstream=(capStore&&Object.keys(capStore).length>0)||
    (scCanvas&&scCanvas.length>0)||
    (piPlan&&Object.keys(piPlan).length>0);
  if(hasDownstream){
    _mmShowRegenConfirm(refinementText);
  } else {
    generate(refinementText);
  }
}

// ── Regen confirm modal ──
function _mmShowRegenConfirm(refinementText){
  const existing=document.getElementById('mm-regen-confirm');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='mm-regen-confirm';
  modal.className='modal-overlay';
  modal.innerHTML=`
    <div class="modal" style="max-width:440px;position:relative;">
      <button onclick="document.getElementById('mm-regen-confirm').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close" aria-label="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
        <div style="font-size:13px;font-weight:500;color:var(--t1);">Regenerate Discovery Map?</div>
      </div>
      <div class="modal-body">
        This will permanently clear your <strong>Capability Canvas, Feature Canvas, Story Canvas and PI Planning</strong> data for this session. This cannot be undone.
        <div style="margin-top:12px;">
          <button id="mm-regen-export-btn" style="width:100%;background:none;border:1px solid var(--divider);border-radius:6px;padding:7px 12px;font-size:11px;color:var(--t2);cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;" onclick="_mmRegenExport()">
            <i class="ti ti-download" style="font-size:11px;" aria-hidden="true"></i> Export current work before clearing
          </button>
          <div id="mm-regen-export-status" style="font-size:10px;color:var(--t3);text-align:center;min-height:14px;margin-top:5px;"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" onclick="document.getElementById('mm-regen-confirm').remove()">Cancel</button>
        <button id="mm-regen-confirm-btn" class="modal-confirm-btn danger" onclick="_mmRegenProceed(document.getElementById('regen-in').value||'')">Regenerate</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',function(e){if(e.target===modal)modal.remove();});
}

function _mmRegenExport(){
  const statusEl=document.getElementById('mm-regen-export-status');
  const exportBtn=document.getElementById('mm-regen-export-btn');
  const confirmBtn=document.getElementById('mm-regen-confirm-btn');
  if(exportBtn)exportBtn.disabled=true;
  if(confirmBtn)confirmBtn.disabled=true;
  if(statusEl)statusEl.textContent='Preparing export...';
  // Use best available export
  const exportFn=typeof downloadDocx==='function'?downloadDocx:
    typeof miBuildDocx==='function'?null:null;
  try{
    if(scCanvas&&scCanvas.length>0&&typeof downloadDocx==='function'){
      downloadDocx();
    } else if(typeof ccExportDocx==='function'){
      ccExportDocx();
    }
    if(statusEl)statusEl.textContent='Export started — check your downloads.';
  } catch(e){
    if(statusEl)statusEl.textContent='Export failed. You can still regenerate.';
  }
  setTimeout(function(){
    if(exportBtn)exportBtn.disabled=false;
    if(confirmBtn)confirmBtn.disabled=false;
  },2000);
}

function _mmRegenProceed(refinementText){
  const modal=document.getElementById('mm-regen-confirm');
  if(modal)modal.remove();
  // Fix 3 (v8.38): set dmRegenAt timestamp BEFORE clearing — used by sessionStoreSyncFromDB
  // to detect stale Supabase snapshots after regen
  if(typeof sessionContext!=='undefined'&&sessionContext){
    sessionContext.dmRegenAt=Date.now();
  }
  // Synchronously update localStorage snapshot with cleared downstream keys + dmRegenAt
  // This protects the fast-path restore even if Supabase write hasn't confirmed yet
  if(typeof _activeSessionId!=='undefined'&&_activeSessionId){
    try{
      var _SS_PREFIX='pgt_session_';
      var localRaw=localStorage.getItem(_SS_PREFIX+_activeSessionId);
      if(localRaw){
        var localEntry=JSON.parse(localRaw);
        if(localEntry&&localEntry.snapshot){
          localEntry.snapshot.capStore={};
          localEntry.snapshot.scCanvas=[];
          localEntry.snapshot.piPlan=null;
          localEntry.snapshot.dmRegenAt=sessionContext.dmRegenAt;
          localStorage.setItem(_SS_PREFIX+_activeSessionId,JSON.stringify(localEntry));
        }
      }
    } catch(e){ console.warn('dmRegenAt localStorage pre-clear failed:',e); }
  }
  generate(refinementText);
}

// ── _mmReconcileManualCaps ──
// Called after parsing the AI response to buildTreePromptManual(). Ensures:
// 1. Every user-supplied capability (manualList) appears exactly once across
//    stages, with its original description (if any) as the authoritative "why".
// 2. AI-placed duplicates/renames of a supplied capability are corrected to
//    match the supplied name+description (fuzzy-matched by name).
// 3. Any l1_metrics entry not matching a supplied capability is treated as an
//    AI suggestion: kept (tagged _aiSuggested:true) only if allowAISuggestions
//    is true, otherwise removed.
// 4. Any supplied capability the AI failed to place is appended to the first
//    stage (safety net — should be rare given the prompt's explicit rules).
function _mmReconcileManualCaps(parsed,manualList,allowAISuggestions){
  if(!parsed||!Array.isArray(parsed.stages))return;
  const supplied=manualList.map(c=>({name:(c.name||'').trim(),description:(c.description||'').trim()}));
  const suppliedByLower=new Map(supplied.map(c=>[c.name.toLowerCase(),c]));
  const placed=new Set();

  parsed.stages.forEach(st=>{
    if(!Array.isArray(st.l1_metrics))st.l1_metrics=[];
    st.l1_metrics=st.l1_metrics.filter(l1=>{
      if(!l1||!l1.name)return false;
      const match=suppliedByLower.get(l1.name.trim().toLowerCase());
      if(match){
        if(placed.has(match.name.toLowerCase())){
          // Duplicate placement of the same supplied capability — drop this extra
          return false;
        }
        placed.add(match.name.toLowerCase());
        l1.name=match.name; // exact user-supplied name
        l1.why=match.description||l1.why||'';
        delete l1._aiSuggested;
        return true;
      }
      // Not a supplied capability — an AI addition
      if(allowAISuggestions){
        l1._aiSuggested=true;
        return true;
      }
      return false; // strip unsanctioned AI additions
    });
  });

  // Append any supplied capabilities the AI failed to place
  const missing=supplied.filter(c=>!placed.has(c.name.toLowerCase()));
  if(missing.length>0&&parsed.stages.length>0){
    missing.forEach(c=>{
      parsed.stages[0].l1_metrics.push({name:c.name,why:c.description||''});
    });
  }
}


function renderDiagnosticActionBar(){
  const existing=document.getElementById('diag-action-bar');
  if(existing)existing.remove();
  const right=document.querySelector('.right');
  if(!right)return;
  const bar=document.createElement('div');
  bar.id='diag-action-bar';
  bar.className='diag-action-bar';
  const isCap=gData&&gData.approach==='capability-based';
  const stageCount=gData&&gData.stages?gData.stages.length:0;
  const modelName=gData&&gData.measurementModel&&gData.measurementModel.modelName?gData.measurementModel.modelName:'';
  const metricCount=countAllMetrics(gData);
  const diagBtn=(featDiag&&!isCap)?`<button class="diag-bar-secondary" id="diag-run-btn" onclick="dvAnalyze()" disabled><i class="ti ti-microscope" style="font-size:12px;" aria-hidden="true"></i> Run Diagnostics</button><a id="diag-rerun-link" onclick="dvAnalyzeForce()" style="display:none;font-size:10px;color:rgba(255,255,255,0.6);cursor:pointer;margin-left:8px;text-decoration:underline;">Run again anyway</a>`:'';
  const refineLbl='Refine Discovery Map';  // v8.38 — always DM regardless of approach
  const refinePlaceholder=isCap?'e.g. Remove the Forecasting stage, add a Carrier Management stage, rename Real-Time Inventory Visibility to Live Stock Sync, focus more on returns handling, split Fulfillment into two stages...':'e.g. Remove the Forecasting stage, add a Carrier Management stage, rename Promise Accuracy to Delivery Commitment, focus more on exception handling, split Fulfillment into two stages...';
  const barHint=isCap?`Discovery Map ready &middot; ${metricCount} capabilit${metricCount!==1?'ies':'y'} &middot; ${stageCount} stage${stageCount!==1?'s':''} ${modelName?'&middot; '+e(modelName):''}`:`Discovery Map ready &middot; ${metricCount} metrics &middot; ${stageCount} stage${stageCount!==1?'s':''} ${modelName?'&middot; '+e(modelName):''}`;
  const continueCta=`<button class="diag-bar-cta" onclick="revealAndSwitchTab('cc')"><i class="ti ti-arrow-right" style="font-size:12px;" aria-hidden="true"></i> Continue to Capability Canvas</button>`;
  bar.innerHTML=`
    <div class="diag-refine-expand" id="diag-refine-expand" style="display:none;">
      <div class="diag-refine-lbl">${refineLbl}</div>
      <div class="diag-refine-row">
        <textarea class="diag-refine-txt" id="regen-in" placeholder="${refinePlaceholder}" rows="2"></textarea>
        <button class="diag-refine-send" id="diag-refine-send" onclick="regen()" title="Refine &amp; Regenerate"><i class="ti ti-refresh" style="font-size:13px;" aria-hidden="true"></i></button>
      </div>
    </div>
    <div class="diag-bar-row">
      <span class="diag-bar-hint">${barHint}</span>
      <div class="diag-bar-btns">
        <button class="diag-refine-btn-tertiary" id="diag-refine-btn" onclick="toggleRefineBar()"><i class="ti ti-refresh" style="font-size:11px;" aria-hidden="true"></i> ${refineLbl}</button>
        ${diagBtn}
        ${continueCta}
      </div>
    </div>`;
  right.appendChild(bar);
}

function toggleRefineBar(){
  const expand=document.getElementById('diag-refine-expand');
  const btn=document.getElementById('diag-refine-btn');
  if(!expand)return;
  const isOpen=expand.style.display!=='none';
  expand.style.display=isOpen?'none':'block';
  const refineLbl='Refine Discovery Map';  // v8.38 — always DM regardless of approach
  if(btn)btn.innerHTML=isOpen?'<i class="ti ti-refresh" style="font-size:11px;" aria-hidden="true"></i> '+refineLbl:'<i class="ti ti-chevron-down" style="font-size:11px;" aria-hidden="true"></i> '+refineLbl;
  if(!isOpen){
    const txt=document.getElementById('regen-in');
    if(txt){txt.focus();txt.select();}
  }
}

function countAllMetrics(data){
  if(!data||!data.stages)return 0;
  let n=0;
  data.stages.forEach(st=>{
    (st.l1_metrics||[]).forEach(l1=>{
      n++;
      (l1.l2_metrics||[]).forEach(l2=>{
        n++;
        (l2.l3_metrics||[]).forEach(()=>n++);
      });
    });
  });
  return n;
}

function toggleMmBanner(){
  mmBannerCollapsed=!mmBannerCollapsed;
  const banner=document.getElementById('mm-model-banner');
  if(!banner)return;
  const body=document.getElementById('mm-model-banner-body');
  const toggle=document.getElementById('mm-model-banner-toggle');
  if(body)body.style.display=mmBannerCollapsed?'none':'block';
  if(toggle)toggle.textContent=mmBannerCollapsed?'show \u25BC':'hide \u25B2';
}

function renderMM(data){
  const c=document.getElementById('mm-out');
  const stages=data.stages||[];
  const mm=data.measurementModel||null;
  const hasMM=mm&&mm.modelName;
  const frameworks=mm&&mm.frameworks&&mm.frameworks.length?mm.frameworks:[];

  // ── NSM node (rationale removed) ──
  let h=`<div class="nsm-node"><div class="nsm-lbl">North Star Metric</div><div class="nsm-val">${e(data.nsm.metric)}</div><div class="nsm-def">${e(data.nsm.definition)}</div></div>`;

  // ── Measurement model banner ──
  if(hasMM){
    const pillsHtml=frameworks.map(f=>`<span class="mm-fw-pill">${e(f)}</span>`).join('');
    h+=`<div class="mm-model-banner" id="mm-model-banner">`;
    h+=`<div class="mm-banner-hdr">`;
    h+=`<div class="mm-banner-left"><i class="ti ti-book" aria-hidden="true"></i><span class="mm-model-name">${e(mm.modelName)}</span>${pillsHtml?'<span class="mm-fw-pills">'+pillsHtml+'</span>':''}</div>`;
    h+=`<button class="mm-banner-toggle" id="mm-model-banner-toggle" onclick="toggleMmBanner()">${mmBannerCollapsed?'show \u25BC':'hide \u25B2'}</button>`;
    h+=`</div>`;
    h+=`<div class="mm-banner-body" id="mm-model-banner-body" style="${mmBannerCollapsed?'display:none':''}">`;
    if(mm.rationale)h+=`<p class="mm-banner-rationale">${e(mm.rationale)}</p>`;
    h+=`</div>`;
    h+=`</div>`;
  } else {
    // Soft warning — measurementModel missing
    h+=`<div class="mm-model-banner mm-banner-warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Framework attribution not available for this generation — click <strong>Refine</strong> to regenerate.</div>`;
  }

  // ── Scroll hint if > 4 stages ──
  if(stages.length>4){
    h+=`<div class="mm-scroll-hint"><i class="ti ti-arrow-right" aria-hidden="true"></i> ${stages.length} stages &mdash; scroll horizontally to see all</div>`;
  }

  // ── Stage columns ──
  h+=`<div class="stages">`;
  stages.forEach((st,idx)=>{
    if(!st||!st.id)return;
    const stLabel=st.label||st.id;
    const stDesc=st.description||'';
    const color=STAGE_PALETTE[idx%STAGE_PALETTE.length];
    const l1list=Array.isArray(st.l1_metrics)&&st.l1_metrics.length>0?st.l1_metrics:null;

    const scopeWarn=st._scopeWarning?`<div class="stage-scope-warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>Scope changed &mdash; review ${data.approach==='capability-based'?'capabilities':'metrics'} and evidence for continued relevance</span><button class="stage-scope-warn-dismiss" onclick="event.stopPropagation();dismissScopeWarn(${idx})" title="Dismiss">&times;</button></div>`:'';
    h+=`<div class="sc"><div class="sh" style="background:${color}"><div class="sh-lbl">Stage ${idx+1}</div><div class="sh-title">${e(stLabel)}</div>${stDesc?`<div class="sh-desc" title="${e(stDesc)}">${e(stDesc)}</div>`:''}<div class="sh-actions"><button class="sh-action-btn" onclick="event.stopPropagation();editStage(${idx})" title="Edit stage"><i class="ti ti-pencil" style="font-size:11px;" aria-hidden="true"></i></button><button class="sh-action-btn" onclick="event.stopPropagation();deleteStage(${idx})" title="Delete stage"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>${scopeWarn}`;

    if(!l1list){
      h+=`<div class="stage-empty"><div class="stage-empty-icon"><i class="ti ti-minus" aria-hidden="true"></i></div><div class="stage-empty-msg">No recommended ${data.approach==='capability-based'?'capabilities':'KPIs'} for this stage</div><div class="stage-empty-sub">Refine your product context to generate ${data.approach==='capability-based'?'capabilities':'metrics'} here.</div></div>`;
    } else if(data.approach==='capability-based'){
      l1list.forEach((l1,li)=>{
        if(!l1||!l1.name)return;
        const lid=`l1-${st.id}-${li}`;
        const aiBadge=l1._aiSuggested?`<span class="l1-ai-badge" title="Added by AI to fill a gap in your capability list"><i class="ti ti-sparkles" style="font-size:9px;" aria-hidden="true"></i> AI suggested</span>`:'';
        h+=`<div class="l1 l1-flat" id="${lid}"><div class="l1-hdr"><div class="l1-info"><div class="l1-name">${e(l1.name)}${aiBadge}</div><div class="l1-why">${e(l1.why||'')}</div></div><div class="l1-cap-actions"><button class="l1-cap-edit" onclick="event.stopPropagation();editCapability(${idx},${li})" title="Edit capability"><i class="ti ti-pencil" style="font-size:10px;" aria-hidden="true"></i></button><button class="l1-cap-remove" onclick="event.stopPropagation();deleteCapability(${idx},${li})" title="Delete capability"><i class="ti ti-x" style="font-size:10px;" aria-hidden="true"></i></button></div></div></div>`;
      });
    } else {
      l1list.forEach((l1,li)=>{
        if(!l1||!l1.name)return;
        const lid=`l1-${st.id}-${li}`;
        const l1MetKey=st.id+'||'+l1.name;h+=`<div class="l1" id="${lid}" onclick="tog('${lid}')"><div class="l1-hdr"><div class="l1-info"><div class="l1-name">${e(l1.name)}</div><div class="l1-why">${e(l1.why||'')}</div></div><div class="exp">+</div></div><div class="l1-trigger-row"><button class="cap-trigger cap-trigger-dd" onclick="event.stopPropagation();ccOpenDDPanel('${e(l1MetKey)}','${e(l1.name)}','${e(stLabel)}')">Dictionary &#8594;</button><button class="cap-trigger cap-trigger-ev" onclick="event.stopPropagation();kpiOpenEvidenceDrawer('${e(l1.name)}','${e(l1.name)}','${e(stLabel)}','L1')">Evidence &#8594;</button></div><div class="l1-kids">`;
        (l1.l2_metrics||[]).forEach((l2,l2i)=>{
          if(!l2||!l2.name)return;
          const l2id=`l2-${st.id}-${li}-${l2i}`;
          h+=`<div class="l2" id="${l2id}" onclick="event.stopPropagation();tog('${l2id}')"><div class="l2-name">${e(l2.name)}</div><div class="l2-why">${e(l2.why||'')}</div><button class="cap-trigger cap-trigger-ev cap-trigger-sm" onclick="event.stopPropagation();kpiOpenEvidenceDrawer('${e(l2.name)}','${e(l2.name)}','${e(stLabel)}','L2')">Evidence &#8594;</button><div class="l2-kids">`;
          (l2.l3_metrics||[]).forEach((l3,l3i)=>{
            if(!l3||!l3.name)return;
            const l3id=`l3-${st.id}-${li}-${l2i}-${l3i}`;
            const hasL4=l3.l4_metrics&&l3.l4_metrics.length>0;
            h+=`<div class="l3${hasL4?' has-l4':''}" id="${l3id}" ${hasL4?`onclick="event.stopPropagation();tog('${l3id}')"`:''}>`;
            h+=`<div class="l3-name">${e(l3.name)}${hasL4?`<span class="l3-cnt">(+${l3.l4_metrics.length})</span>`:''}</div>`;
            if(hasL4)h+=`<div class="l3-kids">${l3.l4_metrics.map(l4=>`<span class="l4-chip">${e(l4)}</span>`).join('')}</div>`;
            h+=`<button class="cap-trigger cap-trigger-ev cap-trigger-xs" onclick="event.stopPropagation();kpiOpenEvidenceDrawer('${e(l3.name)}','${e(l3.name)}','${e(stLabel)}','L3')">Evidence &#8594;</button>`;
            h+=`</div>`;
          });
          h+=`</div></div>`;
        });
        h+=`</div></div>`;
      });
    }
    h+=`</div>`;
  });
  h+=`</div>`;
  c.innerHTML=h;
}

function tog(id){const el=document.getElementById(id);if(el)el.classList.toggle('open');}

// ── Stage scope warning dismiss ──
function dismissScopeWarn(idx){
  if(!gData||!gData.stages[idx])return;
  delete gData.stages[idx]._scopeWarning;
  renderMM(gData);
}

// ── Stage delete cascade helpers ──
function stageGetAffectedFeatures(stageLabel){
  return (scCanvas||[]).filter(f=>f.stage===stageLabel&&f.origin!=='market'&&f.origin!=='pi');
}
function stageGetAffectedStoryCount(features){
  return features.reduce((sum,f)=>sum+(f.stories&&f.stories.length?f.stories.length:0),0);
}
function stageGetAffectedEvidenceCount(stageLabel){
  if(!diagnosticSessions||!diagnosticSessions.length)return 0;
  const session=diagnosticSessions.find(s=>s.id===activeDiagnosticId);
  if(!session||!session.tree)return 0;
  const st=session.tree.stages.find(s=>(s.label||s.id)===stageLabel);
  if(!st)return 0;
  let count=0;
  (st.l1_metrics||[]).forEach(l1=>{
    const ev=l1.evidence;
    if(ev&&(ev.currentValue||ev.previousValue||ev.targetBenchmark||ev.trend||ev.notes||ev.instrumentationStatus))count++;
    (l1.l2_metrics||[]).forEach(l2=>{
      const ev2=l2.evidence;
      if(ev2&&(ev2.currentValue||ev2.previousValue||ev2.targetBenchmark||ev2.trend||ev2.notes||ev2.instrumentationStatus))count++;
      (l2.l3_metrics||[]).forEach(l3=>{
        const ev3=l3.evidence;
        if(ev3&&(ev3.currentValue||ev3.previousValue||ev3.targetBenchmark||ev3.trend||ev3.notes||ev3.instrumentationStatus))count++;
      });
    });
  });
  return count;
}

function stageExecuteCascade(stageLabel){
  // 1. Strip capStore keys for this stage
  Object.keys(capStore).forEach(k=>{if(k.includes('||'+stageLabel))delete capStore[k];});
  // 2. Merge evidence (discards this stage's metrics) if session exists
  const session=diagnosticSessions&&diagnosticSessions.find(s=>s.id===activeDiagnosticId);
  if(session)dvMergeEvidenceOnRegen(session,gData);
  // 3. Clear analysis if it exists
  if(productLeakAnalysis)laClearAnalysis();
  // 4. Purge Story Canvas features for this stage
  scPurgeStage(stageLabel);
  // 5. If on dv/la tab, switch back to mm
  if(curTab==='dv'||curTab==='la')switchTab('mm');
}

// ── Stage delete ──
function deleteStage(idx){
  if(!gData||!gData.stages[idx])return;
  const st=gData.stages[idx];
  const stageLabel=st.label||st.id;
  const affected=stageGetAffectedFeatures(stageLabel);
  const storyCount=stageGetAffectedStoryCount(affected);
  const evidenceCount=stageGetAffectedEvidenceCount(stageLabel);
  const hasAnalysis=!!(productLeakAnalysis&&productLeakAnalysis.length>0);

  // Build consequence list HTML
  let conseqItems='';
  if(affected.length>0)conseqItems+=`<li>${affected.length} feature${affected.length!==1?'s':''} on Feature Canvas linked to this stage will be removed</li>`;
  if(storyCount>0)conseqItems+=`<li class="warn">&#9888; ${storyCount} generated stor${storyCount===1?'y':'ies'} across those features will be permanently lost</li>`;
  if(evidenceCount>0)conseqItems+=`<li>Evidence entered for ${evidenceCount} metric${evidenceCount!==1?'s':''} in this stage will be discarded</li>`;
  if(hasAnalysis)conseqItems+=`<li>Product Diagnostics will be cleared and must be re-run</li>`;

  const conseqHTML=conseqItems?`<div class="stage-del-consequence"><div class="stage-del-consequence-title">What will be affected</div><ul>${conseqItems}</ul><div class="stage-del-consequence-note">This cannot be undone.</div></div>`:'<p style="font-size:11px;color:var(--t3);margin:0 0 16px;">No downstream data linked to this stage. Safe to delete.</p>';

  // Render modal
  const existing=document.getElementById('stage-modal-overlay');
  if(existing)existing.remove();
  const overlay=document.createElement('div');
  overlay.id='stage-modal-overlay';
  overlay.className='stage-modal-overlay';
  overlay.innerHTML=`<div class="stage-modal">
    <div class="stage-modal-head">
      <div class="stage-modal-title">Delete &ldquo;${e(stageLabel)}&rdquo;?</div>
      <button class="stage-modal-close" onclick="document.getElementById('stage-modal-overlay').remove()">&times;</button>
    </div>
    <div class="stage-modal-body">
      ${conseqHTML}
    </div>
    <div class="stage-modal-footer">
      <button class="stage-modal-cancel" onclick="document.getElementById('stage-modal-overlay').remove()">Cancel</button>
      <button class="stage-modal-save destructive" onclick="confirmDeleteStage(${idx},'${stageLabel.replace(/'/g,"\\'")}')">Delete stage</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',function(ev){if(ev.target===overlay)overlay.remove();});
}

function confirmDeleteStage(idx,stageLabel){
  document.getElementById('stage-modal-overlay').remove();
  if(!gData||!gData.stages[idx])return;
  gData.stages.splice(idx,1);
  stageExecuteCascade(stageLabel);
  renderMM(gData);
  renderDiagnosticActionBar();
  stageShowToast('Stage deleted. Downstream data updated.');
}

// ── Stage edit ──
function editStage(idx){
  if(!gData||!gData.stages[idx])return;
  const st=gData.stages[idx];
  const stageLabel=st.label||st.id;
  const stageDesc=st.description||'';
  const affected=stageGetAffectedFeatures(stageLabel);
  const storyCount=stageGetAffectedStoryCount(affected);
  const evidenceCount=stageGetAffectedEvidenceCount(stageLabel);
  const hasAnalysis=!!(productLeakAnalysis&&productLeakAnalysis.length>0);
  const hasDownstream=affected.length>0||evidenceCount>0||hasAnalysis;

  const _isCapMode=gData.approach==='capability-based';
  const _entityWord=_isCapMode?'capabilities':'metrics';
  const disabledNote=!hasDownstream?'<div class="stage-modal-radio-disabled-note">Options 2 &amp; 3 unlock once this stage has features, evidence, or diagnostics</div>':'';

  const existing=document.getElementById('stage-modal-overlay');
  if(existing)existing.remove();
  const overlay=document.createElement('div');
  overlay.id='stage-modal-overlay';
  overlay.className='stage-modal-overlay';
  overlay.innerHTML=`<div class="stage-modal">
    <div class="stage-modal-head">
      <div class="stage-modal-title">Edit Stage</div>
      <button class="stage-modal-close" onclick="document.getElementById('stage-modal-overlay').remove()">&times;</button>
    </div>
    <div class="stage-modal-body">
      <div class="stage-modal-field">
        <label>Stage name</label>
        <input type="text" id="edit-stage-name" value="${e(stageLabel)}" maxlength="60" oninput="editStageValidate()"/>
      </div>
      <div class="stage-modal-field">
        <label>Description <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>
        <textarea id="edit-stage-desc" rows="2" maxlength="200" oninput="editStageValidate()">${e(stageDesc)}</textarea>
      </div>
      <hr class="stage-modal-divider"/>
      <div class="stage-modal-radio-label">What kind of change is this?</div>
      <div class="stage-modal-radio-group" id="edit-stage-radio-group">
        <label class="stage-modal-radio-item" id="edit-radio-item-1">
          <input type="radio" name="edit-stage-type" value="label" onchange="editStageRadioChange()" />
          <div class="stage-modal-radio-text">
            <span class="stage-modal-radio-title">Label or description only</span>
            <span class="stage-modal-radio-sub">Terminology correction — no impact to ${_entityWord} or downstream work</span>
          </div>
        </label>
        <label class="stage-modal-radio-item${!hasDownstream?' disabled':''}" id="edit-radio-item-2">
          <input type="radio" name="edit-stage-type" value="scope-shift" onchange="editStageRadioChange()" ${!hasDownstream?'disabled':''}/>
          <div class="stage-modal-radio-text">
            <span class="stage-modal-radio-title">Scope has shifted — keep my work</span>
            <span class="stage-modal-radio-sub">Stage concept changed but existing ${_entityWord} and evidence still apply</span>
          </div>
        </label>
        <label class="stage-modal-radio-item${!hasDownstream?' disabled':''}" id="edit-radio-item-3">
          <input type="radio" name="edit-stage-type" value="scope-reset" onchange="editStageRadioChange()" ${!hasDownstream?'disabled':''}/>
          <div class="stage-modal-radio-text">
            <span class="stage-modal-radio-title">Scope has changed — reset this stage</span>
            <span class="stage-modal-radio-sub">${_isCapMode?'Capabilities':'Metrics'}, evidence, and stories from this stage will be cleared</span>
          </div>
        </label>
      </div>
      ${disabledNote}
      <div id="edit-stage-consequence" style="display:none;"></div>
    </div>
    <div class="stage-modal-footer">
      <button class="stage-modal-cancel" onclick="document.getElementById('stage-modal-overlay').remove()">Cancel</button>
      <button class="stage-modal-save" id="edit-stage-save" disabled onclick="confirmEditStage(${idx},'${stageLabel.replace(/'/g,"\\'")}')">Save changes</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',function(ev){if(ev.target===overlay)overlay.remove();});

  // Store downstream counts for consequence block
  overlay._affected=affected;
  overlay._storyCount=storyCount;
  overlay._evidenceCount=evidenceCount;
  overlay._hasAnalysis=hasAnalysis;
}

function editStageValidate(){
  const nameEl=document.getElementById('edit-stage-name');
  const saveBtn=document.getElementById('edit-stage-save');
  const radio=document.querySelector('input[name="edit-stage-type"]:checked');
  if(!nameEl||!saveBtn)return;
  const hasChange=nameEl.value.trim().length>0;
  const hasRadio=!!radio;
  saveBtn.disabled=!(hasChange&&hasRadio);
}

function editStageRadioChange(){
  editStageValidate();
  const radio=document.querySelector('input[name="edit-stage-type"]:checked');
  if(!radio)return;
  // Update selected styling
  document.querySelectorAll('.stage-modal-radio-item').forEach(el=>el.classList.remove('selected'));
  const checked=document.querySelector('input[name="edit-stage-type"]:checked');
  if(checked)checked.closest('.stage-modal-radio-item').classList.add('selected');
  // Update save button label and style
  const saveBtn=document.getElementById('edit-stage-save');
  if(radio.value==='scope-reset'){
    if(saveBtn){saveBtn.textContent='Save & Reset';saveBtn.classList.add('destructive');}
    // Show consequence block
    const overlay=document.getElementById('stage-modal-overlay');
    const affected=overlay._affected||[];
    const storyCount=overlay._storyCount||0;
    const evidenceCount=overlay._evidenceCount||0;
    const hasAnalysis=overlay._hasAnalysis||false;
    let items='';
    if(affected.length>0)items+=`<li>${affected.length} feature${affected.length!==1?'s':''} on Feature Canvas will be removed</li>`;
    if(storyCount>0)items+=`<li class="warn">&#9888; ${storyCount} generated stor${storyCount===1?'y':'ies'} will be permanently lost</li>`;
    if(evidenceCount>0)items+=`<li>Evidence for ${evidenceCount} metric${evidenceCount!==1?'s':''} in this stage will be discarded</li>`;
    if(hasAnalysis)items+=`<li>Product Diagnostics will be cleared and must be re-run</li>`;
    const conseq=document.getElementById('edit-stage-consequence');
    if(conseq){
      conseq.innerHTML=`<div class="stage-modal-consequence" style="margin-top:12px;"><div class="stage-modal-consequence-title"><i class="ti ti-alert-triangle" aria-hidden="true"></i> What will be affected</div><ul>${items}</ul><div class="stage-modal-consequence-note">This cannot be undone.</div></div>`;
      conseq.style.display='block';
    }
  }else{
    if(saveBtn){saveBtn.textContent='Save changes';saveBtn.classList.remove('destructive');}
    const conseq=document.getElementById('edit-stage-consequence');
    if(conseq)conseq.style.display='none';
  }
}

function confirmEditStage(idx,oldLabel){
  const nameEl=document.getElementById('edit-stage-name');
  const descEl=document.getElementById('edit-stage-desc');
  const radio=document.querySelector('input[name="edit-stage-type"]:checked');
  if(!nameEl||!radio||!gData||!gData.stages[idx])return;
  const newLabel=nameEl.value.trim();
  const newDesc=descEl?descEl.value.trim():'';
  const choice=radio.value;
  document.getElementById('stage-modal-overlay').remove();

  // Update gData
  gData.stages[idx].label=newLabel;
  gData.stages[idx].description=newDesc;

  if(choice==='label'){
    // Case A: rename only
    stageRenameDownstream(oldLabel,newLabel);
    renderMM(gData);
    renderDiagnosticActionBar();
    if(typeof newScRender==='function')newScRender();
    if(typeof fcRenderCanvas==='function')fcRenderCanvas();
    stageShowToast('Stage renamed. No downstream changes made.');
  } else if(choice==='scope-shift'){
    // Case B: rename + scope warning
    stageRenameDownstream(oldLabel,newLabel);
    gData.stages[idx]._scopeWarning=true;
    renderMM(gData);
    renderDiagnosticActionBar();
    if(typeof newScRender==='function')newScRender();
    if(typeof fcRenderCanvas==='function')fcRenderCanvas();
    // Toast if on dv or sc tab
    stageShowToast('Stage updated. Scope warning added — review metrics for relevance.');
  } else if(choice==='scope-reset'){
    // Case C: rename + full cascade on OLD label first (before rename propagated)
    stageExecuteCascade(oldLabel);
    // Now rename in gData (already done above) — propagate new name downstream (canvas is clear for this stage)
    renderMM(gData);
    renderDiagnosticActionBar();
    if(typeof newScRender==='function')newScRender();
    if(typeof fcRenderCanvas==='function')fcRenderCanvas();
    stageShowToast('Stage reset. Downstream data for this stage has been cleared.');
  }
}

function stageRenameDownstream(oldLabel,newLabel){
  // 1. Re-key capStore
  Object.keys(capStore).forEach(k=>{
    if(k.includes('||'+oldLabel)){
      const newKey=k.replace('||'+oldLabel,'||'+newLabel);
      capStore[newKey]=capStore[k];
      delete capStore[k];
    }
  });
  // 2. Patch session.tree stage label
  const session=diagnosticSessions&&diagnosticSessions.find(s=>s.id===activeDiagnosticId);
  if(session&&session.tree){
    const st=session.tree.stages.find(s=>(s.label||s.id)===oldLabel);
    if(st)st.label=newLabel;
  }
  // 3. String-patch productLeakAnalysis — iterate all runs
  if(productLeakAnalysis&&productLeakAnalysis.length>0){
    productLeakAnalysis.forEach(function(run){
      if(run.leakingStage===oldLabel)run.leakingStage=newLabel;
      (run.experiments||[]).forEach(function(exp){
        if(exp.lifecycleStage===oldLabel)exp.lifecycleStage=newLabel;
      });
    });
  }
  // 4. Patch scCanvas stage references
  (scCanvas||[]).forEach(f=>{if(f.stage===oldLabel)f.stage=newLabel;});
}

function stageShowToast(msg){
  const existing=document.getElementById('stage-op-toast');
  if(existing)existing.remove();
  const toast=document.createElement('div');
  toast.id='stage-op-toast';
  toast.className='dv-merge-toast';
  toast.textContent=msg;
  document.body.appendChild(toast);
  setTimeout(()=>toast.classList.add('on'),50);
  setTimeout(()=>{toast.classList.remove('on');setTimeout(()=>toast.remove(),400);},4000);
}

// ── Capability-level edit/delete (Discovery Map, Capability-Based mode only) ──
// Modal edit/delete pattern mirrors stage edit/delete above.
function capGetAffectedFeatures(metricKey){
  const capEntry=capStore[metricKey];
  if(!capEntry)return[];
  let feats=[];
  (capEntry.capabilities||[]).forEach(cap=>{
    const fs=cap.featStore;
    if(!fs)return;
    Object.keys(fs).forEach(k=>{
      if(Array.isArray(fs[k]))feats=feats.concat(fs[k]);
    });
  });
  return feats;
}
function capGetAffectedStoryCount(features){
  return features.reduce((sum,f)=>sum+(f.stories&&f.stories.length?f.stories.length:0),0);
}
function capExecuteCascade(metricKey,capName,stageLabel){
  // 1. Delete the capStore entry for this capability
  delete capStore[metricKey];
  // 2. Purge matching scCanvas entries (features sent to Story/Feature Canvas from this capability)
  scCanvas=(scCanvas||[]).filter(f=>!(f.cap===capName&&f.stage===stageLabel));
}

function editCapability(stIdx,li){
  if(!gData||!gData.stages[stIdx]||!gData.stages[stIdx].l1_metrics||!gData.stages[stIdx].l1_metrics[li])return;
  const st=gData.stages[stIdx];
  const l1=st.l1_metrics[li];
  const stageLabel=st.label||st.id;
  const capName=l1.name;
  const capDesc=l1.why||'';
  const metricKey=st.id+'||'+capName;
  const affected=capGetAffectedFeatures(metricKey);
  const storyCount=capGetAffectedStoryCount(affected);
  const hasDownstream=affected.length>0;

  const existing=document.getElementById('cap-edit-modal-overlay');
  if(existing)existing.remove();
  const overlay=document.createElement('div');
  overlay.id='cap-edit-modal-overlay';
  overlay.className='stage-modal-overlay';
  overlay.innerHTML=`<div class="stage-modal">
    <div class="stage-modal-head">
      <div class="stage-modal-title">Edit Capability</div>
      <button class="stage-modal-close" onclick="document.getElementById('cap-edit-modal-overlay').remove()">&times;</button>
    </div>
    <div class="stage-modal-body">
      <div class="stage-modal-field">
        <label>Capability name</label>
        <input type="text" id="edit-cap-name" value="${e(capName)}" maxlength="80" oninput="editCapabilityValidate()"/>
      </div>
      <div class="stage-modal-field">
        <label>Description <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>
        <textarea id="edit-cap-desc" rows="2" maxlength="200" oninput="editCapabilityValidate()">${e(capDesc)}</textarea>
      </div>
      ${hasDownstream?`<div class="stage-modal-radio-disabled-note">This capability has ${affected.length} feature${affected.length!==1?'s':''}${storyCount>0?' and '+storyCount+' stor'+(storyCount===1?'y':'ies'):''} generated. Renaming will keep them linked.</div>`:''}
    </div>
    <div class="stage-modal-footer">
      <button class="stage-modal-cancel" onclick="document.getElementById('cap-edit-modal-overlay').remove()">Cancel</button>
      <button class="stage-modal-save" id="edit-cap-save" onclick="confirmEditCapability(${stIdx},${li})">Save changes</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',function(ev){if(ev.target===overlay)overlay.remove();});
  const _escHandler=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_escHandler,true);}};
  document.addEventListener('keydown',_escHandler,true);
  trapFocus(overlay);
}

function editCapabilityValidate(){
  const nameEl=document.getElementById('edit-cap-name');
  const saveBtn=document.getElementById('edit-cap-save');
  if(!nameEl||!saveBtn)return;
  saveBtn.disabled=nameEl.value.trim().length===0;
}

function confirmEditCapability(stIdx,li){
  const nameEl=document.getElementById('edit-cap-name');
  const descEl=document.getElementById('edit-cap-desc');
  if(!nameEl||!gData||!gData.stages[stIdx]||!gData.stages[stIdx].l1_metrics[li])return;
  const st=gData.stages[stIdx];
  const l1=st.l1_metrics[li];
  const stageLabel=st.label||st.id;
  const oldName=l1.name;
  const newName=nameEl.value.trim();
  const newDesc=descEl?descEl.value.trim():'';
  document.getElementById('cap-edit-modal-overlay').remove();

  l1.name=newName;
  l1.why=newDesc;

  if(newName!==oldName)capRenameDownstream(oldName,newName,st.id,stageLabel);

  renderMM(gData);
  stageShowToast('Capability updated.');
}

// Re-keys capStore and patches scCanvas — mirrors stageRenameDownstream() for the
// capability-level rename case (found missing in pre-build stress test).
// capStore keys use stageId (per PROJECT_MAP.md format); scCanvas.stage holds the
// display label, so both are needed — conflating them was the root cause of a
// bug where affected-features lookups always returned empty.
function capRenameDownstream(oldName,newName,stageId,stageLabel){
  const oldKey=stageId+'||'+oldName;
  const newKey=stageId+'||'+newName;
  if(capStore[oldKey]){
    capStore[newKey]=capStore[oldKey];
    delete capStore[oldKey];
  }
  (scCanvas||[]).forEach(f=>{if(f.cap===oldName&&f.stage===stageLabel)f.cap=newName;});
}

function deleteCapability(stIdx,li){
  if(!gData||!gData.stages[stIdx]||!gData.stages[stIdx].l1_metrics||!gData.stages[stIdx].l1_metrics[li])return;
  const st=gData.stages[stIdx];
  const l1=st.l1_metrics[li];
  const stageLabel=st.label||st.id;
  const capName=l1.name;
  const metricKey=st.id+'||'+capName;
  const affected=capGetAffectedFeatures(metricKey);
  const storyCount=capGetAffectedStoryCount(affected);

  if(affected.length===0){
    // No downstream data — instant delete, no modal
    st.l1_metrics.splice(li,1);
    renderMM(gData);
    stageShowToast('Capability deleted.');
    return;
  }

  // Downstream data exists — consequence modal
  let conseqItems=`<li>${affected.length} feature${affected.length!==1?'s':''} on Feature Canvas will be removed</li>`;
  if(storyCount>0)conseqItems+=`<li class="warn">&#9888; ${storyCount} generated stor${storyCount===1?'y':'ies'} will be permanently lost</li>`;
  const conseqHTML=`<div class="stage-del-consequence"><div class="stage-del-consequence-title">What will be affected</div><ul>${conseqItems}</ul><div class="stage-del-consequence-note">This cannot be undone.</div></div>`;

  const existing=document.getElementById('cap-del-modal-overlay');
  if(existing)existing.remove();
  const overlay=document.createElement('div');
  overlay.id='cap-del-modal-overlay';
  overlay.className='stage-modal-overlay';
  overlay.innerHTML=`<div class="stage-modal">
    <div class="stage-modal-head">
      <div class="stage-modal-title">Delete &ldquo;${e(capName)}&rdquo;?</div>
      <button class="stage-modal-close" onclick="document.getElementById('cap-del-modal-overlay').remove()">&times;</button>
    </div>
    <div class="stage-modal-body">
      ${conseqHTML}
    </div>
    <div class="stage-modal-footer">
      <button class="stage-modal-cancel" onclick="document.getElementById('cap-del-modal-overlay').remove()">Cancel</button>
      <button class="stage-modal-save destructive" onclick="confirmDeleteCapability(${stIdx},${li})">Delete capability</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',function(ev){if(ev.target===overlay)overlay.remove();});
}

function confirmDeleteCapability(stIdx,li){
  document.getElementById('cap-del-modal-overlay').remove();
  if(!gData||!gData.stages[stIdx]||!gData.stages[stIdx].l1_metrics[li])return;
  const st=gData.stages[stIdx];
  const l1=st.l1_metrics[li];
  const stageLabel=st.label||st.id;
  const capName=l1.name;
  const metricKey=st.id+'||'+capName;
  capExecuteCascade(metricKey,capName,stageLabel);
  st.l1_metrics.splice(li,1);
  renderMM(gData);
  fcRenderCanvas();
  stageShowToast('Capability deleted. Downstream data updated.');
}

// ── Evidence drawer entry point from KPI tree ──
function kpiOpenEvidenceDrawer(metricName, displayName, stageName, level){
  if(!gData){showToast('Generate a KPI tree first.','info');return;}
  // Create diagnostic session on first use if it doesn't exist
  if(diagnosticSessions.length===0){
    const session={
      id:'diag-01',
      name:'Diagnostic 01',
      tree:dvDeepCloneTree(gData),
      readiness:null
    };
    diagnosticSessions=[session];
    activeDiagnosticId='diag-01';
  }
  // Resolve _dvId from metric name — dvFindMetricById requires _dvId, not name
  const session=diagnosticSessions.find(s=>s.id===activeDiagnosticId);
  if(!session)return;
  const allMetrics=dvFlattenMetrics(session.tree);
  const found=allMetrics.find(m=>m.name===metricName);
  if(!found){showToast('Metric not found in diagnostic session.','warn');return;}
  dvOpenEvidenceDrawer(found.id, displayName, stageName, level);
}

// ── Update Run Diagnostics button state ──
// Disabled if: no evidence at all, OR evidence exists but nothing changed since last run.
// Enabled if: evidence exists AND (no prior runs OR something changed).
function kpiUpdateRunDiagnosticsBtn(){
  const btn=document.getElementById('diag-run-btn');
  const rerunLink=document.getElementById('diag-rerun-link');
  if(!btn)return;
  const session=diagnosticSessions.find(s=>s.id===activeDiagnosticId);
  if(!session){btn.disabled=true;if(rerunLink)rerunLink.style.display='none';return;}
  const readiness=dvCalcReadiness(session);
  if(readiness.metricsWithEvidence===0){
    btn.disabled=true;
    btn.title='Add evidence to a metric first';
    if(rerunLink)rerunLink.style.display='none';
    return;
  }
  // Check if evidence changed since last run
  const noPriorRuns=!productLeakAnalysis||productLeakAnalysis.length===0;
  if(noPriorRuns){
    btn.disabled=false;
    btn.title='';
    if(rerunLink)rerunLink.style.display='none';
    return;
  }
  // Build current evidence snapshot and diff
  var hasChanged=false;
  if(typeof _dvBuildEvidenceSnapshot==='function'&&typeof _dvDiffEvidence==='function'){
    const stagesWithEvidence=(session.tree.stages||[]).map(function(st){return{
      stage:st.label||st.id,
      l1_metrics:(st.l1_metrics||[]).map(function(l1){return{
        name:l1.name,evidence:l1.evidence||null,
        evidenceStrength:typeof dvCalcEvidenceStrength==='function'?dvCalcEvidenceStrength(l1.evidence):'No evidence'
      };})
    };});
    const snap=_dvBuildEvidenceSnapshot(stagesWithEvidence);
    const changed=_dvDiffEvidence(snap);
    hasChanged=changed.length>0;
  } else {
    hasChanged=true; // fallback: always enable if diff functions not available
  }
  if(hasChanged){
    btn.disabled=false;
    btn.title='';
    if(rerunLink)rerunLink.style.display='none';
  } else {
    btn.disabled=true;
    btn.title='No new evidence since last run';
    if(rerunLink)rerunLink.style.display='';
  }
}

// ── Reflect evidence state on KPI tree metric nodes after save ──
function kpiRenderEvidenceStates(){
  const session=diagnosticSessions.find(s=>s.id===activeDiagnosticId);
  if(!session)return;
  const allMetrics=dvFlattenMetrics(session.tree);
  allMetrics.forEach(m=>{
    const evStr=dvCalcEvidenceStrength(m.evidence);
    const hasEvidence=evStr!=='No evidence';
    const dotCls=dvEvidenceDotClass(evStr);
    // Find Evidence buttons for this metric by scanning trigger rows
    document.querySelectorAll('.cap-trigger-ev').forEach(btn=>{
      const parent=btn.closest('.l1,.l2,.l3');
      if(!parent)return;
      const nameEl=parent.querySelector('.l1-name,.l2-name,.l3-name');
      if(!nameEl)return;
      // Get clean metric name — first text node only
      const firstText=Array.from(nameEl.childNodes).find(n=>n.nodeType===3);
      const nameTxt=firstText?firstText.textContent.trim():'';
      if(nameTxt!==m.name)return;
      // 1. Update dot in name element
      const existingDot=nameEl.querySelector('.kpi-ev-dot');
      if(existingDot)existingDot.remove();
      if(hasEvidence){
        const dot=document.createElement('span');
        dot.className=`kpi-ev-dot dv-ev-dot ${dotCls}`;
        dot.title=evStr;
        nameEl.appendChild(dot);
      }
      // 2. Update current value line below name
      const infoEl=parent.querySelector('.l1-info') || nameEl.parentElement;
      let valEl=infoEl.querySelector('.kpi-ev-val');
      if(hasEvidence&&m.evidence){
        const val=m.evidence.currentValue||'';
        const trend=m.evidence.trend||'';
        const notes=m.evidence.notes||'';
        let display=val?(val+(trend?' · '+trend:'')):(notes?notes.substring(0,40)+(notes.length>40?'…':''):'');
        if(display){
          if(!valEl){valEl=document.createElement('div');valEl.className='kpi-ev-val dv-current-val';infoEl.insertBefore(valEl,infoEl.querySelector('.l1-why,.l2-why')||null);}
          valEl.textContent=display;
        }
      } else {
        if(valEl)valEl.remove();
      }
      // 3. Update CTA label
      btn.innerHTML=hasEvidence?'Edit evidence &#8594;':'Evidence &#8594;';
      btn.classList.toggle('cap-trigger-ev-done',hasEvidence);
    });
  });
  // Always apply diff-aware CTA state last (v8.42)
  if(typeof kpiUpdateRunDiagnosticsBtn==='function')kpiUpdateRunDiagnosticsBtn();
}
