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
- `RA_TEST_PROXY_URL` (optional) — defaults to
  `http://localhost:3001/api/anthropic` (the local dev proxy). Point this
  at the hosted dev proxy if not running the proxy locally.
- `RA_TEST_MODEL` (optional) — defaults to `claude-sonnet-5`.

Result persistence to `mt_ai_quality_scores` (optional, see the framework
README) reuses `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — the same names
`proxy/server.js` uses.

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

- **RA-G03** — a Discovery Map with a specific named metric already present.
- **RA-A02** — a capability that genuinely already exists on Capability
  Canvas.

Set these up once in `pgt-dev` before running these two cases.
