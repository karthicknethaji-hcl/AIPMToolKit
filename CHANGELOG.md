# Changelog — AI PM Toolkit

## v8.98 — PI Generation: rearchitected prioritization logic, timeout fix, loader fix

**Context:** PI generation was timing out (`Anthropic upstream timeout after 120000ms`) on large sessions (64 stories). Root cause: the Change 7 prompt asked the model to do four sequential things in one call — MoSCoW gate, dependency graph traversal + cycle detection, goal-weighted scoring, capacity-aware sequencing + backfill — with full prose reasoning per story, none of which were actually AI reasoning tasks except the semantic subscores and dependency inference.

**Rearchitecture (`prompts.js`, `pi-planning.js`):**
- `buildPIGeneratePrompt()` rewritten — the AI now returns ONLY per-story semantic judgment (`piGoalAlignment`+`alignmentReason`, `businessValue`, `timeCriticality`, `riskReduction`, `vocSupport`/`docConflict`) and dependency edges (`fromId`/`toId`, parsed from PM free text + AI-inferred). No sequencing, no squad assignment, no composite score arithmetic, no MoSCoW/tier output.
- New deterministic engine in `pi-planning.js`: `piDiagnosticBoost()` (lookup-table calc from existing story fields, no AI needed), `piComputeScore()` (composite score arithmetic), `piBuildBlocksGraph()`/`piDetectCycles()` (3-color DFS cycle detection), `piEscalate()` (memoized post-order tier/score propagation through dependency chains), `piSequence()` (capacity-aware greedy sequencing with mandatory backfill pass, per-sprint capacity = squad.capacity/sprintCount).
- Squad "most relevant squad" assignment removed — squads only carry `{name, capacity}` in this data model, so assignment is now pure load-balancing (most-remaining-capacity-first). The prior "relevance" behavior was an ungrounded heuristic with no skill/specialization data behind it.
- Cyclic dependency stories are now deterministically detected and backlogged with a clear reason, rather than relying on the model to self-report a `cycleFlag`.
- Dynamic token budget reduced: `Math.min(10000, Math.max(3000, stories.length*120+1500))`, down from an uncapped `Math.max(6000, stories.length*200+3000)`.
- Fixed a pre-existing shape mismatch found while rewriting the dependency-assembly code: the SC-carry-forward block was pushing `{from, to, type}` while every other consumer of `piPlan.dependencies` (drag-and-drop, blocker lookups, dependency badges) reads `.fromId`/`.toId`/`.external`. Now consistent everywhere.

**Timeout (`proxy/server.js`):** `UPSTREAM_TIMEOUT_MS` is now per-caller (`TIMEOUT_BY_CALLER` lookup) instead of one global constant — `pi-generate` gets 150s, everything else stays at 120s, so the bump doesn't tie up the proxy longer for unrelated callers that hang.

**Loader (`pi-planning.js`):** the generic (non-abort) catch branch in `piGenerate()` was never resetting `#pi-main` — a timeout, parse error, or invalid-response error left the "Generating PI Plan…" spinner on screen indefinitely even though the error toast fired. Added the same `piRenderEmpty()` reset the AbortError branch already had. Loader copy and leave-warning text updated to reflect realistic 2–4 minute generation time.

## v8.97 — Fix: white border during wireframe capture (FC, PI, Prototype exports)

**Root cause:** `_pcCaptureWireframeAsPng` appended wireframe HTML directly to `document.body` via `div.innerHTML = safeHTML`. AI-generated wireframe HTML contains `<style>` tags with global selectors (`body { background: #fff }`, `* { box-sizing: border-box }`, etc.). Style tags inside a div appended to `document.body` are not scoped — they become live document styles for the full capture duration (200ms settle + html2canvas render). This overrode the real app's layout and background, producing a thick white border around the entire app on all four sides. Affected FC Brief, PI Plan, and Prototype Canvas exports.

**Fix:** Replaced div approach with a programmatically-written same-origin iframe (`visibility:hidden`, `left:-10000px`). The iframe document contains reset CSS and the wireframe content. CSS inside the iframe is fully scoped — zero leakage into the live app. The iframe is removed in the `finally` block. One function change in `prototype-canvas.js` fixes all three export paths.

**Also fixed:** `_pcLoadHtml2Canvas` had no in-flight promise guard — concurrent calls before CDN load completes would inject duplicate script tags. Added `_pcHtml2CanvasPromise` cache. On CDN failure, the promise resets to null so retries work.

**Files changed:** `prototype-canvas.js` only.

---

## v8.96 — Fix: white border flash during DOCX export (CC, FC, SC, PI, Prototype Canvas)


**Root cause:** All five DOCX export functions using the `docx` library (`ccDownloadBriefDOCX`, `fcDownloadBriefDOCX`, `scDownloadSprintDOCX`, `buildAndDownloadPIDocx`, `pcExportPrototype`) start a large synchronous document-building block immediately after the CDN load `await`. Microtasks (`Promise.then`) run before browser paint, so the browser never gets a chance to paint the "Exporting…" button state before the main thread is blocked. This causes a white flash around the app border during the blocking period — most visible in PI (largest document) but present in all five.

**Fix:** Added `await new Promise(function(r){setTimeout(r,0);})` in each of the five functions, positioned after the last CDN load `await` and before the synchronous document construction begins. `setTimeout(r,0)` creates a macrotask boundary — macrotasks run after the browser paints, so the "Exporting…" state is visible before the blocking work starts.

**Not affected:** MI (`export-market-intel-docx.js`), PD (`export-diagnostic-docx.js`), and DM metrics (`export-xlsx.js`) use `new Blob([html])` or `XLSX.writeFile()` — lightweight synchronous operations with no main thread blocking. No change needed.

**Files changed:** `export-docx.js` (3 yields), `export-pi-docx.js` (1 yield), `prototype-canvas.js` (1 yield).

---

## v8.95 — Fix: session card navigation, FC panel empty, false generation failure, FC export enable, CC panel scroll


**Root cause:** v8.93 removed the FC export dropdown from `index.html` (`#sc-export-feat-opt`, `#sc-export-feat-sub`, `#sc-export-all-opt`, `#sc-export-all-sub`, `#sc-export-drop`) but did not update the JS references in `feature-canvas.js`. Three crash sites remained without null guards.

**Bug 1 — Session card navigation blocked (feature-canvas.js)**
`scClosePanel()` referenced `#sc-export-feat-opt` and `#sc-export-feat-sub` without null guard. Called unconditionally from `homeClearSession()` → `sessionStoreRestore()` on every session resume. Crash prevented navigation to any session. Fix: removed 2 stale lines from `scClosePanel`.

**Bug 4 — FC right panel body empty after clicking feature card (feature-canvas.js)**
`scOpenPanel()` crashed on the same removed elements before reaching `scRenderPanel(feat)`. Panel opened but body never rendered. Fix: removed 2 stale lines from `scOpenPanel`.

**Bug 5 — False "Generation failed" after successful story generation (feature-canvas.js)**
Post-generation cleanup in `fcGenerateStories` crashed on the same removed elements. Stories were generated correctly (badge count correct) but the panel update failed, causing the catch block to render "Generation failed: Cannot read properties of null". Fix: removed 2 stale lines from post-gen cleanup block.

**Bug 2 — FC Export button permanently disabled (feature-canvas.js)**
`scUpdateActionBar` enabled the Export button based on `done` (features with stories). FC now exports a Feature Discovery Brief — stories are irrelevant. Fix: changed condition from `done===0` to `total===0` where `total = visibleCanvas.length`. Button now enables when any features are visible, regardless of story status.

**Bug 3 — CC right panel scroll resets on feature checkbox toggle (capability-canvas.js)**
`ccToggleFeatPanel` rebuilt the right panel via `rp.innerHTML = ccBuildFeatPanel(...)` without saving scroll position. Fix: save `.cc-feat-panel-scroll.scrollTop` before innerHTML rebuild, re-query element after (old reference destroyed), restore scrollTop.

---

## v8.94 — Hotfix: CC export functions deleted; session card blocked; rename error UX


**Bug: CC generation failed with "ccRenderExportBtn is not defined" (capability-canvas.js)**
Root cause: Python-based deletion of old CC export functions in v8.93 used a range removal between two comment markers. The four new export functions (`ccExportInFlight`, `ccRenderExportBtn`, `ccSyncExportBtn`, `_ccGetVisibleCapsSnapshot`, `ccExportDocx`) were inserted immediately before the end marker and were swept up in the deletion. Functions were called at three render locations but never defined, causing a ReferenceError on every CC generation attempt.
Fix: Restored all five definitions to capability-canvas.js immediately before `ccOnTabLeave`.

**Bug: Session card clicks blocked after duplicate-name rename attempt (home.js)**
Root cause: When a duplicate session name was detected in `_save()`, the error path appended a `div.home-rename-err` element to `chipEl` using `appendChild`. The chip element has `event.stopPropagation()` on both mousedown and click. The appended div enlarged the chip's DOM footprint, causing it to cover a larger portion of the session card. Any click on the expanded chip area was silenced — never reaching the card's `homeResume()` onclick. This made ALL session cards on which a duplicate rename had been attempted appear completely unclickable.
Fix: Removed `chipEl.appendChild(_errEl)` entirely. The chip element is never mutated by the error path.

**Bug: Duplicate rename error message not visible (home.js)**
Root cause: Same as above — the appended div was inside an `inline-flex` chip with no column direction set, making it render outside visible bounds or invisibly.
Fix: Replaced DOM insertion with `showToast('Name already in use. Try another.', 'error')`. Red border on the input is preserved as the visual signal; toast is the readable message. No layout dependency, no chip mutation.

---

## v8.93 — Export redesign (CC/FC/SC/PI); favicon; duplicate session names


**Export redesign — new DOCX content, single Export button, in-flight loading state (capability-canvas.js, feature-canvas.js, story-canvas-new.js, pi-planning.js, export-pi-docx.js, export-docx.js, index.html)**
- All four canvases: export dropdown removed, replaced with single "Export" button. "Exporting…" + spinner + disabled state while async build runs. In-flight guard prevents double-click and re-render re-enable. Click-time data snapshot passed to DOCX builder — filter state at click is what goes in the document.
- CC export → Capability Brief: stage/metric headings + 3-col table (Cap Name | Why it matters | Origin) per metric group. Filter-aware via `_ccGetVisibleCapsSnapshot()`. In-flight flag: `ccExportInFlight`.
- FC export → Feature Discovery Brief: stage/metric/cap headings + 3-col table (Feature Name | Why it matters | Origin) per cap group + prototype wireframe images after each cap's table (if generated). Filter-aware via `fcGetVisibleCanvasSorted()`. In-flight flag: `fcExportInFlight`.
- SC export → Sprint Backlog: stage/metric/cap/feature grouping. Per-feature: 4-col summary table (Story ID | Story | Pts | Priority) then full story detail with user statement + Gherkin ACs. No prototype images in SC (moved to FC). In-flight flag: `scExportInFlight`.
- PI export → copy changed from "Export PI" to "Export". Button render now includes `id="pi-export-btn"` (was missing — the loading state selector `.dl-btn[onclick*="piExportDocx"]` never matched, so PI loading state was entirely broken pre-existing). Fixed to use `getElementById`. In-flight flag: `piExportInFlight`. `.then()/.catch()` replaced with `try/catch/finally` — button always restored.
- `export-docx.js` completely rewritten: `ccDownloadBriefDOCX`, `fcDownloadBriefDOCX`, `scDownloadSprintDOCX`. All tables use `WidthType.PERCENTAGE` (never DXA) to guarantee no overflow on any page size. Shared helpers: `_docxLoad()`, `_docxTriggerDownload()`, `_docxOriginLabel()`, `_docxTable3Col()`, `_docxTable4Col()`.
- Old functions removed: `ccToggleExportDrop`, `ccExportFull`, `ccExportFinalised`, `ccDownloadDOCX`, `ccBuildDOCX`, `scToggleExportDrop` (FC), `newScToggleExportDrop`, `newScExportPiSelected`, `scDownloadStoriesDOCX`, `scBuildDOCX`. Legacy stubs kept for any residual call paths.

**Favicon (favicon.ico, AI_EDITING_RULES.md)**
- `favicon.ico` was listed in `FILE_MANIFEST.txt` and referenced in both HTML files but had never physically existed in the project — silently skipped by every zip. File now present at project root.
- `AI_EDITING_RULES.md`: added mandatory rule — favicon.ico is a binary asset, must be preserved in every build, never deleted, never excluded from zip.

**Duplicate session names (session-store.js, home.js)**
- Creation: `sessionStoreCreate` now checks existing session names before storing. If auto-name ("Zomato · 1 Jul") already exists, appends "(2)", "(3)" etc. until unique. Case-insensitive.
- Rename: `homeSessionRenameInline` duplicate check on save. If new name already exists in another session, input stays open, red border applied, inline error "Name already in use. Try another." shown. Input does not commit. Error clears when user types a new value and saves successfully.

---

## v8.92 — KPI tree depth setting; stories/ACs max increase; sub-caps off by default; PI planning overhaul (7 changes); SC export prototype image


**KPI Tree Depth setting (state.js, settings-page.js, kpi-tree.js, prompts.js)**
- New `kpiDepth` setting (1–3, default 1) in Output Depth panel under new "Discovery Map" sublabel.
- Depth 1: L1 metrics only (default — lean, fast). Depth 2: L1+L2. Depth 3: full L1+L2+L3+L4 (original behavior).
- `buildTreePrompt()` emits depth-conditional JSON schema and rules. L1/L2 reference in existing-KPI instruction also made depth-aware.
- `gData.kpiDepth` stored at generation time; refinements read from `gData.kpiDepth` (not live setting) to prevent schema mismatch if user changes depth between generation and refine.
- `_spDefaults3`, save, load, and reset paths all updated.

**Stories max 6→10; ACs max 4→5 (settings-page.js, feature-canvas.js)**
- Stories per Feature stepper: max raised from 6 to 10.
- ACs per Story stepper: max raised from 4 to 5.
- Dynamic token formula in `scGenerateStories`: `Math.min(32000, Math.max(12000, features×maxStories×900+2000))` replaces hardcoded 12,000.
- Model guard: if projected output > 7,000 tokens, forces Sonnet regardless of batch size — Haiku's 8,192 ceiling would truncate at high story counts.

**Sub-caps off by default (state.js, settings-page.js)**
- `includeSubCaps` default changed from `true` to `false` in both `appSettings` and `_spDefaults3`. Existing sessions with saved settings unaffected.

