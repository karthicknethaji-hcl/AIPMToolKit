// PI PLANNING — pi-planning.js
// Owns: piOnTabEnter, sprint board render, squad builder, drag-drop,
//       right panel, dependency management, piGenerate, piRegenerate

// ── Tab entry ──
function piOnTabEnter(){
  piCheckStaleness();
  piRenderLeftPanel();
  // v9.01.01 fix: was a bare `piPlan` truthiness check -- true even for a
  // minimal, backlog-only piPlan (no sprints yet), which would have routed
  // into piRenderBoard() and crashed on an unguarded piPlan.sprints.forEach.
  // Now correctly distinguishes "a real plan was generated" from "only a
  // backlog is staged" -- the latter correctly shows the empty/backlog
  // state instead, which already renders the staged-story tray correctly.
  if(typeof piPlan!=='undefined'&&piPlan&&Array.isArray(piPlan.sprints)&&piPlan.sprints.length>0){
    piRenderBoard();
  } else {
    piRenderEmpty();
  }
}

function piCheckStaleness(){
  if(!piPlan)return;
  const currentHash=piComputeHash();
  if(piScVersion&&currentHash!==piScVersion){
    piShowStaleBanner();
  } else {
    piHideStaleBanner();
  }
}

function piComputeHash(){
  // Hash submitted feature IDs + story counts so stale only fires when submitted features change
  if(piPlan&&piPlan.submittedFeatureIds&&piPlan.submittedFeatureIds.length){
    return piPlan.submittedFeatureIds.map(fid=>{
      const f=scCanvas.find(x=>x.id===fid);
      return fid+':'+(f&&f.stories?f.stories.length:0);
    }).join('|');
  }
  // Fallback before first PI
  if(!scCanvas||scCanvas.length===0)return'empty';
  return scCanvas.map(f=>f.id).join('|');
}

// ── Left panel ──
function piRenderLeftPanel(){
  const lp=document.getElementById('pi-left');
  if(!lp)return;
  // v9.08: computed once per render.
  const _canEditPi=(typeof canEditSession!=='function')||canEditSession();
  const piName=(piPlan&&piPlan.name)||('PI-'+new Date().getFullYear()+'-Q'+Math.ceil((new Date().getMonth()+1)/3));
  const startDate=(piPlan&&piPlan.startDate)||new Date().toISOString().split('T')[0];
  const sprintCount=(piPlan&&piPlan.sprintCount)||(typeof appSettings!=='undefined'?appSettings.defaultSprints:6)||6;
  const sprintDur=(piPlan&&piPlan.sprintDuration)||((typeof appSettings!=='undefined'?appSettings.defaultSprintDur:2)*7)||14;
  const featCount=scCanvas.length;
  const storyCount=scCanvas.reduce((a,f)=>a+(f.stories?f.stories.length:0),0);
  lp.innerHTML=`
    <div class="ph">
      <div class="ph-text">
        <div class="ph-title">PI Planning</div>
        <div class="ph-sub">Configure your PI, then generate.</div>
      </div>
      <button class="collapse-btn" id="pi-collapse-btn" onclick="piToggleLeftPanel()" title="Toggle panel">
        ${lp.classList.contains('pi-left-collapsed')
          ?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/><polyline points="3 18 9 12 3 6"/></svg>'
          :'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/><polyline points="21 18 15 12 21 6"/></svg>'
        }
      </button>
    </div>
    <div class="pi-left-scroll">
      <div class="pi-section-lbl">From Story Canvas</div>
      <div class="pi-summary-strip">
        ${(()=>{let n=0,p=0,feats=0;scCanvas.forEach(f=>{if(f.stories){const sel=f.stories.filter(st=>st._inSC&&!st._hiddenFromSC&&(st._inPIPlan||st._stagedForPI));if(sel.length){feats++;sel.forEach(st=>{n++;p+=(st.points||3);});}}});return feats>0?`<span>${feats} feature${feats!==1?'s':''} &middot; ${n} stor${n!==1?'ies':'y'} &middot; ~${p} pts</span>`:`<span style="color:var(--t3);font-size:10px;">No stories sent yet — go to Story Canvas to select stories for PI.</span>`})()}
      </div>
      <div class="pi-section-lbl">PI Configuration</div>
      <div class="fl">
        <label>PI Name</label>
        <input type="text" id="pi-name-input" value="${e(piName)}" maxlength="60" ${_canEditPi?'':'readonly'}>
      </div>
      <div class="fl">
        <label>PI Start Date</label>
        <input type="date" id="pi-start-date" class="pi-date-input" value="${e(startDate)}"
          ${_canEditPi?`onchange="piSetStartDate(this.value)"`:'readonly'}>
      </div>
      <div class="fl">
        <label>Sprint Configuration</label>
        <div class="pi-sprint-cfg-row">
          <div class="pi-sprint-cfg-field">
            <div class="pi-sprint-cfg-lbl">Sprints</div>
            <div class="pi-input-unit-wrap">
              <input type="number" id="pi-sprint-count" min="1" max="20" value="${sprintCount}" class="pi-input-unit-num" ${_canEditPi?'':'readonly'}>
              <span class="pi-input-unit-tag">sprints</span>
            </div>
          </div>
          <div class="pi-sprint-cfg-field">
            <div class="pi-sprint-cfg-lbl">Sprint Duration</div>
            <div class="pi-input-unit-wrap">
              <input type="number" id="pi-sprint-dur-weeks" min="1" max="6" value="${Math.round(sprintDur/7)||2}" class="pi-input-unit-num" ${_canEditPi?'':'readonly'}>
              <span class="pi-input-unit-tag">weeks</span>
            </div>
          </div>
        </div>
        <span class="hint">Typical: 4–8 sprints &middot; 1–4 weeks</span>
      </div>
      <div class="pi-section-lbl">Squad Capacity</div>
      <table class="pi-squad-table">
        <thead><tr><th style="width:auto;">Squad</th><th style="width:90px;">Capacity</th><th style="width:28px;"></th></tr></thead>
        <tbody id="pi-squad-tbody">${piRenderSquadRows()}</tbody>
      </table>
      <div id="pi-cap-summary" style="font-size:9px;color:var(--t3);padding:4px 2px 6px;line-height:1.5;">${piRenderCapSummary()}</div>
      ${_canEditPi?`<button class="pi-add-squad" onclick="piAddSquad()">+ Add Squad</button>`:''}
      <div class="pi-section-lbl">Known Dependencies</div>
      <textarea class="f-textarea" id="pi-known-deps" rows="2" placeholder="e.g. Payments infra migration must complete before checkout redesign." maxlength="1000" ${_canEditPi?'':'readonly'}></textarea>
    </div>
    ${_canEditPi?`<div class="gen-wrap">
      <button class="gen-btn" id="pi-gen-btn" onclick="piGenerate()" ${piGetSquads().length===0?'disabled':''}>
        <i class="ti ti-calendar-event" style="font-size:13px;" aria-hidden="true"></i>
        ${(piPlan&&Array.isArray(piPlan.sprints)&&piPlan.sprints.length>0)?'Regenerate PI Plan':'Generate PI Plan'}
      </button>
    </div>`:''}`;
}

function piRenderSquadRows(){
  const squads=piGetSquads();
  if(squads.length===0){
    return`<tr><td colspan="3" style="font-size:10px;color:var(--label);padding:6px 0;">No squads yet — add one below.</td></tr>`;
  }
  return squads.map((s,i)=>`<tr>
    <td><input class="pi-squad-input" value="${e(s.name)}" placeholder="Squad name" onchange="piUpdateSquad(${i},'name',this.value)"></td>
    <td><input class="pi-squad-input" type="number" min="10" max="500" value="${s.capacity||80}" style="width:60px;" onchange="piUpdateSquad(${i},'capacity',+this.value)" title="Total story points this squad can deliver in the PI"></td>
    <td><button class="pi-squad-remove" onclick="piRemoveSquad(${i})">&#x2715;</button></td>
  </tr>`).join('');
}

function piGetSquads(){return Array.isArray(piSquads)?piSquads:[];}

// ── Capacity summary — shown below squad table, refreshes on every squad change ──
function piRenderCapSummary(){
  const squads=piGetSquads();
  const totalCap=squads.reduce((a,s)=>a+(s.capacity||0),0);
  return `Total capacity: <strong>${totalCap} pts</strong> across ${squads.length} squad${squads.length!==1?'s':''}`;
}
function _piRefreshCapSummary(){
  const el=document.getElementById('pi-cap-summary');
  if(el)el.innerHTML=piRenderCapSummary();
}

function piCalcCapacity(s){
  // Direct capacity field — user sets total PI points for the squad
  return s.capacity||80;
}

function piAddSquad(){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!Array.isArray(piSquads))piSquads=[];
  const _sqName=(typeof appSettings!=='undefined'?appSettings.defaultSquadName:'Squad')||'Squad';
  const _sqCap=(typeof appSettings!=='undefined'?appSettings.defaultSquadCapacity:80)||80;
  piSquads.push({name:_sqName+' '+(piSquads.length+1),capacity:_sqCap});
  const tbody=document.getElementById('pi-squad-tbody');
  if(tbody)tbody.innerHTML=piRenderSquadRows();
  _piRefreshCapSummary();
  const genBtn=document.getElementById('pi-gen-btn');
  if(genBtn)genBtn.disabled=false;
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
}

function piRemoveSquad(idx){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!Array.isArray(piSquads))return;
  piSquads.splice(idx,1);
  const tbody=document.getElementById('pi-squad-tbody');
  if(tbody)tbody.innerHTML=piRenderSquadRows();
  _piRefreshCapSummary();
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
}

function piUpdateSquad(idx,field,val){
  // v9.08: found during PI gating pass — not in the original 29-entry
  // inventory, but mutates piSquads and (below, unchanged) saves, so it
  // needs the same guard as its siblings above.
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!Array.isArray(piSquads)||!piSquads[idx])return;
  piSquads[idx][field]=val;
  // Recalculate capacity display
  const tbody=document.getElementById('pi-squad-tbody');
  if(tbody)tbody.innerHTML=piRenderSquadRows();
  _piRefreshCapSummary();
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
}

// ── Empty state ──
function piRenderEmpty(){
  const main=document.getElementById('pi-main');
  if(!main)return;
  const selectedStories=piGetSelectedStories();
  const trayHtml=selectedStories.length>0
    ?`<div class="pi-backlog-resize-handle"></div>
      <div class="pi-backlog-tray" id="pi-backlog-tray">
        <div class="pi-backlog-hdr">Stories from Story Canvas (${selectedStories.length}) — configure your PI on the left, then Generate PI Plan</div>
        <div class="pi-backlog-cards">${selectedStories.map(s=>{
          const shortId=s.id?s.id.replace(/[^a-z0-9]/gi,'').substring(0,6).toUpperCase():'';
          return`<div class="pi-backlog-card" title="${e(s.title)}"><span class="pi-card-id" style="display:block;margin-bottom:3px;">${e(shortId)}</span>${e((s.title||'').substring(0,55))}…</div>`;
        }).join('')}</div>
      </div>`
    :`<div class="pi-backlog-tray" id="pi-backlog-tray" style="display:flex;align-items:center;justify-content:center;">
        <div style="text-align:center;color:var(--t3);">
          <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px;">No stories sent from Story Canvas yet</div>
          <button class="cc-btn-ghost" style="width:auto;" onclick="revealAndSwitchTab('sc')">Go to Story Canvas &rarr;</button>
        </div>
      </div>`;
  main.innerHTML=`
    <div class="pi-main-content" id="pi-main-content">
      <div class="pi-empty" style="flex:1;">
        <div class="pi-empty-icon"><i class="ti ti-calendar-event" aria-hidden="true"></i></div>
        <div class="pi-empty-title">PI Canvas</div>
        <div class="pi-empty-sub">Configure your squads and sprint settings on the left, then click Generate PI Plan to sequence your backlog.</div>
      </div>
      ${trayHtml}
    </div>`;
}

