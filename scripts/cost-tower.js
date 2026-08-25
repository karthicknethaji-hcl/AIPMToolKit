// ── AI Cost Control Tower (v9.28) ──
// Standalone page (ai-cost-tower.html), own script, not part of the main
// canvas-app boot graph. Reads mt_ai_usage_events/mt_model_pricing via the
// admin-gated mt_ai_cost_events_list() RPC (sql/ai-cost-tower.sql) and
// computes every figure in this file client-side — no server-side
// aggregation RPC per grouping, matching this app's existing convention
// (KPI tree, Capability Canvas) of client-side computation over fetched
// data. Narrative text throughout is deterministic string substitution —
// no LLM call anywhere on these three screens (spec Section 11 item 6).

// ══════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════

var OPPORTUNITY_SMALL_SEGMENT_PCT = 0.4; // spec Section 6.4, Section 11 item 14
var CONFIDENCE_HIGH_MIN = 1000;
var CONFIDENCE_MEDIUM_MIN = 200;
var PRICING_MATCH_LAUNCH_GATE_PCT = 99; // spec Section 5.7, Section 11 item 11

var TIER_ORDER = { economical: 0, balanced: 1, frontier: 2 };
var TIER_LABEL = { economical: 'Economical', balanced: 'Balanced', frontier: 'Frontier' };
var TIER_BELOW = { balanced: 'economical', frontier: 'balanced' }; // no entry for 'economical' — nothing cheaper

// Real values confirmed against resolveModelDecision() (scripts/api.js)
// during build-review — spec Section 5.2, Section 11 item 8.
var SELECTION_RULE_LABELS = {
  optimized_caller_default: 'Optimized (Default)',
  optimized_fallback_default: 'Optimized (Fallback)',
  user_selected_model: 'User-Selected',
  batch_threshold_override: 'Batch Threshold Override',
  explicit_override_unclassified: 'Explicit Override'
};

// ══════════════════════════════════════════════════════════════════════
// Small local utilities (this page does not load utils.js — kept
// self-contained rather than pulling in the full canvas-app helper file)
// ══════════════════════════════════════════════════════════════════════

function actEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function actFmtUSD(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function actFmtUSD0(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Math.round(Number(n)).toLocaleString();
}
function actFmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString();
}
function actFmtTokens(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  n = Number(n);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
function actFmtPct(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(digits === undefined ? 1 : digits) + '%';
}
function actDeltaHtml(pct, higherIsBad) {
  if (pct === null || pct === undefined || isNaN(pct)) return '<span class="act-delta-flat">No prior data</span>';
  var isUp = pct > 0.05, isDown = pct < -0.05;
  var bad = higherIsBad === false ? isDown : isUp;
  var cls = (isUp || isDown) ? (bad ? 'act-delta-up' : 'act-delta-down') : 'act-delta-flat';
  var arrow = isUp ? 'Up' : isDown ? 'Down' : 'Flat';
  return '<span class="' + cls + '">' + arrow + ' ' + Math.abs(pct).toFixed(0) + '%</span>';
}
var _actToastTimer = null;
function actToast(msg, type) {
  var el = document.getElementById('act-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'act-toast';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:200;font-family:var(--font);font-size:12px;font-weight:600;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);transition:opacity .2s;';
    document.body.appendChild(el);
  }
  el.style.background = type === 'error' ? 'var(--red)' : (type === 'success' ? 'var(--green)' : 'var(--navy)');
  el.style.color = '#fff';
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(_actToastTimer);
  _actToastTimer = setTimeout(function () { el.style.opacity = '0'; }, 3200);
}
function _avatarInitialsLocal(displayName) {
  var parts = (displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ══════════════════════════════════════════════════════════════════════
// Bootstrap: auth → company → admin-role gate (Section 5.7's admin gate
// applies to the whole tool here, since mt_ai_cost_events_list() itself
// raises an exception for a non-admin caller — every screen depends on it)
// ══════════════════════════════════════════════════════════════════════

var actCompanyId = null, actCompanyName = '', actCurrentUser = null;

document.addEventListener('DOMContentLoaded', actBoot);

async function actBoot() {
  var vEl = document.getElementById('act-hdr-version');
  if (vEl && typeof APP_VERSION !== 'undefined') vEl.textContent = APP_VERSION;

  actShowGate('Loading…', 'Checking your session…');

  var session = await authGetSession();
  if (!session) { window.location.href = 'login.html'; return; }
  actCurrentUser = await authGetUser();

  try { actCompanyId = localStorage.getItem(_PGT_ACTIVE_COMPANY_KEY) || ''; } catch (e) { actCompanyId = ''; }
  if (!actCompanyId) {
    actShowGate('No Active Company', 'Open Product Studio in another tab and select a company first, then reopen this page.');
    return;
  }

  var client = authInit();
  var membership;
  try {
    var res = await client.from('mt_users_companies')
      .select('role, is_active, mt_companies(name)')
      .eq('user_id', actCurrentUser.id)
      .eq('company_id', actCompanyId)
      .maybeSingle();
    membership = res.data;
  } catch (e) { membership = null; }

  if (!membership || !membership.is_active || membership.role !== 'admin') {
    actShowGate('Admin Access Required', 'The AI Cost Control Tower reports on company-wide AI spend and is available to company admins only.');
    return;
  }

  actCompanyName = (membership.mt_companies && membership.mt_companies.name) || '';
  var logoEl = document.getElementById('act-logo-txt');
  if (logoEl) logoEl.textContent = actCompanyName;
  var sepEl = document.getElementById('act-hdr-sep');
  if (sepEl) sepEl.style.display = actCompanyName ? '' : 'none';
  var avEl = document.getElementById('act-avatar');
  if (avEl) avEl.textContent = _avatarInitialsLocal(actCurrentUser.displayName);
  var anEl = document.getElementById('act-avatar-name');
  if (anEl) anEl.textContent = actCurrentUser.displayName || '';
  var aeEl = document.getElementById('act-avatar-email');
  if (aeEl) aeEl.textContent = actCurrentUser.email || '';

  actHideGate();
  document.getElementById('act-app-shell').style.display = 'flex';

  try {
    await Promise.all([actLoadMainContext(), actLoadBudgetAndAlerts(), actLoadProductNames(), actLoadTeamNames()]);
    actRenderOverview();
    await actSetBreakdownPeriod('this_month');
    actRenderPlan();
  } catch (err) {
    console.error('[Cost Tower] boot render failed:', err);
    actToast('Something went wrong loading cost data. Check the console for details.', 'error');
  }
}

function actShowGate(title, sub) {
  document.getElementById('act-gate-title').textContent = title;
  document.getElementById('act-gate-sub').textContent = sub;
  document.getElementById('act-gate').style.display = 'flex';
}
function actHideGate() { document.getElementById('act-gate').style.display = 'none'; }

function actAvatarToggle() {
  var drop = document.getElementById('act-avatar-drop');
  var overlay = document.getElementById('act-avatar-overlay');
  if (!drop) return;
  var isOpen = drop.classList.contains('open');
  drop.classList.toggle('open', !isOpen);
  overlay.classList.toggle('open', !isOpen);
}
function actAvatarClose() {
  var drop = document.getElementById('act-avatar-drop');
  var overlay = document.getElementById('act-avatar-overlay');
  if (drop) drop.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

// ══════════════════════════════════════════════════════════════════════
// Tab switching
// ══════════════════════════════════════════════════════════════════════

var ACT_SCREEN_NAMES = { overview: 'Overview', cost: 'Cost Breakdown', plan: 'Planning & Optimization' };
function actShowScreen(name) {
  document.querySelectorAll('.act-screen').forEach(function (s) { s.classList.remove('on'); });
  var scr = document.getElementById('act-scr-' + name);
  if (scr) scr.classList.add('on');
  document.querySelectorAll('.act-tab-row .act-tab-btn').forEach(function (b) { b.classList.remove('active'); });
  var btn = document.getElementById('act-tab-' + name);
  if (btn) btn.classList.add('active');
  var nameEl = document.getElementById('act-screen-name');
  if (nameEl) nameEl.textContent = 'AI Cost Control Tower · ' + (ACT_SCREEN_NAMES[name] || '');
  var scroller = document.querySelector('.act-content-scroll');
  if (scroller) scroller.scrollTop = 0;
}
function actGoToBreakdown(group) {
  actShowScreen('cost');
  actSelectGroup(group);
  setTimeout(function () { actScrollToSection('act-main-breakdown'); }, 30);
}
function actScrollToSection(id) {
  var container = document.querySelector('.act-content-scroll');
  var target = document.getElementById(id);
  if (!container || !target) return;
  container.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' });
}
function actToggleMenu(id) {
  document.querySelectorAll('.act-dropdown-chip-menu').forEach(function (m) { if (m.id !== id) m.classList.remove('open'); });
  var m = document.getElementById(id);
  if (m) m.classList.toggle('open');
}
document.addEventListener('click', function (ev) {
  if (!ev.target.closest || !ev.target.closest('.act-dropdown-chip-wrap')) {
    document.querySelectorAll('.act-dropdown-chip-menu').forEach(function (m) { m.classList.remove('open'); });
  }
});

// ══════════════════════════════════════════════════════════════════════
// Data layer — period math, fetch (memoized), aggregation primitives
// ══════════════════════════════════════════════════════════════════════

function actMonthRange(offsetMonths) {
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1, 0, 0, 0, 0);
  var end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 1, 0, 0, 0, 0);
  return { start: start, end: end };
}
function actPriorPeriod(start, end) {
  var len = end.getTime() - start.getTime();
  return { start: new Date(start.getTime() - len), end: new Date(start.getTime()) };
}

var _actRowCache = {};
async function actFetchRows(start, end) {
  var key = start.toISOString() + '|' + end.toISOString();
  if (_actRowCache[key]) return _actRowCache[key];
  var client = authInit();
  var result = await client.rpc('mt_ai_cost_events_list', {
    p_company_id: actCompanyId,
    p_period_start: start.toISOString(),
    p_period_end: end.toISOString()
  });
  if (result.error) {
    console.error('[Cost Tower] mt_ai_cost_events_list failed:', result.error.message);
    actToast('Could not load cost data for this period.', 'error');
    return [];
  }
  _actRowCache[key] = result.data || [];
  return _actRowCache[key];
}

var actMain = { rows: [], prevRows: [], start: null, end: null, now: null };
async function actLoadMainContext() {
  var thisMonth = actMonthRange(0);
  var lastMonth = actMonthRange(-1);
  var rows = await actFetchRows(thisMonth.start, thisMonth.end);
  var prevRows = await actFetchRows(lastMonth.start, lastMonth.end);
  actMain = { rows: rows, prevRows: prevRows, start: thisMonth.start, end: thisMonth.end, now: new Date() };
}

var actBudget = null, actAlerts = [];
async function actLoadBudgetAndAlerts() {
  var client = authInit();
  try {
    var r1 = await client.rpc('mt_ai_budget_get_active', { p_company_id: actCompanyId });
    if (r1.error) {
      console.error('[Cost Tower] mt_ai_budget_get_active failed:', r1.error.message);
      actToast('Could not load budget configuration.', 'error');
    }
    actBudget = (!r1.error && r1.data && r1.data.budget_id) ? r1.data : null;
  } catch (e) { console.error('[Cost Tower] mt_ai_budget_get_active exception:', e); actToast('Could not load budget configuration.', 'error'); actBudget = null; }
  try {
    var r2 = await client.rpc('mt_ai_alerts_list', { p_company_id: actCompanyId });
    if (r2.error) {
      console.error('[Cost Tower] mt_ai_alerts_list failed:', r2.error.message);
      actToast('Could not load budget alerts.', 'error');
    }
    actAlerts = (!r2.error && r2.data) ? r2.data : [];
  } catch (e) { console.error('[Cost Tower] mt_ai_alerts_list exception:', e); actToast('Could not load budget alerts.', 'error'); actAlerts = []; }
}

// `mt_ai_cost_events_list` returns raw product_id/user_id — resolving them
// to display names is a separate, best-effort step (falls back to the raw
// id if either lookup fails, never blocks rendering).

var actProductNames = {};
async function actLoadProductNames() {
  try {
    var client = authInit();
    var result = await client.from('mt_products').select('id,name').eq('company_id', actCompanyId);
    (result.data || []).forEach(function (p) { actProductNames[p.id] = p.name; });
  } catch (e) { console.warn('[Cost Tower] product name lookup failed:', e); }
}
function actProductNameOf(id) { return actProductNames[id] || (id ? id : 'Unknown Product'); }

// User display names aren't queryable directly (Supabase's auth.users is
// protected) — reusing the same admin-only /api/team/list proxy route
// Team Management already uses for exactly this (scripts/team-management.js).
var actUserNames = {};
async function actLoadTeamNames() {
  try {
    var authToken = '';
    try { if (typeof authGetFreshToken === 'function') authToken = await authGetFreshToken(); } catch (e) {}
    var host = window.location.hostname;
    var isLocal = (host === '' || host === 'localhost' || host === '127.0.0.1');
    var base = isLocal ? 'http://localhost:3001' : ((typeof PROXY_URL !== 'undefined' && PROXY_URL) ? PROXY_URL.replace(/\/api\/anthropic\/?$/, '') : 'https://product-diagnostics-proxy.onrender.com');
    var headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['X-Auth-Token'] = authToken;
    var res = await fetch(base + '/api/team/list', { method: 'POST', headers: headers, body: JSON.stringify({ company_id: actCompanyId }) });
    var data = await res.json().catch(function () { return {}; });
    (data.members || []).forEach(function (m) { actUserNames[m.user_id] = m.name; });
  } catch (e) { console.warn('[Cost Tower] team name lookup failed:', e); }
}
function actUserNameOf(id) { return actUserNames[id] || (id ? id : 'Unknown User'); }

function actIsPriced(r) { return r.calculated_cost !== null && r.calculated_cost !== undefined; }
function actPricedRows(rows) { return rows.filter(actIsPriced); }
function actSumCost(rows) { var s = 0; rows.forEach(function (r) { if (actIsPriced(r)) s += Number(r.calculated_cost); }); return s; }
function actSumField(rows, f) { var s = 0; rows.forEach(function (r) { s += Number(r[f] || 0); }); return s; }
function actAvgCostPerCall(rows) { var p = actPricedRows(rows); return p.length ? actSumCost(p) / p.length : null; }
function actPricingMatchRate(rows) { return rows.length ? (actPricedRows(rows).length / rows.length * 100) : null; }
function actFailedRows(rows) { return rows.filter(function (r) { return r.status === 'error' || r.status === 'timeout'; }); }
function actAttributionGap(rows) {
  var total = actSumCost(rows);
  var unassigned = actSumCost(rows.filter(function (r) { return !r.product_id && !actIsCrossProductCaller(r.caller); }));
  return { pct: total ? (unassigned / total * 100) : 0, dollars: unassigned };
}
function actDeltaPct(curr, prev) {
  // No comparable prior-period value — null means "no prior data," never
  // "0% change." Callers must not coerce this to 0 (that would misrepresent
  // an unknown baseline as a flat/no-change reading).
  if (prev === null || prev === undefined || prev === 0) return null;
  return (curr - prev) / prev * 100;
}
function actHealthTier(projected, budgetAmount) {
  if (!budgetAmount) return 'Unknown';
  if (projected > budgetAmount * 1.25) return 'Critical';
  if (projected > budgetAmount) return 'Watch';
  return 'On Track';
}
function actRunRate(spendSoFar, start, now, end) {
  var daysElapsed = Math.max(1, (now.getTime() - start.getTime()) / 86400000);
  var daysInPeriod = Math.max(daysElapsed, (end.getTime() - start.getTime()) / 86400000);
  var dailyAvg = spendSoFar / daysElapsed;
  return { dailyAvg: dailyAvg, projected: dailyAvg * daysInPeriod, daysElapsed: daysElapsed, daysInPeriod: daysInPeriod };
}

// Appendix C, corrected during build-review — a caller's prefix indicates
// which canvas triggers it, not always which canvas owns it. Exceptions
// checked before the general prefix rules.
// Callers that run across every product by design (ai-recommendations
// aggregates across all products/sessions; doc-summary serves the shared
// document library) never get a single product_id — that's expected, not
// a governance gap, so these are labeled and counted separately from
// genuinely-unassigned rows (any other caller unexpectedly missing one).
// Single source of truth for this file — actFeatureOf() below reads this
// same list rather than repeating the two caller strings independently, so
// the two can't silently drift apart. (scripts/api.js's CALLER_TIERS also
// lists these callers, for the unrelated purpose of model-tier routing —
// not reused here since this page is deliberately standalone and doesn't
// load api.js.)
var CROSS_PRODUCT_CALLERS = ['ai-recommendations', 'doc-summary'];
function actIsCrossProductCaller(caller) {
  return CROSS_PRODUCT_CALLERS.indexOf(caller) !== -1;
}

function actFeatureOf(caller) {
  if (!caller || caller === 'unknown') return 'Unknown / Other';
  if (caller === 'fc-gen-stories') return 'Story Canvas';
  if (caller === 'sc-add-feat-hyp-gen') return 'Feature Canvas';
  if (caller === 'md-dd-batch') return 'Capability Canvas';
  if (caller === 'diagnostic-leak') return 'Discovery Map';
  if (caller === 'guided-launch') return 'Guided Launch';
  if (caller === 'requirement-agent') return 'Requirement Agent';
  if (caller === 'outcome-pulse-suggest') return 'Outcome Pulse';
  if (actIsCrossProductCaller(caller)) return 'Shared / Cross-canvas';
  if (/^dm-/.test(caller)) return 'Discovery Map';
  if (/^mi-/.test(caller)) return 'Market Intelligence';
  if (/^cc-/.test(caller)) return 'Capability Canvas';
  if (/^fc-/.test(caller)) return 'Feature Canvas';
  if (/^sc-/.test(caller)) return 'Story Canvas';
  if (/^pi-/.test(caller)) return 'PI Canvas';
  if (/^arp-/.test(caller)) return 'Adoption Readiness';
  if (/^prototype-/.test(caller)) return 'Prototype Canvas';
  return 'Unknown / Other';
}
function actModelOf(row) { return row.response_model || row.requested_model || 'Unknown'; }

function actGroupSum(rows, keyFn) {
  var map = {};
  rows.forEach(function (r) {
    var k = keyFn(r);
    if (!map[k]) map[k] = { key: k, rows: [], cost: 0, calls: 0, inputTok: 0, outputTok: 0, failed: 0 };
    var g = map[k];
    g.rows.push(r); g.calls++;
    if (actIsPriced(r)) g.cost += Number(r.calculated_cost);
    g.inputTok += Number(r.input_tokens || 0); g.outputTok += Number(r.output_tokens || 0);
    if (r.status === 'error' || r.status === 'timeout') g.failed++;
  });
  return map;
}
function actTopBy(map, field) {
  var best = null;
  Object.keys(map).forEach(function (k) {
    if (!best || map[k][field] > best[field]) best = map[k];
  });
  return best;
}

// ══════════════════════════════════════════════════════════════════════
// Shared: Top Optimization Opportunities (spec Section 6.4) — used by
// both Overview's Recommended Action and Planning's own opportunity cards,
// one source of truth per the spec's explicit instruction.
// ══════════════════════════════════════════════════════════════════════

function actConfidenceTier(n) {
  if (n > CONFIDENCE_HIGH_MIN) return 'High';
  if (n >= CONFIDENCE_MEDIUM_MIN) return 'Medium';
  return 'Low';
}

// Type 1 needs a candidate cheaper tier's per-token rate to project cost
// at. mt_ai_cost_events_list() returns each row's own input/output rate —
// the candidate tier's rate is derived empirically from other rows this
// period actually priced at that tier for the same provider (this app has
// no separate client-side pricing catalog query — see build notes).
function actComputeType1(rows) {
  var byFeature = {};
  rows.forEach(function (r) { var f = actFeatureOf(r.caller); (byFeature[f] = byFeature[f] || []).push(r); });
  var best = null;
  Object.keys(byFeature).forEach(function (feature) {
    var frows = byFeature[feature].slice().sort(function (a, b) { return (a.request_bytes || 0) - (b.request_bytes || 0); });
    var segLen = Math.max(1, Math.round(frows.length * OPPORTUNITY_SMALL_SEGMENT_PCT));
    var segment = frows.slice(0, segLen).filter(actIsPriced);
    if (!segment.length) return;
    var tierCounts = {};
    segment.forEach(function (r) { if (r.tier) tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1; });
    var currentTier = Object.keys(tierCounts).sort(function (a, b) { return tierCounts[b] - tierCounts[a]; })[0];
    var candidateTier = currentTier && TIER_BELOW[currentTier];
    if (!candidateTier) return;
    var provider = segment[0].provider;
    var candidateRows = rows.filter(function (r) { return r.provider === provider && r.tier === candidateTier && r.input_price_per_mtok != null; });
    if (!candidateRows.length) return;
    var candInPrice = actSumField(candidateRows, 'input_price_per_mtok') / candidateRows.length;
    var candOutPrice = actSumField(candidateRows, 'output_price_per_mtok') / candidateRows.length;
    var currentCost = actSumCost(segment);
    var projectedCost = 0;
    segment.forEach(function (r) {
      projectedCost += (Number(r.input_tokens || 0) / 1000000) * candInPrice + (Number(r.output_tokens || 0) / 1000000) * candOutPrice;
    });
    var savings = Math.max(0, currentCost - projectedCost);
    if (savings <= 0) return;
    var currBlended = currentCost / segment.length;
    var candBlended = projectedCost / segment.length;
    var outlierFactor = candBlended > 0 ? (currBlended / candBlended) : null;
    var candidate = {
      type: 1, feature: feature, savings: savings,
      title: feature + ' intake routing',
      evidence: 'The smallest ' + Math.round(OPPORTUNITY_SMALL_SEGMENT_PCT * 100) + '% of ' + feature + ' calls by request size still route through ' + TIER_LABEL[currentTier] + ' tier, alongside its larger calls.',
      confidence: actConfidenceTier(segment.length),
      segmentCount: segment.length, outlierFactor: outlierFactor,
      currentTier: currentTier, candidateTier: candidateTier,
      supportingCalls: segment.slice(0, 5)
    };
    if (!best || candidate.savings > best.savings) best = candidate;
  });
  return best;
}

function actComputeType2(rows) {
  var byFeature = {};
  rows.forEach(function (r) {
    if (!r.prompt_version) return;
    var f = actFeatureOf(r.caller);
    var key = f + '||' + r.prompt_version;
    if (!byFeature[f]) byFeature[f] = {};
    if (!byFeature[f][r.prompt_version]) byFeature[f][r.prompt_version] = { rows: [], firstSeen: r.request_started_at };
    byFeature[f][r.prompt_version].rows.push(r);
    if (r.request_started_at < byFeature[f][r.prompt_version].firstSeen) byFeature[f][r.prompt_version].firstSeen = r.request_started_at;
  });
  var best = null;
  Object.keys(byFeature).forEach(function (feature) {
    var versions = Object.keys(byFeature[feature]).map(function (v) {
      return { version: v, firstSeen: byFeature[feature][v].firstSeen, rows: byFeature[feature][v].rows };
    }).sort(function (a, b) { return new Date(a.firstSeen) - new Date(b.firstSeen); });
    if (versions.length < 2) return;
    var baseline = versions[versions.length - 2], current = versions[versions.length - 1];
    var baseAvgCost = actAvgCostPerCall(baseline.rows), currAvgCost = actAvgCostPerCall(current.rows);
    if (baseAvgCost === null || currAvgCost === null || currAvgCost <= baseAvgCost) return;
    var avoidable = (currAvgCost - baseAvgCost) * current.rows.length;
    if (avoidable <= 0) return;
    var candidate = {
      type: 2, feature: feature, savings: avoidable,
      title: 'Prompt version ' + current.version + ' review',
      evidence: current.version + ' shows a higher avg cost/call ($' + currAvgCost.toFixed(2) + ') than the immediately preceding version ' + baseline.version + ' ($' + baseAvgCost.toFixed(2) + ') for ' + feature + '.',
      confidence: actConfidenceTier(current.rows.length),
      outlierFactor: baseAvgCost > 0 ? (currAvgCost / baseAvgCost) : null
    };
    if (!best || candidate.savings > best.savings) best = candidate;
  });
  return best;
}

function actComputeType3(rows) {
  var gap = actAttributionGap(rows);
  if (gap.dollars <= 0) return null;
  return {
    type: 3, savings: gap.dollars,
    title: 'Unassigned product attribution',
    evidence: actFmtPct(gap.pct, 0) + ' of spend has no product_id. This is not savings, it is a measurement gap that blocks accurate governance.',
    confidence: null
  };
}

function actComputeOpportunities(rows) {
  var list = [actComputeType1(rows), actComputeType2(rows), actComputeType3(rows)].filter(Boolean);
  list.sort(function (a, b) { return b.savings - a.savings; });
  return list;
}

// ══════════════════════════════════════════════════════════════════════
// SCREEN 1: Overview (spec Section 4)
// ══════════════════════════════════════════════════════════════════════

function actRenderOverview() {
  var rows = actMain.rows, prevRows = actMain.prevRows;
  var totalSpend = actSumCost(rows), prevSpend = actSumCost(prevRows);
  var spendDelta = actDeltaPct(totalSpend, prevSpend);
  var budgetAmount = actBudget ? Number(actBudget.amount) : null;
  var budgetUsedPct = budgetAmount ? (totalSpend / budgetAmount * 100) : null;
  var totalCalls = rows.length, prevCalls = prevRows.length;
  var callsDelta = actDeltaPct(totalCalls, prevCalls);
  var inTok = actSumField(rows, 'input_tokens'), outTok = actSumField(rows, 'output_tokens');
  var avgCost = actAvgCostPerCall(rows), prevAvgCost = actAvgCostPerCall(prevRows);
  var avgCostDelta = actDeltaPct(avgCost, prevAvgCost);
  var pricingMatch = actPricingMatchRate(rows);
  var unpricedCount = rows.length - actPricedRows(rows).length;
  var attrib = actAttributionGap(rows);
  var run = actRunRate(totalSpend, actMain.start, actMain.now, actMain.end);
  var tier = actHealthTier(run.projected, budgetAmount);
  var tierClass = tier === 'Critical' ? 'red' : (tier === 'Watch' ? 'amber' : (tier === 'On Track' ? 'green' : ''));

  // Top Cost Drivers (Section 4.3) — three different selection rules, by design.
  var featureGroups = actGroupSum(rows, function (r) { return actFeatureOf(r.caller); });
  var prevFeatureGroups = actGroupSum(prevRows, function (r) { return actFeatureOf(r.caller); });
  var topFeature = actTopBy(featureGroups, 'cost');
  var topFeatureDelta = topFeature ? actDeltaPct(topFeature.cost, (prevFeatureGroups[topFeature.key] || { cost: 0 }).cost) : null;

  var modelGroups = actGroupSum(rows, actModelOf);
  var prevModelGroups = actGroupSum(prevRows, actModelOf);
  var topModel = actTopBy(modelGroups, 'cost');
  var topModelDelta = topModel ? actDeltaPct(topModel.cost, (prevModelGroups[topModel.key] || { cost: 0 }).cost) : null;

  var productGroups = actGroupSum(rows, function (r) { return r.product_id || (actIsCrossProductCaller(r.caller) ? '__cross_product__' : '__unassigned__'); });
  var prevProductGroups = actGroupSum(prevRows, function (r) { return r.product_id || (actIsCrossProductCaller(r.caller) ? '__cross_product__' : '__unassigned__'); });
  var topGrowthProduct = null, topGrowthPct = -Infinity;
  Object.keys(productGroups).forEach(function (k) {
    if (k === '__unassigned__' || k === '__cross_product__') return;
    var curr = productGroups[k].cost, prev = (prevProductGroups[k] || { cost: 0 }).cost;
    var growth = prev > 0 ? ((curr - prev) / prev * 100) : (curr > 0 ? Infinity : -Infinity);
    if (growth > topGrowthPct) { topGrowthPct = growth; topGrowthProduct = productGroups[k]; }
  });

  // Needs Attention (Section 4.4)
  var opportunities = actComputeOpportunities(rows);
  var top1 = opportunities[0];
  var balancedFrontierShare = rows.length ? (rows.filter(function (r) { return r.tier === 'balanced' || r.tier === 'frontier'; }).length / rows.length * 100) : 0;
  var prevBalancedFrontierShare = prevRows.length ? (prevRows.filter(function (r) { return r.tier === 'balanced' || r.tier === 'frontier'; }).length / prevRows.length * 100) : 0;
  var tierShiftPp = balancedFrontierShare - prevBalancedFrontierShare;
  var overallDeltaPct = actDeltaPct(totalSpend, prevSpend);

  var needsAttentionHtml = '';
  if (tier !== 'On Track' && tier !== 'Unknown') {
    var headline = (overallDeltaPct === null
        ? 'Spend has no comparable prior-period data yet'
        : 'Spend is running ' + Math.abs(Math.round(overallDeltaPct)) + '% above last month’s pace') +
      (topFeature ? ', mainly because ' + actEsc(topFeature.key) + ' increased' : '') +
      (tierShiftPp > 5 ? ' and higher-tier model usage increased ' + tierShiftPp.toFixed(0) + ' percentage points' : '') + '.';
    var variance = run.projected - budgetAmount;
    needsAttentionHtml =
      '<div class="act-section-title">Needs Attention</div>' +
      '<div class="act-insight-card status-' + tierClass + '">' +
      '<span class="act-status-pill ' + tierClass + '"><span class="act-status-dot"></span>Needs Attention</span>' +
      '<div class="act-insight-headline">' + headline + '</div>' +
      '<div class="act-insight-support">At the current run rate, this month is projected to close around <b>' + actFmtUSD0(run.projected) + '</b> against a <b>' + actFmtUSD0(budgetAmount) + '</b> budget, ' + (variance >= 0 ? 'an overage of roughly <b>' + actFmtUSD0(variance) + '</b>.' : 'inside budget.') + '</div>' +
      (top1 ?
        '<div class="act-insight-rec"><div class="act-insight-rec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z"/></svg></div>' +
        '<div class="act-insight-rec-text"><b>Recommended:</b> ' + actEsc(top1.title) + '. ' + actEsc(top1.evidence) + (top1.type !== 3 ? ' Estimated savings opportunity: <b>' + actFmtUSD0(top1.savings) + '/month</b>.' : ' Measured gap: <b>' + actFmtUSD0(top1.savings) + '</b>.') + '</div></div>'
        : '') +
      '<table class="act-evidence-table"><thead><tr><th>Evidence</th><th>This Month</th><th>Last Month</th><th>Change</th></tr></thead><tbody>' +
      '<tr><td>Total calls</td><td>' + actFmtNum(totalCalls) + '</td><td>' + actFmtNum(prevCalls) + '</td><td>' + actDeltaHtml(callsDelta) + '</td></tr>' +
      '<tr><td>Total tokens</td><td>' + actFmtTokens(inTok + outTok) + '</td><td>' + actFmtTokens(actSumField(prevRows, 'input_tokens') + actSumField(prevRows, 'output_tokens')) + '</td><td>' + actDeltaHtml(actDeltaPct(inTok + outTok, actSumField(prevRows, 'input_tokens') + actSumField(prevRows, 'output_tokens'))) + '</td></tr>' +
      '<tr><td>Balanced/frontier share of calls</td><td>' + actFmtPct(balancedFrontierShare, 0) + '</td><td>' + actFmtPct(prevBalancedFrontierShare, 0) + '</td><td>' + (tierShiftPp >= 0 ? '<span class="act-delta-up">+' + tierShiftPp.toFixed(0) + 'pt</span>' : '<span class="act-delta-down">' + tierShiftPp.toFixed(0) + 'pt</span>') + '</td></tr>' +
      (topFeature ? '<tr><td>' + actEsc(topFeature.key) + ' spend</td><td>' + actFmtUSD(topFeature.cost) + '</td><td>' + actFmtUSD((prevFeatureGroups[topFeature.key] || { cost: 0 }).cost) + '</td><td>' + actDeltaHtml(topFeatureDelta) + '</td></tr>' : '') +
      '</tbody></table>' +
      '<div class="act-evidence-note">Numbers are deterministic calculations from mt_ai_usage_events joined to effective-dated mt_model_pricing. Narrative wording is generated from these figures, not the other way around.</div>' +
      '</div>';
  }

  var html =
    '<div class="act-screen-header-row"><div class="act-screen-title-block"><div class="act-eyebrow">Overview</div><div class="act-screen-subtitle">Leadership glance: spend health, top drivers, budget risk, and evidence-backed recommendation.</div></div>' +
    '<button class="export-cta-btn" id="act-export-overview-btn" onclick="actDownloadReport(\'overview\')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Export</button></div>' +
    '<div id="act-export-overview-target">' +
    '<div id="act-export-overview-header" style="text-align:center;font-size:24px;font-weight:700;color:var(--t1);margin-bottom:16px;display:none;"></div>' +
    '<div class="act-section-title" style="margin-top:0;">At A Glance</div>' +
    '<div class="act-kpi-strip">' +
    '<div class="act-kpi health ' + (tier === 'Critical' ? 'critical' : tier === 'On Track' ? 'ok' : '') + '"><div class="act-kpi-label">Health</div><div class="act-kpi-value ' + tierClass + '">' + tier + '</div><div class="act-kpi-sub">' + (tier === 'On Track' ? 'Tracking within budget' : tier === 'Unknown' ? 'No active budget configured' : 'Projected over budget') + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Total Spend</div><div class="act-kpi-value">' + actFmtUSD0(totalSpend) + '</div><div class="act-kpi-delta">' + actDeltaHtml(spendDelta) + ' vs last month</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Budget Used</div><div class="act-kpi-value ' + tierClass + '">' + (budgetUsedPct !== null ? actFmtPct(budgetUsedPct, 0) : '—') + '</div><div class="act-kpi-sub">' + actFmtUSD0(totalSpend) + ' of ' + (budgetAmount ? actFmtUSD0(budgetAmount) : 'no budget set') + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Total Calls</div><div class="act-kpi-value">' + actFmtNum(totalCalls) + '</div><div class="act-kpi-delta">' + actDeltaHtml(callsDelta) + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Total Tokens</div><div class="act-kpi-value">' + actFmtTokens(inTok + outTok) + '</div><div class="act-kpi-sub">' + actFmtTokens(inTok) + ' input · ' + actFmtTokens(outTok) + ' output</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Avg Cost / Call</div><div class="act-kpi-value">' + actFmtUSD(avgCost) + '</div><div class="act-kpi-delta">' + actDeltaHtml(avgCostDelta) + '</div></div>' +
    '</div>' +
    '<div class="act-trust-mini">' +
    '<div class="act-trust-chip"><b>' + actFmtPct(pricingMatch, 1) + '</b>Pricing match rate</div>' +
    '<div class="act-trust-chip"><b>' + actFmtNum(unpricedCount) + '</b>Unpriced calls need pricing resolution</div>' +
    '<div class="act-trust-chip"><b>' + actFmtPct(attrib.pct, 0) + '</b>' + actFmtUSD0(attrib.dollars) + ' of spend has no product assigned</div>' +
    '</div>' +
    '<div class="act-section-title">Top Cost Drivers</div>' +
    '<div class="act-driver-grid">' +
    (topFeature ? '<div class="act-driver-card"><div class="act-driver-top"><span class="act-driver-tag">Feature</span>' + actDeltaHtml(topFeatureDelta) + '</div><div class="act-driver-title">' + actEsc(topFeature.key) + '</div><div class="act-driver-value">' + actFmtUSD0(topFeature.cost) + '</div><div class="act-driver-note">Highest feature spend this period.</div><div class="act-driver-link" onclick="actGoToBreakdown(\'feature\')">Open Cost Breakdown &rarr;</div></div>' : '') +
    (topModel ? '<div class="act-driver-card"><div class="act-driver-top"><span class="act-driver-tag">Model</span>' + actDeltaHtml(topModelDelta) + '</div><div class="act-driver-title">' + actEsc(topModel.key) + '</div><div class="act-driver-value">' + actFmtUSD0(topModel.cost) + '</div><div class="act-driver-note">Highest model spend this period.</div><div class="act-driver-link" onclick="actGoToBreakdown(\'model\')">Open Model View &rarr;</div></div>' : '') +
    (topGrowthProduct ? '<div class="act-driver-card"><div class="act-driver-top"><span class="act-driver-tag">Product</span>' + (isFinite(topGrowthPct) ? actDeltaHtml(topGrowthPct) : '<span class="act-delta-up">New</span>') + '</div><div class="act-driver-title">' + actEsc(actProductNameOf(topGrowthProduct.key)) + '</div><div class="act-driver-value">' + actFmtUSD0(topGrowthProduct.cost) + '</div><div class="act-driver-note">Fastest growing product spend this period.</div><div class="act-driver-link" onclick="actGoToBreakdown(\'product\')">Open Product View &rarr;</div></div>' : '') +
    '</div>' +
    needsAttentionHtml +
    '<div class="act-section-title">Unassigned Spend</div>' +
    '<div class="act-unassigned-line"><div class="act-unassigned-left"><div class="act-unassigned-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg></div>' +
    '<div><b>' + actFmtUSD0(attrib.dollars) + '</b>, about <b>' + actFmtPct(attrib.pct, 0) + '</b> of total spend this period, has no product attribution.</div></div>' +
    '<button class="act-btn act-btn-tertiary act-btn-sm" onclick="actGoToBreakdown(\'product\')">Investigate Attribution</button></div>' +
    '</div>';

  document.getElementById('act-scr-overview').innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════
// SCREEN 2: Cost Breakdown (spec Section 5)
// ══════════════════════════════════════════════════════════════════════

var actBreakdown = { type: 'this_month', label: 'This Month', rows: [], prevRows: [], start: null, end: null, group: 'feature' };

async function actSetBreakdownPeriod(type, customStart, customEnd) {
  actBreakdown.type = type;
  var range, prior;
  // For the two calendar-month options, compare against the actual calendar
  // prior month (same definition Overview's own KPI deltas use via
  // actMonthRange(-1)) rather than a rolling window of equal length — the
  // two would otherwise silently disagree whenever adjacent months have
  // different day counts. A rolling window is kept for Last 3 Months/Custom,
  // where there's no single well-defined "calendar-aligned prior period."
  if (type === 'this_month') { range = actMonthRange(0); prior = actMonthRange(-1); }
  else if (type === 'last_month') { range = actMonthRange(-1); prior = actMonthRange(-2); }
  else if (type === 'last_3_months') {
    var now = new Date();
    range = { start: new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0), end: now };
    prior = actPriorPeriod(range.start, range.end);
  } else {
    range = { start: customStart, end: customEnd };
    prior = actPriorPeriod(range.start, range.end);
  }
  actBreakdown.start = range.start; actBreakdown.end = range.end;
  actBreakdown.rows = await actFetchRows(range.start, range.end);
  actBreakdown.prevRows = await actFetchRows(prior.start, prior.end);
  // Kept as a console diagnostic (not a DOM element anymore, now that the
  // row count is folded directly into the toolbar's own confidence chip) —
  // still useful for anyone checking DevTools if a period change ever looks
  // like it isn't reaching the fetch.
  console.log('[Cost Tower] period=' + type, 'range=', range.start.toISOString(), '→', range.end.toISOString(), 'rows=', actBreakdown.rows.length);
  actRenderCostBreakdown();
}

function actSelectPeriodChip(type, label) {
  actBreakdown.label = label;
  document.getElementById('act-period-menu').classList.remove('open');
  actSetBreakdownPeriod(type).catch(function (e) { console.error(e); });
}

function actOpenCustomRangeModal() {
  document.getElementById('act-period-menu').classList.remove('open');
  document.getElementById('act-modal-title').textContent = 'Custom Date Range';
  document.getElementById('act-modal-body').innerHTML =
    '<div class="act-config-grid">' +
    '<div class="act-field"><div class="act-field-label">From</div><input id="act-custom-from" type="date"></div>' +
    '<div class="act-field"><div class="act-field-label">To</div><input id="act-custom-to" type="date"></div>' +
    '</div>' +
    '<div style="margin-top:14px;color:var(--red);font-size:11px;" id="act-custom-range-error"></div>' +
    '<div style="margin-top:14px;display:flex;justify-content:flex-end;"><button class="act-btn act-btn-primary act-btn-sm" onclick="actApplyCustomRange()">Apply</button></div>';
  actShowModal();
}

async function actApplyCustomRange() {
  var fromVal = document.getElementById('act-custom-from').value;
  var toVal = document.getElementById('act-custom-to').value;
  var errEl = document.getElementById('act-custom-range-error');
  if (!fromVal || !toVal) { errEl.textContent = 'Choose both a start and end date.'; return; }
  var start = new Date(fromVal + 'T00:00:00');
  var end = new Date(new Date(toVal + 'T00:00:00').getTime() + 86400000); // exclusive upper bound = day after "To"
  if (start >= end) { errEl.textContent = 'Start date must be before end date.'; return; }
  errEl.textContent = '';
  actCloseModal();
  actBreakdown.label = fromVal + ' – ' + toVal;
  await actSetBreakdownPeriod('custom', start, end);
}

function actSelectGroup(group) {
  actBreakdown.group = group;
  var labels = { feature: 'Feature', product: 'Product', model: 'Model', user: 'User', prompt: 'Prompt Version' };
  var el = document.getElementById('act-group-value');
  if (el) el.textContent = labels[group];
  document.getElementById('act-group-menu').classList.remove('open');
  actRenderMainBreakdown();
}

var BREAKDOWN_INSIGHTS = {}; // populated per render from actual winning row

function actGroupKeyFor(group, r) {
  if (group === 'feature') return actFeatureOf(r.caller);
  if (group === 'product') return r.product_id || (actIsCrossProductCaller(r.caller) ? '__cross_product__' : '__unassigned__');
  if (group === 'model') return actModelOf(r);
  if (group === 'user') return r.user_id || '__unknown_user__';
  if (group === 'prompt') return actFeatureOf(r.caller) + ' · ' + (r.prompt_version || 'Unversioned');
  return 'other';
}

function actRenderMainBreakdown() {
  var rows = actBreakdown.rows, prevRows = actBreakdown.prevRows, group = actBreakdown.group;
  var groups = actGroupSum(rows, function (r) { return actGroupKeyFor(group, r); });
  var prevGroups = actGroupSum(prevRows, function (r) { return actGroupKeyFor(group, r); });
  var totalCost = actSumCost(rows);
  var keys = Object.keys(groups).sort(function (a, b) { return groups[b].cost - groups[a].cost; });
  var top = keys.length ? groups[keys[0]] : null;

  var insight = 'No data for this period.';
  if (top) {
    var share = totalCost ? (top.cost / totalCost * 100) : 0;
    if (group === 'feature') insight = actEsc(top.key) + ' accounts for ' + share.toFixed(0) + '% of spend this period.';
    else if (group === 'product') insight = actEsc(top.key === '__unassigned__' ? 'Unassigned spend' : top.key === '__cross_product__' ? 'Cross-Product (Shared) spend' : actProductNameOf(top.key)) + ' leads at ' + actFmtUSD(top.cost) + ' (' + share.toFixed(0) + '% of spend) this period.';
    else if (group === 'model') insight = actEsc(top.key) + ' drives ' + share.toFixed(0) + '% of spend this period.';
    else if (group === 'user') insight = actEsc(actUserNameOf(top.key === '__unknown_user__' ? null : top.key)) + ' accounts for ' + share.toFixed(0) + '% of spend this period. This is an audit signal, not a leaderboard.';
    else if (group === 'prompt') insight = actEsc(top.key) + ' is the highest-cost prompt version cut this period.';
  }

  var maxCost = top ? top.cost : 1;
  var rowsHtml = keys.map(function (k) {
    var g = groups[k];
    var prevCost = (prevGroups[k] || { cost: 0 }).cost;
    var delta = actDeltaPct(g.cost, prevCost);
    var share = totalCost ? (g.cost / totalCost * 100) : 0;
    var barPct = maxCost ? Math.max(4, g.cost / maxCost * 100) : 0;
    var displayName = k === '__unassigned__' ? '<span class="act-cell-name">Unassigned</span><div class="act-cell-muted">No product_id</div>'
      : k === '__cross_product__' ? '<span class="act-cell-name">Cross-Product (Shared)</span><div class="act-cell-muted">Runs across every product</div>'
      : actEsc(group === 'product' ? actProductNameOf(k) : k);
    if (group === 'model') {
      var tierRow = g.rows.find(function (r) { return r.tier; });
      var tierBadge = tierRow ? '<span class="act-tag-status info">' + TIER_LABEL[tierRow.tier] + '</span>' : '<span class="act-cell-muted">Unpriced</span>';
      return '<tr><td class="act-cell-name">' + displayName + '</td><td>' + tierBadge + '</td><td>' + actFmtNum(g.calls) + '</td><td class="act-cell-bar"><div class="act-cell-bar-track"><div class="act-cell-bar-fill" style="width:' + barPct + '%"></div></div>' + share.toFixed(0) + '%</td><td class="act-cell-name">' + actFmtUSD(g.cost) + '</td><td>' + actDeltaHtml(delta) + '</td></tr>';
    }
    if (group === 'user') {
      var role = g.rows[0] ? (g.rows[0].user_role_at_call || '—') : '—';
      return '<tr><td class="act-cell-name">' + (k === '__unknown_user__' ? 'Unknown' : actEsc(actUserNameOf(k))) + '</td><td>' + actEsc(role) + '</td><td>' + actFmtNum(g.calls) + '</td><td class="act-cell-bar"><div class="act-cell-bar-track"><div class="act-cell-bar-fill" style="width:' + barPct + '%"></div></div>' + share.toFixed(0) + '%</td><td class="act-cell-name">' + actFmtUSD(g.cost) + '</td></tr>';
    }
    if (group === 'prompt') {
      var failRate = g.calls ? (g.failed / g.calls * 100) : 0;
      var avgTok = g.calls ? (g.inputTok + g.outputTok) / g.calls : 0;
      var avgCost = g.calls ? g.cost / g.calls : 0;
      return '<tr><td class="act-cell-name">' + actEsc(k) + '</td><td>' + actFmtNum(g.calls) + '</td><td>' + actFmtNum(Math.round(avgTok)) + '</td><td>' + actFmtUSD(avgCost) + '</td><td><span class="act-tag-status ' + (failRate > 5 ? 'warn' : 'ok') + '">' + failRate.toFixed(1) + '%</span></td></tr>';
    }
    return '<tr><td class="act-cell-name">' + displayName + '</td><td>' + actFmtNum(g.calls) + '</td><td>' + actFmtTokens(g.inputTok + g.outputTok) + '</td><td class="act-cell-bar"><div class="act-cell-bar-track"><div class="act-cell-bar-fill" style="width:' + barPct + '%"></div></div>' + share.toFixed(0) + '%</td><td class="act-cell-name">' + actFmtUSD(g.cost) + '</td><td>' + actDeltaHtml(delta) + '</td></tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t4);padding:20px;">No calls logged in this period.</td></tr>';

  var headerRow = group === 'model' ? '<tr><th>Model</th><th>Tier</th><th>Calls</th><th>Cost Share</th><th>Cost</th><th>Trend</th></tr>' :
    group === 'user' ? '<tr><th>User</th><th>Role</th><th>Calls</th><th>Cost Share</th><th>Cost</th></tr>' :
    group === 'prompt' ? '<tr><th>Feature · Prompt Version</th><th>Calls</th><th>Avg Tokens / Call</th><th>Cost / Call</th><th>Failure Rate</th></tr>' :
    '<tr><th>' + (group === 'product' ? 'Product' : 'Feature') + '</th><th>Calls</th><th>Tokens</th><th>Cost Share</th><th>Cost</th><th>Trend</th></tr>';

  document.getElementById('act-main-breakdown-insight').textContent = insight;
  document.getElementById('act-main-breakdown-table').innerHTML = '<thead>' + headerRow + '</thead><tbody>' + rowsHtml + '</tbody>';
}

function actRenderCostBreakdown() {
  var rows = actBreakdown.rows, prevRows = actBreakdown.prevRows;
  var pricingMatch = actPricingMatchRate(rows);
  var confClass = pricingMatch !== null && pricingMatch < PRICING_MATCH_LAUNCH_GATE_PCT ? 'warn' : '';
  var periodMenuOptions = [
    { type: 'this_month', label: 'This Month' },
    { type: 'last_month', label: 'Last Month' },
    { type: 'last_3_months', label: 'Last 3 Months' }
  ];
  var periodMenuHtml = periodMenuOptions.map(function (o) {
    return '<button onclick="actSelectPeriodChip(\'' + o.type + '\',\'' + o.label + '\')">' + o.label + '</button>';
  }).join('') + '<button onclick="actOpenCustomRangeModal()">Custom Range…</button>';

  var html =
    '<div class="act-screen-header-row"><div class="act-screen-title-block"><div class="act-eyebrow">Cost Breakdown</div><div class="act-screen-subtitle">Investigate spend by feature, product, model, user, prompt version, selection path, failure, and data quality.</div></div>' +
    '<button class="export-cta-btn" id="act-export-cost-btn" onclick="actDownloadReport(\'cost\')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Export</button></div>' +
    '<div id="act-export-cost-target">' +
    '<div id="act-export-cost-header" style="text-align:center;font-size:24px;font-weight:700;color:var(--t1);margin-bottom:16px;display:none;"></div>' +
    '<div class="act-filter-toolbar">' +
    '<div class="act-filter-group"><span class="act-filter-group-label">Reporting period</span>' +
    '<div class="act-dropdown-chip-wrap"><button class="act-dropdown-chip" onclick="actToggleMenu(\'act-period-menu\')" aria-haspopup="true"><span class="act-dropdown-chip-value" id="act-period-value">' + actEsc(actBreakdown.label) + '</span><svg class="act-chip-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></button>' +
    '<div class="act-dropdown-chip-menu" id="act-period-menu">' + periodMenuHtml + '</div></div></div>' +
    '<div class="act-filter-divider"></div>' +
    '<div class="act-filter-group"><span class="act-filter-group-label">Group by</span>' +
    '<div class="act-dropdown-chip-wrap"><button class="act-dropdown-chip" onclick="actToggleMenu(\'act-group-menu\')" aria-haspopup="true"><span class="act-dropdown-chip-value" id="act-group-value">' + actEsc({ feature: 'Feature', product: 'Product', model: 'Model', user: 'User', prompt: 'Prompt Version' }[actBreakdown.group]) + '</span><svg class="act-chip-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></button>' +
    '<div class="act-dropdown-chip-menu" id="act-group-menu">' +
    '<button onclick="actSelectGroup(\'feature\')">Feature</button><button onclick="actSelectGroup(\'product\')">Product</button><button onclick="actSelectGroup(\'model\')">Model</button><button onclick="actSelectGroup(\'user\')">User</button><button onclick="actSelectGroup(\'prompt\')">Prompt Version</button>' +
    '</div></div></div>' +
    '<span class="act-filter-toolbar-hint">' + actFmtNum(rows.length) + ' calls · <span class="act-confidence-pill ' + confClass + '" style="margin-left:4px;"><span class="act-confidence-dot"></span>Pricing match ' + actFmtPct(pricingMatch, 1) + '</span></span>' +
    '</div>' +
    '<div class="act-anchor-row">' +
    '<span class="act-anchor-chip" onclick="actScrollToSection(\'act-main-breakdown\')">Main Breakdown</span>' +
    '<span class="act-anchor-chip" onclick="actScrollToSection(\'act-economics-signals\')">Economics Signals</span>' +
    '<span class="act-anchor-chip" onclick="actScrollToSection(\'act-operational-signals\')">Operational Signals</span>' +
    '<span class="act-anchor-chip" onclick="actScrollToSection(\'act-trust-audit\')">Trust &amp; Audit</span>' +
    '</div>' +

    '<div id="act-main-breakdown" class="act-group-card"><div class="act-group-head"><div class="act-group-kicker">A. Main Breakdown</div><div class="act-group-title">Where cost is concentrated</div></div>' +
    '<div class="act-group-body"><div class="act-section-insight" id="act-main-breakdown-insight"></div><table class="act-data-table" id="act-main-breakdown-table"></table></div></div>' +

    '<div id="act-economics-signals" class="act-group-card"><div class="act-group-head"><div class="act-group-kicker">B. Economics Signals</div><div class="act-group-title">What may be driving cost behavior</div></div>' +
    '<div class="act-group-body">' + actRenderSelectionEconomics(rows) +
    '<div class="act-callout card"><div><b>Prompt version analysis:</b> use Group by: Prompt Version in the Main Breakdown above. Keeping it there avoids showing overlapping prompt-version tables with different slices of the same data.</div></div>' +
    '</div></div>' +

    '<div id="act-operational-signals" class="act-group-card"><div class="act-group-head"><div class="act-group-kicker">C. Operational Signals</div><div class="act-group-title">Failures, large calls, and cache readiness</div></div>' +
    '<div class="act-group-body"><div class="act-planning-grid">' + actRenderFailureCost(rows) + actRenderCacheUsage() + '</div>' + actRenderLongestLargest(rows) + '</div></div>' +

    '<div id="act-trust-audit" class="act-group-card"><div class="act-group-head"><div class="act-group-kicker">D. Trust &amp; Audit</div><div class="act-group-title">Prove the cost numbers are reliable</div></div>' +
    '<div class="act-group-body">' + actRenderDataQuality(rows) + actRenderRequestExplorer(rows) + '</div></div>' +

    '<div class="act-foot-hint">Reporting period governs every section above except Trust &amp; Audit’s Request Explorer statement of scope. Timezone: browser-local.</div>' +
    '</div>';

  document.getElementById('act-scr-cost').innerHTML = html;
  actRenderMainBreakdown();
  actApplyExplorerFilter();
}

function actRenderSelectionEconomics(rows) {
  var groups = actGroupSum(rows, function (r) { return r.selection_rule || 'unknown'; });
  var keys = Object.keys(groups);
  var body = keys.length ? keys.map(function (k) {
    var g = groups[k];
    var avg = g.calls ? g.cost / g.calls : 0;
    var failRate = g.calls ? (g.failed / g.calls * 100) : 0;
    var label = SELECTION_RULE_LABELS[k] || k;
    return '<tr><td class="act-cell-name">' + actEsc(label) + '<div class="act-cell-muted">' + actEsc(k) + '</div></td><td>' + actFmtNum(g.calls) + '</td><td>' + actFmtUSD(avg) + '</td><td class="act-cell-name">' + actFmtUSD(g.cost) + '</td><td>' + failRate.toFixed(1) + '%</td></tr>';
  }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--t4);padding:16px;">No data for this period.</td></tr>';
  return '<div class="act-scoped-card"><div class="act-section-title">Selection Economics</div>' +
    '<span class="act-section-caveat">Observed comparison, not a controlled experiment</span>' +
    '<div class="act-section-insight">Comparing cost, failure rate, and volume across how each call’s model was actually selected. This does not prove one path causes cheaper or more expensive outcomes — task complexity is not held constant across paths.</div>' +
    '<table class="act-data-table"><thead><tr><th>Selection Path</th><th>Calls</th><th>Avg Cost / Call</th><th>Total Cost</th><th>Failure Rate</th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

function actRenderFailureCost(rows) {
  var failed = actFailedRows(rows);
  var failCost = actSumCost(failed);
  var failRate = rows.length ? (failed.length / rows.length * 100) : 0;
  var phaseGroups = actGroupSum(failed, function (r) { return r.failure_phase || 'unspecified'; });
  var topPhase = actTopBy(phaseGroups, 'cost');
  var featureGroups = actGroupSum(failed, function (r) { return actFeatureOf(r.caller); });
  var topFeature = actTopBy(featureGroups, 'cost');
  return '<div class="act-scoped-card"><div class="act-section-title">Provider-Call Failure Cost</div>' +
    '<div class="act-kpi-strip" style="grid-template-columns:repeat(4,1fr);">' +
    '<div class="act-kpi"><div class="act-kpi-label">Failure Cost</div><div class="act-kpi-value">' + actFmtUSD0(failCost) + '</div><div class="act-kpi-sub">' + (actSumCost(rows) ? (failCost / actSumCost(rows) * 100).toFixed(1) : '0') + '% of spend</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Failure Rate</div><div class="act-kpi-value">' + failRate.toFixed(1) + '%</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Top Phase</div><div class="act-kpi-value" style="font-size:13px;">' + (topPhase ? actEsc(topPhase.key) : '—') + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Top Feature</div><div class="act-kpi-value" style="font-size:13px;">' + (topFeature ? actEsc(topFeature.key) : '—') + '</div></div>' +
    '</div><div class="act-scoped-card-note">Covers failed or timed-out provider calls only, not poor-quality successful outputs or user rework. Phase detail is limited today — every failed call currently logs the same phase, so Top Phase will not vary until that field carries more granularity.</div></div>';
}

function actRenderCacheUsage() {
  return '<div class="act-scoped-card"><div class="act-section-title">Cache Usage</div>' +
    '<div class="act-empty-state"><div class="act-empty-state-title">Collecting after enablement</div>' +
    '<div class="act-empty-state-sub">Prompt caching is not currently enabled for Anthropic calls, and cache usage reported by OpenAI/Gemini is not yet captured. This section populates once the caching-enablement build ships.</div></div></div>';
}

function actRenderLongestLargest(rows) {
  var longest = rows.slice().sort(function (a, b) { return (b.duration_ms || 0) - (a.duration_ms || 0); }).slice(0, 10);
  var largest = rows.slice().sort(function (a, b) { return ((b.request_bytes || 0) + (b.response_bytes || 0)) - ((a.request_bytes || 0) + (a.response_bytes || 0)); }).slice(0, 10);
  var seen = {}, combined = [];
  longest.concat(largest).forEach(function (r) {
    var key = r.request_started_at + '|' + r.caller + '|' + r.duration_ms;
    if (!seen[key]) { seen[key] = true; combined.push(r); }
  });
  combined = combined.slice(0, 20).sort(function (a, b) { return (b.duration_ms || 0) - (a.duration_ms || 0); });
  var featureCounts = {};
  combined.forEach(function (r) { var f = actFeatureOf(r.caller); featureCounts[f] = (featureCounts[f] || 0) + 1; });
  var topFeature = Object.keys(featureCounts).sort(function (a, b) { return featureCounts[b] - featureCounts[a]; })[0];
  var rowsHtml = combined.map(function (r) {
    return '<tr><td>' + new Date(r.request_started_at).toLocaleString() + '</td><td class="act-cell-name">' + actEsc(actFeatureOf(r.caller)) + '</td><td>' + actEsc(actModelOf(r)) + '</td><td>' + ((r.duration_ms || 0) / 1000).toFixed(1) + 's</td><td>' + Math.round(((r.request_bytes || 0) + (r.response_bytes || 0)) / 1024) + ' KB</td><td><span class="act-tag-status ' + (r.status === 'success' ? 'ok' : 'bad') + '">' + actEsc(r.status) + '</span></td></tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t4);padding:16px;">No calls in this period.</td></tr>';
  return '<div class="act-scoped-card"><div class="act-section-title">Longest and Largest Requests</div>' +
    '<div class="act-section-insight">' + (topFeature ? actEsc(topFeature) + ' accounts for the most rows in the combined longest/largest set this period.' : 'No data for this period.') + '</div>' +
    '<div style="max-height:340px;overflow-y:auto;"><table class="act-data-table"><thead><tr><th>Time</th><th>Feature</th><th>Model</th><th>Duration</th><th>Payload Size</th><th>Status</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
}

function actRenderDataQuality(rows) {
  var pricingMatch = actPricingMatchRate(rows);
  var unpricedRows = rows.filter(function (r) { return !actIsPriced(r); });
  var nullTokenCount = rows.filter(function (r) { return r.input_tokens == null || r.output_tokens == null; }).length;
  var varianceRows = rows.filter(function (r) { return r.response_model && r.requested_model && r.response_model !== r.requested_model; });
  var variancePct = rows.length ? (varianceRows.length / rows.length * 100) : 0;

  var unpricedGroups = actGroupSum(unpricedRows, function (r) { return (r.provider || '?') + ' · ' + (r.requested_model || '?') + ' → ' + (r.response_model || '—'); });
  var unpricedKeys = Object.keys(unpricedGroups).sort(function (a, b) { return unpricedGroups[b].calls - unpricedGroups[a].calls; });
  var topUnpriced = unpricedKeys[0] ? unpricedGroups[unpricedKeys[0]] : null;

  var varianceErrorCounts = {};
  varianceRows.forEach(function (r) { var k = r.error_type || r.failure_phase || 'mixed'; varianceErrorCounts[k] = (varianceErrorCounts[k] || 0) + 1; });
  var dominantVarianceCause = null;
  Object.keys(varianceErrorCounts).forEach(function (k) {
    if (varianceRows.length && varianceErrorCounts[k] / varianceRows.length > 0.5) dominantVarianceCause = k;
  });

  var trustNote = topUnpriced
    ? actEsc(unpricedKeys[0]) + ' has the highest unpriced-call count this period (' + topUnpriced.calls + ' calls).'
    : 'No unpriced calls this period.';
  trustNote += ' ' + (dominantVarianceCause ? 'Model variance is mostly driven by ' + actEsc(dominantVarianceCause) + '.' : (varianceRows.length ? 'Model variance causes are mixed — no single pattern accounts for a clear majority.' : ''));

  var launchGateWarning = (pricingMatch !== null && pricingMatch < PRICING_MATCH_LAUNCH_GATE_PCT)
    ? '<div class="act-callout amber"><div><b>Launch gate:</b> Pricing Match Rate is below ' + PRICING_MATCH_LAUNCH_GATE_PCT + '%. Overview’s Total Spend figure for this period should be treated as provisional, not an unqualified number.</div></div>' : '';

  var drillRows = unpricedKeys.map(function (k) {
    var g = unpricedGroups[k];
    var times = g.rows.map(function (r) { return new Date(r.request_started_at).getTime(); });
    var first = new Date(Math.min.apply(null, times)).toLocaleDateString();
    var last = new Date(Math.max.apply(null, times)).toLocaleDateString();
    return '<tr><td>' + actEsc(k) + '</td><td>' + g.calls + '</td><td>' + first + '</td><td>' + last + '</td></tr>';
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--t4);padding:12px;">No unpriced calls.</td></tr>';

  return '<div class="act-scoped-card"><div class="act-section-title">Data Quality and Trust</div>' +
    '<div class="act-section-insight">Admin-only. A cost tool that silently undercounts is worse than no cost tool.</div>' +
    '<div class="act-kpi-strip" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px;">' +
    '<div class="act-kpi"><div class="act-kpi-label">Pricing Match Rate</div><div class="act-kpi-value green">' + actFmtPct(pricingMatch, 1) + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Unpriced Calls</div><div class="act-kpi-value amber">' + unpricedRows.length + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Null-Token Calls</div><div class="act-kpi-value">' + nullTokenCount + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Model Variance</div><div class="act-kpi-value">' + variancePct.toFixed(1) + '%</div><div class="act-kpi-sub">response ≠ requested</div></div>' +
    '</div>' + launchGateWarning +
    '<div class="act-callout amber"><div><b>Trust note:</b> ' + trustNote + '</div></div>' +
    '<div class="act-section-title" style="font-size:12px;margin:16px 0 6px;">Unpriced Calls Drill List</div>' +
    '<table class="act-data-table"><thead><tr><th>Provider · Requested → Response</th><th>Count</th><th>First Seen</th><th>Last Seen</th></tr></thead><tbody>' + drillRows + '</tbody></table>' +
    '</div>';
}

var EXPLORER_ROW_CAP = 300;
var actExplorerSourceRows = [];

// Hybrid model display (build-review decision): show the model that
// actually produced the response (what was billed) as the primary value —
// only when it differs from what was requested does a small badge reveal
// the original request, surfacing the rare fallback/substitution case this
// column exists for without cluttering the common case where they match.
function actExplorerModelCell(r) {
  var shown = r.response_model || r.requested_model || '—';
  if (r.requested_model && r.response_model && r.requested_model !== r.response_model) {
    return actEsc(shown) + ' <span class="act-tag-status warn" title="Requested: ' + actEsc(r.requested_model) + '">changed</span>';
  }
  return actEsc(shown);
}

function actExplorerRowHtml(r) {
  return '<tr><td>' + new Date(r.request_started_at).toLocaleString() + '</td><td class="act-cell-name">' + actEsc(actFeatureOf(r.caller)) + '</td><td>' + actEsc(r.provider || '—') + '</td><td>' + actExplorerModelCell(r) + '</td><td>' + actEsc(r.prompt_version || '—') + '</td><td>' + actFmtNum((r.input_tokens || 0) + (r.output_tokens || 0)) + '</td><td>' + (actIsPriced(r) ? actFmtUSD(r.calculated_cost) : '—') + '</td><td><span class="act-tag-status ' + (r.status === 'success' ? 'ok' : 'bad') + '">' + actEsc(r.status) + '</span></td></tr>';
}

// Inline per-column filters, applied client-side over the full period's
// fetched rows (not just whatever's currently displayed) — a period can
// hold thousands of rows, so filtering down to a specific one needs more
// than scrolling a 200-row cap.
function actApplyExplorerFilter() {
  var f = {
    feature: ((document.getElementById('act-exp-f-feature') || {}).value || '').trim().toLowerCase(),
    provider: ((document.getElementById('act-exp-f-provider') || {}).value || '').trim().toLowerCase(),
    status: ((document.getElementById('act-exp-f-status') || {}).value || '').trim().toLowerCase(),
    timeFrom: (document.getElementById('act-exp-f-time-from') || {}).value || '',
    timeTo: (document.getElementById('act-exp-f-time-to') || {}).value || ''
  };
  // Date-only filter (not a timestamp) — "From" means the start of that
  // calendar day, "To" means the end of it, so a whole day is included.
  var fromMs = f.timeFrom ? new Date(f.timeFrom + 'T00:00:00').getTime() : null;
  var toMs = f.timeTo ? new Date(f.timeTo + 'T23:59:59.999').getTime() : null;

  var filtered = actExplorerSourceRows.filter(function (r) {
    if (f.feature && actFeatureOf(r.caller).toLowerCase().indexOf(f.feature) === -1) return false;
    if (f.provider && (r.provider || '').toLowerCase().indexOf(f.provider) === -1) return false;
    if (f.status && r.status !== f.status) return false;
    var t = new Date(r.request_started_at).getTime();
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  }).sort(function (a, b) { return new Date(b.request_started_at) - new Date(a.request_started_at); });

  var shown = filtered.slice(0, EXPLORER_ROW_CAP);
  var body = document.getElementById('act-explorer-body');
  if (body) body.innerHTML = shown.map(actExplorerRowHtml).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--t4);padding:16px;">No calls match these filters.</td></tr>';
  var countEl = document.getElementById('act-explorer-count');
  if (countEl) countEl.textContent = 'Showing ' + actFmtNum(shown.length) + ' of ' + actFmtNum(filtered.length) + ' matching calls (' + actFmtNum(actExplorerSourceRows.length) + ' total this period).';
}

function actRenderRequestExplorer(rows) {
  actExplorerSourceRows = rows;
  return '<div class="act-scoped-card"><div class="act-section-title">Request Explorer</div>' +
    '<div class="act-section-insight">Raw event-level audit table. Uses the reporting period only — intentionally ignores Main Breakdown’s Group By, since an audit view needs everything in the period, not a dimension-filtered slice. Filter any column below to narrow down a specific record.</div>' +
    '<div class="act-cell-muted" id="act-explorer-count" style="margin-bottom:6px;"></div>' +
    '<div style="max-height:420px;overflow-y:auto;"><table class="act-data-table"><thead>' +
    '<tr><th>Time</th><th>Feature</th><th>Provider</th><th>Model</th><th>Prompt</th><th>Tokens</th><th>Cost</th><th>Status</th></tr>' +
    '<tr>' +
    '<th><div style="display:flex;flex-direction:column;gap:2px;"><input id="act-exp-f-time-from" type="date" title="From date" oninput="actApplyExplorerFilter()" style="width:100%;font-size:9px;padding:3px 4px;border:1px solid var(--divider);border-radius:4px;"><input id="act-exp-f-time-to" type="date" title="To date" oninput="actApplyExplorerFilter()" style="width:100%;font-size:9px;padding:3px 4px;border:1px solid var(--divider);border-radius:4px;"></div></th>' +
    '<th><input id="act-exp-f-feature" type="text" placeholder="Filter…" oninput="actApplyExplorerFilter()" style="width:100%;font-size:10px;padding:4px 6px;border:1px solid var(--divider);border-radius:4px;"></th>' +
    '<th><input id="act-exp-f-provider" type="text" placeholder="Filter…" oninput="actApplyExplorerFilter()" style="width:100%;font-size:10px;padding:4px 6px;border:1px solid var(--divider);border-radius:4px;"></th>' +
    '<th></th><th></th><th></th><th></th>' +
    '<th><select id="act-exp-f-status" onchange="actApplyExplorerFilter()" style="width:100%;font-size:10px;padding:4px 2px;border:1px solid var(--divider);border-radius:4px;"><option value="">All</option><option value="success">Success</option><option value="error">Error</option><option value="timeout">Timeout</option></select></th>' +
    '</tr>' +
    '</thead><tbody id="act-explorer-body"></tbody></table></div></div>';
}

// ══════════════════════════════════════════════════════════════════════
// SCREEN 3: Planning & Optimization (spec Section 6)
// ══════════════════════════════════════════════════════════════════════

function actRenderPlan() {
  var rows = actMain.rows;
  var totalSpend = actSumCost(rows);
  var run = actRunRate(totalSpend, actMain.start, actMain.now, actMain.end);
  var budgetAmount = actBudget ? Number(actBudget.amount) : null;
  var variance = budgetAmount !== null ? (run.projected - budgetAmount) : null;
  var whatIfData = actComputeWhatIfData(rows);

  var html =
    '<div class="act-screen-header-row"><div class="act-screen-title-block"><div class="act-eyebrow">Planning &amp; Optimization</div><div class="act-screen-subtitle">Project run rate, prioritize optimization opportunities, and prepare budget/alert governance.</div></div>' +
    '<button class="export-cta-btn" id="act-export-plan-btn" onclick="actDownloadReport(\'plan\')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Export</button></div>' +
    '<div id="act-export-plan-target">' +
    '<div id="act-export-plan-header" style="text-align:center;font-size:24px;font-weight:700;color:var(--t1);margin-bottom:16px;display:none;"></div>' +
    '<div class="act-section-title" style="margin-top:0;">Projected Run Rate</div>' +
    '<div class="act-section-insight">Not a statistical forecast yet. This is a straight run-rate projection from the current period’s pace.</div>' +
    '<div class="act-kpi-strip" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px;">' +
    '<div class="act-kpi"><div class="act-kpi-label">Spend So Far</div><div class="act-kpi-value">' + actFmtUSD0(totalSpend) + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Daily Average</div><div class="act-kpi-value">' + actFmtUSD0(run.dailyAvg) + '</div><div class="act-kpi-sub">' + Math.round(run.daysElapsed) + ' days elapsed</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Projected Month-End</div><div class="act-kpi-value">' + actFmtUSD0(run.projected) + '</div></div>' +
    '<div class="act-kpi"><div class="act-kpi-label">Budget Variance</div><div class="act-kpi-value ' + (variance !== null && variance > 0 ? 'amber' : 'green') + '">' + (variance !== null ? (variance >= 0 ? '+' : '') + actFmtUSD0(variance) : '—') + '</div></div>' +
    '</div>' +
    '<div class="act-planning-grid">' + actRenderRoleEconomics(rows) + actRenderWhatIf(whatIfData) + '</div>' +
    actRenderOpportunities(rows) +
    actRenderOpportunityMatrix(rows) +
    actRenderBudgetAlerts() +
    '</div>';

  document.getElementById('act-scr-plan').innerHTML = html;
  window._actWhatIf = whatIfData;
  actUpdateWhatIf();
}

function actRenderRoleEconomics(rows) {
  var groups = actGroupSum(rows, function (r) { return r.user_role_at_call || 'Unknown'; });
  var keys = Object.keys(groups).sort(function (a, b) { return groups[b].calls - groups[a].calls; });
  var body = keys.map(function (k, idx) {
    var g = groups[k];
    var avg = g.calls ? g.cost / g.calls : 0;
    var signal = keys.length <= 1 ? 'Only Role' : (idx === 0 ? 'Highest' : (idx === keys.length - 1 ? 'Low' : 'Medium'));
    var rank = idx === 0 ? 'highest' : (idx === keys.length - 1 ? 'lowest' : 'middle');
    return '<tr><td class="act-cell-name">' + actEsc(k) + '</td><td>' + actFmtUSD(avg) + '</td><td>' + signal + '</td><td>' + actFmtNum(g.calls) + ' calls; ' + rank + '-volume role this period.</td></tr>';
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--t4);padding:16px;">No data for this period.</td></tr>';
  return '<div class="act-scoped-card"><div class="act-section-title">Role-Based Unit Economics</div><table class="act-data-table"><thead><tr><th>Role</th><th>Avg Cost / Call</th><th>Volume Signal</th><th>Planning Note</th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

function actPercentile(values, p) {
  if (!values.length) return null;
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var idx = (p / 100) * (sorted.length - 1);
  var lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Computes the What-If percentile inputs separately from rendering — the
// resulting data is applied to window._actWhatIf and actUpdateWhatIf() is
// called directly by actRenderPlan() after the innerHTML swap, since a
// <script> tag embedded via innerHTML never executes (a DOM/HTML spec
// behavior, not a bug in this app) — this must NOT be reintroduced as an
// inline <script> inside the returned HTML string.
function actComputeWhatIfData(rows) {
  var productGroups = actGroupSum(rows, function (r) { return r.product_id || (actIsCrossProductCaller(r.caller) ? '__cross_product__' : '__unassigned__'); });
  var productCosts = Object.keys(productGroups).filter(function (k) { return k !== '__unassigned__' && k !== '__cross_product__'; }).map(function (k) { return productGroups[k].cost; });
  var userGroups = actGroupSum(rows, function (r) { return r.user_id || '__unknown__'; });
  var userCosts = Object.keys(userGroups).map(function (k) { return userGroups[k].cost; });
  var enoughProducts = productCosts.length >= 2, enoughUsers = userCosts.length >= 2;
  return {
    pLow: enoughProducts ? actPercentile(productCosts, 25) : null,
    pHigh: enoughProducts ? actPercentile(productCosts, 75) : null,
    uLow: enoughUsers ? actPercentile(userCosts, 25) : null,
    uHigh: enoughUsers ? actPercentile(userCosts, 75) : null,
    enough: enoughProducts && enoughUsers
  };
}

function actRenderWhatIf(whatIfData) {
  var warn = !whatIfData.enough ? '<div class="act-scoped-card-note" style="color:var(--amber);">Too few existing products or users this period to derive a meaningful percentile range — shown once more data accumulates.</div>' : '';
  return '<div class="act-scoped-card"><div class="act-section-title">What-If Scenario</div>' +
    '<div class="act-config-grid">' +
    '<div class="act-field"><div class="act-field-label">Additional Products</div><input id="act-whatif-products" type="number" min="0" value="1" oninput="actUpdateWhatIf()"></div>' +
    '<div class="act-field"><div class="act-field-label">Additional Users</div><input id="act-whatif-users" type="number" min="0" value="5" oninput="actUpdateWhatIf()"></div>' +
    '<div class="act-field"><div class="act-field-label">Usage Intensity</div><select id="act-whatif-intensity" onchange="actUpdateWhatIf()"><option value="1">Current Mix</option><option value="0.7">Low</option><option value="1.35">High</option></select></div>' +
    '<div class="act-field"><div class="act-field-label">Projected Add-On <span class="act-computed-tag">(computed)</span></div><input id="act-whatif-output" type="text" value="—" readonly aria-readonly="true"></div>' +
    '</div>' + warn +
    '<div class="act-scoped-card-note">Percentiles are recomputed from this period’s actual per-product and per-user spend each time this screen loads, not hardcoded.</div></div>';
}

function actUpdateWhatIf() {
  var w = window._actWhatIf;
  var out = document.getElementById('act-whatif-output');
  if (!w || !out) return;
  if (!w.enough) { out.value = 'Not enough data yet'; return; }
  var products = Math.max(0, Number((document.getElementById('act-whatif-products') || {}).value || 0));
  var users = Math.max(0, Number((document.getElementById('act-whatif-users') || {}).value || 0));
  var intensity = Number((document.getElementById('act-whatif-intensity') || {}).value || 1);
  var low = (products * w.pLow + users * w.uLow) * intensity;
  var high = (products * w.pHigh + users * w.uHigh) * intensity;
  out.value = actFmtUSD0(low) + ' - ' + actFmtUSD0(high);
}

function actRenderOpportunities(rows) {
  var opps = actComputeOpportunities(rows);
  window._actOppData = opps;
  var cards = opps.map(function (opp, idx) {
    var rankTag = '<span class="act-opp-rank">#' + (idx + 1) + (opp.type === 3 ? ' · Governance' : '') + '</span>';
    var amountHtml = opp.type === 3
      ? '<div class="act-opp-gap">' + actFmtUSD0(opp.savings) + ' attribution gap</div><div class="act-opp-sub">not counted as savings until attribution is fixed</div>'
      : '<div class="act-opp-savings">' + actFmtUSD0(opp.savings) + '/mo</div><div class="act-opp-sub">estimated ' + (opp.type === 1 ? 'savings opportunity' : 'avoidable spend') + '</div>';
    var meta = opp.confidence
      ? '<span class="act-opp-chip ' + (opp.confidence === 'High' ? 'ok' : opp.confidence === 'Low' ? 'warn' : '') + '">' + opp.confidence + ' confidence</span>'
      : '<span class="act-opp-chip">Measured, not estimated — no confidence factor applies</span>';
    var action = opp.type === 1
      ? '<button class="act-btn act-btn-secondary act-btn-sm" onclick="actOpenOppModal(' + idx + ')">View Supporting Calls</button>'
      : opp.type === 2
      ? '<button class="act-btn act-btn-secondary act-btn-sm" onclick="actGoToBreakdown(\'prompt\')">Open Prompt View</button>'
      : '<button class="act-btn act-btn-secondary act-btn-sm" onclick="actGoToBreakdown(\'product\')">Investigate</button>';
    return '<div class="act-opp-card"><div class="act-opp-head"><div class="act-opp-title">' + actEsc(opp.title) + '</div>' + rankTag + '</div>' +
      amountHtml + '<div class="act-opp-evidence">' + actEsc(opp.evidence) + '</div>' +
      '<div class="act-opp-meta">' + meta + '</div><div class="act-opp-action">' + action + '</div></div>';
  }).join('') || '<div class="act-empty-state"><div class="act-empty-state-title">No opportunities identified this period.</div></div>';

  return '<div class="act-section-title-row"><div><div class="act-section-title">Top Optimization Opportunities</div>' +
    '<div class="act-section-insight" style="margin-bottom:0;">Ranked by estimated dollar impact, not a normalized score — v1 has no distribution of past scores to normalize against yet.</div></div></div>' +
    '<div class="act-opportunity-grid">' + cards + '</div>';
}

function actOpenOppModal(idx) {
  var opp = (window._actOppData || [])[idx];
  if (!opp || !opp.supportingCalls) return;
  document.getElementById('act-modal-title').textContent = 'Supporting Calls: ' + opp.title;
  var rowsHtml = opp.supportingCalls.map(function (r) {
    return '<tr><td>' + new Date(r.request_started_at).toLocaleTimeString() + '</td><td>' + Math.round((r.request_bytes || 0) / 1024) + ' KB</td><td>' + ((r.duration_ms || 0) / 1000).toFixed(1) + 's</td><td>' + (TIER_LABEL[r.tier] || 'Untiered') + '</td><td>' + actFmtUSD(r.calculated_cost) + '</td></tr>';
  }).join('');
  document.getElementById('act-modal-body').innerHTML =
    '<div class="act-section-insight" style="margin-bottom:10px;">Up to 5 example calls from the actual qualifying segment this period.</div>' +
    '<table class="act-data-table"><thead><tr><th>Time</th><th>Request Size</th><th>Duration</th><th>Current Tier</th><th>Actual Cost</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
    '<div class="act-scoped-card-note">The estimate is based on the full qualifying segment (' + opp.segmentCount + ' calls this period), not these rows alone.</div>';
  actShowModal();
}

// Shared modal show/hide — adds the focus trap and capture-phase Escape
// handler DESIGN_SYSTEM.md's Modal Construction Standard requires (§8),
// which the two callers above previously skipped by toggling the overlay
// classes directly. Self-contained rather than loading utils.js's
// trapFocus() (this page is deliberately standalone), but follows the same
// contract: trap Tab/Shift+Tab inside the dialog, close on Escape, and
// clean up both listeners when the modal closes.
var _actModalFocusCleanup = null;
function _actModalEscHandler(ev) {
  if (ev.key === 'Escape') actCloseModal();
}
function _actTrapFocus(container) {
  var focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return null;
  var first = focusable[0], last = focusable[focusable.length - 1];
  first.focus();
  function handleTab(ev) {
    if (ev.key !== 'Tab') return;
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', handleTab);
  return function () { container.removeEventListener('keydown', handleTab); };
}
function actShowModal() {
  document.getElementById('act-modal-overlay').classList.add('open');
  var box = document.getElementById('act-modal-box');
  box.classList.add('open');
  document.addEventListener('keydown', _actModalEscHandler, true);
  if (_actModalFocusCleanup) _actModalFocusCleanup();
  _actModalFocusCleanup = _actTrapFocus(box);
}
function actCloseModal() {
  document.getElementById('act-modal-overlay').classList.remove('open');
  document.getElementById('act-modal-box').classList.remove('open');
  document.removeEventListener('keydown', _actModalEscHandler, true);
  if (_actModalFocusCleanup) { _actModalFocusCleanup(); _actModalFocusCleanup = null; }
}

function actRenderOpportunityMatrix(rows) {
  var groups = actGroupSum(rows, function (r) { return actFeatureOf(r.caller); });
  var keys = Object.keys(groups);
  if (!keys.length) return '<div class="act-section-title">Opportunity Matrix</div><div class="act-empty-state"><div class="act-empty-state-title">No data for this period.</div></div>';

  var points = keys.map(function (k) {
    var g = groups[k];
    return { name: k, calls: g.calls, cost: g.cost, avgCost: g.calls ? g.cost / g.calls : 0 };
  });
  var overallAvg = points.reduce(function (s, p) { return s + p.avgCost; }, 0) / points.length;
  var maxCalls = Math.max.apply(null, points.map(function (p) { return p.calls; })) || 1;
  var maxAvg = Math.max.apply(null, points.map(function (p) { return p.avgCost; })) || 1;
  var maxCost = Math.max.apply(null, points.map(function (p) { return p.cost; })) || 1;
  var minCost = Math.min.apply(null, points.map(function (p) { return p.cost; })) || 0;

  var dots = points.map(function (p) {
    var xPct = 8 + (p.calls / maxCalls) * 84;
    var yPct = 8 + (p.avgCost / maxAvg) * 84;
    var size = 16 + ((maxCost > minCost) ? ((p.cost - minCost) / (maxCost - minCost)) * 26 : 13);
    var flagged = p.avgCost > overallAvg * 1.5;
    return '<div class="act-matrix-dot' + (flagged ? ' flagged' : '') + '" style="left:' + xPct + '%;bottom:' + yPct + '%;width:' + size + 'px;height:' + size + 'px;">' +
      '<div class="act-matrix-tooltip"><b>' + actEsc(p.name) + '</b>' + actFmtNum(p.calls) + ' calls · ' + actFmtUSD0(p.cost) + ' total<br>' + actFmtUSD(p.avgCost) + ' avg cost/call</div></div>' +
      '<div class="act-matrix-dot-label" style="left:' + xPct + '%;bottom:' + (yPct + 4) + '%;">' + actEsc(p.name) + '</div>';
  }).join('');

  var flaggedNames = points.filter(function (p) { return p.avgCost > overallAvg * 1.5; }).map(function (p) { return p.name; });

  return '<div class="act-section-title">Opportunity Matrix</div>' +
    '<div class="act-section-insight">X-axis is call volume, Y-axis is average cost per call, bubble size is total spend, red indicates average cost/call above 1.5× the cross-feature average this period. Hover a bubble for exact figures.</div>' +
    '<div class="act-matrix-wrap"><div class="act-matrix-axis-label" style="bottom:5px;left:50%;transform:translateX(-50%);">Call volume &rarr;</div>' +
    '<div class="act-matrix-axis-label" style="left:9px;top:50%;transform:rotate(-90deg) translateX(50%);transform-origin:left;">Avg cost / call &rarr;</div>' +
    '<div class="act-matrix-plot">' +
    '<div class="act-matrix-quad-label" style="top:7px;left:7px;">High Cost / Low Volume</div><div class="act-matrix-quad-label" style="top:7px;right:7px;">High Cost / High Volume</div>' +
    '<div class="act-matrix-quad-label" style="bottom:7px;left:7px;">Low Cost / Low Volume</div><div class="act-matrix-quad-label" style="bottom:7px;right:7px;">Low Cost / High Volume</div>' +
    dots + '</div>' +
    '<div class="act-matrix-legend"><div class="act-legend-items"><span><span class="act-legend-dot red"></span>Flagged (&gt;1.5× avg cost/call)</span><span><span class="act-legend-dot"></span>Normal</span><span>Bubble size = total spend</span></div></div></div>' +
    (flaggedNames.length ? '<div class="act-callout card"><div><b>Flagged:</b> ' + flaggedNames.map(actEsc).join(', ') + ' exceed 1.5× the average cost per call across all plotted features this period.</div></div>' : '');
}

function actRenderBudgetAlerts() {
  var spendSoFar = actSumCost(actMain.rows);
  var amount = actBudget ? Number(actBudget.amount) : 0;
  var warnPct = actBudget ? Number(actBudget.warn_threshold_pct) : 80;
  var escPct = actBudget ? Number(actBudget.escalate_threshold_pct) : 90;
  var usedPct = amount ? Math.min(100, spendSoFar / amount * 100) : 0;
  var barColor = !actBudget ? 'var(--divider)' : (usedPct >= escPct ? 'var(--red)' : (usedPct >= warnPct ? 'var(--amber)' : 'var(--purple)'));
  var daysInMonth = Math.round((actMain.end - actMain.start) / 86400000);
  var daysRemaining = Math.max(0, daysInMonth - Math.floor((actMain.now - actMain.start) / 86400000));

  var alertRows = actAlerts.map(function (a) {
    var isEsc = a.threshold_type === 'escalate';
    return '<div class="act-alert-row"><div class="act-alert-row-top"><span class="act-alert-level ' + (isEsc ? 'escalate' : 'warn') + '">' + a.threshold_type + '</span><span class="act-alert-title">Spend crossed ' + Number(a.threshold_pct) + '% of the monthly budget.</span><span class="act-alert-date">' + new Date(a.created_at).toLocaleDateString() + '</span></div>' +
      '<div class="act-alert-what">' + (isEsc ? 'Admins were notified. No automatic action fires yet, since enforcement actions are v1.1.' : 'Admins were notified. No automatic action fires at the Warn level.') + '</div>' +
      (a.status === 'open' ? '<button class="act-btn act-btn-secondary act-btn-sm" onclick="actAcknowledgeAlert(\'' + a.alert_id + '\')">Acknowledge</button>' : '<div class="act-alert-ack-done">Acknowledged ' + (a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleDateString() : '') + '</div>') +
      '</div>';
  }).join('') || '<div class="act-alert-row"><div class="act-alert-what">No alerts yet for the active budget.</div></div>';

  return '<div class="act-section-title">Budget &amp; Alert Readiness</div>' +
    '<div class="act-planning-grid"><div>' +
    '<div class="act-budget-card"><div class="act-budget-top"><div class="act-budget-name">Overall Monthly Budget</div><div class="act-budget-figures">' + actFmtUSD0(spendSoFar) + ' of ' + (actBudget ? actFmtUSD0(amount) : 'not set') + '</div></div>' +
    '<div class="act-budget-bar-track"><div class="act-budget-bar-fill" style="width:' + usedPct + '%;background:' + barColor + ';"></div></div>' +
    '<div class="act-budget-foot"><span>' + usedPct.toFixed(0) + '% used</span><span>' + daysRemaining + ' days remaining</span></div></div>' +
    '<div class="act-alert-list">' + alertRows + '</div>' +
    '</div>' +
    '<div class="act-config-card"><div class="act-section-title">Budget Configuration</div>' +
    '<div class="act-config-grid">' +
    '<div class="act-field"><div class="act-field-label">Monthly Budget</div><input id="act-cfg-amount" type="number" min="0" step="1" value="' + (actBudget ? amount : '') + '"></div>' +
    '<div class="act-field"><div class="act-field-label">Warn Threshold %</div><input id="act-cfg-warn" type="number" min="1" max="99" value="' + warnPct + '"></div>' +
    '<div class="act-field"><div class="act-field-label">Escalate Threshold %</div><input id="act-cfg-escalate" type="number" min="1" max="100" value="' + escPct + '"></div>' +
    '<div class="act-field"><div class="act-field-label">Action At Escalate</div><select id="act-cfg-action"><option value="notify">Notify Only</option><option value="restrict_tier" disabled>Restrict to Economical Tier (v1.1)</option><option value="stop" disabled>Stop AI Usage (v1.1)</option></select><div class="act-field-hint">Live enforcement actions arrive in v1.1.</div></div>' +
    '</div><div class="act-config-footer"><button class="act-btn act-btn-primary act-btn-sm" onclick="actSaveBudget()">Save Configuration</button></div>' +
    '</div></div>';
}

async function actSaveBudget() {
  var client = authInit();
  var amount = Number(document.getElementById('act-cfg-amount').value || 0);
  var warn = Number(document.getElementById('act-cfg-warn').value || 80);
  var esc = Number(document.getElementById('act-cfg-escalate').value || 90);
  if (!amount || amount <= 0) { actToast('Enter a monthly budget amount greater than 0.', 'error'); return; }
  if (esc <= warn) { actToast('Escalate threshold must be greater than Warn threshold.', 'error'); return; }
  try {
    var result = await client.rpc('mt_ai_budget_upsert', {
      p_company_id: actCompanyId, p_amount: amount, p_currency: 'USD',
      p_warn_threshold_pct: warn, p_escalate_threshold_pct: esc,
      p_enforcement_mode: 'monitor', p_action_on_breach: 'notify'
    });
    if (result.error) throw result.error;
    actBudget = result.data;
    actToast('Budget configuration saved.', 'success');
    actRenderOverview();
    actRenderPlan();
  } catch (err) {
    console.error('[Cost Tower] budget save failed:', err);
    actToast('Could not save budget configuration.', 'error');
  }
}

async function actAcknowledgeAlert(alertId) {
  var client = authInit();
  try {
    var result = await client.rpc('mt_ai_alert_acknowledge', { p_alert_id: alertId });
    if (result.error) throw result.error;
    await actLoadBudgetAndAlerts();
    actRenderPlan();
    actToast('Alert acknowledged.', 'success');
  } catch (err) {
    console.error('[Cost Tower] alert acknowledge failed:', err);
    actToast('Could not acknowledge alert.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════
// Export — same html2canvas + jsPDF pattern as Outcome Pulse's
// opDownloadReport() (scripts/outcome-pulse.js), reused rather than
// reinvented (spec Section 3.1).
// ══════════════════════════════════════════════════════════════════════

var _actHtml2CanvasPromise = null;
async function _actLoadHtml2Canvas() {
  if (typeof html2canvas !== 'undefined') return true;
  if (_actHtml2CanvasPromise) return _actHtml2CanvasPromise;
  _actHtml2CanvasPromise = new Promise(function (res) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    s.onload = function () { res(true); };
    s.onerror = function () { _actHtml2CanvasPromise = null; res(false); };
    document.head.appendChild(s);
  });
  return _actHtml2CanvasPromise;
}
var _actJsPDFPromise = null;
async function _actLoadJsPDF() {
  if (typeof window.jspdf !== 'undefined') return true;
  if (_actJsPDFPromise) return _actJsPDFPromise;
  _actJsPDFPromise = new Promise(function (res) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    s.onload = function () { res(true); };
    s.onerror = function () { _actJsPDFPromise = null; res(false); };
    document.head.appendChild(s);
  });
  return _actJsPDFPromise;
}

async function actDownloadReport(screen) {
  var btn = document.getElementById('act-export-' + screen + '-btn');
  var target = document.getElementById('act-export-' + screen + '-target');
  var exportHeader = document.getElementById('act-export-' + screen + '-header');
  if (!target) return;
  if (exportHeader) {
    exportHeader.textContent = (actCompanyName ? actCompanyName + ' - ' : '') + 'AI Cost Control Tower - ' + ACT_SCREEN_NAMES[screen];
    exportHeader.style.display = 'block';
  }
  var origHtml = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = 'Preparing...'; }
  try {
    var ok1 = await _actLoadHtml2Canvas(), ok2 = await _actLoadJsPDF();
    if (!ok1 || !ok2) throw new Error('Could not load PDF export libraries.');
    var canvas = await html2canvas(target, { backgroundColor: '#ffffff', scale: 2 });
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF('p', 'pt', 'a4');
    var pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    var margin = 36, usableWidth = pageWidth - margin * 2, usableHeight = pageHeight - margin * 2;
    var imgWidth = usableWidth, imgHeight = (canvas.height * imgWidth) / canvas.width;
    var imgData = canvas.toDataURL('image/png');
    var heightRemaining = imgHeight, pageIndex = 0;
    while (heightRemaining > 0) {
      if (pageIndex > 0) pdf.addPage();
      var yOffset = margin - (pageIndex * usableHeight);
      pdf.addImage(imgData, 'PNG', margin, yOffset, imgWidth, imgHeight);
      heightRemaining -= usableHeight;
      pageIndex++;
    }
    pdf.save((actCompanyName ? actCompanyName.replace(/\s+/g, '_') + '_' : '') + 'AI_Cost_' + ACT_SCREEN_NAMES[screen].replace(/[^A-Za-z0-9]+/g, '_') + '.pdf');
  } catch (err) {
    console.error('[Cost Tower] PDF export failed:', err);
    actToast('PDF export failed. Please try again.', 'error');
  } finally {
    if (exportHeader) exportHeader.style.display = 'none';
    if (btn) { btn.disabled = false; if (origHtml !== null) btn.innerHTML = origHtml; }
  }
}
