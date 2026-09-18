// Discovery Map — script-diff rubric handlers.
// Implements the 11 script_diff rubric keys rubrics.js's own "NOT YET
// WIRED" notes specified at compile time (2026-09-18) — each function
// below follows exactly the "Intended check" description in the matching
// rubrics.js entry, cross-referenced against the real judgeContext field
// names test-cases.json actually uses for each test id. See
// test-suite/framework/evaluator.js's header comment for why this file
// exists (script_diff dispatch is agent-specific by nature, unlike
// llm_judge/toxicity_scan).
//
// Each handler: (testCase, rubric, callResult, context) => outcome (without
// the `evaluator` field — evaluator.js adds that after calling this).

const EM_DASH = '—';

function resolvePath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce(function (acc, key) { return acc == null ? acc : acc[key]; }, obj);
}

// G — evidence_boundary_compliance (DM-G01). Every metric name the response
// references in the given fields must be a member of judgeContext's
// evidenced set — plain set-membership, no LLM call.
function evalEvidenceBoundary(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const evidenced = new Set((jc.evidencedMetricNames || []).map(String));
  const parsed = callResult.parsed || {};
  const violations = [];
  const checkFields = jc.checkFields || ['primaryBottleneckMetric', 'secondaryConcern', 'experiments[].linkedMetricName'];
  for (const field of checkFields) {
    const arrayFieldMatch = field.match(/^(\w+)\[\]\.(\w+)$/);
    if (arrayFieldMatch) {
      const arrName = arrayFieldMatch[1];
      const subField = arrayFieldMatch[2];
      const arr = Array.isArray(parsed[arrName]) ? parsed[arrName] : [];
      arr.forEach(function (item, i) {
        const name = item && item[subField];
        if (name && !evidenced.has(name)) {
          violations.push(arrName + '[' + i + '].' + subField + ' references unevidenced metric "' + name + '"');
        }
      });
    } else {
      const value = resolvePath(parsed, field);
      if (value && !evidenced.has(value)) {
        violations.push(field + ' references unevidenced metric "' + value + '"');
      }
    }
  }
  const pass = violations.length === 0;
  return {
    pass, score: null,
    notes: { violations, rawOutput: callResult.rawText },
    recommendation: pass ? null : 'Evidence-boundary violation(s): ' + violations.join('; ')
  };
}

// H1 — covers three distinct real-source rules under one rubric letter,
// distinguished by which judgeContext fields a test case supplies:
//   DM-H02 shape (jc.requirePresent)     -> mandatory-field presence check
//   DM-H03 shape (jc.forbiddenStageShape) -> routing-table check
//   DM-H01 shape (default)                -> framework-fabrication check
function evalFrameworkAndFieldRules(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const parsed = callResult.parsed || {};
  const notes = { rawOutput: callResult.rawText };

  if (jc.requirePresent) {
    const value = resolvePath(parsed, jc.checkField);
    const pass = value !== undefined && value !== null && value !== '';
    notes.checkField = jc.checkField;
    notes.foundValue = value;
    return {
      pass, score: null, notes,
      recommendation: pass ? null : 'Required field "' + jc.checkField + '" is missing — mandatory per the prompt, even under sparse input.'
    };
  }

  if (jc.forbiddenStageShape) {
    const stageLabels = (Array.isArray(parsed.stages) ? parsed.stages.map(function (s) { return s && s.label; }) : []);
    const stageLabelsLower = stageLabels.map(function (l) { return String(l).toLowerCase(); });
    const forbiddenLower = jc.forbiddenStageShape.map(function (l) { return String(l).toLowerCase(); });
    const matchesForbidden = stageLabelsLower.length === forbiddenLower.length &&
      forbiddenLower.every(function (l) { return stageLabelsLower.includes(l); });
    const frameworks = resolvePath(parsed, jc.checkField) || [];
    const mentionsExpectedFamily = jc.expectedFrameworkFamily
      ? frameworks.some(function (f) { return String(f).toLowerCase().includes(jc.expectedFrameworkFamily.toLowerCase()); })
      : true;
    const pass = !matchesForbidden && mentionsExpectedFamily;
    notes.stageLabels = stageLabels;
    notes.frameworks = frameworks;
    return {
      pass, score: null, notes,
      recommendation: pass ? null : 'Wrong routing family — expected ' + jc.expectedFrameworkFamily + ', got stage shape ' +
        JSON.stringify(stageLabels) + ' / frameworks ' + JSON.stringify(frameworks) + '.'
    };
  }

  const frameworks = resolvePath(parsed, jc.checkField) || [];
  const allowed = (jc.allowedFrameworks || rubric.fixedFrameworkList || []).map(function (f) { return String(f).toLowerCase(); });
  const isFirstPrinciplesOnly = frameworks.length === 1 && String(frameworks[0]).toLowerCase() === 'first principles';
  const unknown = isFirstPrinciplesOnly ? [] : frameworks.filter(function (f) {
    return !allowed.some(function (a) { return String(f).toLowerCase().includes(a); });
  });
  const pass = isFirstPrinciplesOnly || unknown.length === 0;
  notes.frameworks = frameworks;
  notes.unknownFrameworks = unknown;
  return {
    pass, score: null, notes,
    recommendation: pass ? null : 'Fabricated/unknown framework name(s): ' + unknown.join(', ') +
      ' — not in the fixed CORE FRAMEWORKS list and not "First Principles".'
  };
}

