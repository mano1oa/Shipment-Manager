import {
  getShipmentByIdFromNeon,
  upsertShipmentInNeon,
  findShipmentByRefFa,
  setShipmentConfirmation,
} from '../db/shipments.js';
import { assignInvoiceToShipment, getDigiInvoice, listDigiInvoicesForShipment } from '../db/digiInvoices.js';
import type { DigiInvoiceRecord } from '../db/digiInvoices.js';
import { writeAuditLog, AuditActor } from '../db/audit.js';
import { listParcelsForShipment, receptionDates } from '../db/parcels.js';
import { shipmentChatMessage } from '../lib/shipmentChatMessage.js';
import { Shipment, TrackingHistoryStep, shipmentLabel } from '../types.js';
import { sendChatMessage } from './googleChat.js';

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
  constructor(
    message: string,
    public status = 400,
    public notReceived: NotReceivedInvoice[] = [],
    /** Air: parcels received at Orly on several dates, to confirm with mixed_dates. */
    public receptionDates: string[] = []
  ) {
    super(message);
  }
}

export interface NotReceivedInvoice {
  id: string;
  ref: string | null;
  supplier: string | null;
  parcels_received: number;
  parcels_total: number;
  /** Received parcels with boxes missing: "colis 123 : 2/3 boîtes". */
  incomplete: string[];
}

const label = (inv: DigiInvoiceRecord) => inv.ref || inv.odoo_move_name || inv.id.slice(0, 8);

/** A confirmed shipment keeps its invoices and parcels until Supply Chain unlocks it. */
export const confirmedMessage = (s: Pick<Shipment, 'id' | 'ref_fa_digi_nxt'>) =>
  `L'expédition ${shipmentLabel(s)} est confirmée : ses factures et colis ne peuvent plus changer. Déverrouillez-la d'abord (Supply Chain).`;

function assertNotConfirmed(shipment: Shipment) {
  if (shipment.confirmed_at) throw new ShipmentGroupingError(confirmedMessage(shipment), 409);
}
const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
/** All its parcels received, with every announced box (an incomplete parcel needs the exception). */
const isReceived = (inv: DigiInvoiceRecord) =>
  inv.parcel_count > 0 && inv.parcel_received_count === inv.parcel_count && inv.incomplete_parcels.length === 0;
const incompleteLabels = (inv: DigiInvoiceRecord) =>
  inv.incomplete_parcels.map((p) => `colis ${p.tracking_number || 'sans n°'} : ${p.received}/${p.expected} boîtes`);

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
      if (current && (!current.needs_review || current.confirmed_at)) {
        throw new ShipmentGroupingError(`${name} : déjà dans l'expédition ${shipmentLabel(current)}.`, 409);
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
      incomplete: incompleteLabels(inv),
    }));
  if (notReceived.length > 0 && !force) {
    throw new ShipmentGroupingError(
      `${notReceived.length} facture(s) dont les colis ne sont pas tous confirmés reçus (ou avec des boîtes manquantes) : exception à confirmer.`,
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
    details: `Factures ajoutées sans tous leurs colis (ou boîtes) confirmés reçus (par ${actor.email}) : ${notReceived
      .map(
        (n) =>
          `${n.ref || '—'} (${n.parcels_received}/${n.parcels_total} colis${n.incomplete.length > 0 ? ` ; ${n.incomplete.join(', ')}` : ''})`
      )
      .join(', ')}`,
  };
}

/**
 * Air: a shipment groups the parcels confirmed at Orly the same day (its
 * hand-over date); several dates are a likely mistake, to confirm.
 */
function checkSameReceptionDate(dates: string[], confirmed: boolean) {
  if (dates.length > 1 && !confirmed) {
    throw new ShipmentGroupingError(
      `Colis reçus à Orly à des dates différentes (${dates.join(', ')}) : une expédition regroupe normalement une seule date de réception.`,
      409,
      [],
      dates
    );
  }
}

