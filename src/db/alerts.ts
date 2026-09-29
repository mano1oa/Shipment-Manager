import { getDb } from './neon.js';

/**
 * Shared alert resolution state (replaces the former per-browser localStorage).
 *
 * Alert IDs are deterministic (e.g. ALT-ORLY-<shipmentId>), produced by
 * evaluateShipmentRules() in src/lib/rulesEngine.ts, which is NOT modified.
 * One row per resolved alert; reopening an alert deletes its row (the history
 * of resolve/reopen actions lives in system_audit_logs).
 */

export interface ResolvedAlertRecord {
  alert_id: string;
  shipment_id: string | null;
  rule_code: string | null;
  resolved_by_user_id: string;
  resolved_by_email: string;
  resolved_by_name: string | null;
  resolved_at: string;
  resolution_note: string | null;
}

let alertsSchemaPromise: Promise<void> | null = null;

export function ensureAlertsSchema(): Promise<void> {
  if (!alertsSchemaPromise) {
    const sql = getDb();
    alertsSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS resolved_alerts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          alert_id VARCHAR(100) NOT NULL UNIQUE,
          shipment_id VARCHAR(50),
          rule_code VARCHAR(50),
          resolved_by_user_id UUID NOT NULL,
          resolved_by_email VARCHAR(255) NOT NULL,
          resolved_by_name VARCHAR(100),
          resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolution_note TEXT
        );
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_resolved_alerts_shipment_id
          ON resolved_alerts (shipment_id);
      `;
    })().catch((err) => {
      alertsSchemaPromise = null; // allow retry on next call
      throw err;
    });
  }
  return alertsSchemaPromise;
}

export async function listResolvedAlerts(): Promise<ResolvedAlertRecord[]> {
  await ensureAlertsSchema();
  const sql = getDb();

  const rows = await sql`
    SELECT
      alert_id, shipment_id, rule_code,
      resolved_by_user_id, resolved_by_email, resolved_by_name,
      resolved_at, resolution_note
    FROM resolved_alerts
    ORDER BY resolved_at DESC
  `;

  return rows as unknown as ResolvedAlertRecord[];
}

/**
 * Marks an alert as resolved. Idempotent: if another user already resolved it,
 * the existing record is returned unchanged (`created: false`).
 */
export async function resolveAlert(params: {
  alertId: string;
  shipmentId: string | null;
  ruleCode: string | null;
  user: { id: string; email: string; display_name?: string | null };
  note: string | null;
}): Promise<{ record: ResolvedAlertRecord; created: boolean }> {
  await ensureAlertsSchema();
  const sql = getDb();

  const inserted = await sql`
    INSERT INTO resolved_alerts (
      alert_id, shipment_id, rule_code,
      resolved_by_user_id, resolved_by_email, resolved_by_name,
      resolution_note
    )
    VALUES (
      ${params.alertId}, ${params.shipmentId}, ${params.ruleCode},
      ${params.user.id}, ${params.user.email}, ${params.user.display_name ?? null},
      ${params.note}
    )
    ON CONFLICT (alert_id) DO NOTHING
    RETURNING
      alert_id, shipment_id, rule_code,
      resolved_by_user_id, resolved_by_email, resolved_by_name,
      resolved_at, resolution_note
  `;

  if (inserted[0]) {
    return { record: inserted[0] as ResolvedAlertRecord, created: true };
  }

  const existing = await sql`
    SELECT
      alert_id, shipment_id, rule_code,
      resolved_by_user_id, resolved_by_email, resolved_by_name,
      resolved_at, resolution_note
    FROM resolved_alerts
    WHERE alert_id = ${params.alertId}
    LIMIT 1
  `;
  return { record: existing[0] as ResolvedAlertRecord, created: false };
}

/**
 * Reopens an alert. Returns the removed record, or null if it was not resolved.
 */
export async function unresolveAlert(alertId: string): Promise<ResolvedAlertRecord | null> {
  await ensureAlertsSchema();
  const sql = getDb();

  const rows = await sql`
    DELETE FROM resolved_alerts
    WHERE alert_id = ${alertId}
    RETURNING
      alert_id, shipment_id, rule_code,
      resolved_by_user_id, resolved_by_email, resolved_by_name,
      resolved_at, resolution_note
  `;
  return (rows[0] as ResolvedAlertRecord) ?? null;
}
