#!/usr/bin/env node
// Agent Test Execution Framework — generic runner.
//
//   node run-tests.js --agent <agent-folder-name> [--only id1,id2] [--all]
//
// Framework-level, agent-agnostic (RA-Test-Execution-Spec.md Section 2):
// dispatches by executionMode itself so no per-agent runner code is ever
// needed. Reads exactly three files from test-suite/agents/<agent-name>/:
// test-cases.json, rubrics.js, invoke-config.js. Contains ZERO references
// to Requirement Agent or any other specific agent — adding a second agent
// means adding a new folder under test-suite/agents/, not touching this file.
//
// --only <id1,id2,...>  run just these test ids, regardless of v1Scope
// --all                 also run cases with v1Scope:false (repeat-n cases
//                        are still skipped — that execution mode is
//                        reserved, not implemented in v1; see RA-Rubrics.md
//                        Rubric C)

const path = require('path');
const crypto = require('crypto');
const { evaluate } = require('./evaluator');

function parseArgs(argv) {
  const args = { agent: null, only: null, all: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--agent') args.agent = argv[++i];
    else if (argv[i] === '--only') args.only = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--all') args.all = true;
  }
  return args;
}

// ── Judge-model call — framework-level infrastructure, not agent-specific.
// Reuses the same dev proxy/auth the invoked agent uses by default (this is
// a single-person-run harness against one dev session, per the spec's
// simplicity directive); override with TEST_HARNESS_* env vars if a
// separate judge identity is ever wanted.
const HARNESS_PROXY_URL = process.env.TEST_HARNESS_PROXY_URL || process.env.RA_TEST_PROXY_URL || 'http://localhost:3001/api/anthropic';
const HARNESS_AUTH_TOKEN = process.env.TEST_HARNESS_AUTH_TOKEN || process.env.RA_TEST_AUTH_TOKEN || '';
const HARNESS_COMPANY_ID = process.env.TEST_HARNESS_COMPANY_ID || process.env.RA_TEST_COMPANY_ID || '';
// Must be one of proxy/providerAdapters.js's MODEL_CATALOG_BY_PROVIDER
// entries for the 'anthropic' provider — same constraint as invoke-
// config.js's own model default, see that file's comment.
const JUDGE_MODEL = process.env.TEST_HARNESS_JUDGE_MODEL || 'claude-sonnet-4-6';

async function callJudgeModel(promptText) {
  const body = {
    model: JUDGE_MODEL,
    max_tokens: 1000,
    system: 'You are a strict, literal evaluator. Respond with ONLY the requested JSON object — no prose before or after it.',
    messages: [{ role: 'user', content: promptText }],
    _caller: 'quality-evaluator',
    company_id: HARNESS_COMPANY_ID,
    client_call_id: crypto.randomUUID(),
    client_trace_id: crypto.randomUUID(),
    agent_name: 'test-harness-judge',
    // mt_ai_usage_events.settings_mode is NOT NULL — same fix as
    // invoke-config.js's sendMessage(), see its comment for why.
    settings_mode: 'fixed_model',
    settings_model: JUDGE_MODEL,
    selection_rule: 'explicit_override_unclassified',
    prompt_version: 'test-harness-v1',
    provider: 'anthropic'
  };
  const headers = { 'Content-Type': 'application/json' };
  if (HARNESS_AUTH_TOKEN) headers['X-Auth-Token'] = HARNESS_AUTH_TOKEN;

  const res = await fetch(HARNESS_PROXY_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => { throw new Error('Judge call: proxy returned non-JSON — timed out or unavailable.'); });
  if (data.error) throw new Error('[judge:' + data.error.type + '] ' + data.error.message);
  return data.text || '';
}

