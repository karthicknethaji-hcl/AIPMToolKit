// REQUIREMENT AGENT (ra) — Discovery-First Entry Point redesign
// Global, session-scoped, MULTI-conversation requirements agent — distinct
// from the pre-existing "Guided Launch" chat (rebranded to the tab label
// "Requirement Agent" in a prior v9.16 commit on this same file tree — see
// index.html's #tab-gl comment; that is a copy-only rename of an unrelated,
// single-conversation, pre-Discovery-Map intake flow and is NOT this
// module). One conversation here = one release scope, symmetric across
// every capability it touches from turn one. Unlike Guided Launch (one
// mt_sessions row per conversation), every Requirement Agent conversation
// lives inside the snapshot of the ONE already-active session — see
// state.js's raConversations[] and session-store.js's
// _sessionStoreBuildSnapshot()/_ssApplySnapshotFields().
//
// Value chain (Discovery-First Entry Point redesign): Discovery Map ->
// "Define Requirements" CTA (RA on only) -> Requirement Agent (this file,
// Pass 1 greenfield / Pass 2 iterative) -> Finalize Brief (atomic: lock
// content, assign next RQ number, CREATE capabilities only — no feature
// generation here, see raRunFinalizeSequence()) -> Capability Canvas
// (auto-populated, PM clicks "Generate Features" per capability as today,
// grounded in the intake brief) -> Feature Canvas -> Story Canvas -> PI
// Canvas. RA is no longer entered from Capability Canvas at all.
//
// Chat primitives (.gl-msg-row/.gl-avatar/.gl-bubble/_glFormatChatText) are
// reused verbatim from guided-launch.js, per this build's explicit
// instruction — not reimplemented here.

// ══════════════════════════════════════════════════════════════════════════
// Reset (mirrors guided-launch.js's glResetState(), called from the same
// call site in home.js's homeClearSession())
// ══════════════════════════════════════════════════════════════════════════
// v14 product decision (post-v9.27 review) — NON-destructive. Resets only
// RA's in-memory/UI view; never touches the database, never removes a
// document. Used whenever a session is being LEFT/paused, not permanently
// destroyed — home.js's homeClearSession() (New Session, product change,
// load demo, resume a different session) calls THIS, not raResetState()
// below. The outgoing session's own sessionStoreSave() call (which runs
// before this, inside homeClearSession()) already persisted its real
// conversations and documents intact, so this function only needs to blank
// the view for whatever comes next.
function raClearInMemoryState(){
  // v9.24.02 — a mic session left listening must not survive into whichever
  // session is opened next. This is the SOLE cleanup point that fires during
  // homeClearSession()'s live-sync kickout path (home.js wipes #ra-tab's
  // innerHTML BEFORE calling this — raRenderCenter()'s own guard never runs
  // in that path) — verified by reading homeClearSession() directly, not
  // assumed. abort(), not stop(): a stray final result landing after the
  // session was "cleared" would write into whatever textarea DOM happens to
  // exist next, which could belong to a different session entirely.
  // voiceStopActive() is a safe no-op if this surface isn't the active one.
  voiceStopActive('abort');
  // v9.25 code-review fix — _raChatDraftByConvId/_raLastRenderedConvId
  // otherwise survive a session clear indefinitely (this state is never
  // persisted, only bounded by page reload). Not a live bug today — by the
  // time raRenderCenter() next runs, #ra-tab has already been wiped by
  // homeClearSession(), so _raCaptureChatDraft() finds nothing to capture
  // regardless of the stale conversation id — but it's unbounded growth
  // across repeated clears in one long-lived tab, and a latent trap for
  // whichever future change adds per-conversation delete or ever reuses an
  // id from _raUid()'s generation scheme.
  _raChatDraftByConvId={};
  _raLastRenderedConvId=null;
  // Confirmed pre-existing bug (predates the Discovery-First redesign):
  // this used to hardcode raEnabled=false unconditionally, so every
  // session relaunch after the first one in a browser tab reset raEnabled
  // to false with nothing to resync it from appSettings.featRA before
  // Discovery Map's own CTA render (kpi-tree.js's renderDiagnosticActionBar())
  // ran — showing "Continue to Capability Canvas" instead of "Define
  // Requirements" even when the Requirement Agent feature module is on.
  // raEnabled reflects the global Settings toggle, not per-session state,
  // so a session reset must resync it from the authoritative source
  // (appSettings.featRA) rather than hardcode a default.
  raEnabled=(typeof appSettings!=='undefined'&&appSettings)?!!appSettings.featRA:false;
  raConversations=[];
  raLastOpenConversationId=null;
  raActiveConversationId=null;
  raBusy=false;
}

// DESTRUCTIVE — product decision (post-v9.27 review): reachable ONLY from a
// genuine, permanent reset of this session's RA state. Today that's
// kpi-tree.js's generateConfirmed() (Regenerate Discovery Map) alone — NOT
// home.js's homeClearSession(), which calls raClearInMemoryState() above
// instead (an earlier build of this feature called this function from both,
// on the mistaken premise that every raConversations wipe is equally
// permanent; it isn't — a New Session/session-switch is a pause, and its
// documents must survive for later resume).
//
// p_sessionId (optional) — the caller's own session id, captured by the
// CALLER before any of its own state resets could null the global
// _activeSessionId. Falls back to the live global for a caller like
// generateConfirmed(), which never nulls it before this function runs.
//
// Cleans up documents belonging to every conversation about to disappear
// BEFORE clearing raConversations (and before that clear is persisted) —
// these conversation ids are only valid to operate against right now, while
// they still exist in the database's current snapshot; once gone,
// _ra_is_authorized() permanently and correctly blocks every document RPC
// from ever touching them again. Best-effort per conversation: a failure is
// logged and skipped, never thrown — the opportunistic
// ra_purge_orphaned_documents() call (see raOnTabEnter()) is the self-
// healing backstop for anything this pass misses.
async function raResetState(p_sessionId){
  var _rrsSessionId=p_sessionId||((typeof _activeSessionId!=='undefined')?_activeSessionId:null);
  if(_rrsSessionId&&typeof _pgtRpc==='function'){
    // v14 code-review fix — snapshot BEFORE the async loop starts, and
    // iterate the snapshot only. raConversations is a live global; reading
    // it fresh on every loop iteration across several awaits risked skipping
    // or double-processing a conversation if anything else mutated it
    // concurrently (e.g. a rename, or another reset firing) mid-loop.
    var _rrsSnapshot=raConversations.slice();
    for(var _rrsI=0;_rrsI<_rrsSnapshot.length;_rrsI++){
      var _rrsConvId=_rrsSnapshot[_rrsI].id;
      try{
        var _rrsListRes=await _pgtRpc('ra_list_documents',{p_session_id:_rrsSessionId,p_conversation_id:_rrsConvId});
        if(_rrsListRes&&_rrsListRes.error)throw _rrsListRes.error;
        var _rrsDocs=(_rrsListRes&&_rrsListRes.data)||[];
        for(var _rrsJ=0;_rrsJ<_rrsDocs.length;_rrsJ++){
          var _rrsRemoveRes=await _pgtRpc('ra_remove_document',{p_session_id:_rrsSessionId,p_conversation_id:_rrsConvId,p_doc_id:_rrsDocs[_rrsJ].doc_id});
          if(_rrsRemoveRes&&_rrsRemoveRes.error)console.warn('[requirement-agent] raResetState: failed to remove document',_rrsDocs[_rrsJ].doc_id,_rrsRemoveRes.error);
        }
      }catch(err){
        console.warn('[requirement-agent] raResetState: document cleanup failed for conversation '+_rrsConvId+' — relying on ra_purge_orphaned_documents() to catch it later',err);
      }
    }
  }
  raClearInMemoryState();
}

// ══════════════════════════════════════════════════════════════════════════
// Small helpers
// ══════════════════════════════════════════════════════════════════════════
// v14 code-review fix (post-v9.27 review) — RA is owner-only by product
// decision, stricter than the general canEditSession() (which also returns
// true for a shared session's OTHER edit-mode collaborator, not just its
// owner). Without this, a non-owner editor could see RA's composer and
// action buttons render as usable, while every underlying RPC's own DB-side
// authorization (session ownership, scoped by mt_sessions.user_id) rejected
// them anyway — "the button works but every call fails" is a worse failure
// mode than the button never rendering. Reuses the exact same primitives
// canEditSession() itself reads (currentUserRole via canEditSession(),
// _activeSessionIsShared, _activeSessionOwnerId, currentUser.id) rather
// than inventing new state. Every gate in THIS file uses this, never bare
// canEditSession() — canEditSession() itself is untouched and stays correct
// for every other surface that calls it directly.
function _raCanEditOwner(){
  if(typeof canEditSession==='function'&&!canEditSession())return false;
  // Private (non-shared) session: canEditSession() already returning true
  // here means "I own it" — RLS never lets a non-owner load a private
  // session at all, matching canEditSession()'s own line for this exact case.
  if(typeof _activeSessionIsShared==='undefined'||_activeSessionIsShared!==true)return true;
  var uid=(typeof currentUser!=='undefined'&&currentUser)?currentUser.id:null;
  var ownerId=(typeof _activeSessionOwnerId!=='undefined')?_activeSessionOwnerId:null;
  return !!(uid&&ownerId&&ownerId===uid);
}

