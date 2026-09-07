// AI Cost Control Tower: OpenAPI Ingestion Layer — /v1/usage-events
// Spec: ai-cost-tower-openapi-ingestion-spec.md v0.11, Sections 5, 6.
//
// Exported as a factory(supabaseAdmin) — see middleware/apiKeyAuth.js's
// header comment for why (no supabaseAdmin export from server.js to avoid
// a require() cycle).

const express = require('express');
const { insertIdempotent } = require('../../lib/costTower/idempotency');
const { updateUnitsGenerated } = require('../../lib/costTower/unitsGenerated');

const STATUS_VALUES = ['success', 'error', 'timeout'];
const REQUIRED_FIELDS = ['client_call_id', 'user_role_at_call', 'caller', 'requested_model', 'status', 'request_started_at'];
const BATCH_CAP = 500;

function _validateItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return 'Item must be an object.';
  }
  for (const field of REQUIRED_FIELDS) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      return 'Missing required field: ' + field;
    }
  }
  if (STATUS_VALUES.indexOf(item.status) === -1) {
    return 'status must be one of: ' + STATUS_VALUES.join(', ');
  }
  if (Number.isNaN(Date.parse(item.request_started_at))) {
    return 'request_started_at must be a valid ISO 8601 timestamp.';
  }
  return null;
}

// last_activity_at auto-bump (Section 5) — ownership-checked, silent skip
// on no match. A mismatched outcome_id is more likely a caller-side bug
// than an attack, and erroring would leak whether a given UUID exists at
// all (same reasoning as the PATCH /v1/outcomes/{id} 404 below).
async function _bumpOutcomeActivity(supabaseAdmin, companyId, appId, outcomeId) {
  try {
    await supabaseAdmin
      .from('mt_outcomes')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('outcome_id', outcomeId)
      .eq('company_id', companyId)
      .eq('app_id', appId);
  } catch (e) {
    console.error('[V1 USAGE-EVENTS] last_activity_at bump failed:', e.message);
  }
}

function _buildRow(item, companyId, appId) {
  // settings_mode/selection_rule default to 'external' when omitted — this
  // route is the consumer-tier ingestion surface, never Product Studio's
  // own /api/anthropic path, so defaulting unconditionally (rather than
  // conditioning on appId !== 'product-studio') matches every real caller
  // this endpoint will ever see.
  return {
    company_id: companyId,
    app_id: appId,
    client_call_id: item.client_call_id,
    provider: item.provider || 'anthropic',
    product_id: item.product_id != null ? item.product_id : null,
    session_id: item.session_id != null ? item.session_id : null,
    user_id: item.user_id != null ? item.user_id : null,
    user_role_at_call: item.user_role_at_call,
    caller: item.caller,
    requested_model: item.requested_model,
    response_model: item.response_model != null ? item.response_model : null,
    settings_mode: item.settings_mode || 'external',
    selection_rule: item.selection_rule || 'external',
    input_tokens: item.input_tokens != null ? item.input_tokens : null,
    output_tokens: item.output_tokens != null ? item.output_tokens : null,
    cache_creation_5m_tokens: item.cache_creation_5m_tokens != null ? item.cache_creation_5m_tokens : null,
    cache_creation_1h_tokens: item.cache_creation_1h_tokens != null ? item.cache_creation_1h_tokens : null,
    cache_read_tokens: item.cache_read_tokens != null ? item.cache_read_tokens : null,
    provider_usage_raw: item.provider_usage_raw != null ? item.provider_usage_raw : null,
    status: item.status,
    provider_http_status: item.provider_http_status != null ? item.provider_http_status : null,
    error_type: item.error_type != null ? item.error_type : null,
    failure_phase: item.failure_phase != null ? item.failure_phase : null,
    request_started_at: item.request_started_at,
    duration_ms: item.duration_ms != null ? item.duration_ms : null,
    request_bytes: item.request_bytes != null ? item.request_bytes : null,
    response_bytes: item.response_bytes != null ? item.response_bytes : null,
    outcome_id: item.outcome_id != null ? item.outcome_id : null,
    units_generated: item.units_generated != null ? item.units_generated : null
  };
}

// Ownership check before insert — without this, a caller-supplied
// outcome_id from a DIFFERENT (company_id, app_id) would still satisfy the
// plain FK on mt_ai_usage_events.outcome_id (existence only, not
// ownership) and persist a permanent cross-tenant reference. Mirrors the
// same ownership check PATCH /v1/outcomes/{id} already does before acting.
async function _verifyOutcomeOwnership(supabaseAdmin, companyId, appId, outcomeId) {
  const { data, error } = await supabaseAdmin
    .from('mt_outcomes')
    .select('outcome_id')
    .eq('outcome_id', outcomeId)
    .eq('company_id', companyId)
    .eq('app_id', appId)
    .maybeSingle();
  if (error) {
    console.error('[V1 USAGE-EVENTS] outcome ownership check failed:', error.message);
    return false;
  }
  return !!data;
}

