import type { DigiInvoiceInput } from '../lib/digiInvoices';
import type { DirectInvoiceInput } from '../lib/directInvoices';
import type { CarrierCode } from '../lib/carrierDetection';
import type {
  Currency,
  InvoiceTriage,
  ParcelInput,
  ParcelStatus,
  TrackingSettings,
  ValidationStatus,
} from '../lib/parcelTracking';

export type DigiInvoiceSource = 'odoo' | 'excel' | 'manual';

export interface DigiInvoiceLine {
  id: string;
  position: number;
  name: string;
  quantity: number | null;
  price_unit: number | null;
  price_subtotal: number | null;
  is_service: boolean;
}

export interface DigiInvoice {
  id: string;
  source: DigiInvoiceSource;
  /** Seller on the invoice (marketplace vendor for Amazon orders). */
  supplier_name: string | null;
  /** Supplier for tracking: AMAZON when there is an Amazon order. */
  supplier_display: string | null;
  dest_partner_name: string | null;
  ref: string | null;
  invoice_date: string | null;
  amazon_order_ref: string | null;
  sale_move_ref: string | null;
  odoo_move_id: number | null;
  odoo_move_name: string | null;
  odoo_state: string | null;
  odoo_missing: boolean;
  odoo_synced_at: string | null;
  amount_total: number | null;
  shipment_id: string | null;
  shipment_exists: boolean;
  shipment_mode: 'Air' | 'Sea' | null;
  shipment_global_status: string | null;
  no_shipment: boolean;
  has_items: boolean;
  /** False for a "hors DIGI" invoice (amount + currency, no lines). */
  is_digi: boolean;
  currency: Currency;
  buyer: string | null;
  validation_status: ValidationStatus;
  rejection_reason: string | null;
  validated_by_email: string | null;
  validated_at: string | null;
  triage: InvoiceTriage;
  triaged_at: string | null;
  parcel_count: number;
  parcel_received_count: number;
  created_by_email: string | null;
  updated_by_email: string | null;
  created_at: string;
  updated_at: string;
  lines: DigiInvoiceLine[];
}

export interface DigiSyncRun {
  trigger: 'manual' | 'cron';
  actor_email: string | null;
  started_at: string;
  finished_at: string;
  success: boolean;
  result: Partial<DigiOdooSyncResult> | null;
  error: string | null;
}

export interface DigiConfig {
  odoo_configured: boolean;
  last_sync: DigiSyncRun | null;
  dest_partner_name: string;
  dest_partner_id: number | null;
  import_max_invoices: number;
}

export interface DigiOdooSyncResult {
  listed: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  remaining: number;
  missing: number;
  cancelled_removed: number;
  complete: boolean;
}

export interface DigiImportResult {
  created: number;
  duplicates: string[];
  rejected: { ref: string | null; errors: string[] }[];
}

