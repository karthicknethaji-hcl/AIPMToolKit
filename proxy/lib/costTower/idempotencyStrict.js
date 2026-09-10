// AI Trace Layer — strict-comparison idempotency helper
// Spec: ai-trace-layer-spec-v0.11-final.md, Part D.0.
//
// insertIdempotent() (./idempotency.js) treats any conflict as a successful
// dedup, handing back the existing row's id with no regard for whether the
// caller's OTHER fields match. That's correct for a plain re-send of an
// identical event, but wrong wherever the idempotency key alone isn't
// enough — e.g. POST /v1/traces replaying client_trace_id with a DIFFERENT
// agent_name/session_id is a genuine caller error, not a safe no-op.
//
// This wraps insertIdempotent() (unmodified, still used as-is elsewhere)
// and adds exactly one thing: on a conflict, re-fetch the existing row's
// compareColumns and reject with IDEMPOTENCY_CONFLICT if any differ from
// what this call would have inserted. Modeled on outcomeTypes.js's existing
// hand-rolled compare-then-409 pattern rather than inventing a new shape.

const { insertIdempotent } = require('./idempotency');

async function insertIdempotentStrict(supabaseAdmin, { table, conflictColumns, row, idColumn, compareColumns }) {
  const base = await insertIdempotent(supabaseAdmin, { table, conflictColumns, row, idColumn });
  if (base.error || !base.deduplicated) return base; // fresh insert, or a real error — nothing to compare

  const matchFilter = {};
  conflictColumns.forEach(function(col) { matchFilter[col] = row[col]; });

  const { data: existing, error } = await supabaseAdmin
    .from(table)
    .select(compareColumns.join(','))
    .match(matchFilter)
    .maybeSingle();

  if (error) return { error: error };

  const mismatch = compareColumns.some(function(col) { return existing[col] !== row[col]; });
  if (mismatch) {
    return { error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Replay with the same idempotency key but different ' + compareColumns.join('/') + '.' } };
  }

  return base;
}

module.exports = { insertIdempotentStrict };
