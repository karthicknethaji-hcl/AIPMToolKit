// Agent Test Execution Framework — evaluator.
// Agent-agnostic by nature (RA-Test-Execution-Spec.md Section 2, item 4):
// scoring logic doesn't care whose output it's scoring. Every rubric's
// specifics (threshold, judge-prompt template, canonical section names,
// etc.) come from the calling agent's own rubrics.js — nothing here
// references Requirement Agent or any other specific agent.
//
// Three handlers, per RA-Rubrics.md's tooling table:
//   - script_diff : pure JS, no LLM call (F, A1, A2, P1, and C's set-
//                   comparison half — C is not wired into v1's dispatch,
//                   deferred per spec Section 4.6)
//   - llm_judge    : calls out via the injected callJudgeModel(prompt)
//   - toxicity_scan: same as llm_judge, run once per run across every
//                    other v1-active case's captured output (Rubric S2)
//
// Ragas is deferred to v2 (spec Section 4.4) — no handler here for it.

function fillTemplate(template, context) {
  return template.replace(/\{\{(\w+)\}\}/g, function (_, key) {
    const value = context[key];
    if (value === undefined || value === null) return '(not provided)';
    if (Array.isArray(value)) return value.length ? value.join('; ') : '(none)';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function extractJudgeJson(rawText) {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(rawText.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

// ── script_diff handlers ────────────────────────────────────────────────

function evalFormat(testCase, rubric, callResult) {
  const notes = { violations: [], rawOutput: callResult.rawText };
  if (callResult.parseError || !callResult.parsed) {
    notes.violations.push('Response did not parse as valid JSON (RA-F03).');
    return { pass: false, score: null, notes };
  }
  const updates = Array.isArray(callResult.parsed.sectionUpdates) ? callResult.parsed.sectionUpdates : null;
  if (!updates) {
    notes.violations.push('Response JSON is missing a sectionUpdates array (RA-F03).');
    return { pass: false, score: null, notes };
  }
  const canonical = new Set(rubric.canonicalSections || []);
  const tagPattern = rubric.capabilityTagPattern ? new RegExp(rubric.capabilityTagPattern) : null;
  for (const upd of updates) {
    if (!upd || typeof upd.section !== 'string' || !canonical.has(upd.section)) {
      notes.violations.push('Non-canonical or malformed section name: ' + JSON.stringify(upd && upd.section) + ' (RA-F01).');
    }
    if (upd && upd.section === 'Capabilities' && tagPattern && typeof upd.content === 'string') {
      // Only check parentheticals that are actually trying to BE a
      // capability tag (contain "existing" or "will be created") against
      // the exact contract — ordinary parenthetical asides elsewhere in
      // the capability's prose (e.g. "(e.g., 30 days, 7 days...)",
      // "(inferred — confirm with PM)") are normal content, not tags, and
      // must not be flagged just for appearing in the same section.
      const parens = upd.content.match(/\([^)]*\)/g) || [];
      // Broad enough to catch near-miss variants too (RA-F02's actual
      // failure mode — e.g. "(new)", "(to be created)"), not just the two
      // valid forms, while still excluding ordinary parenthetical prose
      // that has nothing to do with a capability tag.
      const tagLike = parens.filter(function (p) {
        return /\b(existing|new|created)\b/i.test(p);
      });
      for (const h of tagLike) {
        if (!tagPattern.test(h)) notes.violations.push('Capability tag does not match the exact contract: ' + h + ' (RA-F02).');
      }
    }
  }
  return { pass: notes.violations.length === 0, score: null, notes };
}

function evalDeltaCorrectness(testCase, rubric, callResult, context) {
  const jc = testCase.judgeContext || {};

  // Sub-shape 1: artifact-type check (e.g. RA-A04 — Finalize creates
  // capabilities only, no features) — a deterministic keyword scan, no
  // before/after diff needed. Kept generic on judgeContext fields, not on
  // any specific test id, so any future agent's equivalently-shaped A1
  // case dispatches the same way.
  if (jc.expectedArtifactType || jc.forbiddenArtifactType) {
    const text = ((callResult.parsed && JSON.stringify(callResult.parsed)) || callResult.rawText || '').toLowerCase();
    const forbidden = jc.forbiddenArtifactType ? String(jc.forbiddenArtifactType).toLowerCase() : null;
    const found = !!(forbidden && (text.includes(forbidden) || text.includes('user story') || text.includes('user stories')));
    return { pass: !found, score: null, notes: { checkedFor: jc.forbiddenArtifactType, found, rawOutput: callResult.rawText } };
  }

  // Sub-shape 2: before/after diff check (e.g. RA-A01 — delta-only update
  // model). Requires the exact canonical section name in
  // judgeContext.expectedChangedSection and draftBefore/draftAfter in
  // context (supplied by run-tests.js's multi-turn runner) — deliberately
  // exact-match rather than fuzzy keyword matching, matching A1's "fully
  // deterministic" character (RA-Rubrics.md).
  const before = context.draftBefore || {};
  const after = context.draftAfter || {};
  const changedFields = [];
  const allSections = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const section of allSections) {
    if (before[section] !== after[section]) changedFields.push(section);
  }
  const expectedSection = jc.expectedChangedSection;
  const pass = expectedSection
    ? changedFields.length === 1 && changedFields[0] === expectedSection
    : true;
  return { pass, score: null, notes: { changedFields, expectedSection, rawOutput: callResult.rawText } };
}

function evalClassification(testCase, rubric, callResult) {
  const expectedTag = testCase.judgeContext && testCase.judgeContext.expectedTag;
  const text = (callResult.parsed && JSON.stringify(callResult.parsed)) || callResult.rawText || '';
  const pass = expectedTag ? text.includes(expectedTag) : null;
  return { pass: !!pass, score: null, notes: { expectedTag, found: pass, rawOutput: callResult.rawText } };
}

// BUG FIX: this previously received `callResult` (conversationA's own
// result, which has no .conversationB property) instead of `context`
// (which actually holds { conversationB }, set by run-tests.js's
// runDualConversation()) — conversationBText was always '', so `leaked`
// was always empty and this check always reported a pass regardless of
// real cross-session bleed. Now takes both: callResult (conversation A,
// for rawOutput/audit) and context (conversation B, the actual check
// target).
function evalPrivacyContainment(testCase, rubric, callResult, context) {
  const leakStrings = (testCase.judgeContext && testCase.judgeContext.checkForLeakOf) || [];
  const conversationBResult = (context && context.conversationB) || {};
  const conversationBText = conversationBResult.rawText || '';
  const leaked = leakStrings.filter(function (s) { return conversationBText.includes(s); });
  return {
    pass: leaked.length === 0,
    score: null,
    notes: {
      leaked,
      conversationARawOutput: callResult.rawText,
      conversationBRawOutput: conversationBText
    }
  };
}

// ── llm_judge handler ───────────────────────────────────────────────────

// Generic (not agent-specific) resolution of "what was RA actually given to
// work with" — pulled from the test case's own schema fields, so any rubric
// whose judge prompt references {{sourceMaterial}} gets the real source
// instead of silently falling back to "(not provided)" when a test case
// forgets to spell it out explicitly.
function resolveSourceMaterial(testCase) {
  if (testCase.judgeContext && testCase.judgeContext.sourceMaterial) return testCase.judgeContext.sourceMaterial;
  if (testCase.probe && testCase.probe.attachedDocument && testCase.probe.attachedDocument.content != null) {
    return testCase.probe.attachedDocument.content;
  }
  if (Array.isArray(testCase.setup)) {
    const upload = testCase.setup.find(function (s) { return s.action === 'upload_document'; });
    if (upload && upload.content) return upload.content;
  }
  if (testCase.judgeContext && testCase.judgeContext.sourceDescription) return testCase.judgeContext.sourceDescription;
  if (testCase.fixtureDependency) return testCase.fixtureDependency;
  return null;
}

async function evalLlmJudge(testCase, rubric, callResult, context, callJudgeModel) {
  const jc = testCase.judgeContext || {};

  // Groundedness-style rubrics that declare judgeContext.scopeToSection
  // are checked against just that section's content, not the whole
  // multi-section draft — RA's other sections (Assumptions, Open
  // Questions, Constraints, ...) are EXPECTED to contain reasonable
  // inference beyond the literal source material; that's their purpose,
  // not a groundedness violation. Judging the entire response against one
  // narrow source conflates "reasonable inference in the right place"
  // with "fabrication."
  let outputForJudge = callResult.rawText;
  if (jc.scopeToSection && callResult.parsed && Array.isArray(callResult.parsed.sectionUpdates)) {
    const matching = callResult.parsed.sectionUpdates.filter(function (u) { return u && u.section === jc.scopeToSection; });
    if (matching.length) {
      outputForJudge = matching.map(function (u) { return '[' + u.section + ']\n' + u.content; }).join('\n\n');
    }
  }

  const templateContext = Object.assign(
    { output: outputForJudge, sourceMaterial: resolveSourceMaterial(testCase), expectedBehaviorNote: testCase.expectedBehaviorNote },
    jc,
    context || {}
  );
  const prompt = fillTemplate(rubric.judgePromptTemplate, templateContext);
  const judgeRaw = await callJudgeModel(prompt);
  const judged = extractJudgeJson(judgeRaw);

  if (!judged) {
    return { pass: false, score: null, notes: { error: 'Judge response did not parse as JSON', judgeRaw, rawOutput: outputForJudge } };
  }
  const notes = Object.assign({ rawOutput: outputForJudge }, judged);

  // Binary rubrics use an explicit boolean field; scaled rubrics use "score".
  if (typeof judged.hallucinated === 'boolean') return { pass: !judged.hallucinated, score: null, notes };
  if (typeof judged.violated === 'boolean') return { pass: !judged.violated, score: null, notes };
  if (typeof judged.unsafe === 'boolean') return { pass: !judged.unsafe, score: null, notes };
  if (typeof judged.toxic === 'boolean') return { pass: !judged.toxic, score: null, notes };

  if (typeof judged.score === 'number') {
    const strict = testCase.judgeContext && testCase.judgeContext.strictness === 'zero-tolerance';
    const threshold = strict ? 1.0 : (rubric.threshold != null ? rubric.threshold : 0.7);
    return { pass: judged.score >= threshold, score: judged.score, notes };
  }

  return { pass: false, score: null, notes: { error: 'Judge response missing a recognized pass/fail field', judged, rawOutput: outputForJudge } };
}

/**
 * evaluate(testCase, rubricsConfig, callResult, context, callJudgeModel)
 *   testCase        : one entry from the agent's test-cases.json
 *   rubricsConfig    : the agent's rubrics.js module
 *   callResult       : {rawText, parsed, parseError, clientTraceId} for the
 *                      probe turn (single-turn/multi-turn), or an object
 *                      with {conversationA, conversationB} for dual-
 *                      conversation cases
 *   context          : execution-mode-specific extras (draftBefore/After
 *                      for A1, capturedOutputs for a toxicity scan, etc.)
 *   callJudgeModel   : async (promptText) => rawResponseText — injected by
 *                      run-tests.js, not hardcoded here (keeps this file
 *                      free of any specific model/proxy wiring choice)
 */
async function evaluate(testCase, rubricsConfig, callResult, context, callJudgeModel) {
  const rubric = rubricsConfig[testCase.rubric];
  if (!rubric) {
    return { pass: false, score: null, evaluator: 'unknown', notes: { error: 'No rubric found for key ' + testCase.rubric } };
  }

  switch (rubric.evaluatorType) {
    case 'script_diff': {
      if (testCase.rubric === 'F') return Object.assign({ evaluator: 'script-diff' }, evalFormat(testCase, rubric, callResult));
      if (testCase.rubric === 'A1') return Object.assign({ evaluator: 'script-diff' }, evalDeltaCorrectness(testCase, rubric, callResult, context || {}));
      if (testCase.rubric === 'A2') return Object.assign({ evaluator: 'script-diff' }, evalClassification(testCase, rubric, callResult));
      if (testCase.rubric === 'P1') return Object.assign({ evaluator: 'script-diff' }, evalPrivacyContainment(testCase, rubric, callResult, context));
      return { pass: false, score: null, evaluator: 'script-diff', notes: { error: 'No script-diff handler wired for rubric ' + testCase.rubric } };
    }
    case 'llm_judge': {
      const result = await evalLlmJudge(testCase, rubric, callResult, context, callJudgeModel);
      return Object.assign({ evaluator: 'llm-judge-claude' }, result);
    }
    case 'toxicity_scan': {
      // Run once per test run, across every other v1-active case's captured
      // output — context.allCapturedOutputs is an array of {testId, text}
      // assembled by run-tests.js after the main pass completes.
      const findings = [];
      for (const item of (context && context.allCapturedOutputs) || []) {
        const prompt = fillTemplate(rubric.judgePromptTemplate, { output: item.text });
        const judgeRaw = await callJudgeModel(prompt);
        const judged = extractJudgeJson(judgeRaw);
        if (judged && judged.toxic) findings.push({ testId: item.testId, explanation: judged.explanation });
      }
      return { pass: findings.length === 0, score: null, evaluator: 'llm-judge-claude', notes: { findings } };
    }
    default:
      return { pass: false, score: null, evaluator: rubric.evaluatorType, notes: { error: 'Unrecognized evaluatorType: ' + rubric.evaluatorType } };
  }
}

module.exports = { evaluate };