**PI Planning — 7-change overhaul (product-leak-analysis.js, pi-planning.js, prompts.js, utils.js)**
- Change 1: `severity` and `evidenceStrength` added to `diagnosticContext` at push time in `laSendToStoryCanvas()`.
- Change 2: `piGetSelectedStories()` now carries `priority`, `origin`, and `diagnosticContext` — previously stripped before reaching the AI.
- Change 3: PI generate callsite passes `productProblem`, `productKpis`, `piInputs.constraints`, and `buildDocContext('pi')` into the prompt.
- Change 4: Story payload enriched with `priority`, `origin`, `severity`, `evidenceStrength`. Context block added to prompt body.
- Change 5: `feedback` added to PI document routing in `_DOC_CANVAS_ROUTING`.
- Change 6: Doc-aware scoring instructions for PRD/RFP (hard constraints + docConflict flag), roadmap (committed vs aspirational Time_Criticality), strategy (corroboration only), and VoC/feedback (Business_Value with citable signal + vocSupport field).
- Change 7: Full Rules replacement with MoSCoW gate (Step 1), dependency-aware priority escalation with transitive graph traversal and cycle detection (Step 1.5), goal-weighted scoring formula with Diagnostic_Boost (Step 2), and capacity-aware sequencing with mandatory backfill pass (Step 3). Each story assignment now returns `scoreBreakdown` with `piGoalAlignment`, `alignmentReason`, and scoring fields.
- Dynamic token limit: `Math.max(6000, stories.length × 200 + 3000)` replaces hardcoded 4,000 — Change 7 scoreBreakdown adds ~150 tokens/story; old limit truncated at ~18 stories (root cause of empty sprints).
- `pi-generate` model confirmed as `claude-sonnet-4-6` — not downgraded to Haiku (scoreBreakdown + dependency graph traversal exceeds Haiku's 8,192 output ceiling and reasoning capability).

**SC export: prototype wireframe image (export-docx.js)**
- `scDownloadStoriesDOCX` converted to async; loads docx.js and html2canvas in parallel.
- `scBuildDOCX` converted to async. For each feature, checks `pcGetActiveVariant(feat.id)` — if a generated prototype exists, calls `_pcCaptureWireframeAsPng()` and inserts the wireframe image (540×405 pt) above that feature's stories. Features without a prototype are unaffected. Capture failure is caught and logged silently — export continues.

---

## v8.91 — Left nav scrollbars; CC scroll restore; duplicate cap names; story ID counter; edit feature CTA; home layout; timestamp color; app rename


**Left nav thin scrollbars + SC nav scroll (10-capability-canvas.css, 16-story-canvas-new.css)**
- CC `cc-nav-tree`: added `scrollbar-width:thin` + webkit 3px scrollbar pair. Was using native browser default (thick/heavy).
- SC `#nsc-nav-tree`: was a bare unstyled div with no overflow property — left nav had no scroll at all. Added `flex:1;min-height:0;overflow-y:auto;overflow-x:hidden` + 3px thin scrollbar. MI and DM panels already covered by `.form-scroll` rule in `04-left-panel.css`.

**CC main panel scroll-to-top fix (capability-canvas.js)**
- `ccRenderAllCaps()` saves `.cc-cap-grid-wrap` scrollTop before `el.innerHTML=` and restores it after. Previously any re-render (Send to FC, filter change) jumped the card grid back to top.

**Exact-match duplicate capability name blocking (capability-canvas.js)**
- New `_ccGetAllExistingCapNames(excludeMetricKey)` helper — returns Set of lowercased+trimmed cap names from all capStore entries except the current metric being replaced.
- `ccGenerateOne()` and `ccGenerateAll()`: filter out AI-generated caps whose names exactly match (case-insensitive) any already-stored cap across other metrics before writing to capStore.
- `ccDoAddCap()`: checks exact match before manual add; shows `'A capability with this name already exists.'` toast and blocks the add if duplicate found.

**Duplicate story ID fix (session-store.js)**
- `scStoryIdCounter` now saved in session snapshot alongside `scCanvas`. On restore: sets counter to `max(savedCounter, highestSTNumberFoundInCanvas)` — prevents ST-001 collision on session resume regardless of prior session state.

**Edit Feature CTA disappearing (feature-canvas.js)**
- `oninput` on "Why It Matters" textarea: changed `if(f)f.style.display='none'` to `if(s&&f)f.style.display='none'`. Footer was unconditionally hidden on any description keystroke; now only hidden when the warn strip element actually exists (i.e. feature has existing stories). Features with zero stories no longer strand the user without a Save button.

**Home layout: gen-wrap at bottom, error text above divider (index.html, 17-home.css)**
- `home-launch-error` moved from inside `home-gen-wrap` to end of `home-form-scroll` as last child. `margin-top:auto` on both CSS rules pins it to the bottom of the form-scroll area, just above the divider line.
- `home-form-scroll` reverted to `flex:1` (was `flex:0 1 auto` in v8.90) — gen-wrap returns to panel bottom.
- `home-gen-wrap` now contains only the Launch Session button — identical structure to PI left panel gen-wrap. Bottom section height matches PI exactly (63px).

**Session card timestamp color (17-home.css)**
- `home-sess-time` color changed from `var(--label)` (#A5AFBE — too light) to `var(--t3)` (#6b6b68) — matches the readable color used for caps/features/stories/docs stat text.

**App rename: "Product Growth Toolkit" → "AI PM Toolkit" (multiple files)**
- index.html: page title + header title
- login.html: page title + header title
- export-docx.js: cover page + footer watermark (2 occurrences)
- export-market-intel-docx.js: cover + footer watermarks (3 occurrences)
- export-pi-docx.js: cover page (1 occurrence)
- export-diagnostic-docx.js: added branding line below cover H1 (was missing from all other exports — now consistent)
- CHANGELOG.md, AI_EDITING_RULES.md, PROJECT_MAP.md, DESIGN_SYSTEM.md: title lines updated
- Historical CHANGELOG entries documenting the v8.03 rename left intact as factual record.

---

## v8.90 — DM bar background; MI CTA removal; FC nav sort order; CC nav padding; Home form layout


**DM bottom bar background (05-kpi-tree.css)**
- `.diag-action-bar` background changed from `#fff` to `var(--card)` — restores visual consistency with left panel footer (`gen-wrap` standard). Pre-existing regression; not caused by v8.89. Height unchanged (52px fixed `.diag-bar-row`); perceived height increase was a white-on-white visual illusion.

**MI left panel CTA removal (market-intelligence.js)**
- `gen-wrap` div removed from `miRenderLeftPanel()`. Pre-generation CTA covered by existing empty state in right panel (`miRenderEmpty()`). Regenerate CTA removed intentionally — Option A chosen for tab consistency. Error retry ("Try Again") unaffected — in right panel (`mi-right-loader`). `.mi-left .form-scroll` now fills full remaining height with `flex:1`. `.mi-left .gen-wrap` CSS rule becomes dead code (harmless).

**FC panel nav sort order (feature-canvas.js)**
- New `fcGetVisibleCanvasSorted()` — wraps `fcGetVisibleCanvas()` and sorts result to match grid visual order (stage index from `gData.stages` → metric index from `scGetMetricOrder()` → insertion order as stable tiebreak within same metric). Handles unknown stages (MI, PI) by sorting to end, matching grid grouping. Guards `!gData` → falls back to unsorted insertion order.
- `scUpdatePanelNav()` and `scPanelNav()` now use `fcGetVisibleCanvasSorted()`. Fixes "Feature 5 of 8" showing when clicking first visible card — root cause was insertion order (generation time) diverging from grid visual order (stage/metric order).
- `fcGetVisibleCanvas()` and `scSelectAll()` unchanged — order doesn't matter for those callers.

**CC left nav bottom padding (10-capability-canvas.css)**
- `padding-bottom:12px` added to `.cc-nav-tree` (authoritative rule, line 331). Overrides `padding:0` from earlier rule (more specific sub-property, later declaration wins). Last capability item no longer clips against container edge when list is full.

**Home form layout (17-home.css)**
- `home-form-scroll` changed from `flex:1` to `flex:0 1 auto`. Panel no longer forces the scroll area to fill full remaining height, eliminating the large empty gap between the last form field (MI toggle) and the Launch Session button. `flex-shrink:1` + existing `min-height:0` + `overflow-y:auto` retain correct scroll behaviour when form content is tall (many session docs, long CVC, expanded additional context).

---

## v8.89 — Home form reset; DM session panel (Docs, CVC, Ctx); applyFeats guards; CC/FC panel nav filter scope; CC left panel CTA removal


**Home form reset (home.js, api.js)**
- New `_homeResetSetupForm()` function: resets Custom Value Chain, Additional Context (value + collapse state + counter), Market Intelligence toggle, AI Suggestions toggle, Approach/Mode pills (back to Outcome-Based/AI Generated), and uploaded capability list — called when navigating back to Home from a workflow tab (sessionActive path in `switchTab()`) and when switching product while a session is active (`homeOnProductChange()`).
- Root cause: static form DOM fields were never reset on these navigation paths; `homeClearSession()` correctly left untouched (it is called immediately before `_homeDoLaunch()` reads these same fields).
- Adversarial fix: AI Suggestions toggle unchecked before `homeSetApproach()` is called (element removed from DOM by subsequent `homeRenderSdocsSection()` call); counter text reset explicitly (programmatic `.value=''` does not fire input events).

**DM session panel (home.js, 17-home.css)**
- Docs row moved into config group (after Market Intel, no preceding divider) — was incorrectly in its own separate divider section.
- Custom Value Chain and Additional Context from `sessionContext` now displayed after ICP section using MI-style `fl-block` pattern (`mm-sp-fl-box`/`mm-sp-fl-label` CSS classes).
- Custom Value Chain always expanded (typically 5–7 stages, earns visible space). Additional Context collapsed by default with chevron toggle (`mmSpCtxToggle()`) and internal scroll at 100px max-height with 3px `--divider`-coloured scrollbar.
- Both fields render only when present in `sessionContext`; Scenario 1 (no data) panel unchanged.
- "Change Session" CTA removed — navigation to Home is available via the Home tab.
- `form-scroll` div given `overflow:hidden` inline (scoped to DM panel only; MI and CC PIF panel `.form-scroll` scroll unaffected).
- Pre-computed string variables used for all conditional HTML blocks — no nested template literals.

**applyFeats guards (left-panel.js)**
- `diag-action-bar` visibility now guarded by `curTab==='mm'`: Settings save on any non-MM tab no longer stomps the bar back to visible.
- `tab-la` (Product Diagnostics) reveal now requires `productLeakAnalysis.length>0` (was bare truthy — empty array `[]` always passed, revealing the tab with zero runs).
- `renderDiagnosticActionBar()` recreate branch also guarded by `curTab==='mm'` — prevents redundant DOM creation on non-MM tabs.

**FC panel nav filter scope (feature-canvas.js)**
- `scUpdatePanelNav()` and `scPanelNav()` now use `fcGetVisibleCanvas()` — the single authoritative filter source — replacing the old `scCapNavFilter`-only check. Navigation counter now correctly reflects all active filters (cap filter, stories filter, origin filter).
- `fcSetStoriesFilter()`, `fcSetOriginFilter()`, and `fcClearFilter()` now call `scUpdatePanelNav()` when a panel is open — previously only `scSetCapFilter()` did this, leaving the counter stale on stories/origin filter changes.

**CC panel nav filter scope (capability-canvas.js)**
- New `_ccKpiCapPassesFilter(cap, entry, metricKey)` helper: replicates the exact card-grid filter predicate for KPI, MI, and diag caps (features filter + full origin filter with explicit metricKey for prefix detection).
- New `_ccPiCapPassesFilter(cap)` helper: features filter only — PI caps bypass origin filter in the card grid and must do so in navigation too.
- `ccGetCapNavPool()` now applies the appropriate predicate per cap type (KPI/diag via `_ccKpiCapPassesFilter`, PI via `_ccPiCapPassesFilter`, MI via `_ccKpiCapPassesFilter`), producing a filtered pool that matches what the card grid shows.
- `ccBuildFeatPanel()` metric view path: `navTotal` and `navIdx` now computed from the filtered cap list; absolute `capIdx` preserved for `ccOpenCapPanel()` calls.
- `ccCapPanelNav()` metric view path: navigates through filtered caps, translates back to absolute index before calling `ccOpenCapPanel()`.

**CC left panel CTA removal (capability-canvas.js)**
- "Generate All Capabilities" footer div removed from CC left nav. Bulk generation remains accessible via "Generate for All Capabilities" secondary CTA in the main canvas empty state (confirmed same `ccGenerateAll()` call). `ccSetGenAllBtnDisabled()` has `if(btn)` guard on all 10 call sites — null-safe.

---

## v8.88 — Capability Canvas state retention; browser autofill credential corruption; model dropdown cleanup


- capability-canvas.js: fixed the root architectural flaw behind "select all/deselect all stop working" and "X of Y doesn't respect the active metric filter" — ccRenderMainContent and ccRenderAllCaps now call ccUpdateActionBar() themselves after every render, matching feature-canvas.js's proven fcRenderCanvas pattern (confirmed by tracing FC's working implementation directly, at Nethaji's request, rather than designing a new pattern from scratch). Both static initial-render templates previously duplicated the action bar's checkbox/count logic using the WRONG, globally-unscoped ccGetTotalCaps() instead of the correctly-scoped ccGetVisibleCapKeys() that ccUpdateActionBar() already used — this is what produced the discrepancy where initial render showed the global total but later updates showed the correctly-scoped one. Both templates now render neutral placeholders, immediately populated by the trailing ccUpdateActionBar() call.
- capability-canvas.js: ccMNSelectMetric() and ccSetCapFilter() now clear ccSelectedCapIds when the visible scope changes (switching metrics or applying a capability filter) — confirmed this codebase's established convention via feature-canvas.js's scSetCapFilter/fcSetStoriesFilter/fcClearFilter, which already do this consistently ("selection is view-scoped" — same fix applied here, not a new design decision).
- capability-canvas.js: ccGenerateFeaturesForSelected() now defensively filters the selected-IDs Set against currently-visible keys before generating, closing the "hidden batch generation" risk flagged in critic review — even if a stale cross-metric/cross-filter selection somehow survives, generation can never run against capabilities the user can no longer see on screen. [chatgpt-validated hardening fix]
- settings.js: new isValidApiKeyFormat() — single shared validator, replacing three independent copies of the same startsWith('sk-ant')/startsWith('sk-') check that had drifted apart (checkKey() had it, the Settings Save & Exit handler did NOT, the key-status pill had its own copy). [chatgpt-validated — "centralize the validator, do not keep two separate copies of the same check"]
- settings-page.js: Save & Exit now validates the API key field's format before persisting to sessionStorage — previously this had ZERO validation, blindly persisting whatever was in the field at the moment of click. Confirmed via screen recording: a browser autofills this type="password" field with an unrelated saved credential immediately on render, with no user interaction required, and this was being silently persisted on save with no way to tell from the UI whether the save actually worked, since reopening Settings re-triggers the same render-time autofill regardless of what's actually stored.
- settings-page.js: API key input gained autocomplete="new-password" plus autocapitalize="off"/autocorrect="off"/spellcheck="false" — semantically correct for a field that sets a new credential rather than filling an existing login, confirmed via video evidence as the right first line of defense against the render-time autofill behavior. [chatgpt-validated attribute choice]
- home.js: session search input gained autocomplete="off" — confirmed via the same screen recording that this field also gets autofilled with the user's profile email immediately on render, independently corrupting the session list filter.
- settings-page.js: AI Model dropdown reordered to Optimized, Haiku, Sonnet, Opus; consolidated from three Opus versions (4-8/4-7/4-6) down to one (claude-opus-4-8, most recent) — confirmed no other code references the two removed values, no migration needed.
- config.js: APP_VERSION v8.87→v8.88

## v8.87 — Per-call AI model defaults; multi-select speed threshold; Settings "Optimized" mode

- api.js: new CALLER_MODEL_DEFAULTS lookup table and resolveModel() — single shared resolver used by callAPI(), home.js's AI Recommendations fetch, and prototype-canvas.js's prototype-brief call (previously each of these independently re-implemented appSettings.model fallback logic, which would have broken once 'optimized' became the default value, since none of them recognized that sentinel). Precedence: explicit modelOverride argument > deliberate Settings override (any value other than 'optimized') > per-caller default from the table > final hardcoded Sonnet fallback. Verified against 8+ scenarios via Node fixture extraction against the actual shipped file, including the corrected precedence rule that a user's explicit Settings choice always wins over the multi-select speed threshold, with no exceptions.
- api.js: new resolveThresholdModel(itemCount) — used by CC's ccGenerateFeaturesForSelected and FC's scGenerateStories batch path. Forces claude-haiku-4-5 for 4+ items ONLY when the user is still on the 'optimized' default; returns null (no forced override) if the user has explicitly chosen a model in Settings, so an explicit choice is never silently overridden regardless of batch size.
- settings-page.js: new "Optimized (Default)" option added to the model dropdown (_spModels), now the first/default entry. Existing "claude-sonnet-4-6 (Default)" label corrected to plain "claude-sonnet-4-6" since it's no longer the default.
- state.js: appSettings.model default changed from the hardcoded 'claude-sonnet-4-6' to 'optimized'.
- settings-page.js: _spMigrateOldDocs() extended to silently migrate any persisted appSettings.model==='claude-sonnet-4-6' to 'optimized' — every existing session has this value purely because it was the only option before this release, never a deliberate choice between alternatives. Migration runs at both existing call sites (local restore and post-Supabase-sync), so the corrected value survives even if Supabase still has the stale pre-migration value cached server-side; gets persisted back to Supabase on the next explicit settings save, per the existing established pattern for this function.
- capability-canvas.js: ccGenerateFeaturesForCap gained a 4th parameter (modelOverride=null) — the 4 single-item call sites (Generate Features button, refine-chat send, retry-after-error, and the now-confirmed-unreachable PI-first batch path) are unaffected by the default. ccGenerateFeaturesForSelected computes the threshold model once using totalCount, captured BEFORE ccSelectedCapIds.clear() runs (a real bug avoided — checking selection size inside the per-item loop itself would always see an empty Set, silently defeating the threshold for every batch run). The retry-after-error button now also carries the same modelOverride forward, so retrying a single failed item after a batch run stays consistent with whatever model that batch was using, rather than silently changing.
- feature-canvas.js: scGenerateStories now computes the threshold model from features.length immediately before its callAPI call — no parameter threading needed here, since features is already a stable snapshot array with no equivalent selection-clearing risk.
- capability-canvas.js, feature-canvas.js: new inline caption — "4+ items use a faster, lower-quality AI model" in var(--blue) — appears immediately after the "X of Y selected" count once selection reaches 4+, but ONLY when the threshold would actually apply (i.e. hidden if the user has an explicit Settings override, since showing it would be misleading in that case). Both CTA buttons (Generate for N Capabilities / Generate for N Features) remain completely unchanged in label, color, and behavior at every state.
- prototype-canvas.js: prototype-brief's hardcoded Sonnet model removed entirely — now passes null and lets callAPI's resolveModel() handle it via the caller-keyed default, fixing the original v8.83-discovered gap (this was the only call site that bypassed Settings entirely) as a natural side effect of the broader resolver fix.
- 10-capability-canvas.css: removed a duplicate .cc-action-info rule (a second, redundant declaration of font-size/color that didn't carry the flex:1 already set by the first) — not a live bug, but dead/duplicate CSS cleaned up while in this file.
- Verified bidirectionally: every caller tag used anywhere in a callAPI() call is present in CALLER_MODEL_DEFAULTS, and every entry in the table corresponds to a real call site — no orphans either direction.
- config.js: APP_VERSION v8.86→v8.87

## v8.86 — Story Canvas visibility fix; PI export Prototype Plan section; label fix

- story-canvas-new.js: Select All / Clear All staging ALL stories canvas-wide instead of only what's visible under the active feature navigation and Filter dropdown — the v8.85 fix only addressed the _inSC/_hiddenFromSC condition and missed both newScActiveNavFeat (feature navigation) and newScApplyFilter (priority/readiness/PI-status/dependency filters). Root cause was newScUpdateActionBar itself: its totalStories/piCount/piPts were computed canvas-wide with zero awareness of either filter layer, so the bottom bar's own count was wrong, not just the mutation it triggered. Fixed with two new shared functions following the existing fcGetVisibleCanvas/ccGetVisibleCapKeys convention already used in feature-canvas.js/capability-canvas.js: newScGetVisibleFeaturesAndStories() (nav + story-filter, with per-feature grouping for rendering) and newScGetAllVisibleStories() (flat wrapper for count/select/clear). newScRenderMain, newScUpdateActionBar, newScSelectAll, and newScClearAllPiSelection all now call these instead of four independently-drifting partial implementations. Verified against 3 explicit scenarios (nav-only, filter-only, nav+filter combined) plus a cross-feature-leakage regression check, run against the actual shipped file via Node extraction — not just reasoned through.
- export-pi-docx.js: new Section 5 "Prototype Plan" inserted between Sprint Plan and Unplanned Backlog (renumbering Backlog 5→6, Story Notes 6→7) — collects every unique feature with a generated prototype across the ENTIRE PI plan (all sprints combined), renders each exactly once with design brief (purpose/key components/interaction notes/edge cases) and a captured wireframe image via the existing _pcCaptureWireframeAsPng/_pcLoadHtml2Canvas machinery, falling back to a text note on capture failure. Features with no generated prototype are skipped entirely. Removed the v8.85 Sprint Plan injection block that caused per-capability-group duplication — that content now lives only in the new dedicated section.
- home.js: Prototypes hero stat sub-label changed from "N sessions with prototypes" to "from N session(s)" — the subject of the sentence is the prototype count itself (e.g. "7 Prototypes"), and the subtext should read as a qualifier of that number ("from 2 sessions"), not restate session-counting as its own subject.
- config.js: APP_VERSION v8.85→v8.86

## v8.85 — DOCX export bullets/structure; PI export crash; Select All filter bug; label fix

- prototype-canvas.js: pcExportPrototype's Interaction Notes and Edge Cases now render as real Word bullets (new pcBul helper, numbering reference 'pc-bullets' registered on this file's own Document constructor — kept distinct from export-pi-docx.js's 'bullets' reference per ChatGPT review, since the two exports never share a Document instance but a separate name avoids any future coupling risk) instead of body() plain paragraphs, matching the in-app bulleted rendering. externalPrompt's multi-section structure (SCREEN:/LAYOUT:/COMPONENTS:/etc.) now renders as one Paragraph per line via new pushMultilineBody helper — previously 
 inside a single TextRun was silently dropped by Word, collapsing the structured prompt into one unbroken paragraph. New linesOf helper normalizes array/newline-delimited/single-sentence-prose input into proper bullet items — sentence-splits with the same anchored numbered-list detection and e.g./i.e. abbreviation protection as the in-app _pcForceBulletList, so DOCX export and in-app rendering now use equivalent logic instead of diverging. [chatgpt-validated for the numbering-config dependency and externalPrompt line-break fix]
- export-pi-docx.js: fixed ReferenceError "feat is not defined" in the Sprint Plan section — feat was referenced inside a different .forEach closure than the one where it was declared, genuinely out of scope at the point of use. Fix collects unique features actually present in each capability group (a group can legitimately span multiple features sharing one capability) and renders each one's prototype design brief separately, rather than naively hoisting a single feat reference which would have silently attributed the wrong feature's brief to a multi-feature group. Also fixed a second bug found alongside the scope error: String(_pv.designBrief) on a structured object would have rendered the literal text "[object Object]" even after the scope bug was fixed — now renders screenPurpose/keyComponents/interactionNotes/edgeCases as separate fields, with interactionNotes/edgeCases sentence-split into individual Word bullets via new _splitSentences helper (same abbreviation-protected logic as prototype-canvas.js, kept local since these two files don't share scope). [chatgpt-validated]
- story-canvas-new.js: fixed newScSelectAll() staging ALL stories across the entire canvas regardless of active feature filter/navigation — added the same s._inSC && !s._hiddenFromSC guard already used by newScUpdateActionBar()'s count display, so the checkbox mutation now matches what the count label claims it does. Also fixed the confirmed symmetric bug in newScClearAllPiSelection() (deselect-all), which had the identical missing-filter-guard issue — both now respect the active filter and rebuild scPiSelectedIds from whatever remains staged elsewhere, rather than blanket-clearing every story in every feature. [chatgpt-validated; the deselect-all symmetric bug was found via critic review, not independently caught]
- home.js: Prototypes hero stat sub-label changed from "across N sessions" back to "N sessions with prototypes" — the "across" phrasing broke from the established "N sessions in CC/FC/SC" convention used by the other three hero stats with no clear improvement, and a literal "in PC" suffix was considered and rejected: Prototype Canvas is a view inside Story Canvas, not a sibling tab, and "sessions with prototypes" is always a subset of "sessions with stories" — forcing tab-code parity would have implied a false equivalence between non-overlapping and overlapping counts.
- config.js: APP_VERSION v8.84→v8.85

## v8.84 — Adversarial-check fixes (ChatGPT-validated); packaging gaps closed

- prototype-canvas.js: fixed v.partial reuse bug in pcPhase=3 recovery — v.partial was set true before pcRenderView/sessionStoreSave ran, so a failure inside the recovery attempt's own catch block (e4) was masked by `if (v.partial) return` exiting silently instead of falling through to the generic error screen as the comment claimed. Replaced with a dedicated `recovered` boolean set only after the full recovery block completes without throwing. [chatgpt-validated]
- prototype-canvas.js: split pcPhase=3 into two subphases (normalize+commit vs render_or_save) via err.pcSubphase tag — a normalize/commit failure means brief data was never safely written (discard it), a render_or_save failure means data was already committed before the crash (preserve designBrief/coverageData/externalPrompt instead of wiping them). Previously one undifferentiated catch wiped brief data on any phase-3 failure regardless of whether the data itself was actually fine. [chatgpt-validated, scoped to 2-way split rather than the suggested 4-way]
- prototype-canvas.js: anchored the numbered-list detection regex in both _pcBuildEdgeCaseList and _pcForceBulletList to the start of text or after a line break (_pcIsNumberedList helper) — previously an unanchored mid-string match caused malformed AI output like "2. 5 MB" to be misread as a 2-item numbered list and split into garbled bullets; confirmed reproducible, now fixed. Genuine numbered lists and ordinary decimals/version numbers (v2.0, v3.0) both verified to behave correctly post-fix. [chatgpt-validated]
- prototype-canvas.js: added _pcProtectAbbreviations/_pcRestoreAbbreviations guards around e.g./i.e. before sentence-splitting in _pcForceBulletList — previously a mid-sentence parenthetical like "(e.g. active to expired)" was severed into two fragments at the abbreviation boundary; confirmed reproducible and fixed, restoring the abbreviation intact in the final bullet text.
- prototype-canvas.js: added Array.isArray guard to both bullet-list functions — pcNormalizeBriefResponse's `parsed.interactionNotes || ''` coercion does not actually convert an array response to a string, so if the AI ever returns an array instead of a string for interactionNotes/edgeCases, both functions now render it as a list directly instead of potentially erroring on string methods. [chatgpt-validated]
- 19-prototype-canvas.css: added border:1px solid var(--divider) and border-radius:6px to .pc-brief-quad — the 2x2 grid shipped in v8.83 had gap-only separation between quadrants with no visual card boundary, which read as undifferentiated floating text rather than four distinct sections. [chatgpt-validated finding, fix uses this codebase's actual --divider token rather than an invented token name]
- AI_EDITING_RULES.md: added missing packaging step for assets/prototype-style-default.md — confirmed absent from the v8.83 zip entirely despite being listed in FILE_MANIFEST.txt; the packaging script's mkdir/cp block never had a copy step for it. Copies to assets/ root (sibling to templates/, not inside it) since prototype-canvas.js fetches it via the exact relative path 'assets/prototype-style-default.md' — placing it in assets/templates/ would have caused a silent fallback to the embedded default style guide, never using the real uploaded content.
- FILE_MANIFEST.txt: removed stale README_FOR_YOU.md root-file entry — no file by that name exists on disk (actual file is README.md), and no README has ever been copied to the app root by the packaging script in any build; README.md is a project-knowledge reference only, deployed exclusively to proxy/README.md for the Render backend audience.
- favicon.ico: regenerated — confirmed absent from this project snapshot despite being referenced in index.html/login.html and listed in the manifest. Uses the actual brand purple token (--purple: #5F1EBE from 00-tokens.css) rather than the changelog's previously-recorded #6B4EFF, which does not match any token used elsewhere in the app.
- prototype-canvas.js: Call 1 (wireframe) model confirmed as claude-haiku-4-5 (switched in v8.83); Call 2 (design brief) remains claude-sonnet-4-6. No change in v8.84 — carried forward.
- config.js: APP_VERSION v8.83→v8.84

## v8.83 — Haiku for wireframe call; post-processing error handling; 2x2 design brief grid

- prototype-canvas.js: Call 1 (wireframe) model switched from claude-sonnet-4-6 to claude-haiku-4-5 — reduces generation latency on the heavier 4000-token call, narrowing the window where Render free-tier cold starts compound with generation time toward the 120s upstream timeout. Call 2 (design brief) remains claude-sonnet-4-6.
- prototype-canvas.js: post-processing (normalize brief, stale-signature check, commit, render, sessionStoreSave) after a successful Call 2 now wrapped in its own try/catch tagged pcPhase=3 — previously these ran untagged, so a client-side crash after both API calls succeeded (confirmed via Render logs showing 200/responseBytes with no further activity) fell through to the hard "Prototype Generation Failed" screen instead of the existing partial-success path. pcPhase=3 failures now attempt the same partial-success commit used for pcPhase=2 (wireframe preserved, partialReason:'post_process_failed'); console.error logging added on all failure branches (pcPhase 1/2/3 and the generic catch-all) surfacing err.message and err.stack instead of relying on Render log byte counts to diagnose.
- prototype-canvas.js: pcBuildBriefHTML rewritten as a 2x2 grid — Screen Purpose (top-left, prose), Key Components (top-right, reverted to tag chips from v8.81's comma-separated inline list — tag styling stays scoped to the live UI only, DOCX export keeps the comma-separated format), Interaction Notes (bottom-left, bulleted via new _pcForceBulletList), Edge Cases (bottom-right, bulleted via _pcForceBulletList); _pcForceBulletList added — always renders as <li> items via numbered-pattern detection falling back to sentence-split, unlike _pcBuildEdgeCaseList which silently falls back to prose paragraphs when the AI doesn't number its output.
- 19-prototype-canvas.css: pc-brief-grid (2-column CSS grid, minmax(0,1fr) columns, single-column fallback under 760px), pc-brief-quad, pc-brief-tags, pc-brief-tag added; removed max-width:680px from pc-brief-prose/pc-brief-body — this was the cause of the previously reported half-wrapped text and excess whitespace in the wireframe panel, since prose was constrained to 680px regardless of available container width; also fixed a pre-existing brace-mismatch bug — .pc-stale-banner's selector and opening brace had been deleted at some prior point, leaving its declarations orphaned under .pc-partial-banner's closing brace (CSS parsed without error but the "Stories have changed" banner had no styling applied); restored the missing selector.
- config.js: APP_VERSION v8.82→v8.83

## v8.82 — Two-call prototype generation split + generation reliability

- prototype-canvas.js: pcGenerate split into two sequential callAPI calls — Call 1 (wireframe, 4000 tokens, prototype-wireframe caller) + Call 2 (brief+coverage+prompt, 3000 tokens, prototype-brief caller); startAiGen moved before _pcGetStyleGuide — tab navigation now blocked for entire generation lifecycle; story/feature snapshots frozen with pcCanonicalStories before first await — prevents live mutation affecting Call 2; skip Call 1 for non-UI features (goes straight to Call 2); call1Ok boolean as explicit phase discriminator (not v.wireframeHTML); err.pcPhase tagging on both inner try/catch blocks; partial success on Call 2 failure saves wireframe with partial:true/partialReason:'brief_failed'; partial wireframe saved on Call 2 abort with partialReason:'aborted_after_wireframe'; partial banner rendered in pcRenderGenerated; non-UI features show "No UI wireframe" copy; pcCanRenderFeature() helper replaces repeated inline guards; pcNormalizeWireframeResponse + pcNormalizeBriefResponse normalizers; _pcGetStyleGuide updated to accept signal — abort-aware, no fallback caching on abort; pcMakeEmptyEntry extended with generatingPhase/partial/partialReason/nonUI fields; pcRenderLoading phase-aware (reads v.generatingPhase — shows step 3 active in phase 1, step 4 active in phase 2); loading copy "30 to 60 seconds" → "60 to 90 seconds"; vertical centering via .pc-scroll-centered class toggle (not style.cssText); scroll.classList.remove on generated state
- prompts.js: replaced buildPrototypePrompt with buildPrototypeWireframePrompt (Call 1 — wireframe + wireframeOutline) and buildPrototypeBriefPrompt (Call 2 — brief + coverage + externalPrompt); wireframeOutline {layout, components[]} passed from Call 1 to Call 2 for grounded coverage audit; token caps and line limits in wireframe prompt
- session-store.js: _ssStripProtoTransient extended with generatingPhase/partial/partialReason/nonUI fields; restore path resets generatingPhase:null
- 19-prototype-canvas.css: .pc-scroll-centered class; .pc-partial-banner style; removed min-height:100% from wrap classes
- home.js: hero Prototypes sub-label changed to "across N sessions"
- server.js: UPSTREAM_TIMEOUT_MS 90000 → 120000 (Lever 3 — safety buffer for edge cases)
- config.js: APP_VERSION v8.81→v8.82

## v8.81 — Wireframe persistence + DOCX image + generation reliability

- index.html: added LZString CDN script tag (eager load before first sessionStoreSave)
- session-store.js: _ssStripProtoTransient now accepts opts.persistWireframe — compresses wireframeHTML with LZString.compressToUTF16 into wireframeHTMLCompressed field; size guard fires BEFORE localStorage write (build→stringify→check→rebuild-stripped-if-needed→write); sessionStoreRestore decompresses wireframeHTMLCompressed immediately after protoStore assign, backward-compatible with old snapshots, always resets generating:false and wireframeBlobUrl:null on restore
- prototype-canvas.js: switched pcGenerate to claude-sonnet-4-6 for improved JSON reliability; added _pcExportInFlight guard preventing double-export; added pcSyncExportButton(featId) helper — feature-guarded, called on generate start/finish and in finally; removed unconditional disabled=false from pcRenderGenerated; added _pcLastRenderedFeatId tracker + pcResetSectionStates() called on feature change in pcRenderView; html2canvas DOCX image capture — _pcLoadHtml2Canvas (lazy CDN), _pcSanitizeForCapture (DOM sanitizer via template element), _pcCaptureWireframeAsPng (position:fixed div, windowWidth/Height options, allowTaint:false useCORS:true, try/finally div cleanup, silent fallback); parallel docx+html2canvas CDN loading via Promise.all; DOCX table A4-safe 9000 DXA with Story ID column (ST-001 + title, 2000/1000/6000 split); key components rendered as comma-separated inline list not tags
- prompts.js: buildPrototypePrompt — structured externalPrompt format with SCREEN/LAYOUT/COMPONENTS/INTERACTIONS/STYLE/VARIANTS sections; added token caps (wireframeHTML max 3500 tokens, externalPrompt max 800 words)
- home.js: hero Prototypes sub-label changed to "N sessions with prototypes"; tooltip inner span pattern for all 5 sdoc-name instances
- 17-home.css: home-sdoc-name overflow:visible (tooltip visible); home-sdoc-name-inner carries truncation
- 19-prototype-canvas.css: empty/loading/error wraps vertically centred (min-height:100% + justify-content:center); empty title DM Sans 600 not DM Serif Display; brief section gap 4px→3px, margin-bottom 10px→14px; pc-brief-components for inline key components; pc-prompt-block right padding 60px to prevent Copy button overlap; removed old duplicate pc-prompt-block rule
- config.js: APP_VERSION v8.80→v8.81

## v8.80 — Prototype Canvas fixes

- story-canvas-new.js: deleted duplicate newScSetNavFeat at line 296 that was overriding the correct version — fixes toggle pill not showing with 1 feature, wrong featId baked into Export Prototype button, and wireframe missing from fresh-generation DOCX export; added story count badge update before prototype view early return in newScRenderMain (fixes left nav vs toolbar count mismatch)
- prototype-canvas.js: empty state layout — removed additional context from empty state, added inline centred Generate Prototype CTA below upload zone; hide pc-refine-bar in empty/loading states, restore in generated state; updated wireframe unavailable copy to clearly state full regeneration; sentence-case + (optional) in screenshot upload title; pcBuildBriefHTML — prose split into sentences via _pcSplitProse, edge cases rendered as bullet list via _pcBuildEdgeCaseList; removed substring(0,100) truncation from DOCX coverage notes; removed substring(0,1500) truncation from DOCX external prompt; JSON.parse wrapped in try/catch in summariseDocument
- 19-prototype-canvas.css: scoped pc-step-done background/color to .pc-step-dot.pc-step-done only (fixes green background bleeding onto loading step labels); added pc-brief-prose, pc-brief-para (max-width:680px), pc-edge-list, pc-edge-item styles; added pc-gen-btn-empty variant for centred empty state CTA
- home.js: removed Discovery Maps stat from hero snapshot (Sessions = DMs always, redundant); removed _heroDMs counter and _dmSub; hero now shows 5 stats: Sessions, Capabilities, Features, Stories, Prototypes
- utils.js: JSON.parse in summariseDocument wrapped in try/catch — throws meaningful error instead of silent crash to 'other' docType on malformed AI response
- config.js: APP_VERSION v8.79→v8.80

## v8.79 — Prototype Canvas

- prototype-canvas.js (new): full prototype view module inside Story Canvas; variant-aware protoStore schema (v1 single variant, future-proof for multi-variant); pcGenerate with aiGenInFlight guard, feature signature capture, async completion guard, stale detection, non-UI feature detection; pcDeleteProto/pcMarkStale/pcMigrateProtoFeatureId lifecycle helpers; pcExportPrototype DOCX export; style guide fetch with embedded fallback; pcReady boot flag
- 19-prototype-canvas.css (new): all prototype view styles scoped to .pc-*; flex sibling layout (pc-view/pc-scroll/pc-refine-bar); collapsible sections; wireframe iframe; coverage rows; external prompt block; panel pointer-events guard (.nsc-main-wrap.pc-mode)
- assets/prototype-style-default.md (new): UX-law-grounded component library for wireframe generation fallback
- story-canvas-new.js: newScProtoView state + newScSetProtoView wrapper + newScNormalizeActiveFeature; newScSetNavFeat now calls newScRender(); newScBuildLayout rebuilt with Stories/Prototype toggle pill, pc-view sibling, legend hide, pcAvailCall guard; pcMarkStale calls on all story mutation paths (add, edit, delete, dep add/remove, reassignment)
- feature-canvas.js: pcMarkStale on scSaveStoryTitle/Stmt/AC, scConfirmRemoveInSCStory, scDoEditFeat (metadata + clear), scGenerateStories, scRefineStories, fcPanelSendToSC; pcDeleteProto on scToggleFeature/scDoRemoveFeature/scPurgeStage; pcMigrateProtoFeatureId on scConfirmLinkMetric primary + siblings
- session-store.js: _ssCloneJsonSafe + _ssStripProtoTransient (whitelist, variant-aware); protoStore in _sessionStoreBuildSnapshot + sessionStoreRestore; protos count in _ssComputeCounts (live feature ID filter)
- home.js: protoStore+newScProtoView reset in homeClearSession; 6th hero stat card (Prototypes)
- demo-data.js: protoStore+newScProtoView reset in clearDemoMode
- export-pi-docx.js: design brief injection per feature from protoStore variant
- prompts.js: buildPrototypePrompt added; PROTOTYPE_STYLE_DEFAULT_FALLBACK constant
- 17-home.css: hero stat val 28px→22px, label 11px→10px; min-width:0 + ellipsis for 6-card strip
- proxy/server.js: body parser scoped to /api/anthropic only (removed global); limit 2mb→10mb for screenshot payloads; middleware order: limiter→requireAuth→express.json→handler
- config.js: APP_VERSION v8.78→v8.79

## v8.78 — Document intelligence: expanded routing + enrichment instructions across FC, SC, PI, MI, DM

- utils.js: _DOC_CANVAS_ROUTING — added feedback to sc; backlog to fc; other to cc and mi — session docs now reach more canvases where they are genuinely useful
- utils.js: _HARD_CONSTRAINT_TYPES — removed backlog; now prd and rfp only — backlog-as-constraint handled via prompt instructions in SC/PI, allowing FC to treat backlog as soft enrichment context
- prompts.js: _capCanvasGroundingRules — added explicit other/unclassified case: treat as general product context, do not derive scope or constraints
- prompts.js: added _docEnrichmentInstruction() helper — enrichment-only instruction for FC, SC, PI, MI, DM when docContext present; covers PRD/RFP/research/feedback/strategy/roadmap/other
- prompts.js: added _backlogEnrichmentInstruction() helper — backlog-specific instruction for SC/PI (authoritative work inventory) and FC (avoid duplication); always injected alongside _docEnrichmentInstruction when docContext present
- prompts.js: buildCapFeaturesPrompt — pre-computed _fcDocText/_fcHasDoc/_fcEnrichment; both enrichment instructions injected after docContext when present
- prompts.js: buildPICapPrompt — pre-computed _piDocText/_piHasDoc/_piEnrichment; both enrichment instructions injected; PI-specific note distinguishes roadmap (sequencing signal) vs strategy (alignment validation only)
- prompts.js: buildMarketIntelPrompt — added separate DOCUMENT CONTEXT RULES block after docContext; explicitly covers research/feedback (supplement market data), strategy (validate capability alignment), other (supplementary only); does not touch INSIDER INTELLIGENCE RULES
- prompts.js: buildTreePrompt — added strategy/roadmap enrichment signal inside generation step 4 (validate stage priorities and metric framing against business objectives); not applied to buildTreePromptManual (placement-only prompt, not generative)
- feature-canvas.js: scBuildStoryPrompt — pre-computed _scDocText/_scHasDoc/_scEnrichment; both enrichment instructions injected after docContext when present; feedback/VoC now also reaches SC via routing change

## v8.77 — Stale analysing message fix + single-source version string

- home.js: _homeUpdateLaunchBtn — replaced silent no-op in !hasProduct branch with explicit message clear and 'Select a product to continue.' — eliminates stale 'Analysing N documents' message persisting after all docs resolve when no product is selected
- config.js: Added APP_VERSION = 'v8.77' as single source of truth for version string; both index.html and login.html read it automatically on DOMContentLoaded
- main.js: Set #hdr-version span from APP_VERSION on DOMContentLoaded (first line, before auth gate)
- login.html: Set #hdr-version span from APP_VERSION on DOMContentLoaded; removed hardcoded v8.52 string (was 25 versions out of date)
- index.html: Removed hardcoded version string from #hdr-version span — JS-driven from config.js
- AI_EDITING_RULES.md: Fixed line 201 (hdr-badge → hdr-version); updated item 10 and step 3 of version increment rules to reference APP_VERSION in config.js; login.html version now maintained automatically

## v8.76 — Session doc upload: stuck launch button fix + Max 5 files indicator

- home.js: Introduced _homeSyncSdocUi() and _homeFinalizeSdocAsync(timer) helpers — centralised terminal sync for all async doc state paths; every status mutation now guaranteed to re-render chips and recalculate launch gate
- home.js: homeHandleSdocsUpload — added 45s per-doc safetyTimer (guards sessionActive; calls _homeFinalizeSdocAsync(null)); all 3 terminal async paths replaced with _homeFinalizeSdocAsync(safetyTimer); all 3 null-guard early returns now call _homeUpdateLaunchBtn() before returning
- home.js: homeRenderSdocsChips empty-array branch now calls _homeUpdateLaunchBtn() — fixes stale disabled state when all docs are cleared
- home.js: _homeRetrySdocSummaries — null guard calls _homeUpdateLaunchBtn(); success path replaced homeRenderSdocsChips() with _homeSyncSdocUi(); catch path calls _homeUpdateLaunchBtn()
- home.js: Hoisted HOME_SESSION_DOCS_MAX = 5 as module-level constant; replaces local var MAX_FILES in homeHandleSdocsUpload; used in homeRenderSdocsSection for badge logic
- home.js: homeRenderSdocsSection — added Max 5 files badge to both isCapManual and else branches; badge turns amber when at cap; applied alongside existing Optional label
- utils.js: _loadPdfJs, _loadXlsx, _loadMammoth — all three CDN loaders hardened with 30s timeout and settled flag; prevents hung promises on blocked/slow CDN; clearTimeout called in onload and onerror; promise var nulled on timeout/onerror for clean retry
- utils.js: _loadXlsx onerror now nulls _xlsxLoadPromise — consistency fix matching mammoth/pdf.js pattern

## v8.74 — Add favicon.ico

- Added favicon.ico (16x16, brand purple #6B4EFF) to project root — eliminates 404 console error on all Netlify deployments.
- Updated AI_EDITING_RULES.md zip packaging instructions to include favicon.ico copy step.
- Updated FILE_MANIFEST.txt to list favicon.ico as a root file.

## v8.73 — Remove BYOK gates; proxy org key fallback

- Removed BYOK gate from homeLaunch(): no longer blocks session launch when personal API key is absent; proxy org key fallback handles authentication; if neither key is available the DM tab surfaces the server's authoritative error message.
- Removed BYOK gate from _homeCallAIRecs(): no longer blocks AI Recommendations when personal API key is absent; existing .catch() handler shows "Could not load recommendations. Try refreshing." on failure.
- Note: ANTHROPIC_API_KEY env var must be set on both Render services (prod + dev) for org key fallback to work without BYOK.

## v8.72 — CC filter UX: dropdown persistence, badge count, clear all filters

- CC filter dropdown no longer closes on checkbox selection: ccSetCapFilter captures open state before re-render and re-opens the rebuilt dropdown element afterward; also fixes missing PI routing (capActiveMetricKey.startsWith('pi||') now routes to ccRenderPICapView instead of ccRenderMainContent).
- CC filter badge now shows for 2+ active filters with dynamic count ("2 filters", "3 filters"); removed size<2 guard from badge render and Filter button active state across all 3 toolbar instances (ccRenderAllCaps, ccRenderMainContent, ccRenderPICapView); PI view badge fixed from always-truthy Set check (ccCapFilter?) to ccCapFilter.size>0.
- "Clear all filters" added to CC filter dropdown (all 3 toolbar instances) and FC filter dropdown in index.html, matching the existing SC pattern; calls ccSetCapFilter(null) for CC and fcClearFilter() for FC.

## v8.71 — callAPI arg alignment fix

- callAPI signature regression from v8.70: caller-label strings were placed in slot 5 (modelOverride) instead of slot 6 (caller), sending invalid model IDs to Anthropic and returning 404 not_found_error on 9 generation paths — DM generation, CC gen/regen/features (5 paths), Product Diagnostics, and FC story generation; fixed by inserting null in slot 5 for all 9 affected call sites. cc-dd-batch signal arg also corrected (abort now wired; was silently unconnected).

## v8.70 — CC error handling, product reset, session doc visibility, caller logging

**CC capability generation fixed end-to-end:** `ccGenerateOne` had a `ReferenceError: ctx is not defined` after successful Anthropic response — `_docGrounded` stamped with `ctx` instead of `_ctx1`. Fixed with pre-computed `docGrounded` primitive before the `await`. `Array.isArray` check replaces weak truthiness check. Catch block now replaces `mainArea` with a visible error state and retry button (via `addEventListener`) instead of writing into a hidden `expEl`. Left-panel row restored to retry state on error with null-safe querySelector. AbortError path re-renders navigator to clear loader. `ccGenerateAll` gains `_docGrounded` on capStore write.

**Product dropdown resets on Home navigation:** After navigating back to Home from a workflow tab, the product dropdown now clears to "Select a product..." — both `activeProfileId` and `sel.value` are reset in the `switchTab('home')` block. Does not affect launch, resume, or delete paths.

**Session docs visible after resume:** DM left panel session summary now shows doc type badges (PRD, Research, Roadmap etc.) when the session had documents attached. Data already persisted in `sessionContext.sessionDocs` — purely a render addition. Session card gains a "docs" count cell (5th column in counts grid).

**Caller logging on Render proxy:** Every `callAPI` invocation now passes a `_caller` string (e.g. `dm-generate`, `cc-gen-one`, `doc-summary`). Proxy strips `_caller` before forwarding to Anthropic, logs it in `[AI OUT]`, `[AI TIMEOUT]`, `[AI ERROR]`. All 19 call sites labelled across 9 files.

## v8.69 — CC generation hang fix + proxy timeout + logging

**CC capability generation hang fixed:** `buildCapCanvasPrompt` and `buildCapCanvasPromptCapDriven` in `prompts.js` had a nested template literal inside a ternary inside the outer template literal — added in v8.67 for document grounding rules. This added one extra `\n` before `Return ONLY this JSON` even when no session doc was uploaded, causing `claude-haiku-4-5` to hang indefinitely. Fixed by pre-computing `groundingRules` as a plain string variable before the template literal. Empty-doc prompt is now byte-for-byte identical to v8.65. Document grounding rules are preserved and activate correctly when a session doc is present, in correct order: doc → PM context → grounding rules → Return ONLY this JSON.

**Proxy timeout:** `server.js` now destroys the Anthropic `https.request` after 90 seconds with a structured error. Returns HTTP 504 on timeout, 502 on other upstream errors. Previously a hung Anthropic connection caused the UI spinner to spin forever with no recovery path.

**Proxy logging:** `[AI OUT]`, `[AI RESPONSE START]`, `[AI RESPONSE END]`, `[AI TIMEOUT]`, `[AI ERROR]` log entries added to Render logs for every request — surfaces upstream failures that were previously invisible after JWT verification.

**Format rule (v7.33 onwards):** Every version entry = max 4 bullet points. No sub-items, no file lists.

---

## v8.68 — Org key fallback, Haiku model, origin system, session fix

- Org key fallback in Netlify function: AI Recommendations now works without BYOK on prod; BYOK sanitisation added in home.js to guard against undefined/null strings. Model allowlist, max_tokens clamp, and AbortController timeout added to Netlify function.
- Haiku model for classification tasks: summariseDocument (all 3 upload surfaces), DD single metric, DD batch in capability-canvas.js and metrics-definition.js now use claude-haiku-4-5 via new optional 5th modelOverride parameter in callAPI — 3-5x faster doc analysis.
- Origin system: doc-grounded capability tagging (_docGrounded flag on capStore entries); orange Session doc origin added in CC and FC; MI/Diagnostics colour inconsistencies fixed across CC and FC; CC legend expanded to all 5 origins; FC legend fixed and separator added; origin filter section added to CC and FC filter dropdowns; PI-first absorbed into Custom plan.
- Legend label prominence: CARD STATES and ORIGIN labels bumped from var(--t3) to var(--t2) in CC, FC, and SC.
- Session fix: navigating back to Home tab from a workflow tab now clears the active session (saved to library first — no data loss) and renders the session docs section correctly. env.js exclusion rule documented in AI_EDITING_RULES.md.

## v8.67 — Prompt refactor, doc grounding, export fixes, session state fixes

- Prompt refactor: all inline sys strings extracted to prompts.js as SYS_DD, SYS_MI, SYS_MI_DOCX, SYS_PI constants; buildSummariseDocumentPrompt and buildAIRecommendationsPrompt added. Doc classification enriched with filename signal, tiebreaker rule, and metrics field to preserve quantitative targets through summarisation.
- CC/SC DOCX exports fixed for non-AAER value chains: ccBuildDOCX and export-docx.js now derive stage order from gData.stages instead of hardcoded AAER list. Dynamic stages no longer silently dropped.
- Session state fixes: homeRenderSdocsSection gated behind !sessionActive; homeOnProductChange calls homeClearSession before setting new product; stale chips cleared on launch. Product selector change no longer leaves stale session docs visible.
- CC prompt tightened: buildCapCanvasPrompt and buildCapCanvasPromptCapDriven now include document grounding rules (PRD/RFP = scope boundary, NFR handling, out-of-scope exclusion). buildCapCanvasPromptCapDriven gains problem and icp fields for parity.

## v8.66 — Tooltip overflow fix

- Fixed: .home-sdoc-chip was missing position:relative and overflow:visible — the ::after pseudo-element from .pgt-tooltip was being clipped by the chip container, making the tooltip invisible. Added both properties to .home-sdoc-chip in 17-home.css.

## v8.65 — Upload consistency + word meter fixes + styled tooltips

- Upload sub-labels standardised: lowercase comma format (docx, pdf, txt, xlsx, csv), stale word-count fragments removed from Company Profile. Word meter denominator corrected from 7,500 to 20,000 in both Company and Product Profile static renders.
- Settings now accepts .xlsx in Company and Product Profile doc uploads; pre-v8.58 redirect guard removed. Home session doc labels updated to no-dot comma format; .md removed from accept attr.
- Session doc filename tooltips migrated from native title= to custom .pgt-tooltip (data-tooltip attribute, navy bg / white text). Global tooltip rule added to 01-base.css; pattern documented in DESIGN_SYSTEM.md Section 10.

## v8.64 — Session docs in cap+manual mode + filename tooltips

**Session Documents always visible in cap+manual mode:** Previously the session docs upload section only rendered when docs already existed — the PM had no way to upload docs after switching to cap+manual without having uploaded them first. Now always rendered below the capability list upload, with a divider and "Optional" tag matching the standalone mode. Full upload row, file input, and chips host always present.

**Filename tooltips:** Added `title` attribute to all five `home-sdoc-name` spans (invalid-ID, pending, error, ready pre-launch, ready post-launch). Hovering over a truncated filename shows the full name via native browser tooltip. Uses `safeName` (already HTML-escaped via `e()`) — safe for double-quoted attribute values.

## v8.63 — Session doc UX polish + xlsx/csv + cap list validation

**Product Profile label:** "From product profile" eyebrow → "Product Profile"; colour bumped from `var(--t4)` → `var(--t3)` — one step more readable.

**xlsx and csv as session documents:** `extractTextFromFile()` now handles `.xlsx` (SheetJS, memoised lazy-loader, all-sheets via `sheet_to_csv`, 6000-word cap) and `.csv` (plain text via `readAsText`). Session doc upload accept and label updated. memoised `_loadXlsx()` added to utils.js alongside existing `_loadMammoth()` and `_loadPdfJs()` loaders.

**VoC label:** `feedback` docType display label changed from "Feedback" → "VoC" everywhere (chip dtLabels map, select option, post-launch static label). Internal docType value stays `'feedback'` — no data migration. Select `max-width` reduced 90px → 80px (VoC is 3 chars; longest remaining option "Strategy"/"Research" fits at 80px).

**Cap list validation proactive:** `_homeUpdateLaunchBtn()` now checks for missing capability list in cap+manual mode — disables Launch button and shows "Upload your capability list to continue." proactively instead of only on click. Priority order: pendingDocs → !hasProduct (no overwrite) → missingCapList → clear. `homeRenderSdocsSection()` now calls `_homeUpdateLaunchBtn()` at end of both branches so mode switches immediately reflect button state.

**Approach hint copy:** "Outcome-Based: start from metrics - Capability-Based: start from capabilities" → "Drive based on metrics or capabilities" — fits one line, saves panel height.

**"Highest prompt priority" label removed:** The claim was accurate before v8.58 doc injection but became misleading once session documents also inject context. Removed from the Additional Context counter row. Counter now right-aligned via `justify-content:flex-end`.

## v8.62 — Session Documents box layout fix (flex shrink + overflow)

**Root cause found (ChatGPT cross-validation):** `home-cond-box` defaulted to `flex: 0 1 auto` (shrinkable) and had `overflow:hidden`. When a rich product profile card filled the panel, the flex algorithm shrank the box below its content height. `overflow:hidden` on a flex item with no explicit flex rule gives it an automatic minimum main-size of 0 — so the box could collapse to zero height and clip all content below the label row. This is why the upload row and uploaded file chips disappeared. The bug surfaced across 3 builds because prior fixes (gap reduction, re-render calls) treated symptoms without fixing the flex contract.

**Fix — 4 CSS changes only, no JS:**
- `home-cond-box`: `overflow:hidden` → `overflow:visible`; added `flex:0 0 auto` (content-sized, never shrinks, never grows)
- `#home-sdocs-chips`: `overflow:hidden` → `overflow:visible` (chip name truncation already handled by `home-sdoc-name`)
- `home-form-scroll`: added `min-height:0` (Safari hardening — ensures the scroll container gets a definite height as a flex child)
- Named direct children of `home-form-scroll` (`.home-fl`, `#home-pp-wrap`, `.home-tog-row`): added `flex:0 0 auto` (prevents any future child from inheriting the default shrinkable behaviour that caused this bug)

## v8.61 — Undo delete fix; session doc panel visibility; message copy

**Undo delete now works:** Root cause — `_homeRemoveSdoc()` was building the toast `onclick` attribute using escaped double quotes (`\"`), which broke the HTML attribute boundary. Browser saw `onclick="_homeUndoRemoveSdoc("` and stopped parsing at the inner quote, so the click fired with no argument. Fixed by using single-quote delimiters around the docId: `onclick="_homeUndoRemoveSdoc('doc_...')"`. Single quotes are safe since doc IDs are alphanumeric-only.

**Session Documents section re-renders on product change:** `homeOnProductChange()` now calls `homeRenderSdocsSection()` — previously only called on approach/mode change. With a rich product profile card filling the panel, the upload row appeared collapsed because it was never re-injected after product selection.

**Panel density reduced:** `home-form-scroll` and `home-cond-box` gap reduced 10px→8px, top padding 12px→10px. Saves ~14px across the panel — keeps Session Documents upload row visible in viewport when a full product profile card is shown.

**Analysing message copy:** Removed em dash. Now reads "Analysing N document(s). Please wait..." — clean punctuation, no special characters.

## v8.60 — Home panel: sdocs section visibility + message copy fix

**Session Documents section now re-renders on product change:** `homeOnProductChange()` now calls `homeRenderSdocsSection()` — the upload row was only rendered on approach/mode change, not on product selection, causing the section to appear collapsed when a product with a rich profile card was selected.

**Panel gaps tightened:** `home-form-scroll` and `home-cond-box` gap reduced from 10px to 8px, top padding reduced to 10px. The session documents upload row stays visible in the panel viewport even when a full product profile card (type, industry, ICP, description) is present.

**"Analysing" message copy fixed:** Removed em dash from processing message above Launch button. Now reads "Analysing N document(s). Please wait..." — clean, no special characters.

## v8.59 — Session doc chip UX redesign + undo delete

**Chip layout redesigned (5 issues):** Chips are now full-width block rows (`display:flex; width:100%`) instead of `inline-flex` — filename always truncates with ellipsis, X button stays within the purple box, zero horizontal scroll. `overflow-x:hidden` added to `home-form-scroll`. Filename is the primary element (10px, normal weight, `var(--t2)`); docType select is secondary (right-aligned, white bg, 9px). Single-click opens the native browser dropdown — the two-step badge→toggle pattern is removed. Select uses a subtle left-border colour accent per docType instead of coloured background.

**Undo delete:** Removing a session document shows a transient "Removed — Undo" toast (4s). Clicking Undo re-inserts the doc at its original position with its extracted text and summary intact — no re-upload, no re-summarisation. No confirmation dialog (follows Google Drive / Notion pattern — undo is safer and faster for a reversible low-stakes action).

## v8.58 — Document Intelligence & Context Injection

**Binary file parsing fixed + LLM summarisation at upload:** `.docx` now parsed via mammoth.js (CDN lazy-load, memoised Promise loader), `.pdf` via pdf.js with sequential page extraction and early word-cap — replacing broken `readAsText()` for binary files. Every uploaded document is summarised and classified by LLM at upload time (one API call per file, 800 max tokens); chip shows docType badge (PRD, RFP, Research, Feedback, Roadmap, Strategy, Backlog, Other) with PM override. Hard-failure chips (password-protected PDFs, corrupt files) render in error state with specific toast. Old-format profile docs auto-migrated on load; local only, no Supabase write during login.

**Session Documents panel on Home:** Always-visible `home-sdocs-box` section (replaces retired `home-cond-box`) lets PMs upload up to 5 docs per session before launch. Chips show processing spinners, are removable pre-launch, and lock to read-only post-launch. cap+manual mode shows a compact doc strip below the capability list upload. All chip handlers use `data-doc-id` pattern (no index interpolation). Launch button blocks while any doc is `pending`, shows spinner note above button. Silent retry fires post-launch and on Home tab re-entry. Additional Context textarea now collapsible (default hidden; "+ Add notes" to expand).

**Full context injection across all canvases:** New `getFullProductCtx()` replaces thin `getProductCtx()` at all CC, FC, SC, PI, DM, and MI generation call sites — `productDesc`, `problem`, `icp`, `kpis`, `additionalContext`, `productType` now reach every prompt builder. `buildDocContext(canvasType)` assembles doc context (session docs → product docs → company docs, max 3 blocks, canvas-routed by docType). Untrusted-document injection framing placed before doc text in every block. `_assertPromptCtx()` guard added to all changed prompt builders to catch missed call sites fast. Doc context snapshotted once per batch generation for consistency.

**Carry-forward and hardening:** `capability-drawer.js` BYOK gate removed (line 54 — last remaining after v8.57 sweep). `proxy/README.md` now included in zip. `_ssStripSessionDocs()` wraps sessionContext in snapshot — always returns new object, strips `extractedText` from session docs before persistence. Settings async upload chain closes over `doc.id` not index; `spRemoveDoc` finds by ID with in-place splice; `spP5ShowList` clears `_spP5NewDocs` in-place to preserve captured array references. Migration dirty flag + console.info log added.

## v8.57 — Org key support; remove client-side key gates

**Org API key support (server-side):** `proxy/server.js` v2.2.0 — BYOK-first key priority (user key overrides org key, not the other way round); invalid BYOK never silently falls back to org key; `RATE_LIMIT_MAX=100` and `RATE_LIMIT_WINDOW_MIN=1` named constants — rate limit error message is now derived from config, not hardcoded; neutral "no key available" error message.

**Client-side key gates removed (17 locations):** All `if(!key){ showToast('An API key is required...'); return; }` and `if(!key) throw new Error('No API key set.')` guards removed from `kpi-tree.js` (1), `capability-canvas.js` (11), `feature-canvas.js` (1), `market-intelligence.js` (2), `pi-planning.js` (1), and `settings.js` (1 DOMContentLoaded dot). Generation now proceeds even when no BYOK is set — proxy uses org key from env var.

**`callAPI()` header fix:** `Authorization` header only sent when `key.trim()` is non-empty. Avoids sending `Bearer ` (empty) to the proxy, which could cause auth ambiguity.

**Settings UI:** Three key states — "Personal key active" (green, BYOK valid), "Organisation key active" (green-neutral, empty), "Invalid key format" (red, bad format). Orange dot only fires for invalid format, not empty. Key input border ring only on invalid format.

## v8.56 — FC toolbar button sizing fix; CC All Caps ordering fix

**Issue 1 — FC toolbar buttons grow when right panel opens:** Added `display:flex; align-items:center; gap:7px; flex-shrink:0` to `.sc-toolbar-r` in `08-feature-canvas.css`. Root cause: `.sc-toolbar-r` was an unstyled block div — buttons stacked/stretched instead of staying inline. CC worked because its equivalent container has `display:flex` inline. SC also had this correct (`nsc-toolbar-r` already had flex rules). FC was the only one missing it.

**Issue 2 — CC All Caps view renders in generation order not DM order:** `ccRenderAllCaps()` replaced `Object.entries(capStore)` iteration (insertion/generation order) with `ccGetAllL1Metrics()` (reads `gData.stages` — DM stage→metric order, matches left nav). `diag||` caps appended after ordered metrics; `mi||` and `pi||` unified groups unchanged at bottom. Fix applies to existing sessions automatically — render-only change, no data migration needed.

## v8.55 — Profile card grid equal-width fix; FC nav counter on filter change

**Profile card grid (Issues 1+2) — root cause found via ChatGPT second opinion:**
- `repeat(4, 1fr)` / `repeat(2, 1fr)` changed to `repeat(4, minmax(0,1fr))` / `repeat(2, minmax(0,1fr))` — `1fr` respects intrinsic min-width of content; `minmax(0,1fr)` zeros it, forcing truly equal tracks regardless of card content length.
- `#sp-p2` (Product Profiles container): added `width:100%; max-width:100%; min-width:0; box-sizing:border-box; height:100%` — flex child of `overflow-y:auto` parent was sizing to content, not full width.
- `.sp-profile-chip-grid`: added `width:100%; max-width:100%; min-width:0; box-sizing:border-box`.
- `.sp-profile-chip-grid-narrow` selector upgraded to `.sp-profile-chip-grid.sp-profile-chip-grid-narrow` for specificity.
- `.sp-profile-chip`: added `min-width:0; box-sizing:border-box` — grid item must opt out of automatic minimum sizing.
- `.sp-profile-type-badge`: added `white-space:nowrap; flex-shrink:0` — badge was contributing to intrinsic track width.
- `spNav()`: fixed `#sp-p2` being set to `display:'block'` on left-nav return — now uses `spSectionDisplay(i)` helper which returns `'flex'` for section 2, `'block'` for all others. Prevents layout break on return navigation.
- Added `spSectionDisplay(i)` helper function to centralise display-mode logic and prevent future regressions.

**FC nav counter (Issue 3):** `scSetCapFilter()` now calls `scUpdatePanelNav()` when a panel is already open (`scPanelFeatureId` set). Counter now updates immediately when capability filter is applied/cleared.

## v8.54 — Profile card width fix; CC nav counter All Caps + PD caps

**Issue 1 — Profile card columns unequal width:** Added `box-sizing:border-box` to `.sp-p5-list`. Without it, `padding:10px 16px` was added outside the `flex:0 0 40%` allocation causing asymmetric overflow clipping and unequal column widths.

**Issue 2 — CC All Caps nav counter wrong denominator:** `ccBuildFeatPanel` now detects All Caps view (`capActiveMetricKey===null`) and uses `ccGetCapNavPool()` for global position + total (e.g. "2 of 7"). Metric view still uses metric-scoped count. `ccCapPanelNav` updated to match — global navigation in All Caps view, metric-scoped in metric view.

**Issue 3 — PD caps nav missing:** Changed `navTotal>1` to `navTotal>=1` in nav row render condition. Single caps (PD, MI, or any 1-cap metric) now show "Capability 1 of 1" with both arrows disabled, giving user positional context.

## v8.53 — Profile cards, DM copy, error enrichment, CC/FC panel fixes, settings UX

**Issue 1 — Profile cards uneven height:** Added `min-height:90px`, `display:flex; flex-direction:column` to `.sp-profile-chip`; `margin-top:auto` on `.sp-profile-chip-meta` pins meta row to card bottom across all card heights.

**Issue 2 — Stale "KPI Tree" copy (5 locations):** Renamed to "Discovery Map" in `session-store.js` (interrupted state desc + button), `index.html` (gen-btn label + empty-desc), `kpi-tree.js` (action bar hint on outcome-based path).

**Issue 3 — Error message enrichment:** `api.js` now prefixes Anthropic pass-through errors with their type (`"Anthropic API error — "`, `"Anthropic overloaded — "`, etc.) for clearer debugging. Updated `index.html` static fallback copy.

**Issue 4 — CC right panel disappears after Send to Feature Canvas:** Fixed ordering in `ccSendToStoryCanvas()` — `ccRenderAllCaps()` now called before `capActiveMetricKey=null` so panel condition passes. Removed redundant `ccRenderMainArea()` call.

**Issue 5 — CC nav counter wrong denominator:** `ccBuildFeatPanel` and `ccCapPanelNav` now scoped to current metric's capabilities only (Option A). Counter shows "Capability X of N" where N = caps in current metric/parent cap.

**Issue 6 — FC nav counter wrong denominator:** `scUpdatePanelNav` and `scPanelNav` now scoped to `scCapNavFilter`-filtered features. Counter shows "Feature X of N" where N = features in current capability view.

**Issue 7 — Profile card grid reflow on edit open:** Added `.sp-profile-chip-grid-narrow` CSS class (2-col). Toggled by `spP5ShowEdit`/`spP5ShowList`.

**Issue 8 — Discard profile edit closes silently:** Added `_spP5CaptureSnapshot()`, `_spP5IsDirty()`, `spP5TryClose()`, `spP5ConfirmDiscard()`. Dirty check compares 9 field values + doc changes. Confirm modal: "Discard profile changes?" / Keep Editing / Discard.

**Issue 9 — Back arrow replaced with ✕:** `sp-p5-edit-back` replaced with `sp-p5-edit-close` positioned `absolute top-right`. Both Discard button and ✕ now route through `spP5TryClose()`.

## v8.52 — PD table Experiment column as surplus absorber

- product-leak-analysis.js: Experiment column changed to w:null — emits bare <col> with no width constraint, making it the sole pressure valve for surplus table width; compact columns (checkbox 26px, Pri 44px, Stage 64px, Type 64px, View 48px) and percentage columns (Run 10%, Linked 12%, Success 18%, Instrumentation 8%, Assumptions 8%) now stay at their declared widths; Experiment absorbs all remaining space dynamically regardless of which optional columns are visible — fixes horizontal whitespace inflation on checkbox, Pri, and Run

## v8.51 — DD gen-strip logic; error inline link; PD table Priority fix

- capability-canvas.js: ccRenderDDPanel gen-strip now always shows "Generate for All Metrics" CTA — single-metric auto-generation populates fields silently without changing the CTA; Download .xlsx only appears after full all-metrics generation (ddGenerated flag); fixes lost "Generate for All Metrics" functionality from v8.49
- capability-canvas.js: ccDDGenerateForMetricSafe error state — "Try again?" now renders inline as an underlined link continuing the error sentence, not a separate block button
- product-leak-analysis.js: Priority column label changed to 'Pri' with title="Priority" tooltip; Details column width 48px; header render adds title attribute for tooltip on hover
- 12-product-leak-analysis.css: removed td:nth-child(2) Priority rule entirely — this was the root cause of the badge being centred and creating visual gap with checkbox; default left-aligned td padding now applies; View last-child padding 4px 4px

## v8.50 — Hotfix: duplicate const hasDD crash; PD table Priority/View padding

- capability-canvas.js: removed duplicate `const hasDD` declaration in ccRenderDDPanel() — caused SyntaxError crashing entire capability-canvas.js module; Dictionary click did nothing, CC tab blank (both symptoms from same parse failure introduced in v8.49)
- 12-product-leak-analysis.css: added tight padding overrides for Priority (nth-child 2) and View (last-child) columns — reduces visual excess spacing on narrow fixed-width columns

## v8.49 — DD panel auto-generate; right panel bottom gap; PD counter fix; story count; column widths; export fix; dl-btn colour

- capability-canvas.js: added syncRightPanelBodyState() (window-exposed) — derives right panel open state from DOM, syncs #out-body.has-right-panel class; called after DD panel open and close
- capability-canvas.js: ccOpenDDPanel() now auto-triggers single-metric DD generation if metric has no existing DD data (ccMetricHasDDData guard + setTimeout key check prevents stale panel writes)
- capability-canvas.js: ccRenderDDPanel() hasDD now row-level (checks _ddRows + metric fields) instead of coarse ddGenerated flag — CTA shows correctly after single-metric generation
- capability-canvas.js: added ccMetricHasDDData() helper and ccDDGenerateForMetricSafe() (aiGenInFlight-aware, metricKey-guarded, abort-safe); old ccDDGenerateForMetric() replaced with thin wrapper routing to safe function — no unsafe legacy path
- diagnostic-view.js: syncRightPanelBodyState() called after dvOpenEvidenceDrawer() and dvCloseEvidenceDrawer() — panel class stays correct when panels open/close in sequence
- export-xlsx.js: getElementById('f-name') null guard with sessionContext fallback and console.warn — fixes crash on download when f-name element absent
- product-leak-analysis.js: added laGetSentCountForRun() using laIsSent() iterator (respects "never access Map directly" convention); laUpdateSentCounter() now uses laGetActiveRun() + laGetSentCountForRun() — fixes stale "3 of N sent to FC" counter when switching runs
- product-leak-analysis.js: tightened fixed column widths (priority 44px, stage/type 64px, details 40px, successMetric 18%) — reduces Priority/View column excess spacing
- prompts.js: story count changed from _spRange(2,maxStories) to exact _spRange(sc,sc) with Math.max(1,...) clamp — model now produces exactly N stories per feature regardless of multi-feature selection
- 05-kpi-tree.css: .dl-btn changed from green to purple ghost matching .export-cta-btn + justify-content:center for full-width panel button; added .out-body.has-right-panel{overflow-y:hidden;padding-bottom:0}

## v8.48 — Revert generation to Render; JSON guard; favicon; version fix

- scripts/api.js: reverted hosted generation path back to Render via PROXY_URL — fixes personal laptop generation which broke in v8.47; AI Recs (home.js) stays on Netlify function path; onrender.com whitelisting required for generation on HCL corporate network
- scripts/api.js: added non-JSON response guard on r.json() — surfaces clean "Generation timed out or proxy unavailable" error instead of raw JSON parse crash when proxy returns HTML timeout page
- index.html + login.html: bumped version to v8.48 (both files were stuck on v8.46 — missed in v8.47)
- favicon.ico: added minimal 16x16 purple favicon to project root + link tags in index.html and login.html — eliminates 404 console noise on every page load

## v8.47 — Route hosted AI calls through Netlify function; fix corporate network CORS

- scripts/api.js + scripts/home.js: hosted path changed from PROXY_URL (Render cross-origin) to /api/anthropic (same-origin Netlify rewrite) — eliminates CORS preflight entirely; works on HCL corporate network that blocks cross-origin OPTIONS to onrender.com; local dev (localhost:3001) unchanged
- netlify/functions/anthropic-proxy.js: rewritten to v5.09 — getHeader() case-insensitive helper (Netlify delivers headers lowercase); X-Auth-Token presence check (Phase 1 BYOK — not verified, deferred to Phase 2); isBase64Encoded body handling; Content-Type: application/json in CORS_HEADERS; OPTIONS returns 204
- packaging: server.js excluded from scripts/ (was incorrectly copied by wildcard in v8.46); now only in proxy/ where it belongs

## v8.46 — Proxy security hardening; Sessions stat sub-label; header input white text fix

- proxy/server.js: extracted corsOptions named object; added app.options('/api/anthropic', cors(corsOptions)) before rate limiter for deterministic preflight; added [CORS] origin-blocked warn logging; removed rejectUnauthorized:false from Anthropic upstream request (api.anthropic.com has valid cert)
- proxy/server.js: requireAuth() — removed !origin from isLocal condition (closes JWT bypass security gap where no-Origin hosted requests bypassed auth); added OPTIONS method passthrough guard; improved bypass log to include origin value
- scripts/home.js: Sessions hero stat sub-label now shows distinct product count (_heroProductCount via Set dedup) instead of session count — "2 products" not "7 products"
- styles/03-header-settings.css + scripts/session-store.js: added -webkit-text-fill-color:#fff!important to .hdr-session-input CSS and -webkit-text-fill-color:#fff to inline cssText — fixes Chromium (Edge/Chrome) rendering input text black despite color:#fff

## v8.45 — Session name restore definitive fix; _activeSessionName; input white text
- session-store.js: new _activeSessionName module-level var — in-memory source of truth maintained by hdrSetSessionName(); never set directly; all four name-setting paths (create, restore, header rename, home rename) go through hdrSetSessionName()
- session-store.js: new sessionStoreSyncRestoredSessionName(name) helper — calls both hdrSetSessionName() and mmUpdateSessionName() from single authoritative source; called after _ssRestoring=false so curTab is final and all DOM is rebuilt
- session-store.js: sessionStoreRestore() rewritten — removed early hdrSetSessionName() call (was firing while curTab==='home', hiding element); replaced with direct el.textContent seed; added mmUpdateSessionName() after mmRenderSessionPanel() in restore path; final sync via sessionStoreSyncRestoredSessionName() after _ssRestoring=false (definitive fix for 6-version recurrence)
- home.js: mmRenderSessionPanel() ph-sub reads _activeSessionName first, falls back to p.productName — prevents productName fallback overwriting session name when panel rebuilds
- 03-header-settings.css: color:#fff!important on .hdr-session-input — prevents browser default input text colour overriding white on unselected state

## v8.44 — Session name header; left panel sync; input white text
- api.js: after every mmRenderSessionPanel() call, immediately sync #mm-ph-sub via mmUpdateSessionName() reading current el.textContent — prevents mmRenderSessionPanel rebuilding the DOM and losing the session name with product name fallback; guard: only fires when header element has non-empty text
- session-store.js: hdrRenameSession() input className changed from 'hdr-session-name-input' to 'hdr-session-input hdr-session-name-input' — CSS .hdr-session-input carries color:#fff which was never applying due to class name mismatch; input text now white while typing
- kpi-tree.js: removed else branch after hdrSetSessionName() call that directly set pnEl.textContent=fd.name (product name) — this was silently overwriting the session name in the header with the product name on every DM generation/re-render

## v8.43 — Session name header structural fix; CAPS removed; dual box fix
- session-store.js: new hdrApplySessionNameVisibility() — reads el.textContent and curTab, controls show/hide only; never clears text; called from hdrSetSessionName, switchTab, and hdrRenameSession close/save
- session-store.js: hdrSetSessionName() rewritten — non-destructive on Home (preserves el.textContent, hides element only); on non-home with real name sets textContent then delegates visibility to hdrApplySessionNameVisibility; never calls mmUpdateSessionName('') on Home
- session-store.js: hdrRenameSession() — removed text-transform:uppercase from inp.style.cssText; _closeWithoutSaving() and _save() now call _restoreVisibility() (hdrApplySessionNameVisibility) instead of setting el.style.display directly; prevents re-show on Home if tab changes while editing
- api.js: switchTab('home') calls hdrApplySessionNameVisibility() instead of hdrSetSessionName('') — non-destructive hide; all non-home tab branches call hdrApplySessionNameVisibility() to restore session name visibility after returning from Home
- 03-header-settings.css: removed text-transform:uppercase from .hdr-product.has-name — session names display in natural case
- home.js + 17-home.css: homeSessionRenameInline() adds is-editing class to chip on open, removes on save/cancel; CSS .home-sess-name-chip.is-editing suppresses chip border/background/padding — eliminates dual box visual

## v8.42 — Header rename white text fix; left panel sync; inline edit idempotency; Run Diag CTA; table columns
- session-store.js: hdrRenameSession() fully rewritten — hides #hdr-product-name with display:none (never replaces it), inserts input next to it, restores on close; white colour preserved because original element with hdr-product/has-name classes is never touched; closed flag prevents blur cancelling after Enter; idempotency guard prevents double input; ChatGPT-verified pattern
- session-store.js: hdrSetSessionName() — curTab==='home' guard always clears and returns; calls new mmUpdateSessionName() to sync left panel; el.style.display controls visibility
- session-store.js: new mmUpdateSessionName(name) — direct DOM update of #mm-ph-sub for left panel session name; no localStorage read; called from hdrSetSessionName as sync hub
- home.js: mmRenderSessionPanel() ph-sub gets id="mm-ph-sub" and falls back to productName (overwritten by mmUpdateSessionName on next hdrSetSessionName call); homeSessionRenameInline() fully rewritten — idempotency guard, committed flag, click stopPropagation, Enter/Escape/blur handling; also updates header via hdrSetSessionName when renaming active session
- product-leak-analysis.js: laRenameRun() fully rewritten — dual idempotency guard (tagName===INPUT + parent querySelector), closed flag, save/cancel, mousedown+click stopProp; ChatGPT-verified
- kpi-tree.js: kpiRenderEvidenceStates() calls kpiUpdateRunDiagnosticsBtn() at end — diff-aware CTA state always applied last after evidence dots rendered
- product-leak-analysis.js: experiment column 28%, success metric 20%, stage 72px, type 72px; colgroup no longer skips auto width

## v8.41 — Header rename fix; inline edit closed flag; Home clears name; Run Diag CTA state
- session-store.js + index.html + 03-header-settings.css: hdrRenameSession() fully rewritten — closed flag prevents blur from cancelling after Enter; idempotency guard prevents double input; label.replaceWith(inp) pattern; event.stopPropagation() on pencil click; text-transform:uppercase removed from .hdr-session-input; hdr-product-name span gets hdr-session-label class; pencil button onclick passes event
- product-leak-analysis.js: laRenameRun() rewritten with same closed flag + _close(save) pattern
- api.js: switchTab('home') always clears session name in header (removed _activeSessionId guard — Home screen never shows session name)
- kpi-tree.js + diagnostic-view.js: Run Diagnostics CTA disabled when evidence unchanged since last run; kpiUpdateRunDiagnosticsBtn() calls _dvBuildEvidenceSnapshot/_dvDiffEvidence to check for changes; "Run again anyway" secondary link appears when disabled due to no changes; dvAnalyzeForce() bypasses guard via _dvForceRunFlag; no-evidence modal removed entirely

## v8.40 — Session name header fixes; inline edit blur; no-evidence modal; DM/MI left panel
- session-store.js: hdrSetSessionName() called after sessionStoreCreate() — header shows session name immediately on launch
- session-store.js + capability-canvas.js + feature-canvas.js + product-leak-analysis.js: all inline edit inputs add mousedown stopPropagation to prevent blur firing on input-internal click
- 03-header-settings.css + index.html: removed position:absolute from .hdr-product (was double-positioning); centering moved to .hdr-session-wrap CSS class; hdr-session-rename-btn gets outline:none box-shadow:none on :focus/:active; inline style removed from index.html
- api.js: hdrSetSessionName('') in switchTab('home') guarded by !_ssRestoring && !_activeSessionId — clears header only when genuinely on Home with no session; preserves name mid-session and during restore
- diagnostic-view.js: _dvPendingStages/Snap/Changed module-level vars store pending run data; _dvForceRun() reads them; no-evidence modal onclick calls _dvForceRun() — eliminates JSON.stringify of large objects in onclick attribute; modal uses correct design system classes with X close button
- home.js: mmRenderSessionPanel() ph-sub reads session name from localStorage meta instead of productName — applies to both DM and MI left panels

## v8.39 — Session restore; evidence diff; session name header; inline edit consistency
- api.js + session-store.js: switchTab() writes lastTab via debounced (300ms) sessionStoreUpdateLastTab() — synchronous localStorage-only write; _ssRestoring guard prevents writes during restore; session now restores to last visited tab not deepest tab
- kpi-tree.js: _mmShowRegenConfirm() rewritten with correct design system modal classes (modal-overlay → div.modal → modal-body → modal-footer → modal-cancel-btn → modal-confirm-btn danger)
- 12-product-leak-analysis.css: la-run-pill changed to white-space:normal word-break:break-word; la-main-content overflow:hidden enforces column widths when right panel open
- product-leak-analysis.js: left panel run item count always shows expCount (total experiments) not sentCount
- diagnostic-view.js + prompts.js: evidence diff — _dvBuildEvidenceSnapshot() captures structured fields only (currentValue/trend/targetBenchmark/instrumentationStatus); _dvDiffEvidence() scans backwards through runs to find most recent snapshot per metric; dvAnalyze() blocks if nothing changed (modal with Add Evidence / Generate Alternative Experiments CTAs); run scoped to changed metrics only; evidenceSnapshot stored on each run object; buildProductLeakPrompt() accepts changedMetrics — adjusts experiment count (min 2 per changed metric, max 12) when multiple metrics changed
- index.html + 03-header-settings.css + session-store.js + kpi-tree.js: header shows session name (meta.name) instead of product name; pencil icon appears on hover; hdrRenameSession() replaces text with width-constrained inline input (Enter saves, Escape/blur abandons, select-all on open); hdrSetSessionName() helper used by restore and generation paths
- home.js + capability-canvas.js + feature-canvas.js + pi-planning.js + kpi-tree.js: all inline edit inputs now call inp.select() on focus (select-all) — replaced setSelectionRange(len,len) cursor-at-end pattern; click propagation stopped on inputs inside clickable containers

## v8.38 — PD multi-fix; session restore; refine DM guard; prompt scope-lock
- session-store.js: _ssRestoring guard flag prevents switchTab() from overwriting lastTab during restore; lastTab only written on user-initiated saves; dmRegenAt freshness check in sessionStoreSyncFromDB prevents stale Supabase snapshot from restoring cleared downstream keys after DM regen
- kpi-tree.js: regen() now shows confirm modal when downstream data exists (CC/FC/SC/PI); modal includes async export link with Regenerate disable guard; _mmRegenProceed() sets dmRegenAt timestamp and synchronously clears downstream localStorage keys before generate(); 'Refine KPI Tree' label changed to 'Refine Discovery Map' throughout
- prompts.js: buildTreePrompt() scope-lock — when refinement text present, appends CURRENT TREE (compact: stage labels + L1 metric names) with explicit instruction to only modify mentioned stage/metric; prevents AI restructuring unrelated stages
- product-leak-analysis.js: _laResolveStageFromMetric() restored (was dropped in v8.36 rewrite) — fixes Send to FC ReferenceError; readiness fraction moved to same row as level value; la-sent-counter hidden when 0; 'Prioritized Experiments' title case; Run column td has title attribute for hover tooltip; metric dropdown dedup normalised case-insensitively; stage colour lookup is case-insensitive (fixes Run 3 not appearing in correct group); laRenameRun() replaced window.prompt() with inline input (Enter saves, Escape/blur abandons)
- 12-product-leak-analysis.css: la-table-wrap overflow-x improved; td overflow:hidden text-overflow:ellipsis prevents column text overflow when right panel open

## v8.37 — PD left panel nav; tab visibility; send fix; evidence restore; PI export fix
- kpi-tree.js: generateConfirmed() now hides tab-fc, tab-sc (removes .revealed), tab-pi (removes .revealed) on full DM regen — downstream tabs re-reveal as PM progresses through pipeline
- product-leak-analysis.js: laRenderLeftPanelInner() rewritten to use FC sc-nav-all/sc-nav-stage/sc-nav-metric/sc-nav-cap patterns; tree container changed from dv-lp-body to la-lp-tree (no padding/gap); runs grouped by stage → metric → run with STAGE_PALETTE colouring; readiness block moved to pinned footer (min-height:44px); hint block removed; subtitle truncated to single line
- product-leak-analysis.js: laRenderTable() experiment column changed to auto width; priority/details columns use px; colgroup skips width for auto column; resolves checkbox truncation on 14" laptop
- product-leak-analysis.js: new laParseSelectedExperimentKey() helper (lastIndexOf, Number.isInteger guard); laSendToStoryCanvas() rewritten with for...of loop resolving each key independently against productLeakAnalysis — works in both All Experiments view and single-run view; leakSelectedIds.clear() after successful send
- session-store.js: kpiRenderEvidenceStates() called after renderMM() in restore path — evidence dots and values now show immediately on DM after session restore without requiring navigation
- export-pi-docx.js: CDN version changed from docx@9.1.0 (403 blocked) to docx@7.8.2 (matches all other export files); LevelFormat removed from destructuring import; LevelFormat.BULLET replaced with string literal 'bullet'
- 12-product-leak-analysis.css: la-lp-tree class added; collapsed rule updated; la-readiness-foot/row/val/bar/fill classes added; sc-nav-all-icon and la-run-rename styles added

## v8.36 — PD multi-run accumulation; left panel nav redesign; footer + checkbox fixes
- state.js + diagnostic-view.js: productLeakAnalysis changes from single object to array of run objects; dvAnalyze() appends new runs instead of replacing; auto-generates runLabel as {bottleneckMetric} · {Mon DD} with time suffix for same-metric same-day collisions; runCustomName flag protects user renames from retroactive updates
- product-leak-analysis.js: full rewrite — laSentIds Map<runId,Set<idx>> with laIsSent/laMarkSent/laGetSentCount/laRebuildSentIdsFromCanvas helpers; new left panel with All Experiments nav + per-run items (dot, rename pencil, sent count); laGetActiveRun()/laGetVisibleExps() central resolvers; aggregate summary cards in All view, run-specific in single-run view; Run column in All Experiments table; data-run-id/data-exp-idx attributes replace bare index onclick; leakDetailExperiment replaces leakDetailExperimentIdx; Discovery Map copy fix
- session-store.js + kpi-tree.js: activeDiagnosticId saved/restored; legacy single-object compat guard wraps old data in array; laSentIds rebuilt from scCanvas on restore; all productLeakAnalysis null checks updated for array format
- demo-data.js: productLeakAnalysis wrapped in array with runId/runLabel/runTimestamp; export-diagnostic-docx.js: exports active run or most recent
- 12-product-leak-analysis.css: la-footer-bar + la-dp-footer min-height:44px for footer bar alignment; la-exp-table min-width:640px + checkbox col min-width:26px for truncation fix; new left panel nav styles (la-all-exps, la-run-item, la-run-dot, la-run-pill, la-runs-section-lbl)

## v8.35 — FC diagnostic stage grouping fix; CC right panel preserved after generation
- product-leak-analysis.js: new _laResolveStageFromMetric() walks gData.stages to find the KPI tree stage for a linked metric; laSendToStoryCanvas() now uses resolved stage for FC grouping instead of AI-inferred lifecycleStage — fixes experiments landing under wrong stage headers (e.g. Despatch/Last Mile instead of Pick and Pack)
- capability-canvas.js: ccGenerateFeaturesForCap() _wasAllCaps success path now calls ccRenderAllCaps() before resetting capActiveMetricKey to null — right panel stays open with generated features instead of closing; error path also resets capActiveMetricKey when _wasAllCaps to prevent left nav state corruption

## v8.34 — Proxy: JWKS-based JWT verification (ECC P-256)
- proxy/server.js: replaced HS256 shared-secret jwt.verify with JWKS-based ES256 verification via jwks-rsa; requireAuth rewritten as async callback middleware; JWKS client lazy-loads on first request with 5min cache + 5s timeout; startup log updated to show JWKS status from SUPABASE_URL; SUPABASE_JWT_SECRET env var no longer needed
- proxy/package.json: added jwks-rsa@^3.1.0 dependency; version bumped 2.0.0 → 2.1.0
- Fixes "JWT verification failed: invalid algorithm" on both dev and prod Render proxies after Supabase migrated signing keys from Legacy HS256 to ECC P-256 (5 days ago)

## v8.33 — JWT token refresh fix (all AI calls)
- auth.js: new authGetFreshToken() helper — getSession() first, 90s expiry check, forced refreshSession() with refreshInFlight deduplication guard, login redirect on total failure; fixes "Session expired or invalid" after overnight use or sign-out + sign-in cycle
- api.js: callAPI() JWT block replaced with authGetFreshToken() — all 15+ AI call sites (DM, CC, FC, SC, PI, MI, DD) inherit the fix in one change
- home.js: _homeCallAIRecs() JWT block replaced with authGetFreshToken(); _homeAIRecsRequested flag now reset in .catch so Refresh button self-recovers after any transient error

## v8.32 — FC empty state centering (correct fix via direct-child pattern)
- index.html: added #sc-panel-empty div as direct child of sc-panel-scroll (sibling of sc-panel-loading and sc-panel-content) — ChatGPT-confirmed pattern; only direct children of overflow-y:auto flex containers reliably resolve flex:1 height
- 08-feature-canvas.css: .sc-panel-loading and #sc-panel-empty share flex:1/display:none/.on rules; #sc-panel-content.is-hidden added for clean show/hide; loading/empty/content are now three mutually exclusive sibling states
- feature-canvas.js: scRenderPanel() writes empty state HTML into #sc-panel-empty + adds .on class when no stories; hides #sc-panel-content via .is-hidden; reverses on story presence; all 4 state paths updated (loading start, error, scRenderPanel empty, scRenderPanel has-stories)

## v8.31 — FC empty state centering (final fix); CC export dropdown
- 08-feature-canvas.css: .sc-panel-scroll gets height:0; min-height:0 — gives sc-panel-scroll a definite flex-assigned height so nested flex:1 children resolve correctly; fixes empty state top-alignment; confirmed safe for scroll behaviour (ChatGPT-validated)
- 10-capability-canvas.css: .cc-export-drop changed to position:fixed (was position:absolute) — position:absolute was clipped by cc-tab overflow:hidden; z-index raised to 1000
- capability-canvas.js: ccToggleExportDrop() positions dropdown via getBoundingClientRect() setting style.top and style.right; _ccCloseExportDrop() helper clears both classList and inline styles; all 4 close paths updated (document click, ccToggleCCFilterDrop, ccToggleAddCapDrop, ccCloseExportModal)

## v8.30 — Fix: AI Recommendations CORS error on dev Netlify
- home.js: _homeCallAIRecs() now reads PROXY_URL from env.js instead of hardcoded prod proxy URL — dev Netlify was hitting prod proxy which blocks dev origin with CORS; _homeCallAIRecs made async; JWT X-Auth-Token header added (same pattern as callAPI) so hosted requests pass proxy auth

## v8.29 — Hotfix: export-docx.js null crash on #f-name after session restore
- export-docx.js: replaced document.getElementById('f-name').value with sessionContext.productProfile.productName read — #f-name is destroyed by mmRenderSessionPanel() (called during session restore in Step 6), causing a null crash on Export; sessionContext is the authoritative source since v7.57 Home tab launch flow; DOM fallback retained for safety

## v8.28 — PI modal fix; FC empty state centering; MI checkbox UX
- pi-planning.js: endAiGen() called before revealAndSwitchTab('pi') in piGenerate() try block — prevents blockIfGenerating() showing the leave-confirmation modal immediately after a successful PI generation
- index.html + feature-canvas.js + 08-feature-canvas.css: removed padding:14px 16px from sc-panel-content parent; FC empty state min-height:200px removed (flex:1 now centres correctly); sc-story-item-pi-mode and sc-panel-pi-hdr get explicit padding:0 16px to preserve side spacing
- market-intelligence.js + 13-market-intelligence.css: MI capability added state now shows filled purple checkbox (mi-cap-chk-added) with hover-to-remove affordance; clicking fires miRemoveFromCC(); removed separate Remove underline link; mi-sent-badge retained as label only

## v8.27 — Hotfix: remove loading stub that destroyed #home-empty-wrap
- main.js: removed stub innerHTML injection from #home-main-body — stub was nuking #home-empty-wrap from the DOM before homeInit() ran; homeRenderSessionLibrary() could not find it to show the empty state, leaving the screen permanently blank; Promise.all sequencing and homeInit() order unchanged

## v8.26 — Hotfix: spSyncProfilesFromDB .single() → .maybeSingle()
- settings-page.js: replaced .single() with .maybeSingle() in spSyncProfilesFromDB — .single() throws a 406 when no profiles row exists (new user), escaping the try/catch and hanging Promise.all indefinitely; .maybeSingle() returns null cleanly, existing 'if (!data) return' guard handles it correctly

## v8.25 — Phase 1 Step 7: Profile + appSettings sync to Supabase
- settings-page.js: _spStripDocs/_spStripCoDocs hoisted to module scope; _spPersistProfiles() adds async fire-and-forget Supabase upsert to profiles.company + profiles.products (onConflict: user_id); localStorage write unchanged as fast-path cache
- settings-page.js: spSyncProfilesFromDB() — new public async function; merges company/products/settings from Supabase profiles row into in-memory state + localStorage; Object.assign merge preserves state.js defaults for missing appSettings keys; PGRST116 (no row) handled silently for new users
- settings-page.js: settingsPageSave() — async fire-and-forget upsert of appSettings to profiles.settings column after applyFeats()
- main.js: both DB syncs now run in parallel via Promise.all([sessionStoreSyncFromDB, spSyncProfilesFromDB]); updateHeaderOrg() moved to after syncs complete so org name reflects fresh DB data; proxy/server.js: app.set('trust proxy', 1) added — fixes express-rate-limit X-Forwarded-For warning on Render

## v8.24 — Phase 1 Step 6: Session data persistence to Supabase
- session-store.js: write-through cache pattern — localStorage written first (synchronous), Supabase upserted async (fire-and-forget); all functions preserve existing signatures and call sites
- session-store.js: sessionStoreSyncFromDB() — new public async function; called on login; pulls all user sessions from Supabase, hydrates localStorage and rebuilds _SS_INDEX; Supabase failure leaves localStorage unchanged
- session-store.js: _ssGetClient() + _ssUpsertToDB() private helpers; sessionStoreCreate, sessionStoreSave, sessionStoreDelete, sessionStoreRename all updated with async DB writes; RLS enforces per-user data isolation
- main.js: loading stub (pulsing dots + 'Loading your sessions…') injected into home-main-body before sync; await sessionStoreSyncFromDB() before homeInit() — home tab always shows DB-fresh session list on load

## v8.23 — Phase 1 Step 5: Proxy upgrade (JWT auth + env-var CORS + shared key)
- server.js: JWT verification middleware added (requireAuth) — verifies X-Auth-Token Supabase JWT on every /api/anthropic request; local dev bypasses JWT check; expired/invalid tokens return auth_error; SUPABASE_JWT_SECRET read from Render env var
- server.js: CORS replaced hardcoded origins array with ALLOWED_ORIGIN env var + local dev origins; X-Auth-Token added to allowedHeaders
- server.js: API key priority — ANTHROPIC_API_KEY env var (shared org key) takes priority over BYOK Authorization header; falls back to BYOK if env var unset
- server.js: package.json updated — jsonwebtoken@^9.0.2 added; version bumped to 2.0.0
- api.js: callAPI() reads PROXY_URL from env.js constant (dev/prod switching via env.js); JWT access_token retrieved via authGetSession() and sent as X-Auth-Token header on every request; local dev falls back to localhost:3001 regardless of PROXY_URL

## v8.22.5 — MI panel background: grey headers, white content
- 13-market-intelligence.css: mi-section-body background:#fff — section content areas white; mi-section and mi-section-hdr retain var(--card) grey — section header rows stay grey; mi-right-body background:#fff — gap areas between sections white

## v8.22.4 — MI panel true white background
- 13-market-intelligence.css: mi-right, mi-right-body, mi-section, mi-section-hdr backgrounds changed from var(--card) (#F4F6FA) to #fff — gap areas between section cards and header area now match FC/CC white panel style

## v8.22.3 — MI panel layout: flush borders, white bg, right-aligned CTA, clean toast
- 13-market-intelligence.css: height:100% on mi-right-content — panel fills full height, top/bottom borders flush with left panel; width:100% on mi-cap-footer-inner — CTA button right-aligned; background:var(--card) on mi-right-body — white background fills gaps between section cards
- market-intelligence.js: removed Open CC link from miSendToCC toast — info only

## v8.22.2 — MI footer polish; CC Generate Features title case
- 13-market-intelligence.css: mi-cap-footer height:48px, padding:0 16px, background:var(--card), display:flex, align-items:center — matches cc-action-bar; mi-cap-send-btn font-size:11px, font-weight:700, padding:8px 16px, border-radius:7px — matches la-send-btn; mi-cap-footer-lbl font-size:11px
- capability-canvas.js: Generate Features, Generating Features title case on right panel button and loader messages

## v8.22.1 — Hotfix: MI loader CSS restored; interrupted session resume; MI footer fixed; CC Generate Features
- 13-market-intelligence.css: restored mi-loader-timeline, mi-loader-stage, mi-loader-node, mi-loader-connector, mi-loader-stage-left/right/name, mi-loader-submsg, mi-load-stage-label, mi-cap-info, mi-cap-kpi-path, mi-load-note — all incorrectly deleted in v8.22 CSS range deletion; fixes DM and MI loader styling and MI cap row layout
- session-store.js: hideLoad() + endAiGen() called before showing interrupted session state — clears stale loader and intervals; interrupted message now correctly centered
- market-intelligence.js: MI cap footer moved outside mi-right-body to sit as fixed bottom bar (flex-shrink:0) — always visible regardless of scroll; miRefreshCapSection also refreshes footer element; featStore initialised as {top:null} instead of {top:[]} so CC correctly shows Generate Features button on MI cap cards

## v8.22 — MI → CC → FC architecture: MI caps now flow through CC, not directly to FC
- market-intelligence.js: replaced feature panel + direct-to-FC send with PD-style checkbox selection; miSendToCC() writes to single capStore['mi||capabilities'] entry (metricName:'MI Capabilities'); miRemoveFromCC() with confirm modal when cap has features; miToggleCapSelect(); _miCapFooterHtml(); deleted 9 panel functions (miOpenCapPanel, miCloseCapPanel, miCloseCapPanelUserAction, miRenderCapPanel, miPanelLoadFeatures, miPanelToggleFeature, miPanelRefineSubmit, miPanelSend, miUndoSend); miSelectedCapNames added for transient selection state
- capability-canvas.js: ccOpenMetricNav MI section now uses single mi||capabilities key, renders one "MI Capabilities" nav item; ccRenderAllCaps group header metric label fixed to "MI Capabilities"
- state.js: miFeatureCache removed, miSelectedCapNames=new Set() added
- session-store.js: miFeatureCache save/restore removed
- kpi-tree.js, home.js, demo-data.js: miFeatureCache references removed; demo-data.js updated to pre-populate capStore['mi||capabilities'] in all 3 demo sessions
- 13-market-intelligence.css: mi-cap-panel-* styles removed; mi-cap-chk and mi-cap-footer styles added

## v8.21 — Interrupted session resume shows clear recovery state
- session-store.js: sessionStoreRestore now detects when resumed session has null gData (generation was interrupted) and replaces generic empty state with "Generation was interrupted" message, product name, and direct Generate KPI Tree CTA

## v8.20.1 — CC: MI caps unified under one group header; FC: MI features group by cap name
- capability-canvas.js: ccRenderAllCaps now collects mi|| entries into miCaps[] (parallel to piCaps[]) and renders them under a single Market Intelligence group header — no more one header per cap
- market-intelligence.js: scCanvas push now uses capName as metric/metricPath and Market Intelligence as stage — FC groups MI features by cap name not KPI metric name

## v8.20 — CC: dedicated Market Intelligence nav section; group header colour fix
- capability-canvas.js: MI caps now appear in a dedicated "Market Intelligence" section in the CC left nav (parallel to PI Plan section) — one item per mi|| cap, clicking navigates to cap card; ccFindInjectedCapKey scoped to diag|| only; ccMNSelectMetric mi|| redirect removed; ccMNSelectMI() added; border-left colour added to cc-all-group-hdr in metric-selected view (ccRenderMainContent) to match All Capabilities view
- market-intelligence.js: metricName in miPanelSend capStore write reverted to capName — MI nav section makes KPI linkage unnecessary

## v8.19.1 — Hotfix: MI caps now findable via KPI metric in CC left nav
- market-intelligence.js: miPanelSend capStore entry now sets metricName to route.metric (KPI metric name when cap aligns to KPI tree) instead of capName — ccFindInjectedCapKey now correctly matches MI caps when clicking linked KPI metric in CC nav

## v8.19 — CC metric nav shows injected caps; Refine KPI Tree greyed out during diagnostics
- capability-canvas.js: added ccFindInjectedCapKey() helper — finds mi|| or diag|| capStore entry matching a KPI metric name; ccOpenMetricNav() isDone/capCount now includes injected caps so count badge shows on linked metric; ccMNSelectMetric() resolves injected key when KPI metric has no generated caps so clicking metric shows the cap card
- diagnostic-view.js: dvShowAnalyzeLoading() now disables #diag-refine-btn and #diag-refine-send during analysis; restores both on completion/error

## v8.18 — Fix: MI and PD cap cards not showing in CC (peer-reviewed with ChatGPT)
- capability-canvas.js: ccOnTabEnter now uses activeEntryHasCaps (strict guard: capActiveMetricKey must have a capStore entry with capabilities.length>0) instead of simple capActiveMetricKey truthiness; stale capActiveMetricKey/capActiveCapIdx/capActiveSubCapIdx/ccPanelCapKey cleared before ccRenderPartial so ccOpenMetricNav correctly routes to ccRenderAllCaps
- market-intelligence.js: miPanelSend and miUndoSend now clear stale active metric state and call ccOpenMetricNav (rebuilds full nav + content) instead of conditionally calling ccRenderAllCaps only when capActiveMetricKey===null
- product-leak-analysis.js: laSendToStoryCanvas same fix — full state clear + ccOpenMetricNav

## v8.17 — Regression fixes: evidence dots on DM re-entry, CC left panel + cap cards, FC filter on send
- api.js: kpiRenderEvidenceStates() called on every mm tab entry — evidence dots now re-paint after navigating away and returning
- capability-canvas.js: ccOpenMetricNav() now uses hasAnyCaps (Object.keys(capStore).length>0) instead of done>0 at all three routing points — mi|| and diag|| caps correctly show All Capabilities nav item, all-caps view, and cap cards with left nav present; ccRenderPartial() simplified to single ccOpenMetricNav() call
- product-leak-analysis.js: scCapNavFilter reset to null before fcRenderCanvas() — PD experiments now visible in FC regardless of prior cap filter state
- market-intelligence.js: scCapNavFilter reset to null before fcRenderCanvas() — MI features now visible in FC regardless of prior cap filter state

## v8.16 — Regression fixes: MI left panel during generation, CC cap cards, diagnostics nav lock
- market-intelligence.js: miGenerate now sets two-column skeleton first (preserving #mi-left-panel), loader injected into .mi-right only; _miLoaderAdvance and error path both target mi-right-loader — #mi-left-panel survives entire generation lifecycle
- api.js: reverted v8.15 mi exception — #left-panel and #mi-left-panel are separate elements; sc-hidden on #left-panel has no effect on Research Context panel
- capability-canvas.js: ccOnTabEnter entry gate changed from ccCountGenerated() to Object.keys(capStore).length>0 — mi|| and diag|| caps now correctly reach ccRenderPartial(); ccCountGenerated() unchanged at nav remaining count call site
- diagnostic-view.js: dvAnalyze now calls startAiGen with abort signal before callAPI; signal passed to callAPI; endAiGen in both success and catch paths; AbortError handled

## v8.15 — Regression fixes: MI left panel, CC tab reveal, CC cap card rendering
- api.js: left panel no longer hidden when switching to MI tab — mi excluded from sc-hidden rule
- market-intelligence.js: CTA button disabled with spinner during MI generation; restored on completion/error; CC tab revealed on first MI feature send
- product-leak-analysis.js: CC tab revealed on first PD experiment send
- capability-canvas.js: ccOnTabEnter guard reordered — ccCountGenerated checked before !gData so mi|| and diag|| caps are found even without a KPI tree; ccRenderPartial routes to ccRenderAllCaps when only injected caps exist (no KPI/PI caps)

## v8.14 — Regression fixes: PI stale banner, MI results, left panel, CC traceability, Settings order
- pi-planning.js: stale banner no longer fires on fresh PI generation — removed redundant piRenderBoard/piHideStaleBanner from piGenerate; revealAndSwitchTab already triggers piOnTabEnter which handles both
- kpi-tree.js: MI results now render immediately after session launch with MI enabled — miRenderScreen called post-DM completion; silent MI parse failure replaced with visible toast
- market-intelligence.js: left panel no longer disappears during MI generation — removed redundant sc-hidden add (switchTab already handles this); miPanelSend now writes to capStore using scMakeFeatureId IDs; miUndoSend cleans capStore on undo
- capability-canvas.js + product-leak-analysis.js: MI and PD features now create traceable capStore entries (mi|| and diag||); ccCountGenerated scoped to exclude injected keys; ccGetCapNavPool includes mi|| and diag|| caps; PD experiments grouped as "Diagnostic Experiments — [Metric]"; Settings section order updated (Product Profiles now section 2)

## v8.13 — Login + My Profile polish
- login.html: auth-toast moved from above Email field to just above CTA button — fields no longer jump when toast appears
- login.html: page title em dash fixed — "Sign In — Product Growth Toolkit" → "Sign In | Product Growth Toolkit"
- settings-page.js: auto-save status moved inline right of name input — removed reserved vertical space below field; idle state shows nothing, no gap

## v8.12 — My Profile redesign: identity card + auto-save
- settings-page.js: spP0() redesigned — identity card layout (52px avatar circle + name field + email row); inline Save Name button removed; domain badge removed
- settings-page.js: spP0OnNameInput() — oninput handler updates avatar circle live using _avatarInitials(); triggers 800ms debounced auto-save via _spP0NameTimer
- settings-page.js: spP0SaveName() — now called by debounce timer; inline status line replaces toast (Saving… → Saved · Avatar updated → fades after 3s; error stays visible)
- settings-page.js: spP0ResetPassword() and _spP0Toast() unchanged

## v8.11 — Phase 1 Step 4: My Profile in Settings (Section 0)
- settings-page.js: Section 0 (My Profile) inserted as first nav item; _spSection default changed to 0; nav loop, panel loop, spNav(), _spTitle(), _spDesc() all updated to include 0; spP0() panel added with Display Name (inline async save via supabase.auth.updateUser), Email (read-only), Password reset (calls authResetPassword); spP0SaveName() updates currentUser.displayName and calls updateHeaderAvatar(); spP0ResetPassword() reuses authResetPassword from auth.js; _spP0Toast() inline toast helper
- index.html: "My Profile" button added to avatar dropdown above divider and Sign Out
- 03-header-settings.css: .hdr-avatar-profile styles added
- main.js: hdrOpenProfile() added — closes dropdown, calls openSettingsToSection(0)

## v8.10 — Phase 1 Step 3: Avatar badge + logout dropdown
- index.html: avatar badge added to hdr-r, left of settings gear; dropdown with display name, email, divider, Sign Out button
- 03-header-settings.css: avatar badge, dropdown, overlay styles added
- main.js: _avatarInitials() helper (first + last name initials, single word fallback, empty fallback '?'); updateHeaderAvatar() populates badge and dropdown from currentUser; hdrAvatarToggle(), hdrAvatarClose(), hdrSignOut() wired to DOM; updateHeaderAvatar() called after auth gate resolves

## v8.09 — env.js credential separation + version fix
- New scripts/env.js: holds SUPABASE_URL and SUPABASE_ANON_KEY constants — excluded from all Claude zips; created once locally and dropped into scripts/ before each Netlify deploy
- auth.js: hardcoded credential constants removed; now reads from env.js loaded before it
- login.html + index.html: env.js script tag added before auth.js
- index.html: hdr-version corrected to v8.09 (was stale at v8.06 since v8.07)

## v8.08 — Login page fixes + Title Case rule
- login.html: header replaced with exact .hdr structure from index.html (03-header-settings.css added); auth-hdr custom styles removed from 18-auth.css
- login.html: all labels, titles, CTAs corrected to Title Case (Welcome Back, Create Your Account, Sign In, Create Account, Display Name); descriptive copy remains sentence case
- 18-auth.css: native browser password reveal icon suppressed (ms-reveal, webkit-credentials-auto-fill-button)
- login.html: authForgotPassword() — authClearFieldErrors() called before success toast; reset copy updated to "If that email is registered, a reset link is on its way. Check your inbox."
- DESIGN_SYSTEM.md: Title Case vs sentence case rule added to Typography section with full reference table

## v8.07 — Phase 1 Step 1+2: Login/Signup screen + Auth gate
- New login.html (standalone), scripts/auth.js (Supabase client + authInit/SignIn/SignUp/SignOut/GetSession/GetUser/ResetPassword), styles/18-auth.css; AUTH_DOMAIN constant added to config.js
- index.html: Supabase CDN script + auth.js loaded before state.js
- main.js: DOMContentLoaded made async; auth gate added — no session redirects to login.html; valid session populates currentUser global before app inits
- Supabase profiles table updated: settings jsonb column added (both pgt-dev and pgt-prod) — ready for Step 7 appSettings sync

## v8.06 - AI recs scrollbar hidden by default on all platforms
- 17-home.css: AI recs panel scrollbar now hidden at rest on Windows Chrome and Firefox — added scrollbar-width:none (Firefox default), ::-webkit-scrollbar-track{background:transparent} (Chrome/Edge, prevents grey track rendering on Windows), and restored thin purple thumb on panel hover via scrollbar-width:thin + scrollbar-color for Firefox; previously the scrollbar track rendered as a visible flat bar on the deployed Netlify site (Windows Chrome) while local server looked correct

## v8.05 - Tab bleed fix, CTA bar restore, session X hit area, loader Title Case
- home.js: homeClearSession() now calls removeAttribute('data-home-hidden') on all 7 tabs alongside the hide/revealed-remove steps — previously stale data-home-hidden flags caused switchTab('mm') to restore session 1 tabs (FC, SC, PI) into a fresh session 2 that had no features or stories
- api.js: switchTab('mm') now calls renderDiagnosticActionBar() when gData exists but #diag-action-bar is absent from the DOM — the bar was removed by homeClearSession on session change and never re-rendered on restore, leaving DM without its bottom CTA bar after resuming a session
- 17-home.css: home-sess-x z-index raised to 10, hit area increased to 24x24px; home-sess-right and home-sess-name-chip max-width reduced to 140px to prevent the name chip overlapping the delete button on long session names
- capability-canvas.js: loader messages corrected to Title Case — "Generating Capabilities…" and "Regenerating Capabilities…" (sentence-case sub-message on line 1960 left unchanged)
- 17-home.css: AI recs panel scrollbar hidden by default on all platforms — added scrollbar-width:none (Firefox) and ::-webkit-scrollbar-track{background:transparent} (Chrome/Windows) so the track doesn't render as a visible grey bar; thin purple thumb restored on panel hover via scrollbar-width:thin + scrollbar-color for Firefox and ::-webkit-scrollbar-thumb for Chrome

## v8.04 - Tab visibility fixes, alphabetical product sort, stale panel clear on session change
- api.js: tab-sc and tab-pi now included in the Home hide/restore arrays — previously both tabs remained visible in the tab row when navigating to Home from an active session (SC/PI use .revealed class, not style.display, so the existing hide loop missed them); restored correctly on return to Discovery Map
- home.js: product selector dropdown now sorted alphabetically by product name; session filter product list also sorted alphabetically
- home.js: homeClearSession() now calls scClosePanel() after clearing scCanvas — removes panel-open/open DOM classes from #sc-main/#sc-panel so session 1 story panel no longer appears when session 2 navigates to Feature Canvas
- home.js: homeClearSession() now calls fcUpdateTabBadge() after scCanvas=[] — badge function sees empty canvas and hides tab-fc, preventing Feature Canvas tab from persisting visible into a new session that has no features yet

## v8.03 - Whitelabelling: dynamic org name, naming unified to Product Growth Toolkit
- New `getOrgName()` helper in utils.js reads `companyProfile.companyName`; header logo slot (`#logo-txt`) and separator (`#hdr-sep`) show org name when set, hidden when empty; `updateHeaderOrg()` called on DOMContentLoaded and after settingsPageSave()
- All five DOCX exports (Story Canvas, Capability Canvas, PI Plan, Diagnostics, Market Intelligence) now use `getOrgName()` for org attribution; "Generated by HCLTech" watermark lines removed from all exports; "Product Consulting Practice" and "Global Value Chain" labels replaced with "Product Growth Toolkit" throughout
- AI prompts in prompts.js: removed "at HCLTech" from two role-persona lines (market intel, MI feature); no functional impact on output quality
- Governance docs (AI_EDITING_RULES.md, DESIGN_SYSTEM.md, PROJECT_MAP.md, CHANGELOG.md, README.md, server.js, package.json) title/description lines updated from "HCLTech Product Growth Diagnostic Suite" to "Product Growth Toolkit"; historical CHANGELOG entries (corporate laptop SSL fix, logo alignment) left untouched as factual record

## v8.02 - AI recs scrollbar + lastTab restore fix
- 17-home.css: AI recs overflow-x hidden; vertical scrollbar 3px thin, transparent at rest, purple on panel hover; rec text word-wrap prevents horizontal overflow
- home.js: AI recommendations increased from 2 to 3 — prompt, render slice, and call instruction all updated
- session-store.js: lastTab forced to targetTab directly in localStorage after restore — fixes session card resume landing on wrong tab regardless of downstream saves overwriting curTab

## v8.01 - Session restore + dashboard layout fixes
- session-store.js: sessionStoreSave() called immediately after restore — fixes Last Active badge stale on first navigation and lastTab saved with correct tab for session card resume
- home.js: homeInit() calls homeRenderSessionLibrary() — sessions now render on hard refresh without needing to visit Settings first
- 17-home.css: dashboard row fixed at 150px height; hero bar padding 18px for centred stats; AI recs overflow-y:auto for scrollable content; AI panel overflow:hidden

## v8.00 - Fix session library not rendering on initial page load
- home.js: homeInit() now calls homeRenderSessionLibrary() — sessions were invisible on hard refresh because homeInit never rendered the library; only homeOnTabEnter did (triggered on tab re-entry, not on first load)
- Root cause: visiting Settings and returning triggered homeOnTabEnter which rendered sessions correctly, masking the missing initial render call

## v7.99 - Dashboard stability + AI recs persistence
- home.js: dashboard row built once per page load — AI recs DOM preserved across Home tab navigations; sessions header row rebuilt separately for filter/sort state
- home.js: hero stat eyebrow renamed to "Product Discovery Snapshot"; font sizes increased (val 22→28px, label 9→11px, sub 8→10px)
- 17-home.css: dashboard grid uses minmax(0,1fr) to prevent overflow beyond viewport; AI panel min-height:110px prevents layout collapse during loading
- session-store.js: data-home-hidden cleared on restore — carried forward from v7.98 fix

## v7.98 - Dashboard redesign + AI recs fixes
- home.js + 17-home.css: 50:50 dashboard row — hero stats (left, white card) and AI recs (right, purple tint panel) side by side at fixed height; eliminates layout shift during loading
- home.js: AI recs fire once per page load — _homeAIRecsRequested flag prevents re-call on every Home tab entry; Refresh button resets flag
- home.js: AI prompt targetTab fixed — now instructs Claude to return the current session stage tab, not the next recommended tab
- session-store.js: data-home-hidden cleared before tab hide in restore — fixes conflict with switchTab restore logic that was re-showing prior session tabs

## v7.97 - Home dashboard redesign + session restore fixes
- home.js + 17-home.css: hero bar replaces old portfolio strip — light treatment (white bg, purple values), 5 stats (Sessions/Discovery Maps/Capabilities/Features/Stories) with contextual sub-labels
- home.js: AI Recommendations section — calls Claude on first Home entry, cached in sessionStorage, max 2 recs, each row clickable (resumes session + navigates to target tab), Refresh button for on-demand regeneration
- session-store.js: all tabs hidden before _ssRevealTabs() on restore — fixes prior session tabs bleeding into resumed session
- settings-page.js: companyProfile docs extractedText stripped before localStorage persist — fixes silent overflow failure causing company profile not to restore after refresh

## v7.96 - Session restore fixes + Home redesign
- api.js: DM tab entry now calls renderMM() if tree not rendered and hides empty state when gData exists — fixes blank DM on resume from CC/FC
- api.js: workflow tabs (DM/CC/FC etc.) hidden when navigating to Home during active session; restored on leaving Home
- home.js + 17-home.css: "Continue where you left off" section replaced with portfolio summary strip (Sessions/Capabilities/Features/Stories/PI Plans aggregated across all sessions)
- home.js: unified session grid — last active card distinguished by purple border + LAST ACTIVE badge; filter/sort copy updated to Title Case; Session Name sort added; toolbar title renamed to All Sessions

## v7.95 - Profile persistence + SSL fix
- settings-page.js: companyProfile and productProfiles now written to localStorage on every save/delete mutation
- settings-page.js: _spRestoreProfiles() runs on script load — profiles repopulate before first render, surviving refresh and reopen
- proxy/server.js: rejectUnauthorized:false added to https.request — fixes SSL certificate error on HCLTech corporate laptops (v7.94 fix carried forward)
- Both fixes delivered together; v7.94 superseded

## v7.94 - Fix SSL certificate error on corporate laptops
- proxy/server.js: added rejectUnauthorized:false to https.request options
- Corporate SSL inspection injects an internal CA cert that Node.js built-in CA list doesn't trust
- Fix is scoped to the single Anthropic outbound request only — does not affect Express server TLS
- Applies to both home and corporate network usage on HCLTech-managed Windows machines

## v7.93 - Fix proxy fetch failure on Windows Node.js
- proxy/server.js: replaced native fetch with Node built-in https.request module
- Native fetch silently fails on Windows Node v25 due to TLS handling differences — https.request is guaranteed to work on all Node versions and platforms
- Zero new dependencies — https is a Node built-in, no npm install required
- 403 org policy block detection preserved in https.request response handler

## v7.92 - Local proxy routing for org API keys
- api.js isLocal branch now routes to local proxy at http://localhost:3001/api/anthropic instead of direct Anthropic call
- Direct browser call removed — org keys now work locally without CORS restriction
- proxy/server.js default port changed from 3000 to 3001 to avoid clash with local-server.js
- Local workflow: Terminal 1 — node scripts/local-server.js (port 3000); Terminal 2 — node proxy/server.js (port 3001)

## v7.91 - Fix local-server.js root path
- ROOT path corrected to path.dirname(__dirname) — resolves to app root when file lives in scripts/ subfolder
- v7.90 ROOT was __dirname which resolved to scripts/ causing index.html not found on every request
- Run instruction updated: node scripts/local-server.js from app root folder

## v7.90 - Zero-dependency local server
- Replaced local-server.js Express-based server with zero-dependency Node.js http/fs implementation
- No npm install or node_modules required — runs with Node.js built-in modules only
- Serves all project file types (HTML, JS, CSS, XLSX, images, fonts) with correct MIME types
- SPA fallback to index.html for unmatched routes; run from app root: node scripts/local-server.js

## v7.89 - Session restore and rename fixes
- Fix #2: DM re-render after resume now calls renderMM(gData) correctly (was calling non-existent renderTree()); also restores mm-out .on class so Discovery Map content area is visible; renderMM only fires when restoring to mm tab — other tabs let switchTab() handle their own rendering on entry
- Fix #3: DM left panel no longer bleeds into CC/FC after resume — all deferred setTimeout canvas renders removed; for non-mm target tabs, left-panel .sc-hidden is enforced explicitly after switchTab() to prevent race condition
- Fix #6: homeClearSession() now called before _activeSessionId is set (not after) — eliminates double Active badge when switching between sessions
- Fix #4/#1: Inline rename chip expands to full right-column width on edit (larger hit target, cursor repositioning no longer loses focus); blur delay increased to 200ms; search input focus outline suppressed

## v7.88 - Session library bug fixes and polish
- Critical: homeRenderSessionLibrary() now splits toolbar and cards into separate DOM nodes — toolbar persists across filter/sort/search changes, only cards area re-renders; fixes search input losing focus after every keystroke; added _homeSessionSearchLive() handler that restores focus and cursor position after re-render
- Session library rendering fixes: zero-session state now removes library div and restores home-empty-wrap; single session no longer duplicates between pinned banner and grid (pinned session excluded from grid); delete of last session correctly restores empty state
- sessionStoreRestore() now hides tab lock message (#home-tab-lock, .tab-hint), re-renders DM (renderTree), CC (ccRenderAllCaps), FC (fcRenderCanvas), PI (piRenderBoard), MI (miRenderScreen) after state restore with 50ms defer; fixes DM not showing after resume
- UI: 3-column grid (was 2), scrollbar 5px width, name chip max-width 180px, inline rename blur guard (_committed flag + 150ms delay), browser focus ring suppressed on rename input, active session card highlighted with purple border + "Active" badge, obsolete "Start a new session?" modal removed from Launch Session and Load Demo flows

## v7.87 - Session library critical fix + inline name rename
- Fix: home-main div was missing id="home-main-body" — homeRenderSessionLibrary() was silently returning null on every call, causing session cards to never appear after launch; fixed by adding id to the container div in index.html
- Session name chip rename now uses inline edit: clicking the chip replaces it in-place with a styled input (Enter to save, Esc to cancel, blur to save); removed window.prompt() entirely; input matches chip dimensions and colour tokens exactly

## v7.86 - Session persistence: localStorage session library, auto-save, header redesign
- New session-store.js module (localStorage abstraction): sessionStoreCreate, sessionStoreSave, sessionStoreRestore, sessionStoreDelete, sessionStoreList, sessionStoreRename — all localStorage access isolated here; 32 auto-save trigger points wired across kpi-tree, capability-canvas, feature-canvas, story-canvas-new, pi-planning, market-intelligence, product-leak-analysis, diagnostic-view
- Home tab main panel replaced with session library: pinned "Continue where you left off" banner (most recent session), 2-column session card grid with product/type/approach/last-stage pills, counts (caps/features/stories/sprint), × delete on hover with Danger modal, inline name chip (auto-named "Product · DD Mon", editable), product filter dropdown, sort (last modified/newest/A-Z), search; empty state preserved when zero sessions exist
- sessionStoreRestore() rebuilds full app state from snapshot and reveals correct tabs (DM/CC/MI/FC/SC/PI/LA) based on what data exists, then navigates to lastTab; homeClearSession() saves before wiping; demo sessions never written to store (_isDemoSession flag)
- Header: version badge moved from purple pill in hdr-r to muted text (rgba 255,255,255,0.45) in hdr-l beside tool name; transient "✓ Saved" green indicator added to hdr-r (fades in on save, auto-hides after 3s via _ssShowSaved())

## v7.85 - Discovery Map capability edit/delete, mode-aware Edit Stage copy, CC/FC selection scoping fixes
- Discovery Map: capability-driven L1 cards (Capability-Based mode) now have edit (name/description, modal) and delete (instant if no downstream data, consequence-modal if capStore/Story Canvas features exist); new capRenameDownstream() re-keys capStore (by stageId, matching PROJECT_MAP.md's key format) and patches scCanvas on rename, mirroring stageRenameDownstream()
- Edit Stage modal: disabled-note copy clarifies what unlocks Options 2/3; the three radio descriptions and the post-edit scope-warning banner now say "capabilities" instead of "metrics" when approach is Capability-Based (outcome-based unchanged); stage header edit icon swapped from a custom SVG to the standard ti-pencil glyph used everywhere else
- Feature Canvas AND Capability Canvas selection is now filter-scoped: changing the capability filter, the Generated/Not Generated filter, clearing filters, or re-mapping a feature's capability all clear selection; bottom action bar counts (including the "N features with stories" fallback) and Select All are computed against the visible (filtered) set via shared helpers (fcGetVisibleCanvas, ccGetVisibleCapKeys) - fixes mismatches like "1 of 7 selected" or "13 of 13" when only a subset of cards was actually visible
- Title Case copy fixes across CC + FC (Add Capability/Add Feature dropdowns, empty-state and upload-modal headings); CC's capability upload review modal gained a remove-row (x) action matching FC's existing pattern, including the zero-rows-remaining guard

## v7.84 - Capability-Based + Manual mode: FC "Add Feature" upload/map, mandatory mapping (Build 2b/c)
- FC's static "Add Feature" button is now a dropdown ("Single feature" / "Upload from file"), reusing CC's cc-addcap-drop/cc-addcap-opt pattern (shared global stylesheet)
- Upload from file accepts the Feature/Description/Capability template, parses via XLSX/CSV, and opens a review/map table fuzzy-matching each row's Capability column against existing capabilities on the canvas
- Unlike CC's "Custom Capabilities" default, FC mapping is mandatory: unresolved rows show a red error state with an empty "maps to" dropdown and a Remove (x) action; the summary pill and Confirm button block until every remaining row is mapped or removed
- Confirm batches scDoAddFeat's logic per resolved row (metric/stage/metricPath resolved via capStore, duplicate-id guard with skip count), then shows a toast summarising added count, affected capabilities, and any skipped duplicates - this completes Build 2 (Areas A-D)

## v7.83 - Capability-Based + Manual mode: DM wiring + CC "Add Capability" upload/map (Build 2a)
- New buildTreePromptManual() generates only nsm/measurementModel/stages when generationMode==='manual'; AI places the user's supplied L1 capabilities verbatim (no renaming) and may add extra capabilities flagged _aiSuggested if allowAISuggestions is on - _mmReconcileManualCaps() enforces exact-name preservation, restores user descriptions as "why", and strips unsanctioned AI additions
- renderMM: capability-driven L1 cards show an "AI suggested" badge when l1._aiSuggested is true; ccGetAllL1Metrics/ccFindMetricInGData required no changes since manual L1s populate gData.stages[].l1_metrics[] like any other entry
- buildCapCanvasPromptCapDriven gains an optional capDescription parameter (sourced from l1.why via ccFindMetricInGData) so sub-capability generation can use the user's uploaded description for richer context
- CC "Add Capability" is now a dropdown ("Single capability" / "Upload from file"); upload accepts the unified Capability/Description/Parent Capability template, parses via XLSX/CSV, and opens a review/map table (fuzzy-matched "maps to" per row, defaulting to Custom Capabilities) before a batched confirm adds all rows with a summary toast

## v7.82 - Home cond-box: layout overhaul for breathing room and pill wrap
- home-cond-box padding 10px->12px, gap 8px->10px for more breathing room across both empty and loaded states
- Confirmation pill copy shortened to "X capabilities loaded (Y with descriptions)" (was "...loaded - descriptions found for Y"), now wraps as a paragraph (align-items:flex-start, line-height:1.5) instead of breaking mid-phrase
- AI-suggestion toggle row ("Let AI add missing capabilities") restored a visible border-top separator from the upload/file content above, reading as its own section within the purple-tinted box

## v7.81 - Home cond-box spacing fixes
- .home-cap-file-name now has margin-right:8px so the uploaded file name doesn't crowd the Replace/Remove links on the same row
- .home-tog-row (AI-suggestion toggle, Market Intelligence toggle) now has gap:12px so the label text keeps minimum separation from the toggle switch

## v7.80 - Home cond-box polish + fix: Manual mode button not disabled on initial load
- Fixed pre-existing bug (v7.57): homeInit() now bootstraps via homeSetApproach('outcome-based') instead of calling pill helpers directly, so the "Manual" Generation Mode button is correctly disabled (and non-hoverable) on first page load when Approach is Outcome-Based
- AI-suggestion toggle: label shortened to "Let AI add missing capabilities" (fits on one line) and its subtext removed (was forward-referencing unbuilt Build 2 behaviour)
- Capability list parse-error pill no longer repeats the "Download template" link (already shown at top of home-cond-box); the cond-box "Upload your capability list to continue" error now clears on a successful re-upload, not just on next Launch click
- capability-list-template.xlsx: "Parent Capability" column renamed to "Parent Capability (optional)" to clarify it is unused on Home; the post-upload description-usage note removed from home-cond-box for a cleaner confirmation state

## v7.79 - Home: Capability-Based + Manual mode UI overhaul (mandatory upload, AI-suggestion toggle)
- home-cond-box redesigned: textarea/paste removed, capability list upload (.xlsx/.csv) is now mandatory when Capability-Based + Manual is selected, with a Template download link, post-upload confirmation pill ("X capabilities loaded - descriptions found for Y"), file name with Replace/Remove, and an explainer note on description usage; Launch is blocked with an inline error if the list is empty
- New "Allow AI to add capabilities I may have missed" toggle (off by default) added inside home-cond-box using the standard home-tog-row/sp-toggle pattern; stored as sessionContext.allowAISuggestions (not yet consumed - DM/CC wiring is a follow-up build)
- New Home parser (_homeParseXLSX/_homeParseCSV) reads Capability + Description columns (ignores Parent Capability), raising the row ceiling from 20 to 1000; _homeManualList and sessionContext.manualList now store [{name, description}]
- capability-list-template.xlsx unified to 3 columns (Capability, Description, Parent Capability) for reuse across Home and the upcoming CC/FC upload flows; capability-features-template.xlsx renamed/reordered to (Feature, Description, Capability) for consistency

## v7.78 - CC "Generate All" button disables during any in-flight generation; demo mode now exitable without data loss
- Capability Canvas: the left-nav "Generate All Capabilities"/"Generate AI Features" footer button (`cc-gen-all-btn`) now disables (greyed out) whenever any CC generation is in flight - from the main panel (Generate One/All, Refine) or right panel (Generate Features) - previously stayed clickable and only showed a toast
- Demo mode: loading demo data now snapshots the user's real company/product profiles before overwriting them; exiting demo mode restores this snapshot instead of resetting to empty, so real profiles configured before "Load Demo Session" are no longer lost
- The header "DEMO" badge is now a clickable "DEMO ✕" button (with hover tooltip "Exit demo mode") - clicking it confirms, then clears demo mode and returns to Home with the user's pre-demo profiles restored in the product dropdown
- Switching between demo products (Focusly/OrderHub/OneCart) while already in demo mode does not re-snapshot, so the original pre-demo state is preserved through multiple demo switches

## v7.77 - "Stay here" is now primary CTA; card/panel switching guarded during generation
- "Hold on, don't lose this" modal flipped per UX-law review: "Stay here" is now the bold/coloured primary button (new `stay` showConfirm type - purple, ti-sparkles icon), "Leave anyway" is the plain ghost button - visual emphasis now matches the encouraged action (matches industry convention for unsaved-work dialogs)
- `showConfirm()` extended with an `onCancel` callback param (7th arg) so the ghost button can carry the abort+navigate action; new `blockIfGenerating(retryAction)` helper added for self-referential callers (switchTab, ccOpenCapPanel, scOpenPanel) to avoid the recursion pattern that caused v7.73's stack-overflow bug
- Fixed: clicking a different Capability Canvas card or Feature/Story Canvas feature while that card/feature's features/stories are generating no longer silently swaps the right panel - it now shows the same "Hold on, don't lose this" guard; previously this could cause the in-flight generation's result to render into the wrong (newly-opened) panel on completion
- `ccOpenCapPanel()` and `scOpenPanel()` now guard both "switch to a different card" and "toggle-close the generating card" via the same `blockIfGenerating` check at function entry

## v7.76 - CRITICAL: fix infinite recursion in switchTab (broke all navigation since v7.73)
- v7.73's `guardAiGenNav(()=>switchTab(t))` wrapper caused `switchTab` to call itself via its own guard whenever no AI generation was in flight (the common case), producing infinite recursion / stack overflow on every tab switch - this broke Launch Session, Load Demo, and all manual tab navigation across the entire app
- `switchTab(t)` now checks `aiGenInFlight.active` directly: if active, shows the "Hold on, don't lose this" confirm and re-invokes `switchTab(t)` only from the confirm's callback (after `endAiGen()`, so no recursion); if not active, proceeds straight into its existing body as before v7.73
- The four close-panel wrappers (`ccCloseDDPanelUserAction`, `ccCloseFeatPanelUserAction`, `scClosePanelUserAction`, `miCloseCapPanelUserAction`) were audited and are unaffected - each calls a genuinely different close function via `guardAiGenNav`, not itself, so no recursion there
- No other changes in this release - this is a targeted hotfix for the v7.73 regression; v7.75's demo-data revert remains in place

## v7.75 - Revert demo-data.js lazy-load (broke local file:// testing)
- v7.74's dynamic `<script>` injection for `demo-data.js` left "Load Demo Session" stuck on "Loading demo data..." forever when index.html is opened directly from a local folder (file:// protocol) - dynamically-injected script elements don't reliably fire load/error events for local file paths in this context
- Restored the static `<script src="./scripts/demo-data.js">` tag (back to its original position, immediately before main.js) and reverted `_homeDoLoadDemo()` to its pre-v7.74 synchronous form; `_homeFinishLoadDemo()` removed
- v7.74's other changes (AI generation guard from v7.73, and the AI_EDITING_RULES.md zip-packaging checkpoint) remain in place - this entry only reverts the demo-data lazy-load portion

## v7.74 - Demo data lazy-load; zip packaging checkpoint added to AI_EDITING_RULES
- `scripts/demo-data.js` (~190KB, Focusly/OrderHub/OneCart datasets) is no longer loaded on page init — removed its static `<script src>` tag from index.html
- "Load Demo Session" now dynamically injects `demo-data.js` on first click only, shows a brief spinner ("Loading demo data…") on the button while it loads, then proceeds as before; subsequent demo loads in the same session skip the fetch since the script is already loaded
- On script-load failure (e.g. offline), the button resets and a toast explains the demo data could not be loaded; `_homeDoLoadDemo` split into the loader and a new `_homeFinishLoadDemo(productKey)` that runs the actual `loadDemoData` + session-activation steps
- New MANDATORY CHECKPOINT in AI_EDITING_RULES.md requiring the "Deliverables — zip packaging" section to be re-read in full immediately before every `present_files` call, addressing a recurring issue where builds were zipped flat (matching /mnt/project/'s structure) instead of the deployed scripts/styles/netlify/proxy/assets layout

## v7.73 - "Don't lose this" leave-confirmation guard for in-flight AI generations
- New shared `aiGenInFlight` guard (state.js/utils.js): `startAiGen`/`endAiGen`/`guardAiGenNav` wrap all 15 AI generation call sites across Discovery Map, Capability Canvas (incl. PI-first build, refine/regenerate, feature generation, dictionary), Story Canvas, PI Canvas, and Market Intelligence; `switchTab()` and the four right-panel close buttons (DD, CC feature, SC story, MI capability) now call `guardAiGenNav()` before proceeding
- When a generation is active, leaving shows a "Hold on, don't lose this" modal with bespoke per-flow copy describing what's at stake (sprint/story counts, metric/capability/feature names); "Stay here" (primary) dismisses, "Leave anyway" aborts the in-flight request via AbortController and proceeds
- `callAPI()` now accepts an optional AbortSignal passed to both fetch branches; all guarded sites skip error-UI rendering on AbortError. New concurrent-generation guard shows a "Still working on your last request" toast if another generation is in flight, fixing a pre-existing race where overlapping generations (e.g. Generate One + Generate All) could overwrite each other's results
- `showConfirm()` extended with optional `cancelLabel` param (default 'Cancel'); out of scope: Product Leak Analysis generation (decommissioned), `miDownloadDocx` (different UX category), orphaned/unreachable functions (`ccDDGenerateForMetric`, `ccRefineCapability`, capability-drawer.js)

## v7.72 - Product Diagnostics: fix selection-state sync between table and detail panel
- laToggleExperiment now re-renders the open Experiment Detail panel when its experiment's selection state changes, so the panel's "Add to selection"/"Remove from selection" button stays in sync whether toggled via the table checkbox or the panel button itself (previously the panel button could go stale in either direction)
- Restyled the panel's selection-toggle button per the v7.71 tier standard: "Add to selection" (not yet selected) now uses the secondary tier (pale-blue), "Remove from selection" (selected) now uses the tertiary tier (ghost) — removes the off-standard solid-green styling, which is reserved for "Already on Feature Canvas"/sent states

## v7.71 - 3-tier action bar hierarchy + design system standard
- Discovery Map/KPI Tree ready bar now uses a 3-tier hierarchy: "Continue to Capability Canvas" stays primary (filled purple), "Run Diagnostics" steps down to a new secondary style (pale-blue fill/border), and "Refine Discovery Map"/"Refine KPI Tree" becomes tertiary (ghost, no fill)
- Refine expand panel's separate "Refine" + "Cancel" text buttons replaced with a single icon-only purple submit button (matches Story Canvas's inline refine pattern); Cancel removed since the refine-label toggle button already collapses the panel
- DESIGN_SYSTEM.md Section 7 extended with "Action bar button hierarchy" (decision rule for primary/secondary/tertiary, max 3 CTAs per bar) and "Inline refine pattern" as reusable standards for future screens

## v7.70 - Capability-driven naming fixes, settings API-key affordance, cross-tab navigation cues
- Capability-driven Discovery Map prompt now explicitly bars metric-style suffixes (Rate, Score, Accuracy, Latency, Frequency, etc.) on L1 capability names, with few-shot bad-to-good examples; loader copy gets capability-mode variants (e.g. "Mapping Your Capability Hierarchy") instead of "KPI Tree"/"metric" language; Capability Canvas subtitle made mode-agnostic ("...across your product")
- Settings page: when the Anthropic API key is unset, the key field now gets a persistent purple ring and is scrolled into view on load, clearing automatically once a key is entered (re-evaluated on every load)
- Discovery Map ready state now shows a primary "Continue to Capability Canvas" CTA, with "Refine Discovery Map"/"Refine KPI Tree" demoted to secondary styling
- New shared markTabPending/clearTabPending helpers add a purple "new content" dot to the Capability Canvas, Feature Canvas, Story Canvas, and PI Canvas tabs on each "Send to X" action, cleared on first visit; demo data loaders clear stale dots on load

## v7.69 - Capability-driven terminology cleanup: Parent Capability vs Capability, "sub-capability" removed
- Story Canvas lineage panel and Story Canvas DOCX export now label the L1 Discovery Map item "Parent Capability" (was "Capability") and the Capability Canvas-generated item reverts to plain "Capability" (was "Sub-Capability") for capability-driven sessions; fixed a "Parent parent capability path" label collision
- Capability Canvas's generation copy (loading text, empty states, nav tooltips, Add Capability button) no longer references "sub-capabilities" for capability-driven sessions, now consistent with outcome-based mode's copy
- buildCapCanvasPromptCapDriven rewritten to ask the AI for "Capabilities" decomposing a "Parent Capability", removing all "sub-capability" framing from the top-level item while preserving the pre-existing nested sub_capabilities (third-level) data model and its prompt language unchanged
- Demo data comments updated for terminology consistency; the Market Intelligence DOCX export's unrelated "L2 Sub-Capability" column and the pre-existing per-capability sub_capabilities export in Capability Canvas's DOCX were left untouched as out of scope

## v7.68 - Demo data enriched with OneCart (outcome-based, multi-business unified checkout)
- Added OneCart: a B2C multi-business unified cart/checkout demo (outcome-based mode) with a Discovery/Cart Assembly/Unified Checkout/Post-Purchase Servicing value chain, 12 L1 / 24 L2 / 48 L3 metrics matching Focusly's depth, NSM = Cross-Business Attach Rate per Booking
- Full sub-capability/feature/story depth on Cart Assembly and Unified Checkout, travel/hospitality-flavored Market Intelligence, and a light 2-squad PI board with an accessibility-compliance PI-first feature
- "Try with Demo Data" picker now has 3 options (Focusly, OrderHub, OneCart); all three demo profiles are now listed consistently across all three datasets' product selectors
- Fixed piPlan.dependencies field names (fromId/toId, not fromStory/toStory) for OneCart's and OrderHub's dependency entries so PI Canvas "blocked by" indicators resolve correctly; Focusly's pre-existing mismatched entries left untouched (out of scope)

## v7.67 - Demo data enriched with OrderHub (capability-driven); product picker added to Try with Demo Data
- loadDemoData refactored into a dispatcher (loadDemoData(productKey)) with Focusly's existing dataset moved into _demoLoadFocusly unchanged; Focusly's gData now also stamps approach:'outcome-based' for consistency
- Added OrderHub: a B2B omnichannel order orchestration demo (capability-driven mode) with a 5-stage, 15-capability Discovery Map, full sub-capability/feature/story depth on Order Capture and Returns, retail-flavored Market Intelligence, and a light 2-squad PI board
- "Try with Demo Data" on Home is now a picker — Focusly (outcome-based) or OrderHub (capability-driven) — loading the selected dataset; OrderFlow profile stub enriched and renamed to OrderHub
- PLA and Metrics Definition demo data intentionally skipped for OrderHub (decommissioned features); Unified Cart & Checkout dataset reserved for a future release

## v7.66 - Story-count fix across PI flow; Discovery Map Capability-Driven + AI-Generated mode added
- Fixed PI Canvas / Story Canvas story-count mismatches (e.g. SC shows 4, PI tray shows 6) by requiring `_inSC` on all `_stagedForPI`/`_inPIPlan` filters in piGetSelectedStories, Send to PI button/dispatch, PI export, and PI left-panel summary
- Discovery Map now supports a Capability-Driven approach: when sessionContext.approach is capability-based, the KPI tree prompt generates L1 capabilities only (no L2-L4), stages render flat non-expandable capability cards with no Dictionary/Evidence triggers, and Run Diagnostics is hidden
- Capability Canvas adds a capability-driven prompt variant that decomposes the selected L1 capability into sub-capabilities, with matching loading, progress, and nav copy (Story Canvas lineage labels and DOCX export headings also relabel Metric/Capability to Capability/Sub-Capability)
- gData.approach is stamped at generation time as the single source of truth for all capability-driven UI branching; demo data and PLA/Metrics Definition remain out of scope

## v7.65 - Capability Canvas generation fixed: removed crashes from retired left-panel form
- Fixed Cannot-read-null crashes blocking all Capability Canvas AI actions (generate per metric, generate all, generate features, refine, manual capability add) - these read gv('f-name')/seg.industry from the retired left-panel form, which no longer exists for session-based launches
- Added shared getProductCtx() helper in utils.js as the single source of product name/industry for AI prompts and exports, mirroring the Discovery Map generation pattern
- Same fix applied to PI Plan generation, PI Canvas DOCX export, and Product Diagnostics DOCX export - all three shared the identical crash and are reachable from the same session

## v7.64 - Post-launch navigation: tab reveal, CC unlock, footer and header alignment
- Discovery Map tab now reveals immediately on launch and Capability Canvas tab reveals only after successful generation (hidden during load and on error, mirroring the Market Intelligence reveal pattern)
- Tab row no longer shows as bare "Home" after launch - Discovery Map tab is marked active so the tab row reflects the live session
- Diagnostic action bar height aligned with the left panel footer standard (.gen-wrap) - top borders of both panels now line up
- Home tab icon in the tab row now aligns with the HCLTech logo - tab row left padding reduced to match header padding

## v7.63 - Home launch flow fixed: tab switching, diag bar, settings dirty-tracking, API key handling
- #home-tab no longer permanently visible - removed !important from display, which was blocking switchTab() from leaving Home (root cause of "Launch does nothing" and confirm modal appearing to fire on first launch)
- generateConfirmed() no longer crashes on null #gen-btn - diagnostic action bar now renders after generate and re-launch; settings-page.js modelEl ReferenceError fixed - Settings dirty-tracking and Discard confirmation now work
- "Cannot be undone" session-reset confirms (re-launch, load demo, regenerate Discovery Map) restyled from amber 'warn' to red 'danger', using var(--red)/var(--amber) tokens instead of hardcoded hex
- Home tab inline "Add your API key" link now opens Settings to Company Profile & Access and focuses the key field, and clears on return; clearing the key field and saving now removes it from storage, with Discard reverting unsaved key edits

## v7.62 - Home tab empty state centering resolved; AI editing rules updated
- Home tab empty state now centred correctly - root cause was #home-tab capped at ~679px by a competing flex:1 sibling (.right), not a centering issue on .home-empty-wrap
- #home-tab forced to flex:0 0 100% / width:100% with !important to claim full .app width
- Removed temporary debug outline rule from 17-home.css
- AI_EDITING_RULES.md: new mandatory section - measure parent-chain dimensions before iterating on centering/alignment CSS

## v7.61 - Home tab: grid centering, settings save fix, selector refresh, hover CTA
- Empty state centred using CSS Grid place-items:center on home-main-body - eliminates scroll container conflict
- Company name no longer blocks save when PM is on Section 5 - validation only fires if other company fields are filled
- Home product selector refreshes automatically when Settings is closed from Home tab
- Change Session CTA uses sp-secondary-cta class with purple hover fill matching Load Demo Session pattern

## v7.60 - Home tab fixes: centering, launch button, settings nav, diag bar, CTA style
- Empty state centred correctly - align-self:center + margin:auto on column flex child removes width:100% stretch
- Launch Session button now disabled on load - id attribute was missing, getElementById was returning null
- Add Product Profile now navigates correctly to Section 5 - _spSection set before spRender() bakes HTML
- Diagnostic action bar hidden when navigating back to Home tab
- Change Session CTA styled as secondary (pale purple) matching app secondary CTA pattern

## v7.59 - Home tab UX fixes: centering, fonts, collapse, session panel
- Home empty state centred correctly using margin:auto on flex column scroll container
- Demo card text sizes increased to match app standards (title 13px, desc 11px, CTA 11px)
- Home left panel collapse fixed - ph-text hidden on collapse so expand button is always accessible
- Session summary panel on mm tab: collapse/expand button added, Change Session CTA navigates to Home

## v7.58 - Home tab bug fixes: centering, fonts, panel header, collapse, session panel
- Home main panel empty state centred correctly - removed width:100% on empty-wrap, MM empty state uses flex:1 instead of min-height
- Home left panel reduced to two-line header matching app pattern, collapse/expand button added
- Launch button disabled until product selected - enabled on product change; Settings CTA navigates correctly to Section 5
- Demo loads on Discovery Map tab with KPI tree rendered; session summary panel shown in left panel post-launch on mm tab

## v7.57 - Home Tab: session launcher, product profiles, sessionContext
- Home tab (Tab Zero) added - product selector, Outcome/Capability approach, AI Generated/Manual mode, Custom Value Chain, Additional Context, Market Intelligence toggle, Launch Session CTA
- sessionContext and sessionActive added to state - snapshot frozen at launch, read by generateConfirmed() replacing old DOM field reads
- Demo data retrofitted - Focusly company profile and product profile objects added, two extra demo profiles (OrderFlow, MindBridge) for dropdown testing
- Discovery Map tab renamed from KPI Tree in tab row

## v7.56 - Product Profiles: footer blocking, Apply primary CTA, scroll fix
- Save & Exit and Cancel disabled while profile edit panel is open - tooltip explains why
- Both re-enabled on Apply or Discard
- Apply button changed to filled primary purple - matches Save & Exit visual weight
- Section 5 scroll wrapper set to overflow:hidden when active - inner list scroll now works correctly for many profiles
- Profile card grid confirmed at repeat(4, 1fr) - exactly 4 cards per row

## v7.55 - Product Profiles: split panel fix, card layout, meta cleanup
- Edit panel now correctly narrows list to 40% width when open - true split layout, not overlay
- List panel restores to full width when edit panel is closed
- Profile chip grid updated to minmax(180px) for reliable 4-per-row at full screen
- Card meta simplified to industry vertical only - doc count removed
- Industry vertical hidden from meta if not set, avoiding empty state clutter

## v7.54 - Settings: file upload enforcement, word cap fix, nav footer cleanup
- Multi-file upload bypass fixed: remaining slots calculated before FileReader loop, files pre-sliced to MAX_FILES limit with clear toast message
- Total word cap raised from 5,000 to 7,500 to align with 5 files x 1,500 words per file math
- All meter labels, upload sub-text, and percentage calculations updated to 7,500 total
- Version string removed from settings nav footer - already shown in header badge

## v7.53 - Settings polish: em dashes, card desc, API key alignment
- All em dashes replaced with hyphens in rendered Settings UI strings (edit panel titles, field hints, subtexts)
- Product profile chip cards now show product description as a second line (2-line clamp) - scannable at a glance
- Anthropic API key input wrapper and AI Model select both set to 280px - visually aligned
- Profile chip card padding increased for better proportions

## v7.52 — Settings bug fixes and UX polish
- File upload for new product profiles now works correctly — _spP5NewDocs temp store wired into Save and cleared on Discard
- Word meter duplicate label bug fixed — existing meter always removed before re-inserting on each upload
- Company Name marked mandatory with asterisk and validated on Save & Exit
- Strategy & Vision and Additional Context moved into 2-column grid in Section 1
- Supporting Documents hint consolidated into upload zone sub-label — no redundant per-upload text
- Product profile list view replaced with compact chip grid (auto-fill columns) — scannable at scale
- Reference link soft URL validation added in product profile edit (https:// check, non-blocking warning)
- Settings nav width increased to 240px

## v7.51 — Settings UX polish: layout, copy, and interaction fixes
- Section 1 restructured to two-column grid (Name+Industry, URL+RefLink); all inputs now full-width; textareas set to resize:vertical with min-height
- Nav width increased from 188px to 220px to prevent label wrapping
- Industry Vertical dropdown now starts with neutral "Select industry..." prompt in both Company Profile and Product Profiles — no opinionated default
- Section 5 empty state: Add Profile CTA moved inside empty state card; top-right button only shown when profiles exist
- Section 5 edit subtitle copy updated to reflect AI context purpose
- "What does this product do?" changed from single-line input to 2000-char textarea with resize and counter
- Section 5 panel footer: Cancel/Save Profile replaced with Discard/Apply — visually subordinate to page-level Cancel/Save & Exit

## v7.50 — Settings: Company Profile & Access + Product Profiles
- Section 1 renamed to Company Profile & Access — org-level fields (company name, industry, strategy, URL, context, reference link, file uploads with word meter) added above existing API key + model rows; Demo Mode row removed from Settings
- Section 5 (Product Profiles) added — multi-profile list with add/edit/delete, in-session memory, split-panel list/edit layout with full CRUD and file upload support
- companyProfile{}, productProfiles[], activeProfileId added to state.js as new session-scoped state objects
- Design system Section 10 added — file upload zone, product profile card, split panel layout documented as new component standards

## v7.35 — All Caps view fix (send) + PI card FC badge + send toasts
- All Caps view now preserved after sending features to FC in CC (captured _wasAllCaps before capActiveMetricKey mutation in ccSendToStoryCanvas)
- "X in Feature Canvas" badge added to Custom/PI cap cards in All Caps view — was missing from PI caps rendering block, now matches KPI caps pattern
- Success toasts added: CC→FC ("X features sent to Feature Canvas"), FC→SC ("X stories sent to Story Canvas"), SC→PI ("X stories added to PI Canvas")

## v7.34 — Tab badge removal + auto-scroll/panel on add + Settings Save & Exit
- Tab count badges removed from CC, FC, SC, PI Canvas tab labels (heterogeneous units, inventory counts not actionable alerts — icon + label only)
- All Caps view now correctly preserved after feature generation in CC (pre-mutation state captured before capActiveMetricKey is set)
- Auto-scroll + auto-open right panel after manual add in CC (capability), FC (feature), SC (story) — consistent with Jakob's Law mental model
- Settings: "Save Settings" → "Save & Exit" (saves + closes + toast); Cancel shows discard confirmation only when dirty state detected ("Keep editing" / "Discard")

## Pre-v7 History (v2.0 – v6.79)

**v2.0** — Modularised from single HTML file into index.html + scripts/ + styles/. Story Canvas left panel (track & node design), Demo Mode introduced.

**v2.1** — Diagnostic View and Product Leak Analysis tabs added. Evidence drawer, 6-field evidence form, derived evidence strength, experiment table with filters and DOCX export.

**v3.0** — Dynamic Measurement Model: removed hardcoded 4-stage AAER model. AI now returns 3–8 stages based on product value chain. Left panel input form redesigned.

**v4.x** — Market Intelligence tab (5 sections: market snapshot, trends, competitors, SWOT, capabilities). MI-to-Feature Canvas send flow. MI DOCX export.

**v5.x** — PI Planning tab. Squad builder, sprint assignment, drag-and-drop, backlog tray, dependency linking, stale banner, PI DOCX export.

**v6.00–v6.45** — Capability Canvas tab. Two entry paths (KPI-linked and PI-first). Feature generation per capability, refine, right panel with selection and Send to Feature Canvas. Delete confirmations for caps and features.

**v6.46–v6.55** — Modal Construction Standard documented and applied across all 8 hand-rolled modals. PI Selection Layer added to Story Canvas (per-story checkboxes, Send to PI). Uniform card interaction model (click = open panel, checkbox = select).

**v6.56–v6.65** — Traceability panel in SC right panel (Stage→Metric→Cap→Feature chain, collapsed by default, inline metric linking for PI-first features). Panel toggle-close on all canvases.

**v6.66–v6.75** — Feature Canvas separated from Story Canvas (renamed files). New Story Canvas (SC) built as distinct grooming tab with DoR, dependencies, notes, AC editing. Admin Settings page replaces fly-out panel.

**v6.76–v6.79** — CC/FC/SC bottom bar redesign (Select All toggle, consistent CTA placement). DoR defaulted to "Needs review". Settings page cleanup. SC loader vertical centering fix.

---

## v7.00 — Feature Canvas / Story Canvas architectural split
- Feature Canvas (renamed from Story Canvas) owns features and story generation; Story Canvas is the new grooming tab owning DoR, dependencies, notes, and PI selection
- New SC left nav: Stage→Metric→Cap→Feature hierarchy; filter panel with MoSCoW/readiness/PI status; dependency search with custom inline list
- `scCanvas[]` remains shared global; `_piSelected` flags drive Send to PI; `piGetSelectedStories()` reads flags directly
- `scripts/story-canvas-new.js` and `styles/16-story-canvas-new.css` introduced; `story-canvas.js` renamed to `feature-canvas.js`

## v7.01 — Post-rename cleanup + MI/Diagnostics width fixes
- All "Story Canvas" copy in CC, MI, and Diagnostics updated to "Feature Canvas"; FC origin legend updated
- MI cap panel and Diagnostics detail panel widths corrected to 440px (standard)
- SC left panel width corrected to 300px; title/subtitle styled to match app standard
- AI_EDITING_RULES.md: post-rename string audit and new screen design checklist added

## v7.02–v7.09 — SC/FC/CC interaction model standardisation
- Uniform card interaction: click opens right panel, checkbox selects for bulk action, bottom bar always visible with Select All toggle left / CTAs right
- `_piSelected` split into `_stagedForPI` (transient selection) and `_inPIPlan` (dispatched state); `_inSC` flag tracks sent-to-SC stories
- FC filter changed to Set-based multi-select matching CC pattern; CC filter standardised to checkboxes
- SC story editing: AC pre-population from structured scenarios, feature reassignment dropdown, modal/dialog anatomy standardised

## v7.10–v7.19 — CC/FC/SC visual alignment
- CC, FC, SC group headers unified: stage pill + metric name + cap count, collapse/expand chevron, coloured left border
- Toolbar/legend fixed above scroll area (non-scrolling) across CC, FC, SC
- Group spacing, legend margins, and horizontal padding standardised at 22px across all three canvases
- Pre-zip file verification step added to AI_EDITING_RULES.md after v7.21 blank screen root cause identified

## v7.20–v7.21 — CC stage colours + FC right panel inline warning
- `ccStageColor()` rewritten from hardcoded AAER map to index-based STAGE_PALETTE lookup — fixes all dynamic products
- FC right panel: inline amber confirmation strip when clicking a story already in SC (`_inSC=true`)
- CC group header margin inset (`0 22px`) and All Caps "X in Feature Canvas" badge added
- DESIGN_SYSTEM.md updated with CC group header standards and inline strip pattern

## v7.22–v7.26 — Spacing and collapse/expand audit (CC/FC/SC)
- CC, FC, SC group header collapse/expand with chevron button, coloured left border, and "hidden — click to expand" hint
- Toolbar + legend pulled out of scroll area into fixed header across FC and SC; group-to-group spacing tightened
- Legend-to-header and header-to-card gaps standardised across CC (8px), FC (6+4=10px), SC (6+4=10px)
- Right border added to all group headers; SC horizontal padding increased to 22px matching CC/FC

## v7.27–v7.29 — Left panel CC/FC/SC audit fixes
- CC toolbar top padding reduced; CC PI Plan group header collapse/expand fixed (separate render block was missed)
- Left panel audit (CC/FC/SC): collapse button 24×24px, transition cubic-bezier, header padding 10px 12px, metric font-weight 700, badge active variant, node dot border — 10 items standardised
- CC chevron alignment fixed; CC nav tree gap removed; FC All Features badge active state added

## v7.30 — Left panel standardisation: KPI Tree, MI, Diagnostics, PI Canvas
- All four panels: transition updated to 0.22s cubic-bezier(0.4,0,0.2,1) matching v7.28 standard
- PI Canvas: min-width:300px added, background:#fff→var(--card), panel header border-bottom added, gen-wrap border-top 2px→1px
- PI Canvas: gen button font-weight 600→700, border-radius 6px→7px; summary strip border-radius 5px→7px
- Diagnostics: header padding 12px 16px 10px → 10px 12px

## v7.31 — Right panel audit standardisation (17 items)
- Close buttons: 24×24px standard applied across all panels (CC 32→24, PI 32→24, DV 22→24); blue hover standard on CC/MI/PI; red hover preserved on KPI/DV evidence drawers; all icons converted to SVG × 12×12
- DV evidence drawer width: 360px→440px matching all other panels; DV footer background #fff→var(--card); MI footer padding and CTA font-size corrected
- MI left panel header padding fixed (parked item from screenshot); MI and PI body scrollbar 3px rule added
- SC story panel title inline override removed (now inherits 13px/700 from class); LA left panel transition updated to cubic-bezier

## v7.32 — Right panel overlay→push restructure + PI header fix
- MI capability panel converted from position:absolute overlay to flex-expand push (PI pattern): mi-right→row, mi-right-content wrapper added, mi-cap-panel width:0→440px
- LA detail panel converted from display:flex toggle to flex-expand push: la-main→row, la-main-content wrapper, la-detail-panel width:0→440px with classList open/close
- PI right panel header: story ID (pi-card-id) now inline with title on same baseline row, reducing header from 3 rows to 2; backlog panel receives same treatment and shortId for parity
- KPI Dictionary panel nav footer: height fixed to 49px to align bottom border with diag-action-bar; DD close button 22→24px with blue hover

## v7.33 — DESIGN_SYSTEM.md overhaul + right panel header bg + PI footer
- DESIGN_SYSTEM.md: 10 gap areas documented — left panel anatomy, right panel full standard, transition values, close button spec, scrollbar standard, generate button spec, open mechanism guidance (flex-expand preferred over absolute), chrome-content-chrome rule, modal section deduplicated
- Right panel header backgrounds: CC feat panel, SC story panel, LA detail panel headers updated to var(--card) — chrome-content-chrome sandwich now consistent across all 7 panels
- PI Canvas right panel: "Remove from PI?" action moved from scroll body to pinned grey footer (matching SC pattern); confirm strip renders above button in footer; scrollIntoView removed
- CHANGELOG pruned from 3,500+ lines to condensed format; max 4 points per version going forward

