// Discovery Map — invoke config.
//
// DRAFT — pending review, not yet approved for execution.
// Source: code-derived. Confidence: high.
// This is the LOWEST-confidence, HIGHEST-scrutiny artifact of the three
// drafted files (see GENERATOR-PROMPT.md's "Confidence labeling") — Gate 2
// (engineer-owned) must independently verify the request shape below
// against scripts/api.js before this is trusted, the same way it did for
// requirement-agent/invoke-config.js.
//
// Fidelity split, two different answers for two different halves of the
// pipeline:
//
// 1. PROMPT CONSTRUCTION — HIGH fidelity, not a hand-copied approximation.
//    Unlike scripts/requirement-agent.js (DOM/window/localStorage-coupled
//    throughout, per requirement-agent/invoke-config.js's own known-
//    limitation note), the four target functions in scripts/prompts.js are
//    pure string builders: buildTreePromptManual, buildDDPrompt, and
//    buildProductLeakPrompt take every input as an explicit argument with
//    no global reads at all; buildTreePrompt only optionally reads two
//    loose globals (gData, appSettings), both already typeof-guarded with
//    safe fallbacks in the source itself. None of the four touch document,
//    window, or localStorage. That makes it possible to load the REAL
//    scripts/prompts.js file (unmodified) into a Node vm context below and
//    call the actual production functions verbatim, stubbing only the two
//    optional globals buildTreePrompt reads. This is a real improvement
//    over RA's condensed, hand-maintained approximation for this half of
//    the pipeline — Gate 2 should still confirm scripts/prompts.js hasn't
//    drifted from what this file assumes about its shape (e.g. a future
//    edit adding a new required global read would silently break this
//    loader in a way only running it would reveal).
//
// 2. NETWORK / AUTH LAYER — Option 1c, same as RA. scripts/api.js's
//    callAPI() is itself DOM/window/localStorage-coupled (window.location.
//    hostname, localStorage.getItem, authGetFreshToken() hitting Supabase
//    auth from a browser session) and is not headlessly callable. This file
//    hand-builds the request body to the same shape callAPI() sends
//    (confirmed against scripts/api.js:916-945), rather than driving that
//    function directly.
//
// Auth: same Product Studio dev credentials pattern as
// requirement-agent/invoke-config.js (pgt-dev, no separate test tenant).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const PROXY_URL = process.env.DM_TEST_PROXY_URL || 'http://localhost:3001/api/anthropic';
const AUTH_TOKEN = process.env.DM_TEST_AUTH_TOKEN || '';
const COMPANY_ID = process.env.DM_TEST_COMPANY_ID || '';
const PRODUCT_ID = process.env.DM_TEST_PRODUCT_ID || '';

// Real call sites (scripts/kpi-tree.js:353-362, scripts/diagnostic-view.js:
// 663-666) pass model:null for both tree and leak generation, which
// resolveModelDecision() (scripts/api.js:413-441) resolves via
// CALLER_TIERS['dm-generate'] / CALLER_TIERS['diagnostic-leak'], both
// 'general' tier -> TIER_MODEL_BY_PROVIDER.anthropic.general
// ('claude-sonnet-4-6', scripts/api.js:333). This harness forces that same
// model explicitly (env-overridable) for run-to-run determinism, same
// rationale requirement-agent/invoke-config.js gives for its own
// RA_TEST_MODEL default.
const TREE_MODEL = process.env.DM_TEST_TREE_MODEL || 'claude-sonnet-4-6';
const LEAK_MODEL = process.env.DM_TEST_LEAK_MODEL || 'claude-sonnet-4-6';
// DD's real call sites (scripts/capability-canvas.js:3027,
// scripts/metrics-definition.js:22) hardcode this model literally, not via
// tier resolution — NOT env-overridable here, to stay byte-identical with
// production rather than drifting into "whatever the harness felt like."
const DD_MODEL = 'claude-haiku-4-5';

if (!AUTH_TOKEN) {
  console.warn('[invoke-config] DM_TEST_AUTH_TOKEN is not set — /api/anthropic calls will fail requireAuthStrict. See README.md.');
}
if (!COMPANY_ID) {
  console.warn('[invoke-config] DM_TEST_COMPANY_ID is not set — /api/anthropic calls will fail requireActiveCompanyMember. See README.md.');
}

