# Agent Test Execution Framework

Source spec: `RA-Test-Execution-Spec.md` v0.4 (kept by Nethaji outside this
repo; the resolved decisions it documents are reflected in the code here).

Standalone, manually-triggered Node script that runs an agent's AI-quality
test suite and scores each case against that agent's own rubrics. No CI
pipeline — that's an acknowledged future upgrade path, not part of this
build.

## Running it

```
node run-tests.js --agent requirement-agent
```

Flags:
- `--only id1,id2` — run just these test ids, regardless of `v1Scope`.
- `--all` — also run cases marked `v1Scope: false` (deferred categories).
  `repeat-n` execution mode is still skipped either way — it's reserved in
  the schema but not implemented in this v1 (Consistency is fully deferred).

Env vars (see each agent's own README for the specific values it needs):
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — optional. Without these,
  results print to console only and are not written to
  `mt_ai_quality_scores`.
- `TEST_HARNESS_JUDGE_MODEL` — optional, defaults to `claude-sonnet-4-6`
  (must be one of `proxy/providerAdapters.js`'s known models for the
  `anthropic` provider).

## What lives here vs. in an agent's own folder

This folder (`run-tests.js`, `evaluator.js`) contains **zero references to
any specific agent**. Everything agent-specific — test cases, rubric
thresholds, judge-prompt templates, and how to actually invoke that agent
— lives in `test-suite/agents/<agent-name>/`.

- `run-tests.js` — reads an agent's `test-cases.json` / `rubrics.js` /
  `invoke-config.js`, dispatches each test case by its declared
  `executionMode` (`single-turn` / `multi-turn` / `dual-conversation` /
  `repeat-n` reserved / `background-scan`), and writes results.
  Dispatching by `executionMode` is a framework-level concern — an agent's
  `invoke-config.js` only needs to expose two primitives:
  `createConversationState()` and `async sendMessage(state, action)`.
- `evaluator.js` — routes each test case to one of three handlers by its
  rubric's `evaluatorType`: `script_diff`, `llm_judge` (calls out via an
  injected `callJudgeModel(prompt)`), or `toxicity_scan` (same as
  `llm_judge`, run once across every other captured output in the run).
  Ragas is deferred to v2 — no handler here. `llm_judge`/`toxicity_scan`
  are genuinely generic — a rubric's own `judgePromptTemplate` is all the
  "logic" there is. `script_diff` is different: there's no generic JS diff
  that works for every agent's output shape, so each agent supplies its own
  `scriptChecks.js` (object keyed by rubric letter), loaded by
  `run-tests.js` and passed into `evaluate()` alongside `callJudgeModel` —
  `evaluator.js` itself contains no agent-specific check logic (fixed
  2026-09-18: an earlier revision hardcoded Requirement Agent's F/A1/A2/P1
  keys directly here, silently breaking "agent-agnostic" for this one
  evaluator type — see the file's own header comment).

## `mt_ai_quality_scores.recommendation`

Every scored case gets a `recommendation` — `null` if it passes. For
`script_diff` rubrics, the evaluator deterministically turns its own
violation finding into one readable sentence (no model call). For
`llm_judge` rubrics, the judge generates it in the same call that produces
the score — and `evalLlmJudge()` centrally prepends the actual system
prompt the agent was operating under (`callResult.systemPrompt`, if the
agent's `sendMessage()` returns one) plus a shared instruction asking for a
specific, quotable prompt change plus a short example, rather than a vague
pointer. This instruction lives once in `evaluator.js`, not duplicated
across every rubric's own `judgePromptTemplate` — a rubric only needs to
ask for a `"recommendation"` field; what that field should *contain* is a
framework-level policy.

This is a suggestion for a human to review and apply, not an auto-patch —
nothing in this harness writes to any agent's production prompt code.

## Onboarding a new agent

1. Create `test-suite/agents/<new-agent-name>/`.
2. Add `test-cases.json` (see any existing agent's file for the schema —
   `testId`, `category`, `rubric`, `v1Scope`, `executionMode`, `setup`/
   `probe`/`conversationA`+`conversationB` depending on mode, `judgeContext`).
3. Add `rubrics.js` exporting an object keyed by rubric code, each entry
   giving `evaluatorType`, `threshold` (or `null` for binary/zero-tolerance),
   and — for `llm_judge`/`toxicity_scan` — a `judgePromptTemplate` string
   using `{{placeholder}}` tokens filled from `judgeContext` and the
   captured output. **For any `script_diff` rubric, also add
   `scriptChecks.js`** exporting a real function per such rubric key
   (`module.exports = {<letter>: (testCase, rubric, callResult, context) => outcome}`)
   — see `requirement-agent/scriptChecks.js` or
   `discovery-map/scriptChecks.js` for the shape. A `script_diff` rubric
   with no matching key here fails every case with "No script-diff handler
   wired," by design (loud and specific, not a silent pass).
4. Add `invoke-config.js` exporting `{ agentName, createConversationState(),
   async sendMessage(state, action) }` for however that agent is actually
   invoked (a direct API call, an ingestion endpoint, browser automation —
   whatever fits that agent's real architecture). `sendMessage()` should
   also return `systemPrompt` (the exact prompt text used for that call) if
   available — the evaluator feeds it to the judge on a fail, so
   recommendations can name a specific prompt change instead of a vague
   pointer. Optional: recommendations still work without it, just less
   concretely.
5. Run `node run-tests.js --agent <new-agent-name>`.

`run-tests.js` and `evaluator.js` are never touched for this.

Steps 2–4 above can be drafted rather than hand-authored from scratch — see
"Test suite generator (Phase 1)" below.

## Test suite generator (Phase 1)

Source: `Phase1-Generator-Addendum.md` (kept by Nethaji outside this repo,
alongside `RA-Test-Execution-Spec.md`). Onboarding Requirement Agent meant
hand-authoring all three of its files from scratch across this project's
first build; this generator drafts them instead, so the next agent doesn't
repeat that cost.

**Invocation:** the `generate-agent-test-suite` skill
(`.claude/skills/generate-agent-test-suite/SKILL.md`) — "run this generator
using `<source files>`" is the entire ask; agent naming, output location,
confidence labeling, and the smoke-test gate are all resolved automatically
rather than asked for per run.

- **`generator/GENERATOR-PROMPT.md`** — the generator's full rules (the
  skill above is a thin wrapper around this). There's no script for the
  drafting step itself: reading an agent's source and inferring its real
  behavior is a reasoning task, so this file is instructions a Claude Code
  session follows (source code required, a PRD optional-supplementary),
  producing draft `<Agent>-Test-Cases.md` / `<Agent>-Rubrics.md` /
  `invoke-config.js` / `README.md`, each opening with a `DRAFT — pending
  review` confidence banner. Workflow is hybrid: one drafting pass
  (including running the smoke test below, automatically), then iterative
  refinement with the reviewer before either gate.
- **`generator/smoke-test.js`** — automated pre-check, run by the generator
  itself as the last step of drafting, before a human reviewer ever sees the
  draft: `node generator/smoke-test.js --agent <agent-name>`. Confirms the
  draft actually reaches the real endpoint, gets a well-formed response, and
  — the full DB round-trip, not just response shape — is recorded in both
  `mt_ai_traces` and `mt_ai_usage_events`. Requires `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` (unlike `run-tests.js`, this check is
  meaningless without them, so it errors out rather than degrading).
- **`generator/REVIEW-CHECKLIST.md`** — copy to
  `test-suite/agents/<agent-name>/REVIEW.md`. Records two *independent*
  approval gates — Gate 1 (PM-owned: test-cases + rubrics, a product
  judgment call) and Gate 2 (engineer-owned: invoke-config fidelity, a
  technical judgment call). Gate 1 passing never substitutes for Gate 2.

Four decisions worth recording here, since they shaped the design and
aren't obvious from the files alone:
- **Invocation is a single low-friction ask, not a multi-question intake.**
  A dry run against Requirement Agent's own source (this thread) showed the
  generator can derive the agent name, the confidence level, and the output
  path from the source alone — asking for those separately just adds
  friction the generator doesn't need.
- **No standing Gate 2 reviewer is assigned.** Only Requirement Agent has
  been onboarded so far; who reviews the next agent's `invoke-config.js` is
  decided per-agent, at onboarding time, rather than fixed in advance.
- **The smoke test checks the full DB round-trip**, not just response
  shape/auth — a drafted `invoke-config.js` that reaches the endpoint but
  never gets traced or logged is still a failing draft.
- **The workflow is draft-then-refine, not one-shot** — mirrors how
  Requirement Agent's own test cases and rubrics actually got iterated in
  this project (draft, feedback, refine, approve), not a single
  take-it-or-leave-it generation pass.

Phase 2 (an LLM that generates a *self-executing* invoke-config by
simulating an agent's own runtime, without a human deciding invocation
strategy) is explicitly out of scope — see the addendum's "Deferred to
Phase 2" section for why.
