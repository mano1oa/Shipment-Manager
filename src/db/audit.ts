import { getDb } from './neon.js';

/**
 * Minimal audit trail writer on the existing `system_audit_logs` table.
 *
 * The table has no actor columns, so the acting user's id/email are stored in
 * `details` (JSONB) to avoid a schema migration.
 *
 * Never pass secrets (passwords, tokens, API keys) in `details`.
 * An audit failure is logged server-side and never breaks the business action.
 */

export interface AuditActor {
  id: string;
  email: string;
  role: string;
}

let auditSchemaPromise: Promise<void> | null = null;

function ensureAuditSchema(): Promise<void> {
  if (!auditSchemaPromise) {
    const sql = getDb();
    auditSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS system_audit_logs (
          id BIGSERIAL PRIMARY KEY,
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(50) NOT NULL,
          action VARCHAR(50) NOT NULL,
          user_role VARCHAR(50),
          details JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `;
      // History of one entity (timeline of a parcel)
      await sql`CREATE INDEX IF NOT EXISTS idx_system_audit_logs_entity ON system_audit_logs (entity_type, entity_id);`;
    })().catch((err) => {
      auditSchemaPromise = null;
      throw err;
    });
  }
  return auditSchemaPromise;
}

export async function writeAuditLog(params: {
  entityType: string;
  entityId: string;
  action: string;
  actor: AuditActor;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ensureAuditSchema();
    const sql = getDb();

    const details = JSON.stringify({
      ...(params.details || {}),
      actor_id: params.actor.id,
      actor_email: params.actor.email,
    });

    await sql`
      INSERT INTO system_audit_logs (entity_type, entity_id, action, user_role, details)
      VALUES (
        ${params.entityType},
        ${String(params.entityId).slice(0, 50)},
        ${params.action},
        ${params.actor.role},
        ${details}::jsonb
      )
    `;
  } catch (err: any) {
    console.error('[Audit] Failed to write audit log:', params.action, err?.message || err);
  }
}

export interface AuditLogEntry {
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

/** Latest audit rows of one entity (at most `limit`), oldest first. */
export async function listAuditLogs(entityType: string, entityId: string, limit = 300): Promise<AuditLogEntry[]> {
  await ensureAuditSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT action, details, created_at FROM system_audit_logs
    WHERE entity_type = ${entityType} AND entity_id = ${String(entityId).slice(0, 50)}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return (rows as unknown as AuditLogEntry[]).reverse();
}