// A1 — scope_lock_diff (DM-A01). Every stage NOT named in
// judgeContext.targetStageLabel must be byte-identical (id, label, every
// l1_metrics[].name in order) between the fixture's priorTree and the
// refined response.
function evalScopeLockDiff(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const probe = testCase.probe || {};
  const before = (probe.priorTree && probe.priorTree.stages) || [];
  const after = (callResult.parsed && callResult.parsed.stages) || [];
  const targetLabel = jc.targetStageLabel;
  const violations = [];
  const afterByLabel = new Map(after.map(function (s) { return [s && s.label, s]; }));
  for (const beforeStage of before) {
    if (beforeStage.label === targetLabel) continue;
    const afterStage = afterByLabel.get(beforeStage.label);
    if (!afterStage) { violations.push('Stage "' + beforeStage.label + '" is missing from the refined tree.'); continue; }
    if (afterStage.id !== beforeStage.id) violations.push('Stage "' + beforeStage.label + '" id changed.');
    const beforeNames = (beforeStage.l1_metrics || []).map(function (m) { return m.name; });
    const afterNames = (afterStage.l1_metrics || []).map(function (m) { return m.name; });
    if (JSON.stringify(beforeNames) !== JSON.stringify(afterNames)) {
      violations.push('Stage "' + beforeStage.label + '" metrics changed: ' + JSON.stringify(beforeNames) + ' -> ' + JSON.stringify(afterNames));
    }
  }
  const pass = violations.length === 0;
  return {
    pass, score: null,
    notes: { violations, rawOutput: callResult.rawText },
    recommendation: pass ? null : 'Scope-lock violation(s) outside "' + targetLabel + '": ' + violations.join('; ')
  };
}

// A2 — custom_value_chain_preservation (DM-A02). Stage count and label set
// must match the supplied custom value chain exactly.
function evalValueChainPreservation(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const stages = (callResult.parsed && callResult.parsed.stages) || [];
  const actualLabels = stages.map(function (s) { return s && s.label; });
  const expectedLabels = jc.expectedStageLabels || [];
  const expectedCount = jc.expectedStageCount != null ? jc.expectedStageCount : expectedLabels.length;
  const countOk = stages.length === expectedCount;
  const actualSet = new Set(actualLabels.map(String));
  const missing = expectedLabels.filter(function (l) { return !actualSet.has(l); });
  const extra = actualLabels.filter(function (l) { return !expectedLabels.includes(l); });
  const pass = countOk && missing.length === 0 && extra.length === 0;
  return {
    pass, score: null,
    notes: { actualLabels, expectedLabels, missing, extra, rawOutput: callResult.rawText },
    recommendation: pass ? null : 'Custom value chain not preserved — missing: ' + JSON.stringify(missing) + ', extra: ' + JSON.stringify(extra) + '.'
  };
}

