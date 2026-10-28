import crypto from 'crypto';
import { getDb } from './neon.js';
import { ensureNeonSchema } from './shipments.js';
import { isServiceLabel, mergeServiceLines, trackingSupplierName } from '../lib/digiInvoices.js';
import type { DigiInvoiceInput, DigiInvoiceLineInput } from '../lib/digiInvoices.js';
import { initParcelSchema } from './parcelSchema.js';
import { amountInEur } from '../lib/parcelTracking.js';
import type { Currency, InvoiceTriage, ValidationStatus } from '../lib/parcelTracking.js';
import type { DirectInvoiceInput } from '../lib/directInvoices.js';

/**
 * DIGI LOGISTIC invoices addressed to NextHope ("colis à suivre").
 *
 * - digi_invoices: one row per invoice (Odoo account.move, Excel import or
 *   manual entry). `source` tells where it came from.
 * - digi_invoice_lines: the product lines of each invoice.
 *
 * Odoo rows are identified by `odoo_move_id` and are read-only in the app:
 * every sync replaces their content with what Odoo holds. Excel and manual rows
 * are identified by (supplier, invoice ref) and can be edited by hand.
 *
 * Rule: nothing is invented. An unknown value stays NULL.
 */

export const DIGI_INVOICE_SOURCES = ['odoo', 'excel', 'manual'] as const;
export type DigiInvoiceSource = (typeof DIGI_INVOICE_SOURCES)[number];

export interface OdooInvoiceInput extends Omit<DigiInvoiceInput, 'supplier_name' | 'ref'> {
  // Odoo may leave them empty (e.g. draft bills): stored as NULL, never invented.
  supplier_name: string | null;
  ref: string | null;
  odoo_move_id: number;
  odoo_move_name: string | null;
  odoo_state: string | null;
  odoo_write_date: string | null;
  supplier_odoo_id: number | null;
  dest_partner_odoo_id: number | null;
  sale_move_odoo_id: number | null;
}

export interface DigiInvoiceLineRecord {
  id: string;
  position: number;
  name: string;
  quantity: number | null;
  price_unit: number | null;
  price_subtotal: number | null;
  is_service: boolean;
}

export interface DigiInvoiceRecord {
  id: string;
  source: DigiInvoiceSource;
  supplier_name: string | null;
  /** AMAZON for an Amazon order, else supplier_name (see trackingSupplierName). */
  supplier_display: string | null;
  dest_partner_name: string | null;
  ref: string | null;
  invoice_date: string | null;
  amazon_order_ref: string | null;
  sale_move_ref: string | null;
  odoo_move_id: number | null;
  odoo_move_name: string | null;
  odoo_state: string | null;
  odoo_missing: boolean;
  odoo_synced_at: string | null;
  amount_total: number | null;
  /** Shipment created for this invoice (null = none yet). */
  shipment_id: string | null;
  /** False when the linked shipment has been deleted since. */
  shipment_exists: boolean;
  shipment_mode: 'Air' | 'Sea' | null;
  shipment_global_status: string | null;
  /** Marked by hand as services only: nothing to ship (manual work). */
  no_shipment: boolean;
  /** At least one item line (not a fee/service line). */
  has_items: boolean;
  /** False for a "hors DIGI" invoice entered by hand (amount + currency, no lines). */
  is_digi: boolean;
  /** Hors DIGI: amount in `currency`. DIGI: total of the lines (EUR). */
  currency: Currency;
  buyer: string | null;
  validation_status: ValidationStatus;
  rejection_reason: string | null;
  validated_by_email: string | null;
  validated_at: string | null;
  /** Manual sort: only "goods" invoices are tracked (parcels, loss alerts). */
  triage: InvoiceTriage;
  triaged_at: string | null;
  parcel_count: number;
  parcel_received_count: number;
  created_by_email: string | null;
  updated_by_email: string | null;
  created_at: string;
  updated_at: string;
  lines: DigiInvoiceLineRecord[];
}

export class DuplicateDigiInvoiceError extends Error {
  constructor(public existingId: string) {
    super('Invoice already exists');
  }
}

export class ReadOnlyDigiInvoiceError extends Error {
  constructor() {
    super('Odoo invoices are read-only');
  }
}

/** A DIGI invoice edited as "hors DIGI", or the reverse. */
export class WrongInvoiceKindError extends Error {
  constructor() {
    super('Wrong invoice kind (DIGI / hors DIGI)');
  }
}

let digiSchemaPromise: Promise<void> | null = null;

export function ensureDigiInvoicesSchema(): Promise<void> {
  if (!digiSchemaPromise) {
    digiSchemaPromise = initDigiInvoicesSchema().catch((err) => {
      digiSchemaPromise = null;
      throw err;
    });
  }
  return digiSchemaPromise;
}

