# Project Map — AI PM Toolkit

## File responsibilities

### Entry point
`index.html` — app shell, tab buttons (mm, cc, pi, mi, la, sc), Story Canvas HTML structure, script/CSS references. Tab button IDs: `tab-mm`, `tab-cc`, `tab-pi`, `tab-mi`, `tab-la`, `tab-sc`. Content area IDs: `out-body` (mm), `cc-tab`, `pi-tab`, `mi-tab`, `la-tab`, `sc-tab`.

### Auth entry point
`login.html` — standalone login/signup page. No app shell. Loaded by unauthenticated users. Redirects to `index.html` on success.

### Auth module
`scripts/auth.js` — Supabase client init and all auth functions. Loaded by both `login.html` and `index.html`.
- `authInit()` — initialises Supabase client singleton (SUPABASE_URL + SUPABASE_ANON_KEY)
- `authSignIn(email, password)` — supabase.auth.signInWithPassword(); maps errors to readable strings
- `authSignUp(email, displayName, password)` — validates AUTH_DOMAIN, supabase.auth.signUp() with display_name in user_metadata
- `authSignOut()` — supabase.auth.signOut(), redirects to login.html
- `authGetSession()` — returns active session or null; used by auth gate in main.js
- `authGetUser()` — returns { id, email, displayName } for signed-in user
- `authResetPassword(email)` — supabase.auth.resetPasswordForEmail()

`styles/18-auth.css` — login page layout and form styles. Loaded by `login.html` only.

### Netlify configuration
`netlify.toml` — build config: publish dir, functions dir, `/api/anthropic` redirect rule
`netlify/functions/anthropic-proxy.js` — serverless proxy: receives browser requests, forwards to Anthropic server-side with user key in Authorization header. Fixes CORS for org-managed API keys. BYOK: no env variables needed.

### Render.com proxy backend
`proxy/server.js` — Express proxy backend deployed on Render.com. POST /api/anthropic endpoint. CORS locked to productdiagnostics.netlify.app. Rate limit 20 req/min per IP. Deployed separately from the Netlify frontend — do NOT modify without testing on Render.
`proxy/package.json` — proxy dependencies: express, cors, express-rate-limit. Node >=18.
`proxy/README.md` — non-technical Render.com deployment guide with troubleshooting table.

---

### Scripts (load order matters)

`scripts/config.js` — model name, constants

`scripts/state.js` — all global state:
- Core: `gData`, `curTab`, `settingsOpen`, `seg`, `productContext`
- **Admin settings:** `appSettings{}` — single source of truth for all configurable values: `{ model, featDD, featCap, featDiag, featMI, featPI, maxCaps, includeSubCaps, maxFeatures, maxStories, maxACs, defaultSprints, defaultSprintDur, defaultSquadName, defaultSquadCapacity, teamVelocity }`. Defaults match previous hardcoded values. Alias vars `featDD`, `featCap`, `featDiag`, `featPI`, `featMI` point into appSettings for backward compat with all consumers.
- Feature flags (aliases into appSettings): `featDD`, `featCap`, `featDiag`, `featPI`, `featMI`
- Capability Canvas: `capStore`, `capStoreInvalidated`, `capActiveMetricKey`, `capActiveCapIdx`, `capActiveSubCapIdx`, `ccSelectedCapIds`, `ccPanelCapKey`
- Diagnostic: `diagnosticSessions`, `activeDiagnosticId`, `productLeakAnalysis`, `diagEvidenceDrawerMetricId`, `leakDetailExperimentIdx`, `leakColDefaults`, `leakColVisible`, `leakFilters`, `leakSelectedIds`
- Market Intelligence: `miData`, `miGenerated`, `miProductMode`, `miCapabilities`, `miFeatureCache`
- PI Planning: `piMode`, `piFirstBuilt`, `piInputs`, `piPlan`, `piStoryPool`, `piSquads`, `piScVersion`, `piDdPanelOpen`, `piDdPanelMetricKey`

`scripts/utils.js` — `e()` HTML escape, `showToast()`, `showConfirm()`, `trapFocus()`, shared helpers

`scripts/prompts.js` — ALL AI prompt builders. Helper: `_spRange(mn,mx)` — returns "exactly N" when min===max, otherwise "N-M". Used in all generation count instructions to handle boundary cases cleanly.
- `buildTreePrompt()` — KPI tree (AI-generated mode)
- `buildTreePromptManual()` — KPI tree skeleton for Capability-Based + Manual mode (v7.83): AI derives stages only and places the user's supplied L1 capabilities verbatim; may add extra L1s flagged `_aiSuggested` if allowAISuggestions
- `buildCapCanvasPrompt()` — capability generation per metric. Count: `_spRange(2, appSettings.maxCaps)`. Sub-caps: conditional on `appSettings.includeSubCaps`.
- `buildCapCanvasPromptCapDriven()` — capability-driven variant; takes optional `capDescription` (v7.83, sourced from l1.why) for richer sub-capability generation
- `buildCapFeaturesPrompt()` — feature generation per capability. Count: `_spRange(3, appSettings.maxFeatures)`.
- `buildProductLeakPrompt()` — product leak analysis
- `buildDDPrompt()` — metrics definition (dictionary)
- `buildMarketIntelPrompt()` — market intelligence main
- `buildMIFeaturePrompt()` — MI feature generation per capability. Count: `_spRange(3, appSettings.maxFeatures)` — unified with CC path.
- `buildMIDocxPrompt()` — MI DOCX narrative
- `buildPICapPrompt()` — PI-first capability generation (path B). Sub-caps: conditional on `appSettings.includeSubCaps`.
- `buildPIStoryPrompt()` — PI-first story generation. Stories: `_spRange(2, appSettings.maxStories)`. Velocity: maps `appSettings.teamVelocity`. Scenarios: `_spRange(1, appSettings.maxACs)`.
- `buildPIGeneratePrompt()` — PI sprint assignment generation

