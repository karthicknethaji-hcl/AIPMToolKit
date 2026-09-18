#!/usr/bin/env node
// Agent Test Execution Framework — generator pre-check (Phase 1 addendum,
// Phase1-Generator-Addendum.md "Automated pre-check, before either gate").
//
//   node smoke-test.js --agent <agent-folder-name>
//
// Runs before a drafted invoke-config.js is allowed to reach Gate 2
// (technical/fidelity review — see ../generator/REVIEW-CHECKLIST.md). This
// does NOT judge fidelity — that's Gate 2's human call — it only catches the
// class of error no reviewer should have to find by inspection: wrong
// endpoint, broken auth, malformed request body, or a call that silently
// never gets traced/logged by the AI Trace Layer.
//
// PASS requires all of:
//   1. sendMessage() resolves without throwing (no auth/validation error).
//   2. The response has usable text (non-empty rawText).
//   3. A matching mt_ai_traces row exists (client_trace_id + agent_name).
//   4. A matching mt_ai_usage_events row exists (linked via trace_id).
// Per Nethaji's decision, this check covers the DB round-trip, not just
// response shape — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are therefore
// required here, unlike run-tests.js, which degrades gracefully without
// them. A draft that can't be checked end-to-end isn't ready for Gate 2.

const path = require('path');
const { readAppEnvJs } = require('../readAppEnvJs');