// ── Real system prompts, copied verbatim from their real call sites ────────
// (not re-derived or approximated — grep-confirmed against the exact lines
// cited below at draft time; re-diff these if the cited files change).
const SYS_TREE = 'You are a senior enterprise product consultant. Respond ONLY with valid JSON. No markdown, no backticks, no preamble. Never use em dashes (—) in your output; use a hyphen (-) or rewrite the phrase.'; // scripts/kpi-tree.js:354
const SYS_LEAK = 'You are a senior product growth diagnostic consultant. Respond ONLY with valid strict JSON. No markdown, no backticks, no preamble. Never use em dashes (—) in your output; use a hyphen (-) or rewrite the phrase.'; // scripts/diagnostic-view.js:664

// ── Loading the REAL scripts/prompts.js into a vm context ──────────────────
const PROMPTS_SOURCE_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'prompts.js');

function loadRealPromptModule() {
  const code = fs.readFileSync(PROMPTS_SOURCE_PATH, 'utf8');
  const sandbox = { console };
  vm.createContext(sandbox);
  // Top-level `function` declarations in vm-executed code attach as
  // properties of the context object (the vm's "global"), same as a
  // <script> tag in a browser — this is what makes scripts/prompts.js
  // runnable here completely unmodified.
  new vm.Script(code, { filename: 'scripts/prompts.js' }).runInContext(sandbox);
  return sandbox; // gives live access to buildTreePrompt/buildTreePromptManual/
                  // buildDDPrompt/buildProductLeakPrompt/SYS_DD by name, and
                  // lets us set sandbox.gData / sandbox.appSettings per call
                  // for buildTreePrompt's two optional global reads.
}

const promptSandbox = loadRealPromptModule();
const SYS_DD = vm.runInContext('SYS_DD', promptSandbox); // scripts/prompts.js:864 (const, not a context property — read via a follow-up eval in the same context)

if (typeof promptSandbox.buildTreePrompt !== 'function' ||
    typeof promptSandbox.buildTreePromptManual !== 'function' ||
    typeof promptSandbox.buildDDPrompt !== 'function' ||
    typeof promptSandbox.buildProductLeakPrompt !== 'function') {
  throw new Error(
    '[invoke-config] scripts/prompts.js did not expose the four expected functions after loading — ' +
    'it may have been refactored since this file was drafted. Re-check the vm-loading approach above.'
  );
}

function newClientCallId() {
  return crypto.randomUUID();
}

/**
 * One independent test run's state. Discovery Map is not a conversational
 * agent (no chat history to thread through) — the only thing worth carrying
 * across calls within a "session" is the most recently generated tree, so a
 * refinement-mode test case (DM-A01) can chain off a prior fresh-generation
 * call the same way a real PM would click Generate, then Refine, in the
 * same session. lastTree mirrors gData's shape (scripts/session-store.js's
 * snapshot.gData: {stages, kpiDepth, approach}).
 */
function createConversationState() {
  return {
    clientTraceId: crypto.randomUUID(),
    lastTree: null // {stages, kpiDepth, approach} | null
  };
}

function tryParseJson(text) {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    // Product Leak / DD may return a bare array; tree modes return an
    // object. Try a straight parse first (works for both shapes) before
    // falling back to brace-slicing for a truncated/preambled response.
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const objStart = cleaned.indexOf('{');
      const arrStart = cleaned.indexOf('[');
      const usesArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
      const start = usesArray ? arrStart : objStart;
      const end = usesArray ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}');
      if (start === -1 || end === -1 || end < start) return null;
      return JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch (e) {
    return null;
  }
}

