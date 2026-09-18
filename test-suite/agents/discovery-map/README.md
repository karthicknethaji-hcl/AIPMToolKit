# Discovery Map — test suite

Second agent onboarded to the Agent Test Execution Framework
(`test-suite/framework/`), after `requirement-agent`. See that folder's
README for how the framework itself works.

## Contents

- `DM-Test-Cases.md` — human-readable source of truth, 20 cases across 7
  categories (G, H, A, F, L, X, N).
- `DM-Rubrics.md` — human-readable pass criteria, evaluator routing, and
  the rubric-code collision check against `requirement-agent/RA-Rubrics.md`.
- `invoke-config.js` — how the runner actually calls Discovery Map.
- `test-cases.json` / `rubrics.js` — **not created yet.** Per
  `GENERATOR-PROMPT.md`, these machine-readable files are hand-transcribed
  from the two `.md` files above only after both Gate 1 and Gate 2 pass —
  see "After both gates pass" below.

**Manual sync discipline:** once `test-cases.json`/`rubrics.js` exist,
they're hand-mirrors of the two markdown docs, not generated from them —
same discipline as `requirement-agent`'s own files.

## What this agent covers

Discovery Map is not one conversational agent but four related generation
functions in `scripts/prompts.js`, all reachable from the Discovery Map /
Diagnostic View / Capability Canvas screens:

- **Tree generation** — `buildTreePrompt` (fresh generation and
  scope-locked refinement), called from `scripts/kpi-tree.js`'s
  `generateConfirmed()`.
- **Manual capability placement** — `buildTreePromptManual`, same call
  site, used when the PM supplies their own capability list.
- **Metric Definitions (DD)** — `buildDDPrompt`, called from
  `scripts/capability-canvas.js` (single-metric refresh) and
  `scripts/metrics-definition.js` (full batch).
- **Product Leak diagnostic** — `buildProductLeakPrompt`, called from
  `scripts/diagnostic-view.js`.

## Running it

```
cd test-suite/framework
DM_TEST_AUTH_TOKEN=<supabase JWT for the pgt-dev session>
DM_TEST_COMPANY_ID=<pgt-dev's company_id>
node run-tests.js --agent discovery-map
```

(`run-tests.js` invocation above is illustrative — this suite has not run
through Gate 1/Gate 2 yet; see "After both gates pass" below for the actual
prerequisite steps.)

Env vars `invoke-config.js` reads:
- `DM_TEST_AUTH_TOKEN` (required) — a Supabase Auth JWT for a signed-in
  session in the `pgt-dev` test company, same credentials/convention as
  `requirement-agent`'s `RA_TEST_AUTH_TOKEN`. Get a fresh one from the
  browser session (dev tools → Application → local/session storage → the
  Supabase auth token) before each run.
- `DM_TEST_COMPANY_ID` (required) — `pgt-dev`'s `company_id` UUID.
- `DM_TEST_PRODUCT_ID` (optional) — attached to the request body's
  `product_id` field for usage-tracking realism. Unlike
  `requirement-agent`, no test case in this suite depends on fetching real
  Discovery Map/Capability Canvas session state from Supabase — every test
  case's input context (product profile, prior tree, evidence tags,
  manual capability list) is constructed directly in the test case's own
  setup and passed straight into the real prompt-builder functions. This
  is a genuine simplification versus `requirement-agent`'s live-context
  fetch, not an oversight.
- `DM_TEST_PROXY_URL` (optional) — defaults to
  `http://localhost:3001/api/anthropic` (the local dev proxy).
- `DM_TEST_TREE_MODEL` / `DM_TEST_LEAK_MODEL` (optional) — default
  `claude-sonnet-4-6` each, matching the real per-caller tier resolution
  for `dm-generate`/`diagnostic-leak` (`scripts/api.js`'s `CALLER_TIERS` +
  `TIER_MODEL_BY_PROVIDER.anthropic.general`). Discovery Definitions (DD)
  calls always use `claude-haiku-4-5` — hardcoded in `invoke-config.js`,
  not env-overridable, because the real call sites hardcode it too
  (`scripts/capability-canvas.js:3027`, `scripts/metrics-definition.js:22`)
  and this suite intentionally stays byte-identical to that rather than
  making it configurable.

Result persistence to `mt_ai_quality_scores` reuses
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, same names `proxy/server.js`
and `requirement-agent/invoke-config.js` use. Without these set, the
harness still runs every case, it just won't persist results.

## Known limitation — request-fidelity (accepted, not hidden)

Split into two halves with two different fidelity levels — see the header
comment in `invoke-config.js` for the full reasoning:

1. **Prompt construction — high fidelity.** `scripts/prompts.js`'s four
   target functions (`buildTreePrompt`, `buildTreePromptManual`,
   `buildDDPrompt`, `buildProductLeakPrompt`) are pure string builders with
   no DOM/window/localStorage coupling. `invoke-config.js` loads the real,
   unmodified `scripts/prompts.js` file into a Node `vm` context and calls
   the actual production functions verbatim — not a hand-copied
   approximation the way `requirement-agent/invoke-config.js`'s system
   prompt is. `buildTreePrompt`'s two optional global reads (`gData`,
   `appSettings`, both already `typeof`-guarded in the source) are stubbed
   per call.
   - One function is hand-ported rather than vm-loaded:
     `_mmReconcileManualCaps()` (`scripts/kpi-tree.js:692-730`, the
     deterministic post-processing pass for manual-capability mode) lives
     in a file that, taken as a whole, is DOM-coupled — but the function's
     own body has zero such dependencies, so it's copied verbatim into
     `invoke-config.js`'s `reconcileManualCaps()`. Keeping these two in
     sync is the same manual-sync discipline as the `.md`/`.json` pairing
     above — if `scripts/kpi-tree.js`'s real function changes, this copy
     needs a matching edit.
2. **Network/auth layer — Option 1c, same as `requirement-agent`.**
   `scripts/api.js`'s `callAPI()` is itself DOM/window/localStorage-coupled
   (`window.location.hostname`, `localStorage.getItem`,
   `authGetFreshToken()`) and isn't headlessly callable. `invoke-config.js`
   hand-builds the request body to the same shape `callAPI()` sends,
   rather than driving that function directly.

If results start diverging suspiciously from real UI behavior, check
`scripts/prompts.js` for a shape change first (the vm-load will throw
loudly if the four expected functions go missing, but a signature change
that still leaves them callable would fail silently) — this is a smaller,
more contained risk than `requirement-agent`'s equivalent risk, precisely
because the prompt-construction half here is the real code, not an
approximation of it.

## Fixture dependencies

None. Unlike `requirement-agent`'s RA-G03/RA-A02 (which need a specific
Discovery Map metric / Capability Canvas entry pre-existing in `pgt-dev`),
every Discovery Map test case constructs its own input context inline
(product profile, prior tree for refinement mode, evidence-tagged metric
list, manual capability list) — there is no live-session state this suite
needs pre-seeded in a real company/product.
