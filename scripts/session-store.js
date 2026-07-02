// SESSION STORE — v8.24
// localStorage abstraction layer for session persistence.
// All reads/writes to localStorage go through this file only.
// Other files call: sessionStoreCreate, sessionStoreSave, sessionStoreRestore,
//                   sessionStoreDelete, sessionStoreList, sessionStoreRename,
//                   sessionStoreSyncFromDB
//
// Step 6 (v8.24): write-through cache pattern.
//   - localStorage: fast local cache (all reads)
//   - Supabase:     authoritative store (all writes + sync on login)
//   - Failure mode: Supabase errors are logged and silently skipped;
//                   localStorage always written first so the app never blocks.

// ── Constants ──
const _SS_PREFIX = 'pgt_session_';
const _SS_INDEX  = 'pgt_session_index'; // ordered list of session IDs

// Active session ID — set by sessionStoreCreate, cleared by homeClearSession
var _activeSessionId = null;

// ── Supabase client helper ──
// Returns the initialised Supabase client, or null if unavailable.
// All DB functions call this first and skip silently if null.
function _ssGetClient() {
  return (typeof authInit === 'function') ? authInit() : null;
}

// ── Private DB upsert helper ──
// Maps a session entry { meta, snapshot } to the Supabase sessions table schema.
// Used by both sessionStoreCreate and sessionStoreSave to avoid duplication.
// Requires currentUser global (set in main.js after auth gate).
// Skips silently if client unavailable or currentUser not set.
async function _ssUpsertToDB(sessionId, entry) {
  const client = _ssGetClient();
  if (!client) return;
  const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  if (!uid) {
    console.warn('sessionStore: no currentUser, skipping DB write');
    return;
  }
  const meta = entry.meta;
  try {
    const { error } = await client.from('sessions').upsert({
      id:           sessionId,
      user_id:      uid,
      name:         meta.name         || 'Session',
      product_name: meta.productName  || '',
      company_name: meta.companyName  || '',
      product_type: meta.productType  || '',
      approach:     meta.approach     || '',
      last_tab:     meta.lastTab      || 'mm',
      last_stage:   meta.lastStage    || '',
      counts:       meta.counts       || {},
      snapshot:     entry.snapshot    || {},
      saved_at:     new Date(meta.savedAt || Date.now()).toISOString()
    }, { onConflict: 'id' });
    if (error) console.warn('sessionStore DB upsert failed:', error.message);
  } catch(e) {
    console.warn('sessionStore DB upsert exception:', e);
  }
}

// ── Public API ──

// Sync all sessions from Supabase into localStorage.
// Called once on login (main.js DOMContentLoaded), before homeInit().
// Replaces any stale local data with the authoritative DB state.
// On Supabase error: logs warning and leaves localStorage unchanged.
async function sessionStoreSyncFromDB() {
  const client = _ssGetClient();
  if (!client) return;
  try {
    const { data, error } = await client
      .from('sessions')
      .select('*')
      .order('saved_at', { ascending: false });

    if (error) {
      console.warn('sessionStoreSyncFromDB: Supabase query failed:', error.message);
      return;
    }
    if (!data || data.length === 0) {
      // No sessions in DB — clear local index so stale entries don't show
      try { localStorage.setItem(_SS_INDEX, JSON.stringify([])); } catch(e) {}
      return;
    }

    // Write each row into localStorage in { meta, snapshot } shape
    const ids = [];
    data.forEach(function(row) {
      const meta = {
        id:          row.id,
        name:        row.name        || 'Session',
        productName: row.product_name || '',
        companyName: row.company_name || '',
        productType: row.product_type || '',
        approach:    row.approach     || '',
        lastTab:     row.last_tab     || 'mm',
        lastStage:   row.last_stage   || '',
        counts:      row.counts       || { caps: 0, features: 0, stories: 0, sprintActive: null },
        createdAt:   row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        savedAt:     row.saved_at   ? new Date(row.saved_at).getTime()   : Date.now()
      };
      try {
        // Fix 3 (v8.38): protect against stale Supabase snapshot overwriting
        // a locally-cleared downstream state after DM regeneration.
        // If local snapshot has a newer dmRegenAt, preserve its downstream keys.
        var remoteSnapshot = row.snapshot || {};
        try {
          var localRaw = localStorage.getItem(_SS_PREFIX + row.id);
          if (localRaw) {
            var localEntry = JSON.parse(localRaw);
            var localSnap = (localEntry && localEntry.snapshot) || {};
            var localRegenAt = localSnap.dmRegenAt || 0;
            var remoteRegenAt = remoteSnapshot.dmRegenAt || 0;
            if (localRegenAt > remoteRegenAt) {
              // Local cleared more recently — preserve local downstream keys
              remoteSnapshot = Object.assign({}, remoteSnapshot, {
                capStore:   localSnap.capStore,
                scCanvas:   localSnap.scCanvas,
                piPlan:     localSnap.piPlan,
                dmRegenAt:  localSnap.dmRegenAt
              });
            }
          }
        } catch(e) {}
        localStorage.setItem(_SS_PREFIX + row.id, JSON.stringify({
          meta,
          snapshot: remoteSnapshot
        }));
        ids.push(row.id);
      } catch(e) {
        console.warn('sessionStoreSyncFromDB: localStorage write failed for', row.id, e);
      }
    });

    // Rebuild index from DB order (saved_at desc)
    try { localStorage.setItem(_SS_INDEX, JSON.stringify(ids)); } catch(e) {}

  } catch(e) {
    console.warn('sessionStoreSyncFromDB exception:', e);
  }
}