/**
 * Builds the real prompt text + selects the real (system prompt, model,
 * maxTokens, caller) tuple for one action, exactly matching the branching
 * scripts/kpi-tree.js / scripts/diagnostic-view.js / scripts/capability-
 * canvas.js / scripts/metrics-definition.js actually do at their real call
 * sites.
 *
 * action shapes:
 *   {mode:'tree', fd, extra?, kpiDepth?}
 *     - fd: the same shape generateConfirmed() builds (scripts/kpi-tree.js:
 *       244-260): {name,url,description,industry,productType,kpis,problem,
 *       icp,additionalContext,customValueChain,approach,companyStrategy,
 *       companyContext,docContext}
 *     - extra: refinement instruction string. When set, the harness's
 *       state.lastTree (from a prior 'tree'/'tree-manual' call in this same
 *       state) is exposed as gData for buildTreePrompt's CURRENT TREE
 *       block, exactly mirroring scripts/kpi-tree.js's real
 *       extra-and-gData-present branch (scripts/prompts.js:133-135).
 *     - kpiDepth: sets appSettings.kpiDepth for this call (default 1,
 *       matching scripts/kpi-tree.js:396's own `||1` fallback).
 *   {mode:'tree-manual', fd, manualList, allowAISuggestions}
 *     - manualList: [{name, description?}], passed straight through to
 *       buildTreePromptManual and (after the real call) through the real
 *       _mmReconcileManualCaps-equivalent reconciliation below.
 *   {mode:'dd', metrics}
 *     - metrics: [{stage, level, name}]. metrics.length===1 routes through
 *       the same (model, maxTokens, caller) triple as the real cc-dd-single
 *       call site; length>1 routes through md-dd-batch's triple
 *       (scripts/capability-canvas.js:3027, scripts/metrics-definition.js:22).
 *   {mode:'leak', productCtx, nsm, stagesWithEvidence, readiness, changedMetrics?}
 */
function buildRequestForAction(action) {
  if (action.mode === 'tree') {
    promptSandbox.appSettings = { kpiDepth: action.kpiDepth || 1 };
    promptSandbox.gData = action.extra ? (action.priorTree || null) : null;
    const userContent = promptSandbox.buildTreePrompt(action.fd, action.extra || null);
    return { system: SYS_TREE, userContent, model: TREE_MODEL, maxTokens: 20000, caller: 'dm-generate' };
  }
  if (action.mode === 'tree-manual') {
    const userContent = promptSandbox.buildTreePromptManual(action.fd, action.manualList, !!action.allowAISuggestions);
    return { system: SYS_TREE, userContent, model: TREE_MODEL, maxTokens: 20000, caller: 'dm-generate' };
  }
  if (action.mode === 'dd') {
    const userContent = promptSandbox.buildDDPrompt(action.metrics);
    const single = Array.isArray(action.metrics) && action.metrics.length === 1;
    return {
      system: SYS_DD,
      userContent,
      model: DD_MODEL,
      maxTokens: single ? 1500 : 8000, // scripts/capability-canvas.js:3027 vs scripts/metrics-definition.js:22
      caller: single ? 'cc-dd-single' : 'md-dd-batch'
    };
  }
  if (action.mode === 'leak') {
    const userContent = promptSandbox.buildProductLeakPrompt(
      action.productCtx, action.nsm, action.stagesWithEvidence, action.readiness, action.changedMetrics || null
    );
    return { system: SYS_LEAK, userContent, model: LEAK_MODEL, maxTokens: 6000, caller: 'diagnostic-leak' };
  }
  throw new Error('[invoke-config] Unknown action.mode: ' + action.mode + ' (expected one of: tree, tree-manual, dd, leak)');
}

/**
 * JS port of scripts/kpi-tree.js's _mmReconcileManualCaps() (lines 692-730),
 * run against the raw model output for 'tree-manual' actions so test cases
 * (DM-A03, DM-A04) score the SAME post-reconciliation result a real PM
 * actually sees, not the model's unreconciled raw output. Kept as a
 * hand-ported copy (not vm-loaded like the prompt builders) because the
 * real function mutates `parsed` in place with no return value and is
 * declared alongside DOM-coupled code in the same file — safe to port here
 * since its own body has zero DOM/global dependencies, but the file it
 * lives in as a whole does not qualify for the same vm-load treatment
 * prompts.js got above. Keeping this in sync with scripts/kpi-tree.js is
 * the same manual-sync discipline as test-cases.json/RA-Test-Cases.md.
 */
