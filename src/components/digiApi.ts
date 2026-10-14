import type { DigiInvoiceInput } from '../lib/digiInvoices';

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
  supplier_name: string | null;
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
  shipments_created?: number;
  complete: boolean;
}

export interface DigiImportResult {
  created: number;
  duplicates: string[];
  rejected: { ref: string | null; errors: string[] }[];
  shipments_created?: number;
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

export const fetchShipmentInvoices = (shipmentId: string) =>
  apiJson<{ invoices: DigiInvoice[] }>(`/api/shipments/${encodeURIComponent(shipmentId)}/digi-invoices`).then(
    (d) => d.invoices
  );

/** Services only: marked by hand, or every line is a fee line. */
export const isServicesInvoice = (inv: DigiInvoice) => inv.no_shipment || (inv.lines.length > 0 && !inv.has_items);

export const syncDigiOdoo = () =>
  apiJson<DigiOdooSyncResult>('/api/digi-invoices/sync-odoo', { method: 'POST' });

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 });
const amountFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatQuantity = (n: number | null) => (n === null ? '—' : numberFormat.format(n));
export const formatAmount = (n: number | null) => (n === null ? '—' : amountFormat.format(n));
export const formatDate = (ymd: string | null) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};

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