async function initDigiInvoicesSchema(): Promise<void> {
  // digi_invoices is joined with shipments: make sure that table exists
  await ensureNeonSchema();
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS digi_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source VARCHAR(10) NOT NULL CHECK (source IN ('odoo', 'excel', 'manual')),
      supplier_name VARCHAR(255),
      supplier_odoo_id INTEGER,
      dest_partner_name VARCHAR(255),
      dest_partner_odoo_id INTEGER,
      ref VARCHAR(255),
      invoice_date DATE,
      amazon_order_ref VARCHAR(255),
      sale_move_ref VARCHAR(255),
      sale_move_odoo_id INTEGER,
      odoo_move_id INTEGER UNIQUE,
      odoo_move_name VARCHAR(255),
      odoo_state VARCHAR(30),
      odoo_write_date VARCHAR(30),
      odoo_missing BOOLEAN NOT NULL DEFAULT FALSE,
      odoo_synced_at TIMESTAMPTZ,
      created_by_email VARCHAR(255),
      updated_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  // Same supplier + same invoice ref = same invoice, whatever its source.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_digi_invoices_supplier_ref_ci
      ON digi_invoices (LOWER(TRIM(supplier_name)), LOWER(TRIM(ref)))
      WHERE odoo_move_id IS NULL;
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_digi_invoices_date ON digi_invoices (invoice_date DESC);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_digi_invoices_amazon ON digi_invoices (amazon_order_ref);`;

  await sql`
    CREATE TABLE IF NOT EXISTS digi_invoice_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES digi_invoices(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      quantity NUMERIC(14, 4),
      price_unit NUMERIC(14, 4),
      price_subtotal NUMERIC(14, 2),
      odoo_line_id INTEGER
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_digi_invoice_lines_invoice
      ON digi_invoice_lines (invoice_id, position);
  `;

  // Link to the shipment created for the invoice, services flag (v2)
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS shipment_id VARCHAR(50);`;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS shipment_created_at TIMESTAMPTZ;`;
  await sql`ALTER TABLE digi_invoices ADD COLUMN IF NOT EXISTS no_shipment BOOLEAN NOT NULL DEFAULT FALSE;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_digi_invoices_shipment ON digi_invoices (shipment_id);`;
  await sql`ALTER TABLE digi_invoice_lines ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE;`;

  await sql`
    CREATE TABLE IF NOT EXISTS app_migrations (
      key VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await mergeExistingServiceLines();

  // History of Odoo syncs (manual button or daily cron)
  await sql`
    CREATE TABLE IF NOT EXISTS digi_odoo_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      trigger VARCHAR(10) NOT NULL CHECK (trigger IN ('manual', 'cron')),
      actor_email VARCHAR(255),
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      success BOOLEAN NOT NULL,
      result JSONB,
      error TEXT
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_digi_odoo_sync_runs_started
      ON digi_odoo_sync_runs (started_at DESC);
  `;

  // Parcel model: "hors DIGI" invoices, sort, parcels (v3)
  await initParcelSchema();
}

/**
 * One-time: merge the fee lines (DEEE, RCP, FRDP) of invoices stored before
 * the rule existed. Odoo invoices are simply re-read at the next sync.
 */
async function mergeExistingServiceLines(): Promise<void> {
  const sql = getDb();
  const key = 'digi_merge_service_lines_v1';
  const done = await sql`SELECT 1 FROM app_migrations WHERE key = ${key}`;
  if (done.length > 0) return;

  await sql`UPDATE digi_invoices SET odoo_write_date = NULL WHERE odoo_move_id IS NOT NULL`;

  const rows = await sql`
    SELECT i.id,
      json_agg(json_build_object(
        'name', l.name, 'quantity', l.quantity, 'price_unit', l.price_unit,
        'price_subtotal', l.price_subtotal, 'odoo_line_id', l.odoo_line_id
      ) ORDER BY l.position) AS lines
    FROM digi_invoices i JOIN digi_invoice_lines l ON l.invoice_id = i.id
    WHERE i.odoo_move_id IS NULL
    GROUP BY i.id
  `;
  for (const row of rows as any[]) {
    const lines: DigiInvoiceLineInput[] = row.lines.map((l: any) => ({
      name: l.name,
      quantity: toNumber(l.quantity),
      price_unit: toNumber(l.price_unit),
      price_subtotal: toNumber(l.price_subtotal),
      odoo_line_id: l.odoo_line_id,
    }));
    if (!lines.some((l) => isServiceLabel(l.name))) continue;
    await sql.transaction(replaceLinesQueries(row.id, mergeServiceLines(lines)));
  }

  await sql`INSERT INTO app_migrations (key) VALUES (${key}) ON CONFLICT DO NOTHING`;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapInvoiceRow(row: any): DigiInvoiceRecord {
  const lines: DigiInvoiceLineRecord[] = (row.lines || []).map((line: any) => ({
    id: line.id,
    position: line.position,
    name: line.name,
    quantity: toNumber(line.quantity),
    price_unit: toNumber(line.price_unit),
    price_subtotal: toNumber(line.price_subtotal),
    is_service: Boolean(line.is_service),
  }));

  const isDigi = row.is_digi !== false;
  const linesTotal = lines.some((l) => l.price_subtotal !== null)
    ? Math.round(lines.reduce((sum, l) => sum + (l.price_subtotal ?? 0), 0) * 100) / 100
    : null;

  return {
    id: row.id,
    source: row.source,
    supplier_name: row.supplier_name,
    supplier_display: trackingSupplierName(row.supplier_name, row.amazon_order_ref),
    dest_partner_name: row.dest_partner_name,
    ref: row.ref,
    invoice_date: row.invoice_date,
    amazon_order_ref: row.amazon_order_ref,
    sale_move_ref: row.sale_move_ref,
    odoo_move_id: row.odoo_move_id,
    odoo_move_name: row.odoo_move_name,
    odoo_state: row.odoo_state,
    odoo_missing: row.odoo_missing,
    odoo_synced_at: row.odoo_synced_at,
    amount_total: isDigi ? linesTotal : toNumber(row.amount),
    shipment_id: row.shipment_id,
    shipment_exists: Boolean(row.shipment_exists),
    shipment_mode: row.shipment_mode ?? null,
    shipment_global_status: row.shipment_global_status ?? null,
    no_shipment: Boolean(row.no_shipment),
    has_items: lines.some((l) => !l.is_service),
    is_digi: isDigi,
    currency: isDigi ? 'EUR' : (row.currency as Currency) || 'EUR',
    buyer: row.buyer ?? null,
    validation_status: (row.validation_status as ValidationStatus) || 'validated',
    rejection_reason: row.rejection_reason ?? null,
    validated_by_email: row.validated_by_email ?? null,
    validated_at: row.validated_at ?? null,
    triage: (row.triage as InvoiceTriage) || (row.no_shipment ? 'services' : 'to_sort'),
    triaged_at: row.triaged_at ?? null,
    parcel_count: Number(row.parcel_count) || 0,
    parcel_received_count: Number(row.parcel_received_count) || 0,
    created_by_email: row.created_by_email,
    updated_by_email: row.updated_by_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lines,
  };
}

const SELECT_WITH_LINES = `
  SELECT
    i.id, i.source, i.supplier_name, i.dest_partner_name, i.ref,
    TO_CHAR(i.invoice_date, 'YYYY-MM-DD') AS invoice_date,
    i.amazon_order_ref, i.sale_move_ref, i.odoo_move_id, i.odoo_move_name,
    i.odoo_state, i.odoo_missing, i.odoo_synced_at,
    i.shipment_id, i.no_shipment,
    i.is_digi, i.amount, i.currency, i.buyer, i.validation_status, i.rejection_reason,
    i.validated_by_email, i.validated_at, i.triage, i.triaged_at,
    (SELECT COUNT(*)::int FROM parcel_invoices pi WHERE pi.invoice_id = i.id) AS parcel_count,
    (
      SELECT COUNT(*)::int FROM parcel_invoices pi JOIN parcels p ON p.id = pi.parcel_id
      WHERE pi.invoice_id = i.id AND p.status IN ('received', 'search')
    ) AS parcel_received_count,
    (s.id IS NOT NULL) AS shipment_exists, s.mode AS shipment_mode, s.global_status AS shipment_global_status,
    i.created_by_email, i.updated_by_email, i.created_at, i.updated_at,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'id', l.id, 'position', l.position, 'name', l.name,
          'quantity', l.quantity, 'price_unit', l.price_unit,
          'price_subtotal', l.price_subtotal, 'is_service', l.is_service
        ) ORDER BY l.position)
        FROM digi_invoice_lines l
        WHERE l.invoice_id = i.id
      ),
      '[]'::json
    ) AS lines
  FROM digi_invoices i
  LEFT JOIN shipments s ON s.id = i.shipment_id
`;

export async function listDigiInvoices(): Promise<DigiInvoiceRecord[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(
    `${SELECT_WITH_LINES} ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC`
  );
  return (rows as any[]).map(mapInvoiceRow);
}

export async function getDigiInvoice(id: string): Promise<DigiInvoiceRecord | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(`${SELECT_WITH_LINES} WHERE i.id = $1`, [id]);
  return rows[0] ? mapInvoiceRow(rows[0]) : null;
}

async function findBySupplierAndRef(
  supplierName: string,
  ref: string
): Promise<{ id: string; source: DigiInvoiceSource; odoo_move_id: number | null } | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, source, odoo_move_id
    FROM digi_invoices
    WHERE LOWER(TRIM(supplier_name)) = LOWER(TRIM(${supplierName}))
      AND LOWER(TRIM(ref)) = LOWER(TRIM(${ref}))
    ORDER BY (odoo_move_id IS NOT NULL) DESC
    LIMIT 1
  `;
  return (rows[0] as any) ?? null;
}

/**
 * Statements replacing the lines of an invoice (to run in a transaction).
 */
function replaceLinesQueries(invoiceId: string, lines: DigiInvoiceLineInput[]) {
  const sql = getDb();
  const queries = [sql`DELETE FROM digi_invoice_lines WHERE invoice_id = ${invoiceId}`];
  if (lines.length > 0) {
    queries.push(sql`
      INSERT INTO digi_invoice_lines
        (invoice_id, position, name, quantity, price_unit, price_subtotal, odoo_line_id, is_service)
      SELECT ${invoiceId}::uuid, t.position, t.name, t.quantity, t.price_unit, t.price_subtotal, t.odoo_line_id, t.is_service
      FROM UNNEST(
        ${lines.map((_, i) => i + 1)}::int[],
        ${lines.map((l) => l.name)}::text[],
        ${lines.map((l) => l.quantity)}::numeric[],
        ${lines.map((l) => l.price_unit)}::numeric[],
        ${lines.map((l) => l.price_subtotal)}::numeric[],
        ${lines.map((l) => l.odoo_line_id ?? null)}::int[],
        ${lines.map((l) => Boolean(l.is_service || isServiceLabel(l.name)))}::boolean[]
      ) AS t(position, name, quantity, price_unit, price_subtotal, odoo_line_id, is_service)
    `);
  }
  return queries;
}

/**
 * Creates an Excel-imported or manually entered invoice.
 * Throws DuplicateDigiInvoiceError when the same supplier + ref already exists.
 */
export async function createDigiInvoice(
  input: DigiInvoiceInput,
  source: 'excel' | 'manual',
  actorEmail: string
): Promise<string> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();

  const existing = await findBySupplierAndRef(input.supplier_name, input.ref);
  if (existing) throw new DuplicateDigiInvoiceError(existing.id);

  const id = crypto.randomUUID();
  try {
    await sql.transaction([
      sql`
        INSERT INTO digi_invoices (
          id, source, supplier_name, dest_partner_name, ref, invoice_date,
          amazon_order_ref, sale_move_ref, created_by_email, updated_by_email
        ) VALUES (
          ${id}, ${source}, ${input.supplier_name}, ${input.dest_partner_name}, ${input.ref},
          ${input.invoice_date}, ${input.amazon_order_ref}, ${input.sale_move_ref},
          ${actorEmail}, ${actorEmail}
        )
      `,
      ...replaceLinesQueries(id, input.lines),
    ]);
  } catch (err: any) {
    if (err?.code === '23505') {
      const raced = await findBySupplierAndRef(input.supplier_name, input.ref);
      if (raced) throw new DuplicateDigiInvoiceError(raced.id);
    }
    throw err;
  }
  return id;
}

/**
 * Updates an Excel or manual invoice (Odoo invoices are read-only).
 * Returns false when the invoice does not exist.
 */
export async function updateDigiInvoice(
  id: string,
  input: DigiInvoiceInput,
  actorEmail: string
): Promise<boolean> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();

  const rows = await sql`SELECT source, is_digi FROM digi_invoices WHERE id = ${id}`;
  if (!rows[0]) return false;
  if (rows[0].source === 'odoo') throw new ReadOnlyDigiInvoiceError();
  if (rows[0].is_digi === false) throw new WrongInvoiceKindError();

  const existing = await findBySupplierAndRef(input.supplier_name, input.ref);
  if (existing && existing.id !== id) throw new DuplicateDigiInvoiceError(existing.id);

  try {
    await sql.transaction([
      sql`
        UPDATE digi_invoices SET
          supplier_name = ${input.supplier_name},
          dest_partner_name = ${input.dest_partner_name},
          ref = ${input.ref},
          invoice_date = ${input.invoice_date},
          amazon_order_ref = ${input.amazon_order_ref},
          sale_move_ref = ${input.sale_move_ref},
          updated_by_email = ${actorEmail},
          updated_at = NOW()
        WHERE id = ${id}
      `,
      ...replaceLinesQueries(id, input.lines),
    ]);
  } catch (err: any) {
    if (err?.code === '23505') {
      const raced = await findBySupplierAndRef(input.supplier_name, input.ref);
      if (raced) throw new DuplicateDigiInvoiceError(raced.id);
    }
    throw err;
  }
  return true;
}

export async function deleteDigiInvoice(
  id: string
): Promise<{ supplier_name: string | null; ref: string | null; source: DigiInvoiceSource } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    DELETE FROM digi_invoices WHERE id = ${id}
    RETURNING supplier_name, ref, source
  `;
  return (rows[0] as any) ?? null;
}

// ---------------------------------------------------------------------------
// Odoo sync
// ---------------------------------------------------------------------------

/**
 * odoo_move_id → odoo_write_date for every invoice already synced from Odoo.
 */
export async function getOdooWriteDates(): Promise<Map<number, string | null>> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT odoo_move_id, odoo_write_date FROM digi_invoices WHERE odoo_move_id IS NOT NULL
  `;
  return new Map(rows.map((r: any) => [Number(r.odoo_move_id), r.odoo_write_date]));
}

/**
 * Inserts or replaces an invoice coming from Odoo.
 *
 * When an Excel/manual invoice with the same supplier + ref exists, it is
 * converted into the Odoo invoice (no duplicate): Odoo becomes its source.
 */
export async function upsertOdooInvoice(input: OdooInvoiceInput): Promise<'created' | 'updated'> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();

  const byOdooId = await sql`SELECT id FROM digi_invoices WHERE odoo_move_id = ${input.odoo_move_id}`;
  let id: string | null = byOdooId[0]?.id ?? null;
  let outcome: 'created' | 'updated' = 'updated';

  if (!id && input.supplier_name && input.ref) {
    const sameRef = await findBySupplierAndRef(input.supplier_name, input.ref);
    if (sameRef && sameRef.odoo_move_id === null) {
      id = sameRef.id;
    }
  }
  if (!id) {
    id = crypto.randomUUID();
    outcome = 'created';
  }

  await sql.transaction([
    sql`
      INSERT INTO digi_invoices (
        id, source, supplier_name, supplier_odoo_id, dest_partner_name, dest_partner_odoo_id,
        ref, invoice_date, amazon_order_ref, sale_move_ref, sale_move_odoo_id,
        odoo_move_id, odoo_move_name, odoo_state, odoo_write_date, odoo_missing, odoo_synced_at
      ) VALUES (
        ${id}, 'odoo', ${input.supplier_name}, ${input.supplier_odoo_id},
        ${input.dest_partner_name}, ${input.dest_partner_odoo_id},
        ${input.ref}, ${input.invoice_date}, ${input.amazon_order_ref},
        ${input.sale_move_ref}, ${input.sale_move_odoo_id},
        ${input.odoo_move_id}, ${input.odoo_move_name}, ${input.odoo_state},
        ${input.odoo_write_date}, FALSE, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        source = 'odoo',
        supplier_name = EXCLUDED.supplier_name,
        supplier_odoo_id = EXCLUDED.supplier_odoo_id,
        dest_partner_name = EXCLUDED.dest_partner_name,
        dest_partner_odoo_id = EXCLUDED.dest_partner_odoo_id,
        ref = EXCLUDED.ref,
        invoice_date = EXCLUDED.invoice_date,
        amazon_order_ref = EXCLUDED.amazon_order_ref,
        sale_move_ref = EXCLUDED.sale_move_ref,
        sale_move_odoo_id = EXCLUDED.sale_move_odoo_id,
        odoo_move_id = EXCLUDED.odoo_move_id,
        odoo_move_name = EXCLUDED.odoo_move_name,
        odoo_state = EXCLUDED.odoo_state,
        odoo_write_date = EXCLUDED.odoo_write_date,
        odoo_missing = FALSE,
        odoo_synced_at = NOW(),
        updated_at = NOW()
    `,
    ...replaceLinesQueries(id, input.lines),
  ]);

  return outcome;
}

/**
 * Flags Odoo invoices that no longer match the Odoo filter (deleted, or
 * destination changed). They are kept, never deleted silently.
 */
export async function markMissingOdooInvoices(seenOdooIds: number[]): Promise<number> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    UPDATE digi_invoices SET odoo_missing = NOT (odoo_move_id = ANY(${seenOdooIds}::int[]))
    WHERE odoo_move_id IS NOT NULL
      AND odoo_missing IS DISTINCT FROM NOT (odoo_move_id = ANY(${seenOdooIds}::int[]))
    RETURNING odoo_missing
  `;
  return rows.filter((r: any) => r.odoo_missing).length;
}

/**
 * Removes invoices cancelled in Odoo (cancelled invoices are not tracked).
 */
export async function deleteOdooInvoices(odooMoveIds: number[]): Promise<number> {
  if (odooMoveIds.length === 0) return 0;
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    DELETE FROM digi_invoices WHERE odoo_move_id = ANY(${odooMoveIds}::int[])
    RETURNING id
  `;
  return rows.length;
}

export interface DigiOdooSyncRun {
  trigger: 'manual' | 'cron';
  actor_email: string | null;
  started_at: string;
  finished_at: string;
  success: boolean;
  result: Record<string, unknown> | null;
  error: string | null;
}

export async function recordOdooSyncRun(run: Omit<DigiOdooSyncRun, 'finished_at'>): Promise<void> {
  try {
    await ensureDigiInvoicesSchema();
    const sql = getDb();
    await sql`
      INSERT INTO digi_odoo_sync_runs (trigger, actor_email, started_at, success, result, error)
      VALUES (
        ${run.trigger}, ${run.actor_email}, ${run.started_at}, ${run.success},
        ${run.result ? JSON.stringify(run.result) : null}::jsonb, ${run.error}
      )
    `;
  } catch (err: any) {
    console.error('[DIGI] Could not record sync run:', err?.message || err);
  }
}

export async function getLastOdooSyncRun(): Promise<DigiOdooSyncRun | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT trigger, actor_email, started_at, finished_at, success, result, error
    FROM digi_odoo_sync_runs
    ORDER BY started_at DESC
    LIMIT 1
  `;
  return (rows[0] as DigiOdooSyncRun) ?? null;
}

// ---------------------------------------------------------------------------
// Excel import (batched)
// ---------------------------------------------------------------------------

const IMPORT_CHUNK = 50;

function invoiceKey(supplierName: string, ref: string): string {
  return `${supplierName.trim().toLowerCase()}|${ref.trim().toLowerCase()}`;
}

/**
 * Creates many invoices at once. Invoices whose supplier + ref already exist
 * (whatever their source) are left untouched and reported as duplicates.
 */
export async function importDigiInvoices(
  inputs: DigiInvoiceInput[],
  actorEmail: string
): Promise<{ created: number; duplicates: string[] }> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();

  const existingRows = await sql`
    SELECT supplier_name, ref FROM digi_invoices
    WHERE supplier_name IS NOT NULL AND ref IS NOT NULL
  `;
  const existing = new Set(existingRows.map((r: any) => invoiceKey(r.supplier_name, r.ref)));

  const duplicates: string[] = [];
  const fresh: DigiInvoiceInput[] = [];
  for (const input of inputs) {
    const key = invoiceKey(input.supplier_name, input.ref);
    if (existing.has(key)) {
      duplicates.push(input.ref);
    } else {
      existing.add(key);
      fresh.push(input);
    }
  }

  let created = 0;
  for (let offset = 0; offset < fresh.length; offset += IMPORT_CHUNK) {
    const chunk = fresh.slice(offset, offset + IMPORT_CHUNK);
    const queries = chunk.flatMap((input) => {
      const id = crypto.randomUUID();
      return [
        sql`
          INSERT INTO digi_invoices (
            id, source, supplier_name, dest_partner_name, ref, invoice_date,
            amazon_order_ref, sale_move_ref, created_by_email, updated_by_email
          ) VALUES (
            ${id}, 'excel', ${input.supplier_name}, ${input.dest_partner_name}, ${input.ref},
            ${input.invoice_date}, ${input.amazon_order_ref}, ${input.sale_move_ref},
            ${actorEmail}, ${actorEmail}
          )
        `,
        ...replaceLinesQueries(id, input.lines),
      ];
    });

    try {
      await sql.transaction(queries);
      created += chunk.length;
    } catch (err: any) {
      if (err?.code !== '23505') throw err;
      // Concurrent creation of one of them: fall back to one by one
      for (const input of chunk) {
        try {
          await createDigiInvoice(input, 'excel', actorEmail);
          created++;
        } catch (inner) {
          if (inner instanceof DuplicateDigiInvoiceError) duplicates.push(input.ref);
          else throw inner;
        }
      }
    }
  }

  return { created, duplicates };
}

