import { getDb } from './neon.js';
import { ensureDigiInvoicesSchema } from './digiInvoices.js';
import { listAuditLogs } from './audit.js';
import { buildParcelHistory } from '../lib/parcelHistory.js';
import type { ParcelHistoryEvent } from '../lib/parcelHistory.js';

/** History of a parcel (see lib/parcelHistory.ts); null when the parcel does not exist. */
export async function getParcelHistory(parcelId: string): Promise<ParcelHistoryEvent[] | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT p.status, p.destination, p.status_changed_at, p.created_at, p.created_by_email, p.boxes_expected,
      (SELECT TO_CHAR(rp.point_date, 'YYYY-MM-DD') FROM reception_points rp WHERE rp.id = p.created_at_point_id) AS created_point_date
    FROM parcels p WHERE p.id = ${parcelId}
  `;
  const parcel = rows[0];
  if (!parcel) return null;

  const [receptions, photos, invoices, audit] = await Promise.all([
    sql`
      SELECT TO_CHAR(r.received_at, 'YYYY-MM-DD') AS received_at, r.received_by_email, r.photo_id, r.piece_number,
        r.box_index, r.created_at, TO_CHAR(rp.point_date, 'YYYY-MM-DD') AS point_date
      FROM parcel_receptions r LEFT JOIN reception_points rp ON rp.id = r.point_id
      WHERE r.parcel_id = ${parcelId}
      ORDER BY r.received_at, r.created_at
    `,
    sql`
      SELECT ph.id, ph.uploaded_at, ph.uploaded_by_email, ph.linked_at, ph.linked_by_email,
        TO_CHAR(rp.point_date, 'YYYY-MM-DD') AS point_date
      FROM parcel_photos ph LEFT JOIN reception_points rp ON rp.id = ph.point_id
      WHERE ph.parcel_id = ${parcelId}
    `,
    // internal_ref read through to_jsonb: the column is added lazily by db/shipments.ts
    sql`
      SELECT i.id, i.ref, i.shipment_created_at, s.id AS shipment_id,
        NULLIF(to_jsonb(s)->>'internal_ref', '') AS shipment_ref
      FROM parcel_invoices pi
      JOIN digi_invoices i ON i.id = pi.invoice_id
      LEFT JOIN shipments s ON s.id = i.shipment_id
      WHERE pi.parcel_id = ${parcelId}
    `,
    listAuditLogs('PARCEL', parcelId),
  ]);

  const shipments = new Map<string, { label: string; invoice_refs: string[]; at: string | null }>();
  for (const inv of invoices as any[]) {
    if (!inv.shipment_id) continue;
    const entry = shipments.get(inv.shipment_id) ?? { label: inv.shipment_ref || inv.shipment_id, invoice_refs: [], at: null };
    if (inv.ref) entry.invoice_refs.push(inv.ref);
    const at = inv.shipment_created_at ? new Date(inv.shipment_created_at).toISOString() : null;
    if (at && (!entry.at || at < entry.at)) entry.at = at;
    shipments.set(inv.shipment_id, entry);
  }

  return buildParcelHistory({
    parcel: {
      status: parcel.status,
      destination: parcel.destination,
      status_changed_at: parcel.status_changed_at,
      created_at: parcel.created_at,
      created_by_email: parcel.created_by_email,
      created_point_date: parcel.created_point_date ?? null,
    },
    receptions: receptions as any[],
    photos: photos as any[],
    shipments: Array.from(shipments.values()),
    invoices: (invoices as any[]).map((i) => ({ id: i.id, ref: i.ref })),
    audit,
    boxes_expected: parcel.boxes_expected ?? null,
  });
}