`scripts/settings.js` — API key handling: `checkKey()`, `toggleKeyVis()`. `checkKey()` validates the key format, updates `#api-dot` in header, persists to sessionStorage, and calls `spRefreshKeyStatus()` to update the settings page key status pill when settings is open. `updateFeatLock()` is retired (body empty) — kept as shell to avoid call-site errors.

`scripts/settings-page.js` — Full admin settings page (v6.75+). Replaces the fly-out panel entirely.
- **Render:** `spRender()`, `spBuildHTML()`, `spP1()` (API & Access), `spP2()` (Feature Modules), `spP3()` (Output Depth), `spP4()` (PI Planning Defaults)
- **Navigation:** `spNav(n)` — switches active section, updates left nav highlight and panel title
- **Populate from state:** `spPopulate()` — fills all UI controls from `appSettings{}` after render
- **Restore defaults:** `spRestoreDefaults()` — sections 3 and 4 only; resets to `_spDefaults3` / `_spDefaults4`
- **Controls:** `spStep(id,d,mn,mx)` — stepper increment/decrement; `spSeg(k)` — velocity segmented control; `spTogRow(k)` — toggle rows; `spRefreshKeyStatus()` — updates key status pill from `checkKey()`
- **Internal builders:** `_spTog()`, `_spStepper()`, `_spRow()`, `_spModRow()`, `_spSubLbl()`, `_spNavItem()`, `_spTitle()`, `_spDesc()`, `_spTabLabel()`
- **Constants:** `_spDefaults3`, `_spDefaults4`, `_spModels` (model dropdown options), `_spTogStates` (toggle state map)

`scripts/home.js` — Home tab (Tab Zero). Session launcher. v7.57+.
- **Init:** `homeInit()`, `homeOnTabEnter()`
- **Product selector:** `homeOnProductChange()`, `_homeRenderProductSelector()`
- **Preview card:** `homeRenderPreviewCard()`, `homePPCardToggle()`
- **Selectors:** `homeSetApproach()`, `homeSetMode()`
- **Manual input (capability list upload, v7.79):** `homeHandleFileUpload()`, `_homeParseXLSX()`, `_homeParseCSV()`, `_homeFinalizeCapList()`, `_homeRenderParseResult()`, `_homeRemoveCapList()`, `_homeShowParseError()`
- **Launch:** `homeLaunch()`, `_homeDoLaunch()`, `homeClearSession()`
- **Demo:** `homeLoadDemo()`, `_homeDoLoadDemo()`

`scripts/left-panel.js` — product input form, segment buttons, `applyFeats()`, `togglePanel()`. `toggleSettings()` and `saveSettings()` delegate to `openSettingsPage()` / `settingsPageSave()` in settings-page.js. `applyFeats()` reads from `appSettings{}` (not DOM checkboxes — fly-out panel is retired). `updateFeatLock()` body retired in v6.75 — shell kept.

`scripts/kpi-tree.js` — KPI tree generation, `renderMM()`, `STAGE_DEFS`, always-4-stage guarantee, `renderDiagnosticActionBar()`, `countAllMetrics()`, `_mmReconcileManualCaps()` (v7.83 - reconciles AI skeleton response with sessionContext.manualList for Capability-Based + Manual mode)

`scripts/metrics-definition.js` — Metrics Definition tab, `generateDD()`, `renderDDTable()`

`scripts/capability-drawer.js` — capability drawer (slides in from KPI tree), `openCapDrawer()`, `renderCapabilities()`