// Create a new session entry. Called at Launch Session.
// Returns the new sessionId.
function sessionStoreCreate(sc) {
  const id = _ssUUID();
  const productName = (sc && sc.productProfile && sc.productProfile.productName) || 'Session';
  const now = Date.now();
  let name = _ssAutoName(productName, now);
  // Ensure name is unique across existing sessions
  const _existingNames=new Set();
  _ssGetIndex().forEach(function(eid){
    try{var raw=localStorage.getItem(_SS_PREFIX+eid);if(raw){var entry=JSON.parse(raw);if(entry&&entry.meta&&entry.meta.name)_existingNames.add(entry.meta.name.trim().toLowerCase());}}catch(e){}
  });
  if(_existingNames.has(name.trim().toLowerCase())){
    var _n=2;
    while(_existingNames.has((name+' ('+_n+')').trim().toLowerCase()))_n++;
    name=name+' ('+_n+')';
  }

  const meta = {
    id,
    name,
    createdAt: now,
    savedAt: now,
    lastTab: 'mm',
    lastStage: 'Discovery Map',
    productName,
    companyName: (sc && sc.companyProfile && sc.companyProfile.companyName) || '',
    productType: (sc && sc.productProfile && sc.productProfile.productType) || '',
    approach: (sc && sc.approach) || 'outcome-based',
    generationMode: (sc && sc.generationMode) || 'ai-generated',
    counts: { caps: 0, features: 0, stories: 0, sprintActive: null }
  };

  const snapshot = _sessionStoreBuildSnapshot();

  // Write to localStorage first — synchronous, instant
  try {
    localStorage.setItem(_SS_PREFIX + id, JSON.stringify({ meta, snapshot }));
    _ssAddToIndex(id);
  } catch(e) {
    console.warn('sessionStoreCreate localStorage failed:', e);
    return null;
  }

  _activeSessionId = id;

  // Fix 1 (v8.40): show session name in header immediately on launch
  if(typeof hdrSetSessionName==='function') hdrSetSessionName(name);

  // Async DB write — fire and forget, does not block return
  (async function() {
    try {
      await _ssUpsertToDB(id, { meta, snapshot });
    } catch(e) {
      console.warn('sessionStoreCreate DB write failed:', e);
    }
  })();

  return id;
}

// Save current state to the active session.
// Called after every meaningful state mutation.
function sessionStoreSave(sessionId) {
  if (!sessionId) return;
  try {
    const raw = localStorage.getItem(_SS_PREFIX + sessionId);
    const entry = raw ? JSON.parse(raw) : { meta: {}, snapshot: {} };

    // Build snapshot with wireframe compression
    let snapshot = _sessionStoreBuildSnapshot({ persistWireframe: true });
    const lastStage = _ssComputeLastStage();
    const counts = _ssComputeCounts();
    const now = Date.now();

    entry.meta.savedAt = now;
    // Only update lastTab on user-initiated saves — not during session restore (v8.38)
    if (!_ssRestoring) {
      entry.meta.lastTab = (typeof curTab !== 'undefined' && curTab !== 'home') ? curTab : (entry.meta.lastTab || 'mm');
    }
    entry.meta.lastStage = lastStage;
    entry.meta.counts = counts;
    entry.snapshot = snapshot;

    // ── Size guard — check BEFORE writing to localStorage ──
    // Build → stringify → check → if oversized rebuild without wireframe → write
    let json = JSON.stringify(entry);
    if (json.length > 3500000) {
      // Rebuild snapshot without wireframe compression
      snapshot = _sessionStoreBuildSnapshot({ persistWireframe: false });
      entry.snapshot = snapshot;
      json = JSON.stringify(entry);
      console.warn('[SS] Session too large to store wireframe — stripping. Size:', json.length);
      if (typeof showToast === 'function') {
        showToast('Session too large to store wireframe. Wireframe will need regeneration on next restore.', 'warn');
      }
    }

    // Write to localStorage first — synchronous, instant
    localStorage.setItem(_SS_PREFIX + sessionId, json);
    _ssShowSaved();

    // Async DB write — fire and forget, does not block callers
    // Re-reads from localStorage to get exact entry written (including stripped version if applicable)
    (async function() {
      try {
        const saved = localStorage.getItem(_SS_PREFIX + sessionId);
        if (saved) await _ssUpsertToDB(sessionId, JSON.parse(saved));
      } catch(e) {
        console.warn('sessionStoreSave DB write failed:', e);
      }
    })();

  } catch(e) {
    console.warn('sessionStoreSave failed:', e);
  }
}