export async function apiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers || {}) } : init?.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Erreur ${res.status}`);
  }
  return data;
}

export const fetchDigiConfig = () => apiJson<DigiConfig & { success: true }>('/api/digi-invoices/config');

export const fetchDigiInvoices = () =>
  apiJson<{ invoices: DigiInvoice[] }>('/api/digi-invoices').then((d) => d.invoices);

export const saveDigiInvoice = (input: DigiInvoiceInput, id?: string) =>
  apiJson<{ invoice: DigiInvoice }>(id ? `/api/digi-invoices/${id}` : '/api/digi-invoices', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  }).then((d) => d.invoice);

export const deleteDigiInvoice = (id: string) => apiJson(`/api/digi-invoices/${id}`, { method: 'DELETE' });

export const importDigiInvoices = (invoices: DigiInvoiceInput[], fileName: string) =>
  apiJson<DigiImportResult>('/api/digi-invoices/import', {
    method: 'POST',
    body: JSON.stringify({ invoices, file_name: fileName }),
  });

export const createShipmentFromInvoice = (id: string) =>
  apiJson<{ invoice: DigiInvoice; shipment: { id: string } }>(`/api/digi-invoices/${id}/create-shipment`, {
    method: 'POST',
  });

export const setInvoiceServices = (id: string, noShipment: boolean) =>
  apiJson<{ invoice: DigiInvoice; detached_shipment_id: string | null }>(`/api/digi-invoices/${id}/services`, {
    method: 'PATCH',
    body: JSON.stringify({ no_shipment: noShipment }),
  });

export const assignInvoiceShipment = (id: string, shipmentId: string | null) =>
  apiJson<{ invoice: DigiInvoice; previous_shipment_id: string | null; previous_shipment_empty: boolean }>(
    `/api/digi-invoices/${id}/shipment`,
    { method: 'PATCH', body: JSON.stringify({ shipment_id: shipmentId }) }
  );

export const fetchShipmentInvoices = (shipmentId: string) =>
  apiJson<{ invoices: DigiInvoice[] }>(`/api/shipments/${encodeURIComponent(shipmentId)}/digi-invoices`).then(
    (d) => d.invoices
  );

/** Services only: sorted as services, or every line is a fee line. */
export const isServicesInvoice = (inv: DigiInvoice) =>
  inv.triage === 'services' || inv.no_shipment || (inv.is_digi && inv.lines.length > 0 && !inv.has_items);

/** "Hors DIGI" invoice not validated by Supply Chain yet (pending or refused). */
export const isAwaitingValidation = (inv: DigiInvoice) => !inv.is_digi && inv.validation_status !== 'validated';

/** Tracked invoice: sorted as goods (DIGI) or "hors DIGI" not refused. */
export const isGoodsInvoice = (inv: DigiInvoice) =>
  !isServicesInvoice(inv) && inv.triage === 'goods' && inv.validation_status !== 'rejected';

/** Received at Orly: every parcel confirmed by Antoine. */
export const isInvoiceReceived = (inv: DigiInvoice) =>
  inv.parcel_count > 0 && inv.parcel_received_count === inv.parcel_count;

// ---- "Hors DIGI" invoices, sort, validation ----

export const saveDirectInvoice = (input: DirectInvoiceInput, id?: string) =>
  apiJson<{ invoice: DigiInvoice }>(id ? `/api/digi-invoices/${id}/direct` : '/api/digi-invoices/direct', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  }).then((d) => d.invoice);

export const setInvoiceTriage = (id: string, triage: InvoiceTriage) =>
  apiJson<{ invoice: DigiInvoice; detached_shipment_id: string | null }>(`/api/digi-invoices/${id}/triage`, {
    method: 'PATCH',
    body: JSON.stringify({ triage }),
  });

export const setInvoiceValidation = (id: string, decision: 'validated' | 'rejected', reason?: string) =>
  apiJson<{ invoice: DigiInvoice }>(`/api/digi-invoices/${id}/validation`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, reason }),
  }).then((d) => d.invoice);

// ---- Parcels ----

export interface Parcel {
  id: string;
  tracking_number: string | null;
  carrier: CarrierCode;
  /** Carrier of the Settings list (Paramètres › Transporteurs). */
  carrier_name: string | null;
  supplier_name: string | null;
  expected_delivery: string | null;
  status: ParcelStatus;
  received_at: string | null;
  received_by_email: string | null;
  status_changed_at: string | null;
  notes: string | null;
  legacy_shipment_id: string | null;
  invoices: { id: string; ref: string | null; supplier_display: string | null; invoice_date: string | null }[];
  photo_count: number;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchInvoiceParcels = (invoiceId: string) =>
  apiJson<{ parcels: Parcel[] }>(`/api/digi-invoices/${invoiceId}/parcels`).then((d) => d.parcels);

export const createParcel = (input: ParcelInput, invoiceIds: string[]) =>
  apiJson<{ parcel: Parcel; existed: boolean }>('/api/parcels', {
    method: 'POST',
    body: JSON.stringify({ ...input, invoice_ids: invoiceIds }),
  });

export const updateParcel = (id: string, input: ParcelInput) =>
  apiJson<{ parcel: Parcel }>(`/api/parcels/${id}`, { method: 'PUT', body: JSON.stringify(input) }).then(
    (d) => d.parcel
  );

export const unlinkParcel = (parcelId: string, invoiceId: string) =>
  apiJson<{ deleted: boolean }>(`/api/parcels/${parcelId}/invoices/${invoiceId}`, { method: 'DELETE' });

// ---- Settings ----

export const fetchTrackingSettings = () =>
  apiJson<{ settings: TrackingSettings }>('/api/settings/tracking').then((d) => d.settings);

export const saveTrackingSettings = (update: Partial<TrackingSettings>) =>
  apiJson<{ settings: TrackingSettings }>('/api/settings/tracking', {
    method: 'PUT',
    body: JSON.stringify(update),
  }).then((d) => d.settings);

export const syncDigiOdoo = () =>
  apiJson<DigiOdooSyncResult>('/api/digi-invoices/sync-odoo', { method: 'POST' });

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 });
const amountFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatQuantity = (n: number | null) => (n === null ? '—' : numberFormat.format(n));
export const formatAmount = (n: number | null) => (n === null ? '—' : amountFormat.format(n));
export { formatDate, formatDateTime } from '../lib/dateFormat';

export const SOURCE_LABELS: Record<DigiInvoiceSource, string> = {
  odoo: 'Odoo',
  excel: 'Import Excel',
  manual: 'Saisie manuelle',
};

export const ODOO_STATE_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  posted: 'Comptabilisée',
  cancel: 'Annulée',
};

const inputBase =
  'w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-medium text-slate-800 focus:border-[#643288] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';
export const inputClass = `mt-1 ${inputBase}`;
export const cellInputClass = inputBase;