// ---------------------------------------------------------------------------
// Link with shipments
// ---------------------------------------------------------------------------

export interface InvoiceForShipment {
  id: string;
  supplier_name: string | null;
  ref: string | null;
  invoice_date: string | null;
  amazon_order_ref: string | null;
  sale_move_ref: string | null;
  odoo_move_name: string | null;
}

export async function getInvoiceForShipment(id: string): Promise<InvoiceForShipment | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT id, supplier_name, ref, TO_CHAR(invoice_date, 'YYYY-MM-DD') AS invoice_date,
      amazon_order_ref, sale_move_ref, odoo_move_name
    FROM digi_invoices WHERE id = ${id}
  `;
  return (rows[0] as InvoiceForShipment) ?? null;
}

/**
 * Reserves the invoice for a new shipment id. Returns false when the invoice
 * is marked as services or already has an existing shipment (concurrent run).
 */
export async function claimInvoiceForShipment(invoiceId: string, shipmentId: string): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`
    UPDATE digi_invoices i SET shipment_id = ${shipmentId}, shipment_created_at = NOW()
    WHERE i.id = ${invoiceId}
      AND NOT i.no_shipment
      AND (i.shipment_id IS NULL OR NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = i.shipment_id))
    RETURNING i.id
  `;
  return rows.length > 0;
}

/** Undoes a claim when the shipment could not be saved (retried next run). */
export async function releaseInvoiceClaim(invoiceId: string, shipmentId: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE digi_invoices SET shipment_id = NULL, shipment_created_at = NULL
    WHERE id = ${invoiceId} AND shipment_id = ${shipmentId}
  `;
}

