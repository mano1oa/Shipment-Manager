import { getDb } from './neon.js';
import { ensureDigiInvoicesSchema } from './digiInvoices.js';
import { trackingSupplierName } from '../lib/digiInvoices.js';
import type { CarrierCode } from '../lib/carrierDetection.js';
import type { DeliveryType, ParcelDestination, ParcelInput, ParcelStatus, TrackingSettings } from '../lib/parcelTracking.js';
import { normalizeParcelNumber } from '../lib/parcelBoxes.js';
import type { ParcelBox, ParcelNumberKind } from '../lib/parcelBoxes.js';
import { NUMBER_TAKEN_SQLSTATE, backfillBoxesQueries } from './parcelSchema.js';

/**
 * Parcels (supplier → Orly): one per tracking number, linked to 1..n invoices
 * of the same supplier. Tables: see parcelSchema.ts.
 */

export interface ParcelInvoiceRef {
  id: string;
  ref: string | null;
  supplier_display: string | null;
  invoice_date: string | null;
  /** DIGI: total of the lines (EUR); hors DIGI: amount in `currency`. */
  amount_total: number | null;
  currency: string;
}

export interface ParcelRecord {
  id: string;
  tracking_number: string | null;
  /** Tracking connector (detected from the number or linked to the carrier). */
  carrier: CarrierCode;
  /** Carrier of the Settings list (Paramètres › Transporteurs). */
  carrier_name: string | null;
  supplier_name: string | null;
  /** Orly (air) or Rouen quay (sea). */
  destination: ParcelDestination;
  expected_delivery: string | null;
  status: ParcelStatus;
  received_at: string | null;
  received_by_email: string | null;
  status_changed_at: string | null;
  notes: string | null;
  legacy_shipment_id: string | null;
  description: string | null;
  packing_info: string | null;
  volume_m3: number | null;
  delivery_type: DeliveryType | null;
  /** Orly → Mada (or sea) shipments of its invoices, else the shipment it was taken from. */
  shipment_ids: string[];
  invoices: ParcelInvoiceRef[];
  photo_count: number;
  /** Boxes announced (optional): "Reçu partiel" alert when fewer arrive in time. */
  boxes_expected: number | null;
  /** Boxes received, oldest first. */
  boxes: ParcelBox[];
  /** Other numbers (supplier, carrier, box): search only. */
  numbers: ParcelNumberRecord[];
  /** Created at a reception point (label not found): may be a box of another parcel. */
  created_at_point: boolean;
  partial_notified_at: string | null;
  created_by_email: string | null;
  updated_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParcelNumberRecord {
  id: string;
  number: string;
  kind: ParcelNumberKind;
}

export class DuplicateParcelError extends Error {
  constructor(public existingId: string) {
    super('Tracking number already used by another parcel');
  }
}

/** A number (main or other) already belongs to a parcel: `ownerId`. */
export class NumberTakenError extends Error {
  constructor(public ownerId: string, public number: string) {
    super(`Number ${number} already used`);
  }
}

/** Owner of the number when `err` is the refusal of the number guard (parcelSchema). */
export function numberTakenOwner(err: any): string | null {
  return err?.code === NUMBER_TAKEN_SQLSTATE && typeof err?.detail === 'string' ? err.detail : null;
}

const SELECT_PARCELS = `
  SELECT
    p.id, p.tracking_number, p.carrier, p.carrier_name, p.supplier_name,
    TO_CHAR(p.expected_delivery, 'YYYY-MM-DD') AS expected_delivery,
    p.status, TO_CHAR(p.received_at, 'YYYY-MM-DD') AS received_at, p.received_by_email,
    p.status_changed_at, p.notes, p.legacy_shipment_id, p.destination,
    p.description, p.packing_info, p.volume_m3::float AS volume_m3, p.delivery_type,
    COALESCE(
      (
        SELECT array_agg(DISTINCT i.shipment_id)
        FROM parcel_invoices pi JOIN digi_invoices i ON i.id = pi.invoice_id
        JOIN shipments s ON s.id = i.shipment_id
        WHERE pi.parcel_id = p.id
      ),
      CASE WHEN EXISTS (SELECT 1 FROM shipments s WHERE s.id = p.legacy_shipment_id)
        THEN ARRAY[p.legacy_shipment_id] ELSE '{}'::varchar[] END
    ) AS shipment_ids,
    p.created_by_email, p.updated_by_email, p.created_at, p.updated_at,
    (SELECT COUNT(*)::int FROM parcel_photos ph WHERE ph.parcel_id = p.id) AS photo_count,
    p.boxes_expected, p.partial_notified_at, (p.created_at_point_id IS NOT NULL) AS created_at_point,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'id', r.id, 'received_at', TO_CHAR(r.received_at, 'YYYY-MM-DD'), 'point_id', r.point_id,
          'point_date', TO_CHAR(rp.point_date, 'YYYY-MM-DD'), 'photo_id', r.photo_id,
          'piece_number', r.piece_number, 'box_index', r.box_index
        ) ORDER BY r.received_at, r.created_at)
        FROM parcel_receptions r LEFT JOIN reception_points rp ON rp.id = r.point_id
        WHERE r.parcel_id = p.id
      ),
      '[]'::json
    ) AS boxes,
    COALESCE(
      (
        SELECT json_agg(json_build_object('id', n.id, 'number', n.number, 'kind', n.kind) ORDER BY n.created_at)
        FROM parcel_numbers n WHERE n.parcel_id = p.id
      ),
      '[]'::json
    ) AS numbers,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'id', i.id, 'ref', i.ref, 'supplier_name', i.supplier_name,
          'amazon_order_ref', i.amazon_order_ref,
          'invoice_date', TO_CHAR(i.invoice_date, 'YYYY-MM-DD'),
          'amount_total', CASE WHEN i.is_digi
            THEN (SELECT SUM(l.price_subtotal)::float FROM digi_invoice_lines l WHERE l.invoice_id = i.id)
            ELSE i.amount::float END,
          'currency', CASE WHEN i.is_digi THEN 'EUR' ELSE COALESCE(i.currency, 'EUR') END
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
    carrier_name: row.carrier_name ?? null,
    supplier_name: row.supplier_name,
    destination: row.destination || 'ORLY',
    expected_delivery: row.expected_delivery,
    status: row.status,
    received_at: row.received_at,
    received_by_email: row.received_by_email,
    status_changed_at: row.status_changed_at,
    notes: row.notes,
    legacy_shipment_id: row.legacy_shipment_id,
    description: row.description ?? null,
    packing_info: row.packing_info ?? null,
    volume_m3: row.volume_m3 ?? null,
    delivery_type: row.delivery_type ?? null,
    shipment_ids: row.shipment_ids || [],
    invoices: (row.invoices || []).map((i: any) => ({
      id: i.id,
      ref: i.ref,
      supplier_display: trackingSupplierName(i.supplier_name, i.amazon_order_ref),
      invoice_date: i.invoice_date,
      amount_total: i.amount_total === null || i.amount_total === undefined ? null : Number(i.amount_total),
      currency: i.currency || 'EUR',
    })),
    photo_count: Number(row.photo_count) || 0,
    boxes_expected: row.boxes_expected ?? null,
    boxes: row.boxes || [],
    numbers: row.numbers || [],
    created_at_point: row.created_at_point === true,
    partial_notified_at: row.partial_notified_at ?? null,
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

export interface ParcelNumberMatch {
  id: string;
  /** Which number matched: the main one or another number of the parcel. */
  matched: 'primary' | ParcelNumberKind;
}

/**
 * The parcel of a number: its main number (tracking_number) or one of its
 * other numbers (supplier, carrier, box). Every lookup by number goes here.
 */
export async function findByTrackingNumber(number: string): Promise<ParcelNumberMatch | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const keys = Array.from(
    new Set(
      [number, normalizeParcelNumber('carrier', number), normalizeParcelNumber('supplier', number)]
        .map((k) => (k || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
  if (keys.length === 0) return null;
  const rows = await sql`
    SELECT id, 'primary' AS matched, 0 AS rank FROM parcels WHERE UPPER(TRIM(tracking_number)) = ANY(${keys}::text[])
    UNION ALL
    SELECT parcel_id, kind, 1 FROM parcel_numbers WHERE UPPER(TRIM(number)) = ANY(${keys}::text[])
    ORDER BY rank
    LIMIT 1
  `;
  return rows[0] ? { id: rows[0].id as string, matched: rows[0].matched as ParcelNumberMatch['matched'] } : null;
}

/** "n° 123 · FOURNISSEUR · facture F1": names the owner of a number in a refusal. */
export async function describeParcelOwner(id: string): Promise<string> {
  const p = await getParcel(id);
  if (!p) return 'un autre colis';
  const refs = p.invoices.map((i) => i.ref || '—').join(', ');
  return `colis ${p.tracking_number || 'sans n° de suivi'} (${p.supplier_name || 'fournisseur inconnu'}${refs ? `, facture ${refs}` : ''})`;
}

/**
 * Gives its number to a parcel announced without one (photo of the Point
 * Antoine, Amazon report). The carrier is only set when still unknown.
 * Returns false when the parcel already has a number or the number is taken.
 */
export async function assignParcelTrackingNumber(
  id: string,
  trackingNumber: string,
  carrier: CarrierCode,
  actorEmail: string
): Promise<boolean> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  if (await findByTrackingNumber(trackingNumber)) return false;
  try {
    const rows = await sql`
      UPDATE parcels SET
        tracking_number = ${trackingNumber},
        carrier = CASE WHEN carrier = 'UNKNOWN' THEN ${carrier} ELSE carrier END,
        updated_by_email = ${actorEmail},
        updated_at = NOW()
      WHERE id = ${id} AND COALESCE(TRIM(tracking_number), '') = ''
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err: any) {
    if (err?.code === '23505' || numberTakenOwner(err)) return false;
    throw err;
  }
}

