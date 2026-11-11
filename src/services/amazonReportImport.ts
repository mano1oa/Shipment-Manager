import {
  assignParcelTrackingNumber,
  commonSupplierOf,
  createParcel,
  findAmazonOrderInvoices,
  findByTrackingNumber,
  linkParcelInvoices,
} from '../db/parcels.js';
import { resolveParcelCarrier } from '../db/carriers.js';
import { isCarrierCode } from '../db/tracking.js';
import { findConfirmedShipmentOfInvoices } from '../db/shipments.js';
import { deletePendingAmazonParcels, listPendingAmazonParcels, savePendingAmazonParcel } from '../db/amazonPending.js';
import { validateParcelInput } from '../lib/parcelTracking.js';
import type { ParcelDestination } from '../lib/parcelTracking.js';
import type { AmazonImportLine, AmazonImportOutcome } from '../lib/amazonReport.js';
import type { CarrierCode } from '../lib/carrierDetection.js';

/** One tracking number of the Amazon report (possibly for several orders). */
export interface AmazonGroup {
  number: string;
  carrier: string;
  carrierText: string;
  expected: string | null;
  /** Matching keys: order number, Amazon invoice number. */
  sources: { order: string; ref: string }[];
  lines: { line: number; order_ref: string }[];
}

/**
 * Each number becomes a parcel of the invoice(s) of its Amazon order: a parcel
 * announced without number gets it first, a known number gets the invoice.
 * Without `apply`, only what would be done.
 */
export async function processAmazonGroups(
  groups: AmazonGroup[],
  destination: ParcelDestination,
  apply: boolean,
  actorEmail: string
): Promise<{ counts: Record<string, number>; lines: AmazonImportLine[]; outcomes: Map<string, AmazonImportOutcome> }> {
  const sources = groups.flatMap((g) => g.sources);
  const invoices = await findAmazonOrderInvoices(
    Array.from(new Set(sources.map((s) => s.order))),
    Array.from(new Set(sources.map((s) => s.ref).filter((k) => k.length >= 6)))
  );
  const byOrder = new Map<string, typeof invoices>();
  const byRef = new Map<string, typeof invoices>();
  invoices.forEach((inv) => {
    if (inv.order_key) byOrder.set(inv.order_key, [...(byOrder.get(inv.order_key) ?? []), inv]);
    if (inv.ref_key) byRef.set(inv.ref_key, [...(byRef.get(inv.ref_key) ?? []), inv]);
  });
  /** The invoice of the row by its Amazon invoice number, else every invoice of the order. */
  const invoicesOf = (s: { order: string; ref: string }) =>
    (s.ref.length >= 6 ? byRef.get(s.ref) : undefined) ?? byOrder.get(s.order) ?? [];

  /** Parcels without number given one in this run (not twice). */
  const completedBlank = new Set<string>();
  const counts: Record<string, number> = {};
  const lines: AmazonImportLine[] = [];
  const outcomes = new Map<string, AmazonImportOutcome>();
  for (const g of groups) {
    const all = Array.from(new Map(g.sources.flatMap(invoicesOf).map((inv) => [inv.id, inv])).values());
    const notServices = all.filter((inv) => inv.triage !== 'services');
    // Invoices of a confirmed shipment keep their parcels
    const locked = new Set<string>();
    for (const inv of notServices) if (await findConfirmedShipmentOfInvoices([inv.id])) locked.add(inv.id);
    const goods = notServices.filter((inv) => !locked.has(inv.id));
    const refs = (goods.length > 0 ? goods : notServices).map((inv) => inv.ref || '—');
    let outcome: AmazonImportOutcome;
    if (all.length === 0) outcome = 'unknown_order';
    else if (notServices.length === 0) outcome = 'services';
    else if (goods.length === 0) outcome = 'locked';
    else {
      const ids = goods.map((inv) => inv.id);
      // Main number or another number of a parcel (supplier, carrier, box)
      const existing = (await findByTrackingNumber(g.number))?.id ?? null;
      const blank = goods.flatMap((inv) => inv.blank_parcel_ids).find((id) => !completedBlank.has(id));
      if (existing) {
        outcome = goods.every((inv) => inv.parcel_ids.includes(existing)) ? 'already' : 'linked';
        if (apply && outcome === 'linked') await linkParcelInvoices(existing, ids);
      } else if (blank) {
        completedBlank.add(blank);
        outcome = 'completed';
        if (apply) {
          // With the invoices of the other orders of the package
          if (await assignParcelTrackingNumber(blank, g.number, g.carrier as CarrierCode, actorEmail)) {
            await linkParcelInvoices(blank, ids);
          }
        }
      } else {
        outcome = 'created';
        if (apply) {
          const { value } = validateParcelInput({ tracking_number: g.number, destination, expected_delivery: g.expected });
          if (value) {
            // Carrier of the report when it is in the Settings list, else from the number
            const carrier =
              (g.carrierText ? await resolveParcelCarrier(g.carrierText, value.carrier) : undefined) ??
              (await resolveParcelCarrier(null, value.carrier));
            if (carrier) {
              value.carrier_name = carrier.name;
              if (carrier.trackingCode && isCarrierCode(carrier.trackingCode)) value.carrier = carrier.trackingCode;
            }
            const supplier = (await commonSupplierOf(ids)).supplier;
            await createParcel(value, ids, supplier, actorEmail);
          }
        }
      }
    }
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    outcomes.set(g.number, outcome);
    g.lines.forEach((l) => lines.push({ line: l.line, order_ref: l.order_ref, tracking_number: g.number, outcome, invoice_refs: refs }));
  }
  lines.sort((a, b) => a.line - b.line);
  return { counts, lines, outcomes };
}