/**
 * Marks an invoice as services only (nothing to ship) or back to "to ship".
 * Marking as services detaches it from its shipment, which is kept.
 */
export async function setInvoiceNoShipment(
  id: string,
  noShipment: boolean
): Promise<{ previous_shipment_id: string | null } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const before = await sql`SELECT shipment_id FROM digi_invoices WHERE id = ${id}`;
  if (!before[0]) return null;
  await sql`
    UPDATE digi_invoices SET
      no_shipment = ${noShipment},
      triage = CASE WHEN ${noShipment} THEN 'services' WHEN triage = 'services' THEN 'to_sort' ELSE triage END,
      triaged_at = NOW(),
      shipment_id = CASE WHEN ${noShipment} THEN NULL ELSE shipment_id END,
      updated_at = NOW()
    WHERE id = ${id}
  `;
  return { previous_shipment_id: noShipment ? (before[0].shipment_id as string | null) : null };
}

/**
 * Sorts a DIGI invoice: goods (tracked: parcels, loss alerts), services (out
 * of tracking, detached from its shipment) or back to "to sort".
 * `no_shipment` mirrors "services" for the screens not yet using the sort.
 */
export async function setInvoiceTriage(
  id: string,
  triage: InvoiceTriage,
  actorEmail: string
): Promise<{ previous_shipment_id: string | null } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const services = triage === 'services';
  const before = await sql`SELECT shipment_id FROM digi_invoices WHERE id = ${id}`;
  if (!before[0]) return null;
  await sql`
    UPDATE digi_invoices SET
      triage = ${triage},
      triaged_at = NOW(),
      no_shipment = ${services},
      shipment_id = CASE WHEN ${services} THEN NULL ELSE shipment_id END,
      updated_by_email = ${actorEmail},
      updated_at = NOW()
    WHERE id = ${id}
  `;
  return { previous_shipment_id: services ? (before[0].shipment_id as string | null) : null };
}