// ── v8.98 Deterministic PI Engine ──
// Replaces AI-side graph traversal, cycle detection, arithmetic, and capacity
// bin-packing with real algorithms. The AI (buildPIGeneratePrompt) now only
// supplies per-story semantic subscores + reasoning and dependency edges —
// everything below is pure JS, runs the same way every time, and cannot
// silently mis-report a cycle or over-allocate a squad.

const PI_TIER_RANK={'Must Have':3,'Should Have':2,'Could Have':1};

function piDiagnosticBoost(story){
  if(story.origin!=='diagnostic')return 0;
  const sevW={Critical:4,High:3,Medium:2,Low:1}[story.severity]||0;
  const evM={Strong:1.5,Moderate:1.0,Weak:0.5}[story.evidenceStrength]||0;
  return sevW*evM;
}

function piComputeScore(scoreFields,diagnosticBoost,points){
  const p=points||3;
  const align=scoreFields.piGoalAlignment||1;
  const val=scoreFields.businessValue||1;
  const time=scoreFields.timeCriticality||1;
  const risk=scoreFields.riskReduction||1;
  return (2*align+val+time+risk+diagnosticBoost)/p;
}

// Builds a "blocks" adjacency map (fromId -> [toId,...]) from a flat edge list,
// restricted to known story IDs only (defends against fabricated/invented IDs).
function piBuildBlocksGraph(edges,knownIds){
  const graph={};
  knownIds.forEach(id=>{graph[id]=[];});
  (edges||[]).forEach(edge=>{
    if(!edge||!edge.fromId||!edge.toId)return;
    if(!graph.hasOwnProperty(edge.fromId)||!knownIds.has(edge.toId))return;
    if(graph[edge.fromId].indexOf(edge.toId)===-1)graph[edge.fromId].push(edge.toId);
  });
  return graph;
}

// Detects cycles via 3-color DFS (white/gray/black). Returns a Set of every
// story ID that participates in at least one cycle — these are excluded from
// escalation/sequencing entirely and backlogged directly, per the "do not
// attempt to resolve" rule carried over from the original prompt design.
function piDetectCycles(graph){
  const WHITE=0,GRAY=1,BLACK=2;
  const color={};
  Object.keys(graph).forEach(id=>{color[id]=WHITE;});
  const cyclic=new Set();
  function visit(id,stack){
    color[id]=GRAY;
    stack.push(id);
    (graph[id]||[]).forEach(next=>{
      if(color[next]===GRAY){
        // Found a cycle — mark every node currently on the stack from next's
        // first occurrence onward as cyclic.
        const idx=stack.indexOf(next);
        for(let i=idx;i<stack.length;i++)cyclic.add(stack[i]);
        cyclic.add(next);
      }else if(color[next]===WHITE){
        visit(next,stack);
      }
    });
    stack.pop();
    color[id]=BLACK;
  }
  Object.keys(graph).forEach(id=>{if(color[id]===WHITE)visit(id,[]);});
  return cyclic;
}

// Memoized post-order walk: effective_tier/effective_score of a story =
// max(own, effective value of every story it directly or transitively
// blocks). Cyclic stories are excluded (scored standalone, tier as-is) —
// caller must filter them out before sequencing.
function piEscalate(graph,ownTier,ownScore,cyclicIds){
  const effTier={},effScore={};
  function resolve(id){
    if(effTier.hasOwnProperty(id))return;
    if(cyclicIds.has(id)){effTier[id]=ownTier[id];effScore[id]=ownScore[id];return;}
    let bestTier=ownTier[id],bestScore=ownScore[id];
    (graph[id]||[]).forEach(child=>{
      if(cyclicIds.has(child))return;
      resolve(child);
      if(PI_TIER_RANK[effTier[child]]>PI_TIER_RANK[bestTier])bestTier=effTier[child];
      if(effScore[child]>bestScore)bestScore=effScore[child];
    });
    effTier[id]=bestTier;effScore[id]=bestScore;
  }
  Object.keys(graph).forEach(resolve);
  return{effTier,effScore};
}

// Deterministic capacity-aware sequencing + mandatory backfill. Squad
// "relevance" is intentionally NOT modeled — squads carry only {name,
// capacity} in this app's data model, so assignment is pure load-balancing:
// each ready story goes to whichever squad has the most remaining capacity
// in the current sprint that can still fit it. Per-sprint working capacity
// per squad = squad.capacity / sprintCount (the original prompt's own
// "target pts per sprint" pacing, now enforced exactly rather than aimed for).
function piSequence(rankedIds,effTier,effScore,blockersOf,pointsOf,squads,sprintCount){
  const assignment={}; // storyId -> {sprint, squad}
  const assignedSprintOf={};
  const perSprintCap=squads.map(s=>Math.max(1,Math.round((s.capacity||0)/sprintCount)));
  const unassigned=new Set(rankedIds);

  function isReady(id,sprint){
    return (blockersOf[id]||[]).every(b=>assignedSprintOf.hasOwnProperty(b)&&assignedSprintOf[b]<=sprint);
  }
  function tryAssign(id,sprint,remaining){
    const pts=pointsOf[id]||3;
    let bestIdx=-1,bestRemaining=-1;
    squads.forEach((sq,i)=>{
      if(remaining[i]>=pts&&remaining[i]>bestRemaining){bestRemaining=remaining[i];bestIdx=i;}
    });
    if(bestIdx===-1)return false;
    remaining[bestIdx]-=pts;
    assignment[id]={sprint,squad:squads[bestIdx].name};
    assignedSprintOf[id]=sprint;
    unassigned.delete(id);
    return true;
  }

  for(let sprint=1;sprint<=sprintCount;sprint++){
    const remaining=perSprintCap.slice();
    // Priority pass — ranked order (tier desc, then effective score desc)
    rankedIds.forEach(id=>{
      if(!unassigned.has(id))return;
      if(!isReady(id,sprint))return;
      tryAssign(id,sprint,remaining);
    });
    // Backfill pass — any squad with leftover room takes the next ready,
    // unassigned story regardless of tier, so no usable capacity sits idle.
    let filled=true;
    while(filled){
      filled=false;
      for(const id of rankedIds){
        if(!unassigned.has(id))continue;
        if(!isReady(id,sprint))continue;
        if(tryAssign(id,sprint,remaining)){filled=true;break;}
      }
    }
  }
  return{assignment,backlogIds:Array.from(unassigned)};
}