`scripts/capability-canvas.js` — Capability Canvas tab. Two entry paths: KPI-linked (Path A) and PI-first (Path B).
- **Tab lifecycle:** `ccOnTabEnter()`, `ccOnTabLeave()`, `ccEnter()` (alias)
- **Entry routing:** `ccShowDualEntry()`, `ccActivatePIFirst()`, `ccConfirmPIFirstChoice()`, `ccConfirmPIFirst()`
- **PI-first path (B):** `ccShowPIFirstForm()`, `ccPITypeChange()`, `ccHandleFileUpload()`, `ccParseXLSX()`, `ccParseTextContent()`, `ccParsePasteInput()`, `ccFinalizeParse()`, `ccFuzzyMatch()`, `ccRenderParseResult()`, `ccShowParseError()`, `ccResolveOverlap()`, `ccBuildPICanvas()`, `ccPIKey()`, `ccExitPIFirst()`, `ccEditCustomPlan()`, `ccGenerateFeaturesForAllPI()`, `ccTogglePICtx()`
- **Navigator / left nav:** `ccOpenNavigator()`, `ccOpenMetricNav()`, `ccToggleNav()`, `ccRenderLeftNav()` (alias), `ccMNSelectAll()`, `ccMNSelectPIAll()`, `ccMNSelectMetric()`, `ccMNSelectCap()`, `ccMNGenerate()`, `ccRenderTree()`, `ccSelectCap()`, `ccSelectSubCap()`
- **Render paths:** `ccRenderEmpty()`, `ccRenderPartial()`, `ccRenderMainContent()`, `ccRenderMainArea()` (alias), `ccRenderAllCaps()`, `ccRenderPICapView()`, `ccViewMetric()`
- **Generation:** `ccGenerateOne()`, `ccGenerateOneFromEl()`, `ccGenerateAll()`, `ccExpandMetric()`, `ccGenerateFeaturesForMetric()`, `ccRefineCapabilities()`, `ccRegenCapability()`, `ccRefineCapability()`, `ccGenerateFeaturesForCap()`, `ccGenerateFeaturesForSelected()`
- **Right panel (features):** `ccOpenCapPanel()`, `ccCloseFeatPanel()`, `ccBuildFeatPanel()`, `ccGetCapNavPool()`, `ccCapPanelNav()`, `ccToggleFeatPanel()`, `ccSelectCapCard()`
- **Feature editing (right panel):** `ccEditFeatName()`, `ccSaveFeatName()`, `ccEditFeatWhy()`, `ccSaveFeatWhy()`, `ccConfirmRemoveFromSC()`
- **Feature selection:** `ccToggleFeat()`, `ccSelectAll()`, `ccToggleCapSelect()`, `ccGetFeatSelState()`, `ccUpdateCardChk()`, `ccSelectedCapIds` (Set), `ccClearCapSelection()`, `ccUpdateActionBar()`, `ccAllCapsSelectCap()`
- **Send to SC:** `ccSendToStoryCanvas()`
- **Capability CRUD:** `ccShowAddCapModal()`, `ccAddCapValidate()`, `ccDoAddCap()`, `ccShowEditCapModal()`, `ccEditCapValidate()`, `ccDoEditCap()`, `ccRemoveCapability()`, `ccDoRemoveCapability()`
- **DD panel (metric dictionary, right side):** `ccOpenDDPanel()`, `ccRenderDDPanel()`, `ccNavDDPanel()`, `ccCloseDDPanel()`, `ccDDDownload()`, `ccDDGenerateForMetric()`, `ccDDGenerateAll()`
- **Helpers:** `ccMetricKey()`, `ccStageColor()`, `ccStageBg()`, `ccStageText()`, `ccGetAllL1Metrics()`, `ccCountGenerated()`, `ccUpdateTabBadge()`, `ccGetTotalCaps()`, `ccGetTotalFeats()`, `ccFindMetricInGData()`
- **Export:** `ccToggleExportDrop()`, `ccExportFull()`, `ccExportFinalised()`, `ccDownloadDOCX()`, `ccBuildDOCX()`
- **Exit:** `ccExitNavigator()`

`scripts/pi-planning.js` — PI Canvas tab. Receives stories from Story Canvas via `scPushStoriesToPI()`.
- **Tab lifecycle:** `piOnTabEnter()`
- **Staleness detection:** `piCheckStaleness()`, `piComputeHash()`, `piShowStaleBanner()`, `piHideStaleBanner()`, `piSyncNewStories()`
- **Left panel:** `piRenderLeftPanel()`, `piRenderSquadRows()`, `piGetSquads()`, `piCalcCapacity()`, `piAddSquad()`, `piRemoveSquad()`, `piUpdateSquad()`, `piToggleLeftPanel()`
- **Previous PI upload:** `piHandlePrevPIFile()`, `piParsePrevPI()`
- **Generation:** `piGenerate()` (async), `piConfirmRegenerate()`, `piRegenerate()`, `piRenderEmpty()`
- **Board render:** `piRenderBoard()`, `piRenderStoryCard()`, `piComputeSprints()`
- **Story data:** `piGetSelectedStories()`, `piGetAllStories()`, `piGetStoriesForSprint()`, `piGetBacklogStories()`, `piFindStory()`
- **Drag-and-drop:** `piDragStart()`, `piDragOver()`, `piDrop()`, `piDropToBacklog()`, `piMoveToPrint()`, `piRemoveStoryFromSprint()`
- **Capacity:** `piCheckCapacity()`
- **Dependencies:** `piIsBlocked()`, `piGetDepsForStory()`, `piGetBlockingConflict()`, `piShowDepConflict()`, `piShowAddDepForm()`, `piSetDepDir()`, `piLinkDep()`, `piRemoveDep()`
- **Right panel:** `piOpenRightPanel()`, `piCloseRightPanel()`, `piRenderRightPanel()`, `piHighlightFeature()`
- **Story editing:** `piEditPoints()`, `piSavePoints()`, `piUpdateAssignment()`, `piUpdateAssignmentSprint()`, `piSaveNote()`, `piShowRemoveConfirm()`
- **Backlog panel:** `piOpenBacklogPanel()`, `piMoveBacklogToSprint()`, `piEditPointsBacklog()`, `piSavePointsBacklog()`, `piBacklogResizeStart()`
- **Date helpers:** `piSetStartDate()`, `piFormatDate()`
- **Badges / misc:** `piUpdateTabBadge()`
- **Export:** `piExportDocx()` → calls `buildAndDownloadPIDocx()` in `export-pi-docx.js`

