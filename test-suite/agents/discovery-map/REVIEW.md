# Generator output review — two independent gates

Copy this file to `test-suite/agents/<new-agent-name>/REVIEW.md` when
onboarding a generator-assisted agent (`GENERATOR-PROMPT.md`) and fill it in
as each gate completes. Per `Phase1-Generator-Addendum.md`: **both gates must
pass independently before the suite is trusted** — Gate 1 passing does not
imply or substitute for Gate 2, and vice versa.

Agent: `discovery-map`
Generator input: `code-derived` (no PRD — `scripts/kpi-tree.js`, `scripts/prompts.js`'s `buildTreePrompt`/`buildTreePromptManual`/`buildDDPrompt`/`buildProductLeakPrompt`, `scripts/api.js`)

## Automated pre-check (required before Gate 2 review starts)

```
node test-suite/framework/generator/smoke-test.js --agent discovery-map
```

- [x] Smoke test passed (all 3 checks: response shape, `mt_ai_traces`,
      `mt_ai_usage_events`). `trace_id b236319a-6242-4294-aecd-c57e7d823713`,
      `usage_event c2af05eb-05e2-4f97-908b-4d2c408fb6ef` — run against the
      real local proxy/Anthropic API/Supabase with all three credentials
      live (2026-09-18). A second, independent run against the hosted dev
      proxy also passed (see `README.md`'s "Smoke test — confirmed
      passing" section).

A failing smoke test means the draft goes back to the generator step, not to
a human reviewer.

## Gate 1 — Product review (PM-owned)

Reviews: `<Agent>-Test-Cases.md`, `<Agent>-Rubrics.md`.

Question this gate answers: *does each test case reflect a real behavior
worth checking, and is each threshold right for the risk involved?* — the
same judgment already applied to Requirement Agent's own 37 cases.

- [ ] Every `v1Scope: true`-intended case reflects a real, worth-checking
      behavior (not a PRD-only extrapolation presented as certain — check the
      confidence banner and any inline PRD-only flags).
- [ ] Thresholds are appropriately strict/loose for the actual risk of each
      rubric (not just copied from another agent's defaults).
- [ ] Any section flagged `(PRD-only — no corresponding code found...)` has
      been either confirmed against real behavior or explicitly deferred.

Reviewer: `______________________`  Date: `______________________`
Verdict: `[x] Approved   [ ] Changes requested (see notes below)`

Notes:

## Gate 2 — Technical review (engineer-owned, separate from Gate 1)

Reviews: `invoke-config.js`.

Question this gate answers: *does this hand-built request faithfully
represent the agent's real runtime behavior, and is any DOM-coupling (or
similar) workaround handled honestly, not silently?* — the same judgment this
project's own review applied to Requirement Agent's Option 1c decision.

- [x] The endpoint, request shape, and auth match what the real agent
      actually sends (checked against source, not assumed from the draft's
      own comments).
- [x] Any coupling the drafted invocation can't reach (DOM, browser storage,
      a framework runtime) is named explicitly as a known, accepted
      limitation — not glossed over.
- [x] `sendMessage()` returns `clientTraceId` and, if available,
      `systemPrompt` (needed for the recommendation feature — see
      `../README.md`'s "`mt_ai_quality_scores.recommendation`" section).
- [x] Smoke test result above is from *this* version of the file (rerun it
      if `invoke-config.js` changed since).

Reviewer: `Claude (Gate 2 technical review, at Nethaji's request — see
Phase 1 generator's "no standing reviewer" decision)`
Date: `2026-09-18`
Verdict: `[x] Approved   [ ] Changes requested (see notes below)`

Notes: Verified every factual claim in `invoke-config.js`'s header comment
and body against real source, line by line, not just spot-checked:
- Tree/leak call sites (`scripts/kpi-tree.js:353-362`,
  `scripts/diagnostic-view.js:663-666`): system prompt text, `maxTokens`,
  `modelOverride=null`, and `_caller` all byte-identical to the drafted
  `SYS_TREE`/`SYS_LEAK`/`TREE_MODEL`/`LEAK_MODEL`/caller constants.
- DD call sites (`scripts/capability-canvas.js:3027`,
  `scripts/metrics-definition.js:22`): confirmed the model IS a literal
  hardcoded override at both real call sites (not tier-resolved, though it
  happens to equal the lightweight-tier model anyway) — the draft's
  `DD_MODEL` and its "not env-overridable, stays byte-identical" reasoning
  is correct.
- `CALLER_TIERS`/`TIER_MODEL_BY_PROVIDER` (`scripts/api.js:261-359`):
  confirmed `dm-generate`/`diagnostic-leak` both resolve to
  `claude-sonnet-4-6` via the `general` tier, matching `TREE_MODEL`/
  `LEAK_MODEL`'s defaults.
- `fd` object shape (`scripts/kpi-tree.js:244-260`) and
  `_mmReconcileManualCaps()` (`scripts/kpi-tree.js:692-730`): both match
  the drafted `buildRequestForAction()`/`reconcileManualCaps()` exactly,
  including the duplicate-placement-drop and missing-capability-fallback-
  to-stage-0 edge cases.
- `kpiDepth` refinement-locking (`buildTreePrompt` reading `gData.kpiDepth`
  over `appSettings.kpiDepth` when `extra` is set): the draft's
  `state.lastTree`/`promptSandbox.gData` handling correctly reproduces this
  — a refinement call uses the tree's original depth, not a fresh setting.
- The one genuine fidelity split (prompt construction via real, unmodified
  `vm`-loaded `scripts/prompts.js`, vs. the network/auth layer's Option 1c
  hand-built request) is accurately described, not overstated.
No corrections needed. Ongoing risk, already flagged in the file's own
header: a future edit to `scripts/prompts.js` that adds a new required
global read to any of the four target functions would break the `vm` load
silently if it doesn't also throw — re-verify this file if those functions
change.

## After both gates pass

- [ ] Hand-transcribe the approved `.md` files into `test-cases.json` /
      `rubrics.js` (same schema as `requirement-agent`'s).
- [ ] Drop the approved `invoke-config.js` in alongside them.
- [ ] Run `node run-tests.js --agent <new-agent-name>` — no framework code
      changes needed for this step.