// ---------------------------------------------------------------------------
// "Hors DIGI" invoices
// ---------------------------------------------------------------------------

/**
 * Creates a "hors DIGI" invoice. Supply Chain's are validated at once; the
 * ones entered by Sourcing wait for Supply Chain ("pending").
 * Throws DuplicateDigiInvoiceError when the same supplier + ref already exists.
 */
export async function createDirectInvoice(
  input: DirectInvoiceInput,
  actorEmail: string,
  validated: boolean
): Promise<string> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();

  const existing = await findBySupplierAndRef(input.supplier_name, input.ref);
  if (existing) throw new DuplicateDigiInvoiceError(existing.id);

  const id = crypto.randomUUID();
  try {
    await sql`
      INSERT INTO digi_invoices (
        id, source, is_digi, supplier_name, ref, invoice_date, amount, currency, buyer,
        triage, triaged_at, validation_status, validated_by_email, validated_at,
        created_by_email, updated_by_email
      ) VALUES (
        ${id}, 'manual', FALSE, ${input.supplier_name}, ${input.ref}, ${input.invoice_date},
        ${input.amount}, ${input.currency}, ${input.buyer},
        'goods', NOW(), ${validated ? 'validated' : 'pending'},
        ${validated ? actorEmail : null}, ${validated ? new Date().toISOString() : null},
        ${actorEmail}, ${actorEmail}
      )
    `;
  } catch (err: any) {
    if (err?.code === '23505') {
      const raced = await findBySupplierAndRef(input.supplier_name, input.ref);
      if (raced) throw new DuplicateDigiInvoiceError(raced.id);
    }
    throw err;
  }
  return id;
}