`scripts/feature-canvas.js` — Story Canvas tab.
- **Canvas render:** `scRenderCanvas()`, `scRenderCapNav()`, `scToggleCapNav()`, `scSetCapFilter()`, `scSetGroup()`, `scRenderStatusChips()`, `scRenderUnplannedBanner()`, `scShowUnplannedBanner()`, `scDismissUnplannedBanner()`
- **Feature lifecycle:** `scToggleFeatureFromDrawer()`, `scToggleFeature()`, `scMakeFeatureId()`, `scRemoveFeature()`, `scDoRemoveFeature()`
- **Feature CRUD:** `scShowAddFeatureModal()`, `scAddFeatValidate()`, `scDoAddFeat()`, `scShowEditFeatModal()`, `scEditFeatValidate()`, `scDoEditFeat()`
- **Add Feature dropdown + upload/map (v7.84):** `scToggleAddFeatDrop()`, `scShowUploadFeatModal()`, `scHandleFeatUpload()`, `scShowFeatReviewModal()`, `scConfirmFeatUpload()` — mandatory capability mapping; unresolved rows block confirm until mapped or removed
- **Selection / PI selection:** `scToggleSelect()`, `scClearSelection()`, `scTogglePiSelect()`, `scTogglePiStory()`, `scSelectAllPiStories()`, `scClearAllPiStories()`, `scClearPiSelection()`
- **Status filter:** `scSetStatusFilter()`, `scClearAllFilters()`
- **Badge / footer:** `scUpdateTabBadge()`, `scUpdateDoneBadge()`, `scUpdateCapDrawerFooter()`, `scUpdateActionBar()`
- **Right panel:** `scOpenPanel()`, `scClosePanel()`, `scRenderPanel()`, `scUpdatePanelNav()`, `scPanelNav()`, `scRenderLineage()`, `scToggleLineage()`, `scPanelGenerateStories()`, `scPanelSendToPI()`, `scRefineStories()`, `scClickGenerate()`
- **Story editing:** `scEditStoryTitle()`, `scSaveStoryTitle()`, `scEditStoryStmt()`, `scSaveStoryStmt()`, `scACToText()`, `scTextToAC()`, `scEditStoryAC()`, `scSaveStoryAC()`
- **Metric linking:** `scShowLinkMetricModal()`, `scCancelLinkMetric()`, `scConfirmLinkMetric()`
- **Breadcrumbs:** `scGetMetricEvidence()`, `scBuildEvidenceChip()`, `scGetMetricOrder()`, `scGetMetricPath()`, `scBuildMetricBreadcrumb()`, `scFitMetricBreadcrumbs()`, `scBuildCapBreadcrumb()`, `scFitBreadcrumbs()`
- **Batch modal:** `scShowBatchModal()`, `scModalSelectBatch()`, `scModalClose()`, `scModalProceed()`
- **Story generation:** `scGenerateStories()` (async), `scBuildStoryPrompt()`
- **PI integration:** `scPushStoriesToPI()`, `scDismissPushNudge()`, `scPlanPI()`, `scNavigateToPI()`, `scApplyPIPlannedBadges()`, `scClearPIPlannedBadges()`
- **Export:** `scToggleExportDrop()`, `scExportAll()`, `scExportFeature()`, `scPurgeStage()`

`scripts/export-docx.js` — `scDownloadStoriesDOCX()`, `scBuildDOCX()` — Story Canvas DOCX download (hierarchical: Stage › Metric › Capability › Feature › Stories)

`scripts/prototype-canvas.js` — Prototype Canvas module (v8.79). Owns the Prototype view inside Story Canvas when newScProtoView===true. Access variant fields via pcGetActiveVariant(featId).
- **Schema:** protoStore[featId] = { featureId, activeVariantId:'v1', screenshotFile, screenshotDataUrl, screenshotInherited, inheritedFromFeatId, additionalContext, variants:{ v1:{ generated, stale, generating, generatedAt, inputSignature, wireframeBlobUrl, wireframeHTML, designBrief, coverageData, externalPrompt } } }
- **Core helpers:** pcGetActiveVariant(featId), pcGetLiveFeature(featId), pcIsVisibleNavFeature(featId), pcIsNonUIFeature(featId)
- **Lifecycle:** pcMarkStale(featId) — data-only setter; pcDeleteProto(featId) — revokes blob URLs; pcMigrateProtoFeatureId(oldId,newId) — move semantics with collision guard
- **Screenshot:** pcGetScreenshotContext(featId) — own/session/null fallback; pcHandleScreenshotUpload(featId,file)
- **Signature:** pcFeatureSignature(feat,additionalContext), pcCanonicalStories(feat)
- **Render:** pcRenderView(featId) → empty/loading/generated; pcToggleSection(id); pcInjectWireframe(featId,html)
- **Generation:** pcGenerate(featId) — aiGenInFlight guard, startAiGen/endAiGen in try/finally, signature capture+comparison, async completion guard, non-UI detection
- **Export:** pcExportPrototype(featId) — DOCX: design brief + coverage table + external prompt + wireframe note
- **Style guide:** _pcGetStyleGuide() — async fetch assets/prototype-style-default.md; PROTOTYPE_STYLE_DEFAULT_FALLBACK constant as embedded fallback
- **Boot flag:** pcReady=true at end of file; pcAvailCall(fn,arg) safe cross-file call guard

`scripts/export-xlsx.js` — `downloadXLSX()`, `doXLSX()` — Metrics Definition XLSX download

`scripts/export-pi-docx.js` — `buildAndDownloadPIDocx()` — PI Canvas DOCX download (called by `piExportDocx()`)

