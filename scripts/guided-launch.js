// GUIDED LAUNCH (gl) — v9.15, unified onto mt_sessions in v9.15.02
// Conversational intake flow, second entry path from Home alongside Quick
// Launch. Owns its own tab (#gl-tab). As of v9.15.02, a Guided Launch
// session IS a real mt_sessions row from the moment of creation — the same
// sessionStoreCreate()/sessionStoreSave()/sessionStoreRestore() machinery
// every other canvas uses, not a separate mt_intake_sessions/mt_intake_messages
// pair (those tables are gone — dropped directly against Supabase, per the
// migration). Chat transcript and draft/final brief live in the session's
// own snapshot.gl* keys (see session-store.js's _sessionStoreBuildSnapshot());
// mt_sessions.intake_status ('active'|'completed'|null) drives tab
// visibility (session-store.js's _ssRevealTabs()) and resume routing
// (sessionStoreRestore()'s targetTab==='gl' branch). Finalize hands a
// finalized markdown brief to the existing, unmodified Discovery Map
// generation pipeline via sessionContext.additionalContext (see
// glFinalize()) — no changes to kpi-tree.js's generation path itself.
//
// Entry points: glCreateAndOpen() (called from home.js's homeGuidedLaunch()),
// glApplyRestoredSnapshot() (called from session-store.js's
// sessionStoreRestore()). There is no separate resume function — resuming a
// Guided-Launch-originated session is the same sessionStoreRestore() path
// every other session uses. Everything else here is internal to this file.

// ── State ── (module-scoped globals, mirroring outcome-pulse.js's pattern —
// no dedicated state.js entry since nothing here is read outside this file
// except through the three entry points above)
var glSessionId=null;
var glStatus='active'; // 'active' | 'completed'
var glMessages=[]; // [{role:'user'|'agent', content, attachments}]
var glDraftMd='';
var glFinalMd=null;
var glMdOpen=false;
var glContextHash=null;
var glProductId=null;
var glCompanyId=null;
var glSessionCtx=null; // sessionContext snapshot — company/product profile, docs, approach/mode
var glBusy=false; // true while an AI call is in flight — blocks concurrent sends
var glLastChangedSectionId=null; // one-shot flash target for the next glRenderMdBody()
var glPanelOpen=true; // left panel expand/collapse state (v9.15.01, Items 1-4) — independent of DM's own panelOpen in left-panel.js

// ── Reset (v9.15.01, Item 20) ──
// Called by home.js's homeClearSession() — the one shared cleanup function
// every session-transition path already funnels through. Nulls every gl*
// global back to its initial value; does NOT touch #gl-tab's DOM or
// tab-gl's visibility (homeClearSession() does that itself, alongside its
// own equivalent handling for every other tab). Safe to call at any time,
// including when no Guided Launch session was ever active (every field is
// already at its reset value in that case — a no-op).
function glResetState(){
  glSessionId=null;
  glStatus='active';
  glMessages=[];
  glDraftMd='';
  glFinalMd=null;
  glMdOpen=false;
  glContextHash=null;
  glProductId=null;
  glCompanyId=null;
  glSessionCtx=null;
  glBusy=false;
  glLastChangedSectionId=null;
  glPanelOpen=true;
}

// ── Context-freshness hash ──
// Deliberately simple (not cryptographic) — only needs to detect "did the
// serialized profile change at all," per spec Section 6.4.
function _glHashContext(companyProfile,productProfile){
  var s=JSON.stringify({c:companyProfile||{},p:productProfile||{}});
  var h=0;
  for(var i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; }
  return 'h'+h;
}