function parseArgs(argv) {
  const args = { agent: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--agent') args.agent = argv[++i];
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// AI Trace Layer writes happen out-of-band from the /api/anthropic
// request/response cycle, so a row may not exist the instant sendMessage()
// resolves — retried with backoff rather than treated as an immediate
// failure (same underlying lag run-tests.js's resolveTraceId tolerates by
// being a best-effort single lookup; this check's whole job is confirming
// the write eventually lands, so it waits instead of shrugging).
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000];

async function findTraceId(supabaseAdmin, clientTraceId, agentName) {
  for (const delay of RETRY_DELAYS_MS) {
    const { data, error } = await supabaseAdmin
      .from('mt_ai_traces')
      .select('trace_id')
      .eq('client_trace_id', clientTraceId)
      .eq('agent_name', agentName)
      .maybeSingle();
    if (error) throw new Error('mt_ai_traces lookup failed: ' + error.message);
    if (data) return data.trace_id;
    await sleep(delay);
  }
  return null;
}

async function findUsageEventId(supabaseAdmin, traceId) {
  for (const delay of RETRY_DELAYS_MS) {
    const { data, error } = await supabaseAdmin
      .from('mt_ai_usage_events')
      .select('id')
      .eq('trace_id', traceId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error('mt_ai_usage_events lookup failed: ' + error.message);
    if (data) return data.id;
    await sleep(delay);
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.agent) {
    console.error('Usage: node smoke-test.js --agent <agent-folder-name>');
    process.exitCode = 1;
    return;
  }

  // SUPABASE_URL is non-secret and already sits in scripts/env.js locally —
  // fall back to it so this doesn't need re-pasting on top of the env var.
  // SUPABASE_SERVICE_ROLE_KEY has no such local source (never in
  // scripts/env.js — correctly, it's server-only — and this checkout carries
  // no proxy/.env either), so it stays a required, manually-supplied env var.
  const SUPABASE_URL = process.env.SUPABASE_URL || readAppEnvJs().SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      '[smoke-test] SUPABASE_URL' + (SUPABASE_URL ? ' (resolved)' : ' (not set, and scripts/env.js did not supply it either)') +
      ' and SUPABASE_SERVICE_ROLE_KEY are both required. ' +
      'This check exists specifically to confirm the DB round-trip (mt_ai_traces / ' +
      'mt_ai_usage_events) — unlike run-tests.js, it cannot degrade to console-only.'
    );
    process.exitCode = 1;
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const agentDir = path.join(__dirname, '..', '..', 'agents', args.agent);
  let invoke;
  try {
    invoke = require(path.join(agentDir, 'invoke-config.js'));
  } catch (e) {
    console.error('[smoke-test] Could not load invoke-config.js for "' + args.agent + '" from ' + agentDir + ':', e.message);
    process.exitCode = 1;
    return;
  }

  console.log('Smoke test — ' + invoke.agentName + ' (' + agentDir + ')\n');

  // 1/3 — shape + auth: does the drafted invoke-config actually reach the
  // real endpoint and get a well-formed response back?
  //
  // Only createConversationState()/sendMessage(state, action) are part of
  // the framework's fixed contract — `action`'s own shape is agent-
  // specific (confirmed by Discovery Map's invoke-config.js, which takes
  // {mode:'tree'|'tree-manual'|'dd'|'leak', ...} rather than RA's plain
  // {content}). A drafted invoke-config.js may export an optional
  // `smokeTestAction()` returning a minimal valid action for ITS OWN real
  // shape; fall back to RA's plain-text shape only when that's absent, so
  // this doesn't silently assume every future agent looks like RA.
  const probeAction = (typeof invoke.smokeTestAction === 'function')
    ? invoke.smokeTestAction()
    : {
        content:
          'Smoke test probe — please acknowledge briefly. This message only ' +
          'verifies the drafted invoke-config.js reaches the real endpoint; ' +
          'its content is not a real requirement and does not need to be acted on.'
      };

  process.stdout.write('[1/3] calling sendMessage()... ');
  let callResult;
  try {
    const state = invoke.createConversationState();
    callResult = await invoke.sendMessage(state, probeAction);
  } catch (e) {
    console.log('FAILED');
    console.error('[smoke-test] sendMessage() threw — endpoint, auth, or request body is likely wrong:', e.message);
    process.exitCode = 1;
    return;
  }
  if (!callResult || !callResult.rawText || !callResult.rawText.trim()) {
    console.log('FAILED');
    console.error('[smoke-test] sendMessage() resolved but returned no usable text — check the response-shape handling in invoke-config.js.');
    process.exitCode = 1;
    return;
  }
  console.log('OK (' + callResult.rawText.length + ' chars back)');

  if (!callResult.clientTraceId) {
    console.log('[2/3] SKIPPED — invoke-config.js did not return a clientTraceId in sendMessage()\'s result.');
    console.error(
      '[smoke-test] Cannot check the DB round-trip without a clientTraceId. Add it to sendMessage()\'s ' +
      'return value (see requirement-agent/invoke-config.js for the pattern) before this draft can pass Gate 2.'
    );
    process.exitCode = 1;
    return;
  }

  // 2/3 — mt_ai_traces: was the call actually traced under this agent_name,
  // not just accepted by the proxy?
  process.stdout.write('[2/3] checking mt_ai_traces for client_trace_id ' + callResult.clientTraceId + '... ');
  let traceId;
  try {
    traceId = await findTraceId(supabaseAdmin, callResult.clientTraceId, invoke.agentName);
  } catch (e) {
    console.log('FAILED');
    console.error('[smoke-test]', e.message);
    process.exitCode = 1;
    return;
  }
  if (!traceId) {
    console.log('FAILED');
    console.error(
      '[smoke-test] No mt_ai_traces row found for this call after retrying — the request reached the proxy, ' +
      'but was not recorded under agent_name "' + invoke.agentName + '". Check that the request body\'s ' +
      'agent_name / client_trace_id / company_id fields match what the proxy expects.'
    );
    process.exitCode = 1;
    return;
  }
  console.log('OK (trace_id ' + traceId + ')');

  // 3/3 — mt_ai_usage_events: was the same call logged as a usage event, not
  // just traced?
  process.stdout.write('[3/3] checking mt_ai_usage_events for trace_id ' + traceId + '... ');
  let usageEventId;
  try {
    usageEventId = await findUsageEventId(supabaseAdmin, traceId);
  } catch (e) {
    console.log('FAILED');
    console.error('[smoke-test]', e.message);
    process.exitCode = 1;
    return;
  }
  if (!usageEventId) {
    console.log('FAILED');
    console.error(
      '[smoke-test] No mt_ai_usage_events row found linked to this trace_id after retrying — the call was ' +
      'traced but never logged as a usage event. Check settings_mode / settings_model / selection_rule on ' +
      'the request body (mt_ai_usage_events.settings_mode is NOT NULL — see requirement-agent/invoke-config.js\'s ' +
      'comment for the fix RA needed).'
    );
    process.exitCode = 1;
    return;
  }
  console.log('OK (usage_event ' + usageEventId + ')\n');

  console.log(
    'PASS — invoke-config.js for "' + invoke.agentName + '" round-trips through the real endpoint, auth, ' +
    'and the AI Trace Layer.\nReady for Gate 2 (technical/fidelity review — see generator/REVIEW-CHECKLIST.md). ' +
    'This does NOT mean the invocation is a faithful approximation of the agent\'s real behavior; that judgment ' +
    'is still Gate 2\'s job.'
  );
}

main().catch((err) => {
  console.error('[smoke-test] Fatal:', err);
  process.exitCode = 1;
});