`scripts/api.js` — `switchTab()`, `revealAndSwitchTab()`, `callAPI()`, `parseJSON()`, `isValidTree()`, `showLoad()`, `hideLoad()`. `switchTab()` manages all 6 tabs (mm, cc, pi, mi, la, sc): tab button active states, content area show/hide, left-panel visibility, tab entry hooks (`ccOnTabEnter`, `piOnTabEnter`, `miRenderEmpty`/`miRenderScreen`, `laRenderAnalysis`, `scRenderCapNav`/`scRenderCanvas`). `callAPI()` routes to `/api/anthropic` proxy on Netlify, falls back to direct Anthropic call locally. Model string reads from `appSettings.model` with fallback to `claude-sonnet-4-6`.

`scripts/demo-data.js` — DEMO MODE ONLY. `loadDemoData()`, `clearDemoMode()`. Do NOT open for any other task.

`scripts/main.js` — DOMContentLoaded init

`scripts/diagnostic-view.js` — `dvCreate()`, `dvDeepCloneTree()`, `dvMergeEvidenceOnRegen()`, `dvRenderView()`, `dvRenderLeftPanel()`, `dvRenderTreeArea()`, `dvOpenEvidenceDrawer()`, `dvCloseEvidenceDrawer()`, `dvSaveEvidence()`, `dvClearEvidence()`, `dvCalcEvidenceStrength()`, `dvCalcReadiness()`, `dvFlattenMetrics()`, `dvFindMetricById()`, `dvAnalyze()`, `dvShowNoEvidenceWarning()`

`scripts/product-leak-analysis.js` — `laRenderAnalysis()`, `laRenderSummaryCards()`, `laRenderTable()`, `laRefreshTable()`, `laToggleExperiment()`, `laOpenDetailPanel()`, `laOpenSummaryDetail()`, `laCloseDetailPanel()`, `laRenderFilterPopover()`, `laToggleFilterPopover()`, `laRenderColPopover()`, `laToggleColPopover()`, `laSendToStoryCanvas()`, `laShowSentConfirmation()`, `laDownloadDocx()`

`scripts/export-diagnostic-docx.js` — `laDownloadDocx()`, `buildDiagnosticDocxHTML()`

`scripts/market-intelligence.js` — `miGenerate()`, `miRenderScreen()`, `miRenderLeftPanel()`, `miRenderMarketSnapshot()`, `miRenderTrends()`, `miRenderCompetitors()`, `miRenderSWOT()`, `miRenderCapabilities()`, `miAlignCapabilities()`, `miGenerateFeatures()`, `miToggleExpansion()`, `miUpdateCheckboxCount()`, `miSendToCanvas()`, `miSendCapDirectly()`, `miUndoSend()`, `miDownloadDocx()`, `miRenderEmpty()`, `miRefreshCapSection()`, `miLoadFeatures()`, `miToggleFeature()`, `miRegenerateFeatures()`, `miShowToast()`

`scripts/export-market-intel-docx.js` — `miBuildDocx()`

---

### Styles (load order matters)
`styles/00-tokens.css` — design tokens: colours, fonts, spacing. **CRITICAL: `--bg` is NOT defined — resolves to transparent. Always use `#fff` or `var(--card)` for dropdown/input backgrounds.**
`styles/01-base.css` — reset, body, toast styles (`.app-toast`, `.app-toast-*`), confirm modal base
`styles/02-layout.css` — app shell, left/right panels, out-body
`styles/03-header-settings.css` — header (`.hdr`, `.hdr-l`, `.hdr-r`, `.cfg-btn`, `.cfg-wrap`, `.api-dot`). Fly-out panel CSS (`.sp-body`, `.sp-col`, `.sp-feat-*`, `.sp-cost*`, `.sp-footer`) retired in v6.75 — `.sp-field`, `.sp-eye`, `.sp-status-*` classes kept for any residual usage.
`styles/04-left-panel.css` — product inputs, segment buttons, generate button
`styles/05-kpi-tree.css` — KPI tree, NSM node, stage columns, L1-L4, stage-empty state
`styles/06-metrics-definition.css` — metrics definition table
`styles/07-capability-drawer.css` — capability drawer slide-in panel
`styles/08-feature-canvas.css` — Story Canvas, capability tree nav panel, feature cards, story panel, export, PI selection checkboxes, push nudge strip
`styles/09-modals-export.css` — batch modal, export dropdown, modal-overlay, modal-footer, modal-confirm-btn, modal-cancel-btn, confirm modal
`styles/10-capability-canvas.css` — Capability Canvas: all views (dual-entry, metric nav, cap grid, PI cap view, all-caps), right feature panel, DD panel, export dropdown, action bar
`styles/11-diagnostic-view.css` — dv-tab layout, left panel, session card, readiness block, evidence drawer, evidence dots, evidence trigger, evidence fields, bottom action bar
`styles/12-product-leak-analysis.css` — la-tab layout, summary cards, experiments table, popovers, detail panel, toasts, SC origin badge CSS
`styles/13-market-intelligence.css` — mi-tab layout, left panel, section cards, metric cards, trend badges, SWOT grid, capability rows, expansion panel, feature checkboxes, 4 interaction states, loader, empty state, toast, KPI toggle, alert modal
`styles/14-pi-planning.css` — pi-tab layout, left panel (squads, sprint config, prev-PI upload), board (sprints + backlog), story cards, drag-and-drop states, right story panel, stale banner, dependency UI, capacity warning
`styles/15-settings.css` — settings page shell (`#settings-page` full-page container, `.cfg-btn.active` state)

