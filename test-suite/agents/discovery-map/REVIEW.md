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
      passing" section). **Re-run again after the Gate 2 re-review fix
      below** (2026-09-18, hosted dev proxy): `trace_id
      818ce59b-97c0-4d78-8b63-13eda803c4b7`, `usage_event
      02c733ba-c466-428d-8450-c27a3a5f48aa` — confirms the fixed
      `invoke-config.js` still round-trips correctly.

A failing smoke test means the draft goes back to the generator step, not to
a human reviewer.

## Gate 1 — Product review (PM-owned)

Reviews: `<Agent>-Test-Cases.md`, `<Agent>-Rubrics.md`.

Question this gate answers: *does each test case reflect a real behavior
worth checking, and is each threshold right for the risk involved?* — the
same judgment already applied to Requirement Agent's own 37 cases.

- [x] Every `v1Scope: true`-intended case reflects a real, worth-checking
      behavior (not a PRD-only extrapolation presented as certain — check the
      confidence banner and any inline PRD-only flags).
- [x] Thresholds are appropriately strict/loose for the actual risk of each
      rubric (not just copied from another agent's defaults).
- [x] Any section flagged `(PRD-only — no corresponding code found...)` has
      been either confirmed against real behavior or explicitly deferred.

Reviewer: `__Nethaji___________________`  Date: `_Sep 18, 2026_____________________`
Verdict: `[x] Approved   [ ] Changes requested (see notes below)`

**Note on the pre-existing "[x] Approved" mark originally found here:** it
carried no reviewer name, date, or notes, so it was unchecked pending a
real decision rather than assumed (see history). Nethaji has since read
the notes below, made an explicit decision on all three policy items
(see "PM decisions recorded" further down), and checked Approved above
himself.

Notes: **Automated Gate 1 support pass (citation verification, collision
check, policy-call surfacing) — recommendation only, not a Gate 1
approval.**

**1. Citation verification — every "Rule source"/"Grounding source" citation
in `DM-Test-Cases.md` checked against the current `scripts/prompts.js` /
`scripts/kpi-tree.js`, line by line, not spot-checked. Result: zero
corrections needed.** Specifically re-read and confirmed word-for-word (not
just paraphrase-plausible):
- `buildTreePrompt` (`prompts.js:22-168`): CORE FRAMEWORKS list (`:86-101`),
  FALLBACK RULE (`:109`), AAER rule (`:47`) and Internal Tool→HEART routing
  (`:106`), SCOPE LOCK block (`:125-131`), custom-value-chain steps 2/3
  (`:141-142`), REFERENCE ANCHOR non-disclosure wording for both
  outcome-based (`:46`) and capability-based (`:158`, the stronger "do not
  name it in the output, do not ask the user"), the WRONG→RIGHT capability-
  naming table (`:161-165`), depth-1 schema/rule (`:32`, `:49`) and L2/L3/L4
  bounds (`:78-79`), em-dash ban (`:84`).
- `buildTreePromptManual` (`:178-242`): em-dash ban (`:180`), PLACEMENT step
  and "MUST appear exactly once... none may be dropped, split, or
  duplicated" (`:226`), the `allowAISuggestions:false` branch wording
  (`:227`).
- `buildDDPrompt` (`:546-563`): L4 placeholder rule (`:553`, exact string
  match), name-exact-match rule (`:555`), benchmark/red_flag wording
  (`:557-558`). Confirmed **no** em-dash-ban instruction anywhere in this
  function (DM-F02/DM-F04's claim is correct, not assumed).
- `buildProductLeakPrompt` (`:438-498`): "METRICS WITH EVIDENCE... ONLY
  metrics you may reason from" (`:474`), CRITICAL RULES 1-9 (`:486-494`,
  including the exact plain-string-array wording at `:491-492`), em-dash ban
  (`:458`).
- `buildMarketIntelPrompt` (`:595-602`): the uncertainty-disclosure
  instruction DM-H04 contrasts against `buildDDPrompt` — confirmed
  word-for-word: "If you are not confident about a specific figure, write:
  'Benchmark data not found - verify independently.'"
- `scripts/kpi-tree.js`: `_mmReconcileManualCaps()` full body (`:692-730`),
  including the exact `return false // strip unsanctioned AI additions`
  line DM-A04 cites (`:714-719`) and the stage-0 fallback-append block
  DM-A03 cites (`:696-729`); the depth-mismatch code comment DM-A05 cites
  (`:394-396`); the `renderMM()` warning-banner text DM-H02 cites verbatim
  (`:864-867`, "Framework attribution not available for this generation").

**2. Rubric-code collision check — read against `requirement-agent/
RA-Rubrics.md`'s full table (the only other onboarded agent).** `DM-Rubrics.
md` reuses G/H/A/F/L/X/N, and every one matches RA's own meaning for that
letter (Groundedness/Hallucination/Accuracy/Format/Completeness/
Adversarial/Robustness) — this is the intended kind of reuse, not a
collision. No new letter is introduced. RA's O/C/B/S/P/T are correctly left
out, each with a stated reason in `DM-Rubrics.md`'s own "Categories not
carried over" section — spot-checked those six reasons against RA-Rubrics.
md's actual definitions and none misrepresent what RA's letter means.

**3. Three items need an explicit PM policy call — presented as decisions,
not settled facts:**

- **DM-H04 (DD benchmark/red-flag confident fabrication).** (a) *Should
  this harness score it pass/fail?* Recommend **no** — keep it an
  LLM-judge advisory signal only (as `DM-Rubrics.md`'s H-confidence
  sub-rubric already proposes), since `buildDDPrompt`'s intent may
  genuinely be "directional estimate for PM framing," not verified data.
  (b) *Is `buildDDPrompt` itself worth changing* — adding an uncertainty
  escape hatch matching `buildMarketIntelPrompt`'s "verify independently"
  pattern? That's a call for whoever owns `scripts/prompts.js`, out of this
  harness's scope — needs a yes/no from Gate 1 so it doesn't quietly drop.
- **DM-F02/DM-F04 (missing em-dash ban in `buildDDPrompt`).** (a) *Should
  the harness fail DD output containing an em dash* despite the prompt
  never banning it there? Recommend **no** — `DM-F04` already excludes DD
  from that scan, which is correct as drafted. (b) *Is the missing line an
  oversight worth adding* for consistency with the other three prompts, or
  intentional? Low-risk one-line prompt change either way — worth a quick
  explicit decision rather than leaving it an open question in a comment.
- **DM-A03 (renamed manual capability survives with correct name, but lands
  in the wrong stage).** (a) *Should the harness require correct stage
  placement*, not just name survival, to pass? Recommend **no** for v1 —
  that would fail on a known, already-documented code limitation in
  `_mmReconcileManualCaps()`'s lowercase-exact-name matching, not a drafting
  mistake; track stage-placement fidelity as the separate secondary signal
  `DM-Rubrics.md`'s A rubric section already calls for instead. (b) *Is
  the underlying matching logic worth improving* (e.g. fuzzy/normalized
  name matching so a rename doesn't fully break placement)? That's a call
  for whoever owns `scripts/kpi-tree.js`, out of this harness's scope.

**Recommended verdict: Approved**, contingent on Gate 1 recording an
explicit answer (even "no change, accepted tradeoff") to the three
policy-call items above rather than leaving them as open comments in the
test-case file. No citation corrections and no rubric-collision fix are
needed before that sign-off.

---

**PM decisions recorded 2026-09-18 (Karthick Nethaji, via chat):**

- **DM-H04 (DD benchmark/red-flag fabrication):** **Not a hard test
  failure** — "bound to happen when the LLM can't pull the [real
  benchmark] data." Confirmed as this document's own recommendation:
  score as an LLM-judge advisory signal only, never pass/fail. No change
  to `buildDDPrompt` needed or requested.
- **DM-A03 (renamed manual capability lands in the wrong stage):** **No
  code change** — "it can stay on the same stage; it is the user's call
  to move [it] after a rename." `_mmReconcileManualCaps()`'s stage-0
  fallback-append behavior is accepted as-is. DM-A03 stays scored on
  name-survival only, exactly as drafted.
- **DM-F02/DM-F04 (missing em-dash ban in `buildDDPrompt`) — corrected,
  then re-confirmed.** PM's first answer was "should be a fix," given
  before a correction surfaced: **the original finding was wrong.**
  `buildDDPrompt`'s own returned text has no em-dash ban, but both of its
  real call sites (`scripts/capability-canvas.js:3027`,
  `scripts/metrics-definition.js:22`) always pair it with `SYS_DD`
  (`scripts/prompts.js:864`) as the system prompt, which already contains
  "Never use em dashes (—) in your output; use a hyphen (-) or rewrite
  the phrase" verbatim — checking `buildDDPrompt` in isolation missed
  this. **No gap exists in `scripts/prompts.js`; no fix was made.**
  PM re-confirmed (2026-09-18) after seeing the correction: **no fix
  needed** — with the explicit condition that DD output stays IN scope
  for DM-F04's em-dash scan and is scored as a genuine failure if a real
  em dash appears (the instruction genuinely applies to DD via `SYS_DD`,
  it just isn't restated inside `buildDDPrompt`'s own text). `DM-Test-
  Cases.md` (DM-F02, DM-F04) and `DM-Rubrics.md`'s F-rubric scope note
  are updated to reflect this final state — DD is no longer exempted
  from the DM-F04 scan. **Closed.**

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

---

**Gate 2 re-review, 2026-09-18 (Claude, formal `review-agent-invoke-config`
pass) — re-derived every claim above from source fresh rather than trusting
the prior pass's notes, plus completeness-checked the call-site inventory
itself:**

- Re-confirmed, unchanged from above: `SYS_TREE`/`SYS_LEAK` byte-identical
  to `scripts/kpi-tree.js:354` / `scripts/diagnostic-view.js:664`; `SYS_DD`
  correctly read live from `scripts/prompts.js:864` via the `vm` context;
  `fd` shape (`scripts/kpi-tree.js:244-260`); `_mmReconcileManualCaps()`
  port (`scripts/kpi-tree.js:692-730`) logic matches exactly, including
  the duplicate-drop and stage-0-fallback edge cases; `CALLER_TIERS`/
  `TIER_MODEL_BY_PROVIDER.anthropic.general` (`scripts/api.js:262,276,333`)
  still resolves `dm-generate`/`diagnostic-leak` to `claude-sonnet-4-6`.
- **Real fidelity gap found and fixed:** ran
  `grep -rn "buildDDPrompt(" scripts/` to re-derive the COMPLETE call-site
  inventory from scratch, rather than trusting the two call sites the
  original draft already knew about. Found a **third, previously-missed**
  real call site: `scripts/capability-canvas.js:3086-3092`
  (`ccDDGenerateAll()`, caller `'cc-dd-batch'`, `maxTokens: 8000`) — a
  distinct Capability Canvas "generate for all metrics" action, separate
  from `md-dd-batch`'s Metrics Definition screen equivalent. The prior
  `invoke-config.js` collapsed all multi-metric DD calls to `'md-dd-batch'`
  via a `metrics.length===1` heuristic, meaning it had **no way to
  represent the `cc-dd-batch` call path at all** — a real gap, not a
  cosmetic one, since `_caller` is exactly the field `mt_ai_usage_events`
  cost/analytics attribution keys off. Also re-confirmed via
  `grep -rn "buildTreePrompt(\|buildTreePromptManual(\|buildProductLeakPrompt("
  scripts/` that the other three target functions each have exactly one
  real call site — no equivalent gap there.
  - **Fix applied:** added an explicit `action.source` override
    (`'cc-dd-single' | 'cc-dd-batch' | 'md-dd-batch'`) to the `'dd'` mode,
    defaulting to the pre-fix heuristic for backward compatibility
    (`metrics.length===1` → `cc-dd-single`, else → `md-dd-batch`) so no
    existing test case needs to change, while making `cc-dd-batch` newly
    reachable for a test case that wants to represent it. Verified with a
    stubbed-`fetch` dry run covering all 5 combinations (default single,
    default batch, explicit `cc-dd-batch`, explicit `md-dd-batch`,
    explicit `cc-dd-single`) plus an invalid-`source` rejection — all
    returned the correct `(model, maxTokens, caller)` triple.
  - **Re-ran the real smoke test after the fix** (hosted dev proxy,
    2026-09-18): PASS — `trace_id 818ce59b-97c0-4d78-8b63-13eda803c4b7`,
    `usage_event 02c733ba-c466-428d-8450-c27a3a5f48aa` (recorded in the
    automated pre-check section above).
- No other discrepancies found. `README.md`'s DD-related documentation
  doesn't currently mention the `cc-dd-batch` source or the new `source`
  parameter — worth a follow-up doc note, not a blocking Gate 2 issue.

**Recommended verdict: Approved** (fix applied and re-verified; verdict
below re-confirmed at Nethaji's standing request for this agent's Gate 2 —
see the "no standing reviewer" note above).

## After both gates pass

- [x] Hand-transcribe the approved `.md` files into `test-cases.json` /
      `rubrics.js` (same schema as `requirement-agent`'s). Done 2026-09-18
      (`compile-agent-test-suite` skill) — 20 test cases, 15 rubric keys (G,
      H1, H2, H3, A1-A4, F1-F4, L, X, N). Sanity checks passed
      (`node -e "require('./test-cases.json')..."` → 20 cases loaded;
      `node -c rubrics.js` → OK; cross-reference check → every test case's
      `rubric` resolves to a defined key, every defined key is used by at
      least one case).
- [x] Drop the approved `invoke-config.js` in alongside them — already
      present from Gate 2 (no separate drop-in step needed; it never left
      this folder).
- [x] **Framework gap found during compile — RESOLVED 2026-09-18 (fixed in a
      separate thread, not as part of the compile step itself):**
      `evaluator.js`'s `script_diff` dispatch was hardcoded to Requirement
      Agent's own rubric keys and internal logic (`F`, `A1`, `A2`, `P1`),
      contrary to its own header comment and this compile skill's
      description of it as generic, per-rubric-agnostic dispatch. Fixed by
      making the dispatch generic: `evaluate()` now takes an injected
      `scriptChecks` map (an agent's own `scriptChecks.js`, loaded by
      `run-tests.js` the same way `invoke-config.js` already is) and looks
      up `testCase.rubric` in it, rather than branching on RA's specific
      keys inline. `requirement-agent/scriptChecks.js` now holds RA's four
      original functions verbatim (zero behavior change — regression-
      verified: F pass/fail, unknown-rubric error path, and the P1
      dual-conversation leak check all reproduce identically through the
      new dispatch). `discovery-map/scriptChecks.js` now implements all 11
      of this file's `script_diff` keys (`G`, `H1`, `A1`-`A4`, `F1`-`F4`,
      `L`), each matching the "Intended check" description `rubrics.js`'s
      own `notes` field specified — verified against 26 pass/fail scenarios
      built from this agent's own `test-cases.json` fixtures (both a
      passing shape and a deliberately-broken shape per rubric key, all 26
      produced the expected outcome). `run-tests.js --agent discovery-map`
      is no longer blocked on this — see the `run-agent-tests` skill for
      actually running it (still needs live credentials, a separate,
      unrelated prerequisite).
