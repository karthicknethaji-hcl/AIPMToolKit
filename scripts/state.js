let curTab='home', gData=null, ltimer=null, ddLtimer=null, ddGenerated=false, settingsOpen=false;

// ── AI GENERATION GUARD ──
// Set immediately before any callAPI() invocation, cleared in finally.
// active: true while an AI generation is in flight
// what: human-readable "what's cooking" copy shown in the leave-confirmation modal
// controller: AbortController for the in-flight fetch, aborted if user chooses "Leave anyway"
let aiGenInFlight={active:false,what:'',controller:null};

// ── SESSION CONTEXT ──
// Snapshot captured at Launch Session click. Frozen for the duration of the session.
// Written by homeLaunch() and homeLoadDemo() in home.js.
// All prompt builders will read from sessionContext in Step 7 (prompt injection).
// Schema: { companyProfile{}, productProfile{}, approach, generationMode, manualList[],
//           allowAISuggestions, customValueChain, additionalContext, marketIntelligence,
//           sessionDocs[], launchedAt }
// approach: 'outcome-based' | 'capability-based'
// generationMode: 'ai-generated' | 'manual'
// manualList: [{name, description}] — populated when generationMode==='manual' (Home file upload)
// allowAISuggestions: bool — when true, AI may add extra capabilities to a manual list (tagged distinctly in DM)
// gData.stages[].l1_metrics[] entries may carry _aiSuggested:true (v7.83) when generationMode==='manual'
// and allowAISuggestions was true — rendered with an "AI suggested" badge in renderMM (kpi-tree.js)
let sessionContext=null;

// ── SESSION ACTIVE ──
// Set true on Launch Session or Load Demo. Reset on homeClearSession() or clearDemoMode().
// Guards the re-launch confirmation dialog (ST-11).
let sessionActive=false;
const seg={industry:'Technology & Software',productType:'B2C Product'};

// ── APP SETTINGS ──
// Single source of truth for all admin-configurable values.
// Populated from the settings page on Save. Defaults match previous hardcoded values.
// v6.76 will wire these into prompts and PI planning defaults.
const appSettings={
  // Section 1 — API & Access
  model:'optimized',
  // Section 2 — Feature Modules
  featDD:true,
  featCap:true,   // always true — core workflow, not user-configurable
  featDiag:true,
  featMI:false,   // default OFF — adds cost to every KPI tree run
  featPI:true,
  // Section 3 — Output Depth (wired into prompts in v6.76)
  maxCaps:4,
  includeSubCaps:false,
  maxFeatures:5,
  maxStories:5,
  maxACs:3,
  kpiDepth:1,
  // Section 4 — PI Planning Defaults (wired into pi-planning.js in v6.76)
  defaultSprints:6,
  defaultSprintDur:2,     // weeks
  defaultSquadName:'Squad',
  defaultSquadCapacity:80,
  teamVelocity:'med'      // 'low' | 'med' | 'high'
};

// Convenience aliases — kept for backward compat with all existing applyFeats() call sites
// These are references INTO appSettings, not separate variables
let featDD=appSettings.featDD;
let featCap=appSettings.featCap;
let featDiag=appSettings.featDiag;
let featPI=appSettings.featPI;

// ── COMPANY PROFILE ──
// Org-level context. Set once in Settings Section 1. Shared across all products.
// Lowest priority in prompt injection hierarchy.
let companyProfile={
  companyName:'',
  companyIndustry:'',
  companyUrl:'',
  companyStrategy:'',
  companyContext:'',
  companyRefLink:'',
  companyDocs:[]   // RAG-forward schema: [{id, name, scope:'company', sessionScoped:false,
                   //   docType, wordCount, aiSummary, keyDecisions[], constraints[],
                   //   openQuestions[], summaryStatus:'pending|ready|failed|skipped', uploadedAt}]
                   // extractedText retained in memory only; stripped from all persistence
};

// ── PRODUCT PROFILES ──
// Multiple profiles. Created/edited in Settings Section 5.
// In-session memory only — no cross-session persistence.
// Each: {id, productName, productDesc, industry, productType, kpis, problem, icp, additionalContext, refLink,
//        docs[]} — docs use same RAG-forward schema as companyDocs above
let productProfiles=[];