// A3 — manual_capability_placement (DM-A03, DM-A04). Covers both: every
// supplied name present exactly once (DM-A03), and — when
// expectedCapabilityCount is given (DM-A04) — the total count matches
// exactly with zero forbidden-flagged entries.
function evalManualCapabilityPlacement(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const stages = (callResult.parsed && callResult.parsed.stages) || [];
  const allMetrics = [];
  stages.forEach(function (s) { (s.l1_metrics || []).forEach(function (m) { allMetrics.push(m); }); });
  const violations = [];

  const supplied = jc.suppliedCapabilityNames || [];
  for (const name of supplied) {
    const matches = allMetrics.filter(function (m) { return m && m.name === name; });
    if (matches.length === 0) violations.push('Supplied capability "' + name + '" is missing.');
    else if (matches.length > 1) violations.push('Supplied capability "' + name + '" appears ' + matches.length + ' times (expected exactly once).');
  }

  if (jc.expectedCapabilityCount != null) {
    if (allMetrics.length !== jc.expectedCapabilityCount) {
      violations.push('Total capability count is ' + allMetrics.length + ', expected exactly ' + jc.expectedCapabilityCount + '.');
    }
    if (jc.forbiddenFlag) {
      const flagged = allMetrics.filter(function (m) { return m && m[jc.forbiddenFlag]; });
      if (flagged.length) violations.push(flagged.length + ' unsanctioned AI-suggested capability(ies) present despite allowAISuggestions:false.');
    }
  }

  const pass = violations.length === 0;
  return {
    pass, score: null,
    notes: { violations, rawOutput: callResult.rawText },
    recommendation: pass ? null : 'Manual capability placement violation(s): ' + violations.join('; ')
  };
}

// A4 — depth_schema_conformance (DM-A05). Recursive key-presence walk, not
// string matching — must not false-positive on a metric literally named
// "l2_metrics" in prose.
function evalDepthSchemaConformance(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const forbiddenKeys = new Set(jc.forbiddenKeys || []);
  const stages = (callResult.parsed && callResult.parsed.stages) || [];
  const violations = [];
  function walk(node, path) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(function (item, i) { walk(item, path + '[' + i + ']'); }); return; }
    for (const key of Object.keys(node)) {
      if (forbiddenKeys.has(key)) {
        violations.push('Forbidden key "' + key + '" found at ' + path + '.' + key + ' — depth ' + jc.kpiDepth + ' schema violation.');
      }
      walk(node[key], path + '.' + key);
    }
  }
  stages.forEach(function (s, i) { walk(s, 'stages[' + i + ']'); });
  const pass = violations.length === 0;
  return {
    pass, score: null,
    notes: { violations, rawOutput: callResult.rawText },
    recommendation: pass ? null : violations.join('; ')
  };
}

// F1 — capability_naming_no_metric_suffix (DM-F01). Case-insensitive
// end-of-string match against the forbidden suffix list.
function evalNoMetricStyleSuffix(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const suffixes = jc.forbiddenSuffixes || [];
  const stages = (callResult.parsed && callResult.parsed.stages) || [];
  const names = [];
  stages.forEach(function (s) { (s.l1_metrics || []).forEach(function (m) { if (m && m.name) names.push(m.name); }); });
  const escaped = suffixes.map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  const pattern = new RegExp('\\b(' + escaped.join('|') + ')$', 'i');
  const violations = names.filter(function (n) { return pattern.test(n.trim()); });
  const pass = violations.length === 0;
  return {
    pass, score: null,
    notes: { violations, checkedNames: names, rawOutput: callResult.rawText },
    recommendation: pass ? null : 'Capability name(s) end in a metric-style suffix: ' + violations.join(', ') + '.'
  };
}

// F2 — l4_placeholder_compliance (DM-F02). Every named L4 entry's
// definition/benchmark/red_flag must equal the required placeholder
// exactly — not "N/A", not empty, not a real-looking value.
function evalL4PlaceholderCompliance(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const l4Names = jc.l4MetricNames || [];
  const required = jc.requiredPlaceholder || EM_DASH;
  const fields = jc.checkFields || ['definition', 'benchmark', 'red_flag'];
  const ddArray = Array.isArray(callResult.parsed) ? callResult.parsed : [];
  const violations = [];
  for (const name of l4Names) {
    const entry = ddArray.find(function (e) { return e && e.name === name; });
    if (!entry) { violations.push('L4 metric "' + name + '" missing from DD output.'); continue; }
    for (const f of fields) {
      if (entry[f] !== required) {
        violations.push('L4 metric "' + name + '" field "' + f + '" is ' + JSON.stringify(entry[f]) + ', expected literally "' + required + '".');
      }
    }
  }
  const pass = violations.length === 0;
  return {
    pass, score: null,
    notes: { violations, rawOutput: callResult.rawText },
    recommendation: pass ? null : violations.join('; ')
  };
}

