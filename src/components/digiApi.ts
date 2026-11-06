import type { DigiInvoiceInput } from '../lib/digiInvoices';
import type { DirectInvoiceInput } from '../lib/directInvoices';
import type { CarrierCode } from '../lib/carrierDetection';
import type { ParcelBox, ParcelNumberKind } from '../lib/parcelBoxes';
import type { AmazonImportLine, AmazonImportOutcome, AmazonReportRow } from '../lib/amazonReport';
import type {
  Currency,
  DeliveryType,
  ParcelDestination,
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
  /** Supplier typed in the app, when Odoo has another name for it (same BL). */
  entered_supplier_name: string | null;
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
  /** Boxes received for its parcels (one per photo matched at a point). */
  box_received_count: number;
  /** Boxes announced in all, null when a parcel has no count. */
  box_expected_total: number | null;
  incomplete_parcels: { tracking_number: string | null; received: number; expected: number }[];
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
    // `code`: refusal to confirm (e.g. BOXES_EXPECTED_CONFLICT)
    throw Object.assign(new Error(data?.error || `Erreur ${res.status}`), { code: data?.code as string | undefined });
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

export const setInvoiceServices = (id: string, noShipment: boolean) =>
  apiJson<{ invoice: DigiInvoice; detached_shipment_id: string | null }>(`/api/digi-invoices/${id}/services`, {
    method: 'PATCH',
    body: JSON.stringify({ no_shipment: noShipment }),
  });

// ---- Shipments Orly / Rouen → Mada (grouping of received invoices, Supply Chain) ----

export interface NotReceivedInvoice {
  id: string;
  ref: string | null;
  supplier: string | null;
  parcels_received: number;
  parcels_total: number;
  /** "colis 123 : 2/3 boîtes" */
  incomplete: string[];
}

/**
 * Outcome of a grouping request. needsException: invoices whose parcels are
 * not all confirmed received; the same request is sent again with force
 * once Supply Chain confirms the exception.
 */
export type GroupingResult =
  | { ok: true; shipment: { id: string }; emptied: string[] }
  | { ok: false; needsException: NotReceivedInvoice[] }
  /** Air: parcels received at Orly on several dates, to confirm (mixed_dates). */
  | { ok: false; mixedDates: string[] };

async function groupingRequest(url: string, method: string, body: unknown): Promise<GroupingResult> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && Array.isArray(data?.not_received) && data.not_received.length > 0) {
    return { ok: false, needsException: data.not_received };
  }
  if (res.status === 409 && Array.isArray(data?.reception_dates) && data.reception_dates.length > 1) {
    return { ok: false, mixedDates: data.reception_dates };
  }
  if (!res.ok || !data?.success) throw new Error(data?.error || `Erreur ${res.status}`);
  return { ok: true, shipment: data.shipment, emptied: data.emptied || [] };
}

export const createShipmentFromInvoices = (input: {
  mode: 'Air' | 'Sea';
  ref_fa_digi_nxt: string;
  bl_awb: string;
  carrier: string;
  remarks: string;
  invoice_ids: string[];
  force: boolean;
  mixed_dates?: boolean;
}) => groupingRequest('/api/shipments/from-invoices', 'POST', input);

export const addInvoicesToShipment = (shipmentId: string, invoiceIds: string[], force: boolean, mixedDates = false) =>
  groupingRequest(`/api/shipments/${encodeURIComponent(shipmentId)}/invoices`, 'POST', {
    invoice_ids: invoiceIds,
    force,
    mixed_dates: mixedDates,
  });

export const removeInvoiceFromShipment = (shipmentId: string, invoiceId: string) =>
  apiJson(`/api/shipments/${encodeURIComponent(shipmentId)}/invoices/${invoiceId}`, { method: 'DELETE' });

export const fetchShipmentParcels = (shipmentId: string) =>
  apiJson<{ parcels: Parcel[] }>(`/api/shipments/${encodeURIComponent(shipmentId)}/parcels`).then((d) => d.parcels);

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
  /** Shipments of its invoices (or the shipment it was taken from). */
  shipment_ids: string[];
  invoices: {
    id: string;
    ref: string | null;
    supplier_display: string | null;
    invoice_date: string | null;
    /** DIGI: total of the lines (EUR); hors DIGI: amount in `currency`. */
    amount_total: number | null;
    currency: string;
  }[];
  photo_count: number;
  /** Boxes announced (optional): "Reçu partiel" alert when fewer arrive in time. */
  boxes_expected: number | null;
  /** Boxes received, oldest first (one per photo matched at a point). */
  boxes: ParcelBox[];
  /** Other numbers (supplier, carrier, box): any of them finds the parcel. */
  numbers: { id: string; number: string; kind: ParcelNumberKind }[];
  /** Created at a reception point (label not found): may be a box of another parcel. */
  created_at_point: boolean;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceWithoutParcel {
  id: string;
  ref: string | null;
  supplier_display: string | null;
  invoice_date: string | null;
  is_digi: boolean;
  validation_status: ValidationStatus;
}

