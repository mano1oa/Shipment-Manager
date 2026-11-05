import { Shipment } from '../types';
import { apiJson } from './digiApi';

// ---- Confirmation of a shipment Orly / Rouen → Mada (Supply Chain) ----

export interface ConfirmationResult {
  shipment: Shipment;
  /** Google Chat memo of the parcels; chat_error when it could not be posted. */
  message: string;
  chat_sent: boolean;
  chat_error: string | null;
}

export const confirmShipment = (shipmentId: string) =>
  apiJson<ConfirmationResult>(`/api/shipments/${encodeURIComponent(shipmentId)}/confirm`, { method: 'POST' });

export const unlockShipment = (shipmentId: string) =>
  apiJson<{ shipment: Shipment }>(`/api/shipments/${encodeURIComponent(shipmentId)}/unlock`, { method: 'POST' }).then(
    (d) => d.shipment
  );

// ---- Arrival check in Madagascar: received quantities (Sourcing, Supply Chain) ----

export interface ReceivedArticle {
  shipment_id: string;
  ref_fa_digi_nxt: string | null;
  shipment_mode: 'Air' | 'Sea';
  shipment_global_status: string | null;
  confirmed_at: string | null;
  orly_scan_date: string | null;
  invoice_id: string;
  invoice_ref: string | null;
  supplier: string | null;
  position: number;
  name: string;
  quantity: number | null;
  quantity_received: number | null;
  received_by_email: string | null;
  received_updated_at: string | null;
}

/** Articles of the confirmed shipments (of one shipment when shipmentId is given). */
export const fetchReceivedArticles = (shipmentId?: string) =>
  apiJson<{ articles: ReceivedArticle[] }>(
    `/api/received-articles${shipmentId ? `?shipment_id=${encodeURIComponent(shipmentId)}` : ''}`
  ).then((d) => d.articles);

export const saveReceivedQuantity = (invoiceId: string, position: number, quantity: number | null) =>
  apiJson('/api/received-articles', {
    method: 'PUT',
    body: JSON.stringify({ invoice_id: invoiceId, position, quantity_received: quantity }),
  });

export const articleKey = (a: Pick<ReceivedArticle, 'invoice_id' | 'position'>) => `${a.invoice_id}:${a.position}`;

/** Gap between received and invoiced quantity; null while not typed. */
export const receivedGap = (a: Pick<ReceivedArticle, 'quantity' | 'quantity_received'>) =>
  a.quantity_received === null ? null : a.quantity_received - (a.quantity ?? 0);
