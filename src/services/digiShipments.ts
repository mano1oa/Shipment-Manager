import { getShipmentByIdFromNeon, upsertShipmentInNeon, findShipmentByRefFa } from '../db/shipments.js';
import { assignInvoiceToShipment, getDigiInvoice, listDigiInvoicesForShipment } from '../db/digiInvoices.js';
import type { DigiInvoiceRecord } from '../db/digiInvoices.js';
import { writeAuditLog, AuditActor } from '../db/audit.js';
import { Shipment, TrackingHistoryStep } from '../types.js';

/**
 * Shipment Orly → Mada (or Rouen → Mada) = one sale invoice (Réf FA
 * DIGI-NXT), grouping the supplier invoices received at the hub. Created and
 * changed by Supply Chain only.
 *
 * An invoice can enter a shipment when it is tracked goods, validated (hors
 * DIGI) and not in another shipment (a shipment "to review" from the former
 * model can give its invoices). An invoice whose parcels are not all
 * confirmed received needs `force` (Supply Chain exception, written in the
 * shipment history).
 */

export class ShipmentGroupingError extends Error {
  constructor(message: string, public status = 400, public notReceived: NotReceivedInvoice[] = []) {
    super(message);
  }
}

export interface NotReceivedInvoice {
  id: string;
  ref: string | null;
  supplier: string | null;
  parcels_received: number;
  parcels_total: number;
}

const label = (inv: DigiInvoiceRecord) => inv.ref || inv.odoo_move_name || inv.id.slice(0, 8);
const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const isReceived = (inv: DigiInvoiceRecord) => inv.parcel_count > 0 && inv.parcel_received_count === inv.parcel_count;

/**
 * Checks the invoices for `targetShipmentId` (null = new shipment).
 * Returns them with the ones not fully received; throws on a blocking issue.
 */
async function checkInvoices(
  invoiceIds: string[],
  targetShipmentId: string | null,
  force: boolean
): Promise<{ invoices: DigiInvoiceRecord[]; notReceived: NotReceivedInvoice[] }> {
  if (invoiceIds.length === 0) throw new ShipmentGroupingError('Sélectionnez au moins une facture.');
  const invoices: DigiInvoiceRecord[] = [];
  for (const id of Array.from(new Set(invoiceIds))) {
    const inv = await getDigiInvoice(id);
    if (!inv) throw new ShipmentGroupingError('Facture introuvable.', 404);
    const name = `Facture ${label(inv)}`;
    if (inv.triage !== 'goods' || inv.no_shipment) {
      throw new ShipmentGroupingError(`${name} : elle n'est pas classée en marchandises.`, 409);
    }
    if (inv.validation_status !== 'validated') {
      throw new ShipmentGroupingError(`${name} : facture hors DIGI pas encore validée par la Supply Chain.`, 409);
    }
    if (inv.shipment_id && inv.shipment_exists && inv.shipment_id !== targetShipmentId) {
      const current = await getShipmentByIdFromNeon(inv.shipment_id);
      if (current && !current.needs_review) {
        throw new ShipmentGroupingError(`${name} : déjà dans l'expédition ${inv.shipment_id}.`, 409);
      }
    }
    invoices.push(inv);
  }
  const notReceived = invoices
    .filter((inv) => !isReceived(inv))
    .map((inv) => ({
      id: inv.id,
      ref: inv.ref,
      supplier: inv.supplier_display,
      parcels_received: inv.parcel_received_count,
      parcels_total: inv.parcel_count,
    }));
  if (notReceived.length > 0 && !force) {
    throw new ShipmentGroupingError(
      `${notReceived.length} facture(s) dont les colis ne sont pas tous confirmés reçus : exception à confirmer.`,
      409,
      notReceived
    );
  }
  return { invoices, notReceived };
}

/** Moves the invoices into the shipment; returns the former shipments left empty. */
async function attachInvoices(shipmentId: string, invoices: DigiInvoiceRecord[]): Promise<string[]> {
  const emptied: string[] = [];
  for (const inv of invoices) {
    const outcome = await assignInvoiceToShipment(inv.id, shipmentId);
    if (outcome?.previous_shipment_empty && outcome.previous_shipment_id) emptied.push(outcome.previous_shipment_id);
  }
  return emptied;
}

/** Supplier label and invoice refs of the shipment, from its invoices. */
async function summarize(shipmentId: string): Promise<{ supplier: string; invoice_no: string }> {
  const invoices = await listDigiInvoicesForShipment(shipmentId);
  const suppliers = Array.from(new Set(invoices.map((i) => i.supplier_display || '—')));
  return {
    supplier: suppliers.length === 1 ? suppliers[0] : `${suppliers.length} fournisseurs`,
    invoice_no: invoices.map(label).join(', ').slice(0, 100),
  };
}

function exceptionStep(notReceived: NotReceivedInvoice[], actor: AuditActor): TrackingHistoryStep {
  return {
    date: now(),
    location: '',
    status: 'Exception Supply Chain',
    details: `Factures ajoutées sans tous leurs colis confirmés reçus (par ${actor.email}) : ${notReceived
      .map((n) => `${n.ref || '—'} (${n.parcels_received}/${n.parcels_total} colis)`)
      .join(', ')}`,
  };
}

