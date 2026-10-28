import { getShipmentByIdFromNeon, upsertShipmentInNeon } from '../db/shipments.js';
import { InvoiceForShipment, claimInvoiceForShipment, releaseInvoiceClaim } from '../db/digiInvoices.js';
import { writeAuditLog, AuditActor } from '../db/audit.js';
import { Shipment } from '../types.js';
import { trackingSupplierName } from '../lib/digiInvoices.js';

/**
 * Shipment of a DIGI invoice, created on request only ("Créer l'expédition",
 * one invoice or a selection): imported invoices also hold services, so an
 * invoice is never assumed to be goods to ship. Air by default, changeable in
 * the shipment.
 */

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
    supplier: trackingSupplierName(invoice.supplier_name, invoice.amazon_order_ref) || '',
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
        details: `Créée depuis la facture DIGI ${invoiceLabel}${
          invoice.supplier_name ? ` (vendeur : ${invoice.supplier_name})` : ''
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