// Load a session by ID — returns { meta, snapshot } or null
function sessionStoreLoad(sessionId) {
  try {
    const raw = localStorage.getItem(_SS_PREFIX + sessionId);
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    console.warn('sessionStoreLoad failed:', e);
    return null;
  }
}

// ── _ssRestoring guard ──
// Prevents switchTab() from overwriting lastTab during session restore.
// Set true at start of restore, false after completion.
var _ssRestoring = false;
var _ssLastTabTimer = null;
// ── _activeSessionName ──
// In-memory source of truth for current session name.
// Always maintained via hdrSetSessionName() — never set directly.
// Used by mmRenderSessionPanel() to avoid stale localStorage reads.
var _activeSessionName = '';

// ── Header session name display (v8.39) ──
// ── mmUpdateSessionName — direct DOM update for left panel session name ──
function mmUpdateSessionName(name){
  var el=document.getElementById('mm-ph-sub');
  if(el)el.textContent=(name||'').trim();
}

// ── hdrApplySessionNameVisibility ──
// Separation of concerns: this function ONLY controls show/hide of the header name.
// It reads el.textContent (never clears it) and curTab to decide visibility.
// Called from hdrSetSessionName, switchTab, and hdrRenameSession close/save.
function hdrApplySessionNameVisibility(){
  var el=document.getElementById('hdr-product-name');
  var btn=document.getElementById('hdr-session-rename-btn');
  if(!el)return;
  var hasName=!!(el.textContent||'').trim();
  var onHome=(typeof curTab!=='undefined'&&curTab==='home');
  el.classList.toggle('has-name',hasName);
  if(onHome||!hasName){
    el.style.display='none';
    if(btn)btn.style.display='none';
  } else {
    el.style.display='';
    if(btn)btn.style.display='';
  }
}

// ── hdrSetSessionName ──
// Value-oriented: sets the session name text, then delegates visibility to hdrApplySessionNameVisibility.
// On Home tab: preserves the name in el.textContent (non-destructive), hides the element.
// Never clears el.textContent when on Home — that would break tab-return restore.
function hdrSetSessionName(name){
  var el=document.getElementById('hdr-product-name');
  if(!el)return;
  var cleanName=(name||'').trim();
  // Maintain in-memory source of truth (v8.45)
  if(cleanName){
    _activeSessionName=cleanName;
    el.textContent=cleanName;
  } else if(typeof curTab==='undefined'||curTab!=='home'){
    // Non-home with empty name: genuine clear (logout/session end)
    _activeSessionName='';
    el.textContent='';
  }
  // Visibility delegated entirely to hdrApplySessionNameVisibility
  hdrApplySessionNameVisibility();
  // Sync left panel — only when we have a real name
  if(typeof mmUpdateSessionName==='function'&&cleanName){
    mmUpdateSessionName(cleanName);
  }
}


function hdrRenameSession(event){
  if(event){event.preventDefault();event.stopPropagation();}
  var wrap=document.getElementById('hdr-session-wrap');
  var el=document.getElementById('hdr-product-name');
  if(!wrap||!el)return;
  // Idempotency guard
  var existingInput=wrap.querySelector('input.hdr-session-name-input');
  if(existingInput){existingInput.focus();existingInput.select();return;}
  var oldValue=(el.textContent||'').trim();
  var inp=document.createElement('input');
  inp.type='text';
  inp.className='hdr-session-input hdr-session-name-input';  // hdr-session-input carries white colour from CSS
  inp.value=oldValue;
  // No text-transform:uppercase — session names display in natural case
  inp.style.cssText='height:24px;max-width:260px;min-width:120px;font-size:11px;letter-spacing:1px;font-weight:600;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.3);border-radius:4px;color:#fff;-webkit-text-fill-color:#fff;padding:2px 6px;outline:none;';
  var closed=false;
  function _restoreVisibility(){
    if(typeof hdrApplySessionNameVisibility==='function'){
      hdrApplySessionNameVisibility();
    } else {
      el.style.display=(typeof curTab!=='undefined'&&curTab==='home')?'none':((el.textContent||'').trim()?'':'none');
    }
  }
  function _closeWithoutSaving(){
    if(closed)return;
    closed=true;
    if(inp.parentNode)inp.parentNode.removeChild(inp);
    _restoreVisibility();
  }
  function _save(){
    if(closed)return;
    var trimmed=(inp.value||'').trim();
    if(!trimmed){_closeWithoutSaving();return;}
    closed=true;
    if(inp.parentNode)inp.parentNode.removeChild(inp);
    el.textContent=trimmed;
    if(typeof sessionStoreRename==='function'&&_activeSessionId)sessionStoreRename(_activeSessionId,trimmed);
    // Let hdrSetSessionName decide visibility — do not set display directly
    if(typeof hdrSetSessionName==='function')hdrSetSessionName(trimmed);
    else _restoreVisibility();
  }
  // Hide original element — preserves all classes and ID intact
  el.style.display='none';
  wrap.insertBefore(inp,el.nextSibling);
  inp.addEventListener('mousedown',function(e){e.stopPropagation();});
  inp.addEventListener('click',function(e){e.stopPropagation();});
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();e.stopPropagation();_save();}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();_closeWithoutSaving();}
  });
  inp.addEventListener('blur',function(){if(!closed)_closeWithoutSaving();});
  inp.focus();
  inp.select();
}