// ── Generate ──
async function piGenerate(){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const key=getKey();
  if(aiGenInFlight.active){showToast("Still working on your last request. Hang tight, this won't take long.",'info');return;}
  const squads=piGetSquads();
  if(squads.length===0){showToast('Add at least one squad before generating.','warn');return;}
  // Item 11: use selected stories only
  const selectedStories=piGetSelectedStories();
  if(selectedStories.length===0){
    showToast('No stories selected for PI. Go to Story Canvas and select stories first.','info');
    return;
  }
  // v8.133 fix (item 3): courtesy pre-check, before any confirm modal.
  if(typeof _lsPeekIfLocked==='function' && typeof _activeSessionId!=='undefined' && _activeSessionId){
    const _peek=await _lsPeekIfLocked(_activeSessionId);
    if(_peek.locked){
      showToast(_peek.holderName+' is already generating on this session. Try again in a moment.','warn');
      return;
    }
  }
  // If plan already exists, confirm before regenerating — UNLESS this is
  // the confirmed re-entry from the modal's own Regenerate button (see
  // below, _pgRegenConfirmed), in which case skip straight to the lock-
  // gated wipe further down. Phase 5 fix (v8.118): the wipe itself used to
  // happen unconditionally in the modal's onclick, BEFORE any lock check —
  // meaning a user could confirm regeneration, have their existing PI plan
  // wiped immediately, and only THEN discover (via the toast fired from
  // inside withGenerationLock further down) that someone else was already
  // generating, with their prior work already gone and no way back. Fixed
  // by moving the actual wipe to run only AFTER the lock is confirmed
  // acquired, inside the lock callback below — see that block for the
  // wipe itself.
  const _isConfirmedRegen = !!_pgRegenConfirmed;
  _pgRegenConfirmed = false;
  if(piPlan && Array.isArray(piPlan.sprints) && piPlan.sprints.length>0 && !_isConfirmedRegen){
    const overlay=document.createElement('div');
    overlay.id='pi-regen-overlay-1';
    overlay.className='modal-overlay';
    overlay.innerHTML=`<div class="modal" style="max-width:400px;;position:relative;">
    <button onclick="document.getElementById('pi-regen-overlay-1').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
      <div style="font-size:13px;font-weight:500;color:var(--t1);">Regenerate PI Plan?</div>
    </div>
      <div class="modal-body">This will reset all sprint assignments. Manual moves will be lost.</div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" onclick="document.getElementById('pi-regen-overlay-1').remove()">Cancel</button>
        <button class="modal-confirm-btn" onclick="document.getElementById('pi-regen-overlay-1').remove();_pgRegenConfirmed=true;piGenerate();">Regenerate</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const _escR1=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_escR1,true);}};
    document.addEventListener('keydown',_escR1,true);
    trapFocus(overlay);
    return;
  }

  // Phase 5 (v8.117): immediate visual acknowledgment — disable the
  // button synchronously before any async work (including the lock
  // check). The rich loader is deliberately NOT shown until the lock is
  // confirmed acquired (inside withGenerationLock's callback below) —
  // showing "Generating PI Plan..." before the lock check even runs would
  // misleadingly claim generation started when the app is still only
  // checking whether it's allowed to start.
  const btn=document.getElementById('pi-gen-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="cc-spin-sm"></div> Generating…';}

  // Read config from left panel
  const piName=document.getElementById('pi-name-input')?document.getElementById('pi-name-input').value.trim()||'PI-Plan':'PI-Plan';
  const startDateEl=document.getElementById('pi-start-date');
  const startDate=startDateEl?startDateEl.value:new Date().toISOString().split('T')[0];
  const sprintCountInp=document.getElementById('pi-sprint-count');
  const sprintCount=sprintCountInp?Math.max(1,Math.min(20,+sprintCountInp.value||6)):6;
  const sprintDurWeeksInp=document.getElementById('pi-sprint-dur-weeks');
  const sprintDuration=sprintDurWeeksInp?Math.max(1,Math.min(6,+sprintDurWeeksInp.value||2))*7:14;
  const knownDepsEl=document.getElementById('pi-known-deps');
  const knownDeps=knownDepsEl?knownDepsEl.value:'';
  const _scPi=typeof sessionContext!=='undefined'?sessionContext:null;
  const _piProb=(_scPi&&_scPi.productProfile&&_scPi.productProfile.problem)||'';
  const piGoal=(typeof piInputs!=='undefined'&&piInputs.piGoal)||_piProb;
  const _pcPi=(typeof getFullProductCtx==='function')?getFullProductCtx():getProductCtx();
  const productName=_pcPi.name;
  const industry=_pcPi.industry;

  // Compute squad capacities — snapshot, decoupled from live piSquads via spread
  const squadsCapped=squads.map(s=>({...s,capacity:piCalcCapacity(s)}));

  // Phase 5 (v8.117): attempt marker for this call. PI generation runs
  // 2-4 minutes — the longest-running generation in the app — making it
  // the single most likely case for a user to navigate away mid-call, or
  // for a slow lock-check to resolve well after the user has moved on.
  // Every later write below is guarded against this marker.
  const _attempt=newGenAttempt();

  // Phase 5: withGenerationLock wraps the ENTIRE workflow below — callAPI,
  // parse, validate, the deterministic scoring/sequencing engine, and the
  // sessionStoreSave() calls inside it — not just the callAPI() line. A
  // lock scoped only to the network call would release before this
  // function's own apply/save steps finish, letting a second person start
  // generating against stale data. See api.js for the full rationale.
  try{
    await withGenerationLock(async (_lock) => {
  // Phase 5 fix (v8.118): the destructive wipe (scClearPIPlannedBadges,
  // piPlan=null, piScVersion=null) now happens HERE — after the lock is
  // confirmed acquired, not before this whole withGenerationLock() call
  // even started. If the lock check above had failed instead, execution
  // would never reach this line at all, and the user's existing PI plan
  // would be left completely untouched — exactly the fix this bug needed.
  if(_isConfirmedRegen){
    if(typeof scClearPIPlannedBadges==='function')scClearPIPlannedBadges();
    // Phase 5 fix (v8.118): if this confirmed-regen came from piRegenerate()
    // (the sprint-board's own regen button), restore the prior submission's
    // story staging flags now — same data piRegenerate() used to mutate
    // unconditionally before any lock check. _pgRegenPriorSubmittedStoryIds
    // is null (not just empty) when this came from piGenerate()'s OWN
    // confirm-modal instead, which never touches story staging at all —
    // distinguishing those two paths correctly, not conflating them.
    if(_pgRegenPriorSubmittedStoryIds!==null){
      const _priorIds=_pgRegenPriorSubmittedStoryIds;
      _pgRegenPriorSubmittedStoryIds=null;
      if(_priorIds.length&&typeof scCanvas!=='undefined'){
        scCanvas.forEach(f=>{
          if(f.stories)f.stories.forEach(st=>{
            st._stagedForPI=_priorIds.includes(st.id);st._inPIPlan=false;
          });
        });
      }
      if(typeof scPiSelectedIds!=='undefined'){
        scPiSelectedIds=new Set();
        if(typeof scCanvas!=='undefined')scCanvas.forEach(f=>{if(f.stories&&f.stories.some(s=>s._stagedForPI))scPiSelectedIds.add(f.id);});
      }
    }
    piPlan=null;
    piScVersion=null;
    // Item 8: pause (not clear) any pending manual-edit notification —
    // this real regeneration is about to replace the data wholesale, so a
    // stale manual-edit timer firing mid-generation would be redundant at
    // best, confusing at worst. Cleared for good on success (below), or
    // resumed if this attempt doesn't complete (outer catch).
    if(typeof _lsPauseManualEditForRegeneration==='function')_lsPauseManualEditForRegeneration('pi');
  }
  // Lock confirmed — show the real loader now, marker-stamped.
  var piMainLoader=document.getElementById('pi-main');
  if(piMainLoader){piMainLoader.innerHTML=markGenAttempt(_attempt,`<div class="pi-empty">
    <div class="pi-empty-icon"><div class="cc-spin" style="width:32px;height:32px;border-width:3px;"></div></div>
    <div class="pi-empty-title">Generating PI Plan…</div>
    <div class="pi-empty-sub">AI is analysing dependencies, then sequencing across sprints and squads. This takes 2–4 minutes.</div>
  </div>`);}
  try{
    const sys=(typeof SYS_PI!=='undefined'?SYS_PI:'');
    const _piDocCtx=(typeof buildDocContext==='function')?buildDocContext('pi'):'';
    // v8.98: prompt no longer takes squads/sprintCount/sprintDuration — the AI
    // does not sequence or assign squads/sprints, so it doesn't need them.
    const usr=buildPIGeneratePrompt(
      productName,industry,piGoal,selectedStories,knownDeps,startDate,
      _pcPi.problem||'',_pcPi.kpis||'',
      (typeof piInputs!=='undefined'&&piInputs.constraints)||'',
      _piDocCtx
    );
    const _signal=startAiGen(`Your PI Plan is being scored and sequenced for ${selectedStories.length} stor${selectedStories.length!==1?'ies':'y'}. This can take 2–4 minutes. Leaving now discards it, you'll need to regenerate from scratch.`);
    // v8.98: token budget shrunk — AI now emits 4 semantic subscores + reasoning
    // + dependency edges only, no sequencing/score-arithmetic/tier output.
    const _piTok=Math.min(10000,Math.max(3000,selectedStories.length*120+1500));
    const txt=await callAPI(sys,usr,_piTok,_signal,undefined,'pi-generate');
    const clean=txt.replace(/```json|```/g,'').trim();
    let parsed;
    try{parsed=JSON.parse(clean);}
    catch(pe){
      const s=clean.indexOf('{');const l=clean.lastIndexOf('}');
      if(s>=0&&l>s)try{parsed=JSON.parse(clean.substring(s,l+1));}catch(pe2){throw new Error('Could not parse PI plan response.');}
      else throw new Error('Could not parse PI plan response.');
    }
    if(!parsed||!parsed.storyScores)throw new Error('Invalid PI plan response — missing storyScores.');

    // ── Validate AI response before the deterministic engine ever touches it ──
    const _knownIds=new Set(selectedStories.map(s=>s.id));
    const _missing=selectedStories.filter(s=>!parsed.storyScores.hasOwnProperty(s.id));
    if(_missing.length>0)throw new Error('AI response is missing scores for '+_missing.length+' of '+selectedStories.length+' stories — please regenerate.');

    // ── Deterministic engine: diagnostic boost, composite score, dependency
    // graph + cycle detection, tier escalation, capacity sequencing + backfill ──
    const pointsOf={},ownTier={},ownScore={},scoreFieldsById={};
    selectedStories.forEach(s=>{
      const sf=parsed.storyScores[s.id]||{};
      scoreFieldsById[s.id]=sf;
      pointsOf[s.id]=s.points||3;
      ownTier[s.id]=s.priority||'Should Have';
      ownScore[s.id]=piComputeScore(sf,piDiagnosticBoost(s),s.points||3);
    });

    const _rawDeps=(parsed.dependencies||[]).filter(d=>d&&d.fromId&&d.toId&&_knownIds.has(d.fromId)&&_knownIds.has(d.toId));
    const graph=piBuildBlocksGraph(_rawDeps,_knownIds);
    const cyclicIds=piDetectCycles(graph);
    const{effTier,effScore}=piEscalate(graph,ownTier,ownScore,cyclicIds);

    const blockersOf={};
    _knownIds.forEach(id=>{blockersOf[id]=[];});
    Object.keys(graph).forEach(from=>{
      graph[from].forEach(to=>{if(!cyclicIds.has(from)&&!cyclicIds.has(to))blockersOf[to].push(from);});
    });

    const rankedIds=selectedStories.map(s=>s.id).filter(id=>!cyclicIds.has(id)).sort((a,b)=>{
      const rt=PI_TIER_RANK[effTier[b]]-PI_TIER_RANK[effTier[a]];
      if(rt!==0)return rt;
      return effScore[b]-effScore[a];
    });

    const{assignment,backlogIds}=piSequence(rankedIds,effTier,effScore,blockersOf,pointsOf,squadsCapped,sprintCount);

    // Assemble storyAssignments in the exact shape existing downstream code expects
    const _assignments={};
    Object.keys(assignment).forEach(id=>{
      const sf=scoreFieldsById[id]||{};
      const story=selectedStories.find(s=>s.id===id);
      const breakdown={
        piGoalAlignment:sf.piGoalAlignment||1,
        alignmentReason:sf.alignmentReason||'',
        businessValue:sf.businessValue||1,
        timeCriticality:sf.timeCriticality||1,
        riskReduction:sf.riskReduction||1,
        diagnosticBoost:piDiagnosticBoost(story),
        score:Math.round(ownScore[id]*100)/100
      };
      if(sf.vocSupport)breakdown.vocSupport=sf.vocSupport;
      if(sf.docConflict)breakdown.docConflict=sf.docConflict;
      _assignments[id]={sprint:assignment[id].sprint,squad:assignment[id].squad,points:pointsOf[id],status:'planned',scoreBreakdown:breakdown};
    });

    const backlogNotes={};
    backlogIds.forEach(id=>{backlogNotes[id]='Did not fit within available squad capacity, or a dependency could not be scheduled within this PI.';});
    cyclicIds.forEach(id=>{backlogNotes[id]='Dependency cycle detected — excluded pending PM review.';});
    const backlogStoryIds=backlogIds.concat(Array.from(cyclicIds));

    // Build sprint date ranges
    const sprints=piComputeSprints(sprintCount,sprintDuration,startDate);

    // dependencies carried forward in {fromId,toId,source,external} shape —
    // matches every other consumer of piPlan.dependencies in this file
    // (piHasIncomingDep, piGetStoryDeps, piLinkDep, piRemoveDep all read
    // .fromId/.toId/.external, not .from/.to/.type).
    const _piDeps=_rawDeps.map(d=>({fromId:d.fromId,toId:d.toId,source:d.source||'ai',external:false}));

    // Carry story notes from SC to PI plan assignments
    if(typeof scCanvas!=='undefined'){
      scCanvas.forEach(f=>{
        if(!f.stories)return;
        f.stories.forEach(st=>{
          if(st.notes&&_assignments[st.id])_assignments[st.id].note=st.notes;
        });
      });
    }
    // Carry story dependencies from SC into PI deps — fixed to .fromId/.toId
    // shape (was .from/.to, which no downstream consumer actually reads —
    // pre-existing mismatch, corrected here since this block is being rewritten).
    if(typeof scCanvas!=='undefined'){
      scCanvas.forEach(f=>{
        if(!f.stories)return;
        f.stories.forEach(st=>{
          if(!st.dependencies||!st.dependencies.length)return;
          st.dependencies.forEach(dep=>{
            const exists=_piDeps.some(d=>d.fromId===st.id&&d.toId===dep.storyId);
            if(!exists)_piDeps.push({fromId:st.id,toId:dep.storyId,source:'sc',external:false});
          });
        });
      });
    }
    // Build scPiSelectedIds from story-level flags for PI left panel summary
    if(typeof scPiSelectedIds!=='undefined'){
      scPiSelectedIds=new Set();
      scCanvas.forEach(f=>{if(f.stories&&f.stories.some(s=>s._stagedForPI))scPiSelectedIds.add(f.id);});
    }
    piPlan={
      name:piName,
      startDate,sprintCount,sprintDuration,
      sprints,
      storyAssignments:_assignments,
      dependencies:_piDeps,
      externalDeps:[],
      backlogStoryIds,
      businessValueBullets:parsed.businessValueBullets||[],
      businessValueOneLiner:parsed.businessValueOneLiner||'',
      backlogNotes,
      submittedFeatureIds:Array.from(typeof scPiSelectedIds!=='undefined'?scPiSelectedIds:[]),
      submittedStoryIds:selectedStories.map(s=>s.id)
    };
    piSquads=squadsCapped;
    piScVersion=piComputeHash();

    // Item 12: stamp piSubmitted on submitted features
    if(typeof scCanvas!=='undefined'){
      scCanvas.forEach(f=>{
        f.piSubmitted=false;
        f.piSubmittedStoryCount=0;
      });
      (piPlan.submittedFeatureIds||[]).forEach(fid=>{
        const feat=scCanvas.find(x=>x.id===fid);
        if(feat){
          feat.piSubmitted=true;
          feat.piSubmittedStoryCount=feat.stories?feat.stories.length:0;
        }
      });
    }

    // Apply PI planned badges to Story Canvas
    scApplyPIPlannedBadges(piPlan.storyAssignments);
  piUpdateTabBadge();

    // Clear in-flight guard before switching tab — switchTab calls blockIfGenerating
    // which would show the "Hold on" modal if aiGenInFlight is still active.
    endAiGen();

    // Reveal PI tab — piOnTabEnter (called by revealAndSwitchTab) handles piRenderBoard + piCheckStaleness
    revealAndSwitchTab('pi');
    piRenderLeftPanel();
    // Phase 5: checkpoint immediately before the save — per the second
    // adversarial review round, checking lock-lost status only AFTER this
    // whole function returns would be too late; the save would already
    // have happened. Throws generation_lock_lost if the lock was lost
    // mid-generation, which the outer catch (added below) surfaces as a
    // toast without a second, duplicate "PI plan generation failed" toast.
    _lock.throwIfLost();
    if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
      const _ok=await sessionStoreSave(_activeSessionId);
      if(_ok&&typeof _activeSessionIsShared!=='undefined'&&_activeSessionIsShared&&typeof _lsEmitContentEvent==='function'){
        await _lsEmitContentEvent(_activeSessionId,'pi','pi_plan_generated',null,null);
      }
      // Item 8: the regeneration's own event is now durably emitted (or
      // this was a private session with nothing to clear) — fully
      // discard the paused manual-edit state rather than let it resume.
      if(typeof _lsClearManualEditAfterRegeneration==='function')_lsClearManualEditAfterRegeneration('pi');
    }
  }catch(err){
    if(err.name==='AbortError'){
      endAiGen();
      // Phase 5 (v8.117): re-query fresh and check the marker before
      // resetting — if the user has since navigated to a different view,
      // don't reset a #pi-main that no longer belongs to this attempt.
      var _abortMainArea=getIfCurrentAttempt('pi-main',_attempt);
      if(_abortMainArea)piRenderEmpty();
      if(btn){btn.disabled=piGetSquads().length===0;btn.innerHTML='<i class="ti ti-calendar-event" style="font-size:13px;" aria-hidden="true"></i> Regenerate';}
      // Phase 5: rethrow rather than silently return. Per adversarial
      // review, a silent return here made withGenerationLock() see this as
      // a NORMAL SUCCESSFUL completion (fn() resolved without throwing) —
      // indistinguishable from a real generation succeeding. That meant
      // the outer lock-error catch (which resets UI state set BEFORE
      // withGenerationLock was ever called) never ran on abort. Rethrowing
      // preserves this function's own abort-specific cleanup above (which
      // still runs first) while also letting the wrapper's own finally
      // release the DB lock through the normal error path, and letting
      // the outer catch below run its (harmless, idempotent) UI reset too.
      throw err;
    }
    if(err.message==='generation_lock_lost'){
      // Toast already shown by withGenerationLock() itself — avoid a
      // second, confusing "PI plan generation failed" toast on top of it.
      var _llMainArea=getIfCurrentAttempt('pi-main',_attempt);
      if(_llMainArea)piRenderEmpty();
      throw err; // propagate to outer catch for the shared btn/loader reset
    }
    // v8.98 fix: this branch was never resetting #pi-main, so any non-abort
    // failure (timeout, parse error, invalid structure) left the "Generating…"
    // spinner on screen indefinitely even though the toast below fired.
    // Phase 5 (v8.117): marker-guarded — a stale failure must not reset a
    // #pi-main that a different, newer action now owns.
    var _errMainArea=getIfCurrentAttempt('pi-main',_attempt);
    if(_errMainArea)piRenderEmpty();
    showToast('PI plan generation failed: '+err.message,'error');
  }finally{
    if(btn){btn.disabled=piGetSquads().length===0;btn.innerHTML='<i class="ti ti-calendar-event" style="font-size:13px;" aria-hidden="true"></i> Regenerate';}
    endAiGen();
  }
    });
  }catch(lockErr){
    // Phase 5 fix (v8.118): REAL BUG, found via live testing and confirmed
    // via debug logging that piPlan itself was NEVER touched by a rejected
    // lock (the wipe genuinely never runs — see the lock-gated wipe
    // above). The bug was here instead: this catch UNCONDITIONALLY called
    // piRenderEmpty(), which renders the "Configure your squads..." EMPTY
    // STATE regardless of whether piPlan still has real, intact data —
    // meaning a rejected regenerate attempt made an EXISTING, untouched
    // plan visually disappear from the screen, even though the underlying
    // data was completely safe in memory (confirmed live: renavigating
    // away and back to the PI tab correctly showed the intact board,
    // proving the data itself was always fine — only the immediate
    // post-rejection view was wrong). Fixed, per explicit direction to
    // make this foolproof rather than a hand-picked subset: call
    // piOnTabEnter() directly — the SAME function that runs on every
    // normal navigation to this tab (piCheckStaleness + piRenderLeftPanel
    // + the piPlan-conditional board/empty render) — rather than
    // reimplementing a narrower version of its logic here. This
    // guarantees the rejection path can never drift out of sync with
    // normal navigation's behavior, since there is only one function
    // making this decision now, not two similar-but-separate ones.
    var _lockErrMainArea=document.getElementById('pi-main');
    if(_lockErrMainArea&&typeof piOnTabEnter==='function'){
      piOnTabEnter();
    }
    if(btn){btn.disabled=piGetSquads().length===0;btn.innerHTML='<i class="ti ti-calendar-event" style="font-size:13px;" aria-hidden="true"></i> Regenerate';}
    endAiGen();
    // Item 8: this regeneration attempt didn't complete successfully —
    // resume any manual-edit state that was paused at the wipe point, so
    // its own notification can still eventually fire rather than being
    // lost because a regeneration attempt failed. No-op if nothing was
    // ever paused (e.g. the lock was rejected before the wipe even ran).
    if(typeof _lsResumeManualEditAfterFailedRegeneration==='function')_lsResumeManualEditAfterFailedRegeneration('pi');
  }
}