async function newShipmentId(): Promise<string> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = `SHP-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
    if (!(await getShipmentByIdFromNeon(id))) return id;
  }
  throw new Error('Could not allocate a shipment id');
}

export interface NewGroupedShipment {
  mode: 'Air' | 'Sea';
  ref_fa_digi_nxt: string;
  bl_awb: string;
  carrier: string;
  remarks: string;
  invoice_ids: string[];
  force: boolean;
}

export async function createShipmentFromInvoices(
  input: NewGroupedShipment,
  actor: AuditActor
): Promise<{ shipment: Shipment; emptied: string[] }> {
  const refFa = input.ref_fa_digi_nxt.trim();
  if (!refFa) throw new ShipmentGroupingError('La Réf FA DIGI-NXT (facture de vente) est obligatoire.');
  const existing = await findShipmentByRefFa(refFa, null);
  if (existing) throw new ShipmentGroupingError(`La Réf FA ${refFa} est déjà celle de l'expédition ${existing}.`, 409);

  const { invoices, notReceived } = await checkInvoices(input.invoice_ids, null, input.force);
  const id = await newShipmentId();
  const today = new Date().toISOString().slice(0, 10);
  const hub = input.mode === 'Air' ? 'Orly' : 'Rouen';
  const history: TrackingHistoryStep[] = [
    {
      date: now(),
      location: hub,
      status: 'Création',
      details: `Expédition ${hub} → Madagascar, Réf FA ${refFa} : ${invoices.length} facture(s) regroupée(s) par ${actor.email}`,
    },
  ];
  if (notReceived.length > 0) history.push(exceptionStep(notReceived, actor));

  const shipment: Shipment = {
    id,
    mode: input.mode,
    supplier: '',
    order_reference: '',
    invoice_no: '',
    bl_awb: input.bl_awb.trim(),
    tracking_no: '',
    carrier: input.carrier.trim(),
    carrier_status: '',
    carrier_last_location: '',
    eta: '',
    global_status: 'En préparation',
    antoine_status: 'Reçu et expédié vers Mada',
    remarks: input.remarks.trim(),
    priority: 'Moyenne',
    weight_kg: 0,
    origin: hub,
    destination: 'Madagascar',
    vessel_flight: '',
    cost_eur: 0,
    customs_status: 'Non Requis',
    ref_fa_digi_nxt: refFa,
    created_at: today,
    updated_at: today,
    documents: [],
    history,
    alerts: [],
    sea_deliveries: [],
  };
  await upsertShipmentInNeon(shipment);
  const emptied = await attachInvoices(id, invoices);
  const summary = await summarize(id);
  const saved = await upsertShipmentInNeon({ ...shipment, ...summary });

  await writeAuditLog({
    entityType: 'SHIPMENT',
    entityId: id,
    action: 'CREATE_SHIPMENT_FROM_INVOICES',
    actor,
    details: {
      ref_fa: refFa,
      mode: input.mode,
      invoice_ids: invoices.map((i) => i.id),
      exception_invoice_ids: notReceived.map((n) => n.id),
      emptied_shipments: emptied,
    },
  });
  return { shipment: saved, emptied };
}

export async function addInvoicesToShipment(
  shipmentId: string,
  invoiceIds: string[],
  force: boolean,
  actor: AuditActor
): Promise<{ shipment: Shipment; emptied: string[] }> {
  const shipment = await getShipmentByIdFromNeon(shipmentId);
  if (!shipment) throw new ShipmentGroupingError('Expédition introuvable.', 404);
  const { invoices, notReceived } = await checkInvoices(invoiceIds, shipmentId, force);
  const emptied = await attachInvoices(shipmentId, invoices);
  const history = [
    ...(shipment.history || []),
    {
      date: now(),
      location: '',
      status: 'Factures ajoutées',
      details: `${invoices.map(label).join(', ')} (par ${actor.email})`,
    },
    ...(notReceived.length > 0 ? [exceptionStep(notReceived, actor)] : []),
  ];
  const saved = await upsertShipmentInNeon({ ...shipment, ...(await summarize(shipmentId)), history });
  await writeAuditLog({
    entityType: 'SHIPMENT',
    entityId: shipmentId,
    action: 'ADD_INVOICES_TO_SHIPMENT',
    actor,
    details: { invoice_ids: invoices.map((i) => i.id), exception_invoice_ids: notReceived.map((n) => n.id), emptied_shipments: emptied },
  });
  return { shipment: saved, emptied };
}

export async function removeInvoiceFromShipment(shipmentId: string, invoiceId: string, actor: AuditActor): Promise<Shipment> {
  const shipment = await getShipmentByIdFromNeon(shipmentId);
  if (!shipment) throw new ShipmentGroupingError('Expédition introuvable.', 404);
  const inv = await getDigiInvoice(invoiceId);
  if (!inv || inv.shipment_id !== shipmentId) throw new ShipmentGroupingError('Cette facture n\'est pas dans l\'expédition.', 404);
  await assignInvoiceToShipment(invoiceId, null);
  const history = [
    ...(shipment.history || []),
    { date: now(), location: '', status: 'Facture retirée', details: `${label(inv)} (par ${actor.email})` },
  ];
  const saved = await upsertShipmentInNeon({ ...shipment, ...(await summarize(shipmentId)), history });
  await writeAuditLog({
    entityType: 'SHIPMENT',
    entityId: shipmentId,
    action: 'REMOVE_INVOICE_FROM_SHIPMENT',
    actor,
    details: { invoice_id: invoiceId, ref: inv.ref },
  });
  return saved;
}