// ── sessionStoreSyncRestoredSessionName ──
// Final authoritative UI sync after session restore.
// Must be called AFTER curTab is final and all DOM rebuilds are complete.
// Both header and left panel are updated from a single authoritative source.
function sessionStoreSyncRestoredSessionName(name){
  var cleanName=(name||'').trim();
  if(typeof hdrSetSessionName==='function'){
    hdrSetSessionName(cleanName);
  }
  if(typeof mmUpdateSessionName==='function'){
    mmUpdateSessionName(cleanName);
  }
}

// ── sessionStoreUpdateLastTab ──
// Lightweight synchronous localStorage-only lastTab write.
// Called from switchTab() via 300ms debounce — does not trigger Supabase write.
// Full sessionStoreSave() will pick up the new lastTab on next data action.
function sessionStoreUpdateLastTab(tab){
  if(!_activeSessionId||_ssRestoring)return;
  try{
    var raw=localStorage.getItem(_SS_PREFIX+_activeSessionId);
    if(!raw)return;
    var entry=JSON.parse(raw);
    if(entry&&entry.meta){
      entry.meta.lastTab=tab;
      localStorage.setItem(_SS_PREFIX+_activeSessionId,JSON.stringify(entry));
    }
  }catch(e){
    console.warn('sessionStoreUpdateLastTab failed:',e);
  }
}

