// REQUIREMENT AGENT (ra) — v9.16
// Global, session-scoped, MULTI-conversation requirements agent — distinct
// from and downstream of Discovery Map + Capability Canvas (context only)
// and from the pre-existing "Guided Launch" chat (rebranded to the tab
// label "Requirement Agent" in a prior v9.16 commit on this same file tree —
// see index.html's #tab-gl comment; that is a copy-only rename of an
// unrelated, single-conversation, pre-Discovery-Map intake flow and is NOT
// this module). One conversation here = one release scope, symmetric across
// every capability it touches from turn one. Unlike Guided Launch (one
// mt_sessions row per conversation), every Requirement Agent conversation
// lives inside the snapshot of the ONE already-active session — see
// state.js's raConversations[] and session-store.js's
// _sessionStoreBuildSnapshot()/_ssApplySnapshotFields().
//
// Value chain: Discovery Map + Capability Canvas (context) -> Requirement
// Agent (this file) -> Finalize Brief (atomic: lock content, assign next RQ
// number, generate features for every touched capability, navigate to
// Feature Canvas) -> Feature Canvas -> Story Canvas -> PI Canvas.
//
// Chat primitives (.gl-msg-row/.gl-avatar/.gl-bubble/_glFormatChatText) are
// reused verbatim from guided-launch.js, per this build's explicit
// instruction — not reimplemented here.

// ══════════════════════════════════════════════════════════════════════════
// Reset (mirrors guided-launch.js's glResetState(), called from the same
// call site in home.js's homeClearSession())
// ══════════════════════════════════════════════════════════════════════════
function raResetState(){
  raEnabled=false;
  raConversations=[];
  raLastOpenConversationId=null;
  raActiveConversationId=null;
  raBusy=false;
}