function reconcileManualCaps(parsed, manualList, allowAISuggestions) {
  if (!parsed || !Array.isArray(parsed.stages)) return parsed;
  const supplied = manualList.map((c) => ({ name: (c.name || '').trim(), description: (c.description || '').trim() }));
  const suppliedByLower = new Map(supplied.map((c) => [c.name.toLowerCase(), c]));
  const placed = new Set();

  parsed.stages.forEach((st) => {
    if (!Array.isArray(st.l1_metrics)) st.l1_metrics = [];
    st.l1_metrics = st.l1_metrics.filter((l1) => {
      if (!l1 || !l1.name) return false;
      const match = suppliedByLower.get(l1.name.trim().toLowerCase());
      if (match) {
        if (placed.has(match.name.toLowerCase())) return false;
        placed.add(match.name.toLowerCase());
        l1.name = match.name;
        l1.why = match.description || l1.why || '';
        delete l1._aiSuggested;
        return true;
      }
      if (allowAISuggestions) {
        l1._aiSuggested = true;
        return true;
      }
      return false;
    });
  });

  const missing = supplied.filter((c) => !placed.has(c.name.toLowerCase()));
  if (missing.length > 0 && parsed.stages.length > 0) {
    missing.forEach((c) => {
      parsed.stages[0].l1_metrics.push({ name: c.name, why: c.description || '' });
    });
  }
  return parsed;
}

/**
 * Sends one generation call. action: see buildRequestForAction's doc above.
 * Returns {rawText, parsed, parseError, clientTraceId, systemPrompt}.
 */
async function sendMessage(state, action) {
  const req = buildRequestForAction(action);
  const clientCallId = newClientCallId();

  // Same field set scripts/api.js's callAPI() sends (scripts/api.js:916-
  // 945) — settings_mode/selection_rule reflect this harness's own
  // deliberate, always-explicit model choice, same convention
  // requirement-agent/invoke-config.js documents for its own MODEL default.
  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: 'user', content: req.userContent }],
    _caller: req.caller,
    company_id: COMPANY_ID,
    product_id: PRODUCT_ID || null,
    session_id: null,
    session_type: null,
    client_call_id: clientCallId,
    client_trace_id: state.clientTraceId,
    agent_name: 'discovery-map',
    settings_mode: 'fixed_model',
    settings_model: req.model,
    selection_rule: 'explicit_override_unclassified',
    prompt_version: 'test-harness-v1',
    provider: 'anthropic'
  };

  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) headers['X-Auth-Token'] = AUTH_TOKEN;

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(function () {
    throw new Error('Proxy returned non-JSON — timed out or unavailable.');
  });

  if (data.error) {
    throw new Error('[' + data.error.type + '] ' + data.error.message);
  }

  const rawText = data.text || '';
  let parsed = tryParseJson(rawText);

  if (parsed && action.mode === 'tree-manual') {
    parsed = reconcileManualCaps(parsed, action.manualList, !!action.allowAISuggestions);
  }

  if (parsed && (action.mode === 'tree' || action.mode === 'tree-manual') && Array.isArray(parsed.stages)) {
    state.lastTree = { stages: parsed.stages, kpiDepth: (promptSandbox.appSettings && promptSandbox.appSettings.kpiDepth) || 1, approach: action.fd.approach };
  }

  return {
    rawText,
    parsed,
    parseError: parsed === null,
    clientTraceId: state.clientTraceId,
    systemPrompt: req.system
  };
}

/**
 * Minimal valid action for generator/smoke-test.js's automated pre-check
 * (see that file's `smokeTestAction()` fallback rule) — this agent's real
 * action shape is {mode, ...}, not RA's plain {content}, so the smoke
 * test's generic default probe would never route anywhere. 'dd' is the
 * cheapest real mode to exercise (smallest maxTokens, lightweight model,
 * one metric) — sufficient to prove the endpoint/auth/DB-round-trip path
 * without spending a full tree-generation call just to smoke-test wiring.
 */
function smokeTestAction() {
  return { mode: 'dd', metrics: [{ stage: 'Smoke Test Stage', level: 'L1', name: 'Smoke Test Metric' }] };
}

module.exports = {
  agentName: 'discovery-map',
  createConversationState,
  sendMessage,
  smokeTestAction
};