// Restore a session — writes all state vars, reveals tabs, navigates to lastTab
function sessionStoreRestore(sessionId) {
  const entry = sessionStoreLoad(sessionId);
  if (!entry || !entry.snapshot) {
    showToast('Could not load session — data may be corrupted.', 'warn');
    return;
  }

  _ssRestoring = true;  // prevent switchTab from overwriting lastTab during restore

  // Clear current session first (saves it if active)
  // Must happen BEFORE setting _activeSessionId to avoid double-active badge
  if (typeof homeClearSession === 'function') homeClearSession();

  const s = entry.snapshot;
  const meta = entry.meta;

  // Restore all state
  if (s.sessionContext !== undefined) sessionContext = s.sessionContext;
  if (s.gData !== undefined) gData = s.gData;
  if (s.productContext !== undefined) productContext = s.productContext;
  if (s.capStore !== undefined) capStore = s.capStore;
  if (s.scCanvas !== undefined) scCanvas = s.scCanvas;
  // Restore story ID counter — use max(saved, highest ST-NNN found in canvas)
  // to prevent collisions on session resume regardless of how stories were created
  if(typeof scStoryIdCounter!=='undefined'){
    var _savedCtr=s.scStoryIdCounter||0;
    var _maxFromCanvas=_savedCtr;
    if(s.scCanvas){
      s.scCanvas.forEach(function(f){
        (f.stories||[]).forEach(function(st){
          if(st.id&&st.id.startsWith('ST-')){
            var _n=parseInt(st.id.replace('ST-',''),10);
            if(!isNaN(_n)&&_n>_maxFromCanvas)_maxFromCanvas=_n;
          }
        });
      });
    }
    scStoryIdCounter=_maxFromCanvas;
  }
  if (s.piPlan !== undefined) piPlan = s.piPlan;
  if (s.piInputs !== undefined) piInputs = s.piInputs;
  if (s.piSquads !== undefined) piSquads = s.piSquads;
  if (s.diagnosticSessions !== undefined) diagnosticSessions = s.diagnosticSessions;
  if (s.activeDiagnosticId !== undefined) activeDiagnosticId = s.activeDiagnosticId;
  // Safety net: if diagnosticSessions restored but activeDiagnosticId is null, auto-set to first session
  if (diagnosticSessions && diagnosticSessions.length > 0 && !activeDiagnosticId) {
    activeDiagnosticId = diagnosticSessions[0].id;
  }
  if (s.productLeakAnalysis !== undefined) {
    // Handle legacy format: single object → wrap in array with generated metadata
    if (s.productLeakAnalysis && !Array.isArray(s.productLeakAnalysis)) {
      var _legacyRun = s.productLeakAnalysis;
      _legacyRun.runId = _legacyRun.runId || 'run-legacy-01';
      _legacyRun.runLabel = _legacyRun.runLabel || ((_legacyRun.primaryBottleneckMetric||'Diagnostic')+' · Restored');
      _legacyRun.runTimestamp = _legacyRun.runTimestamp || Date.now();
      _legacyRun.runCustomName = false;
      productLeakAnalysis = [_legacyRun];
    } else {
      productLeakAnalysis = s.productLeakAnalysis || [];
    }
  }
  // Rebuild laSentIds cache from scCanvas (source of truth)
  if (typeof laRebuildSentIdsFromCanvas === 'function') laRebuildSentIdsFromCanvas();
  if (s.miData !== undefined) miData = s.miData;
  if (s.miGenerated !== undefined) miGenerated = s.miGenerated;
  if (s.miProductMode !== undefined) miProductMode = s.miProductMode;
  if (s.miCapabilities !== undefined) miCapabilities = s.miCapabilities;
  if (s.ddGenerated !== undefined) ddGenerated = s.ddGenerated;
  if (s.mmBannerCollapsed !== undefined) mmBannerCollapsed = s.mmBannerCollapsed;
  // Restore protoStore — unconditional, old sessions without it get empty {}
  protoStore = s.protoStore || {};
  // Decompress wireframe HTML from LZString-compressed field (v8.81+)
  // Backward compatible: old snapshots have wireframeHTMLCompressed:null — wireframeHTML stays null
  if (typeof LZString !== 'undefined' && typeof LZString.decompressFromUTF16 === 'function') {
    Object.keys(protoStore).forEach(function(featId) {
      var entry = protoStore[featId];
      if (!entry || !entry.variants) return;
      Object.keys(entry.variants).forEach(function(vid) {
        var v = entry.variants[vid];
        if (!v) return;
        // Always reset transient fields — never restore in-flight state
        v.generating = false;
        v.generatingPhase = null;
        v.wireframeBlobUrl = null;
        if (v.wireframeHTMLCompressed) {
          try {
            var html = LZString.decompressFromUTF16(v.wireframeHTMLCompressed);
            v.wireframeHTML = html || null;
          } catch(_) {
            v.wireframeHTML = null;
          }
        } else {
          v.wireframeHTML = null;
        }
      });
    });
  } else {
    // LZString not available — ensure clean state
    Object.keys(protoStore).forEach(function(featId) {
      var entry = protoStore[featId];
      if (!entry || !entry.variants) return;
      Object.keys(entry.variants).forEach(function(vid) {
        var v = entry.variants[vid];
        if (v) { v.generating = false; v.wireframeBlobUrl = null; v.wireframeHTML = null; }
      });
    });
  }

  _activeSessionId = sessionId;
  sessionActive = true;

  // v8.45: seed el.textContent early so it's available if switchTab reads it
  // Do NOT call hdrSetSessionName here — curTab is still 'home', visibility would hide it
  var _hdrEl=document.getElementById('hdr-product-name');
  if(_hdrEl&&meta.name){_hdrEl.textContent=meta.name.trim();}

  // Fix #7c — hide tab lock message
  const lockMsg = document.getElementById('home-tab-lock');
  if (lockMsg) lockMsg.style.display = 'none';
  const tabHint = document.querySelector('.tab-hint');
  if (tabHint) tabHint.style.display = 'none';

  // Hide all tabs first — prevents prior session tabs bleeding into restored session.
  // Also clear data-home-hidden so switchTab('mm') restore logic doesn't re-show them.
  ['tab-mm','tab-cc','tab-mi','tab-la','tab-fc'].forEach(function(id){
    const el=document.getElementById(id);
    if(el){ el.style.display='none'; el.removeAttribute('data-home-hidden'); }
  });
  ['tab-sc','tab-pi'].forEach(function(id){
    const el=document.getElementById(id);
    if(el) el.classList.remove('revealed');
  });

  // Reveal only tabs relevant to this session
  _ssRevealTabs(s);

  // Navigate to last active tab — switchTab handles all left panel / content visibility
  const targetTab = meta.lastTab || 'mm';
  if (typeof switchTab === 'function') switchTab(targetTab);

  // Fix #2 — re-render DM only if navigating to mm tab
  if (targetTab === 'mm' && s.gData) {
    if (typeof renderMM === 'function') renderMM(s.gData);
    // Restore evidence dots and values on DM after session reload (v8.37)
    if (typeof kpiRenderEvidenceStates === 'function') kpiRenderEvidenceStates();
    const mmOut = document.getElementById('mm-out');
    if (mmOut) mmOut.classList.add('on');
    if (typeof mmRenderSessionPanel === 'function'){
      mmRenderSessionPanel();
      // v8.45: sync left panel immediately after rebuild — mmRenderSessionPanel uses productName fallback
      if(typeof mmUpdateSessionName==='function')mmUpdateSessionName(meta.name||'');
    }
  }

  // If session was interrupted before gData was set, show a clear interrupted state
  if (targetTab === 'mm' && !s.gData && sessionActive) {
    if (typeof hideLoad === 'function') hideLoad();
    if (typeof endAiGen === 'function') endAiGen();
    const esEl = document.getElementById('es');
    if (esEl) {
      const productName = (s.sessionContext && s.sessionContext.productProfile && s.sessionContext.productProfile.productName) || 'this product';
      esEl.innerHTML = `
        <div class="empty-icon"><i class="ti ti-player-pause" style="color:var(--purple);"></i></div>
        <div class="empty-title">Generation was interrupted</div>
        <div class="empty-desc">Your session for <strong>${e(productName)}</strong> was started but the Discovery Map didn't complete. Your product details are ready — click Generate to continue.</div>
        <div class="empty-steps">
          <button class="gen-btn" onclick="generate()" style="margin-top:8px;"><i class="ti ti-sparkles" style="font-size:13px;" aria-hidden="true"></i> Generate Discovery Map</button>
        </div>`;
      esEl.style.display = '';
    }
  }

  // Fix #3 — for non-mm targets, ensure DM left panel is hidden
  if (targetTab !== 'mm') {
    const lp = document.getElementById('left-panel');
    if (lp) lp.classList.add('sc-hidden');
  }

  // MI: re-render only if navigating to mi tab
  if (targetTab === 'mi' && s.miGenerated) {
    if (typeof miRenderScreen === 'function') miRenderScreen();
  }

  // Update home left panel to show active session
  if (typeof homeRenderSessionPanel === 'function') homeRenderSessionPanel();

  _ssRestoring = false;  // restore complete — switchTab can now write lastTab again

  // v8.45: final authoritative UI sync — runs AFTER curTab is final and all DOM rebuilt
  // This is the definitive fix for session name not showing after restore
  sessionStoreSyncRestoredSessionName(meta.name||'');

  // Save session immediately after restore — updates savedAt and forces lastTab to targetTab.
  try {
    const _raw = localStorage.getItem(_SS_PREFIX + sessionId);
    if (_raw) {
      const _entry = JSON.parse(_raw);
      _entry.meta.savedAt = Date.now();
      _entry.meta.lastTab = targetTab;
      localStorage.setItem(_SS_PREFIX + sessionId, JSON.stringify(_entry));
    }
  } catch(e) {
    console.warn('sessionStoreRestore save failed:', e);
  }

  showToast('Session restored.', 'info');
}