---

## Common request routing

| User asks for... | Files to open |
|---|---|
| Netlify proxy, CORS error, API routing | `netlify/functions/anthropic-proxy.js`, `netlify.toml`, `scripts/api.js` |
| Header, gear icon, api-dot | `styles/03-header-settings.css`, `scripts/settings.js`, `scripts/left-panel.js` |
| Settings page — open/close/save | `scripts/settings-page.js` (openSettingsPage, closeSettingsPage, settingsPageSave) |
| Settings page — API key, model dropdown | `scripts/settings-page.js` (spP1), `scripts/settings.js` (checkKey) |
| Settings page — feature module toggles | `scripts/settings-page.js` (spP2), `scripts/left-panel.js` (applyFeats), `scripts/state.js` (appSettings) |
| Settings page — output depth controls | `scripts/settings-page.js` (spP3), `scripts/state.js` (appSettings.maxCaps etc.) |
| Settings page — PI planning defaults | `scripts/settings-page.js` (spP4), `scripts/state.js` (appSettings.defaultSprints etc.) |
| Settings page — restore defaults | `scripts/settings-page.js` (spRestoreDefaults, _spDefaults3, _spDefaults4) |
| appSettings — reading or modifying any setting | `scripts/state.js` (appSettings const) |
| Demo data content | `scripts/demo-data.js` — do NOT open for any other task |
| Product input fields, segment buttons | `index.html`, `styles/04-left-panel.css`, `scripts/left-panel.js` |
| KPI tree layout, stage columns, empty stage | `styles/05-kpi-tree.css`, `scripts/kpi-tree.js` |
| KPI tree prompt | `scripts/prompts.js` (buildTreePrompt) |
| Metrics Definition table | `styles/06-metrics-definition.css`, `scripts/metrics-definition.js` |
| Metrics Definition XLSX export | `scripts/export-xlsx.js` |
| Capability drawer (opens from KPI tree) | `styles/07-capability-drawer.css`, `scripts/capability-drawer.js` |
| Capability drawer prompt | `scripts/prompts.js` (buildCapPrompt) |
| Tab switching, tab entry hooks, left panel hide | `scripts/api.js` (switchTab, revealAndSwitchTab) |
| State variables | `scripts/state.js` |
| Toast, confirm modal, trapFocus | `scripts/utils.js`, `styles/01-base.css`, `styles/09-modals-export.css` |
| **Capability Canvas** | |
| CC layout, all views, dual-entry, metric nav | `scripts/capability-canvas.js`, `styles/10-capability-canvas.css` |
| CC tab entry / exit | `scripts/capability-canvas.js` (ccOnTabEnter, ccOnTabLeave) |
| CC capability generation (per metric or all) | `scripts/capability-canvas.js` (ccGenerateOne, ccGenerateAll), `scripts/prompts.js` (buildCapCanvasPrompt) |
| CC PI-first path (upload/paste plan) | `scripts/capability-canvas.js` (ccShowPIFirstForm, ccBuildPICanvas, ccActivatePIFirst) |
| CC right feature panel | `scripts/capability-canvas.js` (ccBuildFeatPanel, ccOpenCapPanel) |
| CC feature generation for capability | `scripts/capability-canvas.js` (ccGenerateFeaturesForCap, ccGenerateFeaturesForSelected), `scripts/prompts.js` (buildCapFeaturesPrompt) |
| CC capability CRUD (add / edit / remove) | `scripts/capability-canvas.js` (ccShowAddCapModal, ccDoAddCap, ccShowEditCapModal, ccDoEditCap, ccRemoveCapability) |
| CC "Add Capability" dropdown + upload/map (v7.83) | `scripts/capability-canvas.js` (ccAddCapBtnHTML, ccToggleAddCapDrop, ccShowUploadCapModal, ccHandleCapUpload, ccShowCapReviewModal, ccConfirmCapUpload) |
| CC feature selection, send to SC | `scripts/capability-canvas.js` (ccToggleCapSelect, ccSendToStoryCanvas) |
| CC all-caps view | `scripts/capability-canvas.js` (ccRenderAllCaps) |
| CC PI cap view | `scripts/capability-canvas.js` (ccRenderPICapView) |
| CC DD panel (metric dictionary) | `scripts/capability-canvas.js` (ccOpenDDPanel, ccDDGenerateForMetric), `scripts/prompts.js` (buildDDPrompt) |
| CC export DOCX | `scripts/capability-canvas.js` (ccDownloadDOCX, ccBuildDOCX) |
| **Story Canvas** | |
| SC layout, cards, filter, nav | `styles/08-feature-canvas.css`, `scripts/feature-canvas.js` |
| SC left panel (capability tree nav) | `scripts/feature-canvas.js` (scRenderCapNav) |
| SC right panel (story panel) | `scripts/feature-canvas.js` (scOpenPanel, scRenderPanel, scRenderLineage) |
| SC story generation prompt | `scripts/prompts.js` (buildPIStoryPrompt — used for both paths), `scripts/feature-canvas.js` (scBuildStoryPrompt) |
| SC story editing (title, statement, AC) | `scripts/feature-canvas.js` (scEditStoryTitle, scEditStoryStmt, scEditStoryAC) |
| SC metric linking | `scripts/feature-canvas.js` (scShowLinkMetricModal, scConfirmLinkMetric) |
| SC PI selection checkboxes, "Send to PI →" | `scripts/feature-canvas.js` (scTogglePiStory, scPanelSendToPI) |
| SC push nudge, scPushStoriesToPI | `scripts/feature-canvas.js` (scPushStoriesToPI, scDismissPushNudge) |
| SC feature CRUD (add / edit / remove) | `scripts/feature-canvas.js` (scShowAddFeatureModal, scDoAddFeat, scShowEditFeatModal, scDoEditFeat) |
| FC "Add Feature" dropdown + upload/map (v7.84) | `scripts/feature-canvas.js` (scToggleAddFeatDrop, scShowUploadFeatModal, scShowFeatReviewModal, scConfirmFeatUpload) |
| SC batch modal | `scripts/feature-canvas.js` (scShowBatchModal, scModalProceed) |
| SC export DOCX | `scripts/export-docx.js` (scDownloadStoriesDOCX, scBuildDOCX) |
| SC PI planned badges | `scripts/feature-canvas.js` (scApplyPIPlannedBadges, scClearPIPlannedBadges) |
| **PI Canvas** | |
| PI layout, board, squads, sprint config | `scripts/pi-planning.js`, `styles/14-pi-planning.css` |
| PI tab entry | `scripts/pi-planning.js` (piOnTabEnter) |
| PI generation (sprint assignment) | `scripts/pi-planning.js` (piGenerate), `scripts/prompts.js` (buildPIGeneratePrompt) |
| PI stale banner, story sync | `scripts/pi-planning.js` (piCheckStaleness, piShowStaleBanner, piSyncNewStories) |
| PI drag-and-drop, capacity | `scripts/pi-planning.js` (piDragStart, piDrop, piCheckCapacity) |
| PI right story panel | `scripts/pi-planning.js` (piOpenRightPanel, piRenderRightPanel) |
| PI backlog panel | `scripts/pi-planning.js` (piOpenBacklogPanel, piMoveBacklogToSprint) |
| PI dependencies | `scripts/pi-planning.js` (piShowAddDepForm, piLinkDep, piRemoveDep) |
| PI left panel toggle | `scripts/pi-planning.js` (piToggleLeftPanel) |
| PI export DOCX | `scripts/pi-planning.js` (piExportDocx), `scripts/export-pi-docx.js` (buildAndDownloadPIDocx) |
| PI prev-PI upload | `scripts/pi-planning.js` (piHandlePrevPIFile, piParsePrevPI) |
| **Diagnostic View** | |
| Create diagnostic view CTA, bottom action bar | `scripts/kpi-tree.js`, `styles/11-diagnostic-view.css` |
| Diagnostic view layout, left panel, readiness | `scripts/diagnostic-view.js`, `styles/11-diagnostic-view.css` |
| Evidence drawer, evidence fields | `scripts/diagnostic-view.js`, `styles/11-diagnostic-view.css` |
| Evidence strength, readiness calculation | `scripts/diagnostic-view.js` |
| **Product Diagnostics (Leak Analysis)** | |
| Product leak analysis, summary cards, table | `scripts/product-leak-analysis.js`, `styles/12-product-leak-analysis.css` |
| Experiment detail overlay, filter/column popover | `scripts/product-leak-analysis.js`, `styles/12-product-leak-analysis.css` |
| Send to story canvas (from leak analysis) | `scripts/product-leak-analysis.js` |
| Diagnostic DOCX export | `scripts/export-diagnostic-docx.js` |
| Product leak AI prompt | `scripts/prompts.js` (buildProductLeakPrompt) |
| SC origin badge, left-border accent | `scripts/feature-canvas.js`, `styles/12-product-leak-analysis.css` |
| Tab reveal/switch for dv/la | `scripts/api.js` (revealAndSwitchTab, switchTab) |
| **Market Intelligence** | |
| MI tab layout, left panel, sections | `scripts/market-intelligence.js`, `styles/13-market-intelligence.css` |
| MI prompt | `scripts/prompts.js` (buildMarketIntelPrompt, buildMIFeaturePrompt) |
| MI feature generation, send to canvas | `scripts/market-intelligence.js` |
| MI DOCX export | `scripts/export-market-intel-docx.js` |
| MI Settings toggle, applyFeats mi-gated | `scripts/left-panel.js`, `index.html` |
| MI KPI tree toggle (Product Inputs) | `index.html`, `scripts/left-panel.js`, `scripts/kpi-tree.js` |
| MI state variables | `scripts/state.js` |
| Market Signal origin badge (Story Canvas) | `scripts/feature-canvas.js`, `styles/08-feature-canvas.css` |
| MI demo data | `scripts/demo-data.js` — do NOT open for any other task |
| Tab reveal/switch for mi | `scripts/api.js` (switchTab, revealAndSwitchTab) |