async function _processItem(supabaseAdmin, item, companyId, appId) {
  const validationError = _validateItem(item);
  if (validationError) {
    return { error: { type: 'invalid_request', message: validationError } };
  }

  if (item.outcome_id != null) {
    const owned = await _verifyOutcomeOwnership(supabaseAdmin, companyId, appId, item.outcome_id);
    if (!owned) {
      return { error: { type: 'invalid_request', message: 'outcome_id does not exist or does not belong to this credential.' } };
    }
  }

  const row = _buildRow(item, companyId, appId);
  const result = await insertIdempotent(supabaseAdmin, {
    table: 'mt_ai_usage_events',
    conflictColumns: ['company_id', 'app_id', 'client_call_id'],
    row: row,
    idColumn: 'id'
  });

  if (result.error) {
    // 23503 = foreign_key_violation — same translation outcomes.js already
    // does for its own FK (e.g. a bad outcome_type_id); without this, a
    // permanent client input error (a stale/bad reference) surfaced as an
    // undifferentiated 500 instead of a 400.
    if (result.error.code === '23503') {
      return { error: { type: 'invalid_request', message: 'One of the referenced ids (e.g. outcome_id) does not exist.' } };
    }
    console.error('[V1 USAGE-EVENTS] insert failed:', result.error.message);
    return { error: { type: 'server_error', message: 'Could not record usage event.' } };
  }

  // Bump fires on both a fresh insert and a deduplicated replay — a retried
  // call that happens to be the one carrying outcome_id shouldn't lose the
  // bump just because it was a duplicate delivery.
  if (row.outcome_id) {
    await _bumpOutcomeActivity(supabaseAdmin, companyId, appId, row.outcome_id);
  }

  return { id: result.id, deduplicated: result.deduplicated };
}

