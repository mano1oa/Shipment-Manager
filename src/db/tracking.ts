import crypto from 'crypto';
import { getDb } from './neon.js';
import {
  CarrierCode,
  CARRIER_CODES,
  detectTrackingNumber,
  splitTrackingInput,
} from '../lib/carrierDetection.js';

/**
 * Tracking data model (Neon = source of truth).
 *
 * - shipment_tracking_numbers: one row per carrier tracking number. A shipment
 *   can have several (the RECEP file often lists several parcels per order).
 *   Numbers are stored as TEXT (never numeric: Excel truncation issues).
 * - shipment_tracking_events: event history per tracking number, deduplicated.
 *   `source` tells where each event came from (manual, carrier API, report…).
 *
 * Rule: nothing is ever simulated. A provider failure records `last_error`
 * and leaves the existing status and events untouched.
 */

export const TRACKING_STATUSES = [
  'UNKNOWN',
  'INFO_RECEIVED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
] as const;

export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export const EVENT_SOURCES = ['manual', 'carrier_api', 'amazon_report', 'webhook', 'import'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export interface TrackingNumberRecord {
  id: string;
  shipment_id: string;
  tracking_number: string;
  raw_input: string;
  carrier: CarrierCode;
  status: TrackingStatus;
  status_label: string | null;
  last_event_at: string | null;
  delivered_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrackingEventRecord {
  id: string;
  tracking_number_id: string;
  event_at: string;
  status: TrackingStatus;
  description: string;
  location: string | null;
  source: EventSource;
  created_by_email: string | null;
  created_at: string;
}

const NUMBER_COLUMNS = `
  id, shipment_id, tracking_number, raw_input, carrier, status, status_label,
  last_event_at, delivered_at, last_checked_at, last_error, is_active,
  created_at, updated_at
`;

let trackingSchemaPromise: Promise<void> | null = null;

export function ensureTrackingSchema(): Promise<void> {
  if (!trackingSchemaPromise) {
    trackingSchemaPromise = initTrackingSchema().catch((err) => {
      trackingSchemaPromise = null;
      throw err;
    });
  }
  return trackingSchemaPromise;
}

async function initTrackingSchema(): Promise<void> {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS shipment_tracking_numbers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      tracking_number VARCHAR(100) NOT NULL,
      raw_input VARCHAR(255) NOT NULL DEFAULT '',
      carrier VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
      status VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
      status_label TEXT,
      last_event_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      last_checked_at TIMESTAMPTZ,
      last_error TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (shipment_id, tracking_number)
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tracking_numbers_number
      ON shipment_tracking_numbers (tracking_number);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tracking_numbers_sync
      ON shipment_tracking_numbers (is_active, status, last_checked_at);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS shipment_tracking_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tracking_number_id UUID NOT NULL
        REFERENCES shipment_tracking_numbers(id) ON DELETE CASCADE,
      event_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
      description TEXT NOT NULL,
      location TEXT,
      source VARCHAR(20) NOT NULL,
      dedupe_key VARCHAR(64) NOT NULL,
      raw_payload JSONB,
      created_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tracking_number_id, dedupe_key)
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tracking_events_number_time
      ON shipment_tracking_events (tracking_number_id, event_at DESC);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS app_migrations (
      key VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await backfillFromLegacyTrackingColumn();
}

/**
 * One-time copy of the legacy shipments.tracking_no text into the new table.
 * Guarded by app_migrations so removed numbers are never re-added.
 */
async function backfillFromLegacyTrackingColumn(): Promise<void> {
  const sql = getDb();

  const claimed = await sql`
    INSERT INTO app_migrations (key)
    VALUES ('backfill_tracking_numbers_v1')
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `;
  if (!claimed[0]) return;

  const rows = await sql`
    SELECT id, tracking_no FROM shipments
    WHERE tracking_no IS NOT NULL AND TRIM(tracking_no) <> ''
  `;

  let inserted = 0;
  for (const row of rows as Array<{ id: string; tracking_no: string }>) {
    for (const part of splitTrackingInput(row.tracking_no)) {
      const detected = detectTrackingNumber(part);
      if (!detected.number) continue;
      const res = await sql`
        INSERT INTO shipment_tracking_numbers (shipment_id, tracking_number, raw_input, carrier)
        VALUES (${row.id}, ${detected.number.slice(0, 100)}, ${detected.raw.slice(0, 255)}, ${detected.carrier})
        ON CONFLICT (shipment_id, tracking_number) DO NOTHING
        RETURNING id
      `;
      if (res[0]) inserted++;
    }
  }
  console.log(`[Tracking] Legacy backfill: ${inserted} tracking number(s) copied.`);
}

export function isCarrierCode(value: unknown): value is CarrierCode {
  return typeof value === 'string' && (CARRIER_CODES as readonly string[]).includes(value);
}

export function isTrackingStatus(value: unknown): value is TrackingStatus {
  return typeof value === 'string' && (TRACKING_STATUSES as readonly string[]).includes(value);
}

export async function listTrackingForShipment(shipmentId: string): Promise<{
  numbers: TrackingNumberRecord[];
  events: TrackingEventRecord[];
}> {
  await ensureTrackingSchema();
  const sql = getDb();

  const numbers = (await sql.query(
    `SELECT ${NUMBER_COLUMNS} FROM shipment_tracking_numbers
     WHERE shipment_id = $1 ORDER BY created_at ASC`,
    [shipmentId]
  )) as unknown as TrackingNumberRecord[];

  if (numbers.length === 0) return { numbers, events: [] };

  const events = (await sql`
    SELECT id, tracking_number_id, event_at, status, description, location,
           source, created_by_email, created_at
    FROM shipment_tracking_events
    WHERE tracking_number_id = ANY(${numbers.map((n) => n.id)}::uuid[])
    ORDER BY event_at DESC
  `) as unknown as TrackingEventRecord[];

  return { numbers, events };
}

export async function getTrackingNumber(id: string): Promise<TrackingNumberRecord | null> {
  await ensureTrackingSchema();
  const sql = getDb();
  const rows = await sql.query(
    `SELECT ${NUMBER_COLUMNS} FROM shipment_tracking_numbers WHERE id = $1 LIMIT 1`,
    [id]
  );
  return (rows[0] as TrackingNumberRecord) ?? null;
}

export class DuplicateTrackingNumberError extends Error {}

export async function addTrackingNumber(params: {
  shipmentId: string;
  number: string;
  rawInput: string;
  carrier: CarrierCode;
}): Promise<TrackingNumberRecord> {
  await ensureTrackingSchema();
  const sql = getDb();

  const rows = await sql.query(
    `INSERT INTO shipment_tracking_numbers (shipment_id, tracking_number, raw_input, carrier)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (shipment_id, tracking_number) DO NOTHING
     RETURNING ${NUMBER_COLUMNS}`,
    [params.shipmentId, params.number.slice(0, 100), params.rawInput.slice(0, 255), params.carrier]
  );
  if (!rows[0]) throw new DuplicateTrackingNumberError('Tracking number already attached');
  return rows[0] as TrackingNumberRecord;
}

/**
 * Attaches every number found in a free-text field (used at shipment creation).
 * Entries that are clearly not tracking numbers are skipped.
 */
export async function addTrackingNumbersFromText(
  shipmentId: string,
  text: string
): Promise<TrackingNumberRecord[]> {
  const added: TrackingNumberRecord[] = [];
  for (const part of splitTrackingInput(text)) {
    const detected = detectTrackingNumber(part);
    if (!detected.number || detected.warnings.includes('NOT_A_TRACKING_NUMBER')) continue;
    try {
      added.push(
        await addTrackingNumber({
          shipmentId,
          number: detected.number,
          rawInput: detected.raw,
          carrier: detected.carrier,
        })
      );
    } catch (err) {
      if (!(err instanceof DuplicateTrackingNumberError)) throw err;
    }
  }
  return added;
}

export async function updateTrackingNumber(
  id: string,
  changes: { carrier?: CarrierCode; is_active?: boolean }
): Promise<TrackingNumberRecord | null> {
  await ensureTrackingSchema();
  const sql = getDb();
  const rows = await sql.query(
    `UPDATE shipment_tracking_numbers
     SET carrier = COALESCE($2, carrier),
         is_active = COALESCE($3, is_active),
         updated_at = NOW()
     WHERE id = $1
     RETURNING ${NUMBER_COLUMNS}`,
    [id, changes.carrier ?? null, changes.is_active ?? null]
  );
  return (rows[0] as TrackingNumberRecord) ?? null;
}

export async function deleteTrackingNumber(id: string): Promise<TrackingNumberRecord | null> {
  await ensureTrackingSchema();
  const sql = getDb();
  const rows = await sql.query(
    `DELETE FROM shipment_tracking_numbers WHERE id = $1 RETURNING ${NUMBER_COLUMNS}`,
    [id]
  );
  return (rows[0] as TrackingNumberRecord) ?? null;
}

function dedupeKey(eventAt: string, description: string, location: string | null): string {
  return crypto
    .createHash('sha256')
    .update(`${new Date(eventAt).toISOString()}|${description.trim()}|${(location || '').trim()}`)
    .digest('hex');
}

export interface NewTrackingEvent {
  eventAt: string; // ISO date/time
  status: TrackingStatus;
  description: string;
  location?: string | null;
  source: EventSource;
  rawPayload?: unknown;
  createdByEmail?: string | null;
}

/**
 * Inserts events (duplicates ignored) and refreshes the tracking number's
 * current status from its most recent event. Returns the number of new events.
 */
export async function recordTrackingEvents(
  trackingNumberId: string,
  events: NewTrackingEvent[]
): Promise<number> {
  await ensureTrackingSchema();
  const sql = getDb();

  let inserted = 0;
  for (const ev of events) {
    const rows = await sql`
      INSERT INTO shipment_tracking_events (
        tracking_number_id, event_at, status, description, location,
        source, dedupe_key, raw_payload, created_by_email
      )
      VALUES (
        ${trackingNumberId}, ${ev.eventAt}, ${ev.status}, ${ev.description.slice(0, 2000)},
        ${ev.location ? ev.location.slice(0, 500) : null}, ${ev.source},
        ${dedupeKey(ev.eventAt, ev.description, ev.location ?? null)},
        ${ev.rawPayload === undefined ? null : JSON.stringify(ev.rawPayload)}::jsonb,
        ${ev.createdByEmail ?? null}
      )
      ON CONFLICT (tracking_number_id, dedupe_key) DO NOTHING
      RETURNING id
    `;
    if (rows[0]) inserted++;
  }

  await refreshStatusFromEvents(trackingNumberId);
  return inserted;
}

async function refreshStatusFromEvents(trackingNumberId: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE shipment_tracking_numbers n
    SET
      status = latest.status,
      status_label = latest.description,
      last_event_at = latest.event_at,
      delivered_at = COALESCE(
        (SELECT MIN(e.event_at) FROM shipment_tracking_events e
          WHERE e.tracking_number_id = n.id AND e.status = 'DELIVERED'),
        n.delivered_at
      ),
      updated_at = NOW()
    FROM (
      SELECT status, description, event_at
      FROM shipment_tracking_events
      WHERE tracking_number_id = ${trackingNumberId}
      ORDER BY event_at DESC, created_at DESC
      LIMIT 1
    ) latest
    WHERE n.id = ${trackingNumberId}
  `;
}

/** Records a sync attempt (success clears the error, failure keeps data intact). */
export async function markSyncAttempt(trackingNumberId: string, error: string | null): Promise<void> {
  await ensureTrackingSchema();
  const sql = getDb();
  await sql`
    UPDATE shipment_tracking_numbers
    SET last_checked_at = NOW(),
        last_error = ${error ? error.slice(0, 500) : null}
    WHERE id = ${trackingNumberId}
  `;
}

/**
 * Tracking numbers due for an automatic refresh: active, not delivered,
 * least recently checked first.
 */
export async function listNumbersDueForSync(
  carriers: CarrierCode[],
  limit: number
): Promise<TrackingNumberRecord[]> {
  await ensureTrackingSchema();
  if (carriers.length === 0) return [];
  const sql = getDb();
  const rows = await sql.query(
    `SELECT ${NUMBER_COLUMNS} FROM shipment_tracking_numbers
     WHERE is_active = TRUE
       AND status <> 'DELIVERED'
       AND carrier = ANY($1::text[])
     ORDER BY last_checked_at ASC NULLS FIRST
     LIMIT $2`,
    [carriers, limit]
  );
  return rows as unknown as TrackingNumberRecord[];
}

export async function listNumbersForShipment(shipmentId: string): Promise<TrackingNumberRecord[]> {
  return (await listTrackingForShipment(shipmentId)).numbers;
}
