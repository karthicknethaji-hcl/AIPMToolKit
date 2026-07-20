// ── Custom Process Area / Custom Metric bucket management (v9.05) ──
// Bridges capStore['pi||'+capName] entries (Capability Canvas's existing
// storage for manually-added capabilities tagged to "Custom Process Area"/
// "Custom Metric") to Discovery Map's gData.stages[] array, so custom
// capabilities become visible in Discovery Map as a "Custom Value Stage"
// (internal stageId:'pi', displayed as "Custom Value Stage" per the existing
// FC/SC/CC relabeling convention already in place for stage==='PI Plan').
//
// KEY DESIGN INVARIANT: capStore's key format ('pi||'+capName) is NEVER
// changed — 24 existing call sites across capability-canvas.js and
// feature-canvas.js depend on the literal 'pi||' string prefix. This file
// adds a NEW field (bucketId) to each capStore entry's VALUE, additively.
// bucketId is the sole identity for "which custom process area/metric does
// this capability belong to" — metricName is cosmetic/display-only and is
// never used for grouping or lookup.
//
// Multiple independent buckets can coexist under the 'pi' stage (e.g. user
// renames "Custom Process Area" to "A/B Testing", then adds a NEW capability
// choosing "Custom Process Area" again — this creates a SECOND, independent
// bucket alongside "A/B Testing", both visible under Custom Value Stage).

const PI_BUCKET_LEGACY_ID='pi-bucket-legacy-default';

// ── ID generation ──
function makeBucketId(){
  if(typeof crypto!=='undefined'&&crypto&&typeof crypto.randomUUID==='function'){
    return 'pi-bucket-'+crypto.randomUUID();
  }
  return 'pi-bucket-'+Date.now()+'-'+Math.random().toString(36).slice(2);
}

// ── Ownership check — null/type-safe ──
// Used by cascade/cleanup logic instead of label-substring matching (which
// never matches 'pi||' keys — confirmed via code read: capStore keys under
// the pi stage are 'pi||'+capName, and stageExecuteCascade()'s existing
// `k.includes('||'+stageLabel)` check for stageLabel='PI Plan' looks for the
// substring '||PI Plan', which never appears in a 'pi||'+capName key).
function isPiCapEntry(key,entry){
  if(!entry||typeof entry!=='object')return false;
  if(typeof key==='string'&&key.indexOf('pi||')===0)return true;
  return entry.stageId==='pi';
}

// ── Current label resolver (v9.06.01) ──
// Returns whatever the pi stage's label CURRENTLY is — never hardcodes a
// default. This is the fix for the "old session split" risk found in
// ChatGPT's round-3 review: a capability added to an OLD session (still
// labeled 'PI Plan', not yet migrated) must inherit THAT label, not a
// hardcoded 'Custom Value Stage' string, or the session would end up with
// two different label strings describing one conceptual stage.
// Only sessions with no pi stage yet (brand new) get the literal default.
function getPiStageLabel(gDataRef){
  var g=gDataRef||(typeof gData!=='undefined'?gData:null);
  if(g&&Array.isArray(g.stages)){
    var piStage=g.stages.find(function(s){return s&&s.id==='pi';});
    if(piStage&&piStage.label)return piStage.label;
  }
  return 'Custom Value Stage';
}

// ── Stage display-label helper (v9.06.02) ──
// Per ChatGPT round-2 review: centralizes the "exact legacy literal ->
// new default" display guard into ONE function, used everywhere a stage
// label is rendered — replacing an unconditional override bug
// (`st.id==='pi' ? 'Custom Value Stage' : ...`) that ignored ANY actual
// user rename, always showing the hardcoded literal regardless of what
// st.label actually contained.
//
// This is DISPLAY-ONLY and narrow: it overrides ONLY the exact legacy
// literal 'PI Plan' (for defense-in-depth against sessions that haven't
// gone through migratePiStageLegacyLabel() yet — e.g. a session held in
// memory across a deploy). It NEVER overrides an actual user-chosen
// rename. Migration (actually rewriting st.label in the data) stays
// entirely separate, run only at controlled data-ingress points
// (session load, live-sync apply) — never inside a render path, since
// render-triggered mutation risks a lost-update in a shared session.
function ccGetStageDisplayLabel(st){
  if(!st)return '';
  var label=(typeof st.label==='string')?st.label:'';
  if(st.id==='pi'&&label==='PI Plan')return 'Custom Value Stage';
  return label||st.id||'';
}