export interface ParcelsOverview {
  parcels: Parcel[];
  invoices_without_parcel: InvoiceWithoutParcel[];
  photo_storage_configured: boolean;
}

/** Every parcel (overdue ones are marked lost by the server first). */
export const fetchAllParcels = () => apiJson<ParcelsOverview>('/api/parcels');

/** Supply Chain: reception at the hub, avis de recherche, lost, back to waiting. */
export const setParcelStatus = (id: string, status: ParcelStatus, receivedAt?: string | null) =>
  apiJson<{ parcel: Parcel }>(`/api/parcels/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, received_at: receivedAt || null }),
  }).then((d) => d.parcel);

/** Supply Chain: parcel not announced, created at reception (already received). */
export const createReceivedParcel = (input: ParcelInput, invoiceIds: string[], receivedAt: string) =>
  apiJson<{ parcel: Parcel; existed: boolean }>('/api/parcels', {
    method: 'POST',
    body: JSON.stringify({ ...input, invoice_ids: invoiceIds, received: true, received_at: receivedAt }),
  });

export interface ParcelPhoto {
  id: string;
  /** Authenticated display route (null when the storage is not configured). */
  url: string | null;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by_email: string | null;
  uploaded_at: string;
}

export const fetchParcelPhotos = (parcelId: string) =>
  apiJson<{ photos: ParcelPhoto[]; storage_configured: boolean }>(`/api/parcels/${parcelId}/photos`);

export const deleteParcelPhoto = (parcelId: string, photoId: string) =>
  apiJson(`/api/parcels/${parcelId}/photos/${photoId}`, { method: 'DELETE' });

// ---- Point Antoine (Orly) / reception at Rouen ----

export interface ReceptionPoint {
  id: string;
  destination: ParcelDestination;
  point_date: string;
  notes: string | null;
  created_by_email: string | null;
  created_at: string;
  photo_count: number;
  linked_count: number;
}

export interface PointPhoto extends ParcelPhoto {
  /** Parcel the photo was matched to (null = to match). */
  parcel_id: string | null;
  linked_by_email: string | null;
  linked_at: string | null;
}

export const fetchReceptionPoints = (destination: ParcelDestination) =>
  apiJson<{ points: ReceptionPoint[]; storage_configured: boolean }>(`/api/reception-points?destination=${destination}`);

export const createReceptionPoint = (destination: ParcelDestination, pointDate: string) =>
  apiJson<{ point: ReceptionPoint }>('/api/reception-points', {
    method: 'POST',
    body: JSON.stringify({ destination, point_date: pointDate }),
  }).then((d) => d.point);

/** New date of the point: the parcels it confirmed at the old date follow. */
export const updateReceptionPointDate = (id: string, pointDate: string) =>
  apiJson<{ point: ReceptionPoint }>(`/api/reception-points/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ point_date: pointDate }),
  }).then((d) => d.point);

/** Deletes the point: matched photos stay on their parcel, the others are deleted. */
export const deleteReceptionPoint = (id: string) =>
  apiJson<{ deleted_photos: number; kept_photos: number }>(`/api/reception-points/${id}`, { method: 'DELETE' });

export const fetchReceptionPoint = (id: string) =>
  apiJson<{ point: ReceptionPoint; photos: PointPhoto[]; storage_configured: boolean }>(`/api/reception-points/${id}`);

/**
 * Uploads one compressed photo of a point: the server stores it in the point's
 * Google Drive folder (shared drive) and keeps only its Drive id.
 */