// ── Minimal markdown -> HTML ──
// No markdown library is loaded anywhere in this app (confirmed via grep) —
// this covers exactly what the AI is instructed to produce (H1/H2/H3,
// paragraphs, "- " bullet lists). flashHeading, when it matches an H2's text
// (case-insensitive), wraps that section in .gl-flash for the one render
// that follows a revision turn.
function _glMdToHtml(md,flashHeading){
  if(!md)return '';
  var lines=md.split('\n');
  var html='';
  var openList=false;
  var flashOpen=false;
  function closeList(){ if(openList){html+='</ul>';openList=false;} }
  for(var i=0;i<lines.length;i++){
    var line=lines[i];
    var h1=line.match(/^#\s+(.*)/);
    var h2=line.match(/^##\s+(.*)/);
    var h3=line.match(/^###\s+(.*)/);
    var li=line.match(/^[-*]\s+(.*)/);
    if(h2){
      closeList();
      if(flashOpen){ html+='</div>'; flashOpen=false; }
      var isFlash=flashHeading && h2[1].trim().toLowerCase()===String(flashHeading).trim().toLowerCase();
      if(isFlash){ html+='<div class="gl-flash">'; flashOpen=true; }
      html+='<h2>'+e(h2[1])+'</h2>';
      continue;
    }
    if(h1){ closeList(); html+='<h1>'+e(h1[1])+'</h1>'; continue; }
    if(h3){ closeList(); html+='<h3>'+e(h3[1])+'</h3>'; continue; }
    if(li){ if(!openList){html+='<ul>';openList=true;} html+='<li>'+e(li[1])+'</li>'; continue; }
    closeList();
    if(line.trim()===''){ continue; }
    html+='<p>'+e(line)+'</p>';
  }
  closeList();
  if(flashOpen)html+='</div>';
  return html;
}

// ── AI response JSON parsing ──
// Guided Launch's own responses are much smaller/simpler than the Discovery
// Map tree api.js's parseJSON()/repairJSON() are built for — a plain parse
// with a code-fence strip covers the actual failure mode (model wrapping
// JSON in ```json fences despite the system prompt's instruction not to).
function _glParseJSON(txt){
  var clean=(txt||'').replace(/```json|```/g,'').trim();
  try{ return JSON.parse(clean); }catch(e){}
  var first=clean.indexOf('{'), last=clean.lastIndexOf('}');
  if(first>=0&&last>first){
    try{ return JSON.parse(clean.slice(first,last+1)); }catch(e2){}
  }
  return null;
}

// ── Shared model call ──
// Routes through the standard callAPI()/resolveModelDecision() chain in
// Optimized mode (general tier -> Sonnet for Anthropic) rather than a
// hardcoded model string, per the explicit product decision overriding the
// spec's original "hardcode Sonnet" instruction — this way a company on a
// non-Anthropic provider still gets a valid, catalog-checked model.
// extraFields tags mt_ai_usage_events with session_type:'ChatCanvas' so
// Guided Launch's chat-turn costs stay distinguishable from Discovery Map
// generation costs, even though both now share the same real mt_sessions
// row (session_id/product_id here are that same row's own values — see
// api.js/proxy/server.js).
async function _glCallModel(sys,usr){
  var extra={session_id:glSessionId,product_id:glProductId,session_type:'ChatCanvas'};
  return await callAPI(sys,usr,3000,null,null,'guided-launch',null,extra);
}

// ══════════════════════════════════════════════════════════════════════════
// Entry points
// ══════════════════════════════════════════════════════════════════════════

// Called by home.js's homeGuidedLaunch(). v9.15.02 — creates a REAL
// mt_sessions row immediately via the same sessionStoreCreate() every other
// canvas uses (not a second, unrelated table) — this is what gives Guided
// Launch a dashboard card, real left-panel content, and correct tab
// visibility from turn one, and what closes the v9.15.01 cross-session-leak
// class of bug at its root: sessionActive=true here means switchTab('home')'s
// existing guard now reliably fires homeClearSession() -> glResetState() on
// every departure, exactly like every other real session.
async function glCreateAndOpen(sessionContext){
  glSessionCtx=sessionContext;
  glStatus='active';
  glMessages=[];
  glDraftMd='';
  glFinalMd=null;
  glMdOpen=false;
  glContextHash=_glHashContext(sessionContext.companyProfile,sessionContext.productProfile);

  var id=sessionStoreCreate(sessionContext,{lastTab:'gl',lastStage:'Guided Launch',intakeStatus:'active'});
  glSessionId=id;
  glProductId=(sessionContext.productProfile&&sessionContext.productProfile.id)||null;
  glCompanyId=(function(){ try{ return localStorage.getItem(_PGT_ACTIVE_COMPANY_KEY)||null; }catch(e){ return null; } })();

  sessionActive=true;
  _activeSessionOwnerId=(typeof currentUser!=='undefined'&&currentUser)?currentUser.id:null;

  // _ssSyncTabVisibility() (session-store.js) only runs on RESTORE — a
  // fresh creation reveals its own tab directly, same pattern _homeDoLaunch()
  // already uses for tab-mm.
  var tabBtn=document.getElementById('tab-gl');
  if(tabBtn)tabBtn.style.display='';

  switchTab('gl');
  glRenderShell();
  glRunOpeningTurn();
}

// Called by session-store.js's sessionStoreRestore() whenever the restored
// session's meta.intakeStatus is set (active or completed) — independent of
// which tab is actually landed on (see that call site's own comment): a
// completed session lands on 'mm' but #gl-tab still needs real content the
// moment the user clicks into it. Populates state only; navigation is the
// caller's existing switchTab(targetTab) call, already run by this point.
function glApplyRestoredSnapshot(meta,snapshot){
  glSessionId=(typeof _activeSessionId!=='undefined')?_activeSessionId:null;
  glCompanyId=(function(){ try{ return localStorage.getItem(_PGT_ACTIVE_COMPANY_KEY)||null; }catch(e){ return null; } })();
  glProductId=meta.productId||null;
  glStatus=meta.intakeStatus||'active';
  glMessages=(snapshot&&snapshot.glMessages)||[];
  glDraftMd=(snapshot&&snapshot.glDraftMd)||'';
  glFinalMd=(snapshot&&snapshot.glFinalMd)||null;
  glContextHash=(snapshot&&snapshot.glContextHash)||null;
  glSessionCtx=(snapshot&&snapshot.sessionContext)||null;
  glMdOpen=true;

  glRenderShell();
  glRenderChatHistory();
  glRenderMdBody();
  glOpenPanel();
  glUpdateFooterState();

  // Freshness check — never silent. Only meaningful while still chatting;
  // a completed session's profile snapshot is intentionally frozen.
  if(glStatus==='active'&&glSessionCtx){
    var freshHash=_glHashContext(glSessionCtx.companyProfile,glSessionCtx.productProfile);
    if(freshHash!==glContextHash){
      glAppendAgentMessage('Your company or product profile was updated since we last talked — want me to refresh the summary with the latest info? Just say so, or keep going as-is.',null,true);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Shell rendering
// ══════════════════════════════════════════════════════════════════════════

function glRenderShell(){
  var root=document.getElementById('gl-tab');
  if(!root)return;

  root.innerHTML=
    // Left panel (v9.15.01 Items 1-4, content source fixed v9.15.02 Item 2):
    // real .left/.ph/.ph-title/.ph-sub/.collapse-btn structure, copied
    // directly from index.html's #left-panel (no shared render function to
    // call instead — left-panel.js only owns togglePanel(), the markup is
    // static per-tab). Body content now calls the SAME
    // _mmBuildSessionSummaryHtml(sc) helper DM's own left panel uses
    // (home.js) — this only became possible once Guided Launch sessions
    // carried a real sessionContext from creation (v9.15.02 unification);
    // previously this was a hand-built lookalike reading only a thin
    // snapshot. glTogglePanel() mirrors togglePanel()'s exact logic, scoped
    // to #gl-left/its own icon ids so it can't interfere with DM's panel.
    '<div class="left gl-left" id="gl-left">'
      +'<div class="ph">'
        +'<div class="ph-text"><div class="ph-title">Requirement Agent</div><div class="ph-sub">Pin down what you\'re building.</div></div>'
        +'<button class="collapse-btn" onclick="glTogglePanel()" title="Toggle panel">'
          +'<svg id="icon-gl-exp" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/><polyline points="21 18 15 12 21 6"/></svg>'
          +'<svg id="icon-gl-col" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="9 18 15 12 9 6"/><polyline points="3 18 9 12 3 6"/></svg>'
        +'</button>'
      +'</div>'
      +'<div class="gl-left-body">'
        +(typeof _mmBuildSessionSummaryHtml==='function'?_mmBuildSessionSummaryHtml(glSessionCtx):'')
      +'</div>'
    +'</div>'
    +'<div class="gl-center">'
      +'<div class="gl-chat-hdr">'
        +'<div><div class="gl-chat-hdr-eyebrow">Guided Launch</div><div class="gl-chat-hdr-title" id="gl-status-label">Drafting requirements together</div></div>'
      +'</div>'
      +'<div class="gl-chat-body" id="gl-chat-body"></div>'
      +'<div class="gl-chat-input-wrap">'
        +'<div class="gl-chat-input-row">'
          +'<textarea class="gl-chat-input" id="gl-chat-input" rows="1" placeholder="Type your response..." onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();glSendMessage();}"></textarea>'
          +'<button class="gl-chat-send" id="gl-send-btn" onclick="glSendMessage()" title="Send"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>'
        +'</div>'
        +'<div class="gl-upload-chip" id="gl-upload-chip" onclick="if(glStatus===\'active\')document.getElementById(\'gl-file-input\').click()" title="Click to select a file to upload">'
          +'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
          +' <span id="gl-upload-chip-text" style="text-decoration:underline;">Upload a document</span><span id="gl-upload-chip-suffix"> to add context anytime</span>'
        +'</div>'
        +'<input type="file" id="gl-file-input" accept=".docx,.pdf,.txt,.xlsx,.csv" style="display:none;" onchange="glHandleUpload(this)">'
      +'</div>'
    +'</div>'
    +'<div class="gl-md-collapsed-rail" id="gl-collapsed-rail" onclick="glOpenPanel()" title="Reopen requirements draft">'
      // Chevron rule: arrow points in the direction the panel recedes
      // toward when collapsing (or, for a reopen affordance like this one,
      // the direction it expands back INTO). This rail expands the panel
      // LEFTWARD, back into view from the right edge, so it needs a
      // left-pointing "<" — points="15 18 9 12 15 6" (vertex at x=9, left
      // of both endpoints at x=15). Item 4 (v9.15.02): the v9.15.01 build
      // had this as points="9 18 15 12 9 6" (vertex at x=15, RIGHT of the
      // endpoints — a ">") and its own comment incorrectly described that
      // shape as "points left." Re-derived from the raw coordinates this
      // time, not re-asserted from the prior comment.
      +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
      +'<div class="gl-md-collapsed-label">REQUIREMENTS DRAFT</div>'
    +'</div>'
    +'<div class="gl-md-panel" id="gl-md-panel">'
      +'<div class="gl-md-hdr">'
        +'<div><div class="gl-md-hdr-eyebrow">Live Draft</div><div class="gl-md-hdr-title">Requirements Brief</div></div>'
        +'<div class="gl-md-hdr-actions">'
          +'<button class="gl-export-btn" onclick="glExportMd()" title="Download the current draft as a .md file"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export</button>'
          // Chevron rule (v9.15.01): the arrow points in the direction the
          // panel visually recedes toward when collapsing. This is the
          // RIGHT panel — it collapses toward the right edge — so its
          // collapse icon points right (double-right), mirrored from the
          // left panel's double-left convention. Fixed in this cycle
          // (Item 11): was previously copied verbatim from the left panel's
          // glyph, which pointed the wrong way for a right-side panel.
          +'<button class="collapse-btn" onclick="glCollapsePanel()" title="Collapse panel"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/><polyline points="3 18 9 12 3 6"/></svg></button>'
        +'</div>'
      +'</div>'
      +'<div class="gl-md-body" id="gl-md-body"></div>'
      +'<div class="gl-md-footer">'
        +'<button class="gl-finalize-btn" id="gl-finalize-btn" onclick="glFinalize()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Finalize &amp; Generate</button>'
        +'<div class="gl-footer-note" id="gl-footer-note">Locks your brief and starts Discovery Map generation.</div>'
      +'</div>'
    +'</div>';

  glRenderChatHistory();
  glRenderMdBody();
  glUpdateFooterState();
}

// ══════════════════════════════════════════════════════════════════════════
// Chat
// ══════════════════════════════════════════════════════════════════════════

function _glFormatChatText(text){
  return e(text||'').replace(/\n/g,'<br>');
}
function _glUserInitials(){
  var name=(typeof currentUser!=='undefined'&&currentUser)?currentUser.displayName:'';
  return (typeof _avatarInitials==='function')?_avatarInitials(name):'You';
}
function _glBuildBubbleHtml(m){
  var isUser=m.role==='user';
  return '<div class="gl-msg-row '+(isUser?'user':'agent')+'">'
    +'<div class="gl-avatar '+(isUser?'user-av':'agent-av')+'">'+(isUser?e(_glUserInitials()):'AI')+'</div>'
    +'<div class="gl-bubble">'+_glFormatChatText(m.content)+'</div>'
  +'</div>';
}
function glRenderChatHistory(){
  var body=document.getElementById('gl-chat-body');
  if(!body)return;
  body.innerHTML=glMessages.map(_glBuildBubbleHtml).join('');
  body.scrollTop=body.scrollHeight;
}
function glAppendAgentMessage(content,attachments,persist){
  glMessages.push({role:'agent',content:content,attachments:attachments||null});
  var body=document.getElementById('gl-chat-body');
  if(body){ body.insertAdjacentHTML('beforeend',_glBuildBubbleHtml(glMessages[glMessages.length-1])); body.scrollTop=body.scrollHeight; }
  if(persist!==false)_glPersistMessage('agent',content,attachments);
}
function glAppendUserMessage(content){
  glMessages.push({role:'user',content:content,attachments:null});
  var body=document.getElementById('gl-chat-body');
  if(body){ body.insertAdjacentHTML('beforeend',_glBuildBubbleHtml(glMessages[glMessages.length-1])); body.scrollTop=body.scrollHeight; }
  _glPersistMessage('user',content,null);
}
// v9.15.02 — persistence now goes through the same sessionStoreSave()
// every other canvas calls after a mutation (glMessages already updated in
// the live global by the caller before this runs) — replaces the old
// direct mt_intake_messages/mt_intake_sessions table writes entirely, since
// those tables no longer exist. _sessionStoreBuildSnapshot() picks up
// glMessages/glDraftMd/glFinalMd/glContextHash from the live globals.
async function _glPersistMessage(role,content,attachments){
  if(!glSessionId||typeof sessionStoreSave!=='function')return;
  try{ await sessionStoreSave(_activeSessionId); }
  catch(err){ console.warn('[guided-launch] message persist failed',err); }
}
async function _glPersistDraft(){
  if(!glSessionId||typeof sessionStoreSave!=='function')return;
  try{ await sessionStoreSave(_activeSessionId); }
  catch(err){ console.warn('[guided-launch] draft persist failed',err); }
}

function _glSetBusy(busy){
  glBusy=busy;
  var sendBtn=document.getElementById('gl-send-btn');
  var input=document.getElementById('gl-chat-input');
  if(sendBtn)sendBtn.disabled=busy;
  if(input)input.disabled=busy;
}
// Items 5+7 (v9.15.01) — cc-spin-sm was an orphaned reference to a
// Capability Canvas class that doesn't exist in this file, rendering as a
// stray glyph instead of a spinner. Replaced with a self-contained animated
// indicator (3 pulsing dots, defined entirely in 22-guided-launch.css) plus
// rotating status phrases, cycled here — no streaming, that's an explicit
// future enhancement, out of scope for this cycle.
var _GL_TYPING_PHRASES=['Reading context...','Drafting...','Thinking it through...'];
var _glTypingPhraseTimer=null;
function _glTypingIndicatorHtml(){
  return '<div class="gl-msg-row agent" id="gl-typing-row"><div class="gl-avatar agent-av">AI</div>'
    +'<div class="gl-bubble gl-typing-bubble">'
      +'<div class="gl-typing-dots"><span></span><span></span><span></span></div>'
      +'<span id="gl-typing-phrase">'+_GL_TYPING_PHRASES[0]+'</span>'
    +'</div></div>';
}
function _glShowTyping(){
  var body=document.getElementById('gl-chat-body');
  if(body){ body.insertAdjacentHTML('beforeend',_glTypingIndicatorHtml()); body.scrollTop=body.scrollHeight; }
  var idx=0;
  _glTypingPhraseTimer=setInterval(function(){
    idx=(idx+1)%_GL_TYPING_PHRASES.length;
    var el=document.getElementById('gl-typing-phrase');
    if(el)el.textContent=_GL_TYPING_PHRASES[idx];
  },1800);
}
function _glHideTyping(){
  if(_glTypingPhraseTimer){clearInterval(_glTypingPhraseTimer);_glTypingPhraseTimer=null;}
  var row=document.getElementById('gl-typing-row');
  if(row)row.remove();
}

// Opening turn — fires once, automatically, on a brand-new session.
async function glRunOpeningTurn(){
  if(glStatus!=='active')return;
  _glSetBusy(true);
  _glShowTyping();
  try{
    var built=buildGuidedLaunchOpeningPrompt(glSessionCtx);
    var raw=await _glCallModel(built.sys,built.usr);
    var parsed=_glParseJSON(raw);
    _glHideTyping();
    if(!parsed||!parsed.markdown){
      glAppendAgentMessage('I had trouble putting together an opening summary just now. Try typing a message below and I’ll pick this up from there.',null,true);
      return;
    }
    glDraftMd=parsed.markdown;
    glAppendAgentMessage(parsed.chatReply||'Here’s a starting draft — take a look on the right.',null,true);
    glRenderMdBody();
    _glPersistDraft();
    glOpenPanel();
  }catch(err){
    _glHideTyping();
    console.warn('[guided-launch] opening turn failed',err);
    glAppendAgentMessage('Something went wrong generating the opening summary ('+(err&&err.message?err.message:'unknown error')+'). Type a message below to continue, or refresh and try again.',null,true);
  }finally{
    _glSetBusy(false);
  }
}

async function glSendMessage(){
  if(glBusy||glStatus!=='active')return;
  var input=document.getElementById('gl-chat-input');
  if(!input)return;
  var text=input.value.trim();
  if(!text)return;
  input.value='';
  glAppendUserMessage(text);
  await _glRunRevisionTurn(text,null,null);
}

async function _glRunRevisionTurn(userMessage,uploadedDocText,uploadedDocName){
  _glSetBusy(true);
  _glShowTyping();
  try{
    var built=buildGuidedLaunchTurnPrompt(glSessionCtx,glDraftMd,glMessages.slice(0,-1),userMessage,uploadedDocText,uploadedDocName);
    var raw=await _glCallModel(built.sys,built.usr);
    var parsed=_glParseJSON(raw);
    _glHideTyping();
    if(!parsed||!parsed.markdown){
      glAppendAgentMessage('I couldn’t process that update. Could you rephrase, or try again?',null,true);
      return;
    }
    glDraftMd=parsed.markdown;
    glLastChangedSectionId=parsed.changedSectionHeading||null;
    glAppendAgentMessage(parsed.chatReply||'Updated the draft — take a look.',null,true);
    glRenderMdBody();
    _glPersistDraft();
  }catch(err){
    _glHideTyping();
    console.warn('[guided-launch] revision turn failed',err);
    glAppendAgentMessage('Something went wrong processing that ('+(err&&err.message?err.message:'unknown error')+'). Please try again.',null,true);
  }finally{
    _glSetBusy(false);
  }
}

// ── Mid-chat upload ──
// Extracts text client-side (extractTextFromFile, shared with Home's session
// docs — see utils.js) then feeds it into the SAME revision-turn AI call so
// the model summarizes/merges it into the draft. The raw extracted text is
// never persisted — only the AI's own chatReply/markdown output is stored,
// matching the "no raw file text in draft_md/attachments" acceptance
// criterion.
async function glHandleUpload(inputEl){
  if(typeof currentUserRole!=='undefined'&&currentUserRole==='readonly')return;
  var file=inputEl.files&&inputEl.files[0];
  inputEl.value='';
  if(!file||glBusy||glStatus!=='active')return;

  glAppendUserMessage('Uploaded: '+file.name);
  _glSetBusy(true);
  _glShowTyping();
  try{
    var extractFn=(typeof extractTextFromFile==='function')?extractTextFromFile:function(){return Promise.reject(new Error('extractTextFromFile not available'));};
    var text=await extractFn(file);
    if(!text||!text.trim()){
      _glHideTyping();
      _glSetBusy(false);
      glAppendAgentMessage(file.name+' didn’t have any readable text — try a different file, or tell me about it directly in chat.',null,true);
      return;
    }
    _glHideTyping();
    _glSetBusy(false);
    await _glRunRevisionTurn(null,text,file.name);
  }catch(err){
    _glHideTyping();
    _glSetBusy(false);
    var msg=(err&&err.message==='PASSWORD_PROTECTED')
      ?file.name+' is password-protected — remove the password and re-upload.'
      :'Could not read '+file.name+'.';
    glAppendAgentMessage(msg,null,true);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MD panel
// ══════════════════════════════════════════════════════════════════════════

function glRenderMdBody(){
  var body=document.getElementById('gl-md-body');
  if(!body)return;
  var md=(glStatus==='completed')?(glFinalMd||glDraftMd):glDraftMd;
  var badge='<span class="gl-status-badge '+(glStatus==='completed'?'gl-status-final':'gl-status-drafting')+'">'+(glStatus==='completed'?'Finalized':'Drafting')+'</span>';
  var hadFlash=!!glLastChangedSectionId;
  body.innerHTML=badge+_glMdToHtml(md,glLastChangedSectionId);
  glLastChangedSectionId=null; // one-shot
  // Item 12 (v9.15.01) — bring the revised section into view; only when a
  // revision turn actually flashed something, not on every render (opening
  // turn, resume, finalize all call this too and have nothing to scroll to).
  if(hadFlash){
    var flashEl=body.querySelector('.gl-flash');
    if(flashEl&&typeof flashEl.scrollIntoView==='function'){
      flashEl.scrollIntoView({behavior:'smooth',block:'center'});
    }
  }
}

function glUpdateFooterState(){
  var btn=document.getElementById('gl-finalize-btn');
  var note=document.getElementById('gl-footer-note');
  var statusLbl=document.getElementById('gl-status-label');
  if(btn)btn.disabled=(glStatus==='completed');
  if(note)note.textContent=(glStatus==='completed')?'Locked. Edit via Discovery Map or a new session.':'Locks your brief and starts Discovery Map generation.';
  if(statusLbl)statusLbl.textContent=(glStatus==='completed')?'Finalized — Discovery Map generation in progress':'Drafting requirements together';

  // Item 10 (v9.15.01) — uploads are a no-op post-finalize at the handler
  // level already (glHandleUpload()'s own glStatus check); this adds the
  // matching visual/interactive disabled state so the chip stops looking
  // clickable once it actually stops doing anything.
  var uploadChip=document.getElementById('gl-upload-chip');
  var uploadText=document.getElementById('gl-upload-chip-text');
  var uploadSuffix=document.getElementById('gl-upload-chip-suffix');
  var isCompleted=(glStatus==='completed');
  if(uploadChip)uploadChip.classList.toggle('gl-upload-chip-disabled',isCompleted);
  if(uploadText)uploadText.textContent=isCompleted?'Session finalized.':'Upload a document';
  if(uploadSuffix)uploadSuffix.textContent=isCompleted?' Uploads closed.':' to add context anytime';
}

// Left panel collapse/expand (v9.15.01, Items 1-4) — mirrors left-panel.js's
// togglePanel() exactly, scoped to #gl-left/its own icon ids.
function glTogglePanel(){
  glPanelOpen=!glPanelOpen;
  var left=document.getElementById('gl-left');
  if(left)left.classList.toggle('collapsed',!glPanelOpen);
  var expIcon=document.getElementById('icon-gl-exp');
  var colIcon=document.getElementById('icon-gl-col');
  if(expIcon)expIcon.style.display=glPanelOpen?'block':'none';
  if(colIcon)colIcon.style.display=glPanelOpen?'none':'block';
}

function glOpenPanel(){
  glMdOpen=true;
  var p=document.getElementById('gl-md-panel'); if(p)p.classList.add('open');
  var rail=document.getElementById('gl-collapsed-rail'); if(rail)rail.classList.remove('show');
}
function glCollapsePanel(){
  glMdOpen=false;
  var p=document.getElementById('gl-md-panel'); if(p)p.classList.remove('open');
  var rail=document.getElementById('gl-collapsed-rail'); if(rail)rail.classList.add('show');
}

function glExportMd(){
  var md=(glStatus==='completed')?(glFinalMd||glDraftMd):glDraftMd;
  var blob=new Blob([md||''],{type:'text/markdown'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  var pname=(glSessionCtx&&glSessionCtx.productProfile&&glSessionCtx.productProfile.name)||'requirements-brief';
  a.href=url;
  a.download=pname.replace(/[^a-z0-9\-_]+/gi,'-').toLowerCase()+'-requirements-brief.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

// ══════════════════════════════════════════════════════════════════════════
// Finalize — single, one-way action (no active<->completed reversal)
// ══════════════════════════════════════════════════════════════════════════

async function glFinalize(){
  if(glStatus==='completed'||glBusy)return;
  glStatus='completed';
  glFinalMd=glDraftMd;
  glUpdateFooterState();
  glRenderMdBody();

  // v9.15.02 — the session already exists (created at glCreateAndOpen()
  // time); this UPDATES the same row rather than creating a second,
  // unrelated one. sessionStoreSetIntakeStatus() flips the meta flag
  // locally; the immediately-following sessionStoreSave() persists both
  // that flag and the full snapshot (including glFinalMd, already set
  // above) together, in one immediate write — not deferred to whatever
  // save generate() eventually does on its own.
  if(typeof sessionStoreSetIntakeStatus==='function') sessionStoreSetIntakeStatus(_activeSessionId,'completed');

  glAppendAgentMessage('Great — finalizing the brief and starting Discovery Map generation now.',null,true);

  // Hand off to the existing, unmodified Discovery Map generation pipeline —
  // the finalized markdown rides in sessionContext.additionalContext, the
  // same channel every prompts.js builder already reads (buildTreePrompt()
  // etc.), rather than any change to the generation prompts themselves.
  var ctx=Object.assign({},glSessionCtx);
  ctx.additionalContext=((ctx.additionalContext||'')+'\n\nGuided Launch requirements brief:\n'+glFinalMd).trim();
  sessionContext=ctx;

  if(typeof sessionStoreSave==='function'){
    await sessionStoreSave(_activeSessionId);
  }

  var lock=document.getElementById('home-tab-lock');
  if(lock)lock.style.display='none';
  var tabMm=document.getElementById('tab-mm');
  if(tabMm)tabMm.style.display='';

  switchTab('mm');
  if(typeof generate==='function')generate();
}
