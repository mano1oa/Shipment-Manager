import { getDb } from './neon.js';
import { ensureDigiInvoicesSchema } from './digiInvoices.js';
import { trackingSupplierName } from '../lib/digiInvoices.js';
import type { CarrierCode } from '../lib/carrierDetection.js';
import type { ParcelInput, ParcelStatus } from '../lib/parcelTracking.js';

/**
 * Parcels (supplier → Orly): one per tracking number, linked to 1..n invoices
 * of the same supplier. Tables: see parcelSchema.ts.
 */

export interface ParcelInvoiceRef {
  id: string;
  ref: string | null;
  supplier_display: string | null;
  invoice_date: string | null;
}

export interface ParcelRecord {
  id: string;
  tracking_number: string | null;
  carrier: CarrierCode;
  supplier_name: string | null;
  expected_delivery: string | null;
  status: ParcelStatus;
  received_at: string | null;
  received_by_email: string | null;
  status_changed_at: string | null;
  notes: string | null;
  legacy_shipment_id: string | null;
  invoices: ParcelInvoiceRef[];
  photo_count: number;
  created_by_email: string | null;
  updated_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export class DuplicateParcelError extends Error {
  constructor(public existingId: string) {
    super('Tracking number already used by another parcel');
  }
}

const SELECT_PARCELS = `
  SELECT
    p.id, p.tracking_number, p.carrier, p.supplier_name,
    TO_CHAR(p.expected_delivery, 'YYYY-MM-DD') AS expected_delivery,
    p.status, TO_CHAR(p.received_at, 'YYYY-MM-DD') AS received_at, p.received_by_email,
    p.status_changed_at, p.notes, p.legacy_shipment_id,
    p.created_by_email, p.updated_by_email, p.created_at, p.updated_at,
    (SELECT COUNT(*)::int FROM parcel_photos ph WHERE ph.parcel_id = p.id) AS photo_count,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'id', i.id, 'ref', i.ref, 'supplier_name', i.supplier_name,
          'amazon_order_ref', i.amazon_order_ref,
          'invoice_date', TO_CHAR(i.invoice_date, 'YYYY-MM-DD')
        ) ORDER BY i.invoice_date NULLS LAST, i.ref)
        FROM parcel_invoices pi JOIN digi_invoices i ON i.id = pi.invoice_id
        WHERE pi.parcel_id = p.id
      ),
      '[]'::json
    ) AS invoices
  FROM parcels p
`;

function mapParcelRow(row: any): ParcelRecord {
  return {
    id: row.id,
    tracking_number: row.tracking_number,
    carrier: row.carrier,
    supplier_name: row.supplier_name,
    expected_delivery: row.expected_delivery,
    status: row.status,
    received_at: row.received_at,
    received_by_email: row.received_by_email,
    status_changed_at: row.status_changed_at,
    notes: row.notes,
    legacy_shipment_id: row.legacy_shipment_id,
    invoices: (row.invoices || []).map((i: any) => ({
      id: i.id,
      ref: i.ref,
      supplier_display: trackingSupplierName(i.supplier_name, i.amazon_order_ref),
      invoice_date: i.invoice_date,
    })),
    photo_count: Number(row.photo_count) || 0,
    created_by_email: row.created_by_email,
    updated_by_email: row.updated_by_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listParcels(): Promise<ParcelRecord[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(`${SELECT_PARCELS} ORDER BY p.created_at DESC`);
  return (rows as any[]).map(mapParcelRow);
}

export async function getParcel(id: string): Promise<ParcelRecord | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(`${SELECT_PARCELS} WHERE p.id = $1`, [id]);
  return rows[0] ? mapParcelRow(rows[0]) : null;
}

export async function listParcelsForInvoice(invoiceId: string): Promise<ParcelRecord[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(
    `${SELECT_PARCELS}
     WHERE p.id IN (SELECT parcel_id FROM parcel_invoices WHERE invoice_id = $1)
     ORDER BY p.created_at ASC`,
    [invoiceId]
  );
  return (rows as any[]).map(mapParcelRow);
}

async function findByTrackingNumber(trackingNumber: string): Promise<string | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id FROM parcels WHERE UPPER(TRIM(tracking_number)) = UPPER(TRIM(${trackingNumber}))
  `;
  return (rows[0]?.id as string) ?? null;
}

/**
 * Supplier shown for the invoices (AMAZON for an Amazon order). A parcel only
 * covers invoices of one supplier: returns null when they differ or are unknown.
 */
export async function commonSupplierOf(invoiceIds: string[]): Promise<{ supplier: string | null; mixed: boolean }> {
  const sql = getDb();
  const rows = await sql`
    SELECT supplier_name, amazon_order_ref FROM digi_invoices WHERE id = ANY(${invoiceIds}::uuid[])
  `;
  const names = new Set(rows.map((r: any) => (trackingSupplierName(r.supplier_name, r.amazon_order_ref) || '').toUpperCase()));
  if (names.size !== 1) return { supplier: null, mixed: names.size > 1 };
  return { supplier: trackingSupplierName(rows[0].supplier_name, rows[0].amazon_order_ref), mixed: false };
}

/**
 * Creates a parcel for the invoices. When the tracking number already belongs
 * to a parcel, the invoices are linked to that parcel instead (one parcel can
 * cover several invoices): `existed` is then true.
 */
export async function createParcel(
  input: ParcelInput,
  invoiceIds: string[],
  supplierName: string | null,
  actorEmail: string
): Promise<{ id: string; existed: boolean }> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();

  if (input.tracking_number) {
    const existing = await findByTrackingNumber(input.tracking_number);
    if (existing) {
      await linkParcelInvoices(existing, invoiceIds);
      return { id: existing, existed: true };
    }
  }

  try {
    const rows = await sql`
      INSERT INTO parcels (tracking_number, carrier, supplier_name, expected_delivery, notes,
        created_by_email, updated_by_email)
      VALUES (${input.tracking_number}, ${input.carrier}, ${supplierName}, ${input.expected_delivery},
        ${input.notes}, ${actorEmail}, ${actorEmail})
      RETURNING id
    `;
    const id = rows[0].id as string;
    await linkParcelInvoices(id, invoiceIds);
    return { id, existed: false };
  } catch (err: any) {
    // Same tracking number created at the same time: link to that one
    if (err?.code === '23505' && input.tracking_number) {
      const raced = await findByTrackingNumber(input.tracking_number);
      if (raced) {
        await linkParcelInvoices(raced, invoiceIds);
        return { id: raced, existed: true };
      }
    }
    throw err;
  }
}

/** Returns false when the parcel does not exist. */
export async function updateParcel(id: string, input: ParcelInput, actorEmail: string): Promise<boolean> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  if (input.tracking_number) {
    const existing = await findByTrackingNumber(input.tracking_number);
    if (existing && existing !== id) throw new DuplicateParcelError(existing);
  }
  try {
    const rows = await sql`
      UPDATE parcels SET
        tracking_number = ${input.tracking_number},
        carrier = ${input.carrier},
        expected_delivery = ${input.expected_delivery},
        notes = ${input.notes},
        updated_by_email = ${actorEmail},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err: any) {
    if (err?.code === '23505' && input.tracking_number) {
      const raced = await findByTrackingNumber(input.tracking_number);
      if (raced) throw new DuplicateParcelError(raced);
    }
    throw err;
  }
}

