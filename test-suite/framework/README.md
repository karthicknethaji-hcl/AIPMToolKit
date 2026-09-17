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
  rubric's `evaluatorType`: `script_diff` (pure JS, no model call),
  `llm_judge` (calls out via an injected `callJudgeModel(prompt)`), or
  `toxicity_scan` (same as `llm_judge`, run once across every other
  captured output in the run). Ragas is deferred to v2 — no handler here.

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
   captured output.
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
