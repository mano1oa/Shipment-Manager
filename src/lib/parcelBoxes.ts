import { detectTrackingNumber } from './carrierDetection.js';
import { parcelLossDeadline } from './parcelTracking.js';
import type { ParcelDestination, ParcelStatus, TrackingSettings } from './parcelTracking.js';

/**
 * Boxes of a parcel (a FedEx shipment of N boxes keeps one main number): each
 * photo matched at the point is one box received. The number of boxes
 * expected is optional (supplier notice, "x of N" of the label): without it,
 * no alert on missing boxes. Shared by the server and the screens.
 */

export const PARCEL_NUMBER_KINDS = ['supplier', 'carrier', 'piece'] as const;
export type ParcelNumberKind = (typeof PARCEL_NUMBER_KINDS)[number];

/** "BL", not "n° fournisseur": too close to the invoice reference of the supplier. */
export const PARCEL_NUMBER_KIND_LABELS: Record<ParcelNumberKind, string> = {
  supplier: 'BL',
  carrier: 'N° transporteur',
  piece: 'N° de pièce',
};

/** Label inside a sentence ("le BL …", "le n° de pièce …"). */
export function parcelNumberKindText(kind: ParcelNumberKind): string {
  return kind === 'supplier' ? PARCEL_NUMBER_KIND_LABELS.supplier : PARCEL_NUMBER_KIND_LABELS[kind].toLowerCase();
}

export function isParcelNumberKind(value: unknown): value is ParcelNumberKind {
  return typeof value === 'string' && (PARCEL_NUMBER_KINDS as readonly string[]).includes(value);
}

/**
 * Stored form of another number. Carrier and box numbers are read like the
 * main number (carrier prefix removed); a supplier reference only loses case,
 * spaces, dashes and dots, so two different references never collide.
 */
export function normalizeParcelNumber(kind: ParcelNumberKind, raw: string): string {
  const text = String(raw ?? '').trim();
  if (kind === 'supplier') return text.toUpperCase().replace(/[\s\-.]/g, '');
  return detectTrackingNumber(text).number;
}

export interface ParcelBox {
  id: string;
  received_at: string;
  point_id: string | null;
  point_date: string | null;
  photo_id: string | null;
  piece_number: string | null;
  box_index: number | null;
}

export interface BoxSummary {
  received: number;
  expected: number | null;
  /** "2/3 boîtes", "Complet 3/3", "2 boîtes"; null for a single box without count. */
  label: string | null;
  complete: boolean;
  /** More boxes than expected: probably a photo matched twice. */
  over: boolean;
}

export function boxSummary(p: { boxes: { length: number }; boxes_expected: number | null }): BoxSummary {
  const received = p.boxes.length;
  const expected = p.boxes_expected ?? null;
  if (expected === null) {
    return { received, expected, label: received > 1 ? `${received} boîtes` : null, complete: false, over: false };
  }
  const complete = received >= expected;
  return {
    received,
    expected,
    label: received === expected ? `Complet ${received}/${expected}` : `${received}/${expected} boîtes`,
    complete,
    over: received > expected,
  };
}

/** Invoice side: "X/N boîtes reçues" when every parcel has a count, else "X boîtes reçues". */
export function invoiceBoxesLabel(received: number, expectedTotal: number | null): string | null {
  if (received === 0 && expectedTotal === null) return null;
  return expectedTotal === null ? `${received} boîte(s) reçue(s)` : `${received}/${expectedTotal} boîtes reçues`;
}

/**
 * Date after which a parcel not complete is late: same rule as the automatic
 * loss (parcelLossDeadline) — expected delivery + N days, else earliest
 * invoice date + M days. Null when neither date is known.
 */
export function lossDeadline(
  p: { expected_delivery: string | null; invoices: { invoice_date: string | null }[] },
  settings: TrackingSettings
): string | null {
  const firstInvoice = p.invoices.map((i) => i.invoice_date).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  return parcelLossDeadline(p.expected_delivery, firstInvoice, settings);
}

export interface ParcelForPartial {
  status: ParcelStatus;
  boxes: { length: number };
  boxes_expected: number | null;
  expected_delivery: string | null;
  invoices: { invoice_date: string | null }[];
}

/** "Reçu partiel": received, fewer boxes than expected and the loss delay is over (today > deadline). */
export function isPartialOverdue(p: ParcelForPartial, settings: TrackingSettings, today: string): boolean {
  if (p.status !== 'received' || p.boxes_expected === null || p.boxes.length === 0) return false;
  if (p.boxes.length >= p.boxes_expected) return false;
  const deadline = lossDeadline(p, settings);
  return deadline !== null && today > deadline;
}

export interface ParcelForMerge {
  id: string;
  tracking_number: string | null;
  carrier: string;
  carrier_name: string | null;
  supplier_name: string | null;
  destination: ParcelDestination;
  status: ParcelStatus;
  created_at_point: boolean;
  invoices: { id: string; ref: string | null }[];
}

export interface MergeSuspect<P extends ParcelForMerge = ParcelForMerge> {
  invoice_id: string;
  invoice_ref: string | null;
  /** Lost parcel: probably the main number of the shipment. */
  principal: P;
  /** Parcels created at a point for the same invoice: probably its other boxes. */
  boxes: P[];
}

const sameText = (a: string | null, b: string | null) => (a || '').trim().toUpperCase() === (b || '').trim().toUpperCase();

/** Same carrier: by the Settings name when both have one, else by the tracking connector. */
function sameCarrier(a: ParcelForMerge, b: ParcelForMerge): boolean {
  if (a.carrier_name && b.carrier_name) return sameText(a.carrier_name, b.carrier_name);
  return a.carrier !== 'UNKNOWN' && a.carrier === b.carrier;
}

/**
 * "Colis à fusionner ?": an invoice with a lost parcel and parcels created at
 * a point (label not found) of the same supplier, carrier and hub. Read only.
 */
export function findMergeSuspects<P extends ParcelForMerge>(parcels: P[]): MergeSuspect<P>[] {
  const byInvoice = new Map<string, { ref: string | null; parcels: P[] }>();
  for (const p of parcels) {
    for (const inv of p.invoices) {
      const entry = byInvoice.get(inv.id) ?? { ref: inv.ref, parcels: [] };
      entry.parcels.push(p);
      byInvoice.set(inv.id, entry);
    }
  }
  const suspects: MergeSuspect<P>[] = [];
  for (const [invoiceId, { ref, parcels: list }] of byInvoice) {
    for (const principal of list.filter((p) => p.status === 'lost')) {
      const boxes = list.filter(
        (p) =>
          p.id !== principal.id &&
          p.created_at_point &&
          p.status !== 'search' &&
          p.destination === principal.destination &&
          sameText(p.supplier_name, principal.supplier_name) &&
          sameCarrier(p, principal)
      );
      if (boxes.length > 0) suspects.push({ invoice_id: invoiceId, invoice_ref: ref, principal, boxes });
    }
  }
  return suspects;
}
