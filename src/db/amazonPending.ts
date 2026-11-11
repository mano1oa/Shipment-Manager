import { getDb } from './neon.js';
import { ensureDigiInvoicesSchema } from './digiInvoices.js';
import type { ParcelDestination } from '../lib/parcelTracking.js';

/**
 * Tracking numbers of the Amazon report whose order has no invoice yet.
 * Kept until the invoice is entered, imported or synced from Odoo: the parcel
 * is then made automatically (see services/amazonReportImport.ts).
 */
export interface AmazonPendingParcel {
  tracking_number: string;
  destination: ParcelDestination;
  carrier: string;
  carrier_text: string | null;
  expected_delivery: string | null;
  /** order / ref: matching keys; order_ref: order as written; line: line of the report. */
  sources: { order: string; ref: string; order_ref: string; line: number }[];
  /** Set when read from the base. */
  created_at?: string;
  created_by_email?: string | null;
}

export async function listPendingAmazonParcels(): Promise<AmazonPendingParcel[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT tracking_number, destination, carrier, carrier_text,
      to_char(expected_delivery, 'YYYY-MM-DD') AS expected_delivery, sources,
      to_char(created_at, 'YYYY-MM-DD') AS created_at, created_by_email
    FROM amazon_pending_parcels
    ORDER BY amazon_pending_parcels.created_at
  `;
  return rows.map((r: any) => ({
    tracking_number: r.tracking_number,
    destination: r.destination,
    carrier: r.carrier,
    carrier_text: r.carrier_text,
    expected_delivery: r.expected_delivery,
    sources: Array.isArray(r.sources) ? r.sources : [],
    created_at: r.created_at,
    created_by_email: r.created_by_email,
  }));
}

/** Kept (or refreshed, when the report is imported again). */
export async function savePendingAmazonParcel(p: AmazonPendingParcel, actorEmail: string): Promise<void> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  await sql`
    INSERT INTO amazon_pending_parcels
      (tracking_number, destination, carrier, carrier_text, expected_delivery, sources, created_by_email)
    VALUES (${p.tracking_number}, ${p.destination}, ${p.carrier}, ${p.carrier_text}, ${p.expected_delivery},
      ${JSON.stringify(p.sources)}::jsonb, ${actorEmail})
    ON CONFLICT (tracking_number) DO UPDATE SET
      destination = EXCLUDED.destination,
      carrier = EXCLUDED.carrier,
      carrier_text = COALESCE(EXCLUDED.carrier_text, amazon_pending_parcels.carrier_text),
      expected_delivery = COALESCE(EXCLUDED.expected_delivery, amazon_pending_parcels.expected_delivery),
      sources = EXCLUDED.sources,
      updated_at = NOW()
  `;
}

/** Their invoice was found: no longer waiting. */
export async function deletePendingAmazonParcels(numbers: string[]): Promise<void> {
  if (numbers.length === 0) return;
  await ensureDigiInvoicesSchema();
  await getDb()`DELETE FROM amazon_pending_parcels WHERE tracking_number = ANY(${numbers}::text[])`;
}