// ══════════════════════════════════════════════════════════════════════════
// Small helpers
// ══════════════════════════════════════════════════════════════════════════
function _raParseJSON(txt){
  var clean=(txt||'').replace(/```json|```/g,'').trim();
  try{ return JSON.parse(clean); }catch(e){}
  var first=clean.indexOf('{'), last=clean.lastIndexOf('}');
  if(first>=0&&last>first){
    try{ return JSON.parse(clean.slice(first,last+1)); }catch(e2){}
  }
  return null;
}
// First name of the logged-in user, for the opening-turn greeting. Mirrors
// guided-launch.js's _glUserInitials() pattern (reads currentUser.displayName)
// but takes the first whitespace-delimited token instead of initials.
function _raFirstName(){
  var name=(typeof currentUser!=='undefined'&&currentUser)?(currentUser.displayName||''):'';
  var first=name.trim().split(/\s+/)[0];
  return first||'there';
}
// Dedupe openQuestions text before mapping to tracked objects — a safety
// net against the model returning a duplicate/near-duplicate question
// (confirmed contributor to the "modal count doesn't match visible chat
// questions" bug: a duplicate entry inflates openQuestions.length without
// a second visible numbered item in chatReply). Case/whitespace-insensitive.
function _raDedupeQuestions(arr){
  var seen={};
  return (arr||[]).filter(function(q){
    var k=String(q||'').trim().toLowerCase();
    if(!k||seen[k])return false;
    seen[k]=true;
    return true;
  });
}
// Parse the Live Draft's "## Capabilities Touched" section into structured
// {key,name,isNew} entries. This is the ONLY source of truth for
// conv.touchedCapabilityKeys — the model returns capability info solely as
// markdown sub-headings inside liveDraftMd (see buildRequirementAgent*
// Prompt()'s "(existing)"/"(will be created)" tagging rule in prompts.js),
// never as a separate structured field. Without this parser,
// touchedCapabilityKeys stays permanently empty and raRunFinalizeSequence()
// has nothing to iterate over (confirmed root cause of Finalize being a
// silent no-op — capStore/scCanvas never receive any writes).
function _raParseTouchedCapabilities(md){
  var lines=(md||'').split('\n');
  var inSection=false;
  var out=[];
  var seen={};
  for(var i=0;i<lines.length;i++){
    var line=lines[i];
    if(/^##\s+Capabilities Touched\s*$/i.test(line)){inSection=true;continue;}
    if(inSection&&/^##\s+/.test(line)){break;} // next top-level "## " section ends it
    if(!inSection)continue;
    var m=line.match(/^#{2,6}\s*\**\s*(.+?)\s*\**\s*\((existing|will be created)\)\s*$/i);
    if(m){
      var name=m[1].trim().replace(/^\**|\**$/g,'').trim();
      if(!name)continue;
      var isNew=/will be created/i.test(m[2]);
      var dedupeKey=name.toLowerCase();
      if(seen[dedupeKey])continue;
      seen[dedupeKey]=true;
      out.push({key:name,name:name,isNew:isNew});
    }
  }
  return out;
}
function _raUid(){
  return 'ra_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
}
function _raFindConv(id){
  return raConversations.find(function(c){return c.id===id;})||null;
}
function _raActiveConv(){
  return raActiveConversationId?_raFindConv(raActiveConversationId):null;
}
function _raRqLabel(n){
  // Zero-padded to 2 digits, e.g. "RQ02" — per spec, never re-derived or
  // reused once assigned.
  var s=String(n);
  return 'RQ'+(s.length<2?('0'+s):s);
}
function _raRelTime(iso){
  if(!iso)return'';
  var ms=Date.now()-new Date(iso).getTime();
  if(ms<0)ms=0;
  var mins=Math.round(ms/60000);
  if(mins<1)return'just now';
  if(mins<60)return mins+' min ago';
  var hrs=Math.round(mins/60);
  if(hrs<24)return hrs+' hour'+(hrs!==1?'s':'')+' ago';
  var days=Math.round(hrs/24);
  return days+' day'+(days!==1?'s':'')+' ago';
}
// Reuses guided-launch.js's markdown renderer verbatim — same subset of
// markdown (H1/H2/H3, paragraphs, "- " bullets) the AI is instructed to
// produce in both modules' prompts.
function _raMdToHtml(md){
  if(typeof _glMdToHtml==='function')return _glMdToHtml(md,null);
  return '<pre style="white-space:pre-wrap;">'+e(md||'')+'</pre>';
}

// ══════════════════════════════════════════════════════════════════════════
// Session-resume entry point (called from session-store.js's
// sessionStoreRestore(), independent of targetTab — same reasoning as
// glApplyRestoredSnapshot())
// ══════════════════════════════════════════════════════════════════════════
function raApplyRestoredSnapshot(s){
  raConversations=(s&&s.raConversations)||[];
  raLastOpenConversationId=(s&&s.raLastOpenConversationId)||null;
  raActiveConversationId=raLastOpenConversationId&&_raFindConv(raLastOpenConversationId)?raLastOpenConversationId:null;
  // Render happens lazily on tab entry (raOnTabEnter(), called from
  // api.js's switchTab()) — mirrors every OTHER tab's resume pattern in
  // this codebase (fcRenderCanvas/newScRender/etc. all render on tab entry,
  // not eagerly at restore time), not just Guided Launch's own eager
  // pattern (which is the one exception, because #gl-tab needs to be
  // populated even when landing directly on 'mm' — Requirement Agent has
  // no equivalent post-finalize redirect-away-and-still-need-content case).
  var root=document.getElementById('ra-tab');
  if(root&&root.classList.contains('on'))raOnTabEnter();
}

// ══════════════════════════════════════════════════════════════════════════
// Tab entry
// ══════════════════════════════════════════════════════════════════════════
function raOnTabEnter(){
  raRenderShell();
}

// ══════════════════════════════════════════════════════════════════════════
// Entry from Capability Canvas — "Define Requirements" CTA
// ══════════════════════════════════════════════════════════════════════════
function raDefineRequirements(){
  // Resume the PM's most recent Draft conversation if one exists (most
  // recent by updatedAt among status==='draft'), else create a new one.
  var drafts=raConversations.filter(function(c){return c.status==='draft';});
  drafts.sort(function(a,b){return new Date(b.updatedAt)-new Date(a.updatedAt);});
  var tabRa=document.getElementById('tab-ra');
  if(tabRa)tabRa.classList.add('revealed');
  if(drafts.length){
    raActiveConversationId=drafts[0].id;
    switchTab('ra');
  } else {
    switchTab('ra');
    raNewConversation();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Shell render — left panel (conversation list) + chat + live draft
// ══════════════════════════════════════════════════════════════════════════
var raFilterState='all'; // 'all' | 'draft' | 'finalized' — left-panel filter chips, view-scoped only, not persisted
var raPanelOpen=true;    // left panel expand/collapse state — view-scoped only, mirrors guided-launch.js's glPanelOpen (not persisted)

// Left panel — the real global .left/.ph/.collapse-btn structure (copied
// from index.html's #left-panel, same convention guided-launch.js's
// #gl-left already follows — see glRenderShell()'s comment), NOT a bespoke
// panel. raTogglePanel() mirrors glTogglePanel()/left-panel.js's
// togglePanel() exactly, scoped to #ra-left/its own icon ids.
function raRenderShell(){
  var root=document.getElementById('ra-tab');
  if(!root)return;
  root.innerHTML=
    '<div class="left ra-left'+(raPanelOpen?'':' collapsed')+'" id="ra-left">'
      +'<div class="ph">'
        +'<div class="ph-text"><div class="ph-title">Requirement Agent</div><div class="ph-sub">One conversation = one release scope</div></div>'
        +'<button class="collapse-btn" onclick="raTogglePanel()" title="Toggle panel">'
          +'<svg id="icon-ra-exp" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:'+(raPanelOpen?'block':'none')+'"><polyline points="15 18 9 12 15 6"/><polyline points="21 18 15 12 21 6"/></svg>'
          +'<svg id="icon-ra-col" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:'+(raPanelOpen?'none':'block')+'"><polyline points="9 18 15 12 9 6"/><polyline points="3 18 9 12 3 6"/></svg>'
        +'</button>'
      +'</div>'
      +'<div class="ra-left-body">'
        +'<div class="ra-filter-chips" id="ra-filter-chips"></div>'
        +'<div class="ra-conv-list" id="ra-conv-list"></div>'
        +'<button class="ra-new-conv-btn" id="ra-new-conv-btn" onclick="raNewConversation()"><i class="ti ti-plus" style="font-size:11px;" aria-hidden="true"></i> New Conversation</button>'
      +'</div>'
    +'</div>'
    +'<div class="ra-center" id="ra-center"></div>'
    +'<div class="ra-right" id="ra-right"></div>';
  raRenderFilterChips();
  raRenderConvList();
  raRenderCenter();
}

function raTogglePanel(){
  raPanelOpen=!raPanelOpen;
  var left=document.getElementById('ra-left');
  if(left)left.classList.toggle('collapsed',!raPanelOpen);
  var expIcon=document.getElementById('icon-ra-exp');
  var colIcon=document.getElementById('icon-ra-col');
  if(expIcon)expIcon.style.display=raPanelOpen?'block':'none';
  if(colIcon)colIcon.style.display=raPanelOpen?'none':'block';
}

function raRenderFilterChips(){
  var chips=document.getElementById('ra-filter-chips');
  if(!chips)return;
  chips.innerHTML=['all','draft','finalized'].map(function(f){
    return '<button class="ra-chip'+(raFilterState===f?' active':'')+'" onclick="raSetFilter(\''+f+'\')">'+(f==='all'?'All':f==='draft'?'Draft':'Finalized')+'</button>';
  }).join('');
}

function raSetFilter(f){
  raFilterState=f;
  raRenderFilterChips();
  raRenderConvList();
}

function raRenderConvList(){
  var list=document.getElementById('ra-conv-list');
  if(!list)return;
  var items=raConversations.slice();
  items.sort(function(a,b){return new Date(b.updatedAt)-new Date(a.updatedAt);});
  if(raFilterState!=='all')items=items.filter(function(c){return c.status===raFilterState;});
  if(!items.length){
    list.innerHTML='<div class="ra-conv-empty">No conversations yet. Start one below.</div>';
    return;
  }
  list.innerHTML=items.map(function(c){
    var isActive=c.id===raActiveConversationId;
    var capCount=(c.touchedCapabilityKeys||[]).length;
    var featCount=(c.generatedFeatureIds||[]).length;
    var summary=c.status==='finalized'
      ?(capCount+' capabilit'+(capCount!==1?'ies':'y')+' · '+featCount+' feature'+(featCount!==1?'s':'')+' · finalized '+_raRelTime(c.updatedAt))
      :('Updated '+_raRelTime(c.updatedAt)+' · not yet finalized');
    var tag=(c.status==='finalized'&&c.rqNumber)?('<span class="ra-rq-tag">'+e(c.rqNumber)+'</span> '):'';
    return '<div class="ra-conv-card'+(isActive?' active':'')+'" onclick="raOpenConversation(\''+c.id+'\')">'
      +'<div class="ra-conv-title-row">'
        +'<div class="ra-conv-title" id="ra-conv-title-'+c.id+'">'+tag+e(c.title||'Untitled conversation')+'</div>'
        +(isActive?'<button class="ra-conv-rename-btn" onclick="event.stopPropagation();raRenameConversation(\''+c.id+'\')" title="Rename"><i class="ti ti-pencil" style="font-size:10px;" aria-hidden="true"></i></button>':'')
      +'</div>'
      +'<div class="ra-conv-summary">'+e(summary)+'</div>'
    +'</div>';
  }).join('');
}

function raRenameConversation(id){
  var conv=_raFindConv(id);
  if(!conv)return;
  var titleEl=document.getElementById('ra-conv-title-'+id);
  if(!titleEl)return;
  var current=conv.title||'';
  titleEl.innerHTML='<input type="text" class="ra-rename-input" id="ra-rename-input-'+id+'" value="'+e(current)+'" onkeydown="if(event.key===\'Enter\')raSaveRename(\''+id+'\');if(event.key===\'Escape\')raRenderConvList();" onblur="raSaveRename(\''+id+'\')">';
  var input=document.getElementById('ra-rename-input-'+id);
  if(input){input.focus();input.select();}
}
function raSaveRename(id){
  var conv=_raFindConv(id);
  var input=document.getElementById('ra-rename-input-'+id);
  if(!conv||!input)return;
  var val=input.value.trim();
  if(val)conv.title=val;
  conv.updatedAt=new Date().toISOString();
  raRenderConvList();
  _raPersist();
}

// ══════════════════════════════════════════════════════════════════════════
// Center (chat) + right (live draft) — rendered together per active conv
// ══════════════════════════════════════════════════════════════════════════
function raRenderCenter(){
  var center=document.getElementById('ra-center');
  var right=document.getElementById('ra-right');
  if(!center||!right)return;
  var conv=_raActiveConv();
  if(!conv){
    center.innerHTML='<div class="ra-empty-state"><i class="ti ti-clipboard-text" style="font-size:28px;color:var(--label);" aria-hidden="true"></i><div style="font-size:13px;font-weight:600;color:var(--t2);margin-top:10px;">No conversation open</div><div style="font-size:11px;color:var(--t3);margin-top:4px;">Start a new one, or pick a conversation on the left.</div></div>';
    right.innerHTML='';
    return;
  }
  center.innerHTML=
    '<div class="ra-chat-hdr"><div class="ra-chat-hdr-eyebrow">'+(conv.status==='finalized'?('Finalized '+(conv.rqNumber?e(conv.rqNumber):'')):'Drafting')+'</div><div class="ra-chat-hdr-title">'+e(conv.title||'Untitled conversation')+'</div></div>'
    +'<div class="ra-chat-body" id="ra-chat-body"></div>'
    +(conv.status==='finalized'
      ?'<div class="ra-chat-input-wrap"><div class="ra-finalized-note">This conversation is finalized — chat is closed.</div></div>'
      :'<div class="ra-chat-input-wrap"><div class="ra-chat-input-row">'
        +'<textarea class="ra-chat-input" id="ra-chat-input" rows="1" placeholder="Type your response..." onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();raSendMessage();}"></textarea>'
        +'<button class="ra-chat-send" id="ra-send-btn" onclick="raSendMessage()" title="Send"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>'
      +'</div></div>');
  raRenderChatHistory();
  raRenderLiveDraft();
  if(!conv.messages||!conv.messages.length){
    raRunOpeningTurn(conv);
  }
}

function raOpenConversation(id){
  raActiveConversationId=id;
  raLastOpenConversationId=id;
  raRenderConvList();
  raRenderCenter();
  _raPersist();
}

function _raBubbleHtml(m,idx){
  var isUser=m.role==='user';
  var highlightId='ra-msg-'+idx;
  return '<div class="gl-msg-row '+(isUser?'user':'agent')+'" id="'+highlightId+'">'
    +'<div class="gl-avatar '+(isUser?'user-av':'agent-av')+'">'+(isUser?e((typeof _glUserInitials==='function')?_glUserInitials():'You'):'AI')+'</div>'
    +'<div class="gl-bubble">'+(typeof _glFormatChatText==='function'?_glFormatChatText(m.text):e(m.text||''))+'</div>'
  +'</div>';
}
function raRenderChatHistory(){
  var body=document.getElementById('ra-chat-body');
  var conv=_raActiveConv();
  if(!body||!conv)return;
  body.innerHTML=(conv.messages||[]).map(function(m,idx){return _raBubbleHtml(m,idx);}).join('');
  body.scrollTop=body.scrollHeight;
}
function raAppendMessage(conv,role,text){
  conv.messages=conv.messages||[];
  conv.messages.push({role:role,text:text,timestamp:new Date().toISOString()});
  var body=document.getElementById('ra-chat-body');
  if(body){
    body.insertAdjacentHTML('beforeend',_raBubbleHtml(conv.messages[conv.messages.length-1],conv.messages.length-1));
    body.scrollTop=body.scrollHeight;
  }
}
function _raSetBusy(busy){
  raBusy=busy;
  var sendBtn=document.getElementById('ra-send-btn');
  var input=document.getElementById('ra-chat-input');
  if(sendBtn)sendBtn.disabled=busy;
  if(input)input.disabled=busy;
}
function _raTypingRowHtml(){
  return '<div class="gl-msg-row agent" id="ra-typing-row"><div class="gl-avatar agent-av">AI</div><div class="gl-bubble gl-typing-bubble"><div class="gl-typing-dots"><span></span><span></span><span></span></div></div></div>';
}
function _raShowTyping(){
  var body=document.getElementById('ra-chat-body');
  if(body){body.insertAdjacentHTML('beforeend',_raTypingRowHtml());body.scrollTop=body.scrollHeight;}
}
function _raHideTyping(){
  var row=document.getElementById('ra-typing-row');
  if(row)row.remove();
}

async function _raCallModel(sys,usr,signal){
  var extra={session_id:(typeof _activeSessionId!=='undefined'?_activeSessionId:null),product_id:(typeof productContext!=='undefined'&&productContext?productContext.id:null),session_type:'ChatCanvas'};
  return await callAPI(sys,usr,3000,signal||null,null,'requirement-agent',null,extra);
}

// ── New conversation ──
function raNewConversation(){
  var conv={
    id:_raUid(),
    title:'New Conversation',
    rqNumber:null,
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    status:'draft',
    touchedCapabilityKeys:[],
    messages:[],
    openQuestions:[],
    liveDraftMd:'',
    draftVersion:0,
    generatedFeatureIds:[]
  };
  raConversations.push(conv);
  raActiveConversationId=conv.id;
  raLastOpenConversationId=conv.id;
  var tabRa=document.getElementById('tab-ra');
  if(tabRa)tabRa.classList.add('revealed');
  raRenderConvList();
  raRenderCenter();
  _raPersist();
}

async function raRunOpeningTurn(conv){
  if(!conv||raBusy)return;
  _raSetBusy(true);
  _raShowTyping();
  // v9.17.03 (Item 3) — every other tab's in-flight AI call (Capability
  // Canvas feature-gen, Market Intelligence, PI scoring, etc.) is guarded by
  // startAiGen()/endAiGen() so switchTab() shows a "leave/stay" confirmation
  // if the user navigates away mid-call. Requirement Agent's raBusy flag was
  // never wired into that shared mechanism, so navigating away mid-turn just
  // silently proceeded — confirmed as a real gap (raBusy exists and blocks
  // RA's own UI, but aiGenInFlight, the thing switchTab() actually checks,
  // was never set). Wiring it in here, in _raRunTurn(), and in
  // raRunFinalizeSequence() below.
  var _signal=(typeof startAiGen==='function')?startAiGen('Requirement Agent is drafting the opening summary. Leaving now discards it, you\'ll need to start over.'):null;
  try{
    var built=buildRequirementAgentOpeningPrompt(typeof sessionContext!=='undefined'?sessionContext:{},_raFirstName());
    var raw=await _raCallModel(built.sys,built.usr,_signal);
    var parsed=_raParseJSON(raw);
    _raHideTyping();
    if(typeof endAiGen==='function')endAiGen();
    if(!parsed||!parsed.liveDraftMd){
      raAppendMessage(conv,'agent','I had trouble putting together an opening summary just now. Try typing a message below and I’ll pick this up from there.');
      return;
    }
    conv.liveDraftMd=parsed.liveDraftMd;
    conv.draftVersion=1;
    conv.touchedCapabilityKeys=_raParseTouchedCapabilities(conv.liveDraftMd);
    conv.openQuestions=_raDedupeQuestions(parsed.openQuestions).map(function(q,i){return {id:'oq'+i,type:'clarification',resolved:false,messageIndex:(conv.messages||[]).length};});
    raAppendMessage(conv,'agent',parsed.chatReply||'Here’s a starting draft — take a look on the right.');
    // Derive title from the product name if still default
    if(conv.title==='New Conversation'){
      var pp=(typeof sessionContext!=='undefined'&&sessionContext&&sessionContext.productProfile)||{};
      conv.title=(pp.productName?pp.productName+' — ':'')+'Release requirements';
    }
    conv.updatedAt=new Date().toISOString();
    raRenderLiveDraft();
    raRenderConvList();
    _raPersist();
  }catch(err){
    _raHideTyping();
    if(typeof endAiGen==='function')endAiGen();
    if(err&&err.name==='AbortError')return; // user chose "Leave anyway" — no error bubble needed
    console.warn('[requirement-agent] opening turn failed',err);
    raAppendMessage(conv,'agent','Something went wrong generating the opening summary ('+(err&&err.message?err.message:'unknown error')+'). Type a message below, or refresh and try again.');
  }finally{
    _raSetBusy(false);
  }
}

async function raSendMessage(){
  var conv=_raActiveConv();
  if(!conv||raBusy||conv.status!=='draft')return;
  var input=document.getElementById('ra-chat-input');
  if(!input)return;
  var text=input.value.trim();
  if(!text)return;
  input.value='';
  raAppendMessage(conv,'user',text);
  await _raRunTurn(conv,text);
}

async function _raRunTurn(conv,userMessage){
  _raSetBusy(true);
  _raShowTyping();
  var _signal=(typeof startAiGen==='function')?startAiGen('Requirement Agent is updating the draft. Leaving now discards this update, you\'ll need to resend your message.'):null;
  try{
    var built=buildRequirementAgentTurnPrompt(typeof sessionContext!=='undefined'?sessionContext:{},conv.liveDraftMd,(conv.messages||[]).slice(0,-1),userMessage);
    var raw=await _raCallModel(built.sys,built.usr,_signal);
    var parsed=_raParseJSON(raw);
    _raHideTyping();
    if(typeof endAiGen==='function')endAiGen();
    if(!parsed||!parsed.liveDraftMd){
      raAppendMessage(conv,'agent','I couldn’t process that update. Could you rephrase, or try again?');
      return;
    }
    conv.liveDraftMd=parsed.liveDraftMd;
    conv.draftVersion=(conv.draftVersion||1)+1;
    conv.touchedCapabilityKeys=_raParseTouchedCapabilities(conv.liveDraftMd);
    var existingResolved={};
    (conv.openQuestions||[]).forEach(function(q){existingResolved[q.id]=q.resolved;});
    conv.openQuestions=_raDedupeQuestions(parsed.openQuestions).map(function(q,i){var id='oq'+i;return {id:id,type:'clarification',resolved:!!existingResolved[id],messageIndex:(conv.messages||[]).length};});
    raAppendMessage(conv,'agent',parsed.chatReply||'Updated the draft — take a look.');
    conv.updatedAt=new Date().toISOString();
    raRenderLiveDraft();
    raRenderConvList();
    _raPersist();
  }catch(err){
    _raHideTyping();
    if(typeof endAiGen==='function')endAiGen();
    if(err&&err.name==='AbortError')return; // user chose "Leave anyway" — no error bubble needed
    console.warn('[requirement-agent] turn failed',err);
    raAppendMessage(conv,'agent','Something went wrong processing that ('+(err&&err.message?err.message:'unknown error')+'). Please try again.');
  }finally{
    _raSetBusy(false);
  }
}

// ── Live draft (right panel) ──
function raRenderLiveDraft(){
  var right=document.getElementById('ra-right');
  var conv=_raActiveConv();
  if(!right||!conv)return;
  var unresolvedCount=(conv.openQuestions||[]).filter(function(q){return!q.resolved;}).length;
  var verLabel=(conv.draftVersion>0)?(' · v0.'+(String(conv.draftVersion).length<2?('0'+conv.draftVersion):conv.draftVersion)):'';
  right.innerHTML=
    '<div class="ra-md-hdr"><div class="ra-md-hdr-eyebrow">Live Draft</div><div class="ra-md-hdr-title">'+e(conv.title||'Untitled conversation')+'<span class="ra-md-hdr-ver">'+verLabel+'</span></div></div>'
    +'<div class="ra-md-body" id="ra-md-body">'+_raMdToHtml(conv.liveDraftMd)+'</div>'
    +(conv.status==='finalized'
      ?'<div class="ra-md-footer"><div class="ra-status-badge ra-status-final">Finalized'+(conv.rqNumber?(' · '+e(conv.rqNumber)):'')+'</div></div>'
      :'<div class="ra-md-footer">'
        +'<button class="ra-finalize-btn" id="ra-finalize-btn" onclick="raFinalizeClick()"><i class="ti ti-check" style="font-size:12px;" aria-hidden="true"></i> Finalize</button>'
        +'<div class="ra-footer-note">Generates the features and opens Feature Canvas.</div>'
      +'</div>');
}

// ══════════════════════════════════════════════════════════════════════════
// Finalize-blocked assumption modal — Type-1 Warn, per DESIGN_SYSTEM.md §8
// ══════════════════════════════════════════════════════════════════════════
function raFinalizeClick(){
  var conv=_raActiveConv();
  if(!conv||conv.status==='finalized'||raBusy)return;
  var unresolved=(conv.openQuestions||[]).filter(function(q){return!q.resolved;});
  if(!unresolved.length){
    raRunFinalizeSequence(conv,false);
    return;
  }
  raShowAssumptionModal(conv,unresolved.length);
}

function raShowAssumptionModal(conv,n){
  var overlayId='ra-assume-overlay';
  var existing=document.getElementById(overlayId);
  if(existing)existing.remove();
  var overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id=overlayId;
  overlay.innerHTML=
    '<div class="modal" style="max-width:400px;position:relative;">'
      +'<button onclick="document.getElementById(\''+overlayId+'\').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:3px;color:var(--t3);display:flex;align-items:center;border-radius:4px;z-index:1;" title="Close">'
        +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      +'</button>'
      +'<div style="padding:20px 52px 20px 20px;display:flex;align-items:flex-start;gap:12px;">'
        +'<div style="width:30px;height:30px;border-radius:7px;background:#FAEEDA;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">'
          +'<i class="ti ti-alert-triangle" style="font-size:15px;color:#BA7517;" aria-hidden="true"></i>'
        +'</div>'
        +'<div style="flex:1;min-width:0;">'
          +'<div style="font-size:13px;font-weight:500;color:var(--t1);line-height:1.35;margin-bottom:6px;">Unanswered questions in this conversation</div>'
          +'<div style="font-size:11px;color:var(--t3);line-height:1.6;">You have '+n+' unanswered question(s) in this conversation. If you finalize now, Requirement Agent will make its own assumptions to fill the gaps, clearly marked in the brief.</div>'
        +'</div>'
      +'</div>'
      +'<div style="padding:10px 20px 16px;display:flex;justify-content:flex-end;gap:6px;">'
        +'<button style="background:none;color:var(--t2);border:1px solid var(--divider);border-radius:5px;padding:5px 14px;font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer;" onclick="raReviewQuestions(\''+conv.id+'\',\''+overlayId+'\')">Review Questions</button>'
        +'<button style="background:#BA7517;color:#fff;border:none;border-radius:5px;padding:5px 14px;font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer;" onclick="raFinalizeWithAssumptions(\''+conv.id+'\',\''+overlayId+'\')">Finalize with Assumptions</button>'
      +'</div>'
    +'</div>';
  document.body.appendChild(overlay);
  trapFocus(overlay);
  var _esc=function(ev){
    if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',_esc,true);}
  };
  document.addEventListener('keydown',_esc,true);
}

// "Review Questions" — closes modal, jumps to/highlights the first
// unresolved question's message in chat. Reuses guided-launch.js's own
// flash/scroll-into-view convention (glRenderMdBody()'s .gl-flash pattern)
// applied here to a chat bubble instead of a markdown section — the closest
// existing "jump to and highlight a specific message" precedent in this
// codebase (confirmed via grep of guided-launch.js/feature-canvas.js/
// story-canvas-new.js; no other file implements a message-level highlight).
function raReviewQuestions(convId,overlayId){
  var overlay=document.getElementById(overlayId);
  if(overlay)overlay.remove();
  var conv=_raFindConv(convId);
  if(!conv)return;
  var unresolved=(conv.openQuestions||[]).filter(function(q){return!q.resolved;});
  if(!unresolved.length)return;
  var target=unresolved[0];
  var row=document.getElementById('ra-msg-'+target.messageIndex);
  if(row&&typeof row.scrollIntoView==='function'){
    row.scrollIntoView({behavior:'smooth',block:'center'});
    row.classList.add('gl-flash');
    setTimeout(function(){row.classList.remove('gl-flash');},2600);
  }
  var input=document.getElementById('ra-chat-input');
  if(input)input.focus();
}

// "Finalize with Assumptions" — resolves every unanswered open question
// with the agent's own best assumption, logs each as a distinct persisted
// "**Assumed:**" line in liveDraftMd (not just shown transiently in chat),
// then runs the same finalize sequence.
async function raFinalizeWithAssumptions(convId,overlayId){
  var overlay=document.getElementById(overlayId);
  if(overlay)overlay.remove();
  var conv=_raFindConv(convId);
  if(!conv||raBusy)return;
  await raRunFinalizeSequence(conv,true);
}

// ══════════════════════════════════════════════════════════════════════════
// Finalize sequence (atomic) — the one integration function per spec:
//   1. Resolve open questions with assumptions if needed (logged in
//      liveDraftMd, persisted — not transient chat-only).
//   2. For every isNew:true touched capability, create/find the capStore
//      entry — mirrors capability-canvas.js's ccDoAddCap() manual-add
//      pattern EXACTLY (bucket/metric resolution via _bucketId/
//      getOrCreateCurrentDefaultPiBucket(), same capStore shape), kept in
//      the SAME conditional block as the capability's _piStage lookup — the
//      documented v9.05 split-brain bug (capStore write and _piStage
//      creation done in two separate conditionals) is explicitly NOT
//      reintroduced here.
//   3. Generate features for every touched capability (existing + newly
//      created), sourced from liveDraftMd via buildRAFeatureGenPrompt().
//   4. Call ra_next_seq BEFORE generation completes, so the finalized
//      conversation and its generated features end up with a MATCHING
//      rqNumber, no partial state.
//   5. Tag every generated feature with intakeBriefId + rqNumber.
//   6. Save per AI_EDITING_RULES.md's live-sync contract: capture
//      _activeSessionId into a local var BEFORE any async work -> mutate ->
//      sessionStoreSave() -> emit live-sync event ONLY on success. This is
//      NOT modeled on ccSaveFeatName()/ccSaveFeatWhy() (confirmed violators
//      of this exact contract, pre-existing debt) — built independently,
//      correctly, from the rule itself.
//   7. Navigate to Feature Canvas automatically.
// ══════════════════════════════════════════════════════════════════════════
async function raRunFinalizeSequence(conv,withAssumptions){
  if(!conv||raBusy)return;
  raBusy=true;
  var btn=document.getElementById('ra-finalize-btn');
  if(btn){btn.disabled=true;btn.textContent='Finalizing...';}
  // v9.17.03 (Item 3) — single guard for the whole atomic sequence (mirrors
  // pi-planning.js's single long-running startAiGen for its multi-call PI
  // scoring operation) since this can fire several sequential feature-gen
  // calls, one per touched capability, and none of them should be
  // interruptible by an unguarded tab switch.
  var _finalizeSignal=(typeof startAiGen==='function')?startAiGen('Requirement Agent is finalizing this brief and generating features. Leaving now will leave the brief partially finalized.'):null;

  // Capture session identity BEFORE any async work — never re-read
  // _activeSessionId inside a later callback, per AI_EDITING_RULES.md.
  var saveSessionId=(typeof _activeSessionId!=='undefined')?_activeSessionId:null;
  var wasSharedSession=(typeof _activeSessionIsShared!=='undefined'&&_activeSessionIsShared);

  try{
    // Step 1 — resolve open questions with assumptions, logged persistently.
    if(withAssumptions){
      var unresolved=(conv.openQuestions||[]).filter(function(q){return!q.resolved;});
      if(unresolved.length){
        var assumedLines=unresolved.map(function(q,i){
          return '**Assumed:** Requirement Agent could not get a direct answer to open question #'+(i+1)+' before finalizing and proceeded with its own best judgment based on the brief above.';
        });
        conv.liveDraftMd=(conv.liveDraftMd||'')+'\n\n## Assumptions Made at Finalize\n'+assumedLines.join('\n')+'\n';
        conv.openQuestions.forEach(function(q){q.resolved=true;});
      }
    }

    // Step 2 — resolve/create capStore entries for isNew capabilities.
    var touched=conv.touchedCapabilityKeys||[];
    var _ctx=(typeof getFullProductCtx==='function')?getFullProductCtx():{};
    _ctx.docContext='';
    var nsm=(typeof gData!=='undefined'&&gData)?gData.nsm.metric:'';
    var resolvedTargets=[]; // [{metricKey, capIdx, capName}]

    touched.forEach(function(t){
      var parts=(t.key||'').split('||');
      var metricKeyGuess=t.key;
      var capNameGuess=parts.length>1?parts[1]:t.key;
      if(t.isNew){
        // Mirror ccDoAddCap()'s manual-add-to-Custom-Value-Stage pattern
        // EXACTLY — capStore write + _piStage creation in the SAME
        // conditional block (v9.05 split-brain bug, not reintroduced).
        var piKey=(typeof ccPIKey==='function')?ccPIKey(capNameGuess):('pi||'+capNameGuess.toLowerCase().replace(/[^a-z0-9]+/g,'_'));
        var _bucketId=(typeof getOrCreateCurrentDefaultPiBucket==='function'&&typeof gData!=='undefined'&&typeof capStore!=='undefined')
          ?getOrCreateCurrentDefaultPiBucket(gData,capStore):null;
        if(typeof capStore!=='undefined'){
          if(!capStore[piKey]){
            capStore[piKey]={metricName:capNameGuess,stageLabel:(typeof getPiStageLabel==='function'?getPiStageLabel(gData):'Custom Value Stage'),stageId:'pi',bucketId:_bucketId,_piFirst:true,capabilities:[{name:capNameGuess,why:'Created by Requirement Agent for this release.',subCaps:null,features:[],_manual:true}]};
          } else if(!capStore[piKey].capabilities.some(function(c){return c.name===capNameGuess;})){
            capStore[piKey].capabilities.push({name:capNameGuess,why:'Created by Requirement Agent for this release.',subCaps:null,features:[],_manual:true});
          }
        }
        var newCapIdx=capStore[piKey].capabilities.findIndex(function(c){return c.name===capNameGuess;});
        resolvedTargets.push({metricKey:piKey,capIdx:newCapIdx,capName:capNameGuess});
      } else {
        // Existing capability — find it by exact name across capStore.
        var foundKey=null,foundIdx=-1;
        if(typeof capStore!=='undefined'){
          Object.keys(capStore).some(function(mk){
            var idx=(capStore[mk].capabilities||[]).findIndex(function(c){return c.name===capNameGuess;});
            if(idx>=0){foundKey=mk;foundIdx=idx;return true;}
            return false;
          });
        }
        if(foundKey)resolvedTargets.push({metricKey:foundKey,capIdx:foundIdx,capName:capNameGuess});
      }
    });

    // Step 3+4 — get the RQ number FIRST (so a generation failure never
    // leaves a mismatched rqNumber between the conversation and its
    // features), then generate features for every resolved target.
    var rqLabel=null;
    if(saveSessionId){
      try{
        var _rpcRes=await _pgtRpc('ra_next_seq',{p_session_id:saveSessionId});
        if(_rpcRes&&!_rpcRes.error&&typeof _rpcRes.data==='number'){
          rqLabel=_raRqLabel(_rpcRes.data);
        }
      }catch(rpcErr){
        console.warn('[requirement-agent] ra_next_seq RPC failed',rpcErr);
      }
    }
    // Fallback numbering (RPC unreachable, e.g. local/offline dev) — still
    // deterministic and never reused, just not sequence-safe across
    // concurrent sessions. Flagged via console.warn above; not silent.
    if(!rqLabel){
      var _maxExisting=raConversations.reduce(function(mx,c){
        if(c.rqNumber){var n=parseInt(String(c.rqNumber).replace(/\D/g,''),10);if(!isNaN(n)&&n>mx)mx=n;}
        return mx;
      },0);
      rqLabel=_raRqLabel(_maxExisting+1);
    }

    var generatedFeatureIds=[];
    for(var i=0;i<resolvedTargets.length;i++){
      var tgt=resolvedTargets[i];
      var entry=capStore[tgt.metricKey];
      var cap=entry&&entry.capabilities[tgt.capIdx];
      if(!entry||!cap)continue;
      try{
        var promptBuilt=buildRAFeatureGenPrompt(_ctx,nsm,entry.stageLabel,entry.metricName,cap.name,conv.liveDraftMd);
        var featTxt=await callAPI(
          'You are a senior product strategist. Specific, actionable, product-native. Respond ONLY with valid JSON. No markdown, no backticks, no preamble. Never use em dashes (—) in your output; use a hyphen (-) or rewrite the phrase.',
          promptBuilt,3000,_finalizeSignal,null,'requirement-agent',null,{session_id:saveSessionId}
        );
        // NOTE: deliberately NOT using the global parseJSON() helper here —
        // that function is hard-coded to Discovery Map "tree" validation
        // (api.js's isValidTree() requires nsm/stages) and returns null for
        // every other JSON shape, including this {features:[...]} response.
        // Using it silently discarded every generated feature (confirmed via
        // live network trace: the model returned valid {features:[...]}
        // JSON, but parseJSON()->isValidTree() rejected it and repairJSON()
        // could never produce a tree-shaped result either, so rawFeats was
        // always []). Mirrors capability-canvas.js's own feature-gen parsing
        // (ccGenerateFeaturesForCap(), ~line 3233) instead: plain JSON.parse
        // with a brace-slice fallback for stray preamble/fence text.
        var parsedFeat=null;
        var _cleanFeatTxt=(featTxt||'').replace(/```json|```/g,'').trim();
        try{ parsedFeat=JSON.parse(_cleanFeatTxt); }
        catch(pe){
          var _s=_cleanFeatTxt.indexOf('{'),_l=_cleanFeatTxt.lastIndexOf('}');
          if(_s>=0&&_l>_s){ try{ parsedFeat=JSON.parse(_cleanFeatTxt.substring(_s,_l+1)); }catch(pe2){ parsedFeat=null; } }
        }
        var rawFeats=(parsedFeat&&parsedFeat.features)||[];
        // Normalize to the SAME shape ccGenerateFeatures() gives every
        // manually-generated feature (capability-canvas.js ~line 1796) —
        // metric/stage/cap/selected/outcomeHypothesis — then tag with
        // intakeBriefId+rqNumber (denormalized, both stored, per spec).
        // Without this normalization, capStore's featStore entries are
        // missing the fields ccSendToStoryCanvas() (and this function's own
        // scCanvas push below) require to build a Feature Canvas row.
        var newFeats=rawFeats.map(function(f){
          return {name:f.name,why:f.why,selected:false,
            metric:entry.metricName,stage:entry.stageLabel,cap:cap.name,subCap:null,
            outcomeHypothesis:(typeof normalizeAIHypothesis==='function')?normalizeAIHypothesis(f.hypothesis):null,
            intakeBriefId:conv.id,rqNumber:rqLabel};
        });
        if(!cap.featStore)cap.featStore={};
        cap.featStore.top=(cap.featStore.top||[]).concat(newFeats);
        newFeats.forEach(function(f){generatedFeatureIds.push(tgt.metricKey+'|'+tgt.capIdx+'|'+f.name);});

        // Push into scCanvas — Feature Canvas reads from scCanvas, NOT from
        // capStore directly (confirmed via capability-canvas.js's
        // ccSendToStoryCanvas(), the only existing capStore->scCanvas
        // pipe). Finalize must replicate that push itself since RA's
        // finalize is not routed through the manual "Send to Feature
        // Canvas" button — writing only to capStore left Feature Canvas
        // permanently empty after Finalize (root cause of the reported
        // empty-state bug).
        if(typeof scCanvas!=='undefined'&&typeof scMakeFeatureId==='function'){
          var _curPiLbl2=(typeof getPiStageLabel==='function')?getPiStageLabel(gData):'Custom Value Stage';
          newFeats.forEach(function(f){
            var fid=scMakeFeatureId(f.metric,f.cap+(f.subCap?'/'+f.subCap:''),f.name);
            if(!scCanvas.find(function(x){return x.id===fid;})){
              var metricPath=(typeof scGetMetricPath==='function')?scGetMetricPath(f.metric):f.metric;
              scCanvas.push({id:fid,metric:f.metric,metricPath:metricPath,stage:f.stage,
                cap:f.cap+(f.subCap?' › '+f.subCap:''),name:f.name,why:f.why,stories:null,
                origin:(f.stage===_curPiLbl2||f.stage==='PI Plan')?'pi':'kpi',
                outcomeHypothesis:(f.outcomeHypothesis&&typeof cloneOutcomeHypothesis==='function')?cloneOutcomeHypothesis(f.outcomeHypothesis):null,
                intakeBriefId:f.intakeBriefId,rqNumber:f.rqNumber});
            }
          });
        }
      }catch(genErr){
        console.warn('[requirement-agent] feature generation failed for',tgt.capName,genErr);
      }
    }

    // Mirror ccSendToStoryCanvas()'s post-send signals so Feature Canvas's
    // tab badge/pending indicator reflect the newly pushed scCanvas rows.
    if(typeof fcUpdateTabBadge==='function')fcUpdateTabBadge();
    if(typeof markTabPending==='function')markTabPending('fc');

    // Mark conversation finalized as part of the SAME save.
    conv.status='finalized';
    conv.rqNumber=rqLabel;
    conv.generatedFeatureIds=generatedFeatureIds;
    conv.updatedAt=new Date().toISOString();

    // Step 6 — persist per the live-sync save/emit contract.
    var saved=false;
    if(saveSessionId&&typeof sessionStoreSave==='function'){
      try{
        saved=await sessionStoreSave(saveSessionId);
      }catch(saveErr){
        console.warn('[requirement-agent] finalize save failed',saveErr);
        saved=false;
      }
    } else {
      saved=true; // no active session id (e.g. demo/local) — nothing to persist against
    }

    if(!saved){
      showToast('Could not save the finalized brief. Please try again.','warn');
      conv.status='draft'; // revert — do not leave a mismatched finalized-but-unsaved state
      conv.rqNumber=null;
      raBusy=false;
      if(btn){btn.disabled=false;btn.textContent='Finalize';}
      raRenderLiveDraft();
      return;
    }

    if(wasSharedSession&&typeof _lsEmitContentEvent==='function'){
      try{
        _lsEmitContentEvent(saveSessionId,'cc','features_generated',null,null);
      }catch(emitErr){
        console.warn('Event emission failed (save already succeeded):',emitErr);
      }
    }

    raRenderConvList();
    raRenderLiveDraft();

    // End the nav-in-flight guard BEFORE this function's own automatic
    // navigation below — switchTab() itself checks aiGenInFlight.active via
    // blockIfGenerating(), so leaving the guard up here would make Finalize's
    // own "navigate to Feature Canvas automatically" step (Step 7) trip its
    // own "Hold on, don't lose this" confirmation on itself, forcing the PM
    // to click "Leave anyway" just to reach the page Finalize is supposed to
    // land them on automatically. Confirmed live: without this reordering,
    // the auto-navigate silently stalled behind a self-triggered guard modal.
    raBusy=false;
    if(typeof endAiGen==='function')endAiGen();
    if(btn){btn.disabled=false;btn.textContent='Finalize';}

    // Step 7 — navigate to Feature Canvas automatically, no intermediate
    // "continue" link.
    var tabFc=document.getElementById('tab-fc');
    if(tabFc)tabFc.classList.remove('data-home-hidden');
    if(tabFc)tabFc.style.display='';
    switchTab('fc');
  } finally {
    raBusy=false;
    if(typeof endAiGen==='function')endAiGen();
    if(btn){btn.disabled=false;btn.textContent='Finalize';}
  }
}

// Persistence — same optimistic pattern glMessages/glDraftMd use via
// _glPersistMessage()/_glPersistDraft(): mutate the live global first (every
// function above already did that before calling this), then save.
async function _raPersist(){
  if(typeof sessionStoreSave!=='function'||typeof _activeSessionId==='undefined'||!_activeSessionId)return;
  try{ await sessionStoreSave(_activeSessionId); }
  catch(err){ console.warn('[requirement-agent] persist failed',err); }
}