// ── Legacy label migration (v9.06.01) ──
// Narrowly migrates ONLY the exact legacy literal 'PI Plan' to the new
// default 'Custom Value Stage' — never touches a label a user has already
// customized to something else. Also patches every downstream field that
// would otherwise go stale (capStore.stageLabel, scCanvas.stage,
// productLeakAnalysis label references), mirroring what a manual rename
// via stageRenameDownstream() already does for the pi stage specifically.
// Safe to call on every session load — no-ops instantly if already migrated
// or if the label was already customized away from the legacy literal.
function migratePiStageLegacyLabel(gDataRef,capStoreRef,scCanvasRef,productLeakAnalysisRef){
  var g=gDataRef||(typeof gData!=='undefined'?gData:null);
  if(!g||!Array.isArray(g.stages))return;
  var piStage=g.stages.find(function(s){return s&&s.id==='pi';});
  if(!piStage||piStage.label!=='PI Plan')return; // not legacy, or no pi stage — nothing to do

  var newLabel='Custom Value Stage';
  piStage.label=newLabel;

  var cs=capStoreRef||(typeof capStore!=='undefined'?capStore:null);
  if(cs){
    Object.keys(cs).forEach(function(k){
      var entry=cs[k];
      if(entry&&isPiCapEntry(k,entry)){
        entry.stageLabel=newLabel;
      }
    });
  }

  var sc=scCanvasRef||(typeof scCanvas!=='undefined'?scCanvas:null);
  if(Array.isArray(sc)){
    sc.forEach(function(f){
      if(f&&f.stage==='PI Plan')f.stage=newLabel;
    });
  }

  var pla=productLeakAnalysisRef||(typeof productLeakAnalysis!=='undefined'?productLeakAnalysis:null);
  if(Array.isArray(pla)){
    pla.forEach(function(run){
      if(run&&run.leakingStage==='PI Plan')run.leakingStage=newLabel;
      (run&&run.experiments||[]).forEach(function(exp){
        if(exp&&exp.lifecycleStage==='PI Plan')exp.lifecycleStage=newLabel;
      });
    });
  }
}