export const uploadPointPhoto = (pointId: string, photo: Blob) =>
  apiJson<{ id: string }>(`/api/reception-points/${pointId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': photo.type },
    body: photo,
  });

export interface PhotoStorageCheck {
  ok: boolean;
  steps: { label: string; ok: boolean; detail: string }[];
}

/** Step-by-step check of the Google Drive set-up (Supply Chain). */
export const checkPhotoStorage = () => apiJson<PhotoStorageCheck>('/api/photos/diagnostic');

/** Optional box fields: number of the box, "x of N" of the label (a different N needs confirmation). */
export interface PointBoxFields {
  piece_number?: string | null;
  box_index?: number | null;
  boxes_expected?: number | null;
  confirm_boxes_expected?: boolean;
}

export type PointPhotoLink =
  | { parcel_id: null }
  | ({ parcel_id: string } & PointBoxFields)
  /** Parcel announced without number: the number read on the label completes it. */
  | ({ parcel_id: string; tracking_number: string } & PointBoxFields)
  /** Form of the point: completes the parcel (number if it has none, BL, carrier if it has none). */
  | ({ parcel_id: string; tracking_number?: string | null; bl_number?: string | null; carrier_name?: string | null } & PointBoxFields)
  | ({
      new_parcel: {
        tracking_number: string | null;
        bl_number?: string | null;
        invoice_ids: string[];
        carrier_name?: string | null;
      };
    } & PointBoxFields)
  /** Received before its invoice is in the base: linked to it later by the same number. */
  | ({ new_parcel: { tracking_number: string; supplier_name: string; without_invoice: true } } & PointBoxFields);

/** Matches a photo to a parcel (confirms its reception at the point date), or detaches it. */
export const linkPointPhoto = (pointId: string, photoId: string, link: PointPhotoLink) =>
  apiJson<{
    parcel: Parcel | null;
    created?: boolean;
    reception_confirmed?: boolean;
    /** "x" already received on this parcel: probably the same box twice. */
    duplicate_box_index?: boolean;
    /** Detached: it was the only box, the parcel is "to receive" again. */
    back_to_receive?: boolean;
  }>(
    `/api/reception-points/${pointId}/photos/${photoId}`,
    { method: 'PATCH', body: JSON.stringify(link) }
  );

export const deletePointPhoto = (pointId: string, photoId: string) =>
  apiJson(`/api/reception-points/${pointId}/photos/${photoId}`, { method: 'DELETE' });

export const fetchInvoiceParcels = (invoiceId: string) =>
  apiJson<{ parcels: Parcel[] }>(`/api/digi-invoices/${invoiceId}/parcels`).then((d) => d.parcels);

/** blNumber: BL of the new parcel, saved as another number of it. */
export const createParcel = (input: ParcelInput, invoiceIds: string[], blNumber: string | null = null) =>
  apiJson<{ parcel: Parcel; existed: boolean; matched_by: 'primary' | ParcelNumberKind | null }>('/api/parcels', {
    method: 'POST',
    body: JSON.stringify({ ...input, invoice_ids: invoiceIds, bl_number: blNumber }),
  });

export const updateParcel = (id: string, input: ParcelInput) =>
  apiJson<{ parcel: Parcel }>(`/api/parcels/${id}`, { method: 'PUT', body: JSON.stringify(input) }).then(
    (d) => d.parcel
  );

export const addParcelNumber = (parcelId: string, number: string, kind: ParcelNumberKind) =>
  apiJson<{ parcel: Parcel }>(`/api/parcels/${parcelId}/numbers`, {
    method: 'POST',
    body: JSON.stringify({ number, kind }),
  }).then((d) => d.parcel);

export const removeParcelNumber = (parcelId: string, numberId: string) =>
  apiJson<{ parcel: Parcel }>(`/api/parcels/${parcelId}/numbers/${numberId}`, { method: 'DELETE' }).then((d) => d.parcel);

export const setParcelBoxesExpected = (parcelId: string, boxes: number | null) =>
  apiJson<{ parcel: Parcel }>(`/api/parcels/${parcelId}/boxes-expected`, {
    method: 'PATCH',
    body: JSON.stringify({ boxes_expected: boxes }),
  }).then((d) => d.parcel);

/** Supply Chain: merges a parcel created apart (a box) into the main parcel. */
export const mergeParcelInto = (parcelId: string, principalId: string, boxesExpected: number | null) =>
  apiJson<{ parcel: Parcel }>(`/api/parcels/${parcelId}/merge-into`, {
    method: 'POST',
    body: JSON.stringify({ principal_id: principalId, boxes_expected: boxesExpected }),
  }).then((d) => d.parcel);

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
  'w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-medium text-slate-800 focus:border-[#623387] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';
export const inputClass = `mt-1 ${inputBase}`;
export const cellInputClass = inputBase;

export interface AmazonImportResult {
  applied: boolean;
  counts: Partial<Record<AmazonImportOutcome, number>>;
  lines: AmazonImportLine[];
}

/** Amazon shipment report: preview (apply = false), then creation of the parcels. */
export const importAmazonReport = (destination: ParcelDestination, rows: AmazonReportRow[], apply: boolean) =>
  apiJson<AmazonImportResult>('/api/parcels/import-amazon', {
    method: 'POST',
    body: JSON.stringify({ destination, rows, apply }),
  });

export interface ParcelContentsInvoice {
  id: string;
  ref: string | null;
  supplier_display: string | null;
  invoice_date: string | null;
  amazon_order_ref: string | null;
  amount_total: number | null;
  currency: Currency;
  lines: DigiInvoiceLine[];
}

/** Invoices of a parcel with their lines (aperçu du contenu). */
export const fetchParcelContents = (parcelId: string) =>
  apiJson<{ invoices: ParcelContentsInvoice[] }>(`/api/parcels/${parcelId}/contents`).then((d) => d.invoices);