/**
 * Updates a "hors DIGI" invoice. A refused invoice that is corrected goes
 * back to "pending" (Sourcing) or is validated (Supply Chain).
 * Returns false when the invoice does not exist.
 */
export async function updateDirectInvoice(
  id: string,
  input: DirectInvoiceInput,
  actorEmail: string,
  validated: boolean
): Promise<boolean> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();

  const rows = await sql`SELECT is_digi, validation_status FROM digi_invoices WHERE id = ${id}`;
  if (!rows[0]) return false;
  if (rows[0].is_digi !== false) throw new WrongInvoiceKindError();

  const existing = await findBySupplierAndRef(input.supplier_name, input.ref);
  if (existing && existing.id !== id) throw new DuplicateDigiInvoiceError(existing.id);

  const resubmitted = rows[0].validation_status === 'rejected';
  const nextStatus: ValidationStatus = resubmitted ? (validated ? 'validated' : 'pending') : rows[0].validation_status;
  try {
    await sql`
      UPDATE digi_invoices SET
        supplier_name = ${input.supplier_name},
        ref = ${input.ref},
        invoice_date = ${input.invoice_date},
        amount = ${input.amount},
        currency = ${input.currency},
        buyer = ${input.buyer},
        validation_status = ${nextStatus},
        rejection_reason = CASE WHEN ${resubmitted} THEN NULL ELSE rejection_reason END,
        validated_by_email = CASE WHEN ${nextStatus === 'validated' && resubmitted} THEN ${actorEmail} ELSE validated_by_email END,
        validated_at = CASE WHEN ${nextStatus === 'validated' && resubmitted} THEN NOW() ELSE validated_at END,
        updated_by_email = ${actorEmail},
        updated_at = NOW()
      WHERE id = ${id}
    `;
  } catch (err: any) {
    if (err?.code === '23505') {
      const raced = await findBySupplierAndRef(input.supplier_name, input.ref);
      if (raced) throw new DuplicateDigiInvoiceError(raced.id);
    }
    throw err;
  }
  return true;
}