function piGetSelectedStories(){
  // v7.16: reads _stagedForPI flags (stories staged for PI send in Story Canvas)
  const stories=[];
  if(typeof scCanvas==='undefined')return stories;
  scCanvas.forEach(f=>{
    if(!f.stories||f.stories.length===0)return;
    f.stories.filter(st=>st._inSC&&(st._inPIPlan||st._stagedForPI)).forEach(st=>{
      stories.push({
        id:st.id,title:st.statement||st.title||'',points:st.points||3,
        cap:f.cap||'',name:f.name,stage:f.stage||'',
        priority:st.priority||'Should Have',
        origin:f.origin||'kpi',
        diagnosticContext:f.origin==='diagnostic'?(f.diagnosticContext||null):null
      });
    });
  });
  return stories;
}

function piGetAllStories(){
  const stories=[];
  scCanvas.forEach(f=>{
    if(f.stories&&f.stories.length>0){
      f.stories.forEach(st=>{
        stories.push({id:st.id,title:st.statement||st.title||'',points:st.points||3,cap:f.cap||'',name:f.name,stage:f.stage||''});
      });
    }
  });
  return stories;
}

function piComputeSprints(count,durationDays,startDateStr){
  const sprints=[];
  let current=new Date(startDateStr);
  for(let i=0;i<count;i++){
    const start=new Date(current);
    const end=new Date(current);
    end.setDate(end.getDate()+durationDays-1);
    const fmt=d=>d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    sprints.push({id:i+1,label:'Sprint '+(i+1),dateRange:fmt(start)+' – '+fmt(end)});
    current.setDate(current.getDate()+durationDays);
  }
  return sprints;
}

// ── Regenerate ──
function piConfirmRegenerate(){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const main=document.getElementById('pi-main');
  if(!main)return;
  const overlay=document.createElement('div');
  overlay.id='pi-regen-overlay-2';
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="max-width:400px;;position:relative;">
    <button onclick="document.getElementById('pi-regen-overlay-2').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
      <div style="font-size:13px;font-weight:500;color:var(--t1);">Regenerate PI Plan?</div>
    </div>
    <div class="modal-body">Regenerating will reset all sprint assignments including any manual moves. Story notes will be preserved.</div>
    <div class="modal-footer">
      <button class="modal-cancel-btn" onclick="document.getElementById('pi-regen-overlay-2').remove()">Cancel</button>
      <button class="modal-confirm-btn" onclick="document.getElementById('pi-regen-overlay-2').remove();piRegenerate()">Regenerate</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const _escR2=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_escR2,true);}};
  document.addEventListener('keydown',_escR2,true);
  trapFocus(overlay);
}

function piRegenerate(){
  // Phase 5 fix (v8.118): same bug as piGenerate()'s own confirm-modal path
  // — this function used to wipe piPlan and mutate scCanvas story flags
  // UNCONDITIONALLY, before piGenerate()'s own lock check ever ran. If the
  // lock check then failed (someone else generating), the user's existing
  // PI plan and story staging were already gone with no way back. Fixed
  // the same way: capture what we need from piPlan HERE (read-only, no
  // mutation yet), stash it for use only if the lock actually succeeds,
  // and let piGenerate() itself perform every mutation below AFTER
  // acquiring the lock — see piGenerate()'s _isConfirmedRegen branch.
  _pgRegenPriorSubmittedStoryIds = (piPlan&&piPlan.submittedStoryIds)?[...piPlan.submittedStoryIds]:[];
  _pgRegenConfirmed=true;
  piGenerate();
}

// ── Sprint board ──
function piRenderBoard(){
  const main=document.getElementById('pi-main');
  // v9.01.01 fix: extended guard to also require a genuine sprints array
  // (not just any truthy piPlan) -- centralizing this here protects all 7
  // call sites of this function uniformly, rather than needing to fix each
  // one individually. Strictly safer than before: this only ever turns an
  // existing "do nothing" case into a broader "do nothing," never removes
  // a previously-safe path.
  if(!main||!piPlan||!Array.isArray(piPlan.sprints)||piPlan.sprints.length===0)return;

  const squads=piGetSquads();
  const squadColors=['#5F1EBE','#185FA5','#0F6E56','#C8870A','#A32D2D','#534AB7','#075B5B','#7D3C98'];
  const squadColorMap={};
  squads.forEach((s,i)=>{squadColorMap[s.name]=squadColors[i%squadColors.length];});

  // Check capacity
  const capacityWarnings=piCheckCapacity(squads,squadColorMap);

  // Count assigned stories per sprint per squad for capacity bars
  const sprintSquadPts={};
  piPlan.sprints.forEach(sp=>{sprintSquadPts[sp.id]={};squads.forEach(sq=>{sprintSquadPts[sp.id][sq.name]=0;});});
  Object.entries(piPlan.storyAssignments||{}).forEach(([sid,asgn])=>{
    if(asgn&&asgn.sprint&&sprintSquadPts[asgn.sprint]&&asgn.squad){
      sprintSquadPts[asgn.sprint][asgn.squad]=(sprintSquadPts[asgn.sprint][asgn.squad]||0)+(asgn.points||0);
    }
  });

  const unsavedHtml=''; // Unsaved banner removed per feedback

  // Toolbar
  const warnHtml=capacityWarnings.length>0?`<span class="pi-warn-badge"><i class="ti ti-alert-triangle" style="font-size:10px;" aria-hidden="true"></i> ${capacityWarnings[0]}</span>`:'';
  const totalPts=Object.values(piPlan.storyAssignments||{}).reduce((a,v)=>a+(v&&v.points||0),0);
  const toolbarHtml=`<div class="pi-toolbar">
    <div class="pi-toolbar-l">
      <span class="pi-name-badge">${e(piPlan.name)}</span>
      <span class="pi-summary-badge">${piPlan.sprintCount} sprints &middot; ${totalPts} pts</span>
      ${warnHtml}
    </div>
    <div class="pi-toolbar-r">
      <button id="pi-export-btn" class="export-cta-btn" onclick="piExportDocx()"><i class="ti ti-download" style="font-size:11px;" aria-hidden="true"></i> Export</button>
    </div>
  </div>`;

  // Stale banner placeholder
  const staleBannerHtml=`<div class="pi-stale-banner" id="pi-stale-banner" style="display:none;">
    <span class="pi-stale-banner-msg">Stories changed for features in this PI plan — regenerate to update.</span>
    <button class="pi-sync-btn" onclick="piConfirmRegenerate()">Regenerate PI &rarr;</button>
    <button class="pi-stale-dismiss" onclick="piHideStaleBanner()">Dismiss</button>
  </div>`;

  // Build sprint columns
  let boardHtml='<div class="pi-board" id="pi-board">';
  piPlan.sprints.forEach(sprint=>{
    const stories=piGetStoriesForSprint(sprint.id);
    // Capacity bar
    const barSegments=squads.map((sq,i)=>{
      const pts=sprintSquadPts[sprint.id][sq.name]||0;
      const cap=sq.capacity||1;
      const pct=Math.min(100,Math.round(pts/cap*100));
      return`<div class="pi-cap-bar-seg" style="width:${pct}%;background:${squadColors[i%squadColors.length]};opacity:0.7;" title="${sq.name}: ${pts}/${sq.capacity} pts"></div>`;
    }).join('');
    const _sprintEmpty=stories.length===0;
    boardHtml+=`<div class="pi-sprint-col${_sprintEmpty?' pi-sprint-empty':''}" id="pi-col-${sprint.id}" ondragover="piDragOver(event)" ondrop="piDrop(event,${sprint.id})">
      <div class="pi-sprint-hdr">
        <div class="pi-sprint-num">${e(sprint.label)}</div>
        <div class="pi-sprint-dates">${e(sprint.dateRange)}</div>
      </div>
      <div class="pi-cap-bar">${barSegments}</div>
      <div class="pi-sprint-cards" id="pi-cards-${sprint.id}">
        ${stories.map(s=>piRenderStoryCard(s,squadColorMap)).join('')}
        <div class="pi-drop-zone" ondragover="piDragOver(event)" ondrop="piDrop(event,${sprint.id})">Drop here</div>
      </div>
    </div>`;
  });
  boardHtml+='</div>';

  // Backlog tray
  const backlogStories=piGetBacklogStories();
  const backlogHtml=`<div class="pi-backlog-resize-handle" id="pi-backlog-resize" onmousedown="piBacklogResizeStart(event)" title="Drag to resize"></div>
  <div class="pi-backlog-tray" id="pi-backlog-tray" ondragover="piDragOver(event)" ondrop="piDropToBacklog(event)">
    <div class="pi-backlog-hdr">Backlog tray (${backlogStories.length} stories)</div>
    <div class="pi-backlog-cards">${backlogStories.map(s=>{const shortId=s.id?s.id.replace(/[^a-z0-9]/gi,'').substring(0,6).toUpperCase():'';const _canEditPiBl=(typeof canEditSession!=='function')||canEditSession();return`<div class="pi-backlog-card" draggable="${_canEditPiBl}" ${_canEditPiBl?`ondragstart="piDragStart(event,'${e(s.id)}')"`:''} onclick="piOpenBacklogPanel('${e(s.id)}')" title="${e(s.statement)}" style="cursor:${_canEditPiBl?'pointer':'not-allowed'};"><div class="pi-card-hdr-row"><span class="pi-card-id" style="display:block;">${e(shortId)}</span>${_canEditPiBl?`<button type="button" class="pi-card-remove" onclick="event.stopPropagation();event.preventDefault();piRemoveStoryFromBacklog('${e(s.id)}')" title="Move to Story Canvas" aria-label="Remove story from PI backlog">✕</button>`:''}</div>${e((s.statement||s.title||'').substring(0,55))}…</div>`;}).join('')}</div>
  </div>`;

  main.innerHTML=`<div class="pi-main-content" id="pi-main-content">${unsavedHtml+toolbarHtml+staleBannerHtml+boardHtml+backlogHtml}</div>`;

  // Re-check staleness
  piCheckStaleness();
}

