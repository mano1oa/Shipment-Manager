import { listGoodsInvoicesWithoutParcel } from '../db/parcels.js';
import type { InvoiceWithoutParcel } from '../db/parcels.js';
import { formatDate } from '../lib/dateFormat.js';
import { sendChatMessage } from './googleChat.js';

/**
 * Daily list (8 h, Madagascar) for the Supply Chain: goods invoices that have
 * no parcel yet (tracking number still to enter). Nothing is posted when the
 * list is empty.
 */

/** Messages are cut to stay under the Google Chat text limit. */
const MAX_LINES = 40;

export function invoicesWithoutParcelMessage(invoices: InvoiceWithoutParcel[]): string {
  const lines = invoices.slice(0, MAX_LINES).map(
    (i) =>
      `- ${i.supplier_display || 'Fournisseur inconnu'} · facture ${i.ref || '—'}${
        i.invoice_date ? ` du ${formatDate(i.invoice_date)}` : ''
      }${i.is_digi ? '' : ' (hors DIGI)'}`
  );
  const more =
    invoices.length > MAX_LINES ? `\n… et ${invoices.length - MAX_LINES} autre(s) : voir Factures fournisseurs.` : '';
  return `📋 *Factures sans colis — ${invoices.length} à voir*\n${lines.join('\n')}${more}\n👉 Saisir les n° de suivi dans Shipment Manager › Factures fournisseurs.`;
}

export async function runInvoicesWithoutParcelDigest(): Promise<{ invoices: number; sent: number; error: string | null }> {
  const invoices = await listGoodsInvoicesWithoutParcel();
  if (invoices.length === 0) return { invoices: 0, sent: 0, error: null };
  const { sent, error } = await sendChatMessage('invoices_without_parcel', invoicesWithoutParcelMessage(invoices));
  return { invoices: invoices.length, sent, error };
}