// ── PASSIVE normalizer ──
// Safe to call anytime, anywhere, as often as needed. Derives/heals
// gData.stages' 'pi' entry and its l1_metrics[] FROM capStore's existing
// bucketId values. Never invents an empty bucket on its own — only reflects
// what already exists in capStore. This is what makes bucket deletion
// self-enforcing (Blocker 6, ChatGPT round 2): once every capStore entry for
// a bucketId is removed, the next call to this function simply won't
// recreate that l1_metrics entry, because nothing in capStore references it
// anymore. No tombstone or version-check needed.
//
// Also backfills legacy capStore['pi||'+X] entries (created before this
// feature shipped, so missing a bucketId field) into a single DETERMINISTIC
// bucket id (PI_BUCKET_LEGACY_ID) — deterministic so two collaborators
// opening the same legacy session independently converge on the same
// bucket rather than forking into separate ones.
//
// Call sites (all safe/idempotent to call from):
//  - session-store.js's _ssApplySnapshotFields() (session load/restore)
//  - kpi-tree.js's generateConfirmed() (full AI regeneration)
//  - live-sync.js's receiver-side CC event apply path
//  - every capability-canvas.js call site that writes a 'pi||' entry (belt
//    and suspenders — also called from live-sync/session-load, so calling
//    it again locally after a direct write is a safe no-op if nothing
//    changed since the last call)
function syncPiStageFromCapStore(gDataRef,capStoreRef){
  if(!gDataRef||!Array.isArray(gDataRef.stages))return;
  if(!capStoreRef||typeof capStoreRef!=='object')return;

  // 1. Backfill legacy entries missing bucketId (deterministic legacy bucket)
  var hasLegacyEntries=false;
  Object.keys(capStoreRef).forEach(function(k){
    if(k.indexOf('pi||')!==0)return;
    var entry=capStoreRef[k];
    if(!entry||typeof entry!=='object')return;
    if(!entry.bucketId){
      entry.bucketId=PI_BUCKET_LEGACY_ID;
      if(!entry.metricName)entry.metricName='Custom Process Area';
      if(!entry.stageId)entry.stageId='pi';
      if(!entry.stageLabel)entry.stageLabel='PI Plan';
      hasLegacyEntries=true;
    }
  });

  // 2. Collect distinct bucketIds actually present in capStore right now
  var bucketIdsInUse={};
  var bucketDisplayNames={};
  Object.keys(capStoreRef).forEach(function(k){
    if(!isPiCapEntry(k,capStoreRef[k]))return;
    var entry=capStoreRef[k];
    if(!entry.bucketId)return; // shouldn't happen post-backfill, but guard anyway
    bucketIdsInUse[entry.bucketId]=true;
    if(!bucketDisplayNames[entry.bucketId]&&entry.metricName){
      bucketDisplayNames[entry.bucketId]=entry.metricName;
    }
  });

  var bucketIdList=Object.keys(bucketIdsInUse);
  // v9.06.01 fix: the early return here used to skip ALL cleanup (steps
  // 3-7) whenever capStore had zero pi|| entries — but that's exactly the
  // scenario where an EXISTING stale pi stage (from before the last
  // capability was deleted) needs its cleanup to run, so it gets removed.
  // Confirmed via direct test: deleting the only bucket's capabilities left
  // the stage behind forever without this fix. Only truly skip if there's
  // ALSO no existing pi stage to clean up.
  if(bucketIdList.length===0){
    var _existingPiStage=gDataRef.stages.find(function(s){return s&&s.id==='pi';});
    if(!_existingPiStage)return; // genuinely nothing to do — no stage, no buckets
    // fall through to cleanup below, which will correctly empty and remove it
  }

  // 3. Find or create the 'pi' stage — identity is stageId==='pi', ALWAYS,
  //    regardless of label (label is never re-evaluated as an existence
  //    check — this avoids the duplicate-stage risk flagged in review).
  var piStage=null;
  for(var i=0;i<gDataRef.stages.length;i++){
    if(gDataRef.stages[i]&&gDataRef.stages[i].id==='pi'){piStage=gDataRef.stages[i];break;}
  }
  if(!piStage){
    piStage={
      id:'pi',
      label:'Custom Value Stage', // v9.06.01: new default (was 'PI Plan') — see getPiStageLabel()/migratePiStageLegacyLabel() for how existing old-labeled sessions are handled
      description:'Captures process areas and capabilities added directly in Capability Canvas, outside the AI-generated stages above.',
      l1_metrics:[]
    };
    gDataRef.stages.push(piStage);
  }
  if(!Array.isArray(piStage.l1_metrics))piStage.l1_metrics=[];

  // 4. Dedupe: if multiple l1_metrics entries somehow share the same
  //    bucketId (e.g. from a prior bug or a malformed import), collapse to
  //    the first one found, keep its name/why, drop the rest.
  var seenBucketIds={};
  piStage.l1_metrics=piStage.l1_metrics.filter(function(l1){
    if(!l1||!l1.bucketId)return true; // non-bucket l1_metrics entries (shouldn't exist on pi stage, but don't destroy unknown data)
    if(seenBucketIds[l1.bucketId])return false; // drop duplicate
    seenBucketIds[l1.bucketId]=true;
    return true;
  });

  // 5. Ensure exactly one l1_metrics entry per bucketId currently in capStore
  bucketIdList.forEach(function(bucketId){
    var existing=piStage.l1_metrics.find(function(l1){return l1&&l1.bucketId===bucketId;});
    if(existing)return; // already represented
    var isLegacy=(bucketId===PI_BUCKET_LEGACY_ID);
    piStage.l1_metrics.push({
      name:bucketDisplayNames[bucketId]||'Custom Process Area',
      why:'Auto-created bucket for capabilities added outside your mapped process areas.',
      bucketId:bucketId,
      _isDefaultCustomMetric:isLegacy?true:false // legacy bucket treated as the current default on first migration
    });
  });

  // 6. Remove l1_metrics entries for bucketIds no longer present in capStore
  //    (i.e., every capability under that bucket was deleted — the bucket
  //    itself disappears too, self-enforcing deletion with no tombstone).
  piStage.l1_metrics=piStage.l1_metrics.filter(function(l1){
    if(!l1||!l1.bucketId)return true;
    return !!bucketIdsInUse[l1.bucketId];
  });

  // 7. If the whole pi stage ended up with zero l1_metrics (all buckets
  //    deleted), remove the stage entirely too — nothing left to show.
  if(piStage.l1_metrics.length===0){
    var _idx=gDataRef.stages.indexOf(piStage);
    if(_idx>=0)gDataRef.stages.splice(_idx,1);
  }
}