/**
 * Gives its carrier (Settings list) to a parcel that has none (form of the
 * point). The tracking connector linked to the carrier replaces the one
 * detected from the number. Returns false when the parcel already has one.
 */
export async function setParcelCarrierIfEmpty(
  id: string,
  carrierName: string,
  carrier: CarrierCode | null,
  actorEmail: string
): Promise<boolean> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    UPDATE parcels SET
      carrier_name = ${carrierName},
      carrier = COALESCE(${carrier}, carrier),
      updated_by_email = ${actorEmail},
      updated_at = NOW()
    WHERE id = ${id} AND COALESCE(TRIM(carrier_name), '') = ''
    RETURNING id
  `;
  return rows.length > 0;
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
  actorEmail: string,
  options: { createdAtPointId?: string | null } = {}
): Promise<{ id: string; existed: boolean; matched: ParcelNumberMatch['matched'] | null }> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();

  if (input.tracking_number) {
    // Main number or another number (supplier, carrier, box): same parcel, same invoices
    const existing = await findByTrackingNumber(input.tracking_number);
    if (existing) {
      // Parcel received without invoice: it takes the supplier of its first invoices
      if (supplierName && invoiceIds.length > 0) {
        await sql`
          UPDATE parcels p SET supplier_name = ${supplierName}
          WHERE p.id = ${existing.id} AND NOT EXISTS (SELECT 1 FROM parcel_invoices pi WHERE pi.parcel_id = p.id)
        `;
      }
      await linkParcelInvoices(existing.id, invoiceIds);
      return { id: existing.id, existed: true, matched: existing.matched };
    }
  }

  try {
    const rows = await sql`
      INSERT INTO parcels (tracking_number, carrier, carrier_name, supplier_name, expected_delivery, notes,
        destination, description, packing_info, volume_m3, delivery_type,
        created_at_point_id, created_by_email, updated_by_email)
      VALUES (${input.tracking_number}, ${input.carrier}, ${input.carrier_name}, ${supplierName}, ${input.expected_delivery},
        ${input.notes}, ${input.destination}, ${input.description}, ${input.packing_info},
        ${input.volume_m3}, ${input.delivery_type}, ${options.createdAtPointId ?? null}, ${actorEmail}, ${actorEmail})
      RETURNING id
    `;
    const id = rows[0].id as string;
    await linkParcelInvoices(id, invoiceIds);
    return { id, existed: false, matched: null };
  } catch (err: any) {
    // Same number saved at the same time: link to that parcel
    if ((err?.code === '23505' || numberTakenOwner(err)) && input.tracking_number) {
      const raced = await findByTrackingNumber(input.tracking_number);
      if (raced) {
        await linkParcelInvoices(raced.id, invoiceIds);
        return { id: raced.id, existed: true, matched: raced.matched };
      }
    }
    throw err;
  }
}

/** Dates (YYYY-MM-DD, oldest first) the parcels of these invoices were received at the hub. */
export async function receptionDates(invoiceIds: string[]): Promise<string[]> {
  if (invoiceIds.length === 0) return [];
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT DISTINCT TO_CHAR(p.received_at, 'YYYY-MM-DD') AS d
    FROM parcels p JOIN parcel_invoices pi ON pi.parcel_id = p.id
    WHERE pi.invoice_id = ANY(${invoiceIds}::uuid[]) AND p.status = 'received' AND p.received_at IS NOT NULL
    ORDER BY d
  `;
  return rows.map((r: any) => r.d as string);
}

