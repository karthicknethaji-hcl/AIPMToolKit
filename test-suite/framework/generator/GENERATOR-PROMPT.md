# Test Suite Generator — Phase 1

Source: `Phase1-Generator-Addendum.md` (kept by Nethaji outside this repo,
alongside `RA-Test-Execution-Spec.md`). This file is the generator itself —
there is no separate script, because the actual work (reading an agent's
source code and inferring its real behavior) is a reasoning task, not a
deterministic transform. Run it by pasting/referencing this file's contents
in a Claude Code session, not by executing anything.

Not Phase 2. This generator never executes or simulates the target agent's
own runtime logic — it drafts artifacts for a human to review. The invocation
strategy inside a drafted `invoke-config.js` is still a human (Gate 2) call.

## What you (the reviewer) provide

1. **The new agent's actual source code** (required, when it exists). This is
   the only reliable source of non-obvious real behavior — the kind of thing
   RA-H02's "leave the section out, never invent a placeholder" rule or the
   RA-G02/G04 RAG-off discovery came from, and neither would have surfaced
   from a description alone.
2. **A PRD or feature description** (optional, supplementary). Useful for
   intent and framing, never a substitute for source code.
3. If only a PRD is available (no source code), say so explicitly up front —
   the output is still produced, but every artifact is flagged low-confidence
   (see "Confidence labeling" below), not presented with the same authority
   as code-derived output.

## What the generator produces

Three draft files, written into `test-suite/agents/<new-agent-name>/` (same
folder shape as every hand-authored agent):

1. `<Agent>-Test-Cases.md` — human-readable test case descriptions (mirror
   `requirement-agent/RA-Test-Cases.md`'s structure: one entry per test id,
   category, rubric, scope, execution mode, setup/probe, expected behavior,
   failure mode).
2. `<Agent>-Rubrics.md` — human-readable rubric descriptions (mirror
   `requirement-agent/RA-Rubrics.md`'s structure: metric, scale, evaluator
   type, threshold, what the judge is actually asked).
3. `invoke-config.js` — a draft implementing the standard two-function
   contract (`createConversationState()` / `async sendMessage(state, action)`
   returning `{rawText, parsed, parseError, clientTraceId, systemPrompt}`),
   built by inspecting the source for: the real endpoint, the real request/
   response shape, and whether the agent's core logic is headlessly callable
   or coupled to something a Node script can't reach (DOM, browser storage,
   a framework runtime) — in which case, follow RA's own precedent (Option
   1c: a hand-built request matching the real call shape, documented as an
   accepted known limitation, not hidden).

Do **not** also produce `test-cases.json` or `rubrics.js` (the machine-
readable files `run-tests.js` actually loads) until after both gates pass —
those are hand-transcribed from the approved `.md` files as the last step,
same as RA's own onboarding, so the reviewed prose and the executable config
never silently diverge.

## Confidence labeling (inline banner, not a filename suffix)

A filename suffix like `-draft` is fragile — it disappears silently if a
reviewer renames the file while editing. Every generated `.md` file instead
opens with this exact banner (fill in the bracketed parts):

```
> **DRAFT — pending review, not yet approved for execution.**
> Source: [code-derived | PRD-only | code-derived with PRD context]
> Confidence: [high | low — flag PRD-only sections explicitly]
```

`invoke-config.js` gets the same information as a top-of-file comment block,
plus one line naming it the lowest-confidence, highest-scrutiny artifact of
the three (see "Two gates" below).

For PRD-only input, don't stop at one document-level banner — flag the
individual sections or test cases where you're extrapolating from the PRD
rather than citing something concrete found in code, e.g. `_(PRD-only —
no corresponding code found; confirm this behavior actually exists)_`
inline, right where the reviewer's attention should land.

## Two gates — independent, both required before the suite is trusted

- **Gate 1 (PM-owned):** `<Agent>-Test-Cases.md` + `<Agent>-Rubrics.md`. Is
  this test case a real behavior worth checking; is this threshold right for
  the risk involved. Same judgment already applied to RA's 37 cases.
- **Gate 2 (engineer-owned, separate from Gate 1):** `invoke-config.js`. Does
  this hand-built request faithfully represent the agent's real runtime
  behavior; is a DOM-coupling (or similar) workaround handled honestly. Gate
  1 passing never substitutes for Gate 2.
- Per Nethaji's decision, there is no standing Gate 2 reviewer assignment yet
  — who reviews it is decided per agent, at onboarding time, until a second
  agent is actually being onboarded makes a fixed assignment worth deciding.

Before `invoke-config.js` reaches Gate 2 at all, run the automated pre-check:

```
node test-suite/framework/generator/smoke-test.js --agent <new-agent-name>
```

A failing smoke test means the draft isn't even ready for a human to look at
— fix it and rerun before requesting Gate 2 review.

## Workflow (hybrid: draft, then refine)

1. Reviewer hands this file's instructions + the agent's source (+ optional
   PRD) to a Claude Code session.
2. The session writes the three draft files described above, each carrying
   its confidence banner, and says explicitly what it wrote and where — never
   a silent write. This is the "one-shot" first pass.
3. Reviewer reads the drafts in their own editor, edits directly if they want
   to, and tells the session what to change. The session refines in place.
   Repeat until the reviewer is satisfied — this is the "refine" half; there
   is no fixed number of rounds.
4. Reviewer runs `smoke-test.js` against the draft `invoke-config.js`. Fix
   and rerun until it passes.
5. Gate 1 and Gate 2 review happen independently (see
   `test-suite/agents/<new-agent-name>/REVIEW.md`, copied from
   `generator/REVIEW-CHECKLIST.md`).
6. Once both gates pass: hand-transcribe the approved `.md` files into
   `test-cases.json` / `rubrics.js` (same schema as `requirement-agent`'s),
   drop the approved `invoke-config.js` in alongside them, and run
   `node run-tests.js --agent <new-agent-name>` — the existing, unmodified
   pipeline, exactly as if the files had been hand-authored from scratch.