/** Saturday flight from Orly: the scan day itself if a Saturday (same rule as calculateDepartureMadagascar). */
function saturdayFrom(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
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
  /** Air: parcels received at Orly on several dates, confirmed. */
  mixed_dates: boolean;
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
  // Air: grouped once received at Orly, so it leaves at once; hand-over = latest
  // reception of its parcels (gives the Saturday flight and the ETA)
  const air = input.mode === 'Air';
  const dates = air ? await receptionDates(invoices.map((i) => i.id)) : [];
  checkSameReceptionDate(dates, input.mixed_dates);
  const orlyScan = dates[dates.length - 1] ?? today;
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
    global_status: air ? 'Expédiée vers Mada' : 'En préparation',
    ...(air ? { orly_scan_date: orlyScan, departure_madagascar: saturdayFrom(orlyScan) } : {}),
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
  actor: AuditActor,
  mixedDates = false
): Promise<{ shipment: Shipment; emptied: string[] }> {
  const shipment = await getShipmentByIdFromNeon(shipmentId);
  if (!shipment) throw new ShipmentGroupingError('Expédition introuvable.', 404);
  assertNotConfirmed(shipment);
  const { invoices, notReceived } = await checkInvoices(invoiceIds, shipmentId, force);
  if (shipment.mode === 'Air') {
    const dates = await receptionDates(invoices.map((i) => i.id));
    checkSameReceptionDate(
      Array.from(new Set([...(shipment.orly_scan_date ? [shipment.orly_scan_date] : []), ...dates])).sort(),
      mixedDates
    );
  }
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
  assertNotConfirmed(shipment);
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

export interface ConfirmationOutcome {
  shipment: Shipment;
  /** Google Chat memo of the parcels; chat_sent false when not posted (no webhook or rejected). */
  message: string;
  chat_sent: boolean;
  chat_error: string | null;
}

/** Posts the memo on the "Confirmation des expéditions" webhooks. Null when sent. */
async function postToGoogleChat(text: string): Promise<string | null> {
  const { sent, error } = await sendChatMessage('shipment_confirmed', text);
  if (error) console.error('[Shipments] Google Chat memo:', error);
  return sent > 0 ? null : error;
}

/** Memo of the shipment's parcels, dated by the hand-over at Orly (today when unknown). */
export async function confirmationMessage(shipment: Shipment): Promise<string> {
  const [invoices, parcels] = await Promise.all([
    listDigiInvoicesForShipment(shipment.id),
    listParcelsForShipment(shipment.id),
  ]);
  const date = shipment.orly_scan_date || new Date().toISOString().slice(0, 10);
  return shipmentChatMessage(
    date,
    invoices.map((i) => ({ id: i.id, ref: label(i), supplier: i.supplier_display, amazon_order_ref: i.amazon_order_ref })),
    parcels.map((p) => ({ tracking_number: p.tracking_number, invoice_ids: p.invoices.map((i) => i.id) })),
    process.env.ODOO_DEST_PARTNER_NAME?.trim() || 'NextHope'
  );
}

/**
 * Supply Chain confirms the shipment: its invoices and parcels are frozen,
 * then the memo of its parcels is posted on Google Chat (sent again at each
 * new confirmation after an unlock).
 */
export async function confirmShipment(shipmentId: string, actor: AuditActor): Promise<ConfirmationOutcome> {
  const shipment = await getShipmentByIdFromNeon(shipmentId);
  if (!shipment) throw new ShipmentGroupingError('Expédition introuvable.', 404);
  if (shipment.confirmed_at) throw new ShipmentGroupingError(`L'expédition ${shipmentLabel(shipment)} est déjà confirmée.`, 409);
  if ((await listDigiInvoicesForShipment(shipmentId)).length === 0) {
    throw new ShipmentGroupingError('Ajoutez au moins une facture avant de confirmer l\'expédition.');
  }

  await setShipmentConfirmation(shipmentId, actor.email);
  const message = await confirmationMessage(shipment);
  const chatError = await postToGoogleChat(message);
  const history = [
    ...(shipment.history || []),
    {
      date: now(),
      location: '',
      status: 'Expédition confirmée',
      details: `Factures et colis verrouillés par ${actor.email}${chatError ? ` (message Google Chat non envoyé : ${chatError})` : ', message Google Chat envoyé'}`,
    },
  ];
  await upsertShipmentInNeon({ ...shipment, history });
  await writeAuditLog({
    entityType: 'SHIPMENT',
    entityId: shipmentId,
    action: 'CONFIRM_SHIPMENT',
    actor,
    details: { chat_sent: !chatError, chat_error: chatError },
  });
  const saved = await getShipmentByIdFromNeon(shipmentId);
  return { shipment: saved!, message, chat_sent: !chatError, chat_error: chatError };
}

/** Supply Chain unlocks a confirmed shipment to correct its invoices or parcels. */
export async function unlockShipment(shipmentId: string, actor: AuditActor): Promise<Shipment> {
  const shipment = await getShipmentByIdFromNeon(shipmentId);
  if (!shipment) throw new ShipmentGroupingError('Expédition introuvable.', 404);
  if (!shipment.confirmed_at) return shipment;
  await setShipmentConfirmation(shipmentId, null);
  const history = [
    ...(shipment.history || []),
    { date: now(), location: '', status: 'Expédition déverrouillée', details: `Par ${actor.email}` },
  ];
  await upsertShipmentInNeon({ ...shipment, history });
  await writeAuditLog({ entityType: 'SHIPMENT', entityId: shipmentId, action: 'UNLOCK_SHIPMENT', actor, details: {} });
  return (await getShipmentByIdFromNeon(shipmentId))!;
}