// ── ACTIVE bucket resolver ──
// Called ONLY when the user explicitly adds a new capability and chooses
// "Custom Process Area"/"Custom Metric". Finds the current default bucket
// (the one not yet renamed away from its auto-generated name) or creates a
// fresh one if none exists / the previous default was renamed (freeing that
// role for reuse — this is the confirmed, intentional multi-bucket design:
// renaming clears _isDefaultCustomMetric, so a LATER explicit "Custom
// Process Area" selection creates a genuinely new, independent bucket
// alongside the renamed one).
//
// Returns the bucketId to use for the new capStore entry being created.
function getOrCreateCurrentDefaultPiBucket(gDataRef,capStoreRef){
  if(!gDataRef)return null;
  if(!Array.isArray(gDataRef.stages))gDataRef.stages=[];

  var piStage=null;
  for(var i=0;i<gDataRef.stages.length;i++){
    if(gDataRef.stages[i]&&gDataRef.stages[i].id==='pi'){piStage=gDataRef.stages[i];break;}
  }
  if(!piStage){
    piStage={
      id:'pi',
      label:'Custom Value Stage', // v9.06.01: new default (was 'PI Plan')
      description:'Captures process areas and capabilities added directly in Capability Canvas, outside the AI-generated stages above.',
      l1_metrics:[]
    };
    gDataRef.stages.push(piStage);
  }
  if(!Array.isArray(piStage.l1_metrics))piStage.l1_metrics=[];

  var defaultEntry=piStage.l1_metrics.find(function(l1){return l1&&l1._isDefaultCustomMetric===true;});
  if(defaultEntry)return defaultEntry.bucketId;

  var newBucketId=makeBucketId();
  var isCapMode=(gDataRef&&gDataRef.approach==='capability-based');
  piStage.l1_metrics.push({
    name:isCapMode?'Custom Process Area':'Custom Metric',
    why:'Auto-created bucket for capabilities added outside your mapped process areas.',
    bucketId:newBucketId,
    _isDefaultCustomMetric:true
  });
  return newBucketId;
}

// ── Dedicated bucket rename (NOT the general capability-rename path) ──
// Renaming the l1_metrics entry representing a Custom Process Area/Metric
// bucket must NOT go through confirmEditCapability()'s generic single-key
// re-keying logic — that logic assumes exactly one capStore entry maps to
// one l1_metrics entry, which is false here (many capStore['pi||'+capName]
// entries can share the same bucketId). This function instead:
//   1. Updates the l1_metrics entry's display name/description directly
//   2. Clears _isDefaultCustomMetric (freeing the "default" role so a
//      future fresh "Custom Process Area" selection creates a new,
//      independent bucket alongside this renamed one)
//   3. Propagates the new display name to every capStore entry sharing this
//      bucketId's metricName field (display-only denormalized cache — NOT
//      a capStore key change, no re-keying, capability names/keys untouched)
function piBucketRename(stageIdx,l1Idx,newName,newDesc){
  if(!gData||!gData.stages[stageIdx])return false;
  var stage=gData.stages[stageIdx];
  if(stage.id!=='pi')return false; // guard — this function is ONLY for pi-stage buckets
  if(!Array.isArray(stage.l1_metrics)||!stage.l1_metrics[l1Idx])return false;
  var l1=stage.l1_metrics[l1Idx];
  var bucketId=l1.bucketId;
  if(!bucketId)return false;

  // v9.06.02: capture the OLD name BEFORE mutating l1.name — needed below
  // to scope the downstream-feature patch correctly.
  var oldName=l1.name;
  var curStageLabel=stage.label; // current stage label (e.g. 'Custom Value Stage' or a user rename) — features under this bucket always match on THIS current label, not any prior one

  l1.name=newName;
  l1.why=newDesc||'';
  l1._isDefaultCustomMetric=false; // renaming always retires default status

  // Propagate display name to every capStore entry sharing this bucketId
  if(typeof capStore!=='undefined'&&capStore){
    Object.keys(capStore).forEach(function(k){
      var entry=capStore[k];
      if(entry&&entry.bucketId===bucketId){
        entry.metricName=newName;
      }
    });
  }

  // v9.06.02: propagate the rename to downstream features already placed
  // on Story/Feature Canvas — these independently store their own copy
  // of the process-area name (f.metric) plus a separately pre-computed
  // hierarchy path (f.metricPath), neither of which piBucketRename()
  // previously touched, leaving them permanently stale after any rename.
  //
  // IDENTITY PRIORITY (per ChatGPT adversarial review): prefer
  // f.originBucketId===bucketId (durable, unambiguous — available on any
  // feature created after this hardening shipped) over the stage+name
  // fallback (approximate, used only for older features that predate
  // the originBucketId field). NEVER match by name alone — that risks
  // cross-contaminating an unrelated KPI-linked feature sharing the same
  // name by coincidence, or a DIFFERENT bucket independently renamed TO
  // this bucket's old name at an earlier point.
  //
  // Executed synchronously, immediately, as part of this same call —
  // never deferred — so there is no window for a second, unrelated
  // rename to occur in between and create a stale-name collision.
  if(typeof scCanvas!=='undefined'&&Array.isArray(scCanvas)&&oldName!==newName){
    scCanvas.forEach(function(f){
      if(!f)return;
      var _matchesById=(f.originBucketId&&f.originBucketId===bucketId);
      var _matchesByStageAndName=(!f.originBucketId&&f.stage===curStageLabel&&f.metric===oldName);
      if(_matchesById||_matchesByStageAndName){
        f.metric=newName;
        if(typeof scGetMetricPath==='function'){
          // Re-derive fresh from the (already-updated) l1.name — this is
          // a lookup BY NAME against gData, safe here specifically
          // because it runs AFTER l1.name is already set to newName,
          // so it correctly finds the JUST-RENAMED bucket, not a stale
          // stand-in. (General duplicate-name ambiguity in
          // scGetMetricPath() itself is a pre-existing, separate
          // characteristic of that function, not something this call
          // introduces or can fix locally here.)
          f.metricPath=scGetMetricPath(newName);
        }
      }
    });
  }

  return true;
}