module.exports = function usageEventsRouterFactory(supabaseAdmin) {
  const router = express.Router();

  // POST /v1/usage-events — single object or array (Section 6).
  router.post('/usage-events', async function (req, res) {
    const body = req.body;

    if (body === undefined || body === null || (typeof body !== 'object')) {
      return res.status(400).json({ error: { type: 'invalid_request', message: 'Request body must be a JSON object or array.' } });
    }

    const isBatch = Array.isArray(body);
    const items = isBatch ? body : [body];

    if (isBatch && items.length > BATCH_CAP) {
      return res.status(400).json({ error: { type: 'invalid_request', message: 'Batch exceeds the maximum of ' + BATCH_CAP + ' items.' } });
    }
    if (isBatch && items.length === 0) {
      return res.status(400).json({ error: { type: 'invalid_request', message: 'Batch must contain at least one item.' } });
    }

    // A single malformed item never discards the rest of the batch — these
    // are independent cost/telemetry records, not a transaction (Section 6
    // batch semantics). Each item is processed independently, in order.
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const outcome = await _processItem(supabaseAdmin, items[i], req.companyId, req.appId);
      results.push(outcome.error ? { index: i, error: outcome.error } : { index: i, id: outcome.id, deduplicated: outcome.deduplicated });
    }

    if (!isBatch) {
      const only = results[0];
      if (only.error) return res.status(400).json({ error: only.error });
      return res.status(200).json({ id: only.id, deduplicated: only.deduplicated });
    }

    return res.status(200).json({ results: results });
  });

  // PATCH /v1/usage-events/{client_call_id}/units-generated — idempotent,
  // scoped to (company_id, app_id, client_call_id).
  router.patch('/usage-events/:client_call_id/units-generated', async function (req, res) {
    const unitsGenerated = req.body ? req.body.units_generated : undefined;
    if (typeof unitsGenerated !== 'number' || !Number.isInteger(unitsGenerated) || unitsGenerated < 0) {
      return res.status(400).json({ error: { type: 'invalid_request', message: 'units_generated must be an integer >= 0.' } });
    }

    const { data, error } = await updateUnitsGenerated(supabaseAdmin, {
      companyId: req.companyId,
      appId: req.appId,
      clientCallId: req.params.client_call_id,
      unitsGenerated: unitsGenerated
    });

    if (error) {
      console.error('[V1 USAGE-EVENTS] units-generated update failed:', error.message);
      return res.status(500).json({ error: { type: 'server_error', message: 'Could not update units_generated.' } });
    }
    if (!data) {
      return res.status(404).json({ error: { type: 'not_found', message: 'No usage event found for this client_call_id.' } });
    }

    return res.status(200).json({ id: data.id, units_generated: unitsGenerated });
  });

  // GET /v1/usage-events — reconciliation read-back, not a dashboard
  // replacement. Direct query, never mt_ai_cost_events_list (finding #5 —
  // that RPC's auth check assumes a human Supabase Auth session).
  router.get('/usage-events', async function (req, res) {
    const start = req.query.start;
    const end = req.query.end;
    if (!start || Number.isNaN(Date.parse(start)) || !end || Number.isNaN(Date.parse(end))) {
      return res.status(400).json({ error: { type: 'invalid_request', message: 'start and end are required, valid ISO 8601 timestamps.' } });
    }

    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit)) limit = 200;
    if (limit < 1) limit = 1;
    if (limit > 1000) limit = 1000;

    // cursor: opaque to the caller, a base64-encoded JSON [request_started_at, id]
    // tuple of the last row in the prior page — keyset pagination, not offset,
    // so it stays stable and performant as new events are written concurrently.
    let cursorTimestamp = null;
    let cursorId = null;
    if (req.query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(String(req.query.cursor), 'base64').toString('utf8'));
        if (!Array.isArray(decoded) || decoded.length !== 2 || Number.isNaN(Date.parse(decoded[0]))) throw new Error('shape');
        // Re-serialize through Date rather than trusting the decoded string
        // verbatim, and restrict cursorId to a safe charset — both values
        // get spliced into a raw PostgREST filter string below, and neither
        // was previously validated for filter metacharacters (comma/parens),
        // which Date.parse's own lenient formats (e.g. its own toString())
        // can contain.
        if (!/^[a-zA-Z0-9-]+$/.test(String(decoded[1]))) throw new Error('id');
        cursorTimestamp = new Date(decoded[0]).toISOString();
        cursorId = decoded[1];
      } catch (e) {
        return res.status(400).json({ error: { type: 'invalid_request', message: 'Malformed cursor.' } });
      }
    }

    let query = supabaseAdmin
      .from('mt_ai_usage_events')
      .select('id, request_started_at, provider, requested_model, response_model, caller, session_id, user_id, user_role_at_call, status, error_type, failure_phase, duration_ms, request_bytes, response_bytes, input_tokens, output_tokens, cache_creation_5m_tokens, cache_creation_1h_tokens, cache_read_tokens, outcome_id, units_generated')
      .eq('company_id', req.companyId)
      .eq('app_id', req.appId)
      .gte('request_started_at', start)
      .lt('request_started_at', end)
      .order('request_started_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (cursorTimestamp) {
      query = query.or('request_started_at.lt.' + cursorTimestamp + ',and(request_started_at.eq.' + cursorTimestamp + ',id.lt.' + cursorId + ')');
    }

    const { data: events, error } = await query;
    if (error) {
      console.error('[V1 USAGE-EVENTS] read failed:', error.message);
      return res.status(500).json({ error: { type: 'server_error', message: 'Could not read usage events.' } });
    }

    // calculated_cost is application-computed here, not via the RPC's own
    // formula call site — same pricing-table shape and range-match logic
    // as mt_ai_cost_events_list (sql/ai-cost-tower-outcomes-v2-migration.sql),
    // deliberately not reused directly since that RPC's own auth check is
    // the human-session dependency this endpoint exists to avoid.
    const pairs = Array.from(new Set(events.map(function (e) { return e.provider + ' ' + (e.response_model || e.requested_model); })));
    let pricingRows = [];
    if (pairs.length > 0) {
      const providers = Array.from(new Set(events.map(function (e) { return e.provider; })));
      const { data: pricing, error: pricingError } = await supabaseAdmin
        .from('mt_model_pricing')
        .select('provider, model_name, effective_from, effective_to, tier, input_price_per_mtok, output_price_per_mtok, cache_write_5m_price_per_mtok, cache_write_1h_price_per_mtok, cache_read_price_per_mtok')
        .in('provider', providers);
      if (pricingError) {
        console.error('[V1 USAGE-EVENTS] pricing lookup failed:', pricingError.message);
      } else {
        pricingRows = pricing || [];
      }
    }

    function _findPricing(event) {
      const modelName = event.response_model || event.requested_model;
      const at = new Date(event.request_started_at).getTime();
      return pricingRows.find(function (p) {
        if (p.provider !== event.provider || p.model_name !== modelName) return false;
        const from = new Date(p.effective_from).getTime();
        const to = p.effective_to ? new Date(p.effective_to).getTime() : null;
        return at >= from && (to === null || at < to);
      }) || null;
    }

    const enriched = events.map(function (e) {
      const pricing = _findPricing(e);
      let calculatedCost = null;
      if (pricing) {
        calculatedCost =
          ((e.input_tokens || 0) / 1000000) * pricing.input_price_per_mtok +
          ((e.output_tokens || 0) / 1000000) * pricing.output_price_per_mtok +
          ((e.cache_creation_5m_tokens || 0) / 1000000) * pricing.cache_write_5m_price_per_mtok +
          ((e.cache_creation_1h_tokens || 0) / 1000000) * pricing.cache_write_1h_price_per_mtok +
          ((e.cache_read_tokens || 0) / 1000000) * pricing.cache_read_price_per_mtok;
      }
      return Object.assign({}, e, { calculated_cost: calculatedCost });
    });

    let nextCursor = null;
    if (events.length === limit) {
      const last = events[events.length - 1];
      nextCursor = Buffer.from(JSON.stringify([last.request_started_at, last.id])).toString('base64');
    }

    return res.status(200).json({ events: enriched, next_cursor: nextCursor });
  });

  return router;
};