function piRenderStoryCard(story,squadColorMap){
  const asgn=(piPlan&&piPlan.storyAssignments&&piPlan.storyAssignments[story.id])||{};
  const pts=asgn.points||story.points||3;
  const squad=asgn.squad||'—';
  const isManual=asgn.manuallyMoved;
  const isCarryForward=story.carryForward;
  const isBlocked=piIsBlocked(story.id);
  const titleTrunc=(story.statement||story.title||'').substring(0,120);
  // Feature badge colour
  const feat=scCanvas.find(f=>f.stories&&f.stories.some(st=>st.id===story.id));
  const featOrigin=(feat&&feat.origin==='pi')?'pi-origin':'';
  const deps=piGetDepsForStory(story.id);
  const blocksDep=deps.find(d=>d.direction==='blocks'&&!d.external);
  // Short story ID derived from full ID
  const shortId=story.id?story.id.replace(/[^a-z0-9]/gi,'').substring(0,6).toUpperCase():'';
  const stmtShort=(story.statement||story.title||'').substring(0,100);
  const userPts=asgn.userSetPoints;
  const ptsDisplay=userPts?pts+' pts':'~'+pts+' pts';
  const ptsColor=userPts?'color:var(--green);font-weight:700;':'color:var(--t3);';
  const squadColor=squadColorMap&&squad&&squadColorMap[squad]?squadColorMap[squad]:'var(--divider)';
  const dorVal=story.dor||'READY';
  const dorClass=dorVal==='READY'?'pi-card-dor-ready':dorVal==='IN REVIEW'?'pi-card-dor-review':'pi-card-dor-blocked';
  // v9.08: draggable set conditionally — this is the one entry point
  // deliberately using a disabled-not-hidden treatment, per product
  // decision, since removing drag handles while leaving cards visible
  // would look broken rather than intentionally locked.
  const _canEditPiCard=(typeof canEditSession!=='function')||canEditSession();
  return`<div class="pi-story-card${isBlocked?' blocked':''}${isManual?' manually-moved':''}" 
    draggable="${_canEditPiCard}" 
    ${_canEditPiCard?`ondragstart="piDragStart(event,'${e(story.id)}');this.dataset.dragged='1';"`:''}
    onclick="if(!this.dataset.dragged)piOpenRightPanel('${e(story.id)}');delete this.dataset.dragged;"
    ondragend="delete this.dataset.dragged;"
    id="pi-card-${e(story.id)}"
    style="cursor:${_canEditPiCard?'pointer':'not-allowed'};border-left-color:${squadColor};">
    <div class="pi-card-hdr-row">
      <span class="pi-card-id">${e(shortId)}</span>
      ${_canEditPiCard?`<button class="pi-card-remove" onclick="event.stopPropagation();piRemoveStoryFromSprint('${e(story.id)}')" title="Move to backlog">&#x2715;</button>`:''}
    </div>
    <div class="pi-card-title">${e(stmtShort)}</div>
    <div class="pi-card-meta-row">
      ${squad&&squad!=='—'?`<span class="pi-card-squad-badge" style="background:${squadColor};">${e(squad.substring(0,10))}</span>`:''}
      <span class="pi-card-dor-badge ${dorClass}">${e(dorVal)}</span>
      <span class="pi-card-pts" style="${ptsColor}">${e(ptsDisplay)}</span>
    </div>
  </div>`;
}

function piGetStoriesForSprint(sprintId){
  const stories=[];
  Object.entries(piPlan.storyAssignments||{}).forEach(([sid,asgn])=>{
    if(asgn&&asgn.sprint===sprintId){
      const story=piFindStory(sid);
      if(story)stories.push(story);
    }
  });
  return stories;
}

function piGetBacklogStories(){
  const ids=piPlan&&piPlan.backlogStoryIds||[];
  return ids.map(id=>piFindStory(id)).filter(Boolean);
}

function piFindStory(storyId){
  for(const f of scCanvas){
    if(f.stories){const st=f.stories.find(s=>s.id===storyId);if(st)return{...st,featureId:f.id};}
  }
  // Also check piStoryPool (standalone stories — PI demo board and future use)
  if(typeof piStoryPool!=='undefined'&&piStoryPool[storyId])return piStoryPool[storyId];
  return null;
}

function piIsBlocked(storyId){
  if(!piPlan||!piPlan.dependencies)return false;
  return piPlan.dependencies.some(d=>d.toId===storyId&&!d.external);
}

function piGetDepsForStory(storyId){
  if(!piPlan||!piPlan.dependencies)return[];
  return piPlan.dependencies.filter(d=>d.fromId===storyId||d.toId===storyId).map(d=>({
    ...d,
    direction:d.fromId===storyId?(d.direction||'blocks'):'blocked-by'
  }));
}

function piCheckCapacity(squads,squadColorMap){
  const warnings=[];
  if(!piPlan||!piPlan.sprints)return warnings;
  // Per-sprint, per-squad check
  piPlan.sprints.forEach(sprint=>{
    squads.forEach(sq=>{
      const pts=Object.values(piPlan.storyAssignments||{}).filter(a=>a&&a.sprint===sprint.id&&a.squad===sq.name).reduce((sum,a)=>sum+(a.points||0),0);
      if(pts>sq.capacity){
        warnings.push(`Sprint ${sprint.id}: ${sq.name} +${pts-sq.capacity} pts over`);
      }
    });
  });
  // PI-level total check: total assigned vs total squad capacity
  const totalAssigned=Object.values(piPlan.storyAssignments||{}).reduce((a,v)=>a+(v&&v.points||0),0);
  const totalCapacity=squads.reduce((a,sq)=>a+(sq.capacity||0),0);
  if(totalCapacity>0&&totalAssigned>totalCapacity){
    warnings.unshift(`Over capacity: ${totalAssigned} pts planned, ${totalCapacity} pts available (+${totalAssigned-totalCapacity} pts)`);
  }
  return warnings;
}

// ── Drag and drop ──
let piDraggingId=null;

function piDragStart(evt,storyId){
  // v9.08: per product decision, drag-and-drop uses a disabled state
  // rather than hiding the card entirely — removing drag handles while
  // keeping the card visible would look like something is broken, not
  // intentionally locked. Preventing drag start here is the actual
  // enforcement; the card's own render sets draggable=false to match.
  if(typeof canEditSession==='function'&&!canEditSession()){evt.preventDefault();return;}
  piDraggingId=storyId;
  evt.dataTransfer.effectAllowed='move';
  const card=document.getElementById('pi-card-'+storyId);
  if(card)card.classList.add('dragging');
}

function piDragOver(evt){
  evt.preventDefault();
  evt.dataTransfer.dropEffect='move';
  const col=evt.currentTarget.closest('.pi-sprint-col');
  if(col)col.style.borderColor='var(--purple)';
}

function piDrop(evt,targetSprint){
  evt.preventDefault();
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const storyId=piDraggingId;
  piDraggingId=null;
  if(!storyId)return;
  // Reset border highlights
  document.querySelectorAll('.pi-sprint-col').forEach(c=>c.style.borderColor='');
  const card=document.getElementById('pi-card-'+storyId);
  if(card)card.classList.remove('dragging');
  if(!piPlan)return;

  const prev=piPlan.storyAssignments[storyId];
  const prevSprint=prev?prev.sprint:null;
  if(prevSprint===targetSprint)return;

  // Check dependency conflict
  const blocking=piGetBlockingConflict(storyId,targetSprint);
  if(blocking){
    piShowDepConflict(storyId,targetSprint,blocking);
    return;
  }

  piMoveToPrint(storyId,targetSprint,true);
}

function piMoveToPrint(storyId,targetSprint,manual){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!piPlan)return;
  if(!piPlan.storyAssignments[storyId]){
    piPlan.storyAssignments[storyId]={sprint:targetSprint,squad:'',points:3,status:'planned'};
  } else {
    piPlan.storyAssignments[storyId].sprint=targetSprint;
  }
  if(manual)piPlan.storyAssignments[storyId].manuallyMoved=true;
  if(piPlan.backlogStoryIds)piPlan.backlogStoryIds=piPlan.backlogStoryIds.filter(id=>id!==storyId);
  piRenderBoard();
  piUpdateTabBadge();
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
    // v8.141 (item 8): mark only once the save has actually resolved
    // successfully — chained via .then(), not called from this function's
    // own top level, so a tab-switch flush can never fire before the
    // underlying data is genuinely durable.
    sessionStoreSave(_activeSessionId).then(function(ok){ if(ok&&typeof _lsMarkManualEdit==='function')_lsMarkManualEdit('pi'); });
  }
}

// ── Drop story back to backlog tray ──
function piDropToBacklog(evt){
  evt.preventDefault();
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const storyId=piDraggingId;
  piDraggingId=null;
  document.querySelectorAll('.pi-sprint-col').forEach(c=>c.style.borderColor='');
  if(!storyId||!piPlan)return;
  // Only move if currently assigned to a sprint
  if(!piPlan.storyAssignments||!piPlan.storyAssignments[storyId])return;
  piRemoveStoryFromSprint(storyId);
  piUpdateTabBadge();
}

function piRemoveStoryFromSprint(storyId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!piPlan)return;
  if(piPlan.storyAssignments[storyId])delete piPlan.storyAssignments[storyId];
  if(!piPlan.backlogStoryIds)piPlan.backlogStoryIds=[];
  if(!piPlan.backlogStoryIds.includes(storyId))piPlan.backlogStoryIds.push(storyId);
  piRenderBoard();
  // v8.141 fix (bundled with item 8): confirmed missing entirely — this
  // edit was never persisted at all, same class of gap as item 7's three
  // functions. Added here, plus the same mark-after-success chaining.
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
    sessionStoreSave(_activeSessionId).then(function(ok){ if(ok&&typeof _lsMarkManualEdit==='function')_lsMarkManualEdit('pi'); });
  }
}

// ── Remove story from backlog (v9.03: FIX 1.2 + FIX 1.1 async safety) ──
function piRemoveStoryFromBacklog(storyId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!piPlan||!piPlan.backlogStoryIds)return;
  // FIX 1.3: Idempotence guard — prevent duplicate saves/events on rapid clicks
  if(piPlan.backlogStoryIds.indexOf(storyId)===-1)return;
  
  // Snapshot current state for revert if save fails
  var oldBacklogIds=Array.isArray(piPlan.backlogStoryIds)?piPlan.backlogStoryIds.slice():[];
  
  // FIX 10.1 (v9.04): Find ORIGINAL story in scCanvas (not copy from piFindStory)
  // piFindStory returns a shallow copy via spread operator, so mutations don't persist
  var story=null;
  var featureId=null;
  if(typeof scCanvas!=='undefined'&&Array.isArray(scCanvas)){
    for(var i=0;i<scCanvas.length;i++){
      var f=scCanvas[i];
      if(f.stories&&Array.isArray(f.stories)){
        for(var j=0;j<f.stories.length;j++){
          if(f.stories[j].id===storyId){
            story=f.stories[j];
            featureId=f.id;
            break;
          }
        }
        if(story)break;
      }
    }
  }
  // Fallback: if not found in scCanvas, check piStoryPool (stories created in PI)
  if(!story&&typeof piStoryPool!=='undefined'&&piStoryPool[storyId]){
    story=piStoryPool[storyId];
  }
  if(!story)return; // Story not found
  
  var oldInPIPlan=story._inPIPlan;
  var oldStagedForPI=story._stagedForPI;
  
  // ── Mutate state optimistically ──
  piPlan.backlogStoryIds=piPlan.backlogStoryIds.filter(function(id){
    return id!==storyId;
  });
  story._inPIPlan=false;
  story._stagedForPI=false;
  
  // ── Render immediately ──
  piRenderBoard();
  piUpdateTabBadge(); // Show unsaved indicator
  
  // ── FIX 1.1: Persist with proper async value capture ──
  var saveSessionId=_activeSessionId;
  var wasSharedSession=(typeof _activeSessionIsShared!=='undefined'&&_activeSessionIsShared);
  
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&saveSessionId){
    sessionStoreSave(saveSessionId).then(function(ok){
      if(!ok){
        // REVERT on save failure
        piPlan.backlogStoryIds=oldBacklogIds;
        story._inPIPlan=oldInPIPlan;
        story._stagedForPI=oldStagedForPI;
        piRenderBoard();
        piUpdateTabBadge();
        
        // Show error to user
        if(typeof showToast==='function'){
          showToast('Failed to save backlog removal. Changes reverted. Please try again.','error');
        }
        return false;
      }
      
      // ── Save succeeded — now emit live-sync event ──
      try {
        if(typeof _lsMarkManualEdit==='function'){
          _lsMarkManualEdit('pi');
        }
      } catch(e){
        console.warn('[PI] Manual edit marker failed:',e);
      }
      
      if(wasSharedSession&&typeof _lsEmitContentEvent==='function'){
        try {
          var emitted=_lsEmitContentEvent(
            saveSessionId,
            'pi',
            'pi_plan_updated',
            null,
            null
          );
          if(emitted&&typeof emitted.catch==='function'){
            emitted.catch(function(e){
              console.warn('[PI] Live-sync event emission failed:',e);
            });
          }
        } catch(e){
          console.warn('[PI] Live-sync event emission failed:',e);
        }
      }
      
      // FIX 10.2 (v9.04): Refresh Story Canvas to reflect updated badge state
      // The story object was mutated (._inPIPlan=false), now SC needs to re-render
      // Works for both private AND shared sessions (user requested both)
      try {
        if(typeof newScRender==='function'){
          newScRender();
        }
      } catch(e){
        console.warn('[PI→SC] Story Canvas refresh failed:',e);
        // Don't block on SC render failure — save already persisted
      }
      
      return true;
    }).catch(function(e){
      console.warn('[PI] Backlog removal save threw exception:',e);
      
      // Revert on exception
      piPlan.backlogStoryIds=oldBacklogIds;
      story._inPIPlan=oldInPIPlan;
      story._stagedForPI=oldStagedForPI;
      piRenderBoard();
      piUpdateTabBadge();
      
      if(typeof showToast==='function'){
        showToast('Failed to save backlog removal. Changes reverted. Please try again.','error');
      }
    });
  }
}

function piGetBlockingConflict(storyId,targetSprint){
  if(!piPlan||!piPlan.dependencies)return null;
  // If story depends on another story that's in a later sprint
  const blockers=piPlan.dependencies.filter(d=>d.toId===storyId&&!d.external);
  for(const dep of blockers){
    const blockerAsgn=piPlan.storyAssignments[dep.fromId];
    if(blockerAsgn&&blockerAsgn.sprint>targetSprint){
      const blocker=piFindStory(dep.fromId);
      return{blocker,blockerSprint:blockerAsgn.sprint};
    }
  }
  return null;
}

function piShowDepConflict(storyId,targetSprint,conflict){
  const overlay=document.createElement('div');
  overlay.id='pi-dep-conflict-overlay';
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="max-width:380px;;position:relative;">
    <button onclick="document.getElementById('pi-dep-conflict-overlay').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    <div style="padding:16px 44px 14px 16px;border-bottom:0.5px solid var(--divider);">
      <div style="font-size:13px;font-weight:500;color:var(--t1);">Dependency conflict</div>
    </div>
    <div class="modal-body">This story depends on "${e((conflict.blocker&&conflict.blocker.statement||'a story').substring(0,60))}" which is in Sprint ${conflict.blockerSprint}. Moving here may break this dependency.</div>
    <div class="modal-footer">
      <button class="modal-cancel-btn" onclick="document.getElementById('pi-dep-conflict-overlay').remove()">Keep as-is</button>
      <button class="modal-confirm-btn" onclick="document.getElementById('pi-dep-conflict-overlay').remove();piMoveToPrint('${e(storyId)}',${targetSprint},true);piMoveToPrint('${e(conflict.blocker&&conflict.blocker.id||'')}',${targetSprint},true)">Move blocker too</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const _escDep=function(ev){if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_escDep,true);}};
  document.addEventListener('keydown',_escDep,true);
  trapFocus(overlay);
}

// ── Stale banner ──
function piShowStaleBanner(){
  const b=document.getElementById('pi-stale-banner');
  if(b)b.style.display='';
}
function piHideStaleBanner(){
  const b=document.getElementById('pi-stale-banner');
  if(b)b.style.display='none';
}

function piSyncNewStories(){
  // Additive sync — add new stories to backlog only
  const currentHash=piComputeHash();
  const prevIds=(piScVersion||'').split('|');
  const currentIds=scCanvas.map(f=>f.id);
  const newFeatureIds=currentIds.filter(id=>!prevIds.includes(id));
  const newStories=[];
  scCanvas.filter(f=>newFeatureIds.includes(f.id)&&f.stories).forEach(f=>{
    f.stories.forEach(st=>newStories.push(st.id));
  });
  if(!piPlan.backlogStoryIds)piPlan.backlogStoryIds=[];
  newStories.forEach(id=>{if(!piPlan.backlogStoryIds.includes(id))piPlan.backlogStoryIds.push(id);});
  piScVersion=currentHash;
  piHideStaleBanner();
  piRenderBoard();
}

// ── Right panel ──
let piRPStoryId=null;

function piOpenRightPanel(storyId){
  // Toggle-close: clicking the already-open story closes the panel
  if(piRPStoryId===storyId){piCloseRightPanel();return;}
  piRPStoryId=storyId;
  let panel=document.getElementById('pi-right-panel');
  if(!panel){
    panel=document.createElement('div');
    panel.id='pi-right-panel';
    panel.className='pi-right-panel';
    const piMain=document.getElementById('pi-main');
    if(piMain)piMain.appendChild(panel);
    else document.body.appendChild(panel);
  }
  panel.classList.add('open');
  piRenderRightPanel(storyId);
}

function piCloseRightPanel(){
  const panel=document.getElementById('pi-right-panel');
  if(panel)panel.classList.remove('open');
  piRPStoryId=null;
}

function piRenderRightPanel(storyId){
  const panel=document.getElementById('pi-right-panel');
  if(!panel)return;
  const shortId=storyId?storyId.replace(/[^a-z0-9]/gi,'').substring(0,6).toUpperCase():'';
  const story=piFindStory(storyId);
  if(!story){panel.innerHTML='<div class="pi-rp-scroll"><p style="padding:20px;color:var(--t3);">Story not found.</p></div>';return;}
  const asgn=(piPlan&&piPlan.storyAssignments&&piPlan.storyAssignments[storyId])||{sprint:1,squad:'',points:3};
  const feat=scCanvas.find(f=>f.stories&&f.stories.some(st=>st.id===storyId));
  const squads=piGetSquads();
  const deps=piGetDepsForStory(storyId);
  const note=(asgn.note)||'';
  const allStories=piPlan?Object.keys(piPlan.storyAssignments):[];
  // v9.08.02: computed once per panel render.
  const _canEditPiRp=(typeof canEditSession!=='function')||canEditSession();

  panel.innerHTML=`
    <div class="pi-rp-hdr" style="position:relative;">
      <div class="pi-rp-breadcrumb">
        ${feat?`<span>${e(feat.cap||feat.name||'')}</span><span style="color:var(--label)">›</span>`:''}
        <span>Sprint ${asgn.sprint||'—'}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;padding-right:32px;">
        <span class="pi-card-id">${e(shortId)}</span>
        <div class="pi-rp-title" style="flex:1;min-width:0;">${e((story.title||story.statement||'').substring(0,80))}</div>
      </div>
      <button class="pi-rp-close" onclick="piCloseRightPanel()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="pi-rp-scroll">
      <div class="pi-rp-section">
        <div class="pi-rp-section-lbl">Story statement</div>
        <div class="pi-rp-story-stmt">${e(story.statement||story.title||'')}</div>
      </div>
      ${story.scenarios&&story.scenarios.length>0?`<div class="pi-rp-section">
        <details class="pi-rp-ac-details">
          <summary class="pi-rp-section-lbl pi-rp-ac-summary">Acceptance Criteria <span class="pi-rp-ac-count">${story.scenarios.length} scenario${story.scenarios.length!==1?'s':''}</span></summary>
          ${story.scenarios.map(sc=>`<div class="pi-rp-ac-row"><div class="pi-rp-ac-name">${e(sc.name||'')}</div><div class="pi-rp-ac-line"><span class="pi-rp-ac-kw">Given</span> ${e(sc.given||'')}</div><div class="pi-rp-ac-line"><span class="pi-rp-ac-kw">When</span> ${e(sc.when||'')}</div><div class="pi-rp-ac-line"><span class="pi-rp-ac-kw">Then</span> ${e(sc.then||'')}</div></div>`).join('')}
        </details>
      </div>`:''}
      <div class="pi-rp-section">
        <div class="pi-rp-section-lbl">Planning</div>
        <div class="pi-rp-planning-row">
          <div class="pi-rp-field"><div class="pi-rp-field-lbl">Points</div>
            <span class="pi-rp-pts-badge${asgn.userSetPoints?' pi-rp-pts-user-set':''}${_canEditPiRp?'':' pi-rp-pts-badge-disabled'}" id="pi-rp-pts-${storyId}" ${_canEditPiRp?`onclick="piEditPoints('${e(storyId)}')" title="Click to edit"`:''}>${asgn.userSetPoints?(asgn.points||3)+' pts':'~'+(asgn.points||3)+' pts'}</span>
          </div>
          <div class="pi-rp-field"><div class="pi-rp-field-lbl">Squad</div>
            <select class="pi-rp-select" onchange="piUpdateAssignment('${e(storyId)}','squad',this.value)" ${_canEditPiRp?'':'disabled'}>
              <option value="">— Assign squad —</option>
              ${squads.map(sq=>`<option value="${e(sq.name)}" ${asgn.squad===sq.name?'selected':''}>${e(sq.name)}</option>`).join('')}
            </select>
          </div>
          <div class="pi-rp-field"><div class="pi-rp-field-lbl">Sprint</div>
            <select class="pi-rp-select" onchange="piUpdateAssignmentSprint('${e(storyId)}',+this.value)" ${_canEditPiRp?'':'disabled'}>
              ${piPlan.sprints.map(sp=>`<option value="${sp.id}" ${asgn.sprint===sp.id?'selected':''}>${e(sp.label)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="pi-rp-section">
        <div class="pi-rp-section-lbl">Dependencies</div>
        ${deps.length===0?'<div style="font-size:11px;color:var(--label);">No dependencies.</div>':''}
        ${deps.map(d=>`<div class="pi-rp-dep-row">
          <span class="pi-rp-dep-dir">${d.direction==='blocks'?'&#128279; This blocks':'&#9940; Blocked by'}</span>
          <span class="pi-rp-dep-name">${e((piFindStory(d.direction==='blocks'?d.toId:d.fromId)||{statement:d.toId||d.fromId}).statement||'').substring(0,50)}</span>
          <span class="pi-rp-dep-sprint">S${d.direction==='blocks'?(piPlan.storyAssignments[d.toId]||{sprint:'?'}).sprint:(piPlan.storyAssignments[d.fromId]||{sprint:'?'}).sprint}</span>
          <span class="pi-rp-dep-source ${d.source||'ai'}">${d.source==='user'?'user set':'AI inferred'}</span>
          ${_canEditPiRp?`<button class="pi-rp-dep-remove" onclick="piRemoveDep('${e(storyId)}','${e(d.fromId||'')}','${e(d.toId||'')}')">&#x2715;</button>`:''}
        </div>`).join('')}
        <div id="pi-rp-dep-form-${storyId}"></div>
        ${_canEditPiRp?`<button class="pi-rp-add-dep-link" onclick="piShowAddDepForm('${e(storyId)}')">+ Add Dependency</button>`:''}
      </div>
      <div class="pi-rp-section">
        <div class="pi-rp-section-lbl">Note <span style="font-size:9px;color:var(--label);">(exported in PI DOCX)</span></div>
        <textarea class="pi-rp-note-area" id="pi-rp-note-${storyId}" maxlength="300" ${_canEditPiRp?`onblur="piSaveNote('${e(storyId)}',this.value)"`:'readonly'}>${e(note)}</textarea>
        <div class="pi-rp-counter" id="pi-rp-note-count-${storyId}">${note.length} / 300</div>
      </div>
    </div>
    <div class="pi-rp-footer">
      <div id="pi-rp-remove-confirm-${storyId}" style="margin-bottom:6px;display:none;"></div>
      ${_canEditPiRp?`<button class="pi-rp-remove-link" onclick="piShowRemoveConfirm('${e(storyId)}')"><i class="ti ti-trash" style="font-size:10px;" aria-hidden="true"></i> Remove from PI?</button>`:''}
    </div>`;
  // Wire note counter
  const noteArea=document.getElementById('pi-rp-note-'+storyId);
  if(noteArea){noteArea.oninput=function(){const c=document.getElementById('pi-rp-note-count-'+storyId);if(c)c.textContent=this.value.length+' / 300';};}
}

function piEditPoints(storyId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const asgn=piPlan&&piPlan.storyAssignments&&piPlan.storyAssignments[storyId];
  if(!asgn)return;
  const badge=document.getElementById('pi-rp-pts-'+storyId);
  if(!badge)return;
  const current=asgn.points||3;
  badge.outerHTML=`<input class="pi-rp-pts-input" id="pi-rp-pts-${storyId}" type="number" min="1" max="20" value="${current}" onblur="piSavePoints('${storyId}',+this.value)" onkeydown="if(event.key==='Enter')this.blur()">`;
  const inp=document.getElementById('pi-rp-pts-'+storyId);
  if(inp){inp.focus();inp.select();}
}

function piSavePoints(storyId,pts){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!piPlan||!piPlan.storyAssignments[storyId])return;
  piPlan.storyAssignments[storyId].points=Math.max(1,Math.min(20,pts||3));
  piPlan.storyAssignments[storyId].userSetPoints=true;
  // Refresh board capacity bars without full re-render
  piRenderBoard();
  piOpenRightPanel(storyId);
  // v8.133 fix (item 7): confirmed live — this edit was never persisted at
  // all, for anyone, shared or not. Matches the exact save-guard already
  // used by every other manual-edit function in this file.
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
    sessionStoreSave(_activeSessionId).then(function(ok){ if(ok&&typeof _lsMarkManualEdit==='function')_lsMarkManualEdit('pi'); });
  }
}