// ── ACTIVE PROFILE ──
// Tracks which product profile is selected on the Home tab.
// Set on product selector change. Cleared on session re-launch.
let activeProfileId=null;

// ── PRE-DEMO SNAPSHOT ──
// Set the first time a demo dataset is loaded (loadDemoData), capturing the
// user's real companyProfile/productProfiles/activeProfileId before they're
// overwritten with demo data. Restored by clearDemoMode() on exit, then
// reset to null. Switching between demo products while already in demo mode
// does not re-snapshot (would overwrite the real data with demo data).
let _preDemoState=null;

// ── PRODUCT CONTEXT ──
// Populated after successful KPI tree generation.
// Single source of truth for all downstream AI calls.
let productContext=null;

// ── MEASUREMENT MODEL BANNER STATE ──
// Reset to false (expanded) on each generate(). User can collapse manually.
let mmBannerCollapsed=false;
// Separate flag for Diagnostic View banner — collapsed by default, persists for session
let dvBannerCollapsed=true;

// Capability Canvas state
let capStore={};
let capStoreInvalidated=false;
let capActiveMetricKey=null;
let capActiveCapIdx=null;
let capActiveSubCapIdx=null;
let ccSelectedCapIds=new Set(); // cap keys selected for feature generation (metricKey+"|"+capIdx)
let ccPanelCapKey=null;           // cap currently open in right panel ("metricKey|capIdx")

// ── DIAGNOSTIC STATE ──
let diagnosticSessions=[];
let activeDiagnosticId=null;

let productLeakAnalysis=[];  // array of run objects — each has runId, runLabel, runTimestamp, runCustomName, experiments[], leakingStage, etc.
let diagEvidenceDrawerMetricId=null;
let leakDetailExperiment=null;  // {runId, idx} or null — replaces bare leakDetailExperimentIdx

const leakColDefaults={priority:true,experiment:true,linkedMetric:true,successMetric:true,details:true};
let leakColVisible={...leakColDefaults,lifecycleStage:false,experimentType:false,instrumentationNeeded:false,assumptions:false,expectedImpact:false,effort:false};

let leakFilters={priority:'',linkedMetric:'',experimentType:'',selectedOnly:false};
let leakSelectedIds=new Set();

// ── MARKET INTELLIGENCE STATE ──
let miData=null;
let miGenerated=false;
let miProductMode='market';
let miCapabilities=[];
let miSelectedCapNames=new Set(); // transient — tracks checked caps in MI section, not session-saved
let featMI=appSettings.featMI;

// ── PI PLANNING STATE ──
let piMode=false; // true when user entered via Path B (PI-first)
let piFirstBuilt=false; // true after ccBuildPICanvas completes — prevents re-showing form on tab re-entry

let piInputs={
  type:'caps-only',
  piGoal:'',
  constraints:'',
  parsedCaps:[],
  parsedFeatures:[],
  carryForwardItems:[],
  overlapResolutions:{}
};

let piPlan=null;
let piStoryPool={};  // standalone stories not attached to scCanvas features (PI demo + future use)
let piSquads=[{name:(appSettings.defaultSquadName||'Squad')+' 1',capacity:appSettings.defaultSquadCapacity||80}];
let piScVersion=null;
let piDdPanelOpen=false;
let piDdPanelMetricKey=null;

// ── PROTOTYPE STORE ──
// Keyed by feature ID. Variant-aware schema for future multi-variant support.
// v1: always one variant ('v1'). activeVariantId = 'v1'.
// Feature-level fields (shared across variants): screenshotFile, screenshotDataUrl,
//   screenshotInherited, inheritedFromFeatId, additionalContext, featureId, activeVariantId
// Variant-level fields (per generation): wireframeHTML, designBrief, coverageData,
//   externalPrompt, inputSignature, generated, stale, generating, generatedAt, wireframeBlobUrl
// Transient fields stripped from snapshot: wireframeBlobUrl, wireframeHTML,
//   screenshotFile, screenshotDataUrl, screenshotInherited, inheritedFromFeatId
// Access variant fields via pcGetActiveVariant(featId) helper in prototype-canvas.js
let protoStore={};