// ── Dedicated bucket delete ──
// Deletes every capStore entry sharing the given bucketId. The l1_metrics
// entry itself is NOT explicitly removed here — the next call to
// syncPiStageFromCapStore() will naturally drop it, since no capStore entry
// will reference that bucketId anymore (self-enforcing deletion, no
// tombstone needed — see syncPiStageFromCapStore()'s step 6).
function piBucketDelete(bucketId){
  if(!bucketId||typeof capStore==='undefined'||!capStore)return {deletedCount:0};
  var deletedCount=0;
  Object.keys(capStore).forEach(function(k){
    var entry=capStore[k];
    if(entry&&entry.bucketId===bucketId){
      delete capStore[k];
      deletedCount++;
    }
  });
  return {deletedCount:deletedCount};
}

// ── Shared identity resolver + materialized card model (v9.06.02) ──
// Per ChatGPT adversarial review: this consolidates the "merge multiple
// capStore entries sharing one bucketId into a single virtual group"
// logic into ONE place, used by BOTH ccRenderAllCaps() and
// ccRenderMainContent() — rather than duplicating this pattern a second
// time, which risks the exact "forgot one call site" bug class already
// seen in this project.
//
// Returns a fully MATERIALIZED structure — every card object already
// carries its own resolved real key/index directly. Render code should
// never re-derive identity itself; it just consumes card.realKey/
// card.realIdx.
//
// Input `keyOrBucket`:
//   - a real capStore key (ordinary KPI-linked metric, or a single
//     un-bucketed legacy pi capability) — returns a single-entry group
//   - a bucket-tagged value 'bucket:<bucketId>' — returns the MERGED
//     group for that bucket, scanning all capStore keys sharing it
//   - null/undefined — returns null (caller should treat as "no
//     selection", i.e. show the all-capabilities grid instead)
//
// Shape returned:
// {
//   groupLabel, stageLabel, stageId, isBucket, bucketId,
//   cards: [{ cap, realKey, realIdx, cardSelectionKey, domSafeId }]
// }
function ccResolveCapGroup(keyOrBucket){
  if(!keyOrBucket)return null;
  if(typeof capStore==='undefined'||!capStore)return null;

  if(typeof keyOrBucket==='string'&&keyOrBucket.indexOf('bucket:')===0){
    var bucketId=keyOrBucket.slice('bucket:'.length);
    var cards=[];
    var groupLabel='Custom Process Area';
    var stageLabelOut='';
    Object.keys(capStore).forEach(function(k){
      var entry=capStore[k];
      if(entry&&entry.bucketId===bucketId){
        if(entry.metricName)groupLabel=entry.metricName;
        if(entry.stageLabel)stageLabelOut=entry.stageLabel;
        (entry.capabilities||[]).forEach(function(cap,idx){
          cards.push({
            cap:cap,
            realKey:k,
            realIdx:idx,
            cardSelectionKey:k+'|'+idx,
            domSafeId:'cc-cap-'+k.replace(/[^a-z0-9|]/gi,'_')+'-'+idx
          });
        });
      }
    });
    if(cards.length===0)return null; // bucket empty/deleted — caller should clear selection
    return {
      groupLabel:groupLabel,
      stageLabel:stageLabelOut||(typeof getPiStageLabel==='function'?getPiStageLabel(typeof gData!=='undefined'?gData:null):'Custom Value Stage'),
      stageId:'pi',
      isBucket:true,
      bucketId:bucketId,
      cards:cards
    };
  }

  // Ordinary capStore key (KPI-linked metric, or single legacy pi capability)
  var entry=capStore[keyOrBucket];
  if(!entry)return null;
  var cards2=(entry.capabilities||[]).map(function(cap,idx){
    return {
      cap:cap,
      realKey:keyOrBucket,
      realIdx:idx,
      cardSelectionKey:keyOrBucket+'|'+idx,
      domSafeId:'cc-cap-'+keyOrBucket.replace(/[^a-z0-9|]/gi,'_')+'-'+idx
    };
  });
  return {
    groupLabel:entry.metricName||'',
    stageLabel:entry.stageLabel||'',
    stageId:entry.stageId||'',
    isBucket:false,
    bucketId:entry.bucketId||null,
    cards:cards2
  };
}