/** Returns false when the parcel does not exist. */
export async function updateParcel(id: string, input: ParcelInput, actorEmail: string): Promise<boolean> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  if (input.tracking_number) {
    // Also refused when it is already another number of this parcel
    const existing = await findByTrackingNumber(input.tracking_number);
    if (existing && (existing.id !== id || existing.matched !== 'primary')) throw new DuplicateParcelError(existing.id);
  }
  try {
    const rows = await sql`
      UPDATE parcels SET
        tracking_number = ${input.tracking_number},
        carrier = ${input.carrier},
        carrier_name = ${input.carrier_name},
        expected_delivery = ${input.expected_delivery},
        notes = ${input.notes},
        destination = ${input.destination},
        description = ${input.description},
        packing_info = ${input.packing_info},
        volume_m3 = ${input.volume_m3},
        delivery_type = ${input.delivery_type},
        updated_by_email = ${actorEmail},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err: any) {
    if ((err?.code === '23505' || numberTakenOwner(err)) && input.tracking_number) {
      const raced = await findByTrackingNumber(input.tracking_number);
      if (raced) throw new DuplicateParcelError(raced.id);
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
): Promise<{ unlinked: boolean; deleted: boolean; photo_keys: string[] }> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    DELETE FROM parcel_invoices WHERE parcel_id = ${parcelId} AND invoice_id = ${invoiceId} RETURNING parcel_id
  `;
  if (rows.length === 0) return { unlinked: false, deleted: false, photo_keys: [] };
  const remaining = await sql`SELECT 1 FROM parcel_invoices WHERE parcel_id = ${parcelId} LIMIT 1`;
  if (remaining.length === 0) {
    // Photos of a point Antoine go back to "to match" instead of disappearing
    await sql`
      UPDATE parcel_photos SET parcel_id = NULL, linked_by_email = NULL, linked_at = NULL
      WHERE parcel_id = ${parcelId} AND point_id IS NOT NULL
    `;
  }
  const keys = await sql`SELECT storage_key FROM parcel_photos WHERE parcel_id = ${parcelId}`;
  const orphan = await sql`
    DELETE FROM parcels p WHERE p.id = ${parcelId}
      AND NOT EXISTS (SELECT 1 FROM parcel_invoices pi WHERE pi.parcel_id = p.id)
    RETURNING id
  `;
  // Photos of a deleted parcel: their Drive files are to be trashed
  const deleted = orphan.length > 0;
  return { unlinked: true, deleted, photo_keys: deleted ? keys.map((k: any) => k.storage_key as string) : [] };
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
  await sql.transaction([
    sql`
      UPDATE parcels SET
        status = ${status},
        -- leaving "lost": a new loss later is announced again
        loss_notified_at = CASE WHEN ${status} = 'lost' THEN loss_notified_at ELSE NULL END,
        partial_notified_at = CASE WHEN ${keepsReception} THEN partial_notified_at ELSE NULL END,
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
    `,
    // Back to "to receive" or "lost": its boxes are no longer received (photos stay on the parcel)
    sql`DELETE FROM parcel_receptions WHERE parcel_id = ${id} AND NOT ${keepsReception}`,
    // Received without any box yet: its point photos, else one box without photo at the reception date
    ...backfillBoxesQueries([id]),
    // New date for a parcel whose only box has no photo: the box follows
    sql`
      UPDATE parcel_receptions r SET received_at = p.received_at
      FROM parcels p
      WHERE r.parcel_id = ${id} AND p.id = r.parcel_id AND ${status} = 'received' AND ${receivedAt}::date IS NOT NULL
        AND r.photo_id IS NULL AND (SELECT COUNT(*) FROM parcel_receptions x WHERE x.parcel_id = ${id}) = 1
    `,
  ]);
  return { previous: before[0].status as ParcelStatus };
}

