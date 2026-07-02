let panelOpen=true;
function toggleSettings(){
  // Delegates to settings page open/close
  if(typeof openSettingsPage==='function') openSettingsPage();
}
function saveSettings(){
  // Delegates to settings page save — kept for any legacy callers
  if(typeof settingsPageSave==='function') settingsPageSave();
}
function applyFeats(){
  // Read from appSettings (single source of truth) instead of fly-out DOM checkboxes
  featDD   = appSettings.featDD;
  featCap  = true;
  featDiag = appSettings.featDiag;
  featMI   = appSettings.featMI;
  featPI   = appSettings.featPI;

  // #tab-dd retired — no longer a tab. DD is download-only panel triggered from KPI tree.
  document.querySelectorAll('.cap-trigger').forEach(function(b){b.style.display='';});
  // Story Canvas: reveal only when features exist — never force-show on settings save
  if(scCanvas&&scCanvas.length>0){
    const scTabEl=document.getElementById('tab-sc');
    if(scTabEl)scTabEl.classList.add('revealed');
  }
  document.querySelectorAll('.feat-item-check').forEach(function(c){c.style.display='';});
  const capFooter=document.getElementById('cap-drawer-footer');
  if(capFooter)capFooter.style.display=scCanvas.length===0?'none':'flex';
  // Diagnostic: hide/show CTA bar and leak tab
  const diagBar=document.getElementById('diag-action-bar');
  // Guard: only show diag bar when on mm tab — Settings save must not stomp other tabs
  if(diagBar)diagBar.style.display=(featDiag&&curTab==='mm')?'':'none';
  const laTabEl=document.getElementById('tab-la');
  // Only hide tab if it was revealed — if hidden by default, leave as-is
  if(!featDiag){
    if(laTabEl&&laTabEl.style.display!=='none')laTabEl.style.display='none';
    if(curTab==='la')switchTab('mm');
  }
  // Reveal PD tab only when a diagnostic run actually exists (length>0, not bare truthy)
  if(featDiag&&productLeakAnalysis&&productLeakAnalysis.length>0){
    if(laTabEl)laTabEl.style.display='';
  }
  // Restore bottom bar CTA if on mm tab, KPI tree exists, and bar isn't already there
  if(featDiag&&gData&&curTab==='mm'&&!document.getElementById('diag-action-bar')){
    renderDiagnosticActionBar();
  }
  // Market Intelligence: hide/show tab and mi-gated elements
  document.querySelectorAll('.mi-gated').forEach(function(el){
    el.style.display=featMI?'':'none';
  });
  if(!featMI){
    const miTabEl=document.getElementById('tab-mi');
    if(miTabEl)miTabEl.style.display='none';
    if(curTab==='mi')switchTab('mm');
  }
  // PI Planning: hide tab if disabled, show if enabled and piPlan exists
  const piTabEl=document.getElementById('tab-pi');
  if(piTabEl){
    if(!featPI){
      piTabEl.classList.remove('revealed');
      if(curTab==='pi')switchTab('mm');
    } else if(typeof piPlan!=='undefined'&&piPlan){
      piTabEl.classList.add('revealed');
    }
  }
}
function updateFeatLock(){
  // Retired in v6.75 — fly-out panel DOM IDs (feat-locked, feat-toggles) no longer exist.
  // Settings page handles key status inline. Shell kept to avoid errors from any call sites.
}
function togglePanel(){
  panelOpen=!panelOpen;
  document.getElementById('left-panel').classList.toggle('collapsed',!panelOpen);
  document.getElementById('icon-exp').style.display=panelOpen?'block':'none';
  document.getElementById('icon-col').style.display=panelOpen?'none':'block';
}

// ── Seg controls wiring ──
function initSegControls(){
  // Product Type segmented control
  const ptSeg=document.getElementById('seg-producttype');
  if(ptSeg){
    ptSeg.querySelectorAll('.seg-btn').forEach(btn=>{
      btn.addEventListener('click',function(){
        ptSeg.querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        seg.productType=this.dataset.v;
      });
    });
  }
  // Industry Vertical dropdown
  const indSel=document.getElementById('f-industry');
  if(indSel){
    indSel.addEventListener('change',function(){
      seg.industry=this.value;
    });
    seg.industry=indSel.value||'Technology & Software';
  }
  // Additional Context character counter
  const ctxArea=document.getElementById('f-context');
  const ctxCounter=document.getElementById('f-context-counter');
  if(ctxArea&&ctxCounter){
    const MAX=2000;
    const WARN=1600;
    ctxArea.addEventListener('input',function(){
      const len=this.value.length;
      if(len>MAX){this.value=this.value.substring(0,MAX);return;}
      ctxCounter.textContent=len+'/'+MAX;
      ctxCounter.className='ctx-counter'+(len>=MAX?' ctx-counter-red':len>=WARN?' ctx-counter-amber':'');
    });
  }
  // Custom Value Chain character counter
  const vcArea=document.getElementById('f-custom-vc');
  const vcCounter=document.getElementById('f-vc-counter');
  if(vcArea&&vcCounter){
    const MAX=2000;
    const WARN=1600;
    vcArea.addEventListener('input',function(){
      const len=this.value.length;
      if(len>MAX){this.value=this.value.substring(0,MAX);return;}
      vcCounter.textContent=len+'/'+MAX;
      vcCounter.className='ctx-counter'+(len>=MAX?' ctx-counter-red':len>=WARN?' ctx-counter-amber':'');
    });
  }
}

