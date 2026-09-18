# Test Suite Generator — Phase 1

Source: `Phase1-Generator-Addendum.md` (kept by Nethaji outside this repo,
alongside `RA-Test-Execution-Spec.md`). This file is the generator itself —
there is no separate script, because the actual work (reading an agent's
source code and inferring its real behavior) is a reasoning task, not a
deterministic transform. Invoke it via the `generate-agent-test-suite` skill
(`.claude/skills/generate-agent-test-suite/SKILL.md`) — the intended
invocation is "run this generator using <source files>", nothing more;
everything below (agent naming, output location, confidence labeling, the
smoke-test gate) is this file's job to resolve, not something the caller
should have to spell out per run.

Not Phase 2. This generator never executes or simulates the target agent's
own runtime logic — it drafts artifacts for a human to review. The invocation
strategy inside a drafted `invoke-config.js` is still a human (Gate 2) call.

## The only required input

**The new agent's actual source code** — one or more file paths, or pasted
contents. This is the only reliable source of non-obvious real behavior —
the kind of thing RA-H02's "leave the section out, never invent a
placeholder" rule or the RA-G02/G04 RAG-off discovery came from, and neither
would have surfaced from a description alone. Nothing else needs to be
supplied for the generator to run — every other decision below is resolved
automatically from what was actually given, not asked for up front.

**Optional additions, only if the caller happens to mention them — never
prompt for these if they weren't offered:**
- **A PRD or feature description.** Useful for intent and framing, never a
  substitute for source code.
- **An explicit agent name.** If omitted, derive one (see "Deriving the
  agent name" below) rather than asking.

## Resolving inputs automatically (do this, don't ask)

- **Confidence labeling is derived from what was actually supplied, not
  declared by the caller.** Source code given → `code-derived`, high
  confidence. Source code + a PRD → `code-derived with PRD context`. A PRD
  with no source code at all (source genuinely doesn't exist, or wasn't
  reachable) → `PRD-only`, low confidence, flagged per-section (see
  "Confidence labeling" below). Figure out which bucket applies from what
  was handed over — don't ask the caller to characterize it themselves.
- **Deriving the agent name**, if not given explicitly: look for how the
  product itself refers to this feature — a display name in UI strings,
  comments, or function names in the source (e.g. `requirement-agent.js`'s
  own `_ra*` prefix and "Requirement Agent" comments named that agent
  unambiguously). Convert to kebab-case for the folder
  (`test-suite/agents/<derived-name>/`). If genuinely ambiguous (source
  gives no clear product-facing name), that's the one case worth a single
  clarifying question — don't guess silently when the folder name is the
  thing every later step keys off of.
- **Output location is always `test-suite/agents/<agent-name>/`** — never
  ask where to put it.
- **Never write to, modify, or delete any other agent's existing folder.**
  This run's write scope is exactly one new (or explicitly-named existing,
  if re-running against the same agent) folder under `test-suite/agents/`.
  Treat every other agent's files as read-only context at most.
- **Run the automated smoke test yourself, as the last step of drafting**
  (see "Automated pre-check" below) — don't hand that back to the caller as
  a follow-up they need to remember to run. Report the PASS/FAIL result as
  part of saying the draft is done.

## What the generator produces

Four draft files, written into `test-suite/agents/<agent-name>/` (same
folder shape as every hand-authored agent — check the rubric-code table in
every OTHER agent's `*-Rubrics.md` before inventing a new one, so a fresh
draft never silently collides with an existing rubric letter, the way a
generator dry run against Requirement Agent once did with "B"):

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
4. `README.md` — mirror `requirement-agent/README.md`'s structure: the env
   vars this agent's `invoke-config.js` reads (derive names from the agent
   slug, e.g. `<AGENT>_TEST_AUTH_TOKEN` following RA's `RA_TEST_*`
   convention), any one-time fixture setup the drafted test cases assume,
   and known limitations carried over from the source-reading (DOM-coupling,
   any live-context dependency).

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

Before `invoke-config.js` reaches Gate 2 at all, the generator itself runs
the automated pre-check as the final step of drafting — not left for the
caller to remember:

```
node test-suite/framework/generator/smoke-test.js --agent <agent-name>
```

If it needs credentials the environment doesn't have (`RA_TEST_AUTH_TOKEN`-
style vars for the new agent, `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`),
say exactly which ones are missing and where to get them (the drafted
`README.md`) rather than silently skipping the check. A failing smoke test
means the draft isn't ready for a human to look at yet — fix it and rerun
before saying the draft is done.

## Workflow (hybrid: draft, then refine)

1. Caller invokes the `generate-agent-test-suite` skill with the agent's
   source (+ optionally a PRD, an explicit agent name). Nothing else needs
   to be specified — see "Resolving inputs automatically" above.
2. The generator reads the source, derives the agent name if not given,
   writes the four draft files described above (each carrying its
   confidence banner), runs the smoke test against the drafted
   `invoke-config.js`, and reports back: what it wrote, where, and the
   smoke-test result — all in one pass, without a follow-up prompt needed
   to trigger any of those sub-steps.
3. Reviewer reads the drafts in their own editor, edits directly if they want
   to, and tells the session what to change. The session refines in place
   (re-running the smoke test after any `invoke-config.js` change). Repeat
   until the reviewer is satisfied — this is the "refine" half; there is no
   fixed number of rounds.
4. Gate 1 and Gate 2 review happen independently (see
   `test-suite/agents/<agent-name>/REVIEW.md`, copied from
   `generator/REVIEW-CHECKLIST.md`).
5. Once both gates pass: hand-transcribe the approved `.md` files into
   `test-cases.json` / `rubrics.js` (same schema as `requirement-agent`'s),
   drop the approved `invoke-config.js` in alongside them, and run
   `node run-tests.js --agent <agent-name>` — the existing, unmodified
   pipeline, exactly as if the files had been hand-authored from scratch.