// ---------------------------------------------------------------------------
// Boxes received (one per photo matched at a point) and other numbers
// ---------------------------------------------------------------------------

/**
 * After a box is removed (photo detached or deleted): received_at = date of
 * the first box left; a received parcel with no box left goes back to "to
 * receive" (the automatic loss applies again). A parcel under search keeps
 * its state. Returns the statement, to run inside a transaction.
 */
export function refreshBoxesQuery(parcelId: string, actorEmail: string) {
  const sql = getDb();
  return sql`
    UPDATE parcels p SET
      status = CASE WHEN p.status = 'received' AND b.n = 0 THEN 'to_receive' ELSE p.status END,
      received_at = CASE
        WHEN p.status = 'received' AND b.n = 0 THEN NULL
        WHEN p.status IN ('received', 'search') AND b.n > 0 THEN b.first
        ELSE p.received_at
      END,
      received_by_email = CASE WHEN p.status = 'received' AND b.n = 0 THEN NULL ELSE p.received_by_email END,
      status_changed_at = CASE WHEN p.status = 'received' AND b.n = 0 THEN NOW() ELSE p.status_changed_at END,
      partial_notified_at = CASE
        WHEN p.boxes_expected IS NULL OR b.n = 0 OR b.n >= p.boxes_expected THEN NULL
        ELSE p.partial_notified_at
      END,
      updated_by_email = ${actorEmail},
      updated_at = NOW()
    FROM (
      SELECT COUNT(*)::int AS n, MIN(received_at) AS first FROM parcel_receptions WHERE parcel_id = ${parcelId}
    ) b
    WHERE p.id = ${parcelId}
  `;
}

// Boxes of the parcels received before boxes existed (also run once for all, see parcelSchema)
export { backfillBoxesQueries };

export class BoxError extends Error {
  constructor(message: string, public status = 409, public code?: string) {
    super(message);
  }
}

export interface ReceiveBoxInput {
  parcelId: string;
  pointId: string;
  photoId: string;
  pointDate: string;
  pieceNumber: string | null;
  boxIndex: number | null;
  /** "N" of "x of N": fills boxes_expected; a different value needs `confirmBoxesExpected`. */
  boxesExpected: number | null;
  confirmBoxesExpected: boolean;
  actorEmail: string;
}

/**
 * A photo of the point matched to a parcel = one box received at the point
 * date. One transaction: photo link, box, box number (other number of the
 * parcel), parcel received from its first box. Checks first (duplicate box
 * number, number of another parcel, different N).
 */