// Delete a session by ID
function sessionStoreDelete(sessionId) {
  // Remove from localStorage first
  try {
    localStorage.removeItem(_SS_PREFIX + sessionId);
    _ssRemoveFromIndex(sessionId);
    if (_activeSessionId === sessionId) _activeSessionId = null;
  } catch(e) {
    console.warn('sessionStoreDelete localStorage failed:', e);
  }

  // Async DB delete — fire and forget
  (async function() {
    try {
      const client = _ssGetClient();
      if (client) {
        const { error } = await client.from('sessions').delete().eq('id', sessionId);
        if (error) console.warn('sessionStoreDelete DB delete failed:', error.message);
      }
    } catch(e) {
      console.warn('sessionStoreDelete DB delete exception:', e);
    }
  })();
}

// Rename a session
function sessionStoreRename(sessionId, newName) {
  const trimmed = (newName || '').trim();

  // Update localStorage first
  try {
    const raw = localStorage.getItem(_SS_PREFIX + sessionId);
    if (!raw) return;
    const entry = JSON.parse(raw);
    entry.meta.name = trimmed || entry.meta.name;
    localStorage.setItem(_SS_PREFIX + sessionId, JSON.stringify(entry));
  } catch(e) {
    console.warn('sessionStoreRename localStorage failed:', e);
  }

  // Async DB update — fire and forget
  (async function() {
    try {
      const client = _ssGetClient();
      if (client) {
        const { error } = await client
          .from('sessions')
          .update({ name: trimmed })
          .eq('id', sessionId);
        if (error) console.warn('sessionStoreRename DB update failed:', error.message);
      }
    } catch(e) {
      console.warn('sessionStoreRename DB update exception:', e);
    }
  })();
}

// Return array of session metadata sorted by savedAt desc (default)
function sessionStoreList() {
  const index = _ssGetIndex();
  const list = [];
  index.forEach(function(id) {
    try {
      const raw = localStorage.getItem(_SS_PREFIX + id);
      if (raw) {
        const entry = JSON.parse(raw);
        if (entry && entry.meta) list.push(entry.meta);
      }
    } catch(e) {}
  });
  // Sort by savedAt descending
  list.sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
  return list;
}

// ── Private helpers ──

// ── JSON-safe deep clone helper ──
// Used for coverageData (JSON-safe primitives only — do not use for File/Blob/Date).
function _ssCloneJsonSafe(value, fallback) {
  try {
    if (value == null) return fallback;
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return fallback;
  }
}