/**
 * Supply Chain decision on a pending "hors DIGI" invoice. A refused invoice
 * cannot enter a shipment until it is corrected and validated.
 * Returns null when the invoice does not exist or is not a "hors DIGI" one.
 */
export async function setInvoiceValidation(
  id: string,
  decision: 'validated' | 'rejected',
  reason: string | null,
  actorEmail: string
): Promise<{ previous: ValidationStatus } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const before = await sql`SELECT validation_status FROM digi_invoices WHERE id = ${id} AND NOT is_digi`;
  if (!before[0]) return null;
  await sql`
    UPDATE digi_invoices SET
      validation_status = ${decision},
      rejection_reason = ${decision === 'rejected' ? reason : null},
      validated_by_email = ${actorEmail},
      validated_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
  `;
  return { previous: before[0].validation_status as ValidationStatus };
}

export async function listDigiInvoicesForShipment(shipmentId: string): Promise<DigiInvoiceRecord[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(
    `${SELECT_WITH_LINES} WHERE i.shipment_id = $1 ORDER BY i.invoice_date ASC NULLS LAST, i.created_at ASC`,
    [shipmentId]
  );
  return (rows as any[]).map(mapInvoiceRow);
}

/**
 * Value of each shipment from its invoices: shipment id → {count, total}.
 * DIGI invoice = total of its lines; "hors DIGI" = its amount, USD converted
 * with the rate of the settings (left out while no rate is set).
 */