export async function receiveBox(input: ReceiveBoxInput): Promise<{
  confirmed: boolean;
  boxes_expected_before: number | null;
  boxes_expected_after: number | null;
  duplicate_index: boolean;
}> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT p.status, p.tracking_number, p.boxes_expected,
      (SELECT parcel_id FROM parcel_photos WHERE id = ${input.photoId} AND point_id = ${input.pointId}) AS photo_parcel,
      EXISTS (SELECT 1 FROM parcel_photos WHERE id = ${input.photoId} AND point_id = ${input.pointId}) AS photo_exists,
      EXISTS (SELECT 1 FROM parcel_receptions r WHERE r.parcel_id = p.id AND r.box_index = ${input.boxIndex}) AS duplicate_index
    FROM parcels p WHERE p.id = ${input.parcelId}
  `;
  const p = rows[0];
  if (!p) throw new BoxError('Colis introuvable', 404);
  if (!p.photo_exists) throw new BoxError('Photo introuvable', 404);
  if (p.photo_parcel && p.photo_parcel !== input.parcelId) {
    throw new BoxError('Cette photo est déjà rattachée à un autre colis : détachez-la d\'abord.');
  }
  if (p.photo_parcel === input.parcelId) {
    return { confirmed: false, boxes_expected_before: p.boxes_expected, boxes_expected_after: p.boxes_expected, duplicate_index: false };
  }

  const piece = input.pieceNumber ? normalizeParcelNumber('piece', input.pieceNumber) : null;
  if (piece) {
    if (p.tracking_number && piece.toUpperCase() === String(p.tracking_number).trim().toUpperCase()) {
      throw new BoxError('Ce n° de pièce est le n° principal du colis : laissez le champ vide.', 400);
    }
    const owner = await findByTrackingNumber(piece);
    if (owner && owner.id !== input.parcelId) {
      throw new BoxError(`Le n° de pièce ${piece} est déjà utilisé par le ${await describeParcelOwner(owner.id)}.`);
    }
    const already = await sql`
      SELECT 1 FROM parcel_receptions WHERE parcel_id = ${input.parcelId} AND UPPER(TRIM(piece_number)) = UPPER(${piece})
    `;
    if (already.length > 0) throw new BoxError(`La boîte ${piece} est déjà reçue sur ce colis.`);
  }
  const before: number | null = p.boxes_expected ?? null;
  if (input.boxesExpected !== null && before !== null && before !== input.boxesExpected && !input.confirmBoxesExpected) {
    throw new BoxError(
      `Le colis attend ${before} boîte(s), l'étiquette indique ${input.boxesExpected} : confirmez pour remplacer.`,
      409,
      'BOXES_EXPECTED_CONFLICT'
    );
  }
  const after = input.boxesExpected ?? before;
  const confirmed = p.status !== 'received' && p.status !== 'search';

  try {
    await sql.transaction([
      // A parcel received before boxes existed gets its earlier boxes first
      ...backfillBoxesQueries([input.parcelId]),
      sql`
        UPDATE parcel_photos SET parcel_id = ${input.parcelId}, linked_by_email = ${input.actorEmail}, linked_at = NOW()
        WHERE id = ${input.photoId} AND point_id = ${input.pointId} AND parcel_id IS NULL
      `,
      sql`
        INSERT INTO parcel_receptions (parcel_id, point_id, photo_id, piece_number, box_index, received_at, received_by_email)
        VALUES (${input.parcelId}, ${input.pointId}, ${input.photoId}, ${piece}, ${input.boxIndex}, ${input.pointDate},
          ${input.actorEmail})
      `,
      // The box number finds the parcel later (kept when it is already one of its numbers)
      sql`
        INSERT INTO parcel_numbers (parcel_id, number, kind, created_by_email)
        SELECT ${input.parcelId}, ${piece}, 'piece', ${input.actorEmail}
        WHERE ${piece}::text IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM parcel_numbers WHERE UPPER(TRIM(number)) = UPPER(${piece}::text))
      `,
      sql`
        UPDATE parcels SET
          status = CASE WHEN ${confirmed} THEN 'received' ELSE status END,
          received_at = CASE WHEN ${confirmed} OR received_at IS NULL THEN ${input.pointDate}::date
            ELSE LEAST(received_at, ${input.pointDate}::date) END,
          received_by_email = CASE WHEN ${confirmed} THEN ${input.actorEmail} ELSE received_by_email END,
          status_changed_at = CASE WHEN ${confirmed} THEN NOW() ELSE status_changed_at END,
          loss_notified_at = CASE WHEN ${confirmed} THEN NULL ELSE loss_notified_at END,
          boxes_expected = ${after},
          partial_notified_at = CASE WHEN ${after}::int IS DISTINCT FROM ${before}::int THEN NULL ELSE partial_notified_at END,
          updated_by_email = ${input.actorEmail},
          updated_at = NOW()
        WHERE id = ${input.parcelId}
      `,
      refreshBoxesQuery(input.parcelId, input.actorEmail),
    ]);
  } catch (err: any) {
    const owner = numberTakenOwner(err);
    if (owner) throw new BoxError(`Le n° de pièce ${piece} est déjà utilisé par le ${await describeParcelOwner(owner)}.`);
    if (err?.code === '23505') throw new BoxError('Cette boîte est déjà enregistrée sur ce colis.');
    throw err;
  }
  return {
    confirmed,
    boxes_expected_before: before,
    boxes_expected_after: after,
    duplicate_index: input.boxIndex !== null && p.duplicate_index === true,
  };
}

/**
 * Detaches a photo of the point: its box is removed (and its box number when
 * no other box uses it). Returns the parcel and whether it went back to "to
 * receive" (no box left), or null when the photo is not linked.
 */
