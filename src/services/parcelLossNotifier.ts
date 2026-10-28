import { getTrackingSettings } from '../db/settings.js';
import { listLostParcelsToNotify, markLossesNotified, markOverdueParcelsLost } from '../db/parcels.js';
import type { LostParcelToNotify } from '../db/parcels.js';
import { formatDate } from '../lib/dateFormat.js';

/**
 * Daily check (8 h, Madagascar): parcels not confirmed in time become "lost",
 * then every loss not announced yet is posted on Google Chat in one summary
 * (claims to the suppliers). A parcel is announced once; without webhook the
 * losses stay to announce and only appear in the app's alerts.
 */

/** Messages are cut to stay under the Google Chat text limit. */
const MAX_LINES = 40;

export function lostParcelsMessage(parcels: LostParcelToNotify[]): string {
  const lines = parcels.slice(0, MAX_LINES).map((p) => {
    const hub = p.destination === 'ORLY' ? 'Orly' : 'Rouen';
    return `- ${p.supplier_name || 'Fournisseur inconnu'} · ${p.tracking_number || 'sans n° de suivi'}${
      p.carrier_name ? ` (${p.carrier_name})` : ''
    } · facture(s) ${p.invoice_refs.join(', ') || '—'} · non reçu à ${hub}${
      p.expected_delivery ? `, prévu le ${formatDate(p.expected_delivery)}` : ''
    }`;
  });
  const more = parcels.length > MAX_LINES ? `\n… et ${parcels.length - MAX_LINES} autre(s) : voir le centre d'alertes.` : '';
  return `🚨 *Colis non reçus — ${parcels.length} à réclamer aux fournisseurs*\n${lines.join('\n')}${more}\n👉 Détail et messages de réclamation dans Shipment Manager › Alertes.`;
}

export async function runParcelLossCheck(): Promise<{ marked_lost: number; announced: number; webhook: boolean }> {
  const settings = await getTrackingSettings();
  const markedLost = await markOverdueParcelsLost(settings);
  const toNotify = await listLostParcelsToNotify();
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL || '';
  if (toNotify.length === 0 || !webhook) {
    return { marked_lost: markedLost, announced: 0, webhook: Boolean(webhook) };
  }

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text: lostParcelsMessage(toNotify) }),
  });
  if (!res.ok) {
    // Not marked: announced again at the next run
    console.error('[Parcels] Google Chat summary rejected:', res.status, await res.text().catch(() => ''));
    return { marked_lost: markedLost, announced: 0, webhook: true };
  }
  await markLossesNotified(toNotify.map((p) => p.id));
  return { marked_lost: markedLost, announced: toNotify.length, webhook: true };
}
