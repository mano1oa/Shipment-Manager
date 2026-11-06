import { getDb } from './neon.js';
import { ensureDigiInvoicesSchema } from './digiInvoices.js';
import { trackingSupplierName } from '../lib/digiInvoices.js';

/**
 * Arrival check in Madagascar: quantity received of each goods line of the
 * invoices of a confirmed shipment, typed by Sourcing or Supply Chain.
 * Keyed by invoice + line position: the Odoo sync rewrites the lines of an
 * invoice (new ids) but keeps their order.
 */

let schemaPromise: Promise<void> | null = null;

function ensureLineReceiptsSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureDigiInvoicesSchema();
      const sql = getDb();
      await sql`
        CREATE TABLE IF NOT EXISTS invoice_line_receipts (
          invoice_id UUID NOT NULL REFERENCES digi_invoices(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          quantity_received NUMERIC(14, 4) NOT NULL,
          updated_by_email VARCHAR(255),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (invoice_id, position)
        );
      `;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

export interface ReceivedArticle {
  shipment_id: string;
  ref_fa_digi_nxt: string | null;
  /** Sea: MAR/2026/014, name of the shipment when set. */
  internal_ref: string | null;
  shipment_mode: 'Air' | 'Sea';
  shipment_global_status: string | null;
  confirmed_at: string | null;
  orly_scan_date: string | null;
  invoice_id: string;
  invoice_ref: string | null;
  supplier: string | null;
  position: number;
  name: string;
  quantity: number | null;
  quantity_received: number | null;
  received_by_email: string | null;
  received_updated_at: string | null;
}

const toNumber = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Goods lines of the confirmed shipments (one shipment when shipmentId is given). */
export async function listReceivedArticles(shipmentId?: string): Promise<ReceivedArticle[]> {
  await ensureLineReceiptsSchema();
  const sql = getDb();
  const rows = await sql.query(
    `SELECT s.id AS shipment_id, s.ref_fa_digi_nxt, s.internal_ref, s.mode AS shipment_mode, s.global_status AS shipment_global_status,
       s.confirmed_at, s.orly_scan_date,
       i.id AS invoice_id, COALESCE(i.ref, i.odoo_move_name) AS invoice_ref, i.supplier_name, i.amazon_order_ref,
       l.position, l.name, l.quantity, r.quantity_received, r.updated_by_email, r.updated_at
     FROM shipments s
     JOIN digi_invoices i ON i.shipment_id = s.id
     JOIN digi_invoice_lines l ON l.invoice_id = i.id AND NOT l.is_service
     LEFT JOIN invoice_line_receipts r ON r.invoice_id = i.id AND r.position = l.position
     WHERE s.confirmed_at IS NOT NULL AND ($1::varchar IS NULL OR s.id = $1)
     ORDER BY s.confirmed_at DESC, s.id, i.supplier_name NULLS LAST, i.ref, l.position`,
    [shipmentId ?? null]
  );
  return (rows as any[]).map((r) => ({
    shipment_id: r.shipment_id,
    ref_fa_digi_nxt: r.ref_fa_digi_nxt || null,
    internal_ref: r.internal_ref || null,
    shipment_mode: r.shipment_mode,
    shipment_global_status: r.shipment_global_status ?? null,
    confirmed_at: r.confirmed_at ? new Date(r.confirmed_at).toISOString() : null,
    orly_scan_date: r.orly_scan_date || null,
    invoice_id: r.invoice_id,
    invoice_ref: r.invoice_ref ?? null,
    supplier: trackingSupplierName(r.supplier_name, r.amazon_order_ref),
    position: Number(r.position),
    name: r.name,
    quantity: toNumber(r.quantity),
    quantity_received: toNumber(r.quantity_received),
    received_by_email: r.updated_by_email ?? null,
    received_updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

/**
 * Sets (null clears) the quantity received of a goods line. Returns false when
 * the line is not a goods line of a confirmed shipment.
 */
export async function setLineReceipt(
  invoiceId: string,
  position: number,
  quantity: number | null,
  actorEmail: string
): Promise<boolean> {
  await ensureLineReceiptsSchema();
  const sql = getDb();
  const target = await sql`
    SELECT 1 FROM digi_invoice_lines l
    JOIN digi_invoices i ON i.id = l.invoice_id
    JOIN shipments s ON s.id = i.shipment_id
    WHERE l.invoice_id = ${invoiceId} AND l.position = ${position} AND NOT l.is_service
      AND s.confirmed_at IS NOT NULL
    LIMIT 1
  `;
  if (target.length === 0) return false;
  if (quantity === null) {
    await sql`DELETE FROM invoice_line_receipts WHERE invoice_id = ${invoiceId} AND position = ${position}`;
  } else {
    await sql`
      INSERT INTO invoice_line_receipts (invoice_id, position, quantity_received, updated_by_email, updated_at)
      VALUES (${invoiceId}, ${position}, ${quantity}, ${actorEmail}, NOW())
      ON CONFLICT (invoice_id, position) DO UPDATE SET
        quantity_received = EXCLUDED.quantity_received,
        updated_by_email = EXCLUDED.updated_by_email,
        updated_at = NOW()
    `;
  }
  return true;
}