function piUpdateAssignment(storyId,field,value){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!piPlan||!piPlan.storyAssignments[storyId])return;
  piPlan.storyAssignments[storyId][field]=value;
  piRenderBoard();
  piOpenRightPanel(storyId);
  // v8.133 fix (item 7): see piSavePoints() above for the full rationale.
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
    sessionStoreSave(_activeSessionId).then(function(ok){ if(ok&&typeof _lsMarkManualEdit==='function')_lsMarkManualEdit('pi'); });
  }
}

function piUpdateAssignmentSprint(storyId,newSprint){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const conflict=piGetBlockingConflict(storyId,newSprint);
  if(conflict){piShowDepConflict(storyId,newSprint,conflict);return;}
  piMoveToPrint(storyId,newSprint,false);
  piOpenRightPanel(storyId);
}

function piSaveNote(storyId,note){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!piPlan||!piPlan.storyAssignments[storyId])return;
  piPlan.storyAssignments[storyId].note=note;
  // v8.133 fix (item 7): see piSavePoints() above for the full rationale.
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
    sessionStoreSave(_activeSessionId).then(function(ok){ if(ok&&typeof _lsMarkManualEdit==='function')_lsMarkManualEdit('pi'); });
  }
}


function piShowAddDepForm(storyId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const container=document.getElementById('pi-rp-dep-form-'+storyId);
  if(!container)return;
  const allOtherStories=piGetAllStories().filter(s=>s.id!==storyId).sort((a,b)=>(a.id||'').localeCompare(b.id||''));
  container.innerHTML=`<div class="pi-rp-add-dep-form">
    <div class="pi-rp-dir-toggle">
      <button class="pi-rp-dir-btn active" id="dep-dir-blocks-${e(storyId)}" onclick="piSetDepDir('blocks','${e(storyId)}')">This Blocks &rarr;</button>
      <button class="pi-rp-dir-btn" id="dep-dir-blocked-${e(storyId)}" onclick="piSetDepDir('blocked-by','${e(storyId)}')">&#8592; Blocked By</button>
      <button class="pi-rp-dir-btn" id="dep-dir-external-${e(storyId)}" onclick="piSetDepDir('external','${e(storyId)}')">&#9881; External</button>
    </div>
    <div id="dep-story-select-${e(storyId)}">
      <div style="position:relative;margin-bottom:6px;">
        <input type="text" id="pi-dep-search-${e(storyId)}" placeholder="Search stories…" oninput="piFilterDepSearch('${e(storyId)}')" autocomplete="off"
          style="width:100%;height:28px;border:1px solid var(--divider);border-radius:5px;padding:0 8px;font-size:11px;font-family:var(--font);box-sizing:border-box;"/>
        <div id="pi-dep-list-drop-${e(storyId)}" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--divider);border-radius:5px;max-height:160px;overflow-y:auto;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
          ${allOtherStories.map(s=>`<div class="nsc-dep-option" data-id="${e(s.id)}" onclick="piSelectDepStory('${e(storyId)}','${e(s.id)}','${e((s.title||s.statement||'').substring(0,60)).replace(/'/g,"&#39;")}')" style="padding:6px 10px;font-size:10px;cursor:pointer;border-bottom:1px solid var(--divider);color:var(--t2);">[${e(s.id)}] ${e((s.title||s.statement||'').substring(0,55))}</div>`).join('')||'<div style="padding:8px 10px;font-size:10px;color:var(--label);">No other stories yet.</div>'}
        </div>
      </div>
      <div id="pi-dep-selected-${e(storyId)}" style="font-size:10px;color:var(--purple);margin-bottom:6px;min-height:16px;"></div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="cc-btn-primary" style="width:auto;padding:5px 12px;font-size:11px;" onclick="piLinkDep('${e(storyId)}')">Link &#10003;</button>
      <button class="pi-rp-cancel" onclick="document.getElementById('pi-rp-dep-form-${e(storyId)}').innerHTML=''">Cancel</button>
    </div>
  </div>`;
  container._currentDir='blocks';
}

function piSetDepDir(dir,storyId){
  const container=document.getElementById('pi-rp-dep-form-'+storyId);
  if(container)container._currentDir=dir;
  ['blocks','blocked','external'].forEach(d=>{
    const btn=document.getElementById('dep-dir-'+d+'-'+storyId);
    if(btn)btn.classList.toggle('active',d===dir||(dir==='blocked-by'&&d==='blocked'));
  });
  const sel=document.getElementById('dep-story-select-'+storyId);
  if(sel){
    if(dir==='external'){
      sel.innerHTML=`<textarea class="pi-rp-note-area" id="dep-ext-desc-${e(storyId)}" placeholder="Describe the external dependency..." rows="2" maxlength="300"></textarea>`;
    } else {
      const allOtherStories=piGetAllStories().filter(s=>s.id!==storyId);
      sel.innerHTML=`<div style="position:relative;margin-bottom:6px;">
        <input type="text" id="pi-dep-search-${e(storyId)}" placeholder="Search stories…" oninput="piFilterDepSearch('${e(storyId)}')" autocomplete="off"
          style="width:100%;height:28px;border:1px solid var(--divider);border-radius:5px;padding:0 8px;font-size:11px;font-family:var(--font);box-sizing:border-box;"/>
        <div id="pi-dep-list-drop-${e(storyId)}" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--divider);border-radius:5px;max-height:160px;overflow-y:auto;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
          ${allOtherStories.map(s=>`<div class="nsc-dep-option" data-id="${e(s.id)}" onclick="piSelectDepStory('${e(storyId)}','${e(s.id)}','${e((s.title||s.statement||'').substring(0,60)).replace(/'/g,"&#39;")}')" style="padding:6px 10px;font-size:10px;cursor:pointer;border-bottom:1px solid var(--divider);color:var(--t2);">[${e(s.id)}] ${e((s.title||s.statement||'').substring(0,55))}</div>`).join('')||'<div style="padding:8px 10px;font-size:10px;color:var(--label);">No stories yet.</div>'}
        </div>
      </div>
      <div id="pi-dep-selected-${e(storyId)}" style="font-size:10px;color:var(--purple);margin-bottom:6px;min-height:16px;"></div>`;
    }
  }
}

// ── PI dep search state ──
let _piDepSelectedId='';
let _piDepSelectedTitle='';

function piFilterDepSearch(storyId){
  const inp=document.getElementById('pi-dep-search-'+storyId);
  const drop=document.getElementById('pi-dep-list-drop-'+storyId);
  if(!inp||!drop)return;
  const q=inp.value.trim().toLowerCase();
  drop.style.display='block';
  Array.from(drop.querySelectorAll('.nsc-dep-option')).forEach(opt=>{
    opt.style.display=opt.textContent.toLowerCase().includes(q)||!q?'':'none';
  });
}

function piSelectDepStory(storyId,targetId,targetTitle){
  _piDepSelectedId=targetId;
  _piDepSelectedTitle=targetTitle;
  const inp=document.getElementById('pi-dep-search-'+storyId);
  const drop=document.getElementById('pi-dep-list-drop-'+storyId);
  const sel=document.getElementById('pi-dep-selected-'+storyId);
  if(inp)inp.value='';
  if(drop)drop.style.display='none';
  if(sel)sel.textContent='Selected: ['+targetId+'] '+targetTitle;
}

function piLinkDep(storyId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const container=document.getElementById('pi-rp-dep-form-'+storyId);
  const dir=container&&container._currentDir||'blocks';
  if(!piPlan)return;
  if(!piPlan.dependencies)piPlan.dependencies=[];
  if(dir==='external'){
    const desc=document.getElementById('dep-ext-desc-'+storyId);
    if(desc&&desc.value){
      if(!piPlan.externalDeps)piPlan.externalDeps=[];
      piPlan.externalDeps.push({storyId,description:desc.value});
    }
  }else{
    const targetId=_piDepSelectedId;
    if(!targetId){showToast('Select a story first.','warn');return;}
    const fromId=dir==='blocks'?storyId:targetId;
    const toId=dir==='blocks'?targetId:storyId;
    piPlan.dependencies.push({fromId,toId,direction:'blocks',source:'user',external:false});
    _piDepSelectedId='';
    _piDepSelectedTitle='';
  }
  container.innerHTML='';
  piRenderRightPanel(storyId);
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
    sessionStoreSave(_activeSessionId).then(function(ok){ if(ok&&typeof _lsMarkManualEdit==='function')_lsMarkManualEdit('pi'); });
  }
}

function piRemoveDep(storyId,fromId,toId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!piPlan||!piPlan.dependencies)return;
  piPlan.dependencies=piPlan.dependencies.filter(d=>!(d.fromId===fromId&&d.toId===toId));
  piRenderBoard();
  piRenderRightPanel(storyId);
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId){
    sessionStoreSave(_activeSessionId).then(function(ok){ if(ok&&typeof _lsMarkManualEdit==='function')_lsMarkManualEdit('pi'); });
  }
}

function piShowRemoveConfirm(storyId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const container=document.getElementById('pi-rp-remove-confirm-'+storyId);
  if(!container)return;
  container.style.display='block';
  container.innerHTML=`<div class="pi-rp-confirm-strip">
    <span class="pi-rp-confirm-note">Story moves to Backlog Tray. You can re-plan it from there.</span>
    <button class="pi-rp-cancel" onclick="document.getElementById('pi-rp-remove-confirm-${storyId}').style.display='none';document.getElementById('pi-rp-remove-confirm-${storyId}').innerHTML=''">Cancel</button>
    <button class="pi-rp-confirm-yes" onclick="piRemoveStoryFromSprint('${e(storyId)}');piCloseRightPanel()">Yes, Remove</button>
  </div>`;
}

// ── Highlight feature (called from Story Canvas) ──
function piHighlightFeature(featureId){}

// ── Export DOCX (triggers export-pi-docx.js) ──
function piExportDocx(){
  if(typeof buildAndDownloadPIDocx==='function'){
    buildAndDownloadPIDocx();
  } else {
    showToast('PI DOCX export module not loaded.','error');
  }
}

// ── Backlog story right panel — same as piOpenRightPanel but without sprint assignment ──
function piOpenBacklogPanel(storyId){
  // Toggle-close: clicking the already-open story closes the panel
  if(piRPStoryId===storyId){piCloseRightPanel();return;}
  piRPStoryId=storyId;
  let panel=document.getElementById('pi-right-panel');
  if(!panel){
    panel=document.createElement('div');
    panel.id='pi-right-panel';
    panel.className='pi-right-panel';
    const piMain=document.getElementById('pi-main');
    if(piMain)piMain.appendChild(panel);
    else document.body.appendChild(panel);
  }
  panel.classList.add('open');
  const story=piFindStory(storyId);
  if(!story){panel.innerHTML='<div class="pi-rp-scroll"><p style="padding:20px;color:var(--t3);">Story not found.</p></div>';return;}
  const feat=scCanvas.find(f=>f.stories&&f.stories.some(st=>st.id===storyId));
  const asgn=(piPlan&&piPlan.storyAssignments&&piPlan.storyAssignments[storyId])||{points:story.points||3};
  const note=(asgn.note)||'';
  const squads=piGetSquads();
  const shortId=storyId?storyId.replace(/[^a-z0-9]/gi,'').substring(0,6).toUpperCase():'';
  // v9.08.02: computed once per backlog panel render.
  const _canEditPiBlRp=(typeof canEditSession!=='function')||canEditSession();
  panel.innerHTML=`
    <div class="pi-rp-hdr" style="position:relative;">
      <div class="pi-rp-breadcrumb">
        ${feat?`<span>${e(feat.cap||feat.name||'')}</span><span style="color:var(--label)">›</span>`:''}
        <span style="color:var(--amber);font-weight:600;">Backlog</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;padding-right:32px;">
        <span class="pi-card-id">${e(shortId)}</span>
        <div class="pi-rp-title" style="flex:1;min-width:0;">${e((story.title||story.statement||'').substring(0,80))}</div>
      </div>
      <button class="pi-rp-close" onclick="piCloseRightPanel()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="pi-rp-scroll">
      <div class="pi-rp-section">
        <div class="pi-rp-section-lbl">Story Statement</div>
        <div class="pi-rp-story-stmt">${e(story.statement||story.title||'')}</div>
      </div>
      ${story.scenarios&&story.scenarios.length>0?`<div class="pi-rp-section">
        <details class="pi-rp-ac-details">
          <summary class="pi-rp-section-lbl pi-rp-ac-summary">Acceptance Criteria <span class="pi-rp-ac-count">${story.scenarios.length} scenario${story.scenarios.length!==1?'s':''}</span></summary>
          ${story.scenarios.map(sc=>`<div class="pi-rp-ac-row"><div class="pi-rp-ac-name">${e(sc.name||'')}</div><div class="pi-rp-ac-line"><span class="pi-rp-ac-kw">Given</span> ${e(sc.given||'')}</div><div class="pi-rp-ac-line"><span class="pi-rp-ac-kw">When</span> ${e(sc.when||'')}</div><div class="pi-rp-ac-line"><span class="pi-rp-ac-kw">Then</span> ${e(sc.then||'')}</div></div>`).join('')}
        </details>
      </div>`:''}
      <div class="pi-rp-section">
        <div class="pi-rp-section-lbl">Planning</div>
        <div class="pi-rp-planning-row" style="align-items:center;gap:12px;">
          <div class="pi-rp-field"><div class="pi-rp-field-lbl">Points</div>
            <span class="pi-rp-pts-badge${asgn.userSetPoints?' pi-rp-pts-user-set':''}${_canEditPiBlRp?'':' pi-rp-pts-badge-disabled'}" id="pi-rp-pts-${storyId}" ${_canEditPiBlRp?`onclick="piEditPointsBacklog('${e(storyId)}')" title="Click to edit"`:''}>${asgn.userSetPoints?(asgn.points||3)+' pts':'~'+(asgn.points||3)+' pts'}</span>
          </div>
          <div class="pi-rp-field"><div class="pi-rp-field-lbl">Move to Sprint</div>
            <select class="pi-rp-select" onchange="piMoveBacklogToSprint('${e(storyId)}',+this.value)" ${_canEditPiBlRp?'':'disabled'}>
              <option value="">— Assign to sprint —</option>
              ${piPlan&&piPlan.sprints?piPlan.sprints.map(sp=>`<option value="${sp.id}">${e(sp.label)}</option>`).join(''):''}
            </select>
          </div>
        </div>
      </div>
      <div class="pi-rp-section">
        <div class="pi-rp-section-lbl">Note</div>
        <textarea class="pi-rp-note-area" id="pi-rp-note-bl-${storyId}" maxlength="300" ${_canEditPiBlRp?`onblur="piSaveNote('${e(storyId)}',this.value)"`:'readonly'}>${e(note)}</textarea>
      </div>
    </div>`;
}

function piMoveBacklogToSprint(storyId, sprintId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!sprintId||!piPlan)return;
  piMoveToPrint(storyId, sprintId, true);
  piCloseRightPanel();
  if(!_isDemoSession&&typeof sessionStoreSave==='function'&&typeof _activeSessionId!=='undefined'&&_activeSessionId)sessionStoreSave(_activeSessionId);
}

// ── Edit points in backlog right panel ──
function piEditPointsBacklog(storyId){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  const asgn=(piPlan&&piPlan.storyAssignments&&piPlan.storyAssignments[storyId])||{points:3};
  const badge=document.getElementById('pi-rp-pts-'+storyId);
  if(!badge)return;
  const current=asgn.points||3;
  badge.outerHTML=`<input class="pi-rp-pts-input" id="pi-rp-pts-${storyId}" type="number" min="1" max="20" value="${current}" onblur="piSavePointsBacklog('${storyId}',+this.value)" onkeydown="if(event.key==='Enter')this.blur()">`;
  const inp=document.getElementById('pi-rp-pts-'+storyId);
  if(inp){inp.focus();inp.select();}
}

function piSavePointsBacklog(storyId,pts){
  if(typeof canEditSession==='function'&&!canEditSession())return;
  if(!piPlan){
    // Story not in plan yet — store on storyAssignments anyway
    if(!piPlan)piPlan={storyAssignments:{}};
  }
  if(!piPlan.storyAssignments)piPlan.storyAssignments={};
  if(!piPlan.storyAssignments[storyId])piPlan.storyAssignments[storyId]={points:3};
  piPlan.storyAssignments[storyId].points=Math.max(1,Math.min(20,pts||3));
  piPlan.storyAssignments[storyId].userSetPoints=true;
  // Re-open backlog panel to show updated value
  piOpenBacklogPanel(storyId);
}

// ── piToggleLeftPanel for PI left panel collapse ──
// ── PI tab badge ──
function piUpdateTabBadge(){
  const badge=document.getElementById('pi-tab-badge');
  if(!badge)return;
  const total=piPlan?Object.keys(piPlan.storyAssignments||{}).length:0;
  badge.textContent=total;
  badge.classList.toggle('on',total>0);
}

function piToggleLeftPanel(){
  const lp=document.getElementById('pi-left');
  if(!lp)return;
  const isCollapsed=lp.classList.toggle('pi-left-collapsed');
  // Update collapse button chevron — no separate IDs, update innerHTML directly
  const btn=document.getElementById('pi-collapse-btn');
  if(btn){
    btn.innerHTML=isCollapsed
      ?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/><polyline points="3 18 9 12 3 6"/></svg>'
      :'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/><polyline points="21 18 15 12 21 6"/></svg>';
  }
}

// ── piSetStartDate — persist selected date to state ──
function piSetStartDate(val){
  if(!val)return;
  if(typeof piPlan!=='undefined'&&piPlan){piPlan.startDate=val;}
  const inp=document.getElementById('pi-start-date');
  if(inp)inp.value=val;
}

// ── piFormatDate — format YYYY-MM-DD as "DD Mon YYYY" ──
function piFormatDate(dateStr){
  if(!dateStr)return'—';
  try{
    const d=new Date(dateStr+'T00:00:00');
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  }catch(e){return dateStr;}
}

// ── Backlog tray drag-to-resize ──
function piBacklogResizeStart(e){
  e.preventDefault();
  const tray=document.getElementById('pi-backlog-tray');
  if(!tray)return;
  const startY=e.clientY;
  const startH=tray.offsetHeight;
  function onMove(ev){
    const delta=startY-ev.clientY; // dragging up = increase height
    const newH=Math.max(60,Math.min(400,startH+delta));
    tray.style.height=newH+'px';
  }
  function onUp(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}