export async function removeBoxOfPhoto(
  pointId: string,
  photoId: string,
  actorEmail: string
): Promise<{ parcel_id: string; back_to_receive: boolean; piece_number: string | null } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT ph.parcel_id, p.status, r.piece_number
    FROM parcel_photos ph
    JOIN parcels p ON p.id = ph.parcel_id
    LEFT JOIN parcel_receptions r ON r.photo_id = ph.id
    WHERE ph.id = ${photoId} AND ph.point_id = ${pointId}
  `;
  const row = rows[0];
  if (!row) return null;
  const parcelId = row.parcel_id as string;
  await sql.transaction([
    // A parcel received before boxes existed gets its boxes first (the others stay counted)
    ...backfillBoxesQueries([parcelId]),
    sql`DELETE FROM parcel_receptions WHERE photo_id = ${photoId}`,
    sql`
      DELETE FROM parcel_numbers n
      WHERE n.parcel_id = ${parcelId} AND n.kind = 'piece' AND ${row.piece_number}::text IS NOT NULL
        AND UPPER(TRIM(n.number)) = UPPER(TRIM(${row.piece_number}::text))
        AND NOT EXISTS (
          SELECT 1 FROM parcel_receptions r WHERE r.parcel_id = n.parcel_id AND UPPER(TRIM(r.piece_number)) = UPPER(TRIM(n.number))
        )
    `,
    sql`
      UPDATE parcel_photos SET parcel_id = NULL, linked_by_email = NULL, linked_at = NULL
      WHERE id = ${photoId} AND point_id = ${pointId}
    `,
    refreshBoxesQuery(parcelId, actorEmail),
  ]);
  const after = await sql`SELECT status FROM parcels WHERE id = ${parcelId}`;
  return {
    parcel_id: parcelId,
    back_to_receive: row.status === 'received' && after[0]?.status === 'to_receive',
    piece_number: row.piece_number ?? null,
  };
}

/** Sets the boxes announced (null = unknown). Returns the previous value, or undefined when the parcel does not exist. */
export async function setBoxesExpected(id: string, boxes: number | null, actorEmail: string): Promise<number | null | undefined> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const before = await sql`SELECT boxes_expected FROM parcels WHERE id = ${id}`;
  if (!before[0]) return undefined;
  await sql`
    UPDATE parcels SET boxes_expected = ${boxes}, partial_notified_at = NULL,
      updated_by_email = ${actorEmail}, updated_at = NOW()
    WHERE id = ${id}
  `;
  return before[0].boxes_expected ?? null;
}

/** Adds another number to a parcel. Throws NumberTakenError when any parcel already has it. */
export async function addParcelNumber(
  parcelId: string,
  number: string,
  kind: ParcelNumberKind,
  actorEmail: string
): Promise<ParcelNumberRecord> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const owner = await findByTrackingNumber(number);
  if (owner) throw new NumberTakenError(owner.id, number);
  try {
    const rows = await sql`
      INSERT INTO parcel_numbers (parcel_id, number, kind, created_by_email)
      VALUES (${parcelId}, ${number}, ${kind}, ${actorEmail})
      RETURNING id, number, kind
    `;
    return rows[0] as ParcelNumberRecord;
  } catch (err: any) {
    const taken = numberTakenOwner(err) ?? (err?.code === '23505' ? (await findByTrackingNumber(number))?.id : null);
    if (taken) throw new NumberTakenError(taken, number);
    throw err;
  }
}

export async function removeParcelNumber(parcelId: string, numberId: string): Promise<ParcelNumberRecord | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    DELETE FROM parcel_numbers WHERE id = ${numberId} AND parcel_id = ${parcelId} RETURNING id, number, kind
  `;
  return (rows[0] as ParcelNumberRecord) ?? null;
}

/**
 * Merges a parcel created apart (a box whose label was not found) into the
 * main parcel, in one transaction: its boxes, photos, other numbers and
 * invoices move to the main parcel, its number becomes a box number of it,
 * then it is deleted. The main parcel is received from its first box (a loss
 * is cancelled). Checks (same supplier and hub) are done by the caller.
 */
export async function mergeParcelInto(
  merged: ParcelRecord,
  principal: ParcelRecord,
  boxesExpected: number | null,
  actorEmail: string
): Promise<void> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const number = merged.tracking_number?.trim() || null;
  await sql.transaction([
    // Parcels received before boxes existed get theirs first
    ...backfillBoxesQueries([merged.id, principal.id]),
    sql`
      UPDATE parcel_receptions SET parcel_id = ${principal.id}, piece_number = COALESCE(piece_number, ${number})
      WHERE parcel_id = ${merged.id}
    `,
    sql`UPDATE parcel_photos SET parcel_id = ${principal.id} WHERE parcel_id = ${merged.id}`,
    sql`UPDATE parcel_numbers SET parcel_id = ${principal.id} WHERE parcel_id = ${merged.id}`,
    sql`
      INSERT INTO parcel_invoices (parcel_id, invoice_id)
      SELECT ${principal.id}::uuid, invoice_id FROM parcel_invoices WHERE parcel_id = ${merged.id}
      ON CONFLICT DO NOTHING
    `,
    // Deleted before its number is given to the main parcel (one number, one parcel)
    sql`DELETE FROM parcels WHERE id = ${merged.id}`,
    sql`
      INSERT INTO parcel_numbers (parcel_id, number, kind, created_by_email)
      SELECT ${principal.id}, ${number}, 'piece', ${actorEmail} WHERE ${number}::text IS NOT NULL
    `,
    sql`
      UPDATE parcels p SET
        boxes_expected = COALESCE(${boxesExpected}::int, p.boxes_expected),
        status = CASE WHEN p.status IN ('to_receive', 'lost') AND b.n > 0 THEN 'received' ELSE p.status END,
        received_at = CASE WHEN p.status IN ('to_receive', 'lost', 'received') AND b.n > 0 THEN b.first ELSE p.received_at END,
        received_by_email = CASE WHEN p.status IN ('to_receive', 'lost') AND b.n > 0 THEN ${actorEmail} ELSE p.received_by_email END,
        status_changed_at = CASE WHEN p.status IN ('to_receive', 'lost') AND b.n > 0 THEN NOW() ELSE p.status_changed_at END,
        loss_notified_at = CASE WHEN p.status = 'lost' AND b.n > 0 THEN NULL ELSE p.loss_notified_at END,
        partial_notified_at = NULL,
        updated_by_email = ${actorEmail},
        updated_at = NOW()
      FROM (
        SELECT COUNT(*)::int AS n, MIN(received_at) AS first FROM parcel_receptions WHERE parcel_id = ${principal.id}
      ) b
      WHERE p.id = ${principal.id}
    `,
  ]);
}