// F3 — plain_string_array_fields (DM-F03). Every element of the named
// fields must be a plain string, never an object.
function evalPlainStringArrayFields(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const fields = jc.checkFields || [];
  const requiredType = jc.requiredElementType || 'string';
  const parsed = callResult.parsed || {};
  const violations = [];
  for (const field of fields) {
    const value = parsed[field];
    if (!Array.isArray(value)) { violations.push('Field "' + field + '" is not an array.'); continue; }
    value.forEach(function (el, i) {
      if (typeof el !== requiredType) violations.push('Field "' + field + '[' + i + ']" is ' + typeof el + ', expected ' + requiredType + '.');
    });
  }
  const pass = violations.length === 0;
  return {
    pass, score: null,
    notes: { violations, rawOutput: callResult.rawText },
    recommendation: pass ? null : violations.join('; ')
  };
}

// F4 — no_em_dash_in_output (DM-F04). background-scan execution mode:
// run-tests.js passes { allCapturedOutputs } as context, callResult is a
// throwaway {rawText:''} — read from context, not callResult, here.
//
// Real false positive found on first live run (2026-09-18): DM-F02's own
// captured output legitimately contains an em dash as the exact, REQUIRED
// L4 placeholder value ("definition": "—") — F2's own check requires this
// literal value. A raw substring scan can't tell that apart from a genuine
// stray em dash in prose, so it flagged DM-F02 as a DM-F04 violation for
// doing exactly what DM-F02 requires. Strip the standalone JSON-string-
// value form ("—", i.e. a field whose entire value is one em dash) before
// scanning — that pattern can only occur as the L4 placeholder itself,
// never as an em dash embedded inside a longer sentence (which would have
// other characters between the em dash and the surrounding quotes).
const STANDALONE_EM_DASH_VALUE = /"—"/g;
function evalNoEmDashAcrossAllOutputs(testCase, rubric, callResult, context) {
  const outputs = (context && context.allCapturedOutputs) || [];
  const violations = [];
  for (const item of outputs) {
    if (!item || !item.text) continue;
    const withoutPlaceholders = item.text.replace(STANDALONE_EM_DASH_VALUE, '');
    if (withoutPlaceholders.includes(EM_DASH)) violations.push(item.testId);
  }
  const pass = violations.length === 0;
  return {
    pass, score: null,
    notes: { violations, checkedCount: outputs.length },
    recommendation: pass ? null : 'Em dash found in output(s) from: ' + violations.join(', ') + '.'
  };
}

// L — dd_coverage (DM-L01). Set-equality between the input metric list and
// the DD output's names — exact match, no LLM call.
function evalDdCoverage(testCase, rubric, callResult) {
  const jc = testCase.judgeContext || {};
  const expected = jc.expectedMetricNames || [];
  const ddArray = Array.isArray(callResult.parsed) ? callResult.parsed : [];
  const actualNames = ddArray.map(function (e) { return e && e.name; });
  const expectedSet = new Set(expected);
  const actualSet = new Set(actualNames);
  const missing = expected.filter(function (n) { return !actualSet.has(n); });
  const extra = actualNames.filter(function (n) { return !expectedSet.has(n); });
  const countOk = jc.expectedCount != null ? ddArray.length === jc.expectedCount : true;
  const pass = countOk && missing.length === 0 && extra.length === 0;
  return {
    pass, score: null,
    notes: { missing, extra, actualCount: ddArray.length, rawOutput: callResult.rawText },
    recommendation: pass ? null : 'DD coverage mismatch — missing: ' + JSON.stringify(missing) + ', extra: ' + JSON.stringify(extra) + '.'
  };
}

module.exports = {
  G: evalEvidenceBoundary,
  H1: evalFrameworkAndFieldRules,
  A1: evalScopeLockDiff,
  A2: evalValueChainPreservation,
  A3: evalManualCapabilityPlacement,
  A4: evalDepthSchemaConformance,
  F1: evalNoMetricStyleSuffix,
  F2: evalL4PlaceholderCompliance,
  F3: evalPlainStringArrayFields,
  F4: evalNoEmDashAcrossAllOutputs,
  L: evalDdCoverage
};