// ── Shared dropdown value parser (v9.06.01) ──
// Used by all 3 confirm handlers (add capability, bulk upload, edit-
// capability reassignment) so they interpret a selected dropdown value
// identically, rather than three slightly different branches drifting
// apart over time (per ChatGPT round-3 recommendation).
//
// Value formats:
//   "pi"                — generic default (permanent first option, always
//                          resolves to "the current default bucket")
//   "bucket:<bucketId>"  — a specific, already-existing bucket, structurally
//                          distinguishable by the colon (never collides with
//                          an ordinary KPI metricKey, which is always
//                          stageId+'||'+metricName — no colon ever appears
//                          in that format)
//   anything else        — an ordinary KPI-linked metricKey, unchanged
function parsePiDropdownValue(value){
  if(value==='pi')return {type:'pi-default'};
  if(typeof value==='string'&&value.indexOf('bucket:')===0){
    return {type:'pi-bucket',bucketId:value.slice('bucket:'.length)};
  }
  return {type:'metric-key',metricKey:value};
}

// ── Shared dropdown options builder (v9.06.01) ──
// Returns an HTML string of <option> tags: the permanent generic "pi"
// option FIRST (unchanged per product decision), followed by one option
// per individual existing bucket (using the bucket: tagged value format),
// sorted alongside KPI metrics alphabetically by the CALLER (this function
// only builds the bucket-specific options segment — callers combine it
// with their own KPI metric options exactly as before).
// selectedValue: the currently-selected raw dropdown value (for marking
// the right <option> as selected).
function piBuildBucketDropdownOptions(gDataRef,selectedValue){
  var g=gDataRef||(typeof gData!=='undefined'?gData:null);
  if(!g||!Array.isArray(g.stages))return '';
  var piStage=g.stages.find(function(s){return s&&s.id==='pi';});
  if(!piStage||!Array.isArray(piStage.l1_metrics)||piStage.l1_metrics.length===0)return '';

  // Disambiguate duplicate display names with a capability-count suffix
  // (ChatGPT round-3 finding — name alone isn't a reliable identifier).
  var nameCounts={};
  piStage.l1_metrics.forEach(function(l1){
    if(!l1||!l1.bucketId)return;
    var nm=l1.name||'Custom Process Area';
    nameCounts[nm]=(nameCounts[nm]||0)+1;
  });

  var html='';
  piStage.l1_metrics.forEach(function(l1){
    if(!l1||!l1.bucketId)return;
    var nm=l1.name||'Custom Process Area';
    var capCount=0;
    if(typeof capStore!=='undefined'&&capStore){
      Object.keys(capStore).forEach(function(k){
        var entry=capStore[k];
        if(entry&&entry.bucketId===l1.bucketId)capCount+=(entry.capabilities||[]).length;
      });
    }
    var dispName=nameCounts[nm]>1?(nm+' ('+capCount+' cap'+(capCount!==1?'s':'')+')'):nm;
    var val='bucket:'+l1.bucketId;
    var sel=(selectedValue===val)?' selected':'';
    html+='<option value="'+val.replace(/"/g,'&quot;')+'"'+sel+'>'+
      dispName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')+
      '</option>';
  });
  return html;
}