// ── Optional result persistence — mt_ai_quality_scores. Runs perfectly well
// without these env vars set (prints to console only); set SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (same names proxy/server.js uses) to persist.
function makeSupabaseAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[run-tests] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — results will print to console only, not persisted to mt_ai_quality_scores.\n');
    return null;
  }
  const { createClient } = require('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// mt_ai_traces has no server-facing way to hand the client its trace_id
// directly (the /api/anthropic response envelope is just {text}) — the
// client-generated client_trace_id is the only trace-continuation key
// (AI Trace Layer Invariant 2), so the actual trace_id UUID is resolved
// after the call via a service-role lookup, same posture as every other
// internal reader of this table.
async function resolveTraceId(supabaseAdmin, clientTraceId, agentName) {
  if (!supabaseAdmin || !clientTraceId) return null;
  const { data, error } = await supabaseAdmin
    .from('mt_ai_traces')
    .select('trace_id')
    .eq('client_trace_id', clientTraceId)
    .eq('agent_name', agentName)
    .maybeSingle();
  if (error) {
    console.warn('[run-tests] trace_id lookup failed for', clientTraceId, ':', error.message);
    return null;
  }
  return data ? data.trace_id : null;
}

async function writeScore(supabaseAdmin, runId, agentName, testCase, outcome, clientTraceId, rubricsConfig) {
  if (!supabaseAdmin) return;
  const traceId = await resolveTraceId(supabaseAdmin, clientTraceId, agentName);
  // The `metric` column is meant to hold the descriptive name each rubric
  // defines (rubrics.js's own `.metric` field, e.g. 'groundedness') per the
  // migration's own column comment — testCase.rubric alone is just the
  // short dispatch code (e.g. "G"), not that descriptive name.
  const rubricMeta = rubricsConfig && rubricsConfig[testCase.rubric];
  const { error } = await supabaseAdmin.from('mt_ai_quality_scores').insert({
    test_id: testCase.testId,
    trace_id: traceId,
    agent_name: agentName,
    category: testCase.category,
    metric: (rubricMeta && rubricMeta.metric) || testCase.rubric,
    score: outcome.score,
    pass: outcome.pass,
    evaluator: outcome.evaluator,
    run_id: runId,
    notes: outcome.notes || null,
    recommendation: outcome.recommendation || null
  });
  if (error) console.warn('[run-tests] Failed to write score for', testCase.testId, ':', error.message);
}

// ── executionMode dispatch — framework-level, per RA-Test-Execution-Spec.md
// Section 6 ("must support dispatching by executionMode as a framework-level
// concern, not something each agent reimplements"). Every agent's
// invoke-config.js need only expose createConversationState()/sendMessage().

async function runSingleTurn(invoke, testCase) {
  const state = invoke.createConversationState();
  const callResult = await invoke.sendMessage(state, testCase.probe);
  return { callResult, context: {} };
}

async function runMultiTurn(invoke, testCase) {
  const state = invoke.createConversationState();
  for (const step of testCase.setup || []) {
    await invoke.sendMessage(state, step);
  }
  const draftBefore = Object.assign({}, state.draft);
  const callResult = await invoke.sendMessage(state, testCase.probe);
  const draftAfter = Object.assign({}, state.draft);
  return { callResult, context: { draftBefore, draftAfter } };
}

async function runDualConversation(invoke, testCase) {
  const stateA = invoke.createConversationState();
  for (const step of testCase.conversationA.setup || []) await invoke.sendMessage(stateA, step);
  const resultA = await invoke.sendMessage(stateA, testCase.conversationA.probe);

  const stateB = invoke.createConversationState();
  for (const step of testCase.conversationB.setup || []) await invoke.sendMessage(stateB, step);
  const resultB = await invoke.sendMessage(stateB, testCase.conversationB.probe);

  return { callResult: resultA, context: { conversationB: resultB } };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.agent) {
    console.error('Usage: node run-tests.js --agent <agent-folder-name> [--only id1,id2] [--all]');
    process.exitCode = 1;
    return;
  }

  const agentDir = path.join(__dirname, '..', 'agents', args.agent);
  let testCasesModule, rubricsConfig, invoke;
  try {
    testCasesModule = require(path.join(agentDir, 'test-cases.json'));
    rubricsConfig = require(path.join(agentDir, 'rubrics.js'));
    invoke = require(path.join(agentDir, 'invoke-config.js'));
  } catch (e) {
    console.error('[run-tests] Could not load agent "' + args.agent + '" from ' + agentDir + ':', e.message);
    process.exitCode = 1;
    return;
  }

  const supabaseAdmin = makeSupabaseAdmin();
  const runId = crypto.randomUUID();

  let cases = testCasesModule.testCases;
  if (args.only) cases = cases.filter((c) => args.only.includes(c.testId));
  else if (!args.all) cases = cases.filter((c) => c.v1Scope);

  console.log('Agent Test Execution Framework — run ' + runId);
  console.log('Agent: ' + invoke.agentName + ' — ' + cases.length + ' case(s) selected\n');

  const results = [];
  const capturedOutputs = []; // feeds the S2-style background scan, if any
  const backgroundScanCases = [];

  for (const testCase of cases) {
    if (testCase.executionMode === 'background-scan') {
      backgroundScanCases.push(testCase);
      continue;
    }
    if (testCase.executionMode === 'repeat-n') {
      console.log('[' + testCase.testId + '] SKIPPED — repeat-n execution mode is reserved, not implemented in v1.');
      continue;
    }

    process.stdout.write('[' + testCase.testId + '] running... ');
    try {
      let run;
      if (testCase.executionMode === 'single-turn') run = await runSingleTurn(invoke, testCase);
      else if (testCase.executionMode === 'multi-turn') run = await runMultiTurn(invoke, testCase);
      else if (testCase.executionMode === 'dual-conversation') run = await runDualConversation(invoke, testCase);
      else throw new Error('Unrecognized executionMode: ' + testCase.executionMode);

      const outcome = await evaluate(testCase, rubricsConfig, run.callResult, run.context, callJudgeModel);
      results.push({ testCase, outcome });
      capturedOutputs.push({ testId: testCase.testId, text: run.callResult.rawText });
      // Dual-conversation cases (e.g. RA-P01) produce a second, independent
      // response in run.context.conversationB — the one actually being
      // checked (for cross-session leakage). Previously only run.callResult
      // (conversation A) was ever captured or persisted, so conversation
      // B's output never reached the S2 toxicity scan and its trace was
      // never the one recorded against the row.
      if (run.context && run.context.conversationB) {
        capturedOutputs.push({ testId: testCase.testId + ':conversationB', text: run.context.conversationB.rawText });
      }
      const traceIdForRow = (run.context && run.context.conversationB && run.context.conversationB.clientTraceId) || run.callResult.clientTraceId;
      await writeScore(supabaseAdmin, runId, invoke.agentName, testCase, outcome, traceIdForRow, rubricsConfig);
      console.log(outcome.pass ? 'PASS' : 'FAIL');
    } catch (err) {
      console.log('ERROR — ' + err.message);
      results.push({ testCase, outcome: { pass: false, score: null, evaluator: 'error', notes: { error: err.message } } });
    }
  }

  for (const scanCase of backgroundScanCases) {
    process.stdout.write('[' + scanCase.testId + '] running... ');
    try {
      const outcome = await evaluate(scanCase, rubricsConfig, { rawText: '' }, { allCapturedOutputs: capturedOutputs }, callJudgeModel);
      results.push({ testCase: scanCase, outcome });
      await writeScore(supabaseAdmin, runId, invoke.agentName, scanCase, outcome, null, rubricsConfig);
      console.log(outcome.pass ? 'PASS' : 'FAIL');
    } catch (err) {
      console.log('ERROR — ' + err.message);
      results.push({ testCase: scanCase, outcome: { pass: false, score: null, evaluator: 'error', notes: { error: err.message } } });
    }
  }

  console.log('\n─── Summary (run ' + runId + ') ───');
  const byCategory = {};
  for (const { testCase, outcome } of results) {
    const cat = testCase.category;
    byCategory[cat] = byCategory[cat] || { pass: 0, fail: 0 };
    if (outcome.pass) byCategory[cat].pass++; else byCategory[cat].fail++;
  }
  for (const cat of Object.keys(byCategory).sort()) {
    console.log(cat + ': ' + byCategory[cat].pass + ' pass, ' + byCategory[cat].fail + ' fail');
  }
  const totalFail = results.filter((r) => !r.outcome.pass).length;
  console.log('\nTotal: ' + results.length + ' run, ' + (results.length - totalFail) + ' passed, ' + totalFail + ' failed.');
  process.exitCode = totalFail > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('[run-tests] Fatal:', err);
  process.exitCode = 1;
});
