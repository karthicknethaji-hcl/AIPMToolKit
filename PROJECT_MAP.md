# Project Map — AI PM Toolkit

**Purpose:** This file exists so that a request touching one feature area only requires reading the 1–3 files this map points to — not the whole codebase. Treat every entry as a targeting aid: precise enough to avoid opening unrelated files, and no more verbose than that job requires. Narrative history (why a fix was made across several past versions) belongs in `CHANGELOG.md`; keep entries here to current-state facts and only the "why" detail that changes where to look or what to avoid touching.

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
`proxy/server.js` — Express proxy backend deployed on Render.com. POST /api/anthropic endpoint. CORS locked to productdiagnostics.netlify.app. Rate limit 20 req/min per IP. Deployed separately from the Netlify frontend — do NOT modify without testing on Render. Auth: `requireAuthStrict` (JWT-required, no local-dev bypass) + `requireCompanyAdmin`, mounted on `/api/team/*` — seven admin-only routes (list/invite/set-role/disable/enable/delete/resend/revoke), all service-role-keyed via `supabaseAdmin`, scoped by both `company_id` and target `user_id` on every query. Role-change/disable/delete admin-count safety is enforced via three Postgres RPCs (`team_set_role_safe`, `team_disable_safe`, `team_delete_member_safe` — see `phase4-rpcs.sql`), not in-process logic — closes a concurrency gap a plain application-level count-then-update can't close. `/api/anthropic` uses `requireAuthStrict` plus `requireActiveCompanyMember` (calls the shared `is_active_company_member()` RPC, see `v8113-migrations.sql`) — this is the highest-frequency endpoint in the app. JWT verification includes explicit `issuer`/`audience` checks.
- **v9.14 multi-provider:** `requireActiveCompanyMember` also resolves `req.resolvedProvider` server-side (reads `mt_company_settings.settings.provider` — never trusts client-sent `body.provider`, which is diagnostics-only). The main handler dispatches through `proxy/providerAdapters.js`'s `getAdapter(provider)` (Anthropic, OpenAI, and — as of v9.14.03 — Gemini), validates the resolved model against that module's catalog before calling upstream (fail-fast, Section 6.3), retries once on a transient (rate-limit/overload/5xx) HTTP error only — never on transport failures/timeouts — and returns a provider-neutral `{text}` envelope on success (`scripts/api.js`'s `callAPI()` reads `data.text`, not `data.content[0].text`). `mt_ai_usage_events.provider` is always the server-resolved value. `ORG_API_KEY_BY_PROVIDER` includes `GEMINI_API_KEY` alongside `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`.

`proxy/providerAdapters.js` — canonical, shared adapter module (v9.14, Gemini added v9.14.03). One entry per provider: `buildUpstreamRequest`, `normalizeSuccess`, `normalizeHttpError`, `normalizeTransportError`, plus `MODEL_CATALOG_BY_PROVIDER` for the proxy's own fail-fast model validation. Imported by BOTH `proxy/server.js` and `netlify/functions/anthropic-proxy.js` — not duplicated — per this project's no-duplicate-file rule and this same section's own drift warning below. OpenAI and Gemini model IDs are real (confirmed via direct human screenshot / raw-doc paste respectively, not search-tool output) as of v9.14.02/v9.14.03; Gemini's `x-goog-api-key` auth header is one confidence tier lower (search-tool-confirmed, not directly pasted) — worth a human glance at `ai.google.dev/gemini-api/docs/api-key` before treating as fully closed.

`package.json` (site root) — Netlify Functions dependencies (`jsonwebtoken`, `jwks-rsa`, `@supabase/supabase-js`). Must live here, not nested under `netlify/functions/` — Netlify's build only bundles function dependencies declared at the site root.

`netlify/functions/anthropic-proxy.js` — the ACTUAL hosted production path for `/api/anthropic` (confirmed via `netlify.toml`'s rewrite rule — every hosted deployment, dev and prod, routes here, not to `proxy/server.js`). Does real JWT verification (JWKS, ES256/RS256, issuer + audience) plus the same `is_active_company_member()` RPC check as `server.js`'s equivalent middleware — single canonical source of authorization truth so the two separate runtimes can't drift apart on what "active member" means. Anthropic call timeout is 48s, within Netlify's 60s hard limit.
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
- PI Planning (v9.20: multi-release-plan): `piMode`, `piFirstBuilt`, `piInputs`, `piPlans` (array of plan objects, each with its own `squads[]` - replaces the old singular `piPlan`/global `piSquads`), `piBacklogStoryIds` (global, plan-agnostic backlog tray), `_piActivePlanId` (local UI state only, never persisted or synced), `piStoryPool`, `piScVersion`, `piDdPanelOpen`, `piDdPanelMetricKey`

`scripts/utils.js` — `e()` HTML escape, `showToast()`, `showConfirm()`, `trapFocus()`, shared helpers. `_uiRowMenuToggle()`/`_uiRowMenuClose()` — content-agnostic dropdown-menu mechanics (open/position/outside-click/Escape/single-open-at-a-time), used by Team Management's row-action menu and the session-card 3-dot menu. `ejs()` — JS-string-escape helper, distinct from `e()`'s HTML-escape: `e()` alone is unsafe when a value is spliced into an inline `onclick` JS string literal — see `home.js`'s `_homeSessMenuAction()` for the preferred fix, which avoids this class of bug entirely by moving off inline `onclick` string-splicing. `showConfirm()` has an optional 8th param `secondAction` ({label, bg, color, borderColor, onClick}) — renders a third button between Cancel and the primary confirm, used by Team Management's shared-session delete modal (see `team-management.js`).

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
- `buildPIGeneratePrompt()` — PI sprint assignment generation
- `buildRequirementAgentDMOpeningPrompt()` — Requirement Agent's Discovery-Map-triggered opening turn; one function, branches internally on whether `capStore` has any entries (Pass 1 greenfield / Pass 2 iterative). See "Requirement Agent module" below.
- `buildRequirementAgentTurnPrompt()` — Requirement Agent's per-turn prompt; carries `capStore` + prior finalized briefs through every turn, semantic (never string-match) new-vs-existing classification.
- `buildRAFeatureGenPrompt()` — thin wrapper around `buildCapFeaturesPrompt()` used by CC's "Generate Features" CTA when a capability's `intakeBriefId` is non-null; targeted per-capability brief extraction (name + requirement narrative + objectives), never the full `liveDraftMd` blob.

`scripts/settings.js` — API key handling: `checkKey()`, `toggleKeyVis()`. `checkKey()` validates the key format (v9.14: provider-aware via `isValidApiKeyFormat(k, provider)` and `_PROVIDER_KEY_PATTERNS` — a `null` pattern means unverified, soft-accepted rather than false-flagged), updates `#api-dot` in header, persists to sessionStorage under `_byokKey()`'s company+provider-scoped slot, and calls `spRefreshKeyStatus()` to update the settings page key status pill when settings is open. `updateFeatLock()` is retired (body empty) — kept as shell to avoid call-site errors.

`scripts/settings-page.js` — Full admin settings page (v6.75+). Replaces the fly-out panel entirely.
- **Render:** `spRender()`, `spBuildHTML()`, `spP1()` (API & Access), `spP2()` (Feature Modules), `spP3()` (Output Depth), `spP4()` (PI Planning Defaults)
- **Navigation:** `spNav(n)` — switches active section, updates left nav highlight and panel title
- **Populate from state:** `spPopulate()` — fills all UI controls from `appSettings{}` after render
- **Restore defaults:** `spRestoreDefaults()` — sections 3 and 4 only; resets to `_spDefaults3` / `_spDefaults4`
- **Controls:** `spStep(id,d,mn,mx)` — stepper increment/decrement; `spSeg(k)` — velocity segmented control; `spTogRow(k)` — toggle rows; `spRefreshKeyStatus()` — updates key status pill from `checkKey()`
- **Internal builders:** `_spTog()`, `_spStepper()`, `_spRow()`, `_spModRow()`, `_spSubLbl()`, `_spNavItem()`, `_spTitle()`, `_spDesc()`, `_spTabLabel()`
- **Constants:** `_spDefaults3`, `_spDefaults4`, `_spTogStates` (toggle state map). Provider/model catalog (`_spProviders`, `_spModelsByProvider`, `_spKeyMetaByProvider`) moved to `scripts/config.js` in v9.14 — no more single-provider `_spModels` array.
- **v9.14 provider dropdown:** `spOnProviderChange(newProvider)` — live-mutates `appSettings.provider`/`.model` (no Save required, preview only), repopulates `#sp-model-select` from `_spModelsByProvider`, and swaps the API key card's label/placeholder/value in Section 0 (My Profile). `_spKeySnapshot` is now `{provider, model, keys:{anthropic,openai}}`, not a single scalar — `spConfirmDiscard()` reverts all three.
- **Section 6 (Team Management):** `spBuildHTML()` leaves `#sp-p6` empty; `spRender()`/`spNav(6)` call `tmLoad()` (in `scripts/team-management.js`) to fetch and render live.
- **Role model (v9.09):** `currentUserRole` (main.js) is `'admin' | 'member' | 'readonly' | null`. Internal string values unchanged from v9.08 for the first two — `'member'` displays as "Power User" (renamed from "Regular User"), no behavior change. `_spIsAdmin()` and `_spIsReadOnly()` are the two permission helpers — `readonly` gets identical Settings access to `'member'` (Power User) by design, so `_spIsReadOnly()` is used OUTSIDE Settings only (Home launch-block, `canEditSession()`), not for any Settings-section gating.

`scripts/team-management.js` — Team Management (Settings Section 6, admin-only).
- **Load + render:** `tmLoad()`, `tmRender()`, `_tmBuildHTML()`, `_tmRowHTML()`, `_tmStatusBadge()`, `_tmRoleBadge()`
- **Proxy calls:** `_tmCall(path, body)` — shared POST helper, `X-Auth-Token` + active company id, mirrors `auth.js`'s `authCheckCompanyName()` local/hosted URL pattern via `_tmProxyBase()`
- **Row actions:** `tmToggleRowMenu()` (uses `_uiRowMenuToggle()` from `utils.js`), `tmSetRole()`, `tmDisable()`, `tmEnable()`, `tmStartDelete()`/`_tmExecuteDelete()`/`_tmShowSharedSessionChoice()`, `tmResend()`/`_tmShowInviteLink()`/`_tmCopyLink()`, `tmRevoke()`. `_tmShowSharedSessionChoice()` calls `showConfirm()`'s `secondAction` param. Only two resolutions offered — Reassign and (for the departed-member case) nothing else, since Retain would leave session ownership pointed at a departed member with zero active membership. `_tmExecuteDelete()` shows differentiated toast copy per resolution, using the real affected-row count the server echoes back (see `server.js`'s `/api/team/delete` execute branch, which `.select()`s the mutating query).
- **Invite modal:** `tmShowInviteModal()`, `_tmSelectInviteRole()`, `tmSubmitInvite()`
- No direct Supabase table access from this file at all — every read/write to `mt_users_companies`/`mt_sessions` for Team Management goes through `/api/team/*` on the proxy, since admin actions here routinely touch other users' rows, which RLS deliberately doesn't allow client-side.

`styles/20-team-management.css` — Team Management table, badges, row-action menu. Loaded by `index.html` only (Settings-page context).

`scripts/home.js` — Home tab (Tab Zero). Session launcher.
- **Init:** `homeInit()`, `homeOnTabEnter()`
- **Product selector:** `homeOnProductChange()`, `_homeRenderProductSelector()`
- **Preview card:** `homeRenderPreviewCard()`, `homePPCardToggle()`
- **Selectors:** `homeSetApproach()`, `homeSetMode()`
- **Manual input (capability list upload):** `homeHandleFileUpload()`, `_homeParseXLSX()`, `_homeParseCSV()`, `_homeFinalizeCapList()`, `_homeRenderParseResult()`, `_homeRemoveCapList()`, `_homeShowParseError()`
- **Launch:** `homeLaunch()`, `_homeDoLaunch()`, `homeClearSession()`
- **Demo:** `homeLoadDemo()`, `_homeDoLoadDemo()`
- **Session card sharing:** `homeSessionToggleShare()` (session-store.js) — Share/Unshare, mirrors `sessionStoreRename()`'s local-write-then-async-DB-update pattern; v9.08 also re-derives `share_mode` from `appSettings.defaultShareMode` on every false→true transition. `_homeSessMetaLine()` — three-state meta line (private / shared-idle-by-name / shared-generating-now), with a bounded age check on `activeAt` to prevent a future/skewed timestamp from showing "generating now" indefinitely. `_homeSessMenuHtml()`/`homeToggleSessMenu()`/`_homeSessMenuAction()` — 3-dot menu content and delegated click handler; deliberately does NOT use inline `onclick` with spliced string arguments, since `e()` HTML-escapes but doesn't JS-string-escape — reads session id/name/isShared back off `data-*` attributes instead, never splicing untrusted data into a JS string literal at all. `homeStartRenameFromMenu()` — hands off to `homeSessionRenameInline()`. `_homeRenderSessionCard()`/`_homeRenderPinnedBanner()` — session name is line 1, product name+type is line 2, inline shared-team icon when `isShared`.
- **v9.08 — `canEditSession()`** (session-store.js): single source of truth for "can the current user mutate the active session," used across all 7 canvas files at every mutation entry point (~29 call sites) plus as a central defense-in-depth guard inside `sessionStoreSave()` itself. Reads `_activeSessionOwnerId`/`_activeSessionIsShared`/`_activeSessionShareMode` — the last of these is a new global, captured alongside the other two at both existing capture points (`sessionStoreCreate`, `sessionStoreRestore`), defaults to `'view'` (fail-closed, not `'edit'`), cleared in `homeClearSession()`. Server-side enforcement (the actual security boundary) lives in the `save_shared_session_content` and `acquire_generation_lock` Postgres RPCs, both of which independently check `share_mode` — `canEditSession()` on the client is a UX layer on top of that, not a substitute for it.
- **v9.09 — `canEditSession()` now checks company role FIRST, before ownership:** closes a gap found in adversarial review — a user demoted to `readonly` who still owned older sessions previously retained full edit rights via the ownership branch, which never checked role at all. Fails closed on any unrecognized/null/undefined role, not just an exact `'readonly'` match. This also means `readonly` now overrides even an `'edit'`-mode session share (confirmed decision — role wins over share mode, a deliberate change from v9.08's original share-mode-only logic). Server-side, `save_shared_session_content` and `acquire_generation_lock` (both SECURITY DEFINER, both bypass RLS) now independently check for active, non-readonly company membership — RLS changes to `mt_sessions` alone don't reach these RPCs. Three `mt_sessions` RLS policies (INSERT/UPDATE/DELETE) also gained the same membership+role check, closing the same demoted-owner gap at the database layer.
- **v9.08.02 — view-only visual completion pass:** the original v9.08 build gated handlers consistently but left many visual affordances still looking interactive. See the new standing rule in `AI_EDITING_RULES.md` ("View-only / permission-gated UI: hidden vs. disabled") for the governing pattern. Genuinely new gates added in this pass (not just visual fixes) that were missing from the original 29-entry inventory: `kpi-tree.js`'s `editStage()`/`deleteStage()` and the `regen()`/`toggleRefineBar()` tree-refine flow; `capability-canvas.js`'s `ccEditFeatName()`/`ccEditFeatWhy()` (inline feature edit, never gated at all) and `ccToggleFeatPanel()` (the feature-selection checkbox, including the specific already-sent-checkbox-triggers-removal bug reported in testing); `feature-canvas.js`'s `scShowEditFeatModal()`, `scToggleSelect()`, and `scTogglePiSelect()`; `story-canvas-new.js`'s `newScShowRemoveConfirm()`/`newScDoRemoveStory()` (a third, distinct removal path from the card-level delete already gated); `pi-planning.js`'s `piShowRemoveConfirm()` and the separate backlog-panel (`piOpenBacklogPanel`) points/sprint/notes fields; and all of `prototype-canvas.js` (`pcGenerate()`, `pcHandleScreenshotUpload()`, `pcRemoveScreenshot()`, `pcAddGapToContext()`) — a full screen absent from the original inventory. Also fixed: Story Canvas's DoR toggle used `readonly` on a checkbox, which has no effect on that input type — corrected to `disabled`. Also found: Feature Canvas's "Add Feature" button, its refine bar, and its "Send to Story Canvas" button are static HTML in `index.html`, not JS-rendered — these needed a runtime `id`-based sync (added to `scUpdateActionBar()`) rather than a template conditional, since a template fix has no effect on markup a template never generated.

`scripts/live-sync.js` — Live multi-user sync. See `multi-user-rbac-spec.md` §12 for the full design history.
- **CC (per-item):** `_lsApplyCCEvents()` — exact-name-match capability/feature apply.
- **mm/pi/mi/la (wholesale):** `_lsApplyWholesaleCanvas(canvas, freshSnapshot)` — replaces the whole tracked structure for that canvas (`gData`/`piPlan`+`piInputs`/`miData`+`miCapabilities`+`miGenerated`/`productLeakAnalysis`+`diagnosticSessions`+`activeDiagnosticId`). Always confirmed before applying (`_lsAskConfirm()`) — no cheap way to detect partial local edits at this scope, unlike CC's single-field check. `_lsCloseKnownPanelForCanvas()` blanket-closes PI's right panel / Diagnostics' evidence drawer on apply. `_lsRerenderCanvas()` calls `renderMM()`/`piRenderBoard()`+`piRenderLeftPanel()`/`miRenderScreen()`/`laRenderAnalysis()`, only when that tab is currently visible.
- **Confirm gate is per-section** (`_lsBannerRefreshClick()`) — declining one canvas's wholesale confirm never blocks applying an unrelated one in the same batch.
- **Cursor is per-canvas** (`_lsGetSeenCursor`/`_lsSetSeenCursor(sessionId, canvas, ...)`, `_LS_ALL_CANVASES`) — a declined section's event can't be hidden by a later, unrelated section's applied event advancing a shared cursor past it.
- **Rename-sync** — added to `_lsWatchRunOneCycle()` directly, not the event-log system. Checks `mt_sessions.name` on the same poll that checks visibility; kickout dominates; skips if a rename input is focused; updates header + local cache together.
- Emits from: `ccGenerateOne()`/`ccGenerateAll()`/`_ccGenerateFeaturesForCapInner_REQUIRES_LOCK_HANDLE()` (cc), `generateConfirmed()` (mm, kpi-tree.js), `piGenerate()` (pi, pi-planning.js), `miGenerate()` (mi, market-intelligence.js), `_dvRunAnalysis()` (la, diagnostic-view.js).
- **Metrics Definition is explicitly excluded** — `generateDD()`'s result was never persisted to any tracked global (confirmed by reading it directly), only a boolean flag; a real, separate pre-existing gap, not a live-sync scope decision.
- **Content event emission:** `_lsEmitContentEvent(sessionId, canvas, eventType, metricKey, capName)` — inserts one row into `mt_session_content_events`. Insert-only, never reads session content, never calls `sessionStoreSave()`.
- **3a, Home poll:** `_lsHomePollStart()`/`Stop()` — company-scoped Realtime + baseline 15s interval, single-flight with a sequence token, metadata-only, never touches the active session or its snapshot. `_lsValidateHomeRow()`/`_lsMergeHomeMetaEntry()` — strict allowlist merge, no blank-defaulting. Started in `home.js`'s `homeInit()`/`homeOnTabEnter()`, stopped in `api.js`'s `switchTab()`.
- **3b, Resume pre-fetch:** `_lsResumePreFetch(sessionId)` — called from `session-store.js`'s (now async) `sessionStoreRestore()` for cached-shared sessions. Cursor fetched before the snapshot, deliberately.
- **3c, In-session watch:** `_lsSessionWatchStart(sessionId, seedCursorEventId)`/`Stop()` — single-flight ~10s interval, sequence-token-guarded, checks row-visibility (kickout signal, two consecutive empty results required) and new content events together. Cursor stored in `sessionStorage` (per-tab, not shared across tabs — a `localStorage` cursor was found during design review to risk one tab suppressing another's banner). Started from `sessionStoreRestore()` and `_homeDoLaunch()` (inert at creation), stopped in `homeClearSession()` (sacred-function edit, separately signed off).
- **3d, Content banner + targeted refresh:** `_lsShowContentBanner()`/`_lsHideContentBanner()` — a dedicated persistent element (`#ls-content-banner`, styled in `01-base.css`), not the shared single-slot `showToast()`. `_lsBannerRefreshClick()` — fetches fresh content, applies only via `_lsApplyTargetedEvents()` (exactly-one-name-match required on both local and fetched sides, normalized the same way this app's own capability-dedup logic already does), `_lsHasOpenEditForCapability()` gates a warn-first confirm.
- **3e, Unshare kickout:** `_lsTriggerKickout(sessionId)` — best-effort name attribution (RLS has already hidden the row by this point), stops the watch first, then toast + `homeClearSession()` + `switchTab('home')`.

`scripts/left-panel.js` — product input form, segment buttons, `applyFeats()`, `togglePanel()`. `toggleSettings()` and `saveSettings()` delegate to `openSettingsPage()` / `settingsPageSave()` in settings-page.js. `applyFeats()` reads from `appSettings{}` (not DOM checkboxes — fly-out panel is retired). `updateFeatLock()` body retired in v6.75 — shell kept.

`scripts/kpi-tree.js` — KPI tree generation, `renderMM()`, `STAGE_DEFS`, always-4-stage guarantee, `renderDiagnosticActionBar()`, `countAllMetrics()`, `_mmReconcileManualCaps()` (v7.83 - reconciles AI skeleton response with sessionContext.manualList for Capability-Based + Manual mode)

`scripts/pi-bucket.js` — Custom Value Stage bucket management (v9.05). Bridges `capStore['pi||'+capName]` entries (manually-added capabilities tagged to "Custom Process Area"/"Custom Metric" in Capability Canvas) to Discovery Map's `gData.stages[]`, so they appear as a "Custom Value Stage" (internal `id:'pi'`, default `label:'Custom Value Stage'` as of v9.06.01 — user-renamable, see `getPiStageLabel()`) alongside AI-generated stages. `capStore`'s key format (`'pi||'+capName`) is unchanged — this file adds a `bucketId` field to each entry's value, additively; `bucketId` is the sole identity for grouping (metricName is display-only). Multiple independent buckets can coexist under the pi stage.
- **ID generation:** `makeBucketId()` (crypto.randomUUID with fallback)
- **Ownership check:** `isPiCapEntry(key,entry)` — identity-based, replaces label-substring matching for pi-stage cascade/cleanup logic
- **Passive normalizer:** `syncPiStageFromCapStore(gData,capStore)` — derives/heals the pi stage's `l1_metrics[]` from whatever bucketIds currently exist in capStore; never invents empty buckets; self-enforcing deletion (no tombstone needed); backfills legacy pre-v9.05 entries into a deterministic `PI_BUCKET_LEGACY_ID`. Called from `session-store.js` (session load), `live-sync.js` (receiver-side, after CC events apply), and every `capability-canvas.js` call site that writes a `pi||` entry.
- **Active resolver:** `getOrCreateCurrentDefaultPiBucket(gData,capStore)` — called only on explicit user "add capability" actions; finds-or-creates the current default bucket
- **Dedicated edit/delete (NOT the general KPI-linked capability-rename path):** `piBucketRename(stageIdx,l1Idx,newName,newDesc)`, `piBucketDelete(bucketId)`

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
- **DD panel (metric dictionary, right side):** `ccOpenDDPanel()`, `ccRenderDDPanel()`, `ccNavDDPanel()`, `ccCloseDDPanel()`, `ccDDDownload()`, `ccDDGenerateForMetric()`, `ccDDGenerateAll()`. **Note on `ccDDDownload()` (flagged v9.08.03):** this function is not purely read-only — it contains `if(!ddGenerated){ await generateDD(); }` before downloading, so it will trigger generation as a side effect if called when the dictionary hasn't been generated yet. Its one current call site (the "Download .xlsx" button in `ccRenderDDPanel()`) only renders when `ddGenerated` is already `true`, so this fallback path is unreachable through today's UI — but it is NOT gated by `canEditSession()` (deliberately, since export must always remain available regardless of edit mode) and was left that way intentionally rather than fixed, to avoid risking a false-positive block on legitimate export. Any future new call site for `ccDDDownload()` must either preserve the `ddGenerated` precondition or add its own explicit permission check — do not assume this function is safe to call unconditionally just because its current button is.
- **Helpers:** `ccMetricKey()`, `ccStageColor()`, `ccStageBg()`, `ccStageText()`, `ccGetAllL1Metrics()`, `ccCountGenerated()`, `ccUpdateTabBadge()`, `ccGetTotalCaps()`, `ccGetTotalFeats()`, `ccFindMetricInGData()`
- **Export:** `ccToggleExportDrop()`, `ccExportFull()`, `ccExportFinalised()`, `ccDownloadDOCX()`, `ccBuildDOCX()`
- **Exit:** `ccExitNavigator()`

`scripts/requirement-agent.js` (`styles/23-requirement-agent.css`) — Requirement Agent (RA): global, session-scoped, MULTI-conversation requirements agent, distinct from the pre-existing Guided Launch chat (see `index.html`'s `#tab-gl` comment — a copy-only tab-label rename, unrelated module). **Discovery-First Entry Point redesign** — RA now triggers from Discovery Map's "Define Requirements" CTA (RA on only, see `kpi-tree.js`'s `renderDiagnosticActionBar()`), not from Capability Canvas; Finalize creates capabilities only (no feature generation); PM lands on Capability Canvas, not Feature Canvas. `#tab-ra` sits between `#tab-mm` and `#tab-mi` in the tab row (pre-Capability-Canvas), reflecting this.
- **Entry:** `raEnterFromDiscoveryMap()` — resumes the most recent Draft conversation or creates a new one, called from Discovery Map only
- **Left panel (conversation list, unchanged mechanics):** `raRenderConvList()` (sorts by `updatedAt` descending, all filter-chip states), `raNewConversation()`, `raOpenConversation()`, `raRenameConversation()`
- **Chat:** `raRunOpeningTurn()` (Pass 1/Pass 2 branch via `buildRequirementAgentDMOpeningPrompt()`, see `prompts.js`), `raSendMessage()`/`_raRunTurn()` (via `buildRequirementAgentTurnPrompt()`)
- **Live Draft parsing:** `_raParseTouchedCapabilities()` — capability-level `(existing)`/`(will be created)` exact-copy tagging, the only source of truth for `conv.touchedCapabilityKeys`. `_raParseFeatureNarratives()` — extends the same convention to per-feature `(new feature)`/`(existing feature): narrative` tagging under `## Recommended Features`. `_raGetCapabilityBriefExcerpt()`/`_raExtractSection()` — targeted per-capability extraction (name + narrative + objectives), used by `buildRAFeatureGenPrompt()` (CC's "Generate Features" CTA) and `scBuildStoryPrompt()` (feature-canvas.js), never the full `liveDraftMd` blob.
- **Live Draft render:** `raRenderLiveDraft()`, `_raEnhanceLiveDraftDom()` — post-processes the rendered markdown DOM into NEW/EXISTING pills (capability level) and inline `(new)` suffix + click-to-expand narrative (feature level)
- **Finalize (atomic, capabilities only):** `raRunFinalizeSequence()` — resolves open questions -> creates capStore entries for `isNew:true` touched capabilities (mirrors `ccDoAddCap()`) -> calls `ra_next_seq()` -> stamps `intakeBriefId`/`rqNumber` onto every created capability -> populates `conv.createdCapabilityKeys` -> persists (live-sync `capabilities_generated` event) -> `switchTab('cc')` + `ccSelectFirstPopulatedMetric()` (capability-canvas.js). Feature generation is explicitly NOT part of Finalize — it remains CC's manual, per-capability "Generate Features" action, grounded in the brief when `intakeBriefId` is non-null.
- **Data shape (`snapshot.raConversations[]`):** adds `createdCapabilityKeys[]` (new). `capStore` capability entries gain `intakeBriefId`/`rqNumber` (forward-only, `null`/`undefined` for anything predating this build).
- **Origin filter integration:** Capability Canvas and Feature Canvas nest a "Requirement Agent" value + per-RQ sub-list into their existing Origin filter (`ccToggleOriginRaParent()`/`ccToggleOriginRaChild()` in `capability-canvas.js`, `fcToggleOriginRaParent()`/`fcToggleOriginRaChild()` in `feature-canvas.js`) — genuinely new tri-state parent/child checkbox logic, no prior precedent in this codebase. Story Canvas and Release Canvas (user-facing label; internal code/ids remain `pi`-prefixed — label-only rename) (neither has an Origin filter to nest under) get a standalone flat "Brief" filter instead (`_newScBriefFilterHtml()` in `story-canvas-new.js`, `_piBriefFilterBtnHtml()` in `pi-planning.js`) — a deliberate, accepted divergence from CC/FC's nested shape, not an inconsistency to fix later.

`scripts/pi-planning.js` — Release Canvas (user-facing label; internal code/ids remain `pi`-prefixed — label-only rename) tab. Receives stories from Story Canvas via `scPushStoriesToPI()`.
- **Tab lifecycle:** `piOnTabEnter()`
- **Staleness detection:** `piCheckStaleness()`, `piComputeHash()`, `piShowStaleBanner()`, `piHideStaleBanner()` (`piSyncNewStories()` still exists in the file but has zero call sites — confirmed dead code during v9.08's build, not wired into any execution path; do not assume it runs on tab entry)
- **Left panel:** `piRenderLeftPanel()`, `piRenderSquadRows()`, `piGetSquads()`, `piCalcCapacity()`, `piAddSquad()`, `piRemoveSquad()`, `piUpdateSquad()`, `piToggleLeftPanel()`
- **Previous PI upload:** confirmed removed/decommissioned during v9.08's build — `piHandlePrevPIFile()`/`piParsePrevPI()` do not exist anywhere in the codebase (zero grep matches); this line previously listed them incorrectly
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

`scripts/readiness-canvas.js` (`styles/24-readiness-canvas.css`) — Adoption Readiness (v9.22). In-app flow letting a PM prepare a completed Release Plan for launch. A real top-nav tab (id `'arp'`, immediately after Release Canvas), content container `#rc-canvas`/`.arp-tab`, toggled via the same `.on`-class convention every other tab uses (`switchTab()` in api.js). Still only ever CREATED from Release Canvas's kebab menu (`piPlanMenuHtml()`, pi-planning.js) — only VIEWING is a tab now.
- **Data model:** `piReadinessPlans[]` (state.js, persisted) — one entry per Release Plan that has an Adoption Readiness plan, `{id,releasePlanId,releasePlanName,status,changeOverview,releaseScope,impactGroups,readinessActions,recommendation,lineageSources,createdAt,finalizedAt,staleFlag}`. `lineageSources` uses name-string references (requirementName/stage/capability/feature), matching the app's existing `f.cap`/`f.stage`/`f.metric` convention — not IDs.
- **Entry:** `rcNavigateToPlan(releasePlanId)` (creates the plan on first entry via `rcCreatePlan()` if needed, else resumes, then `switchTab('arp')`). `rcOnTabEnter()` is the tab's own entry point (called by `switchTab('arp')`) — renders the active plan, or `rcRenderEmpty()` if the tab was entered directly with no active Release Plan / no readinessPlan for it yet. Tab reveal via `rcRevealTab()` (adds `.revealed` to `#tab-arp`), mirrored in `applyFeats()` (left-panel.js), `_ssRevealTabs()` (session-store.js), and `homeClearSession()`'s reset list (home.js).
- **Screen flow:** `rcRenderSection1()`..`rcRenderSection6()`, `rcGoTo(n)`. Section 1 (Change Overview) and Section 5 (reasoning/conditionsToClear) are synthesized deterministically in this build (not a live AI call — a documented scope decision, see CHANGELOG); every AI-attributed field remains hover-to-edit exactly the same.
- **Hover-to-edit:** `.ra-field-pencil`/`.ra-field-wrap` — standardized on `sc-card-pencil`'s pure-CSS hover approach (NOT `op-nsm-pencil`'s mouseenter/mouseleave), reused by `rcFieldHtml()`/`rcEditField()`/`rcSaveField()` uniformly across all 6 sections.
- **Launch Recommendation gate:** `rcComputeRecommendation()` — pure deterministic function (Hold/Conditional/Ready), structurally the same "engine decides, AI narrates" split as `piEscalate`/`piDetectCycles`.
- **Finalize/reopen:** `rcFinalize()` (sets `status:'finalized'`, sets the one-way session flag `opUnlocked=true` on first-ever finalize), `rcReopenForEdit()`.
- **Regeneration effect:** `rcApplyRegenerationEffect(plan,newPiPlan)` — called from `pi-planning.js`'s `piGenerate()` right after an in-place regenerate completes; unfreezes the plan, sets `staleFlag`, recomputes only the Release-Plan-derived fields (`releaseScope`, `lineageSources`), never touches PM-edited `changeOverview` text.
- **Kebab-menu modals:** `rcShowReleaseCompleteModal()` (§2.3, fires on the sprint-planning incomplete→complete transition), `rcShowPostRegenModal()` (§2.5), `rcShowRegenReadinessWarningModal()` (§2.4 conditional Regenerate copy) — all DESIGN_SYSTEM.md §8 full modal anatomy (trapFocus, capture-phase Escape, x at top:12/right:12).
- **Lineage drawer:** `rcOpenLineageDrawer()`/`rcCloseLineageDrawer()` — nests INSIDE `#rc-canvas`, reuses the app's existing 440px right-drawer width convention (distinct from the full-frame readiness canvas itself).
- **Feature Canvas hypothesis carry-forward (§4):** `rcApplyHypothesisCarryForward(featureName,hyp)` — called from both `normalizeAIHypothesis()` call sites in `capability-canvas.js`; overwrites `primary.baseline` from Outcome Pulse's most recently logged actual for a feature of that name if one exists, else stamps `primary._rcNoPriorOutcomeWarning=true`, rendered as a soft amber badge by `feature-canvas.js`'s `scBuildOutcomeHypChipHTML()`.
- **Minimal Release Plan freeze:** `piIsPlanFrozenByReadiness(plan)` (pi-planning.js) — gates `piDrop()`/`piSavePoints()` while the plan's Readiness Plan is finalized; Regenerate remains the explicit unfreeze path. Not yet extended to every sprint-board mutator (see CHANGELOG/build report).

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

`scripts/prototype-canvas.js` — Prototype Canvas module (v8.79). Owns the Prototype view inside Story Canvas when newScProtoView===true. Access variant fields via pcGetActiveVariant(featId). **v9.08.02:** this entire file had no `canEditSession()` awareness until this pass — `pcGenerate()` (the single choke-point for all 5 Generate/Regenerate render sites), `pcHandleScreenshotUpload()`, `pcRemoveScreenshot()`, and `pcAddGapToContext()` are now gated, plus the corresponding visual hide/disable at each render site (empty-state upload zone + generate button, stale/partial banner regenerate buttons, wireframe-unavailable regenerate button, refine bar).
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

`scripts/export-pi-docx.js` — `buildAndDownloadPIDocx()` — Release Canvas (user-facing label; internal code/ids remain `pi`-prefixed — label-only rename) DOCX download (called by `piExportDocx()`)

`scripts/api.js` — `switchTab()`, `revealAndSwitchTab()`, `callAPI()`, `parseJSON()`, `isValidTree()`, `showLoad()`, `hideLoad()`. `switchTab()` manages all 6 tabs (mm, cc, pi, mi, la, sc): tab button active states, content area show/hide, left-panel visibility, tab entry hooks (`ccOnTabEnter`, `piOnTabEnter`, `miRenderEmpty`/`miRenderScreen`, `laRenderAnalysis`, `scRenderCapNav`/`scRenderCanvas`). `callAPI()` routes to `/api/anthropic` proxy on Netlify, falls back to direct Anthropic call locally. Model string reads from `appSettings.model` with fallback to `claude-sonnet-4-6`. **Generation lock:** `withGenerationLock(fn)` — wraps a caller's ENTIRE generate→parse→apply→save workflow, not just `callAPI()` (a narrower scope releases the lock before a caller's own `sessionStoreSave()` runs). Skips locking entirely for private sessions. `_acquireGenerationLock()`/`_releaseGenerationLock()` — thin wrappers around the `acquire_generation_lock`/`release_generation_lock` Postgres RPCs (`current_app_user()`-based, defined on `mt_sessions`). `_startLockHeartbeat()` — single-flight (not raw `setInterval`) refresh loop, ~22s interval, waits for any in-flight tick before allowing release to proceed (closes a ghost-lock race). `_localGenerationLocks` (Set) — same-tab/same-browser duplicate-generation guard, claimed synchronously before the async DB acquire call starts (claiming it only after the acquire resolves reopens the same race). `_GENERATION_LOCK_HANDLE_BRAND`/`_assertGenerationLockHandle()` — a branded lock-handle marker so an inner "requires a real lock handle" function (see `capability-canvas.js`'s `ccGenerateFeaturesForCap`/`_ccGenerateFeaturesForCapInner_REQUIRES_LOCK_HANDLE` pair) can't be silently bypassed by a future caller passing a bogus object — vanilla JS has no enforced module privacy, so this turns an accidental unlocked call into a loud, immediate error. Callers use `lock.throwIfLost()` checkpoints immediately before any save, not just after their whole workflow returns (a post-hoc-only check is too late if the save already ran). Explicitly deferred: server-side lock enforcement, live re-fetch of `is_shared` pre-acquire, operation-token-based locking, `acquire_generation_lock()`'s own access-check/update non-atomicity. **v9.08:** `acquire_generation_lock()` now also checks `share_mode` server-side (rejects a view-only collaborator's acquire attempt with `reason: 'no_access'`, distinct from `reason: 'held'`) — `withGenerationLock()`'s rejection branch has a dedicated toast for this case. `release_generation_lock()` now also clears `active_user_name` on release (previously left stale, a ghost-holder display bug found during v9.08's adversarial review).

`scripts/demo-data.js` — DEMO MODE ONLY. `loadDemoData()`, `clearDemoMode()`. Do NOT open for any other task.

`scripts/main.js` — DOMContentLoaded init

`scripts/diagnostic-view.js` — `dvCreate()`, `dvDeepCloneTree()`, `dvMergeEvidenceOnRegen()`, `dvRenderView()`, `dvRenderLeftPanel()`, `dvRenderTreeArea()`, `dvOpenEvidenceDrawer()`, `dvCloseEvidenceDrawer()`, `dvSaveEvidence()`, `dvClearEvidence()`, `dvCalcEvidenceStrength()`, `dvCalcReadiness()`, `dvFlattenMetrics()`, `dvFindMetricById()`, `dvAnalyze()`, `dvShowNoEvidenceWarning()`

`scripts/product-leak-analysis.js` — `laRenderAnalysis()`, `laRenderSummaryCards()`, `laRenderTable()`, `laRefreshTable()`, `laToggleExperiment()`, `laOpenDetailPanel()`, `laOpenSummaryDetail()`, `laCloseDetailPanel()`, `laRenderFilterPopover()`, `laToggleFilterPopover()`, `laRenderColPopover()`, `laToggleColPopover()`, `laSendToStoryCanvas()`, `laShowSentConfirmation()`, `laDownloadDocx()`, `laFindCanvasCardForExperiment()` (v9.11 — reverse lookup from an experiment to its Feature Canvas card, used by Experiment Library's live status chips)

`scripts/export-diagnostic-docx.js` — `laDownloadDocx()`, `buildDiagnosticDocxHTML()`

`scripts/market-intelligence.js` — `miGenerate()`, `miRenderScreen()`, `miRenderLeftPanel()`, `miRenderMarketSnapshot()`, `miRenderTrends()`, `miRenderCompetitors()`, `miRenderSWOT()`, `miRenderCapabilities()`, `miRefreshCapSection()`, `miToggleCapSelect()`, `miSendToCC()`, `miRemoveFromCC()`, `miFlattenMetrics()`, `miResolveCanvasRoute()`, `miToggleExportDrop()`, `miExportCurrentView()`, `miExportFullReport()`, `miRenderEmpty()`, `miShowToast()`. (Corrected v9.08 — this line previously listed several functions with names that don't exist anywhere in the current file: `miAlignCapabilities`, `miGenerateFeatures`, `miSendToCanvas`, `miSendCapDirectly`, `miUndoSend`, `miLoadFeatures`, `miToggleFeature`, `miRegenerateFeatures`. Confirmed via full-file function listing before writing this correction.)

`scripts/outcome-pulse.js` — Outcome Pulse tab (v9.10, Outcome Verification Loop feature; extended v9.11, Outcome Pulse Iteration Loop; patched v9.11.01, v9.11.02, v9.11.03, v9.11.04, v9.11.05). Entry: `opRender()` (called from `switchTab('op')`). v9.11 additions: `opGetTrackedMetrics()`, `opSetMetricFilter()`, `opCountPulseExperimentsForMetric()`, `opToggleRowMenu()` (3-dot menu replacing the old "Log Result" text link), `opOpenSuggestExperimentModal()` and its supporting `_opRunSuggestExperiment()`/`_opAcceptSuggestedExperiment()` (Suggest Experiment modal), `opOpenExperimentLibrary()`/`opCloseExperimentLibrary()`/`_opRenderExperimentLibrary()` (Experiment Library read-only panel). v9.11.01 addition: `_opNavigateToExperimentCanvasDetail()` — shared navigation helper used by both the Suggest Experiment accept handler and Experiment Library's (now clickable) cards. v9.11.02: synthesized runs now also carry `originFeatureCap`/`originFeatureStage`, captured from the real originating feature at generation time — consumed by `product-leak-analysis.js`'s `laSendToStoryCanvas()` to place the resulting Feature Canvas card under its real hierarchy instead of a synthetic one. v9.11.03: synthesized runs additionally carry `originFeatureMetric`/`originHypothesisActual`/`originHypothesisBaseline`/`originHypothesisTarget` (correct grouping + baseline/target inheritance); `opToggleRowMenu()` now disables "Suggest Experiment" with an explanatory tooltip for any experiment-derived (`origin==='diagnostic'`) card; the experiment-count badge in `opBuildStageLedgerHTML()` is hidden for the same population. v9.11.04: synthesized runs additionally carry `originHypothesisMetric` (the original feature's own, deliberately-more-granular hypothesis metric label, distinct from `originFeatureMetric`'s KPI-tree grouping string) — the new sibling's own hypothesis now inherits this correctly; `opSaveHypothesisModal()` falls back to the already-computed suggested signal when no pill is explicitly clicked; Experiment Library now tracks the specific opening feature id (`_opLibraryFeatureId`) alongside its metric, so the empty-state "Suggest Experiment" CTA gate resolves the correct sibling's origin rather than an ambiguous metric-only lookup. v9.11.05: Library's empty state now centers correctly and suppresses its redundant heading; `_opSuggestLoadingHTML()` and `_opRunSuggestExperiment()` now rotate through `OP_SUGGEST_LOADING_MESSAGES` via a `setInterval` cleared in a `finally` block, mirroring `capability-drawer.js`'s own loader cleanup pattern.
- **NSM card:** `opBuildNSMCardHTML()`, `opAttachNSMHoverHandlers()`, `opOpenNSMEditOverlay()`/`opCloseNSMEditOverlay()`/`opSaveNSMEdit()` — overlay pinned via `position:absolute;inset:0` relative to `#op-nsm-wrap`, never resizes the card or its neighbor. Baseline/target lock after first save (both non-null); only `actual` stays editable thereafter. Live-sync: uses the **existing** `mm`-canvas wholesale-apply/confirm-gate mechanism — no new event type built (confirmed decision, see below).
- **Hypothesis Health card:** `opBuildHypHealthCardHTML()` — consumes `computeHypothesisAggregates()` (feature-canvas.js), never computes its own counts.
- **Outcome Breakdown:** `opRenderBreakdown()`, `opBuildStageGroups()` (derives stage rows from the **live** `gData.stages` array — never hard-coded to Acquisition/Activation/Engagement/Retention, since stage sets vary by industry/framework routing and are user-renameable; includes an "Unmapped" bucket), `opToggleStage()`, `opSetSignalFilter()` (single dropdown, signal-status only — no separate stage filter, since stage is already the row grouping), `opBuildStageLedgerHTML()`, `opBuildSignalBadgeHTML()`.
- **Unified hypothesis modal:** `opOpenHypothesisModal()` — single entry point via "Log result," reached from every ledger row regardless of state. `opSetModalSignal()`, `opRecomputeModalSuggestion()`, `opSaveHypothesisModal()`. Signal pills (Aligned/Opposed/No change/Not applicable) are user-selectable with no numeric-actual gate — `computeSuggestedSignal()` only ever populates an advisory "Suggests: X" hint, never forces a value or disables a pill.
- **PDF export:** `opDownloadReport()`, `_opLoadHtml2Canvas()`, `_opLoadJsPDF()` — new mechanism, no prior precedent in this codebase (every other export produces a structured document, not a rendered-screen capture). Reuses the same lazy-CDN-load convention as `prototype-canvas.js`'s `_pcLoadHtml2Canvas()`. Paginates by slicing the captured canvas into page-height chunks — required since Outcome Breakdown can expand to arbitrary height with multiple stage rows open.
- **Known limitation, by explicit decision, not oversight:** bulk-uploaded features (`scConfirmFeatUpload()` in feature-canvas.js) never carry an `outcomeHypothesis` — deferred to a future release. A PM wanting hypothesis on a bulk-uploaded feature uses a follow-up manual Edit Feature pass.
- **Known limitation, by explicit decision:** NSM edits ride on the existing `mm`-canvas wholesale-sync mechanism rather than a dedicated event type — simpler, reuses a proven path, at the cost of coarser-grained conflict resolution than a per-field sync would offer.



`scripts/export-market-intel-docx.js` — `miBuildDocx()`

`scripts/guided-launch.js` — Guided Launch tab (gl), v9.15, unified onto `mt_sessions` in v9.15.02. Conversational intake flow, second Home entry path alongside Quick Launch. A Guided Launch session IS a real `mt_sessions` row from creation — no separate table.
- **Entry points:** `glCreateAndOpen(sessionContext)` (called from `home.js`'s `homeGuidedLaunch()`) — calls `sessionStoreCreate(sc, {lastTab:'gl', lastStage:'Guided Launch', intakeStatus:'active'})`, sets `sessionActive=true`. `glApplyRestoredSnapshot(meta, snapshot)` (called from `session-store.js`'s `sessionStoreRestore()` whenever `meta.intakeStatus` is set, independent of which tab is landed on) — populates `gl*` state from the restored snapshot and renders; does not navigate, the caller's existing `switchTab(targetTab)` already has. There is no separate resume function — every resume is the same `sessionStoreRestore()` path every session uses.
- **State reset:** `glResetState()` — called from `home.js`'s `homeClearSession()` on every session transition.
- **Shell/render:** `glRenderShell()` (left-panel content via `home.js`'s shared `_mmBuildSessionSummaryHtml()`), `glRenderChatHistory()`, `glRenderMdBody()`, `glUpdateFooterState()`, `glOpenPanel()`/`glCollapsePanel()`, `glTogglePanel()` (left panel, mirrors `left-panel.js`'s `togglePanel()`)
- **Chat:** `glSendMessage()`, `glHandleUpload()` (reuses `utils.js`'s `extractTextFromFile()`), `_glRunRevisionTurn()`, `glRunOpeningTurn()` — persistence via `_glPersistMessage()`/`_glPersistDraft()`, both now thin wrappers around `sessionStoreSave(_activeSessionId)`. All AI calls route through `callAPI()`'s `extraFields` param (`session_type:'ChatCanvas'`) and `resolveModelDecision()`'s Optimized chain, not a hardcoded model.
- **Finalize:** `glFinalize()` — one-way `active`→`completed`; calls `sessionStoreSetIntakeStatus()` then `sessionStoreSave()` (updates the existing row, does not create a second one); hands off to the existing Discovery Map pipeline via `sessionContext.additionalContext` (no changes to `kpi-tree.js`/`prompts.js`'s generation prompts).
- **Prompts:** `buildGuidedLaunchOpeningPrompt()`, `buildGuidedLaunchTurnPrompt()` (both in `prompts.js`)
- **Data model:** `mt_sessions.intake_status` (`'active'|'completed'|null`); `snapshot.glMessages`/`glDraftMd`/`glFinalMd`/`glContextHash` (see `session-store.js`'s `_sessionStoreBuildSnapshot()`). `mt_intake_sessions`/`mt_intake_messages` are dropped — do not reference them.
- **Session-store additions (shared, additive-only):** `sessionStoreCreate(sc, opts)` — optional `{lastTab, lastStage, intakeStatus}`; `sessionStoreSetIntakeStatus(sessionId, status)` — new, local-cache-only meta flip for `glFinalize()`; `_ssComputeLastStage()` checks live `glStatus` first; `_ssSyncTabVisibility(s, meta)`/`_ssRevealTabs(s, meta)` gained an optional `meta` param, `tab-gl` revealed whenever `meta.intakeStatus` is set (active or completed). Three independent DB-row→meta mapping sites needed the same `intakeStatus`/`intake_status` field added: `sessionStoreSyncFromDB()` (session-store.js), `_lsResumePreFetch()` and `_lsMergeHomeMetaEntry()`/`_lsHomeRunOnePollCycle()`'s explicit column list (both live-sync.js).

`scripts/requirement-agent.js` — Requirement Agent tab (ra), v9.16. Global, MULTI-conversation release-requirements agent, distinct from `guided-launch.js` — one conversation = one release scope, symmetric across every capability it touches from turn one. **Naming collision flagged, unresolved:** the tab button text "Requirement Agent" was already claimed by a prior v9.16 commit that renamed the pre-existing Guided Launch tab's copy only (mechanism unchanged) — this file's tab button is labeled "Requirement Agent (Release)" (`#tab-ra`) to disambiguate until a human decides whether to rename one or merge the two features.
- **Reset/resume:** `raResetState()` (called from `home.js`'s `homeClearSession()`), `raApplyRestoredSnapshot(snapshot)` (called from `session-store.js`'s `sessionStoreRestore()`, independent of `targetTab`, same pattern as `glApplyRestoredSnapshot()`), `raOnTabEnter()` (called from `api.js`'s `switchTab()`).
- **Entry from Capability Canvas:** `raDefineRequirements()` — resumes the most recent Draft conversation (by `updatedAt`) or creates a new one, then `switchTab('ra')`. Called from `capability-canvas.js`'s `_ccActionBarHtml()` RA-on CTA.
- **Conversation list (left panel):** `raRenderConvList()`, `raSetFilter()` (All/Draft/Finalized chips, view-scoped, not persisted), `raNewConversation()`, `raOpenConversation()`, `raRenameConversation()`/`raSaveRename()`.
- **Chat (center panel):** reuses `guided-launch.js`'s `.gl-msg-row`/`.gl-avatar`/`.gl-bubble`/`_glFormatChatText()` primitives verbatim. `raSendMessage()`, `raRunOpeningTurn()`, `_raRunTurn()`.
- **Live Draft (right panel):** `raRenderLiveDraft()` — "Capabilities Touched" tags each capability "(existing)" or "(will be created)" (exact copy, never "new"); Finalize footer is the exact one-line copy the spec requires.
- **Finalize:** `raFinalizeClick()` — no unresolved open questions -> `raRunFinalizeSequence()` directly; unresolved -> `raShowAssumptionModal()` (Type-1 Warn modal per `DESIGN_SYSTEM.md` §8). `raReviewQuestions()` (jump-to/highlight the first unresolved question's chat bubble), `raFinalizeWithAssumptions()` (resolves + logs `**Assumed:**` lines in `liveDraftMd`, persisted, not transient). `raRunFinalizeSequence(conv, withAssumptions)` — the atomic sequence: resolve/create capStore entries for `isNew` capabilities (mirrors `capability-canvas.js`'s `ccDoAddCap()` bucket pattern exactly, capStore-write + `_piStage` lookup in the SAME conditional, per the documented v9.05 split-brain bug this deliberately does not reintroduce) -> calls `ra_next_seq` RPC (via `api.js`'s `_pgtRpc()`) BEFORE generation completes -> generates features per touched capability via `buildRAFeatureGenPrompt()` -> tags every feature `intakeBriefId`/`rqNumber` -> saves per `AI_EDITING_RULES.md`'s live-sync contract (session id captured before async work, save before emit) -> `switchTab('fc')`.
- **Prompts:** `buildRequirementAgentOpeningPrompt()`, `buildRequirementAgentTurnPrompt()`, `buildRAFeatureGenPrompt()` (all in `prompts.js`).
- **Data model:** `snapshot.raEnabled` (boolean, Capability Canvas toggle), `snapshot.raConversations[]`, `snapshot.raLastOpenConversationId` (see `session-store.js`'s `_sessionStoreBuildSnapshot()`/`_ssApplySnapshotFields()`). `mt_sessions.ra_seq_counter` (real integer column, NOT in snapshot) + `ra_next_seq(p_session_id)` RPC — see `sql/ra-requirement-agent.sql` (NOT run against Supabase by this build; Nethaji runs it on his own timeline, per `AI_EDITING_RULES.md`'s "no destructive/unrequested DB actions" convention already applied to every other `.sql` file referenced in this document).
- **Tab reveal:** `tab-ra` uses the `.revealed` class mechanism (content-truthiness: `raConversations.length>0`), same family as `tab-sc`/`tab-pi` — see `session-store.js`'s `_ssRevealTabs()`.
- **Capability Canvas RA-on/off gating (in `capability-canvas.js`, not this file):** `_ccRaOn()`, `ccRaToggleHTML()`/`ccToggleRaEnabled()` (toolbar switch), `_ccActionBarHtml()` (single "Define Requirements" CTA when on, today's bulk-selection bar when off — **deviation flagged:** the spec's RA-OFF requirement to remove `cc-action-bar`/`ccSelectedCapIds`/`ccToggleCapSelect()`/`ccToggleSelectAll()`/`ccGenerateFeaturesForSelected()` ENTIRELY, permanently, was not done — see this build's report; today's selection mechanism is left intact and only visually suppressed when RA is on).

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
| SC story generation prompt | `scripts/feature-canvas.js` (scBuildStoryPrompt — the ONLY story-generation function; grounds in the intake brief as primary source when a feature's `intakeBriefId` is non-null, feature name/why as secondary, per Requirement Agent redesign §10) |
| SC story editing (title, statement, AC) | `scripts/feature-canvas.js` (scEditStoryTitle, scEditStoryStmt, scEditStoryAC) |
| SC metric linking | `scripts/feature-canvas.js` (scShowLinkMetricModal, scConfirmLinkMetric) |
| SC PI selection checkboxes, "Send to PI →" | `scripts/feature-canvas.js` (scTogglePiStory, scPanelSendToPI) |
| SC push nudge, scPushStoriesToPI | `scripts/feature-canvas.js` (scPushStoriesToPI, scDismissPushNudge) |
| SC feature CRUD (add / edit / remove) | `scripts/feature-canvas.js` (scShowAddFeatureModal, scDoAddFeat, scShowEditFeatModal, scDoEditFeat) |
| FC "Add Feature" dropdown + upload/map (v7.84) | `scripts/feature-canvas.js` (scToggleAddFeatDrop, scShowUploadFeatModal, scShowFeatReviewModal, scConfirmFeatUpload) |
| SC batch modal | `scripts/feature-canvas.js` (scShowBatchModal, scModalProceed) |
| SC export DOCX | `scripts/export-docx.js` (scDownloadStoriesDOCX, scBuildDOCX) |
| SC PI planned badges | `scripts/feature-canvas.js` (scApplyPIPlannedBadges, scClearPIPlannedBadges) |
| **Release Canvas (user-facing label; internal code/ids remain `pi`-prefixed — label-only rename)** | |
| PI layout, board, squads, sprint config | `scripts/pi-planning.js`, `styles/14-pi-planning.css` |
| PI tab entry | `scripts/pi-planning.js` (piOnTabEnter) |
| PI generation (sprint assignment) | `scripts/pi-planning.js` (piGenerate), `scripts/prompts.js` (buildPIGeneratePrompt) |
| PI stale banner | `scripts/pi-planning.js` (piCheckStaleness, piShowStaleBanner) |
| PI drag-and-drop, capacity | `scripts/pi-planning.js` (piDragStart, piDrop, piCheckCapacity) |
| PI right story panel | `scripts/pi-planning.js` (piOpenRightPanel, piRenderRightPanel) |
| PI backlog panel | `scripts/pi-planning.js` (piOpenBacklogPanel, piMoveBacklogToSprint) |
| PI dependencies | `scripts/pi-planning.js` (piShowAddDepForm, piLinkDep, piRemoveDep) |
| PI left panel toggle | `scripts/pi-planning.js` (piToggleLeftPanel) |
| PI export DOCX | `scripts/pi-planning.js` (piExportDocx), `scripts/export-pi-docx.js` (buildAndDownloadPIDocx) |
| (Previous PI upload feature fully decommissioned — do not reference) | — |
| **Adoption Readiness (v9.21)** | |
| Readiness Plan kebab menu item, enable/disable state | `scripts/pi-planning.js` (piPlanMenuHtml, piOpenReadinessPlan, piPlanSprintComplete) |
| Adoption Readiness screen flow, data model, lineage drawer | `scripts/readiness-canvas.js`, `styles/24-readiness-canvas.css` |
| Adoption Readiness tab entry | `scripts/readiness-canvas.js` (rcNavigateToPlan, rcOnTabEnter, rcRenderEmpty), `scripts/api.js` (switchTab 'arp' branch) |
| Release Plan Complete / Release Plan Updated / Regenerate-warning modals | `scripts/readiness-canvas.js` (rcShowReleaseCompleteModal, rcShowPostRegenModal, rcShowRegenReadinessWarningModal) |
| Adoption Readiness Finalize / reopen / regeneration effect | `scripts/readiness-canvas.js` (rcFinalize, rcReopenForEdit, rcApplyRegenerationEffect) |
| Adoption Readiness data model, session flags | `scripts/state.js` (piReadinessPlans, rcActivePlanId, rcActiveSection, opUnlocked), `scripts/session-store.js` (_sessionStoreBuildSnapshot, sessionStoreRestore) |
| Feature Canvas hypothesis carry-forward, soft warning badge | `scripts/readiness-canvas.js` (rcApplyHypothesisCarryForward), `scripts/capability-canvas.js` (both normalizeAIHypothesis call sites), `scripts/feature-canvas.js` (scBuildOutcomeHypChipHTML) |
| **Diagnostic View** | |
| Create diagnostic view CTA, bottom action bar | `scripts/kpi-tree.js`, `styles/11-diagnostic-view.css` |
| Diagnostic view layout, left panel, readiness | `scripts/diagnostic-view.js`, `styles/11-diagnostic-view.css` |
| Evidence drawer, evidence fields | `scripts/diagnostic-view.js`, `styles/11-diagnostic-view.css` |
| Evidence strength, readiness calculation | `scripts/diagnostic-view.js` |
| **Product Diagnostics (Leak Analysis)** | |
| Product leak analysis, summary cards, table | `scripts/product-leak-analysis.js`, `styles/12-product-leak-analysis.css` |
| Experiment detail overlay, filter/column popover | `scripts/product-leak-analysis.js`, `styles/12-product-leak-analysis.css` |
| Send to story canvas (from leak analysis) | `scripts/product-leak-analysis.js` |
| Outcome Pulse experiment → Experiment Canvas card, live status lookup | `scripts/product-leak-analysis.js` (`laFindCanvasCardForExperiment()`) |
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
| **Outcome Pulse (Outcome Verification Loop)** | |
| Outcome Pulse tab layout, NSM card, Hypothesis Health card, Outcome Breakdown, unified modal, PDF export | `scripts/outcome-pulse.js`, `styles/21-outcome-pulse.css` |
| Suggest Experiment (Outcome Pulse iteration loop), Experiment Library panel, metric filter, experiment-count badge | `scripts/outcome-pulse.js`, `scripts/prompts.js` (`buildOutcomePulseExperimentPrompt()`), `styles/21-outcome-pulse.css` |
| Outcome Pulse tab entry/render | `scripts/api.js` (switchTab — `opRender()`), `scripts/left-panel.js` (applyFeats — gated on `opUnlocked`, v9.21; replaces the old featOutcomePulse+gData+scCanvas trigger entirely) |
| Outcome Pulse By Stage / By Release toggle | `scripts/outcome-pulse.js` (opBuildReleaseGroups, opSetGroupMode, opGroupMode), `styles/24-readiness-canvas.css` (.op-group-toggle) |
| Outcome Pulse Settings toggle | `scripts/settings-page.js` (spP2, settingsPageSave), `scripts/state.js` (appSettings.featOutcomePulse) |
| outcomeHypothesis shared helpers (clone, compute direction/signal, aggregate, normalize AI response) | `scripts/feature-canvas.js` — top of file, dedicated section above the existing FC state block |
| outcomeHypothesis capture UI (Edit Feature, Add Feature modals) | `scripts/feature-canvas.js` (scBuildOutcomeHypothesisSectionHTML, scShowEditFeatModal, scShowAddFeatureModal, scDoEditFeat, scDoAddFeat) |
| outcomeHypothesis carried into scCanvas | `scripts/feature-canvas.js` (scDoAddFeat, scToggleFeature/scToggleFeatureFromDrawer), `scripts/capability-canvas.js` (ccSendToStoryCanvas) |
| outcomeHypothesis generated by AI | `scripts/prompts.js` (buildCapFeaturesPrompt), `scripts/capability-canvas.js` (both ccGenerateFeaturesForCap call sites — normalizeAIHypothesis) |
| Story generation hypothesis context injection | `scripts/feature-canvas.js` (scBuildStoryPrompt) |
| gData.nsm baseline/target/actual/updatedAt | `scripts/kpi-tree.js` (generateConfirmed's gData=parsed reassignment — preserved across regeneration via _prevNsmTracking snapshot) |
| Outcome Pulse demo data | `scripts/demo-data.js` (_demoAttachOutcomeHypotheses, _demoSetNsmTracking) — do NOT open for any other task |
| **Guided Launch** | |
| Guided Launch tab layout, chat, MD panel, collapse/reopen | `scripts/guided-launch.js`, `styles/22-guided-launch.css` |
| Guided Launch entry / resume / Home banner | `scripts/guided-launch.js` (glCreateAndOpen, glResumeSession, glRenderHomeResumeBanner), `scripts/home.js` (homeGuidedLaunch, homeSessionResume) |
| Guided Launch AI prompts (opening, revision) | `scripts/prompts.js` (buildGuidedLaunchOpeningPrompt, buildGuidedLaunchTurnPrompt) |
| Guided Launch finalize → Discovery Map handoff | `scripts/guided-launch.js` (glFinalize) — feeds `sessionContext.additionalContext`, existing generation pipeline unchanged |
| Guided Launch usage-tracking tag (`session_type:'ChatCanvas'`) | `scripts/api.js` (callAPI extraFields), `proxy/server.js` (mt_ai_usage_events insert) |
| **Requirement Agent (v9.16, global/release-scoped, distinct from Guided Launch above)** | |
| Requirement Agent tab layout, chat, live draft, conversation list | `scripts/requirement-agent.js`, `styles/23-requirement-agent.css` |
| "Define Requirements" CTA / RA toggle in Capability Canvas | `scripts/capability-canvas.js` (_ccRaOn, ccRaToggleHTML, ccToggleRaEnabled, _ccActionBarHtml, ccBuildFeatPanel RA-on branches), `scripts/requirement-agent.js` (raDefineRequirements) |
| Requirement Agent AI prompts (opening, turn, feature-gen-from-brief) | `scripts/prompts.js` (buildRequirementAgentOpeningPrompt, buildRequirementAgentTurnPrompt, buildRAFeatureGenPrompt) |
| Requirement Agent Finalize sequence (capStore creation, feature generation, RQ numbering, save, navigate to Feature Canvas) | `scripts/requirement-agent.js` (raRunFinalizeSequence, raFinalizeClick, raShowAssumptionModal, raFinalizeWithAssumptions) |
| RQ sequence RPC | `sql/ra-requirement-agent.sql` (ra_next_seq), `scripts/api.js` (_pgtRpc) — NOT run against Supabase by this build |
| Feature/story RA provenance fields (`intakeBriefId`, `rqNumber`) | `scripts/requirement-agent.js` (tagging at generation), `scripts/pi-planning.js` (piGetSelectedStories, piGetAllStories) |
| Requirement Agent data model | `scripts/state.js` (raEnabled, raConversations, raLastOpenConversationId), `scripts/session-store.js` (_sessionStoreBuildSnapshot, _ssApplySnapshotFields, _ssRevealTabs tab-ra) |



## Key cross-canvas data flows

| Flow | Source | Function | Destination |
|---|---|---|---|
| Caps → Story Canvas (KPI path) | `capability-canvas.js` | `ccSendToStoryCanvas()` | `scCanvas[]` |
| Caps → Story Canvas (PI-first path) | `capability-canvas.js` | `ccSendToStoryCanvas()` | `scCanvas[]` (origin: 'pi') |
| Stories → Release Canvas (user-facing label; internal code/ids remain `pi`-prefixed — label-only rename) (panel) | `feature-canvas.js` | `scPanelSendToPI()` | `piBacklogStoryIds[]` (global, plan-agnostic) |
| Stories → Release Canvas (user-facing label; internal code/ids remain `pi`-prefixed — label-only rename) (card nudge) | `feature-canvas.js` | `scPushStoriesToPI()` | `piBacklogStoryIds[]` (global, plan-agnostic) |
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
  bucketId: string,           // v9.05, 'pi' stageId entries only — identity of the Custom
                               // Process Area/Metric this capability belongs to (see
                               // pi-bucket.js). metricName is display-only for these entries;
                               // bucketId is authoritative for grouping/lookup. Multiple
                               // capStore entries with different names can share one bucketId.
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

metricKey format: `stageId+'||'+metricName` for KPI-linked entries; `'pi||'+capName` for PI-first entries. **Note (v9.05):** for `pi` stageId entries, the metricKey is derived from the CAPABILITY name (via `ccPIKey()`), not the bucket/process-area name — grouping by process area uses `bucketId`, never the key itself.

---

## CRITICAL: Known resolved defects (do not re-introduce)
- `var(--bg)` is undefined in this token set — resolves to transparent. Never use for dropdown/input backgrounds. Use `#fff` or `var(--card)`.
- `ccRenderPICapView` is the render path for PI caps — NOT `ccRenderMainContent`. Always check which render path is active before proposing PI cap fixes.
- `sc-panel-content` requires `display:flex; flex-direction:column; flex:1` to allow child flex containers to fill height correctly (fixed v6.73).
- `scGenerateStories` must call `scRenderLineage(firstFeat)` to preserve the traceability toggle strip during generation (fixed v6.73).