// ── Strip/compress transient proto fields before snapshot ──
// opts.persistWireframe: true → compress wireframeHTML with LZString; false → strip (null)
// Variant-aware whitelist approach. Deep-clones coverageData.
// Returns a new object — never mutates protoStore in place.
function _ssStripProtoTransient(store, opts) {
  if (!store || typeof store !== 'object') return {};
  var persistWireframe = !!(opts && opts.persistWireframe);
  var lzAvail = typeof LZString !== 'undefined' && typeof LZString.compressToUTF16 === 'function';
  var result = {};
  Object.keys(store).forEach(function(featId) {
    var entry = store[featId];
    if (!entry) return;
    // Build stripped/compressed variants
    var strippedVariants = {};
    var variants = entry.variants || {};
    Object.keys(variants).forEach(function(vid) {
      var v = variants[vid];
      if (!v) return;
      var compressed = null;
      if (persistWireframe && lzAvail && v.wireframeHTML) {
        try { compressed = LZString.compressToUTF16(v.wireframeHTML); } catch(_) {}
      }
      if (persistWireframe && !lzAvail && v.wireframeHTML) {
        console.warn('[SS] LZString not available — wireframe will not persist for', featId);
      }
      strippedVariants[vid] = {
        generated:              !!v.generated,
        stale:                  !!v.stale,
        generating:             false,
        generatingPhase:        null,
        generatedAt:            v.generatedAt || null,
        inputSignature:         v.inputSignature || null,
        wireframeBlobUrl:       null,
        wireframeHTML:          null,
        wireframeHTMLCompressed:compressed || null,
        designBrief:            v.designBrief || null,
        coverageData:           Array.isArray(v.coverageData)
          ? _ssCloneJsonSafe(v.coverageData, [])
          : [],
        externalPrompt:         v.externalPrompt || null,
        partial:                !!v.partial,
        partialReason:          v.partialReason || null,
        nonUI:                  !!v.nonUI
      };
    });
    result[featId] = {
      featureId:           entry.featureId || featId,
      activeVariantId:     entry.activeVariantId || 'v1',
      additionalContext:   entry.additionalContext || '',
      screenshotFile:      null,
      screenshotDataUrl:   null,
      screenshotInherited: false,
      inheritedFromFeatId: null,
      variants:            strippedVariants
    };
  });
  return result;
}

// ── Strip extractedText from session docs before snapshot ──
// Always returns a new object to prevent shared-reference mutation of live sessionContext.
function _ssStripSessionDocs(ctx){
  if(!ctx)return null;
  var stripped=Object.assign({},ctx);
  stripped.sessionDocs=(ctx.sessionDocs||[]).map(function(d){
    var d2=Object.assign({},d);
    delete d2.extractedText;
    return d2;
  });
  return stripped;
}

function _sessionStoreBuildSnapshot(opts) {
  return {
    sessionContext: _ssStripSessionDocs(
      typeof sessionContext !== 'undefined' ? sessionContext : null
    ),
    gData: (typeof gData !== 'undefined') ? gData : null,
    productContext: (typeof productContext !== 'undefined') ? productContext : null,
    capStore: (typeof capStore !== 'undefined') ? capStore : {},
    scCanvas: (typeof scCanvas !== 'undefined') ? scCanvas : [],
    scStoryIdCounter: (typeof scStoryIdCounter !== 'undefined') ? scStoryIdCounter : 0,
    piPlan: (typeof piPlan !== 'undefined') ? piPlan : null,
    piInputs: (typeof piInputs !== 'undefined') ? piInputs : null,
    piSquads: (typeof piSquads !== 'undefined') ? piSquads : [],
    diagnosticSessions: (typeof diagnosticSessions !== 'undefined') ? diagnosticSessions : [],
    activeDiagnosticId: (typeof activeDiagnosticId !== 'undefined') ? activeDiagnosticId : null,
    productLeakAnalysis: (typeof productLeakAnalysis !== 'undefined') ? productLeakAnalysis : [],
    miData: (typeof miData !== 'undefined') ? miData : null,
    miGenerated: (typeof miGenerated !== 'undefined') ? miGenerated : false,
    miProductMode: (typeof miProductMode !== 'undefined') ? miProductMode : 'market',
    miCapabilities: (typeof miCapabilities !== 'undefined') ? miCapabilities : [],
    ddGenerated: (typeof ddGenerated !== 'undefined') ? ddGenerated : false,
    mmBannerCollapsed: (typeof mmBannerCollapsed !== 'undefined') ? mmBannerCollapsed : false,
    protoStore: _ssStripProtoTransient(typeof protoStore !== 'undefined' ? protoStore : {}, opts || {})
  };
}

function _ssComputeLastStage() {
  if (typeof piPlan !== 'undefined' && piPlan) return 'PI Canvas';
  if (typeof scCanvas !== 'undefined' && scCanvas.length > 0) {
    const hasStories = scCanvas.some(function(f) { return f.stories && f.stories.length > 0; });
    if (hasStories) return 'Story Canvas';
  }
  if (typeof capStore !== 'undefined') {
    const keys = Object.keys(capStore);
    if (keys.length > 0) {
      const hasFeatures = keys.some(function(k) {
        const e = capStore[k];
        return e && e.capabilities && e.capabilities.some(function(c) {
          return c.featStore && c.featStore.top && c.featStore.top.length > 0;
        });
      });
      if (hasFeatures) return 'Feature Canvas';
      return 'Capability Canvas';
    }
  }
  if (typeof gData !== 'undefined' && gData) return 'Discovery Map';
  return 'Not started';
}

