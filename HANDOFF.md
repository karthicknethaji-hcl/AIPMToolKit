# Handoff — Requirement Agent Discovery-First Entry Point redesign

**Written:** 2026-08-07, end of a long session, ahead of a context-window cutoff.
**Status:** Code committed as `v9.18` (see `CHANGELOG.md`'s top entry for the shipped summary). **User has reported issues still visible in the app despite fixes described as complete below** — treat every "confirmed live" claim in this doc as *true at the moment it was tested*, not as a guarantee it still holds after later edits in the same session. See "Known risk areas" near the bottom before assuming anything is solid.

---

## 1. What this engagement was

A full redesign of the **Requirement Agent** module (`scripts/requirement-agent.js`) — moving its trigger point from Capability Canvas to Discovery Map ("Discovery-First Entry Point"), changing Finalize to create capabilities only (no feature generation), adding capability-to-metric bucketing, Origin/Brief filters across Capability/Feature/Story/Release Canvas, and a document-upload capability. Built from a spec the user had already approved externally (spec files were shared from local Downloads, not stored in this repo — if a future session needs the original spec text, ask the user to re-share `RA-REDESIGN-SPEC*.md` and `ra-redesign-prototypes.html`/`origin-filter-prototype.html`, since they aren't checked in).

This was followed by **two rounds of user QA** against the live app (localhost:3000, a static file server — no build step, edits take effect on page reload), each producing a written list of issues (from `.docx` files in Downloads) that were validated against code before fixing, then a **third, narrower bug report** (this most recent one) about the Discovery Map CTA regression.

## 2. Current repo state

- `scripts/config.js`'s `APP_VERSION` bumped to `'v9.18'`.
- `CHANGELOG.md` has a new top entry (`## v9.18`) summarizing everything below — read that first, it's the most concise accurate summary.
- All work is committed (commit message describes the same scope as the changelog entry) — check `git log -1` to confirm this actually landed before assuming it did.
- 18 files touched in total: `index.html`, `DESIGN_SYSTEM.md`, `PROJECT_MAP.md`, `scripts/{capability-canvas,export-pi-docx,feature-canvas,home,kpi-tree,left-panel,pi-planning,prompts,requirement-agent,session-store,settings-page,state,story-canvas-new,utils,config}.js`, `styles/{08-feature-canvas,23-requirement-agent}.css`.

## 3. Everything built, by round

### Round 0 — the core redesign (spec-approved, built first)
- RA triggers from Discovery Map's CTA (relabels "Continue to Capability Canvas" → "Define Requirements" when `raEnabled`), not Capability Canvas. `#tab-ra` moved in the tab row (between DM and CC).
- CC's old RA entry point removed (`raDefineRequirements()` deleted from `requirement-agent.js`, its CTA removed from `capability-canvas.js`'s `_ccActionBarHtml()`, `ccBuildFeatPanel()`'s suppression branch collapsed) — CC now behaves identically regardless of `raEnabled`.
- Finalize (`raRunFinalizeSequence()` in `requirement-agent.js`) creates capabilities only — no feature generation, no `scCanvas` push. Navigates to CC (`ccSelectFirstPopulatedMetric()` auto-selects the first populated metric), not Feature Canvas.
- Feature generation moved fully to CC's manual "Generate Features" button, grounded in the brief (`buildRAFeatureGenPrompt()`) when `cap.intakeBriefId` is non-null — targeted per-capability extraction, not the whole `liveDraftMd` blob.
- Story generation consolidated into the one live path (`scBuildStoryPrompt()` in `feature-canvas.js`); the dormant, never-called `buildPIStoryPrompt()` stub deleted from `prompts.js`.
- New Origin filter value "Requirement Agent" (nested per-RQ sub-list) on CC and FC; standalone flat "Brief" filter on Story Canvas and PI/Release Canvas.
- Live Draft UI: NEW/EXISTING capability pill, feature-level `(new)` suffix + expandable narrative.
- `PROJECT_MAP.md` given a proper `requirement-agent.js` entry (didn't have one before).

### Round 1 — 19 QA issues (first `.docx` report)
Confirmed-and-fixed (see `CHANGELOG.md` v9.18 entry for detail, this list is just pointers):
- CC tab no longer reveals itself right after DM generates when RA is on (was unconditional in `kpi-tree.js`).
- DM CTA re-renders when the RA Settings toggle flips while already on the `mm` tab (`left-panel.js`'s `applyFeats()` guard removed).
- Finalize button disabled until real draft content exists; separate warning when Finalize would create zero capabilities.
- **Capability bucketing** — the single biggest fix. New capabilities resolve against a real Discovery Map metric/process area (`_raResolveExistingMetricBucket()` in `requirement-agent.js`, including a stage-level fallback for genuinely cross-cutting capabilities) instead of always landing in a generic "Custom Value Stage" bucket. New Live Draft tag convention: `(will be created — under: <Metric/Process Area Name>)`.
- **RQ provenance fix** — a capability name-collision across two different RA conversations no longer silently reassigns the earlier conversation's `intakeBriefId`/`rqNumber` to the later one (ownership check added before treating a name match as "the same capability").
- Story Canvas's Brief filter extracted into its own standalone button (was incorrectly nested inside the shared Filter dropdown).
- Outcome Pulse now also requires Feature Canvas content before revealing (was Discovery-Map-only).
- "PI Canvas" → "Release Canvas" label-only rename (internal `pi`-prefixed code untouched, by explicit user decision).
- `.sc-cap-breadcrumb` missing `min-width:0` (FC card metric label overflow) — **note: round 2 found I'd fixed the WRONG class the first time** (`.sc-metric-breadcrumb`, which is dead code) — the correct class was fixed in round 2.

### Round 1.5 — document upload (separate user request mid-session)
- `_DOC_CANVAS_ROUTING.ra` added in `utils.js` so Session Documents (uploaded at session launch) automatically ground RA's prompts via `buildDocContext('ra')`.
- New mid-chat "Upload a document" chip in RA's own chat panel (`raHandleUpload()` in `requirement-agent.js`), reusing the same shared `extractTextFromFile()` parser Guided Launch/Home already use. Ephemeral — raw text never persisted, matching Guided Launch's convention exactly.

### Round 2 — 8 more QA issues (second `.docx` report)
- Capability `.why` now uses the model's own descriptive bullets (new parser field in `_raParseTouchedCapabilities()`) instead of a hardcoded "Created by Requirement Agent for this release." string.
- **Fixed the actually-rendered breadcrumb class** (`.sc-cap-breadcrumb`) — round 1's fix targeted a dead/unused class by mistake.
- **Confirmed real regression**: manually-generated features (via CC's "Generate Features") never inherited `intakeBriefId`/`rqNumber` from their parent RA-created capability — fixed at all 3 write sites (`ccGenerateFeaturesForCapClick`'s two call sites, plus `ccSendToStoryCanvas()`'s `scCanvas` push).
- RQ sub-list now always shows in the Origin filter regardless of RQ count (was suppressed at exactly 1 RQ, per the original prototype — reversed per explicit feedback for a uniform experience).
- Live Draft right panel no longer repeats the conversation title.
- Conversation title now AI-generated (`suggestedTitle` field added to both opening-turn prompts) instead of hardcoded boilerplate.
- Document upload (`.docx` specifically) — **could not reproduce.** Tested live with both a `.txt` and a real, freshly-constructed `.docx` file — both processed correctly end-to-end (mammoth.js CDN loaded fine, AI correctly used the content). If this is still broken for the user, it needs a fresh repro with specifics (exact error/behavior, file size/complexity, whether the page was refreshed after the feature was added).

### Round 3 — Discovery Map CTA regression (this session's last fix, not yet in a QA doc)
- User reported: after DM completes, CTA shows "Continue to Capability Canvas" instead of "Define Requirements".
- Root cause (confirmed via code trace, NOT caused by round 1's `applyFeats()` fix): `raResetState()` in `requirement-agent.js` — pre-existing code from v9.16, never touched before this fix — hardcoded `raEnabled=false` on every session clear/relaunch (`homeClearSession()`), with nothing resyncing it from `appSettings.featRA` before DM's CTA rendered.
- A second, related instance found in the same investigation: `session-store.js`'s session-restore path trusted each session's own **persisted** `raEnabled` snapshot value over the live company-wide setting.
- Both fixed: `raEnabled` now always resyncs from `appSettings.featRA` (the authoritative, global source) in both the reset path and the restore path.
- **Verified live** in both directions (session clear → relaunch, and session resume) — confirmed working at the time of testing.

## 4. Known risk areas — read this before assuming anything is solid

The user explicitly said issues are still visible despite claims of fixes. Reasons that's plausible, ranked by likelihood:

1. **Piecemeal verification, not full-system regression testing.** Every fix in rounds 1–3 was verified individually (often via direct JS console calls in the browser, not full manual click-through), immediately after being written. There has been **no single end-to-end pass testing all fixes together** in combination, and no re-test of round 0/round 1 items after round 2/3's edits landed on top of them. An earlier fix could have been silently broken by a later one touching the same function.
2. **String-matching fragility in the bucketing fix.** `_raResolveExistingMetricBucket()` matches the AI's named metric/stage against `gData` by exact (trimmed, case-insensitive) string equality. If the model paraphrases even slightly (pluralization, punctuation, a synonym), the match silently fails and the capability falls through to a new custom bucket instead of the intended existing one — this would look like "bucketing still doesn't work" to a user despite the fix being "confirmed" in the one test case that happened to match exactly.
3. **Title generation only fires on the opening turn.** If that turn's `suggestedTitle` comes back generic (plausible for a Pass 1 conversation with zero user input yet), the title never improves later — no mechanism re-titles a conversation as it gets more specific.
4. **Never tested with real, complex documents.** The `.docx` upload test used a minimal, hand-built file (two paragraphs, no tables/images/formatting). A real PRD with tables, embedded images, or unusual structure could break mammoth.js's extraction in ways the test didn't cover — this is the most likely explanation if `.docx` upload is still failing for the user.
5. **PI/Release Canvas's Brief filter was never tested against a session with an actual generated Release Plan** — the test session had `piPlan === null`, so the whole toolbar (not just the filter) was in its empty state. The filter code was only confirmed correct by static review, not a live render with real data.
6. **Story Canvas's standalone Brief filter was never clicked in a browser** — only confirmed by reading the code, not by live interaction.
7. **No fresh, holistic code review of the diff as a whole.** Each fix was reviewed in isolation against its own specific bug; nobody has read all 18 changed files together looking for cross-file inconsistencies (e.g., a helper renamed/removed in one file but still referenced elsewhere).

## 5. How to resume in a new chat

1. **Get specifics before touching code again.** Ask the user exactly which issues are still visible — screenshot or written repro, which screen/action, what they expected vs. saw. Don't re-guess at the same 19+8 items; the fixes for those were each verified at the time, so a repeat report needs to say *which one* and *how* it's still failing, or whether it's a genuinely new issue.
2. **Read `CHANGELOG.md`'s `## v9.18` entry first** — it's the authoritative, concise summary of what changed and why. Read `PROJECT_MAP.md`'s Requirement Agent entry second, for the current-state architecture description.
3. **Check `git log`/`git diff` against the previous commit** if anything seems to have reverted or half-applied — confirm the commit this doc describes actually landed cleanly.
4. **Re-verify live before trusting any "confirmed" claim above** — the app runs at `localhost:3000` via a static file server (`.claude/launch.json` has the `static-site` config using `npx serve`); reload the page after any edit, no build step needed.
5. **If the bucketing fix is the complaint**, first check the exact metric/stage name the AI proposed (in the Live Draft's "under: X" tag) against `gData.stages[].l1_metrics[].name` for an exact string mismatch before assuming the resolver logic itself is wrong — per risk #2 above, this is the most likely failure mode.
6. **The naming collision between this RA module and Guided Launch (which briefly shared the "Requirement Agent" label in v9.16) is explicitly still unresolved and out of scope** — don't accidentally conflate a Guided Launch bug report with a Requirement Agent one; they are different files/tabs.

## 6. Files touched this engagement (for a fast `git diff` scan)

```
index.html
DESIGN_SYSTEM.md
PROJECT_MAP.md
CHANGELOG.md
scripts/capability-canvas.js
scripts/export-pi-docx.js
scripts/feature-canvas.js
scripts/home.js
scripts/kpi-tree.js
scripts/left-panel.js
scripts/pi-planning.js
scripts/prompts.js
scripts/requirement-agent.js
scripts/session-store.js
scripts/settings-page.js
scripts/state.js
scripts/story-canvas-new.js
scripts/utils.js
scripts/config.js
styles/08-feature-canvas.css
styles/23-requirement-agent.css
```
