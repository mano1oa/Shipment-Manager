import { getShipmentByIdFromNeon, upsertShipmentInNeon } from '../db/shipments.js';
import {
  InvoiceForShipment,
  claimInvoiceForShipment,
  listInvoicesNeedingShipment,
  releaseInvoiceClaim,
} from '../db/digiInvoices.js';
import { writeAuditLog, AuditActor } from '../db/audit.js';
import { Shipment } from '../types.js';

/**
 * Every DIGI invoice to NextHope is goods to track: it gets its own shipment
 * automatically (air by default, changeable in the shipment).
 *
 * Not created for: invoices marked as services (manual work), invoices with
 * fee lines only, Odoo drafts (created once posted), and invoices dated before
 * DIGI_AUTO_SHIPMENT_FROM (YYYY-MM-DD; default: last 60 days) so that the
 * history already delivered does not flood the shipment lists. Those can still
 * get a shipment with the "Créer l'expédition" button.
 */

const DEFAULT_LOOKBACK_DAYS = 60;
const MAX_PER_RUN = 150;

export const SYSTEM_ACTOR: AuditActor = { id: 'system', email: 'system@digi-sync', role: 'SYSTEM' };

export function getAutoShipmentFromDate(): string {
  const configured = process.env.DIGI_AUTO_SHIPMENT_FROM?.trim();
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) return configured;
  const d = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400000);
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

function buildShipment(id: string, invoice: InvoiceForShipment): Shipment {
  const today = new Date().toISOString().slice(0, 10);
  const invoiceLabel = invoice.ref || invoice.odoo_move_name || invoice.id;
  return {
    id,
    mode: 'Air',
    supplier: invoice.supplier_name || '',
    order_reference: invoice.amazon_order_ref || invoice.ref || invoice.odoo_move_name || '',
    invoice_no: invoice.ref || '',
    bl_awb: '',
    tracking_no: '',
    carrier: '',
    carrier_status: '',
    carrier_last_location: '',
    eta: '',
    // Invoiced = ordered: the parcel is on its way to the Orly hub
    global_status: 'En livraison vers Orly',
    antoine_status: 'En attente Antoine',
    remarks: '',
    priority: 'Moyenne',
    weight_kg: 0,
    origin: '',
    destination: '',
    vessel_flight: '',
    cost_eur: 0,
    customs_status: 'Non Requis',
    ref_fa_digi_nxt: invoice.sale_move_ref || '',
    created_at: today,
    updated_at: today,
    documents: [],
    history: [
      {
        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        location: '',
        status: 'Création',
        details: `Créée automatiquement depuis la facture DIGI ${invoiceLabel}${
          invoice.supplier_name ? ` (${invoice.supplier_name})` : ''
        }`,
      },
    ],
    alerts: [],
    sea_deliveries: [],
  };
}

/**
 * Creates the shipment of one invoice. Returns null when the invoice is
 * marked as services or already has a shipment.
 */
export async function createShipmentForInvoice(
  invoice: InvoiceForShipment,
  actor: AuditActor
): Promise<Shipment | null> {
  const id = await newShipmentId();
  if (!(await claimInvoiceForShipment(invoice.id, id))) return null;

  try {
    const saved = await upsertShipmentInNeon(buildShipment(id, invoice));
    await writeAuditLog({
      entityType: 'SHIPMENT',
      entityId: saved.id,
      action: 'CREATE_SHIPMENT_FROM_DIGI_INVOICE',
      actor,
      details: { invoice_id: invoice.id, invoice_ref: invoice.ref, supplier: invoice.supplier_name },
    });
    return saved;
  } catch (err) {
    await releaseInvoiceClaim(invoice.id, id);
    throw err;
  }
}

/**
 * Creates the missing shipments (after an Odoo sync, an import or a manual
 * entry). Failures are logged and retried on the next run.
 */
export async function createPendingShipments(actor: AuditActor = SYSTEM_ACTOR): Promise<number> {
  const invoices = await listInvoicesNeedingShipment(getAutoShipmentFromDate(), MAX_PER_RUN);
  let created = 0;
  for (const invoice of invoices) {
    try {
      if (await createShipmentForInvoice(invoice, actor)) created++;
    } catch (err: any) {
      console.error('[DIGI] Could not create shipment for invoice', invoice.id, err?.message || err);
    }
  }
  return created;
}