/** Parcels in "Reçu partiel" not announced on Google Chat yet (see isPartialOverdue). */
export async function markPartialNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sql = getDb();
  await sql`UPDATE parcels SET partial_notified_at = NOW() WHERE id = ANY(${ids}::uuid[])`;
}

export async function deleteParcel(id: string): Promise<{ tracking_number: string | null } | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`DELETE FROM parcels WHERE id = ${id} RETURNING tracking_number`;
  return (rows[0] as any) ?? null;
}

// ---------------------------------------------------------------------------
// Loss before the hub (automatic)
// ---------------------------------------------------------------------------

/**
 * Parcels still "to receive" after their deadline become "lost": expected
 * delivery + N days, else earliest invoice date + M days (settings).
 * Returns the parcels changed.
 */
export async function markOverdueParcelsLost(settings: TrackingSettings): Promise<number> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    UPDATE parcels p SET status = 'lost', status_changed_at = NOW(), updated_by_email = 'alerte-automatique',
      updated_at = NOW()
    WHERE p.status = 'to_receive'
      AND CURRENT_DATE > COALESCE(
        p.expected_delivery + ${settings.parcel_loss_days_after_eta}::int,
        (
          SELECT MIN(i.invoice_date) FROM parcel_invoices pi JOIN digi_invoices i ON i.id = pi.invoice_id
          WHERE pi.parcel_id = p.id
        ) + ${settings.parcel_loss_days_without_eta}::int
      )
    RETURNING id
  `;
  return rows.length;
}

export interface LostParcelToNotify {
  id: string;
  tracking_number: string | null;
  supplier_name: string | null;
  carrier_name: string | null;
  destination: ParcelDestination;
  expected_delivery: string | null;
  invoice_refs: string[];
}

/** Lost parcels not announced on Google Chat yet. */
export async function listLostParcelsToNotify(): Promise<LostParcelToNotify[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT p.id, p.tracking_number, p.supplier_name, p.carrier_name, p.destination,
      TO_CHAR(p.expected_delivery, 'YYYY-MM-DD') AS expected_delivery,
      COALESCE(
        (SELECT array_agg(COALESCE(i.ref, '—') ORDER BY i.ref) FROM parcel_invoices pi
         JOIN digi_invoices i ON i.id = pi.invoice_id WHERE pi.parcel_id = p.id),
        '{}'
      ) AS invoice_refs
    FROM parcels p
    WHERE p.status = 'lost' AND p.loss_notified_at IS NULL
    ORDER BY p.supplier_name NULLS LAST, p.tracking_number
  `;
  return rows as unknown as LostParcelToNotify[];
}

export async function markLossesNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sql = getDb();
  await sql`UPDATE parcels SET loss_notified_at = NOW() WHERE id = ANY(${ids}::uuid[])`;
}

// ---------------------------------------------------------------------------
// Photos (object storage key only)
// ---------------------------------------------------------------------------

export interface ParcelPhotoRecord {
  id: string;
  parcel_id: string;
  storage_key: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by_email: string | null;
  uploaded_at: string;
}

