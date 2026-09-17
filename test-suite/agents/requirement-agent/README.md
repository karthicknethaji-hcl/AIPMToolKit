# Requirement Agent — test suite

First agent onboarded to the Agent Test Execution Framework
(`test-suite/framework/`). See that folder's README for how the framework
itself works.

## Contents

- `RA-Test-Cases.md` — human-readable source of truth, 37 cases across 13
  categories.
- `RA-Rubrics.md` — human-readable pass criteria, evaluator routing, and
  resolved v1 thresholds per category.
- `test-cases.json` — machine-readable mirror of `RA-Test-Cases.md`, 29
  cases active in v1 (`v1Scope: true`), 8 deferred but fully defined
  (`v1Scope: false`).
- `rubrics.js` — machine-readable mirror of `RA-Rubrics.md`, including the
  actual judge-prompt templates and resolved thresholds.
- `invoke-config.js` — how the runner actually calls Requirement Agent.

**Manual sync discipline:** `test-cases.json`/`rubrics.js` are hand-mirrors
of the two markdown docs, not generated from them. When RA-Test-Cases.md or
RA-Rubrics.md changes, update the corresponding JSON/JS file by hand in the
same change — the harness does not check that these stay in sync.

## Running it

```
cd test-suite/framework
RA_TEST_AUTH_TOKEN=<supabase JWT for the pgt-dev session>
RA_TEST_COMPANY_ID=<pgt-dev's company_id>
node run-tests.js --agent requirement-agent
```

Env vars `invoke-config.js` reads:
- `RA_TEST_AUTH_TOKEN` (required) — a Supabase Auth JWT for a signed-in
  session in the `pgt-dev` test company, same credentials already used for
  manual dev testing (per the spec's resolved auth decision — no separate
  test tenant). This proxy endpoint's token expires; get a fresh one from
  the browser session (dev tools → Application → local/session storage →
  the Supabase auth token) before each run.
- `RA_TEST_COMPANY_ID` (required) — `pgt-dev`'s `company_id` UUID.
- `RA_TEST_PRODUCT_ID` (required for RA-G03/RA-A02, optional otherwise) —
  the product/session the harness fetches real Discovery Map/Capability
  Canvas state for (see "Live session context" below). In the browser
  console on the Product Studio page, with the product you want to test
  against active, run `activeProfileId` — that's the value.
- `RA_TEST_PROXY_URL` (optional) — defaults to
  `http://localhost:3001/api/anthropic` (the local dev proxy). Point this
  at the hosted dev proxy if not running the proxy locally.
- `RA_TEST_MODEL` (optional) — defaults to `claude-sonnet-4-6`. Must be one
  of `proxy/providerAdapters.js`'s `MODEL_CATALOG_BY_PROVIDER` entries for
  the `anthropic` provider, or the proxy rejects the call before it ever
  reaches the model.

Result persistence to `mt_ai_quality_scores`, **and fetching live Discovery
Map/Capability Canvas context** (see below), both reuse
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — the same names `proxy/server.js`
uses. Without these two set, the harness still runs every case, it just has
no real session data to inject and won't persist results.

## Live session context — Discovery Map / Capability Canvas

`invoke-config.js` fetches the most recent `mt_sessions` row for
`RA_TEST_COMPANY_ID` + `RA_TEST_PRODUCT_ID` (there's no "active session"
flag in the schema — most-recent `saved_at` is a heuristic, not a
guarantee), reads its `snapshot.gData` (Discovery Map) and
`snapshot.capStore` (Capability Canvas), and appends a rendered summary of
both into every call's system prompt. This is fetched once per harness run
(not re-fetched per turn) and requires `SUPABASE_SERVICE_ROLE_KEY` — without
it, RA sees no real Discovery Map/Capability Canvas state at all, and
RA-G03/RA-A02 will have nothing genuine to match against regardless of
what's set up in the app.

## Known limitation — request-fidelity (accepted, not hidden)

Per `RA-Test-Execution-Spec.md` Section 3, Option 1c: `invoke-config.js`
calls `/api/anthropic` directly with a hand-built request (same body shape
`scripts/api.js`'s `callAPI()` sends) and its own hand-maintained
approximation of RA's system prompt. It does **not** `require()` or drive
`scripts/requirement-agent.js`'s own orchestration code — that file is
DOM/window/localStorage-coupled throughout and isn't currently a pure,
headlessly-callable function, and touching it to make it so is out of
scope for this build (Section 1's production-code boundary).

Practical effect: this harness exercises RA's actual system-prompt and
RAG-pipeline behavior on the live proxy, but does not guarantee
byte-identical fidelity to what the real UI sends for complex multi-turn
conversation state (accumulated history, live-draft state, document-
attachment bookkeeping). If results start diverging suspiciously from real
UI behavior, the natural fast-follow is extracting RA's real
turn-construction logic into a DOM-free module — a narrowly-scoped change
to production code, reviewed on its own, not assumed away here.

The system prompt in `invoke-config.js` is a condensed, hand-maintained
approximation of `scripts/prompts.js`'s real `buildTreePrompt` output —
keeping it reasonably aligned as RA's real prompt evolves is the same kind
of manual discipline as the test-cases.json/RA-Test-Cases.md sync above.

## v1 execution scope: 29 of 37 cases

8 cases are defined but not run by default (`v1Scope: false`) — pass
`--all` to include them anyway (`repeat-n` mode cases are still skipped,
see the framework README):

- **RA-B01, RA-B02, RA-T01, RA-T02** — Bias/Tone, the two least
  mechanically-checkable rubrics, deferred as a fast-follow.
- **RA-C01, RA-C02** — Consistency, requires a `repeat-n` execution mode
  not implemented in v1.
- **RA-G02, RA-G04** — `pgt-dev` has Requirement Agent's RAG toggle off
  (matching the company-wide default while the underlying Azure OpenAI
  embedding call is blocked by IT/compliance policy). G02's premise
  (cross-turn retrieval via the persistent RAG pipeline) isn't exercisable
  in this environment; G04 becomes redundant once RAG-off is the only mode
  in play.

## Fixture dependencies

A few active cases assume pre-existing state in the test company/product
context that this harness's own chat turns cannot create (noted per-case
in `test-cases.json` as `fixtureDependency`):

- **RA-G03** — a Discovery Map with a specific named metric ("Repeat
  Purchase Rate" under a "Retention" stage) already present.
- **RA-A02** — a capability ("Loyalty Tier Progress") that genuinely
  already exists on Capability Canvas.

Set these up once in `pgt-dev`, for the specific product `RA_TEST_PRODUCT_ID`
points to — Discovery Map has no "add a stage/metric" button, so the
practical path is: in Capability Canvas, add a capability and pick "Custom
Process Area"/"Custom Metric" as its bucket (this creates a new stage with
one metric), then use Discovery Map's Edit Stage / edit-metric actions to
rename them to the names above. Both `RA_TEST_PRODUCT_ID` and
`SUPABASE_SERVICE_ROLE_KEY` must also be set (see "Live session context"
above) or the harness has no way to see this fixture even once it exists.
