import { getTrackingSettings } from '../db/settings.js';
import {
  listLostParcelsToNotify,
  listParcels,
  markLossesNotified,
  markOverdueParcelsLost,
  markPartialNotified,
} from '../db/parcels.js';
import type { LostParcelToNotify, ParcelRecord } from '../db/parcels.js';
import { formatDate } from '../lib/dateFormat.js';
import { isPartialOverdue } from '../lib/parcelBoxes.js';

/**
 * Daily check (8 h, Madagascar): parcels not confirmed in time become "lost",
 * then every loss not announced yet is posted on Google Chat in one summary
 * (claims to the suppliers), with the incomplete parcels ("Reçu partiel":
 * fewer boxes than announced after the same delay). A parcel is announced
 * once; without webhook they stay to announce and only appear in the app's alerts.
 */

/** Messages are cut to stay under the Google Chat text limit. */
const MAX_LINES = 40;

const hubOf = (destination: string) => (destination === 'ORLY' ? 'Orly' : 'Rouen');

export function lostParcelsMessage(parcels: LostParcelToNotify[]): string {
  const lines = parcels.slice(0, MAX_LINES).map((p) => {
    const hub = hubOf(p.destination);
    return `- ${p.supplier_name || 'Fournisseur inconnu'} · ${p.tracking_number || 'sans n° de suivi'}${
      p.carrier_name ? ` (${p.carrier_name})` : ''
    } · facture(s) ${p.invoice_refs.join(', ') || '—'} · non reçu à ${hub}${
      p.expected_delivery ? `, prévu le ${formatDate(p.expected_delivery)}` : ''
    }`;
  });
  const more = parcels.length > MAX_LINES ? `\n… et ${parcels.length - MAX_LINES} autre(s) : voir le centre d'alertes.` : '';
  return `🚨 *Colis non reçus — ${parcels.length} à réclamer aux fournisseurs*\n${lines.join('\n')}${more}`;
}

export function partialParcelsMessage(parcels: ParcelRecord[]): string {
  const lines = parcels.slice(0, MAX_LINES).map((p) => {
    const expected = p.boxes_expected ?? 0;
    return `- ${p.supplier_name || 'Fournisseur inconnu'} · ${p.tracking_number || 'sans n° de suivi'}${
      p.carrier_name ? ` (${p.carrier_name})` : ''
    } · facture(s) ${p.invoices.map((i) => i.ref || '—').join(', ') || '—'} · ${p.boxes.length}/${expected} boîtes reçues à ${hubOf(
      p.destination
    )}, ${expected - p.boxes.length} manquante(s)`;
  });
  const more = parcels.length > MAX_LINES ? `\n… et ${parcels.length - MAX_LINES} autre(s) : voir le centre d'alertes.` : '';
  return `📦 *Colis incomplets — ${parcels.length} à vérifier*\n${lines.join('\n')}${more}`;
}

export async function runParcelLossCheck(): Promise<{
  marked_lost: number;
  announced: number;
  announced_partial: number;
  webhook: boolean;
}> {
  const settings = await getTrackingSettings();
  const markedLost = await markOverdueParcelsLost(settings);
  const toNotify = await listLostParcelsToNotify();
  const today = new Date().toISOString().slice(0, 10);
  const partial = (await listParcels()).filter((p) => !p.partial_notified_at && isPartialOverdue(p, settings, today));
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL || '';
  if ((toNotify.length === 0 && partial.length === 0) || !webhook) {
    return { marked_lost: markedLost, announced: 0, announced_partial: 0, webhook: Boolean(webhook) };
  }

  const sections = [
    ...(toNotify.length > 0 ? [lostParcelsMessage(toNotify)] : []),
    ...(partial.length > 0 ? [partialParcelsMessage(partial)] : []),
  ];
  const text = `${sections.join('\n\n')}\n👉 Détail et messages de réclamation dans Shipment Manager › Alertes.`;
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    // Not marked: announced again at the next run
    console.error('[Parcels] Google Chat summary rejected:', res.status, await res.text().catch(() => ''));
    return { marked_lost: markedLost, announced: 0, announced_partial: 0, webhook: true };
  }
  await markLossesNotified(toNotify.map((p) => p.id));
  await markPartialNotified(partial.map((p) => p.id));
  return { marked_lost: markedLost, announced: toNotify.length, announced_partial: partial.length, webhook: true };
}
