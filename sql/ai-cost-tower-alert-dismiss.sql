-- ═══════════════════════════════════════════════════════════════════
-- AI Control Tower: alert dismiss + alert-list period scoping
-- Run in Supabase SQL editor. Both dev (pgt-dev) and prod — the base
-- AI Control Tower migrations are already applied to both.
-- Per AI_EDITING_RULES.md: NOT run by Claude Code. Write to disk only:
-- Nethaji runs this against Supabase on his own timeline.
--
-- Purpose: the AI Governance screen's alert list had no bound on how
-- many rows it could ever show (mt_ai_alerts_list() returned every
-- alert ever generated, with no period filter and no LIMIT, and
-- "Acknowledge" never removed a row from the list). This adds a real,
-- persisted "dismiss" action — separate from acknowledge — that
-- permanently removes an alert from what the screen shows, plus scopes
-- the list itself to the current and prior month so it can't grow
-- unbounded even before anyone dismisses anything.
--
-- Verify the auto-generated constraint name below before running, per
-- this project's standing caution against assuming schema shape:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'mt_ai_alerts'::regclass AND contype = 'c';
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE mt_ai_alerts
  ADD COLUMN IF NOT EXISTS dismissed_by UUID,
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- Widen the status enum to add 'dismissed', alongside the existing
-- 'open'/'acknowledged'/'resolved'. mt_ai_alerts_status_check is
-- Postgres's auto-generated name for the original inline CHECK
-- (single column, unnamed) — confirmed against the live schema before
-- writing this, not assumed; re-added with an explicit name so future
-- changes don't depend on the auto-naming convention again.
ALTER TABLE mt_ai_alerts
  DROP CONSTRAINT IF EXISTS mt_ai_alerts_status_check;
ALTER TABLE mt_ai_alerts
  ADD CONSTRAINT mt_ai_alerts_status_check
  CHECK (status IN ('open','acknowledged','resolved','dismissed'));

-- The existing ack-consistency check only knew about 'open' and
-- ('acknowledged','resolved') — widened so 'dismissed' is a valid
-- terminal state regardless of whether the alert was ever acknowledged
-- first (dismiss works on a still-open alert too, per the reviewed
-- wireframe), without loosening the original two branches at all.
ALTER TABLE mt_ai_alerts
  DROP CONSTRAINT IF EXISTS mt_ai_alerts_ack_consistency;
ALTER TABLE mt_ai_alerts
  ADD CONSTRAINT mt_ai_alerts_ack_consistency
  CHECK (
    (status = 'open' AND acknowledged_by IS NULL AND acknowledged_at IS NULL) OR
    (status IN ('acknowledged','resolved') AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL) OR
    (status = 'dismissed')
  );

-- Matching symmetric check for the new dismissed_by/dismissed_at pair,
-- same pattern as the ack-consistency check above.
ALTER TABLE mt_ai_alerts
  ADD CONSTRAINT mt_ai_alerts_dismiss_consistency
  CHECK (
    (status != 'dismissed' AND dismissed_by IS NULL AND dismissed_at IS NULL) OR
    (status = 'dismissed' AND dismissed_by IS NOT NULL AND dismissed_at IS NOT NULL)
  );

-- mt_ai_alert_dismiss(): mirrors mt_ai_alert_acknowledge()'s exact
-- shape (same admin-authorization join, same UPDATE...RETURNING
-- pattern) — deliberately allowed from ANY current status except
-- already-dismissed (an open alert can be dismissed directly, without
-- being acknowledged first), unlike acknowledge which only ever
-- applies to 'open'.
CREATE OR REPLACE FUNCTION mt_ai_alert_dismiss(p_alert_id UUID)
RETURNS mt_ai_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller  UUID := current_app_user();
  v_company UUID;
  v_row     mt_ai_alerts;
BEGIN
  SELECT b.company_id INTO v_company
  FROM mt_ai_alerts a JOIN mt_ai_budgets b ON b.budget_id = a.budget_id
  WHERE a.alert_id = p_alert_id;

  IF v_company IS NULL OR NOT _cost_tower_is_admin(v_company) THEN
    RAISE EXCEPTION 'Not authorized to dismiss alert %', p_alert_id;
  END IF;

  UPDATE mt_ai_alerts
  SET status = 'dismissed', dismissed_by = v_caller, dismissed_at = now()
  WHERE alert_id = p_alert_id AND status != 'dismissed'
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Alert % not found or already dismissed', p_alert_id;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION mt_ai_alert_dismiss(UUID) TO authenticated;

-- mt_ai_alerts_list(): excludes dismissed rows (permanent removal from
-- what the screen shows) and scopes to the current + prior calendar
-- month by period_start, rather than returning every alert ever
-- generated. UTC boundary, matching this project's server-side "current
-- month" convention (proxy/server.js's _utcMonthBoundary()) rather than
-- the browser-local convention the rest of this page's own period math
-- uses — this is a period.start DATE comparison, not a live timestamp
-- check, so the distinction is low-stakes here either way.
CREATE OR REPLACE FUNCTION mt_ai_alerts_list(p_company_id UUID)
RETURNS SETOF mt_ai_alerts
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.* FROM mt_ai_alerts a
  JOIN mt_ai_budgets b ON b.budget_id = a.budget_id
  WHERE b.company_id = p_company_id
    AND _cost_tower_is_admin(p_company_id)
    AND a.status != 'dismissed'
    AND a.period_start >= (date_trunc('month', now() AT TIME ZONE 'UTC') - INTERVAL '1 month')::date
  ORDER BY a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION mt_ai_alerts_list(UUID) TO authenticated;

-- ─── Verification ────────────────────────────────────────────────────
-- 1. Columns + constraints exist:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'mt_ai_alerts' AND column_name IN ('dismissed_by','dismissed_at');
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'mt_ai_alerts'::regclass AND contype = 'c';
--
-- 2. Dismissing an open alert works without acknowledging first, and
--    a dismissed alert no longer appears in mt_ai_alerts_list():
-- SELECT mt_ai_alert_dismiss('<open alert_id>');
-- SELECT * FROM mt_ai_alerts_list('<company_id>');
--
-- 3. An alert older than the prior calendar month no longer appears
--    even if never dismissed:
-- SELECT alert_id, period_start FROM mt_ai_alerts_list('<company_id>')
-- WHERE period_start < (date_trunc('month', now() AT TIME ZONE 'UTC') - INTERVAL '1 month')::date;
-- -- expect zero rows