export async function listParcelPhotos(parcelId: string): Promise<ParcelPhotoRecord[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT id, parcel_id, storage_key, content_type, size_bytes, uploaded_by_email, uploaded_at
    FROM parcel_photos WHERE parcel_id = ${parcelId} ORDER BY uploaded_at
  `;
  return rows as unknown as ParcelPhotoRecord[];
}

/** Deletes a photo of the parcel; a photo matched at a point was one box (removed with it). */
export async function deleteParcelPhoto(parcelId: string, photoId: string, actorEmail: string): Promise<string | null> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const found = await sql`SELECT storage_key FROM parcel_photos WHERE id = ${photoId} AND parcel_id = ${parcelId}`;
  if (!found[0]) return null;
  await sql.transaction([
    ...backfillBoxesQueries([parcelId]),
    sql`DELETE FROM parcel_photos WHERE id = ${photoId} AND parcel_id = ${parcelId}`,
    refreshBoxesQuery(parcelId, actorEmail),
  ]);
  return found[0].storage_key as string;
}

export interface InvoiceWithoutParcel {
  id: string;
  ref: string | null;
  supplier_display: string | null;
  invoice_date: string | null;
  is_digi: boolean;
  validation_status: string;
}

/**
 * Tracked invoices (goods, not refused, not in a shipment yet) that have no
 * parcel: their tracking number is still to be entered.
 */
export async function listGoodsInvoicesWithoutParcel(): Promise<InvoiceWithoutParcel[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT i.id, i.ref, i.supplier_name, i.amazon_order_ref, i.is_digi, i.validation_status,
      TO_CHAR(i.invoice_date, 'YYYY-MM-DD') AS invoice_date
    FROM digi_invoices i
    WHERE i.triage = 'goods'
      AND NOT i.no_shipment
      AND i.validation_status <> 'rejected'
      AND NOT EXISTS (SELECT 1 FROM parcel_invoices pi WHERE pi.invoice_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = i.shipment_id)
      -- fee-only DIGI invoices (DEEE, port…) are services: nothing to ship
      AND (
        NOT i.is_digi
        OR NOT EXISTS (SELECT 1 FROM digi_invoice_lines l WHERE l.invoice_id = i.id)
        OR EXISTS (SELECT 1 FROM digi_invoice_lines l WHERE l.invoice_id = i.id AND NOT l.is_service)
      )
    ORDER BY i.invoice_date NULLS LAST, i.ref
  `;
  return (rows as any[]).map((r) => ({
    id: r.id,
    ref: r.ref,
    supplier_display: trackingSupplierName(r.supplier_name, r.amazon_order_ref),
    invoice_date: r.invoice_date,
    is_digi: r.is_digi !== false,
    validation_status: r.validation_status,
  }));
}

/** Parcels of the invoices of a shipment (arrival check in Madagascar). */
export async function listParcelsForShipment(shipmentId: string): Promise<ParcelRecord[]> {
  await ensureDigiInvoicesSchema();
  const sql = getDb();
  const rows = await sql.query(
    `${SELECT_PARCELS}
     WHERE p.id IN (
       SELECT pi.parcel_id FROM parcel_invoices pi JOIN digi_invoices i ON i.id = pi.invoice_id
       WHERE i.shipment_id = $1
     )
     ORDER BY p.supplier_name NULLS LAST, p.tracking_number`,
    [shipmentId]
  );
  return (rows as any[]).map(mapParcelRow);
}

export interface AmazonOrderInvoice {
  id: string;
  ref: string | null;
  /** Order number, letters and digits only (matching key of the Amazon report). */
  order_key: string;
  /** Reference, letters and digits only (the Amazon invoice number). */
  ref_key: string;
  triage: string;
  /** Parcels already linked to the invoice. */
  parcel_ids: string[];
  /** Linked parcels still without tracking number: the report can complete them. */
  blank_parcel_ids: string[];
}

/**
 * Invoices of the Amazon report, by Amazon invoice number (reference) or by
 * order number (dashes, spaces and case ignored).
 */
export async function findAmazonOrderInvoices(orderKeys: string[], refKeys: string[] = []): Promise<AmazonOrderInvoice[]> {
  await ensureDigiInvoicesSchema();
  if (orderKeys.length === 0 && refKeys.length === 0) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT i.id, i.ref,
      COALESCE(regexp_replace(UPPER(i.amazon_order_ref), '[^A-Z0-9]', '', 'g'), '') AS order_key,
      COALESCE(regexp_replace(UPPER(i.ref), '[^A-Z0-9]', '', 'g'), '') AS ref_key,
      COALESCE(i.triage, 'goods') AS triage,
      COALESCE((SELECT array_agg(pi.parcel_id::text ORDER BY p.created_at) FROM parcel_invoices pi
        JOIN parcels p ON p.id = pi.parcel_id WHERE pi.invoice_id = i.id), '{}') AS parcel_ids,
      COALESCE((SELECT array_agg(pi.parcel_id::text ORDER BY p.created_at) FROM parcel_invoices pi
        JOIN parcels p ON p.id = pi.parcel_id
        WHERE pi.invoice_id = i.id AND COALESCE(TRIM(p.tracking_number), '') = ''), '{}') AS blank_parcel_ids
    FROM digi_invoices i
    WHERE (i.amazon_order_ref IS NOT NULL
        AND regexp_replace(UPPER(i.amazon_order_ref), '[^A-Z0-9]', '', 'g') = ANY(${orderKeys}::text[]))
      OR (i.ref IS NOT NULL AND regexp_replace(UPPER(i.ref), '[^A-Z0-9]', '', 'g') = ANY(${refKeys}::text[]))
    ORDER BY i.invoice_date NULLS LAST, i.ref
  `;
  return rows.map((r: any) => ({
    id: r.id,
    ref: r.ref,
    order_key: r.order_key,
    ref_key: r.ref_key,
    triage: r.triage,
    parcel_ids: r.parcel_ids ?? [],
    blank_parcel_ids: r.blank_parcel_ids ?? [],
  }));
}