---

## Key cross-canvas data flows

| Flow | Source | Function | Destination |
|---|---|---|---|
| Caps → Story Canvas (KPI path) | `capability-canvas.js` | `ccSendToStoryCanvas()` | `scCanvas[]` |
| Caps → Story Canvas (PI-first path) | `capability-canvas.js` | `ccSendToStoryCanvas()` | `scCanvas[]` (origin: 'pi') |
| Stories → PI Canvas (panel) | `feature-canvas.js` | `scPanelSendToPI()` | `piPlan.backlog[]` |
| Stories → PI Canvas (card nudge) | `feature-canvas.js` | `scPushStoriesToPI()` | `piPlan.backlog[]` |
| Market signals → Story Canvas | `market-intelligence.js` | `miSendToCanvas()` | `scCanvas[]` (origin: 'mi') |
| Diagnostics → Story Canvas | `product-leak-analysis.js` | `laSendToStoryCanvas()` | `scCanvas[]` (origin: 'diagnostic') |
| KPI tree regen → Evidence preserved | `diagnostic-view.js` | `dvMergeEvidenceOnRegen()` | `diagnosticSessions[]` |
| Metric link in SC → capStore sync | `feature-canvas.js` | `scConfirmLinkMetric()` | `capStore[]`, `scCanvas[]` |