function _ssComputeCounts() {
  let caps = 0, features = 0, stories = 0, sprintActive = null;

  if (typeof capStore !== 'undefined') {
    Object.keys(capStore).forEach(function(k) {
      const e = capStore[k];
      if (!e || !e.capabilities) return;
      caps += e.capabilities.length;
      e.capabilities.forEach(function(c) {
        if (c.featStore && c.featStore.top) features += c.featStore.top.length;
      });
    });
  }

  if (typeof scCanvas !== 'undefined') {
    scCanvas.forEach(function(f) {
      if (f.stories) stories += f.stories.length;
    });
  }

  if (typeof piPlan !== 'undefined' && piPlan && piPlan.storyAssignments) {
    const sprintIds = Object.values(piPlan.storyAssignments)
      .filter(function(v) { return v && v !== 'backlog'; });
    if (sprintIds.length > 0) {
      const nums = sprintIds.map(function(s) {
        const m = String(s).match(/(\d+)$/);
        return m ? parseInt(m[1]) : 0;
      }).filter(function(n) { return n > 0; });
      if (nums.length > 0) sprintActive = 'Sprint ' + Math.max.apply(null, nums);
    }
  }

  var _docs=(typeof sessionContext!=='undefined'&&sessionContext&&sessionContext.sessionDocs)
    ?sessionContext.sessionDocs.length:0;

  // Count prototypes — only for live features, variant-aware
  var protos = 0;
  if (typeof protoStore !== 'undefined' && protoStore) {
    var _liveIds = new Set((typeof scCanvas !== 'undefined' ? scCanvas : []).map(function(f){ return f.id; }));
    protos = Object.keys(protoStore).filter(function(k) {
      if (!_liveIds.has(k)) return false;
      var entry = protoStore[k];
      if (!entry || !entry.variants || !entry.activeVariantId) return false;
      var v = entry.variants[entry.activeVariantId];
      return !!(v && v.generated);
    }).length;
  }

  return { caps, features, stories, sprintActive, docs:_docs, protos };
}

function _ssRevealTabs(s) {
  if (s.gData) {
    const tabMm = document.getElementById('tab-mm');
    if (tabMm) tabMm.style.display = '';
  }
  if (s.capStore && Object.keys(s.capStore).length > 0) {
    const tabCc = document.getElementById('tab-cc');
    if (tabCc) tabCc.style.display = '';
  }
  if (s.miGenerated) {
    const tabMi = document.getElementById('tab-mi');
    if (tabMi) tabMi.style.display = '';
  }
  if (s.scCanvas && s.scCanvas.length > 0) {
    const tabFc = document.getElementById('tab-fc');
    if (tabFc) tabFc.style.display = '';
  }
  const hasStories = s.scCanvas && s.scCanvas.some(function(f) {
    return f.stories && f.stories.length > 0;
  });
  if (hasStories) {
    const tabSc = document.getElementById('tab-sc');
    if (tabSc) tabSc.classList.add('revealed');
  }
  if (s.piPlan) {
    const tabPi = document.getElementById('tab-pi');
    if (tabPi) tabPi.classList.add('revealed');
  }
  if (s.productLeakAnalysis && (Array.isArray(s.productLeakAnalysis) ? s.productLeakAnalysis.length > 0 : true)) {
    const tabLa = document.getElementById('tab-la');
    if (tabLa) tabLa.style.display = '';
  }
}

// Transient "✓ Saved" indicator in header
var _ssSaveTimer = null;
function _ssShowSaved() {
  const el = document.getElementById('hdr-saved');
  if (!el) return;
  el.classList.add('on');
  if (_ssSaveTimer) clearTimeout(_ssSaveTimer);
  _ssSaveTimer = setTimeout(function() {
    el.classList.remove('on');
    _ssSaveTimer = null;
  }, 3000);
}

// localStorage index helpers
function _ssGetIndex() {
  try {
    const raw = localStorage.getItem(_SS_INDEX);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function _ssAddToIndex(id) {
  const index = _ssGetIndex();
  if (index.indexOf(id) === -1) index.unshift(id);
  try { localStorage.setItem(_SS_INDEX, JSON.stringify(index)); } catch(e) {}
}

function _ssRemoveFromIndex(id) {
  const index = _ssGetIndex().filter(function(i) { return i !== id; });
  try { localStorage.setItem(_SS_INDEX, JSON.stringify(index)); } catch(e) {}
}

// Auto-name: "ProductName · DD Mon"
function _ssAutoName(productName, ts) {
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return productName + ' \u00b7 ' + d.getDate() + ' ' + months[d.getMonth()];
}

// Simple UUID v4
function _ssUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