// Escapes literal control characters (newline/CR/tab) but ONLY while inside
// a JSON string value - tracks quote/escape state char-by-char so it never
// touches real structural whitespace between tokens. Confirmed root cause
// of the recurring "I couldn't process that update" failures: liveDraftMd
// is multi-line markdown, and the model occasionally emits a literal
// newline inside that JSON string value instead of an escaped "\n", which
// JSON.parse rejects outright ("Bad control character in string literal").
// A no-op on already-valid JSON (including strings with real backslashes
// or escaped quotes) - verified against both known-good and known-bad
// samples before use here.
function _raSanitizeJsonControlChars(s){
  var out='',inStr=false,esc=false;
  for(var i=0;i<s.length;i++){
    var ch=s[i];
    if(esc){out+=ch;esc=false;continue;}
    if(ch==='\\'){out+=ch;if(inStr)esc=true;continue;}
    if(ch==='"'){inStr=!inStr;out+=ch;continue;}
    if(inStr){
      if(ch==='\n'){out+='\\n';continue;}
      if(ch==='\r'){out+='\\r';continue;}
      if(ch==='\t'){out+='\\t';continue;}
    }
    out+=ch;
  }
  return out;
}
function _raParseJSON(txt){
  var clean=(txt||'').replace(/```json|```/g,'').trim();
  try{ return JSON.parse(clean); }catch(e){}
  var first=clean.indexOf('{'), last=clean.lastIndexOf('}');
  if(first>=0&&last>first){
    var sliced=clean.slice(first,last+1);
    try{ return JSON.parse(sliced); }catch(e2){}
    // Trailing comma right before the JSON blob's own final closing brace -
    // scoped to only the last few characters, never a global replace, so
    // it can't touch a comma sitting inside liveDraftMd's markdown prose.
    var trimmedEnd=sliced.replace(/,\s*\}\s*$/,'}');
    if(trimmedEnd!==sliced){
      try{ return JSON.parse(trimmedEnd); }catch(e3){}
    }
    // Last resort — repair unescaped control characters inside string
    // values (see _raSanitizeJsonControlChars comment above), then retry
    // both the plain slice and the trailing-comma-trimmed variant.
    var sanitized=_raSanitizeJsonControlChars(sliced);
    if(sanitized!==sliced){
      try{ return JSON.parse(sanitized); }catch(e4){}
      var sanitizedTrimmed=sanitized.replace(/,\s*\}\s*$/,'}');
      if(sanitizedTrimmed!==sanitized){
        try{ return JSON.parse(sanitizedTrimmed); }catch(e5){}
      }
    }
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
// Defensive parse of the model's clarifyingQuestions field (prompts.js's
// _raClarifyingQuestionsRules()) into the shape _raQuickReplyHtml() renders.
// Mirrors _raDedupeQuestions()'s defensive style, but operates on richer
// {question,targetSection,options} objects rather than plain strings, so
// it can't reuse that helper directly. Drops any entry missing question/
// targetSection, clamps options to 2-4, caps the whole array to 1 entry -
// confirmed via live testing that the model returned 2 questions on an
// opening turn despite the prompt's own "never more than 1 per turn" rule,
// so this is the actual enforcement point, not the prompt text.
function _raSanitizeClarifyingQuestions(arr){
  return (arr||[]).filter(function(q){
    return q&&typeof q==='object'&&String(q.question||'').trim()&&String(q.targetSection||'').trim()&&Array.isArray(q.options)&&q.options.length>=2;
  }).map(function(q){
    return {
      question:String(q.question).trim(),
      targetSection:String(q.targetSection).trim(),
      options:q.options.map(function(o){return String(o||'').trim();}).filter(Boolean).slice(0,4)
    };
  }).filter(function(q){return q.options.length>=2;}).slice(0,1);
}
// Client-side backstop for the PM opt-out (prompts.js's
// _raClarifyingQuestionsRules() STEP 1) — confirmed via live testing that
// the model can say "Noted - I will not offer choices" in chatReply while
// still populating clarifyingQuestions in the SAME JSON response, so the
// prompt instruction alone is not reliable enough on its own. Once any
// message in this conversation matches, conv.raQuestionsOptedOut is set
// and _raRunTurn()/raRunOpeningTurn() force clarifyingQuestions to empty
// from then on regardless of what the model returns, guaranteeing the PM's
// request is honored even if the model slips again.
function _raDetectsQuestionsOptOut(text){
  return /\b(don'?t|do not|stop|no more)\b[^.!?\n]{0,40}\b(ask|question|choice|option)/i.test(text||'')
    || /\bi(?:'?ll| will) (just )?tell you\b/i.test(text||'')
    || /\bwithout (choices|options)\b/i.test(text||'');
}

// ══════════════════════════════════════════════════════════════════════════
// Section-patch merge (live PM feedback fix — was "return the FULL draft
// every turn", confirmed the actual cause of both the opening-turn
// hallucination bug (the model had to invent something for every one of
// 11 sections just to have a complete document to hand back) and the
// 30-90s-per-turn latency (regenerating the entire document from scratch
// every single turn, even for a one-line answer). Now the model only
// returns sectionUpdates for what it actually has real content for
// (prompts.js's buildRequirementAgentTurnPrompt()/DMOpeningPrompt()); the
// client owns the document's structure entirely — numbering, headings, and
// the placeholder text for anything never yet discussed — so the model
// never needs to touch, or even see the exact heading format of, a section
// it isn't updating.
// ══════════════════════════════════════════════════════════════════════════

// Single source of truth for the 11 canonical section names, in order —
// must stay a bare name (no numbering) since _raBuildDraftMd() is the only
// place that ever writes "## N. Name". The model refers to these same 11
// bare names via prompts.js's "section" field.
var _RA_SECTION_NAMES=['Requirement Summary','Problem Statement','Success Criteria','Capabilities','Features','Target Users','User Journeys','Non-Functional Requirements','Out of Scope','Assumptions','Open Questions'];
// Shown for any section with no real content yet — deliberately reads as a
// placeholder, not a guess dressed up as an answer, so a PM never mistakes
// "nothing written" for "the AI looked and found nothing."
var _RA_EMPTY_SECTION_BODY='_Yet to be discussed_';

// Parses an existing liveDraftMd string (as produced by _raBuildDraftMd()
// below) back into a {name: body} map, keyed by the bare canonical name.
// Tolerates a missing/empty string (the opening turn's conv.liveDraftMd
// starts as '') by simply returning {} — every section then falls back to
// the empty-body placeholder in _raBuildDraftMd(). Heading match tolerates
// an optional "N. " numeric prefix, matching the same convention already
// used by _raParseTouchedCapabilities()/_raParseFeatureNarratives() below.
function _raSplitSectionsMd(md){
  var out={};
  if(!md)return out;
  var lines=md.split('\n');
  var current=null,buf=[];
  function flush(){
    if(current)out[current]=buf.join('\n').replace(/^\n+|\n+$/g,'');
    buf=[];
  }
  for(var i=0;i<lines.length;i++){
    var line=lines[i];
    var m=line.match(/^##\s*(?:\d+\.\s*)?(.+?)\s*$/);
    var matchedName=null;
    if(m){
      var candidate=m[1].trim();
      for(var j=0;j<_RA_SECTION_NAMES.length;j++){
        if(_RA_SECTION_NAMES[j].toLowerCase()===candidate.toLowerCase()){matchedName=_RA_SECTION_NAMES[j];break;}
      }
    }
    if(matchedName){
      flush();
      current=matchedName;
      continue;
    }
    if(current)buf.push(line);
  }
  flush();
  return out;
}

// Rebuilds the full liveDraftMd string from a {name: body} map, in
// canonical order, synthesizing every heading (numbering can never drift
// since the client generates it, never the model) and the H1 title from
// conv.title (removing the old latent risk of the model's own embedded H1
// disagreeing with conv.title, back when the model wrote the whole doc).
// Any name missing from sectionBodyMap gets _RA_EMPTY_SECTION_BODY, so the
// PM always sees an explicit "not yet discussed" rather than a blank gap.
function _raBuildDraftMd(title,sectionBodyMap){
  var map=sectionBodyMap||{};
  var lines=['# '+(title||'Requirements Brief'),''];
  _RA_SECTION_NAMES.forEach(function(name,i){
    lines.push('## '+(i+1)+'. '+name);
    lines.push('');
    lines.push((map[name]&&String(map[name]).trim())?String(map[name]).trim():_RA_EMPTY_SECTION_BODY);
    lines.push('');
  });
  return lines.join('\n').replace(/\n+$/,'\n');
}

// The actual merge step, called once per turn. Splits whatever's currently
// stored, defensively validates and overlays each update (case-insensitive
// name match, tolerating a stray "## N. " prefix if the model includes one
// despite being told not to — same defensive posture as
// _raSanitizeClarifyingQuestions() above; unrecognized names are dropped
// with a console.warn rather than silently eaten, so a real prompt/model
// mismatch is visible in the console instead of just quietly losing
// content), then rebuilds. A section never named in sectionUpdates simply
// keeps whatever was already in the map (or the placeholder if it was
// never there) - this is the whole point, the model only pays for what it
// actually changes.
function _raApplySectionUpdates(conv,sectionUpdates){
  var map=_raSplitSectionsMd(conv&&conv.liveDraftMd);
  (sectionUpdates||[]).forEach(function(u){
    if(!u||typeof u!=='object')return;
    var rawName=String(u.section||'').trim().replace(/^#{1,6}\s*(?:\d+\.\s*)?/,'');
    var body=String(u.body||'').trim();
    if(!rawName||!body)return;
    var matched=null;
    for(var i=0;i<_RA_SECTION_NAMES.length;i++){
      if(_RA_SECTION_NAMES[i].toLowerCase()===rawName.toLowerCase()){matched=_RA_SECTION_NAMES[i];break;}
    }
    if(!matched){console.warn('[requirement-agent] sectionUpdates: unrecognized section name, dropped',u.section);return;}
    map[matched]=body;
  });
  return _raBuildDraftMd(conv&&conv.title,map);
}

// Parse the Live Draft's "## 4. Capabilities" section into structured
// {key,name,isNew} entries. This is the ONLY source of truth for
// conv.touchedCapabilityKeys — the model returns capability info solely as
// markdown sub-headings inside liveDraftMd (see buildRequirementAgent*
// Prompt()'s "(existing)"/"(will be created)" tagging rule in prompts.js),
// never as a separate structured field. Without this parser,
// touchedCapabilityKeys stays permanently empty and raRunFinalizeSequence()
// has nothing to iterate over (confirmed root cause of Finalize being a
// silent no-op — capStore/scCanvas never receive any writes).
//
// Bucketing fix (QA issue #10): a "will be created" tag now optionally
// carries "— under: <Metric/Process Area Name>" — the specific EXISTING
// Discovery Map metric/process area this capability belongs under, or (if
// none genuinely fits) a specific, real proposed name for a new one —
// never a generic placeholder. Finalize resolves this name against the
// real Discovery Map tree itself (see _raResolveExistingMetricBucket()) —
// the model doesn't need to self-classify existing-vs-new correctly, it
// only needs to name the target; Finalize's own lookup decides.
// QA issue #1 — also captures the descriptive bullet text under each
// capability's sub-heading (the "what changes for that capability in this
// release" list _raSectionContentRules() already requires the model to
// write), as `description`. Used at Finalize time as the new capability's
// `.why` field instead of a generic "Created by Requirement Agent for this
// release." placeholder.
function _raParseTouchedCapabilities(md){
  var lines=(md||'').split('\n');
  var inSection=false;
  var out=[];
  var seen={};
  var current=null;
  var descLines=[];
  function _flushDesc(){
    if(current&&descLines.length)current.description=descLines.join(' ').replace(/\s+/g,' ').trim();
    descLines=[];
  }
  for(var i=0;i<lines.length;i++){
    var line=lines[i];
    if(/^##\s*(?:\d+\.\s*)?Capabilities\s*$/i.test(line)){inSection=true;continue;}
    if(inSection&&/^##\s+/.test(line)){break;} // next top-level "## " section ends it
    if(!inSection)continue;
    var m=line.match(/^#{2,6}\s*\**\s*(.+?)\s*\**\s*\((existing|will be created)(?:\s*[—-]\s*under:\s*(.+?))?\)\s*$/i);
    if(m){
      _flushDesc();
      var name=m[1].trim().replace(/^\**|\**$/g,'').trim();
      if(!name){current=null;continue;}
      var isNew=/will be created/i.test(m[2]);
      var dedupeKey=name.toLowerCase();
      if(seen[dedupeKey]){current=null;continue;}
      seen[dedupeKey]=true;
      current={key:name,name:name,isNew:isNew,bucketMetricName:m[3]?m[3].trim():null,description:null};
      out.push(current);
      continue;
    }
    var bullet=line.match(/^\s*[-*]\s+(.+)$/);
    if(bullet&&current&&descLines.length<2){ // first 1-2 bullets are enough for a concise .why
      descLines.push(bullet[1].trim());
    }
  }
  _flushDesc();
  return out;
}
// Parse the Live Draft's "## 5. Features" section into per-
// capability feature detail: {name, isNew, narrative}. Extends the same
// exact-copy tagging convention _raParseTouchedCapabilities() already keys
// off ("(existing)"/"(will be created)" on capability sub-headings) down to
// the feature level — each feature bullet is tagged "(new feature)" or
// "(existing feature)", followed by a colon and the requirement narrative
// the PM actually described (specific behaviors, edge cases, operational
// definitions), never just a restatement of the feature name. Without this,
// the brief only ever captures a table of contents, never the substance
// needed to ground feature-generation (buildRAFeatureGenPrompt(), §6.5) or
// story-generation (scBuildStoryPrompt(), §10) once Finalize creates the
// capability shell but no features.
function _raParseFeatureNarratives(md){
  var lines=(md||'').split('\n');
  var inSection=false;
  var currentCap=null;
  var out={}; // capName.toLowerCase() -> [{name,isNew,narrative}]
  for(var i=0;i<lines.length;i++){
    var line=lines[i];
    if(/^##\s*(?:\d+\.\s*)?Features\s*$/i.test(line)){inSection=true;continue;}
    if(inSection&&/^##\s+/.test(line)){break;}
    if(!inSection)continue;
    var capHead=line.match(/^#{2,6}\s*\**\s*(.+?)\s*\**\s*$/);
    if(/^#{3,6}\s/.test(line)&&capHead){
      currentCap=capHead[1].trim().replace(/^\**|\**$/g,'').trim();
      if(currentCap&&!out[currentCap.toLowerCase()])out[currentCap.toLowerCase()]=[];
      continue;
    }
    if(!currentCap)continue;
    var fm=line.match(/^-\s*\**\s*(.+?)\s*\**\s*\((new|existing)\s+feature\)\s*:\s*(.*)$/i);
    if(fm){
      out[currentCap.toLowerCase()].push({name:fm[1].trim(),isNew:/^new$/i.test(fm[2]),narrative:fm[3].trim()});
    }
  }
  return out;
}
// Return the requirement-narrative detail this conversation's brief
// captured for a single capability — used as the targeted, per-capability
// extraction §6.5 and §10 both require instead of passing the entire
// liveDraftMd blob into a generation prompt. Includes the capability's
// feature list (name/new-or-existing/narrative) plus the release-level
// Success Criteria section (shared across all capabilities this brief
// touches — there is no per-capability split for that section).
function _raGetCapabilityBriefExcerpt(conv,capName){
  if(!conv||!conv.liveDraftMd||!capName)return'';
  var md=conv.liveDraftMd;
  var feats=(_raParseFeatureNarratives(md)[capName.toLowerCase()])||[];
  var parts=[];
  if(feats.length){
    parts.push('Feature detail captured for "'+capName+'" during this release\'s Requirement Agent conversation:\n'+feats.map(function(f){
      return '- '+f.name+' ('+(f.isNew?'new':'existing')+')'+(f.narrative?(': '+f.narrative):'');
    }).join('\n'));
  }
  var successCriteria=_raExtractSection(md,'Success Criteria');
  if(successCriteria)parts.push('Release success criteria:\n'+successCriteria);
  return parts.join('\n\n');
}
// Extract one "## <headingText>" section's body (everything up to the next
// "## " heading) from a liveDraftMd blob. Small shared helper for the
// targeted-extraction requirement in §6.5/§10 — never used to pass the
// whole document, only a single named section. headingText is the bare
// section name (e.g. "Success Criteria") — the numbered-heading prefix
// ("## 3. Success Criteria") is matched via the optional (?:\d+\.\s*)?
// group below, so callers never need to know/pass the current number.
function _raExtractSection(md,headingText){
  var lines=(md||'').split('\n');
  var re=new RegExp('^##\\s*(?:\\d+\\.\\s*)?'+headingText.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$','i');
  var inSection=false;
  var out=[];
  for(var i=0;i<lines.length;i++){
    var line=lines[i];
    if(re.test(line)){inSection=true;continue;}
    if(inSection&&/^##\s+/.test(line))break;
    if(inSection)out.push(line);
  }
  return out.join('\n').trim();
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
  // v9.25 — must capture BEFORE raRenderShell(), not inside raRenderCenter().
  // raRenderShell() does its own root.innerHTML= on the ENTIRE #ra-tab
  // (including a brand-new, empty #ra-center) as a step BEFORE it calls
  // raRenderCenter() — so by the time raRenderCenter()'s own capture runs,
  // the old #ra-chat-input is already gone. Confirmed via live debug
  // logging (oldChatInput found:false on the tab-entry path specifically) —
  // raOpenConversation()/raNewConversation() don't have this problem, since
  // they call raRenderCenter() directly with no destructive wrapper first.
  _raCaptureChatDraft();
  raRenderShell();
  _raPurgeOrphanedDocsOpportunistic();
}

// v14 — self-healing safety net (RA-Persistent-Doc-RAG-Spec-v14 D4/OI-20).
// Fire-and-forget by design: background reconciliation, not something the
// PM needs to wait on or see, and its failure must never block entering the
// tab. Catches any document left orphaned by a reset path raResetState()'s
// own cleanup missed (a tab closed mid-cleanup, a network error, or a
// future reset flow added without knowing it needs to cooperate) — see
// ra_purge_orphaned_documents()'s own comment in sql/ra-doc-chunks.sql for
// why it's safe to call unconditionally, on any session, at any time,
// including one with nothing to purge.
// v14 code-review fix — throttled to once per session per page load
// (a Set, not a single boolean, since a PM can switch between sessions
// within one browser tab and each session's orphans are independent). Every
// RA tab RE-entry for the SAME session skipped after the first, since this
// is a background reconciliation pass, not something that needs to re-run
// every time the tab is revisited in one sitting.
var _raPurgedSessionIds=new Set();
function _raPurgeOrphanedDocsOpportunistic(){
  // The RPC itself requires active, non-readonly membership
  // (sql/ra-doc-chunks.sql), so a readonly viewer's call was never going to
  // succeed; gating here avoids a guaranteed, predictable failed round trip
  // on every single RA tab entry for that viewer, same as every other new
  // RA entry point in this build is gated.
  if(typeof _raCanEditOwner==='function'&&!_raCanEditOwner())return;
  if(typeof _activeSessionId==='undefined'||!_activeSessionId||typeof _pgtRpc!=='function')return;
  if(_raPurgedSessionIds.has(_activeSessionId))return;
  // v14 code-review fix — mark this session purged only on actual success,
  // not before the call even fires. Marking it upfront meant a failed call
  // (network error, transient RPC failure) permanently skipped this session
  // for the rest of the page's lifetime, since the throttle set had already
  // recorded it as done — the opposite of "self-healing." Now a failure
  // leaves the session unmarked, so the next tab entry/session load retries.
  _pgtRpc('ra_purge_orphaned_documents',{p_session_id:_activeSessionId}).then(function(res){
    if(res&&res.error){console.warn('[requirement-agent] ra_purge_orphaned_documents failed',res.error);return;}
    _raPurgedSessionIds.add(_activeSessionId);
  }).catch(function(err){
    console.warn('[requirement-agent] ra_purge_orphaned_documents failed',err);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Entry from Discovery Map — "Define Requirements" CTA (RA on only; see
// kpi-tree.js's renderDiagnosticActionBar()). Replaces the pre-redesign
// raDefineRequirements(), which was entered from Capability Canvas — RA no
// longer has any Capability-Canvas-side entry point.
// ══════════════════════════════════════════════════════════════════════════
function raEnterFromDiscoveryMap(){
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
var raRightPanelOpen=true; // Live Draft panel expand/collapse — view-scoped only, mirrors guided-launch.js's glMdOpen (not persisted)
var _raLastRenderedConvId=null; // which conversation's DOM was actually on screen before the CURRENT capture call — see _raCaptureChatDraft()
var _raChatDraftByConvId={};    // unsent #ra-chat-input text, keyed by conversation id — view-scoped only, not persisted

// Shared by raOnTabEnter() (before raRenderShell()'s own destructive wipe of
// #ra-tab) and raRenderCenter() (for its other two callers, raOpenConversation()/
// raNewConversation(), which call it directly with no destructive wrapper in
// between) — captures whatever's currently in #ra-chat-input, keyed by
// whichever conversation was actually on screen, before it's destroyed.
// Safe to call redundantly: a no-op if the element is already gone (e.g.
// raRenderCenter()'s own call, running after raRenderShell() already wiped
// it via the earlier raOnTabEnter() call) or if there's nothing tracked yet.
function _raCaptureChatDraft(){
  var _oldChatInput=document.getElementById('ra-chat-input');
  if(_oldChatInput&&_raLastRenderedConvId){
    _raChatDraftByConvId[_raLastRenderedConvId]=_oldChatInput.value;
  }
}

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
        +'<div class="ph-text"><div class="ph-title">Requirement Agent</div><div class="ph-sub">Pin down what you\'re building.</div></div>'
        +'<button class="collapse-btn" onclick="raTogglePanel()" title="Toggle panel">'
          +'<svg id="icon-ra-exp" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:'+(raPanelOpen?'block':'none')+'"><polyline points="15 18 9 12 15 6"/><polyline points="21 18 15 12 21 6"/></svg>'
          +'<svg id="icon-ra-col" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:'+(raPanelOpen?'none':'block')+'"><polyline points="9 18 15 12 9 6"/><polyline points="3 18 9 12 3 6"/></svg>'
        +'</button>'
      +'</div>'
      +'<div class="ra-left-body">'
        +'<div class="ra-filter-chips" id="ra-filter-chips"></div>'
        +'<div class="ra-conv-list" id="ra-conv-list"></div>'
        +(((typeof _raCanEditOwner!=='function')||_raCanEditOwner())?'<button class="ra-new-conv-btn" id="ra-new-conv-btn" onclick="raNewConversation()"><i class="ti ti-plus" style="font-size:11px;" aria-hidden="true"></i> New Conversation</button>':'')
      +'</div>'
    +'</div>'
    +'<div class="ra-center" id="ra-center"></div>'
    +'<div class="ra-md-collapsed-rail'+(raRightPanelOpen?'':' show')+'" id="ra-collapsed-rail" onclick="raOpenRightPanel()" title="Reopen Live Draft">'
      +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
      +'<div class="ra-md-collapsed-label">LIVE DRAFT</div>'
    +'</div>'
    +'<div class="ra-right" id="ra-right" style="display:'+(raRightPanelOpen?'flex':'none')+';"></div>';
  raRenderFilterChips();
  raRenderConvList();
  raRenderCenter();
}

function raCollapseRightPanel(){
  raRightPanelOpen=false;
  var right=document.getElementById('ra-right'); if(right)right.style.display='none';
  var rail=document.getElementById('ra-collapsed-rail'); if(rail)rail.classList.add('show');
}
function raOpenRightPanel(){
  raRightPanelOpen=true;
  var right=document.getElementById('ra-right'); if(right)right.style.display='flex';
  var rail=document.getElementById('ra-collapsed-rail'); if(rail)rail.classList.remove('show');
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
    // generatedFeatureIds is permanently empty post-v9.18 (Finalize no
    // longer generates features — see raNewConversation()'s field comment),
    // so the count is now derived from the real, live source of truth:
    // Capability Canvas's own featStore.top for every capability this
    // conversation's Finalize created. Tolerant of stale/missing keys —
    // a capability referenced here could since have been deleted/reindexed
    // elsewhere in Capability Canvas.
    var featCount=(c.createdCapabilityKeys||[]).reduce(function(sum,key){
      if(typeof capStore==='undefined')return sum;
      // metricKey itself is stageId+'||'+metricName (ccMetricKey()) or
      // 'pi||'+capName (ccPIKey()) — already pipe-delimited — so this
      // composite key can't be split on every '|'. capIdx is always the
      // last segment and always a plain integer (never free text), so
      // lastIndexOf isolates it correctly regardless of what characters
      // appear in the metric/capability name. Mirrors the same
      // lastIndexOf-based parsing capability-canvas.js already uses for
      // this exact key shape.
      var keyStr=String(key);
      var sep=keyStr.lastIndexOf('|');
      var metricKey=sep>=0?keyStr.slice(0,sep):keyStr;
      var capIdx=sep>=0?parseInt(keyStr.slice(sep+1),10):NaN;
      var entry=capStore[metricKey];
      var cap=entry&&entry.capabilities&&entry.capabilities[capIdx];
      return sum+((cap&&cap.featStore&&cap.featStore.top)?cap.featStore.top.length:0);
    },0);
    var summary=c.status==='finalized'
      ?(capCount+' capabilit'+(capCount!==1?'ies':'y')+' · '+featCount+' feature'+(featCount!==1?'s':'')+' · finalized '+_raRelTime(c.updatedAt))
      :('Updated '+_raRelTime(c.updatedAt)+' · not yet finalized');
    var tag=(c.status==='finalized'&&c.rqNumber)?('<span class="ra-rq-tag">'+e(c.rqNumber)+'</span> '):'';
    return '<div class="ra-conv-card'+(isActive?' active':'')+'" onclick="raOpenConversation(\''+c.id+'\')">'
      +'<div class="ra-conv-title-row">'
        +'<div class="ra-conv-title" id="ra-conv-title-'+c.id+'">'+tag+e(c.title||'Untitled conversation')+'</div>'
        +((isActive&&((typeof _raCanEditOwner!=='function')||_raCanEditOwner()))?'<button class="ra-conv-rename-btn" onclick="event.stopPropagation();raRenameConversation(\''+c.id+'\')" title="Rename"><i class="ti ti-pencil" style="font-size:10px;" aria-hidden="true"></i></button>':'')
      +'</div>'
      +'<div class="ra-conv-summary">'+e(summary)+'</div>'
    +'</div>';
  }).join('');
}

function raRenameConversation(id){
  if(typeof _raCanEditOwner==='function'&&!_raCanEditOwner())return;
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
  if(val){conv.title=val;conv.titleIsPlaceholder=false;}
  conv.updatedAt=new Date().toISOString();
  raRenderConvList();
  _raPersist();
}

// ══════════════════════════════════════════════════════════════════════════
// Center (chat) + right (live draft) — rendered together per active conv
// ══════════════════════════════════════════════════════════════════════════
function raRenderCenter(){
  // v9.24.02 — confirmed via grep this is the ONLY function (3 call sites,
  // all in this file: tab-entry shell render, raOpenConversation(),
  // raNewConversation()) that rebuilds #ra-chat-input's DOM node from
  // scratch. abort(), not stop(): the old node is about to be discarded
  // regardless, and letting a trailing result land would write into
  // whichever NEW conversation's textarea replaces it — the exact
  // dictation-bleeds-into-a-different-conversation bug this guard exists
  // to prevent. voiceStopActive() is a safe no-op if voice input isn't
  // active, or if some other surface (not this one) is the active instance.
  voiceStopActive('abort');
  // v9.25 — preserve any unsent draft text before the old textarea (if any)
  // is destroyed below. Keyed by whichever conversation was ACTUALLY on
  // screen before this render, NOT raActiveConversationId — callers like
  // raOpenConversation()/raNewConversation() already reassign that BEFORE
  // calling this function, so it no longer identifies the outgoing
  // conversation by the time we get here. Confirmed via live testing this
  // is a pre-existing gap in this render function (it has always rebuilt
  // #ra-chat-input empty on every call, with no value ever interpolated
  // in) — not something voice input introduced. It would equally discard
  // an unsent manually-typed draft; voice just makes hitting it far more
  // likely, since dictating naturally accumulates more unsent content
  // before a PM would think to hit Send. Redundant-but-harmless on the
  // tab-entry path specifically — raOnTabEnter() already captured before
  // raRenderShell()'s own destructive wipe, so this call finds nothing left
  // to capture; still load-bearing for the other two callers below.
  _raCaptureChatDraft();
  var center=document.getElementById('ra-center');
  var right=document.getElementById('ra-right');
  if(!center||!right)return;
  var conv=_raActiveConv();
  _raLastRenderedConvId=conv?conv.id:null;
  if(!conv){
    center.innerHTML='<div class="ra-empty-state"><i class="ti ti-clipboard-text" style="font-size:28px;color:var(--label);" aria-hidden="true"></i><div style="font-size:13px;font-weight:600;color:var(--t2);margin-top:10px;">No conversation open</div><div style="font-size:11px;color:var(--t3);margin-top:4px;">Start a new one, or pick a conversation on the left.</div></div>';
    right.innerHTML='';
    return;
  }
  // Reverted to the v9.16 Guided Launch format per QA: static category
  // eyebrow + a fixed, friendly status line - the conversation's own
  // contextualized title now lives in the Live Draft banner (raRenderLiveDraft())
  // instead, so it isn't lost by dropping it from here.
  // v14 — RA's whole composer (textarea, mic, send, upload chip, file
  // input) is hidden together as one unit for a non-editable session,
  // matching the exact precedent already established elsewhere in this
  // codebase (e.g. capability-canvas.js's .cc-chat-bar) — the mic is never
  // gated on its own, it's just a sibling inside whatever gets hidden here.
  // Reuses the existing .ra-finalized-note treatment rather than inventing
  // a second "closed" visual for a second reason.
  var _raCanEdit=(typeof _raCanEditOwner!=='function')||_raCanEditOwner();
  center.innerHTML=
    '<div class="ra-chat-hdr"><div class="ra-chat-hdr-eyebrow">Requirement Agent</div><div class="ra-chat-hdr-title">'+(conv.status==='finalized'?('Finalized'+(conv.rqNumber?(' — '+e(conv.rqNumber)):'')):'Drafting requirements together')+'</div></div>'
    +'<div class="ra-chat-body" id="ra-chat-body"></div>'
    +'<div class="ra-attached-docs" id="ra-attached-docs"></div>'
    +(conv.status==='finalized'
      ?'<div class="ra-chat-input-wrap"><div class="ra-finalized-note">This conversation is finalized — chat is closed.</div></div>'
      :!_raCanEdit
      ?'<div class="ra-chat-input-wrap"><div class="ra-finalized-note">You have view-only access to this session, chat is closed.</div></div>'
      :'<div class="ra-chat-input-wrap"><div class="ra-chat-input-row">'
        +'<textarea class="ra-chat-input" id="ra-chat-input" rows="1" placeholder="Type your response..." onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();raSendMessage();}"></textarea>'
        +'<div class="ra-chat-btn-group">'
          // v9.25 code-review fix — guarded with typeof, matching every
          // other surface's call site convention (was unguarded here,
          // safe in practice since voice-input.js always loads first, but
          // an inconsistent pattern for future surfaces to copy from).
          +((typeof voiceButtonHtml==='function')?voiceButtonHtml({textareaId:'ra-chat-input',buttonId:'ra-voice-btn',statusId:'ra-voice-status'}):'')
          +'<button class="ra-chat-send" id="ra-send-btn" onclick="raSendMessage()" title="Send"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>'
        +'</div>'
      +'</div>'
      +'<div class="gl-upload-chip" id="ra-upload-chip" onclick="if(!raBusy)document.getElementById(\'ra-file-input\').click()" title="Click to select a file to upload">'
        +'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
        +' <span id="ra-upload-chip-text" style="text-decoration:underline;">Upload a document</span><span id="ra-upload-chip-suffix"> to add context anytime</span>'
      +'</div>'
      +'<input type="file" id="ra-file-input" accept=".docx,.pdf,.txt,.xlsx,.csv" style="display:none;" onchange="raHandleUpload(this)">'
      +'</div>');
  // Restore this SAME conversation's preserved draft, if any — one-shot,
  // deleted after restoring so a later re-render of this conversation
  // (once it's genuinely empty again) doesn't reapply a stale value.
  if(conv.status!=='finalized'&&_raCanEdit&&_raChatDraftByConvId[conv.id]){
    var _newChatInput=document.getElementById('ra-chat-input');
    if(_newChatInput)_newChatInput.value=_raChatDraftByConvId[conv.id];
    delete _raChatDraftByConvId[conv.id];
  }
  raRenderChatHistory();
  raRenderLiveDraft();
  raRenderAttachedDocs(conv);
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

// Quick-select chip block — rendered under the newest agent message only
// (never on history), so an answered/superseded turn never shows a stale
// set of options. targetSection/question/options come straight from the
// model's clarifyingQuestions field (prompts.js's _raClarifyingQuestionsRules()),
// already sanitized by _raSanitizeClarifyingQuestions() before storage.
function _raQuickReplyHtml(cq){
  return (cq||[]).map(function(q){
    return '<div class="ra-quick-reply-block">'
      +'<span class="ra-quick-reply-target-tag">'+e(q.targetSection)+'</span>'
      +'<div class="ra-quick-reply-q">'+e(q.question)+'</div>'
      +'<div class="ra-quick-reply-row">'
        +(q.options||[]).map(function(opt){
          return '<button type="button" class="ra-quick-reply-chip" data-answer="'+e(opt)+'" onclick="raQuickReplyClick(this)">'+e(opt)+'</button>';
        }).join('')
      +'</div>'
    +'</div>';
  }).join('');
}
function _raBubbleHtml(m,idx,total){
  var isUser=m.role==='user';
  var highlightId='ra-msg-'+idx;
  var conv=_raActiveConv();
  var showChips=!isUser&&idx===(total-1)&&conv&&conv.status==='draft'&&m.clarifyingQuestions&&m.clarifyingQuestions.length>0&&((typeof _raCanEditOwner!=='function')||_raCanEditOwner());
  return '<div class="gl-msg-row '+(isUser?'user':'agent')+'" id="'+highlightId+'">'
    +'<div class="gl-avatar '+(isUser?'user-av':'agent-av')+'">'+(isUser?e((typeof _glUserInitials==='function')?_glUserInitials():'You'):'AI')+'</div>'
    +'<div class="gl-bubble">'+(typeof _glFormatChatText==='function'?_glFormatChatText(m.text):e(m.text||''))
      +(showChips?_raQuickReplyHtml(m.clarifyingQuestions):'')
    +'</div>'
  +'</div>';
}
function raRenderChatHistory(){
  var body=document.getElementById('ra-chat-body');
  var conv=_raActiveConv();
  if(!body||!conv)return;
  var total=(conv.messages||[]).length;
  body.innerHTML=(conv.messages||[]).map(function(m,idx){return _raBubbleHtml(m,idx,total);}).join('');
  body.scrollTop=body.scrollHeight;
}
function raAppendMessage(conv,role,text,extra){
  conv.messages=conv.messages||[];
  conv.messages.push(Object.assign({role:role,text:text,timestamp:new Date().toISOString()},extra||{}));
  var body=document.getElementById('ra-chat-body');
  if(body){
    // Stale quick-reply block(s) from the previous agent turn must not
    // linger once ANY new message lands (typed or chip-driven) — otherwise
    // a PM could click an old, already-superseded option. querySelectorAll,
    // not querySelector: confirmed via live testing that when a turn ever
    // surfaces more than one question block, querySelector's single-match
    // removal left the second block's chips clickable after the first was
    // answered, silently discarding that question with no way to answer it
    // (clarifyingQuestions is now capped to 1/turn client-side specifically
    // to avoid this, but this cleanup should never depend on that cap).
    var oldQrs=body.querySelectorAll('.ra-quick-reply-block');
    oldQrs.forEach(function(el){el.remove();});
    var total=conv.messages.length;
    body.insertAdjacentHTML('beforeend',_raBubbleHtml(conv.messages[total-1],total-1,total));
    body.scrollTop=body.scrollHeight;
  }
}
function _raSetBusy(busy){
  raBusy=busy;
  var sendBtn=document.getElementById('ra-send-btn');
  var uploadChip=document.getElementById('ra-upload-chip');
  if(uploadChip)uploadChip.classList.toggle('gl-upload-chip-disabled',busy);
  if(sendBtn)sendBtn.disabled=busy;
  // The textarea itself deliberately stays enabled while busy (PM feedback:
  // a turn can take a minute or more, so the PM should be able to type their
  // next message while waiting instead of staring at a disabled box) - only
  // sending/uploading is blocked. raSendMessage() checks raBusy before
  // touching the textarea's value, so an Enter press mid-generation is a
  // safe no-op that leaves whatever the PM was typing intact.
}
// v14 code-review fix — _raShowTyping/_raHideTyping and the newer
// _raShowIndexing/_raHideIndexing were near-identical copies of each other
// (same transient, never-persisted-to-conv.messages DOM row: insert on
// show, getElementById().remove() on hide). Consolidated into one shared
// pair; _raTypingRowHtml()/_raIndexingRowHtml() are kept as named builders
// since nothing about their own signatures needed to change.
function _raStatusRowHtml(rowId,innerHtml){
  return '<div class="gl-msg-row agent" id="'+rowId+'"><div class="gl-avatar agent-av">AI</div><div class="gl-bubble gl-typing-bubble">'+innerHtml+'</div></div>';
}
function _raShowStatusRow(rowId,innerHtml){
  var body=document.getElementById('ra-chat-body');
  if(body){body.insertAdjacentHTML('beforeend',_raStatusRowHtml(rowId,innerHtml));body.scrollTop=body.scrollHeight;}
}
function _raHideStatusRow(rowId){
  var row=document.getElementById(rowId);
  if(row)row.remove();
}
var _RA_TYPING_DOTS_HTML='<div class="gl-typing-dots"><span></span><span></span><span></span></div>';
function _raTypingRowHtml(){
  return _raStatusRowHtml('ra-typing-row',_RA_TYPING_DOTS_HTML);
}
function _raShowTyping(){
  _raShowStatusRow('ra-typing-row',_RA_TYPING_DOTS_HTML);
}
function _raHideTyping(){
  _raHideStatusRow('ra-typing-row');
}

function _raIndexingRowHtml(fileName){
  return _raStatusRowHtml('ra-indexing-row',_RA_TYPING_DOTS_HTML+' Indexing '+e(fileName)+'… don’t close this tab yet');
}
function _raShowIndexing(fileName){
  _raShowStatusRow('ra-indexing-row',_RA_TYPING_DOTS_HTML+' Indexing '+e(fileName)+'… don’t close this tab yet');
}
function _raHideIndexing(){
  _raHideStatusRow('ra-indexing-row');
}

// ── v-next: dual-mode streaming switch, default OFF ──
// Now a real, persisted company setting - Settings > Company Profile &
// Access > API & Access > "Live AI Streaming" (see settings-page.js's spP1()
// and settingsPageSave()) - rather than a dev-only localStorage flag.
// Requirement Agent behaves EXACTLY as it did before this feature existed
// until an admin explicitly turns this on. See the approved plan for why
// this ships as a runtime switch rather than a one-way cutover: the
// streaming path depends on a different prompt response contract
// (prompts.js's streamingMode param), so this same flag gates both sides
// together, never one without the other.
function _raStreamingEnabled(){
  return (typeof appSettings!=='undefined'&&appSettings)?appSettings.aiStreamingEnabled===true:false;
}
// Live streaming bubble - a plain DOM element updated as deltas arrive,
// entirely separate from conv.messages/raAppendMessage() until the stream
// finishes. Once the full text is known (chatReply + sectionUpdates JSON
// split apart), this bubble is removed and raAppendMessage() runs exactly
// as it does on the non-streaming path - so every downstream behavior
// (quick-reply chips, history re-render, persistence) is unchanged code.
function _raStreamBubbleShow(){
  var body=document.getElementById('ra-chat-body');
  if(!body)return null;
  body.insertAdjacentHTML('beforeend','<div class="gl-msg-row agent" id="ra-stream-bubble"><div class="gl-avatar agent-av">AI</div><div class="gl-bubble" id="ra-stream-bubble-text"></div></div>');
  body.scrollTop=body.scrollHeight;
  return document.getElementById('ra-stream-bubble-text');
}
function _raStreamBubbleRemove(){
  var row=document.getElementById('ra-stream-bubble');
  if(row)row.remove();
}
// Splits a streaming response (plain-text chatReply + sentinel + JSON tail,
// per prompts.js's streamingMode contract) into the same {chatReply,
// sectionUpdates, openQuestions, clarifyingQuestions, suggestedTitle} shape
// _raParseJSON() returns for the non-streaming path, so every call site
// downstream of parsing can stay identical regardless of which mode ran.
function _raSplitStreamResponse(raw){
  var idx=(raw||'').indexOf(_RA_STREAM_SENTINEL);
  if(idx<0)return null;
  var chatReply=raw.slice(0,idx).trim();
  var jsonPart=raw.slice(idx+_RA_STREAM_SENTINEL.length);
  var parsed=_raParseJSON(jsonPart);
  if(!parsed)return null;
  parsed.chatReply=chatReply;
  return parsed;
}

// Shared by every callAPI()/callAPIStream() call site in this file (non-
// streaming _raCallModel() below, plus both streaming branches in
// raRunOpeningTurn()/_raRunTurn()) - previously copy-pasted at each site,
// which risked the streaming and non-streaming paths silently diverging in
// what they report for usage tracking if only one copy got updated.
function _raUsageExtraFields(){
  return {session_id:(typeof _activeSessionId!=='undefined'?_activeSessionId:null),product_id:(typeof productContext!=='undefined'&&productContext?productContext.id:null),session_type:'ChatCanvas'};
}
async function _raCallModel(sys,usr,signal){
  var extra=_raUsageExtraFields();
  // v-next: lowered back from 8000 - that cap was raised for the OLD
  // return-the-FULL-document-every-turn design, where a large capability
  // set easily produced ~13.7k characters. Now that turns return
  // sectionUpdates (only what changed, see _raApplySectionUpdates()), a
  // typical turn needs a fraction of that - but confirmed via a live
  // "[AI TIMEOUT] ... timeoutMs: 120000" proxy log that the model can still,
  // on a rich multi-section PM answer, generate enough output to run past
  // the PROXY'S OWN hard 120s timeout - which loses the entire turn with no
  // recovery, unlike hitting max_tokens, which _raParseJSON()'s truncation
  // recovery can often salvage. 4000 bounds worst-case generation length
  // (and so worst-case time) to roughly half of the old ceiling, while still
  // comfortably covering a turn that legitimately updates several sections
  // at once.
  return await callAPI(sys,usr,4000,signal||null,null,'requirement-agent',null,extra);
}

// ── New conversation ──
async function raNewConversation(){
  // Round-2 code-review fix — this function has an await in the middle
  // (the persist below) with no guard of its own, so a double-click before
  // the first call's persist resolves used to push a SECOND conversation,
  // whose later raRenderCenter()/raRunOpeningTurn() could start a second,
  // concurrent opening-turn AI call once the first click's persist finally
  // resolved and re-enabled everything. Checked first, same convention as
  // every other RA entry point (raSendMessage, raHandleUpload, etc.).
  if(raBusy)return;
  if(typeof _raCanEditOwner==='function'&&!_raCanEditOwner())return;
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
    generatedFeatureIds:[], // retained for backward compat with pre-redesign finalized conversations — stays empty going forward, Finalize no longer generates features (§7)
    createdCapabilityKeys:[], // NEW — capStore key(s) of every capability this conversation's Finalize created (new capabilities only, not pre-existing ones it touched)
    titleIsPlaceholder:true // cleared once a real, model-suggested title is applied — lets later turns keep retitling a still-generic conversation without ever overwriting a title the PM set themselves (rename or a genuinely specific suggestedTitle)
  };
  raConversations.push(conv);
  raActiveConversationId=conv.id;
  raLastOpenConversationId=conv.id;
  var tabRa=document.getElementById('tab-ra');
  if(tabRa)tabRa.classList.add('revealed');
  raRenderConvList();
  // v14 (OI-9, reordered per post-v9.27 code review) — persistence must
  // happen, and resolve, BEFORE raRenderCenter() runs, not after: that
  // function fires raRunOpeningTurn() (fire-and-forget) whenever a
  // conversation has no messages yet, and raRunOpeningTurn() checks and
  // owns this SAME raBusy flag itself (its own guard, its own
  // finally{_raSetBusy(false)}). Doing the busy/persist dance AFTER calling
  // raRenderCenter() made this function a SECOND concurrent writer of
  // raBusy — this function's own _raSetBusy(false) could fire while the
  // opening turn was still generating, silently re-enabling upload/send
  // mid-turn. Persisting first means the opening turn becomes the sole
  // subsequent owner of raBusy once persistence is confirmed done, never a
  // second one racing it. Also closes OI-9 itself: an upload immediately
  // after creating this conversation would otherwise race this same save,
  // since ra_ingest_document_chunks()'s authorization check reads the
  // database's current snapshot, which won't contain this conversation's
  // id until this resolves.
  _raSetBusy(true);
  var _raNcPersisted=await _raPersist();
  // Round-2 code-review fix — ALWAYS clear raBusy here, success or not.
  // The original failure branch left it permanently true with no other
  // writer left to clear it: raRenderCenter()'s freshly-rendered composer
  // has no actual disabled attribute on its Send button/upload chip (that
  // only reflects raBusy at the moment of rendering, not afterward), so
  // this looked clickable but silently no-opped forever, for THIS
  // conversation and every OTHER already-healthy one, until a page reload.
  _raSetBusy(false);
  if(!_raNcPersisted){
    // Warn via toast, not a persisted chat message — an earlier version
    // used raAppendMessage(), which pushes into conv.messages, which is
    // part of the persisted snapshot: the very next successful save (this
    // conversation's own opening turn ends with one, fire-and-forget)
    // would bake that error in permanently, AND raRenderCenter()'s
    // "no messages yet -> auto-run the opening turn" branch would then
    // never fire again for this conversation (conv.messages.length>0
    // forever), leaving it stuck empty with no opening summary. A toast
    // has none of that persistence baggage. The opening turn proceeds
    // regardless of this save's outcome — it needs no database at all;
    // only an upload (gated by its own fresh session/RPC checks in
    // raHandleUpload()) actually depends on this row existing yet, and
    // that call's own error surfacing already explains a failure clearly
    // if the retry (this conversation's own later persists) hasn't
    // caught up yet.
    if(typeof showToast==='function')showToast('This conversation may not have saved yet - it will retry automatically.','warn');
  }
  raRenderCenter();
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
  var _streaming=_raStreamingEnabled();
  try{
    var _raDocCtx1=(typeof buildDocContext==='function')?buildDocContext('ra'):'';
    var built=buildRequirementAgentDMOpeningPrompt(typeof sessionContext!=='undefined'?sessionContext:{},_raFirstName(),_raDocCtx1,_streaming);
    var raw,parsed;
    if(_streaming){
      var _bubbleEl=null;
      var extra=_raUsageExtraFields();
      raw=await callAPIStream(built.sys,built.usr,4000,_signal,null,'requirement-agent',null,extra,function(delta){
        _raHideTyping();
        if(!_bubbleEl)_bubbleEl=_raStreamBubbleShow();
        if(_bubbleEl){
          _bubbleEl.textContent=(_bubbleEl.textContent||'')+delta;
          var _body=document.getElementById('ra-chat-body');
          if(_body)_body.scrollTop=_body.scrollHeight;
        }
      });
      _raStreamBubbleRemove();
      parsed=_raSplitStreamResponse(raw);
    }else{
      raw=await _raCallModel(built.sys,built.usr,_signal);
      parsed=_raParseJSON(raw);
    }
    _raHideTyping();
    if(typeof endAiGen==='function')endAiGen();
    if(!parsed||!Array.isArray(parsed.sectionUpdates)){
      raAppendMessage(conv,'agent','I had trouble putting together an opening summary just now. Try typing a message below and I’ll pick this up from there.');
      return;
    }
    // QA issue #7 — use the AI's own contextual suggestedTitle if still on
    // the default placeholder (never overwrite a conversation the user has
    // already renamed). Falls back to the old boilerplate only if the model
    // omitted the field entirely — never leaves the title un-set. Only a
    // genuine model suggestion clears titleIsPlaceholder — the boilerplate
    // fallback keeps it true so a later turn (see _raRunTurn()) can still
    // retitle once the conversation gets more specific. Set BEFORE
    // _raApplySectionUpdates() below, since _raBuildDraftMd() reads
    // conv.title for the brief's H1 — otherwise the H1 would lag one turn
    // behind the actual title.
    if(conv.titleIsPlaceholder){
      var _suggested=(parsed.suggestedTitle||'').trim();
      if(_suggested){conv.title=_suggested;conv.titleIsPlaceholder=false;}
      else conv.title='Release requirements'; // product-name-free fallback — titleIsPlaceholder stays true so a later turn can still replace this
    }
    conv.liveDraftMd=_raApplySectionUpdates(conv,parsed.sectionUpdates);
    conv.draftVersion=1;
    conv.touchedCapabilityKeys=_raParseTouchedCapabilities(conv.liveDraftMd);
    conv.openQuestions=_raDedupeQuestions(parsed.openQuestions).map(function(q,i){return {id:'oq'+i,type:'clarification',resolved:false,messageIndex:(conv.messages||[]).length};});
    raAppendMessage(conv,'agent',parsed.chatReply||'Here’s a starting draft — take a look on the right.',{clarifyingQuestions:conv.raQuestionsOptedOut?[]:_raSanitizeClarifyingQuestions(parsed.clarifyingQuestions)});
    conv.updatedAt=new Date().toISOString();
    raRenderLiveDraft();
    raRenderConvList();
    _raPersist();
  }catch(err){
    _raHideTyping();
    _raStreamBubbleRemove();
    if(typeof endAiGen==='function')endAiGen();
    if(err&&err.name==='AbortError')return; // user chose "Leave anyway" — no error bubble needed
    console.warn('[requirement-agent] opening turn failed',err);
    raAppendMessage(conv,'agent','Something went wrong generating the opening summary ('+(err&&err.message?err.message:'unknown error')+'). Type a message below, or refresh and try again.');
  }finally{
    _raSetBusy(false);
  }
}

// Shared tail for "the user has answered/said something, submit it as the
// next turn" - used by both the free-text textarea (raSendMessage()) and
// the quick-select chip click (raQuickReplyClick()) so there is exactly one
// place that appends the user message and runs the turn, not two competing
// copies of the same three lines.
async function _raSubmitUserMessage(conv,text){
  if(!conv||raBusy||conv.status!=='draft'||!text)return;
  // v9.25.04 — stop-on-send (product decision), centralized here rather
  // than duplicated in raSendMessage()/raQuickReplyClick(): RA's mic
  // previously stayed listening across Sends by design (a multi-turn chat,
  // unlike every other single-shot AI-refine box's own stop-on-send), but
  // that was reported as unexpected in practice. Placing the call AFTER
  // the guard above (not in each caller, before their own guards) matters:
  // a code-review pass on the first version of this fix found it firing
  // before the empty-text/empty-answer checks in both callers, silently
  // killing an active dictation session on a no-op Enter press or stray
  // click — the exact class of bug capability-canvas.js's
  // ccGenerateFeaturesForCapClick() was already fixed for once before
  // (guard-before-stop). Since this function is the single choke point
  // both callers route through, one guarded call here covers both, and
  // any future third submit path automatically inherits it too.
  voiceStopActive('abort');
  if(_raDetectsQuestionsOptOut(text))conv.raQuestionsOptedOut=true;
  raAppendMessage(conv,'user',text);
  await _raRunTurn(conv,text);
}
async function raSendMessage(){
  // Checked first, before ever touching the textarea's value - the
  // textarea now stays enabled while a turn is in flight (see
  // _raSetBusy()) so the PM can keep typing during the ~minute a turn
  // takes, so an Enter press or stray Send click mid-generation must be a
  // pure no-op that leaves whatever they were typing untouched, not
  // silently clear it out from under them.
  if(raBusy)return;
  if(typeof _raCanEditOwner==='function'&&!_raCanEditOwner())return;
  var conv=_raActiveConv();
  var input=document.getElementById('ra-chat-input');
  if(!input)return;
  var text=input.value.trim();
  if(!text)return;
  input.value='';
  await _raSubmitUserMessage(conv,text);
}
// Handles a click on a quick-select chip (_raQuickReplyHtml()) - forwards
// the chosen option text through the same submit path as typing it would,
// so the model's next turn sees it exactly like any other user message.
function raQuickReplyClick(btnEl){
  var conv=_raActiveConv();
  if(!conv||raBusy||conv.status!=='draft')return;
  if(typeof _raCanEditOwner==='function'&&!_raCanEditOwner())return;
  var answer=btnEl.dataset.answer;
  if(!answer)return;
  // Remove the whole quick-reply block immediately - confirms the pick
  // visually and prevents a double-click submitting the same answer twice.
  var block=btnEl.closest('.ra-quick-reply-block');
  if(block)block.remove();
  _raSubmitUserMessage(conv,answer);
}

// uploadedDocText/uploadedDocName (optional) — a document dropped via the
// mid-chat upload chip (raHandleUpload()), ephemeral by design: matches
// Guided Launch's existing convention exactly (see guided-launch.js's
// _glRunRevisionTurn()) — the raw text is never persisted, only whatever
// the model merges into liveDraftMd survives a refresh.
// v14 (D6) — retrieval query priority order: current message in full, then
// the agent's prior reply, then the PM's prior message. By the time this
// runs, conv.messages already has the CURRENT user message appended as its
// last entry (raAppendMessage() in _raSubmitUserMessage()/raQuickReplyClick()
// runs before _raRunTurn() is called) — scans backward from before that
// entry, by role, rather than assuming strict turn alternation.
function _raBuildRetrievalQuery(conv,userMessage){
  var parts=[];
  if(userMessage)parts.push(userMessage);
  var msgs=(conv.messages||[]).slice(0,-1);
  var priorAgent=null,priorUser=null;
  for(var i=msgs.length-1;i>=0&&(priorAgent===null||priorUser===null);i--){
    if(priorAgent===null&&msgs[i].role==='agent')priorAgent=msgs[i].text;
    else if(priorUser===null&&msgs[i].role==='user')priorUser=msgs[i].text;
  }
  if(priorAgent)parts.push(priorAgent);
  if(priorUser)parts.push(priorUser);
  return parts.join('\n\n').trim();
}

// Below this similarity, a retrieved chunk is treated as not actually
// relevant to the current turn and dropped rather than injected — an
// initial, conservative value; tune against real retrieval quality once
// this is live (not specified numerically anywhere in the spec, unlike the
// 20,000-word upload cap in OI-3, so treated as a tunable default here
// rather than a fixed requirement).
var RA_RETRIEVAL_RELEVANCE_THRESHOLD=0.3;

// v14 (D3) — groups retrieved chunks by source document and formats each
// document's group once via the shared, existing _docFormatBlock() (D3) —
// not a new framing mechanism.
function _raFormatRetrievedChunks(rows){
  if(!rows||!rows.length)return '';
  var byDoc={};
  var order=[];
  rows.forEach(function(r){
    if(!byDoc[r.doc_name]){byDoc[r.doc_name]=[];order.push(r.doc_name);}
    byDoc[r.doc_name].push(r.chunk_text);
  });
  if(typeof _docFormatBlock!=='function')return '';
  return order.map(function(name){
    var doc={name:name,docType:'other',scope:'session',sessionScoped:true};
    return _docFormatBlock(doc,byDoc[name].join('\n\n...\n\n'));
  }).join('\n\n');
}

async function _raRunTurn(conv,userMessage,uploadedDocText,uploadedDocName){
  _raSetBusy(true);
  _raShowTyping();
  var _signal=(typeof startAiGen==='function')?startAiGen('Requirement Agent is updating the draft. Leaving now discards this update, you\'ll need to resend your message.'):null;
  var _streaming=_raStreamingEnabled();
  try{
    // v14 (D5/D6/D8) — existence-only gate first: skip the embed+search
    // round trip entirely when this conversation has no active documents.
    // Every step below degrades to "no retrieved context" on any failure
    // (network, embedding service down, schema-version mismatch) rather
    // than blocking the turn — a PM's ability to keep chatting must never
    // depend on the embedding service being up.
    var _raRetrievedCtx='';
    // v14 code-review fix — captured once, before any of the awaits below,
    // per this project's own "capture session identity BEFORE async work"
    // convention (already followed in raHandleUpload()). Re-reading the
    // global separately for the list-documents call and the later
    // search-chunks call meant a PM switching sessions mid-turn could pair
    // the NEW session's id with this (OLD) conversation's id on the second
    // call, producing a spurious authorization error the surrounding catch
    // would just silently degrade to "no retrieved context."
    var _raRetrievalSessionId=(typeof _activeSessionId!=='undefined')?_activeSessionId:null;
    try{
      if(_raRetrievalSessionId&&typeof _pgtRpc==='function'){
        var _raDocsRes=await _pgtRpc('ra_list_documents',{p_session_id:_raRetrievalSessionId,p_conversation_id:conv.id});
        if(_raDocsRes&&!_raDocsRes.error&&Array.isArray(_raDocsRes.data)&&_raDocsRes.data.length){
          var _raQuery=_raBuildRetrievalQuery(conv,userMessage);
          if(_raQuery){
            var _raQueryEmbedRes=await _raEmbedTexts([_raQuery]);
            if(_raQueryEmbedRes&&Array.isArray(_raQueryEmbedRes.embeddings)&&_raQueryEmbedRes.embeddings[0]){
              var _raSearchRes=await _pgtRpc('ra_search_doc_chunks',{
                p_session_id:_raRetrievalSessionId,
                p_conversation_id:conv.id,
                p_query_embedding:_raQueryEmbedRes.embeddings[0],
                p_current_schema_version:_raQueryEmbedRes.embedding_schema_version,
                p_limit:4
              });
              if(_raSearchRes&&!_raSearchRes.error&&Array.isArray(_raSearchRes.data)){
                var _raRelevant=_raSearchRes.data.filter(function(r){return typeof r.similarity==='number'&&r.similarity>=RA_RETRIEVAL_RELEVANCE_THRESHOLD;});
                _raRetrievedCtx=_raFormatRetrievedChunks(_raRelevant);
              }
            }
          }
        }
      }
    }catch(_raRetrievalErr){
      console.warn('[requirement-agent] document retrieval failed — continuing without retrieved context',_raRetrievalErr);
    }

    var _raDocCtx2=(typeof buildDocContext==='function')?buildDocContext('ra'):'';
    var built=buildRequirementAgentTurnPrompt(typeof sessionContext!=='undefined'?sessionContext:{},conv.liveDraftMd,(conv.messages||[]).slice(0,-1),userMessage,_raDocCtx2,uploadedDocText,uploadedDocName,_streaming,_raRetrievedCtx);
    var raw,parsed;
    if(_streaming){
      var _bubbleEl=null;
      var extra=_raUsageExtraFields();
      raw=await callAPIStream(built.sys,built.usr,4000,_signal,null,'requirement-agent',null,extra,function(delta){
        _raHideTyping();
        if(!_bubbleEl)_bubbleEl=_raStreamBubbleShow();
        if(_bubbleEl){
          _bubbleEl.textContent=(_bubbleEl.textContent||'')+delta;
          var _body=document.getElementById('ra-chat-body');
          if(_body)_body.scrollTop=_body.scrollHeight;
        }
      });
      _raStreamBubbleRemove();
      parsed=_raSplitStreamResponse(raw);
    }else{
      raw=await _raCallModel(built.sys,built.usr,_signal);
      parsed=_raParseJSON(raw);
    }
    _raHideTyping();
    if(typeof endAiGen==='function')endAiGen();
    if(!parsed||!Array.isArray(parsed.sectionUpdates)){
      raAppendMessage(conv,'agent','I couldn’t process that update. Could you rephrase, or try again?');
      return;
    }
    // QA fix — the opening turn's suggestedTitle falls back to generic
    // boilerplate when the model omits it on turn 1; without this, a
    // conversation stuck on that boilerplate could never improve as later
    // turns made its scope more specific (titleIsPlaceholder stays true
    // until a real suggestion lands, from either turn). Set BEFORE
    // _raApplySectionUpdates() below — see raRunOpeningTurn()'s matching
    // comment for why the ordering matters (conv.title feeds the brief's H1).
    if(conv.titleIsPlaceholder){
      var _suggestedTurn=(parsed.suggestedTitle||'').trim();
      if(_suggestedTurn){conv.title=_suggestedTurn;conv.titleIsPlaceholder=false;}
    }
    conv.liveDraftMd=_raApplySectionUpdates(conv,parsed.sectionUpdates);
    conv.draftVersion=(conv.draftVersion||1)+1;
    conv.touchedCapabilityKeys=_raParseTouchedCapabilities(conv.liveDraftMd);
    var existingResolved={};
    (conv.openQuestions||[]).forEach(function(q){existingResolved[q.id]=q.resolved;});
    conv.openQuestions=_raDedupeQuestions(parsed.openQuestions).map(function(q,i){var id='oq'+i;return {id:id,type:'clarification',resolved:!!existingResolved[id],messageIndex:(conv.messages||[]).length};});
    raAppendMessage(conv,'agent',parsed.chatReply||'Updated the draft — take a look.',{clarifyingQuestions:conv.raQuestionsOptedOut?[]:_raSanitizeClarifyingQuestions(parsed.clarifyingQuestions)});
    conv.updatedAt=new Date().toISOString();
    raRenderLiveDraft();
    raRenderConvList();
    _raPersist();
  }catch(err){
    _raHideTyping();
    _raStreamBubbleRemove();
    if(typeof endAiGen==='function')endAiGen();
    if(err&&err.name==='AbortError')return; // user chose "Leave anyway" — no error bubble needed
    console.warn('[requirement-agent] turn failed',err);
    raAppendMessage(conv,'agent','Something went wrong processing that ('+(err&&err.message?err.message:'unknown error')+'). Please try again.');
  }finally{
    _raSetBusy(false);
  }
}

// ── Mid-chat upload (persistent, RA-Persistent-Doc-RAG-Spec-v14) ──
// Extracts text client-side (extractTextFromFile, shared with Home's
// session docs and Guided Launch's own mid-chat upload — see utils.js),
// chunks + caps it, embeds every chunk via the proxy, then ingests it via
// ra_ingest_document_chunks() so it's retrievable for this conversation's
// FULL lifetime (including after pause/resume) — not fed into the current
// turn directly. This is the actual behavior change this spec exists to
// make: retrieval happens later, per-turn, in _raRunTurn(); this function's
// only job is getting the document indexed.
var RA_MAX_UPLOAD_WORDS=20000;
// v14 code-review fix (round 3) — the original deterministic-hash approach
// (derived purely from name+size+lastModified, no randomness at all) meant
// re-uploading the EXACT same file after deliberately removing it always
// regenerated the identical doc_id — which D4's lifecycle model correctly
// treats as terminal and never resurrects, so that specific file could
// never be re-attached to that conversation again, and the RPC's own
// "upload it again as a new document" advice was impossible to satisfy
// (re-selecting the same file always produces the same id).
//
// Replaced with a short-lived, in-memory-only retry cache instead: the
// SAME file re-selected while an earlier attempt for it is still pending
// (not yet confirmed success, and not explicitly removed since) reuses
// that attempt's id — which is what D4's idempotency path actually exists
// for (a client-side timeout after the server already committed). Any
// other case — a fresh upload, or re-uploading after the earlier attempt
// succeeded or was removed — gets a brand new random id via _raUid(),
// exactly like every other identity in this file. Cleared on confirmed
// ingest success (raHandleUpload()) and on removal (raRemoveDocument()) —
// see both call sites below.
var _raPendingUploadIds={}; // key: "convId|name|size|lastModified" -> doc_id
function _raUploadIdKey(conv,file){
  return conv.id+'|'+file.name+'|'+file.size+'|'+(file.lastModified||0);
}
function _raClearPendingUploadIdsForConv(convId){
  var prefix=convId+'|';
  Object.keys(_raPendingUploadIds).forEach(function(k){
    if(k.indexOf(prefix)===0)delete _raPendingUploadIds[k];
  });
}

async function raHandleUpload(inputEl){
  var conv=_raActiveConv();
  var file=inputEl.files&&inputEl.files[0];
  inputEl.value='';
  if(!file||!conv||raBusy||conv.status!=='draft')return;
  if(typeof _raCanEditOwner==='function'&&!_raCanEditOwner())return;
  // v14 code-review fix — captured into a local now, before any async work
  // below, per AI_EDITING_RULES.md's "capture session identity BEFORE async
  // work" rule: reading the _activeSessionId global again after the
  // extract/embed awaits below could pick up a DIFFERENT session's id if
  // the PM switched sessions mid-upload.
  var sessionId=(typeof _activeSessionId!=='undefined')?_activeSessionId:null;
  if(!sessionId){
    raAppendMessage(conv,'agent','Could not upload '+file.name+' - no active session.');
    return;
  }
  // v14 code-review fix — filename length checked client-side, before
  // anything else runs. mt_ra_docs' own doc_name CHECK (1-300 chars) would
  // catch this too, but only after extraction AND embedding already ran -
  // this rejects it for free, before any of that work starts.
  if(file.name.length>300){
    raAppendMessage(conv,'agent','That filename is too long (over 300 characters) - rename the file and try again.');
    return;
  }

  // v14 code-review fix (round 2) — moved before the "Uploaded: X" message
  // below, and out of the main try block: fetch the CURRENT document count
  // fresh (never a stale client-held count) and reject before anything is
  // added to the transcript. This used to run AFTER "Uploaded: X" was
  // already appended, so a rejected upload left a permanent, false record
  // in the conversation history claiming something was uploaded when
  // nothing was — the same class of persisted-false-state bug
  // raNewConversation()'s own fix (elsewhere in this file) was careful to
  // avoid by using a toast instead of raAppendMessage() on failure.
  var _raCountRes;
  try{
    _raCountRes=await _pgtRpc('ra_list_documents',{p_session_id:sessionId,p_conversation_id:conv.id});
  }catch(err){
    raAppendMessage(conv,'agent',(err&&err.message)||('Could not upload '+file.name+'.'));
    return;
  }
  if(_raCountRes&&_raCountRes.error){
    raAppendMessage(conv,'agent',_raCountRes.error.message||('Could not upload '+file.name+'.'));
    return;
  }
  if(Array.isArray(_raCountRes&&_raCountRes.data)&&_raCountRes.data.length>=5){
    raAppendMessage(conv,'agent','Maximum 5 documents per conversation reached - remove one before uploading another.');
    return;
  }

  raAppendMessage(conv,'user','Uploaded: '+file.name);
  _raSetBusy(true);
  _raShowIndexing(file.name);
  try{
    var extractFn=(typeof extractTextFromFile==='function')?extractTextFromFile:function(){return Promise.reject(new Error('extractTextFromFile not available'));};
    var extracted=await extractFn(file,RA_MAX_UPLOAD_WORDS);
    var text=(extracted&&typeof extracted==='object')?extracted.text:extracted;
    var wasTruncated=!!(extracted&&typeof extracted==='object'&&extracted.truncated);
    if(!text||!text.trim()){
      _raHideIndexing();
      _raSetBusy(false);
      raAppendMessage(conv,'agent',file.name+' didn’t have any readable text - try a different file, or tell me about it directly in chat.');
      return;
    }

    // D3 — word-based chunks from the shared chunker, then capped to
    // mt_ra_doc_chunks' 4000-character CHECK constraint (a chunk of short,
    // dense words can exceed 4000 characters despite being under the word
    // cap — see _raCapChunkChars()'s own comment in utils.js).
    var chunks=_raCapChunkChars(chunkText(text));
    if(!chunks.length){
      _raHideIndexing();
      _raSetBusy(false);
      raAppendMessage(conv,'agent',file.name+' didn’t have any readable text - try a different file, or tell me about it directly in chat.');
      return;
    }

    var embedRes=await _raEmbedTexts(chunks);
    if(!embedRes||!Array.isArray(embedRes.embeddings)||embedRes.embeddings.length!==chunks.length){
      throw new Error('Embedding response did not match the number of chunks sent.');
    }

    var payloadChunks=chunks.map(function(t,i){return {chunk_text:t,embedding:embedRes.embeddings[i]};});
    var _raUpKey=_raUploadIdKey(conv,file);
    var docId=_raPendingUploadIds[_raUpKey]||_raUid();
    _raPendingUploadIds[_raUpKey]=docId;
    var ingestRes=await _pgtRpc('ra_ingest_document_chunks',{
      p_session_id:sessionId,
      p_conversation_id:conv.id,
      p_doc_id:docId,
      p_doc_name:file.name,
      p_embedding_schema_version:embedRes.embedding_schema_version,
      p_chunks:payloadChunks
    });
    // Surfaces the RPC's own exact message per D4's lifecycle model
    // (previously-removed, reused-with-different-content, max-5-documents,
    // lock-contention/BUSY) rather than a generic failure — D8. Lock
    // contention is never auto-retried here; the RPC's own message already
    // tells the PM to try again shortly, on their own action.
    if(ingestRes&&ingestRes.error)throw ingestRes.error;
    delete _raPendingUploadIds[_raUpKey]; // confirmed success - no longer "pending"; a future re-upload of this same file gets a fresh id

    _raHideIndexing();
    _raSetBusy(false);
    raAppendMessage(conv,'agent','Indexed '+file.name+'.'+(wasTruncated?' Only the first '+RA_MAX_UPLOAD_WORDS.toLocaleString()+' words were indexed - for a longer document, consider uploading just the most relevant section.':'')+' You can ask me about it anytime while this conversation is open.');
    raRenderAttachedDocs(conv);
  }catch(err){
    _raHideIndexing();
    _raSetBusy(false);
    var msg;
    if(err&&err.message==='PASSWORD_PROTECTED'){
      msg=file.name+' is password-protected - remove the password and re-upload.';
    }else if(err&&err.message){
      msg=err.message;
    }else{
      msg='Could not upload '+file.name+'.';
    }
    raAppendMessage(conv,'agent',msg);
  }
}

// ── Attached-documents display + removal (D5, D7) ──
// Fetches fresh from ra_list_documents() every time — never cached, per D5
// — since a stale client-side list could show a document as attached after
// it (or its whole conversation) was removed elsewhere.
async function raRenderAttachedDocs(conv){
  var box=document.getElementById('ra-attached-docs');
  if(!box)return;
  if(!conv||typeof _activeSessionId==='undefined'||!_activeSessionId||typeof _pgtRpc!=='function'){box.innerHTML='';return;}
  // v14 code-review fix — these two calls don't depend on each other's
  // result (embedInfo is only used to flag the "stale" badge on whatever
  // ra_list_documents returns), so they run concurrently rather than one
  // full round trip after another. Wrapped in try/catch — confirmed
  // _pgtRpc() can still reject (not just resolve to {error}) if authInit()
  // itself throws, so this degrades the same way the rest of RA's
  // retrieval code does rather than surfacing an uncaught rejection.
  var res,embedInfo;
  try{
    var _raResults=await Promise.all([
      _pgtRpc('ra_list_documents',{p_session_id:_activeSessionId,p_conversation_id:conv.id}),
      (typeof _raGetEmbedInfo==='function')?_raGetEmbedInfo():Promise.resolve(null)
    ]);
    res=_raResults[0];embedInfo=_raResults[1];
  }catch(err){
    console.warn('[requirement-agent] raRenderAttachedDocs failed',err);
    if(_raActiveConv()===conv)box.innerHTML='';
    return;
  }
  // Re-check we're still looking at the same conversation's box — a slow
  // fetch landing after the PM has since switched conversations must not
  // paint the wrong conversation's documents into a box that survived the
  // switch only because #ra-attached-docs is part of the same DOM subtree.
  if(_raActiveConv()!==conv)return;
  if(!res||res.error||!Array.isArray(res.data)||!res.data.length){box.innerHTML='';return;}
  var canEdit=(typeof _raCanEditOwner!=='function')||_raCanEditOwner();
  box.innerHTML='<div class="ra-doc-list">'+res.data.map(function(d){
    var stale=!!(embedInfo&&embedInfo.embedding_schema_version&&d.embedding_schema_version&&d.embedding_schema_version!==embedInfo.embedding_schema_version);
    return '<div class="ra-doc-chip" title="'+e(d.doc_name)+'">'
      +'<i class="ti ti-file-text" style="font-size:11px;" aria-hidden="true"></i>'
      +'<span class="ra-doc-chip-name">'+e(d.doc_name)+'</span>'
      +'<span class="ra-doc-chip-date">'+e(_raRelTime(d.created_at))+'</span>'
      +(stale?'<span class="ra-doc-chip-stale" title="Indexed under an older embedding model - not matched against your current questions until it is re-uploaded">older index</span>':'')
      +(canEdit?('<button type="button" class="ra-doc-chip-remove" onclick="raRemoveDocument(\''+e(conv.id)+'\',\''+e(d.doc_id)+'\')" title="Remove"><i class="ti ti-x" style="font-size:9px;" aria-hidden="true"></i></button>'):'')
    +'</div>';
  }).join('')+'</div>';
}

async function raRemoveDocument(convId,docId){
  if(typeof _raCanEditOwner==='function'&&!_raCanEditOwner())return;
  var conv=_raFindConv(convId);
  if(!conv||typeof _activeSessionId==='undefined'||!_activeSessionId||typeof _pgtRpc!=='function')return;
  // v14 code-review fix — wrapped in try/catch, same reasoning as
  // raRenderAttachedDocs() above: confirmed _pgtRpc() can still reject
  // (authInit() itself throwing), not just resolve to {error}.
  var res;
  try{
    res=await _pgtRpc('ra_remove_document',{p_session_id:_activeSessionId,p_conversation_id:convId,p_doc_id:docId});
  }catch(err){
    if(typeof showToast==='function')showToast((err&&err.message)||'Could not remove document.','warn');
    else console.warn('[requirement-agent] raRemoveDocument failed',err);
    return;
  }
  if(res&&res.error){
    if(typeof showToast==='function')showToast(res.error.message||'Could not remove document.','warn');
    else console.warn('[requirement-agent] raRemoveDocument failed',res.error);
    return;
  }
  // v14 code-review fix (round 3) — a removal invalidates any cached
  // pending-upload id for this conversation, so a future re-upload of the
  // same file (deliberately re-attaching it, not retrying a failed
  // attempt) gets a fresh random id instead of colliding with the one that
  // was just tombstoned. Coarse (clears every pending id for this
  // conversation, not just the removed doc's own file) but safe — the
  // worst case is a legitimate in-flight retry loses its cached id and
  // falls back to a fresh one, which is exactly this file's pre-round-2
  // behavior, not a regression.
  _raClearPendingUploadIdsForConv(convId);
  raRenderAttachedDocs(conv);
}

// ── Live draft (right panel) ──
function raRenderLiveDraft(){
  var right=document.getElementById('ra-right');
  var conv=_raActiveConv();
  if(!right||!conv)return;
  var unresolvedCount=(conv.openQuestions||[]).filter(function(q){return!q.resolved;}).length;
  // §7 — Finalize is disabled until the conversation actually has a draft:
  // liveDraftMd is only populated once the opening turn completes (see
  // raRunOpeningTurn()/_raRunTurn()), so an empty/still-loading conversation
  // has nothing to finalize yet. Confirmed gap: previously Finalize was
  // clickable on a brand-new, empty conversation with zero effect other
  // than an unnecessary RPC/save round-trip.
  var hasDraftContent=!!(conv.liveDraftMd&&conv.liveDraftMd.trim().length>0);
  var verLabel=(conv.draftVersion>0)?(' · v0.'+(String(conv.draftVersion).length<2?('0'+conv.draftVersion):conv.draftVersion)):'';
  var exportBtn='<button class="gl-export-btn" onclick="raExportMd()" title="Download the current draft as a .md file"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export</button>';
  right.innerHTML=
    // QA follow-up: the grey banner is back (it was over-removed in the
    // previous pass) — "LIVE DRAFT" eyebrow + the conversation's own
    // contextualized title (never the product name) + version badge, with
    // Export living here only (top-right), not duplicated in the footer.
    // The markdown body still starts directly at "## 1. Requirement Summary"
    // — only the body's own redundant "# H1" line is stripped, not this banner.
    '<div class="ra-md-hdr"><div class="ra-md-hdr-text"><div class="ra-md-hdr-eyebrow">Live Draft</div><div class="ra-md-hdr-title">'+e(conv.title||'Requirements Brief')+'<span class="ra-md-hdr-ver">'+verLabel+'</span></div></div>'
      +'<div class="ra-md-hdr-actions">'
      +(hasDraftContent?exportBtn:'')
      +'<button class="collapse-btn" onclick="raCollapseRightPanel()" title="Collapse panel"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/><polyline points="3 18 9 12 3 6"/></svg></button>'
      +'</div></div>'
    +'<div class="ra-md-body" id="ra-md-body">'+_raMdToHtml(_raStripLeadingH1(conv.liveDraftMd))+'</div>'
    +(conv.status==='finalized'
      ?'<div class="ra-md-footer"><div class="ra-status-badge ra-status-final">Finalized'+(conv.rqNumber?(' · '+e(conv.rqNumber)):'')+'</div></div>'
      :((typeof _raCanEditOwner!=='function')||_raCanEditOwner())
      ?'<div class="ra-md-footer"><div class="ra-footer-row">'
        +'<div class="ra-footer-note">Creates the capabilities and opens Capability Canvas.</div>'
        +'<button class="ra-finalize-btn'+(hasDraftContent?'':' ra-finalize-btn-disabled')+'" id="ra-finalize-btn" '+(hasDraftContent?'onclick="raFinalizeClick()"':'disabled title="Start the conversation to build a draft before finalizing"')+'><i class="ti ti-check" style="font-size:12px;" aria-hidden="true"></i> Finalize</button>'
      +'</div></div>'
      // v14 (D7) — Finalize is a standalone action button, hidden entirely
      // for a non-editable session rather than disabled, per the same
      // hidden-vs-disabled rule the rest of this app already follows.
      :'');
  _raEnhanceLiveDraftDom();
}

// Strips the live draft's own leading "# H1 title" line, since the banner
// above #ra-md-body already shows the conversation's contextualized title —
// keeping both would reintroduce the duplicate the earlier QA pass flagged.
// Only the first line is touched; everything from "## 1. Requirement
// Summary" onward is untouched.
function _raStripLeadingH1(md){
  if(!md)return md;
  return md.replace(/^\s*#\s[^\n]*\n+/,'');
}

// Mirrors Guided Launch's glExportMd() (guided-launch.js) — downloads the
// active conversation's live draft as a .md file, named from the
// conversation's own contextual title rather than the product name (RA's
// draft can cover any capability/release scope, not a whole product).
function raExportMd(){
  var conv=_raActiveConv();
  if(!conv)return;
  var md=conv.liveDraftMd||'';
  var blob=new Blob([md],{type:'text/markdown'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  var name=(conv.title||'requirements-brief').replace(/[^a-z0-9\-_]+/gi,'-').toLowerCase();
  a.href=url;
  a.download=name+'-requirements-brief.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

// ══════════════════════════════════════════════════════════════════════════
// Live Draft New/Existing tagging (§11) — post-processes the rendered
// #ra-md-body DOM (rather than the markdown->HTML step itself) so
// _raMdToHtml() stays the same shared, generic renderer guided-launch.js
// uses. Applies identically in Pass 1 and Pass 2 — no conditional
// suppression based on pass number, per explicit confirmation in the spec.
//   - Capability-level: "(existing)"/"(will be created)" heading suffix ->
//     right-aligned NEW/EXISTING pill.
//   - Feature-level: "(new feature)"/"(existing feature): narrative" bullet
//     -> inline "(new)" suffix (existing features get no suffix, matching
//     the spec's "never re-list existing features as if newly proposed")
//     plus a click-to-expand requirement narrative, since always-visible
//     narrative text would make the panel very long for capabilities with
//     several features.
// ══════════════════════════════════════════════════════════════════════════
function _raEnhanceLiveDraftDom(){
  var body=document.getElementById('ra-md-body');
  if(!body)return;
  // Capability sub-headings — h3 elements tagged "(existing)"/"(will be created)".
  Array.prototype.slice.call(body.querySelectorAll('h3')).forEach(function(h){
    var m=h.textContent.match(/^(.*?)\s*\((existing|will be created)\)\s*$/i);
    if(!m)return;
    var isNew=/will be created/i.test(m[2]);
    h.innerHTML='<span class="ra-cap-tag-row"><span class="ra-cap-tag-name">'+e(m[1].trim())+'</span>'
      +'<span class="ra-tag-pill '+(isNew?'ra-tag-new':'ra-tag-existing')+'">'+(isNew?'NEW':'EXISTING')+'</span></span>';
  });
  // Feature bullets — li elements tagged "(new feature)"/"(existing feature): narrative".
  var uid=0;
  Array.prototype.slice.call(body.querySelectorAll('li')).forEach(function(li){
    var m=li.textContent.match(/^(.*?)\s*\((new|existing)\s+feature\)\s*:\s*(.*)$/i);
    if(!m)return;
    var isNew=/^new$/i.test(m[2]);
    var narrative=m[3].trim();
    var toggleId='ra-narr-'+(uid++);
    li.innerHTML='<span class="ra-feat-line">'+e(m[1].trim())+(isNew?' <span class="ra-feat-new-suffix">(new)</span>':'')
      +(narrative?' <button type="button" class="ra-feat-narr-toggle" onclick="var b=document.getElementById(\''+toggleId+'\');b.style.display=b.style.display===\'block\'?\'none\':\'block\';this.textContent=b.style.display===\'block\'?\'less\':\'more\';">more</button>':'')
      +'</span>'
      +(narrative?'<div class="ra-feat-narrative" id="'+toggleId+'" style="display:none;">'+e(narrative)+'</div>':'');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Finalize-blocked assumption modal — Type-1 Warn, per DESIGN_SYSTEM.md §8
// ══════════════════════════════════════════════════════════════════════════
function raFinalizeClick(){
  var conv=_raActiveConv();
  if(!conv||conv.status==='finalized'||raBusy)return;
  if(typeof _raCanEditOwner==='function'&&!_raCanEditOwner())return;
  // §9 — Finalize would create zero capabilities. Confirmed gap: previously
  // nothing checked this, so Finalize would silently "succeed" while
  // creating nothing. Surfaced explicitly, distinct from the unresolved-
  // questions warning below (a conversation can have real content and zero
  // unresolved questions, yet still touch no NEW capabilities at all).
  var newCapCount=(conv.touchedCapabilityKeys||[]).filter(function(t){return t.isNew;}).length;
  var unresolved=(conv.openQuestions||[]).filter(function(q){return!q.resolved;});
  if(newCapCount===0){
    raShowZeroCapabilityModal(conv,unresolved.length);
    return;
  }
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

// §9 — zero-new-capabilities Finalize warning. Same Type-1 Warn shape as
// raShowAssumptionModal() (DESIGN_SYSTEM.md §8), distinct copy: warns that
// Finalizing now creates nothing. If unresolved open questions ALSO exist,
// "Finalize Anyway" runs with assumptions so the PM never has to click
// through two separate warnings in a row.
function raShowZeroCapabilityModal(conv,unresolvedCount){
  var overlayId='ra-zerocap-overlay';
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
          +'<div style="font-size:13px;font-weight:500;color:var(--t1);line-height:1.35;margin-bottom:6px;">No capabilities will be created</div>'
          +'<div style="font-size:11px;color:var(--t3);line-height:1.6;">This conversation hasn\'t identified any new capabilities yet. Finalizing now will lock the brief but won\'t create anything in Capability Canvas.</div>'
        +'</div>'
      +'</div>'
      +'<div style="padding:10px 20px 16px;display:flex;justify-content:flex-end;gap:6px;">'
        +'<button style="background:none;color:var(--t2);border:1px solid var(--divider);border-radius:5px;padding:5px 14px;font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer;" onclick="document.getElementById(\''+overlayId+'\').remove()">Keep Drafting</button>'
        +'<button style="background:#BA7517;color:#fff;border:none;border-radius:5px;padding:5px 14px;font-size:11px;font-weight:700;font-family:var(--font);cursor:pointer;" onclick="raFinalizeWithAssumptions(\''+conv.id+'\',\''+overlayId+'\')">Finalize Anyway</button>'
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
// Capability bucketing (QA issue #10) — resolve a new capability's target
// metric/process area against the REAL Discovery Map tree first, only
// falling back to a Custom Value Stage bucket when no existing metric
// genuinely fits. Confirmed root cause of the pre-fix behavior: every RA-
// created capability landed in the generic Custom Value Stage bucket
// unconditionally, with no attempt at matching — contradicting this
// redesign's own §1 value-chain diagram ("correctly bucketed under their
// metric/process area").
// ══════════════════════════════════════════════════════════════════════════

// Exact (case-insensitive, trimmed) name match against every metric/
// process area already in gData.stages[].l1_metrics[] — the same tree
// Discovery Map itself renders from, so a match here is guaranteed to be
// a REAL existing metric, not a guess. Creates the capStore entry for that
// metric on first use if it doesn't exist yet (a metric can exist in
// gData without ever having a capStore entry, e.g. no capabilities
// generated for it yet).
function _raResolveExistingMetricBucket(bucketMetricName){
  if(!bucketMetricName||typeof gData==='undefined'||!gData||!Array.isArray(gData.stages))return null;
  var needle=bucketMetricName.trim().toLowerCase();
  var found=null;
  gData.stages.forEach(function(st){
    if(found)return;
    (st.l1_metrics||[]).forEach(function(m){
      if(found)return;
      if(m&&m.name&&m.name.trim().toLowerCase()===needle){
        var mk=(typeof ccMetricKey==='function')?ccMetricKey(st.id,m.name):(st.id+'||'+m.name);
        found={metricKey:mk,stageId:st.id,stageLabel:st.label,metricName:m.name};
      }
    });
  });
  // Fallback within this same "existing" match: the AI can reasonably name
  // a whole value chain STAGE rather than one specific metric/process area
  // under it, when a capability is genuinely cross-cutting (spans several
  // process areas within that stage). Confirmed live: without this, such a
  // capability fell through to the custom-bucket path and got a NEW bucket
  // that happened to share the stage's exact name — confusing, and not the
  // "correctly bucketed under an existing value chain stage" outcome this
  // fix is for. Resolve a stage-label match to that stage's FIRST listed
  // metric/process area, deterministically.
  if(!found){
    gData.stages.forEach(function(st){
      if(found)return;
      if(st&&st.label&&st.label.trim().toLowerCase()===needle&&(st.l1_metrics||[]).length){
        var m0=st.l1_metrics[0];
        var mk0=(typeof ccMetricKey==='function')?ccMetricKey(st.id,m0.name):(st.id+'||'+m0.name);
        found={metricKey:mk0,stageId:st.id,stageLabel:st.label,metricName:m0.name};
      }
    });
  }
  if(found&&typeof capStore!=='undefined'&&!capStore[found.metricKey]){
    capStore[found.metricKey]={metricName:found.metricName,stageLabel:found.stageLabel,stageId:found.stageId,capabilities:[]};
  }
  return found;
}
// Fallback — no existing Discovery Map metric fits. Mints a NEW, distinctly-
// named Custom Value Stage bucket for this specific proposed name (its own
// bucketId, its own l1_metrics entry) — deliberately NOT the shared
// "_isDefaultCustomMetric" catch-all bucket (getOrCreateCurrentDefaultPiBucket()),
// since that bucket exists for genuinely anonymous manual adds with no name
// proposal, and reusing it here would reproduce QA issue #11 (every
// RA-created custom-area capability showing the same generic label). Also
// writes the new l1_metrics entry into gData directly (not just capStore),
// so Discovery Map and the left nav reflect the real name immediately
// rather than waiting on the next syncPiStageFromCapStore() pass (QA
// issues #12/#13).
function _raResolveOrCreateCapabilityBucket(bucketMetricName){
  var piKey=(typeof ccPIKey==='function')?ccPIKey(bucketMetricName):('pi||'+bucketMetricName.toLowerCase().replace(/[^a-z0-9]+/g,'_'));
  if(typeof capStore!=='undefined'&&capStore[piKey]){
    return {metricKey:piKey,stageLabel:capStore[piKey].stageLabel,metricName:capStore[piKey].metricName};
  }
  var piStageLabel=(typeof getPiStageLabel==='function')?getPiStageLabel(gData):'Custom Value Stage';
  var newBucketId=(typeof makeBucketId==='function')?makeBucketId():('bkt_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8));
  if(typeof gData!=='undefined'&&gData){
    if(!Array.isArray(gData.stages))gData.stages=[];
    var piStage=gData.stages.filter(function(s){return s&&s.id==='pi';})[0];
    if(!piStage){
      piStage={id:'pi',label:piStageLabel,description:'Capabilities that don\'t map to an existing Discovery Map metric or process area.',l1_metrics:[]};
      gData.stages.push(piStage);
    }
    if(!Array.isArray(piStage.l1_metrics))piStage.l1_metrics=[];
    piStage.l1_metrics.push({name:bucketMetricName,why:'Proposed by Requirement Agent — no existing Discovery Map metric or process area fit this capability.',bucketId:newBucketId});
  }
  if(typeof capStore!=='undefined'){
    capStore[piKey]={metricName:bucketMetricName,stageLabel:piStageLabel,stageId:'pi',bucketId:newBucketId,_piFirst:true,capabilities:[]};
  }
  return {metricKey:piKey,stageLabel:piStageLabel,metricName:bucketMetricName};
}

// ══════════════════════════════════════════════════════════════════════════
// Finalize sequence (atomic) — Discovery-First Entry Point redesign.
// Finalize now CREATES CAPABILITIES ONLY — it never generates features (that
// remains a manual, per-capability action on Capability Canvas, unchanged
// trigger/button, see ccGenerateFeaturesForCapClick()).
//   1. Resolve open questions with assumptions if needed (logged in
//      liveDraftMd, persisted — not transient chat-only). UNCHANGED.
//   2. For every isNew:true touched capability, resolve its target metric/
//      process area against the REAL Discovery Map tree first (§10 —
//      _raResolveExistingMetricBucket()), only falling back to a
//      distinctly-named Custom Value Stage bucket when no existing metric
//      fits (_raResolveOrCreateCapabilityBucket()) — never the generic
//      shared default bucket. A name match against a capability already
//      owned by a DIFFERENT conversation is treated as a distinct entity,
//      never silently reused (§14/§15/§16 provenance fix). Existing
//      (non-new) touched capabilities are left alone — nothing to create,
//      no generation to source them for anymore. Reconciles capStore into
//      gData via syncPiStageFromCapStore() synchronously right after, so
//      Capability Canvas/Discovery Map/left-nav can't drift (§12/§13).
//   3. Call ra_next_seq — this already fires at the correct point in the
//      sequence (after capability creation, confirmed via code research),
//      so no reordering was needed. NEW: immediately stamp intakeBriefId +
//      rqNumber onto every capability object created in step 2 — a
//      straightforward additive loop, not a resequencing.
//   4. Populate conv.createdCapabilityKeys with every created capability's
//      capStore key — this is what Capability Canvas's Origin-filter
//      "Requirement Agent" nested RQ sub-list reads from (§8.2).
//   5. Save per AI_EDITING_RULES.md's live-sync contract: capture
//      _activeSessionId into a local var BEFORE any async work -> mutate ->
//      sessionStoreSave() -> emit live-sync event ONLY on success.
//   6. Navigate to Capability Canvas automatically (CHANGED from Feature
//      Canvas) — CC auto-selects the first populated metric on arrival, see
//      capability-canvas.js's ccSelectFirstPopulatedMetric() (§8.1).
// ══════════════════════════════════════════════════════════════════════════
async function raRunFinalizeSequence(conv,withAssumptions){
  if(!conv||raBusy)return;
  raBusy=true;
  var btn=document.getElementById('ra-finalize-btn');
  if(btn){btn.disabled=true;btn.textContent='Finalizing...';}
  // Single guard for the whole atomic sequence — capability creation is a
  // synchronous data write (no network call except ra_next_seq), but the
  // save/emit tail still needs the same interruption guard every other
  // long-running operation in this codebase uses.
  var _finalizeSignal=(typeof startAiGen==='function')?startAiGen('Requirement Agent is finalizing this brief. Leaving now will leave the brief partially finalized.'):null;

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

    // Step 2 — create capStore entries for isNew:true touched capabilities
    // only. Existing (non-new) touched capabilities need no action here —
    // there is no feature generation left to source them for.
    var touched=conv.touchedCapabilityKeys||[];
    var newCapRefs=[]; // [{metricKey, capIdx, cap}] — capabilities THIS conversation's Finalize actually created

    touched.forEach(function(t){
      if(!t.isNew)return;
      var capNameGuess=t.name||t.key;
      var bucketMetricName=(t.bucketMetricName||'').trim();

      // §10 — resolve against a REAL existing Discovery Map metric/process
      // area first; only fall back to a (distinctly-named) Custom Value
      // Stage bucket when no existing metric fits. If the model somehow
      // returned no bucket annotation at all (malformed response), fall
      // back to proposing the capability's own name as the bucket name —
      // still better than the old silent generic-label behavior.
      var target=_raResolveExistingMetricBucket(bucketMetricName)
        ||_raResolveOrCreateCapabilityBucket(bucketMetricName||capNameGuess);
      if(!target||typeof capStore==='undefined')return;
      var entry=capStore[target.metricKey];
      if(!entry)return;

      // §14/§15/§16 — RQ provenance fix: a name match against a capability
      // already OWNED by a DIFFERENT conversation is a different entity,
      // not a reuse — the pre-fix code matched by name alone and silently
      // overwrote that other conversation's intakeBriefId/rqNumber.
      var existingIdx=entry.capabilities.findIndex(function(c){return c.name===capNameGuess;});
      var existingCap=existingIdx>=0?entry.capabilities[existingIdx]:null;
      var ownedByOther=!!(existingCap&&existingCap.intakeBriefId&&existingCap.intakeBriefId!==conv.id);
      var capObj;
      if(existingCap&&!ownedByOther){
        capObj=existingCap; // same conversation touching it again, or not yet owned by anyone — safe to reuse
      } else {
        // QA issue #1 — use the actual descriptive bullet(s) the model wrote
        // under this capability's own sub-heading (t.description, parsed by
        // _raParseTouchedCapabilities()) as .why, falling back to a generic
        // placeholder only if the model genuinely wrote nothing (shouldn't
        // happen per the section-content rules, but never leave .why empty).
        capObj={name:capNameGuess,why:t.description||'Created by Requirement Agent for this release.',subCaps:null,features:[],_manual:true};
        entry.capabilities.push(capObj);
      }
      newCapRefs.push({metricKey:target.metricKey,capIdx:entry.capabilities.indexOf(capObj),cap:capObj});
    });

    // §12/§13 — reconcile capStore's bucket metric names into Discovery
    // Map's own tree immediately, synchronously, regardless of whether a
    // session save happens below. Confirmed root cause of the pre-fix
    // "CC shows one name, DM/left-nav show another until refresh" bug:
    // this sync previously only ran as an indirect side effect of
    // sessionStoreSave(), which never fires at all for sessions with no
    // active saveSessionId (demo/local).
    if(typeof syncPiStageFromCapStore==='function'&&typeof gData!=='undefined'&&typeof capStore!=='undefined'){
      syncPiStageFromCapStore(gData,capStore);
    }

    // Step 3 — assign the RQ number. Confirmed via code research: this
    // already fires after capability creation (step 2), which is exactly
    // the ordering needed to stamp intakeBriefId/rqNumber onto the newly
    // created capabilities below — no reorder required.
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

    // Stamp intakeBriefId + rqNumber onto every capability created in step
    // 2 — additive only, no feature generation, no scCanvas push (§5.2,§7).
    newCapRefs.forEach(function(ref){
      ref.cap.intakeBriefId=conv.id;
      ref.cap.rqNumber=rqLabel;
    });
    conv.createdCapabilityKeys=newCapRefs.map(function(ref){return ref.metricKey+'|'+ref.capIdx;});

    // Signal Capability Canvas's tab badge/pending indicator — mirrors the
    // existing markTabPending() convention used elsewhere for "new content
    // arrived on a tab you're not currently viewing."
    if(typeof markTabPending==='function')markTabPending('cc');

    // Mark conversation finalized as part of the SAME save.
    conv.status='finalized';
    conv.rqNumber=rqLabel;
    conv.updatedAt=new Date().toISOString();

    // Step 5 — persist per the live-sync save/emit contract.
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
      conv.createdCapabilityKeys=[];
      raBusy=false;
      if(btn){btn.disabled=false;btn.textContent='Finalize';}
      raRenderLiveDraft();
      return;
    }

    if(wasSharedSession&&typeof _lsEmitContentEvent==='function'){
      try{
        _lsEmitContentEvent(saveSessionId,'cc','capabilities_generated',null,null);
      }catch(emitErr){
        console.warn('Event emission failed (save already succeeded):',emitErr);
      }
    }

    raRenderConvList();
    raRenderLiveDraft();

    // End the nav-in-flight guard BEFORE this function's own automatic
    // navigation below — switchTab() itself checks aiGenInFlight.active via
    // blockIfGenerating(), so leaving the guard up here would make Finalize's
    // own auto-navigate step trip its own "Hold on, don't lose this"
    // confirmation on itself. Same ordering requirement as the pre-redesign
    // switchTab('fc') call site — re-verified to still hold for 'cc'.
    raBusy=false;
    if(typeof endAiGen==='function')endAiGen();
    if(btn){btn.disabled=false;btn.textContent='Finalize';}

    // Step 6 — navigate to Capability Canvas automatically, no intermediate
    // "continue" link. Capability creation (step 2) is already complete and
    // saved by this point, so CC's arrival auto-select-first-metric helper
    // finds real data the instant it runs.
    var tabCc=document.getElementById('tab-cc');
    if(tabCc)tabCc.classList.remove('data-home-hidden');
    if(tabCc)tabCc.style.display='';
    switchTab('cc');
    if(typeof ccSelectFirstPopulatedMetric==='function')ccSelectFirstPopulatedMetric();
  } finally {
    raBusy=false;
    if(typeof endAiGen==='function')endAiGen();
    if(btn){btn.disabled=false;btn.textContent='Finalize';}
  }
}

// Persistence — same optimistic pattern glMessages/glDraftMd use via
// _glPersistMessage()/_glPersistDraft(): mutate the live global first (every
// function above already did that before calling this), then save.
// v14 code-review fix — returns a real boolean instead of resolving to
// undefined regardless of outcome (which every caller that awaits this and
// then proceeds was silently treating as "it worked"). No active session to
// persist against (e.g. demo/local mode) is NOT a failure — there's
// genuinely nothing to save, so that resolves true. A real save attempt
// that returns false or throws resolves false — callers that await this
// must check the result and not proceed as if nothing went wrong.
async function _raPersist(){
  if(typeof sessionStoreSave!=='function'||typeof _activeSessionId==='undefined'||!_activeSessionId)return true;
  try{
    var ok=await sessionStoreSave(_activeSessionId);
    if(!ok)console.warn('[requirement-agent] persist failed — sessionStoreSave returned false');
    return !!ok;
  }catch(err){
    console.warn('[requirement-agent] persist failed',err);
    return false;
  }
}