/**
 * After an import: the numbers without invoice are kept for later, the ones
 * now matched leave the waiting list.
 */
export async function keepPendingAmazonParcels(
  groups: AmazonGroup[],
  outcomes: Map<string, AmazonImportOutcome>,
  destination: ParcelDestination,
  actorEmail: string
): Promise<void> {
  const matched: string[] = [];
  for (const g of groups) {
    if (outcomes.get(g.number) !== 'unknown_order') {
      matched.push(g.number);
      continue;
    }
    await savePendingAmazonParcel(
      {
        tracking_number: g.number,
        destination,
        carrier: g.carrier,
        carrier_text: g.carrierText || null,
        expected_delivery: g.expected,
        sources: g.sources.map((s, i) => ({ ...s, order_ref: g.lines[i]?.order_ref ?? s.order, line: g.lines[i]?.line ?? 0 })),
      },
      actorEmail
    );
  }
  await deletePendingAmazonParcels(matched);
}

/**
 * Numbers waiting for their invoice: the parcels of the invoices now known are
 * made (run after an invoice is saved, imported or synced). Never throws.
 */
export async function resolvePendingAmazonParcels(actorEmail: string): Promise<Record<string, number>> {
  const total: Record<string, number> = {};
  try {
    const pending = await listPendingAmazonParcels();
    if (pending.length === 0) return total;
    const byDestination = new Map<ParcelDestination, AmazonGroup[]>();
    for (const p of pending) {
      const group: AmazonGroup = {
        number: p.tracking_number,
        carrier: p.carrier,
        carrierText: p.carrier_text ?? '',
        expected: p.expected_delivery,
        sources: p.sources.map((s) => ({ order: s.order, ref: s.ref })),
        lines: p.sources.map((s) => ({ line: s.line, order_ref: s.order_ref })),
      };
      byDestination.set(p.destination, [...(byDestination.get(p.destination) ?? []), group]);
    }
    for (const [destination, groups] of byDestination) {
      const { counts, outcomes } = await processAmazonGroups(groups, destination, true, actorEmail);
      await deletePendingAmazonParcels(groups.filter((g) => outcomes.get(g.number) !== 'unknown_order').map((g) => g.number));
      for (const [k, n] of Object.entries(counts)) total[k] = (total[k] ?? 0) + n;
    }
    if (Object.keys(total).some((k) => k !== 'unknown_order')) {
      console.log('[Amazon pending] Parcels made from the waiting list:', JSON.stringify(total));
    }
  } catch (err) {
    console.error('[Amazon pending] Resolve error:', err);
  }
  return total;
}
