# Generator output review — two independent gates

Copy this file to `test-suite/agents/<new-agent-name>/REVIEW.md` when
onboarding a generator-assisted agent (`GENERATOR-PROMPT.md`) and fill it in
as each gate completes. Per `Phase1-Generator-Addendum.md`: **both gates must
pass independently before the suite is trusted** — Gate 1 passing does not
imply or substitute for Gate 2, and vice versa.

Agent: `______________________`
Generator input: `[ code-derived | PRD-only | code-derived with PRD context ]`

## Automated pre-check (required before Gate 2 review starts)

```
node test-suite/framework/generator/smoke-test.js --agent <new-agent-name>
```

- [ ] Smoke test passed (all 3 checks: response shape, `mt_ai_traces`,
      `mt_ai_usage_events`). Paste the `PASS` line's `trace_id`/`usage_event`
      here for the record: `______________________`

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
Verdict: `[ ] Approved   [ ] Changes requested (see notes below)`

Notes:

## Gate 2 — Technical review (engineer-owned, separate from Gate 1)

Reviews: `invoke-config.js`, and `scriptChecks.js` if this agent has any
`script_diff`-typed rubric (both are hand-written, agent-specific code
making a fidelity claim — same scrutiny applies to both).

Question this gate answers: *does this hand-built request/check faithfully
represent the agent's real runtime behavior, and is any DOM-coupling (or
similar) workaround handled honestly, not silently?* — the same judgment this
project's own review applied to Requirement Agent's Option 1c decision.

- [ ] The endpoint, request shape, and auth match what the real agent
      actually sends (checked against source, not assumed from the draft's
      own comments).
- [ ] Any coupling the drafted invocation can't reach (DOM, browser storage,
      a framework runtime) is named explicitly as a known, accepted
      limitation — not glossed over.
- [ ] `sendMessage()` returns `clientTraceId` and, if available,
      `systemPrompt` (needed for the recommendation feature — see
      `../README.md`'s "`mt_ai_quality_scores.recommendation`" section).
- [ ] If this agent has any `script_diff` rubric: `scriptChecks.js` exports
      a real function for every such rubric key (not a stub that always
      passes), and each function actually implements what that rubric's
      `notes`/description says it checks — verified with at least one
      deliberately-passing and one deliberately-failing mock input per
      function, not just confirmed to run without throwing.
- [ ] Smoke test result above is from *this* version of the file (rerun it
      if `invoke-config.js` changed since).

Reviewer: `______________________`  Date: `______________________`
Verdict: `[ ] Approved   [ ] Changes requested (see notes below)`

Notes:

## After both gates pass

- [ ] Hand-transcribe the approved `.md` files into `test-cases.json` /
      `rubrics.js` (same schema as `requirement-agent`'s).
- [ ] Drop the approved `invoke-config.js` in alongside them.
- [ ] Run `node run-tests.js --agent <new-agent-name>` — no framework code
      changes needed for this step.