export async function getInvoiceTotalsByShipment(
  usdEurRate: number | null
): Promise<Map<string, { count: number; total: number | null }>> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT i.shipment_id, i.is_digi, i.amount::float AS amount, i.currency,
      (SELECT SUM(l.price_subtotal)::float FROM digi_invoice_lines l WHERE l.invoice_id = i.id) AS lines_total
    FROM digi_invoices i
    WHERE i.shipment_id IS NOT NULL
  `;
  const totals = new Map<string, { count: number; total: number | null }>();
  for (const r of rows as any[]) {
    const value = r.is_digi === false ? amountInEur(r.amount, r.currency, usdEurRate) : r.lines_total;
    const entry = totals.get(r.shipment_id) ?? { count: 0, total: null };
    entry.count += 1;
    if (value !== null && value !== undefined) entry.total = Math.round(((entry.total ?? 0) + value) * 100) / 100;
    totals.set(r.shipment_id, entry);
  }
  return totals;
}

/**
 * Moves an invoice to an existing shipment (several invoices can travel in
 * the same shipment), or detaches it (shipmentId = null). Detached invoices
 * keep no shipment until one is created or attached.
 * Returns null when the invoice does not exist.
 */
export async function assignInvoiceToShipment(
  invoiceId: string,
  shipmentId: string | null
): Promise<{ previous_shipment_id: string | null; previous_shipment_empty: boolean } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const before = await sql`SELECT shipment_id FROM digi_invoices WHERE id = ${invoiceId}`;
  if (!before[0]) return null;
  const previous = (before[0].shipment_id as string | null) ?? null;

  await sql`
    UPDATE digi_invoices SET
      shipment_id = ${shipmentId},
      shipment_created_at = COALESCE(shipment_created_at, NOW()),
      no_shipment = CASE WHEN ${shipmentId}::text IS NULL THEN no_shipment ELSE FALSE END,
      updated_at = NOW()
    WHERE id = ${invoiceId}
  `;

  let previousEmpty = false;
  if (previous && previous !== shipmentId) {
    const rest = await sql`
      SELECT
        EXISTS (SELECT 1 FROM shipments WHERE id = ${previous}) AS still_exists,
        EXISTS (SELECT 1 FROM digi_invoices WHERE shipment_id = ${previous}) AS has_invoices
    `;
    previousEmpty = Boolean(rest[0]?.still_exists) && !rest[0]?.has_invoices;
  }
  return { previous_shipment_id: previous, previous_shipment_empty: previousEmpty };
}
