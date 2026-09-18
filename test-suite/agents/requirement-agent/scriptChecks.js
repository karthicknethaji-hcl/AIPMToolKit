// Requirement Agent — script-diff rubric handlers.
// Moved out of test-suite/framework/evaluator.js (code-review finding,
// 2026-09-18): the framework's script_diff dispatch was hardcoded to these
// four functions/rubric keys directly, which meant "agent-agnostic" was
// true for llm_judge/toxicity_scan but never for script_diff. evaluator.js
// now dispatches generically by looking up testCase.rubric in whatever
// module an agent's own scriptChecks.js exports — this file is that export
// for requirement-agent. Zero behavior change versus the pre-refactor
// inline functions; only the location and the mechanism for finding them
// changed.
//
// Each handler: (testCase, rubric, callResult, context) => outcome (without
// the `evaluator` field — evaluator.js adds that after calling this).

// Finds an occurrence of `word` in `text` that ISN'T immediately preceded by
// a negation ("no features", "not a user story", ...) — a plain
// `text.includes(word)` can't tell "we generate features" apart from "we do
// NOT generate features", which made evalDeltaCorrectness's sub-shape 1
// flag a fully correct denial as a violation.
function hasUnnegatedMention(text, word) {
  let idx = text.indexOf(word);
  while (idx !== -1) {
    const precedingWindow = text.slice(Math.max(0, idx - 20), idx);
    const negated = /\b(no|not|never|zero|without|none)\b[^.]*$/.test(precedingWindow);
    if (!negated) return true;
    idx = text.indexOf(word, idx + word.length);
  }
  return false;
}

function evalFormat(testCase, rubric, callResult) {
  const notes = { violations: [], rawOutput: callResult.rawText };
  if (callResult.parseError || !callResult.parsed) {
    notes.violations.push('Response did not parse as valid JSON (RA-F03).');
    return { pass: false, score: null, notes, recommendation: 'Fix format contract violations: ' + notes.violations.join('; ') };
  }
  const updates = Array.isArray(callResult.parsed.sectionUpdates) ? callResult.parsed.sectionUpdates : null;
  if (!updates) {
    notes.violations.push('Response JSON is missing a sectionUpdates array (RA-F03).');
    return { pass: false, score: null, notes, recommendation: 'Fix format contract violations: ' + notes.violations.join('; ') };
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
  const pass = notes.violations.length === 0;
  return {
    pass,
    score: null,
    notes,
    recommendation: pass ? null : 'Fix format contract violations: ' + notes.violations.join('; ')
  };
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
    const found = !!(forbidden && (
      hasUnnegatedMention(text, forbidden) ||
      hasUnnegatedMention(text, 'user story') ||
      hasUnnegatedMention(text, 'user stories')
    ));
    return {
      pass: !found,
      score: null,
      notes: { checkedFor: jc.forbiddenArtifactType, found, rawOutput: callResult.rawText },
      recommendation: found ? 'Response contains a forbidden artifact type (' + jc.forbiddenArtifactType + ') — check for feature-generation leakage in the Finalize/turn logic.' : null
    };
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
  return {
    pass,
    score: null,
    notes: { changedFields, expectedSection, rawOutput: callResult.rawText },
    recommendation: pass ? null : 'Expected only "' + expectedSection + '" to change; actual changed fields: ' + (changedFields.join(', ') || '(none)') + '. Check for collateral section rewrites.'
  };
}

function evalClassification(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const expectedTag = jc.expectedTag;
  const capabilityName = jc.existingCapabilityName;

  // Operate on the Capabilities section's own raw content (real newlines,
  // real heading markers) rather than JSON.stringify(callResult.parsed) —
  // the stringified form escapes newlines to literal "\n" two-character
  // sequences, which breaks heading-boundary detection below.
  const capabilitiesSection = callResult.parsed && Array.isArray(callResult.parsed.sectionUpdates)
    ? callResult.parsed.sectionUpdates.find(function (u) { return u && u.section === 'Capabilities'; })
    : null;
  const text = (capabilitiesSection && typeof capabilitiesSection.content === 'string')
    ? capabilitiesSection.content
    : ((callResult.parsed && JSON.stringify(callResult.parsed)) || callResult.rawText || '');

  // Scoped to the named capability's own block, not "does this tag appear
  // anywhere in the whole response" — a response with multiple
  // capabilities could have some OTHER capability correctly tagged
  // "(existing)" while the specific one under test is misclassified, which
  // an unscoped (or a too-wide fixed-window) substring check would miss.
  let pass;
  if (expectedTag && capabilityName) {
    const nameIndex = text.indexOf(capabilityName);
    if (nameIndex === -1) {
      pass = false;
    } else {
      const afterName = text.slice(nameIndex + capabilityName.length);
      // Stop at the next capability heading (a line starting with a
      // markdown heading marker or bold text) so a different capability's
      // tag can't leak into this one's check.
      const nextHeadingMatch = afterName.match(/\n\s*(#{1,6}\s|\*\*[^*\n]+\*\*)/);
      const blockEnd = nextHeadingMatch ? nextHeadingMatch.index : afterName.length;
      pass = text.slice(nameIndex, nameIndex + capabilityName.length + blockEnd).includes(expectedTag);
    }
  } else {
    pass = expectedTag ? text.includes(expectedTag) : null;
  }

  return {
    pass: !!pass,
    score: null,
    notes: { expectedTag, capabilityName, found: pass, rawOutput: callResult.rawText },
    recommendation: pass ? null : 'Expected tag "' + expectedTag + '" not found near "' + (capabilityName || '(capability name not specified)') + '" in the response — check existing/new capability classification logic.'
  };
}

// BUG FIX (2026-09-XX): this previously received `callResult` (conversationA's
// own result, which has no .conversationB property) instead of `context`
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
    },
    recommendation: leaked.length
      ? 'Cross-session leak detected — Conversation B\'s response contained: ' + leaked.join(', ') + '. Check session/context isolation.'
      : null
  };
}

module.exports = {
  F: evalFormat,
  A1: evalDeltaCorrectness,
  A2: evalClassification,
  P1: evalPrivacyContainment
};