---

## capStore data structure

```
capStore[metricKey] = {
  metricName: string,
  stageLabel: string,
  stageId: string,            // 'acquisition' | 'activation' | 'engagement' | 'retention' | 'pi'
  _piFirst: boolean,          // true for PI-first (path B) entries
  capabilities: [{
    name: string,
    why: string,
    subCaps: [] | null,
    _manual: boolean,         // true if added via Add Capability modal
    featStore: {
      top: [{                 // main feature list
        name, why, selected,
        metric, stage, cap, subCap,
        _aiAdded: boolean,    // true if AI-added to a manual capability
        _piSelected: boolean  // true if checked for PI send
      }],
      sc0..scN: []            // sub-capability feature lists
    }
  }]
}
```

metricKey format: `stageId+'||'+metricName` for KPI-linked entries; `'pi||'+capName` for PI-first entries.

---

## CRITICAL: Known resolved defects (do not re-introduce)
- `var(--bg)` is undefined in this token set — resolves to transparent. Never use for dropdown/input backgrounds. Use `#fff` or `var(--card)`.
- `ccRenderPICapView` is the render path for PI caps — NOT `ccRenderMainContent`. Always check which render path is active before proposing PI cap fixes.
- `sc-panel-content` requires `display:flex; flex-direction:column; flex:1` to allow child flex containers to fill height correctly (fixed v6.73).
- `scGenerateStories` must call `scRenderLineage(firstFeat)` to preserve the traceability toggle strip during generation (fixed v6.73).

---

## v8.58 additions

### New functions in `scripts/utils.js`

- `getFullProductCtx()` — full product context object for CC/FC/SC/PI/DM/MI prompt builders; supersedes `getProductCtx()` at all AI generation call sites
- `_assertPromptCtx(ctx, fnName)` — runtime guard on changed prompt builders; throws TypeError if old positional call site remains
- `buildDocContext(canvasType)` — assembles formatted doc context block for prompt injection; canvas-routed by docType; max 3 docs (session → product → company priority); returns '' when no docs apply
- `_docGetText(doc)` — best available text: aiSummary → extractedText → live _homeSessionDocs in-memory
- `_docMergeLive(doc)` — merges snapshot doc with live in-memory entry to pick up retry results
- `_docFormatBlock(doc, text)` — formats one doc as DOCUMENT CONSTRAINTS or DOCUMENT CONTEXT block with untrusted-content framing before text
- `extractTextFromFile(file)` — unified text extractor (.txt, .md, .docx via mammoth.js, .pdf via pdf.js sequential); returns Promise<string>
- `summariseDocument(extractedText, fileName)` — LLM classification + summarisation per file; returns Promise<{docType, aiSummary, keyDecisions, constraints, openQuestions}>
- `_loadMammoth()` — memoised Promise CDN loader for mammoth.js
- `_loadPdfJs()` — memoised Promise CDN loader for pdf.js (sets workerSrc on load)
- `_makeDocId()` — generates `doc_<timestamp>_<random>` ID
- `_isSafeDocId(id)` — validates doc ID format
- `_ensureSafeDocId(doc)` — normalises malformed doc IDs during migration
- `chunkText(text, chunkWords, overlapWords)` — RAG-forward chunking utility (unused until RAG Step 3)
- `_getLiveHomeSessionDocs()` — safe cross-file accessor for `_homeSessionDocs` (home.js)

### New functions in `scripts/home.js`

- `homeRenderSdocsSection()` — renders Session Documents upload section or cap list upload depending on approach+mode; always-visible `#home-sdocs-box`
- `homeHandleSdocsUpload(inputEl)` — handles multi-file session doc upload with async extract + summarise; ID-based async callbacks
- `homeRenderSdocsChips()` — renders doc chips with docType badges, data-doc-id handlers, pre/post-launch states; null-guards `#home-sdocs-chips`
- `_homeToggleSdocType(badgeEl, docId)` — shows inline docType override select on badge click
- `_homeSdocTypeChange(selectEl, docId)` — updates docType on select change, re-renders chips
- `_homeRemoveSdoc(docId)` — removes session doc by ID, re-renders section and updates launch btn
- `_homeRetrySdocSummaries()` — silent retry for failed summaries; updates frozen sessionContext snapshot on success; called post-launch (2s delay) and on tab re-entry
- `_homeToggleCtx()` — toggles Additional Context textarea collapsed/expanded; wires counter on expand

### New functions in `scripts/session-store.js`

- `_ssStripSessionDocs(ctx)` — strips `extractedText` from session docs before snapshot; always returns new object to prevent shared-reference mutation

### New functions in `scripts/settings-page.js`

- `_spMigrateOldDocs()` — removes old-format docs (missing summaryStatus) from all profiles on restore and Supabase sync; local-only, no Supabase write; idempotent; sets `_spOldDocMigrationDirty` flag