export async function linkParcelInvoices(parcelId: string, invoiceIds: string[]): Promise<void> {
  if (invoiceIds.length === 0) return;
  const sql = getDb();
  await sql`
    INSERT INTO parcel_invoices (parcel_id, invoice_id)
    SELECT ${parcelId}::uuid, UNNEST(${invoiceIds}::uuid[])
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Detaches a parcel from an invoice. A parcel left without any invoice is
 * deleted (nothing to track any more): `deleted` is then true.
 */
export async function unlinkParcelInvoice(
  parcelId: string,
  invoiceId: string
): Promise<{ unlinked: boolean; deleted: boolean }> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    DELETE FROM parcel_invoices WHERE parcel_id = ${parcelId} AND invoice_id = ${invoiceId} RETURNING parcel_id
  `;
  if (rows.length === 0) return { unlinked: false, deleted: false };
  const orphan = await sql`
    DELETE FROM parcels p WHERE p.id = ${parcelId}
      AND NOT EXISTS (SELECT 1 FROM parcel_invoices pi WHERE pi.parcel_id = p.id)
    RETURNING id
  `;
  return { unlinked: true, deleted: orphan.length > 0 };
}

/**
 * Changes the state of a parcel. "received" keeps the reception date
 * (defaults to today); going back to "to_receive" clears it.
 * Returns the previous status, or null when the parcel does not exist.
 */
export async function setParcelStatus(
  id: string,
  status: ParcelStatus,
  receivedAt: string | null,
  actorEmail: string
): Promise<{ previous: ParcelStatus } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const before = await sql`SELECT status FROM parcels WHERE id = ${id}`;
  if (!before[0]) return null;
  const keepsReception = status === 'received' || status === 'search';
  await sql`
    UPDATE parcels SET
      status = ${status},
      received_at = CASE
        WHEN ${status} = 'received' THEN COALESCE(${receivedAt}::date, received_at, CURRENT_DATE)
        WHEN ${keepsReception} THEN received_at
        ELSE NULL
      END,
      received_by_email = CASE
        WHEN ${status} = 'received' THEN ${actorEmail}
        WHEN ${keepsReception} THEN received_by_email
        ELSE NULL
      END,
      status_changed_at = NOW(),
      updated_by_email = ${actorEmail},
      updated_at = NOW()
    WHERE id = ${id}
  `;
  return { previous: before[0].status as ParcelStatus };
}

export async function deleteParcel(id: string): Promise<{ tracking_number: string | null } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`DELETE FROM parcels WHERE id = ${id} RETURNING tracking_number`;
  return (rows[0] as any) ?? null;
}
