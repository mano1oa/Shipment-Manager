import { parcelStage } from './parcelJourney.js';

/**
 * Weekly summary for the management (Google Chat, every Monday morning):
 * where the parcels stand, late and lost ones, value in transit and customs
 * blocks. Same counts as the dashboard. Pure: the data is read by the caller.
 */

export interface SummaryParcel {
  status: string;
  destination: string;
  expected_delivery: string | null;
  shipment_ids: string[];
}

export interface SummaryShipment {
  id: string;
  global_status: string;
  customs_status?: string | null;
}

export interface WeeklySummary {
  /** Expected from the suppliers (not received at the hub yet). */
  toHub: number;
  /** Of which past their expected delivery date. */
  late: number;
  atHubOrly: number;
  atHubRouen: number;
  /** Departed to Madagascar, customs blocks included (as on the dashboard). */
  toMada: number;
  /** Value of the shipments "Expédiée vers Mada" (EUR). */
  valueInTransit: number;
  lost: number;
  search: number;
  customsBlocked: number;
}

export function computeWeeklySummary(
  parcels: SummaryParcel[],
  shipments: SummaryShipment[],
  valueOfShipment: (s: SummaryShipment) => number,
  today: string
): WeeklySummary {
  const byId = new Map(shipments.map((s) => [s.id, s]));
  const summary: WeeklySummary = {
    toHub: 0,
    late: 0,
    atHubOrly: 0,
    atHubRouen: 0,
    toMada: 0,
    valueInTransit: 0,
    lost: 0,
    search: 0,
    customsBlocked: 0,
  };

  for (const p of parcels) {
    const own = p.shipment_ids.map((id) => byId.get(id)).filter((s): s is SummaryShipment => Boolean(s));
    const stage = parcelStage(p, own);
    if (stage === 'to_hub') {
      summary.toHub++;
      if (p.expected_delivery && p.expected_delivery < today) summary.late++;
    } else if (stage === 'at_hub') {
      if (p.destination === 'ROUEN') summary.atHubRouen++;
      else summary.atHubOrly++;
    } else if (stage === 'to_mada' || stage === 'customs') summary.toMada++;
    else if (stage === 'lost') summary.lost++;
    else if (stage === 'search') summary.search++;
  }

  for (const s of shipments) {
    if (s.global_status === 'Expédiée vers Mada') summary.valueInTransit += valueOfShipment(s);
    if (s.customs_status === 'Bloqué Douane' || s.global_status === 'Bloquée douane') summary.customsBlocked++;
  }
  summary.valueInTransit = Math.round(summary.valueInTransit);
  return summary;
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

const formatEuros = (amount: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);

/** "lundi 16 novembre", Madagascar time. */
export const summaryDateLabel = (date: Date) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Indian/Antananarivo' }).format(
    date
  );

export function weeklySummaryMessage(s: WeeklySummary, dateLabel: string): string {
  const lostLine =
    s.lost === 0 && s.search === 0
      ? 'Aucun colis perdu ni avis de recherche'
      : `${s.lost} ${plural(s.lost, 'perdu', 'perdus')}, ${s.search} avis de recherche`;
  const customsLine =
    s.customsBlocked === 0
      ? 'Aucune expédition bloquée en douane'
      : `${s.customsBlocked} ${plural(s.customsBlocked, 'expédition bloquée', 'expéditions bloquées')} en douane`;
  const lines = [
    `${s.toHub} colis ${plural(s.toHub, 'attendu', 'attendus')} des fournisseurs${s.late > 0 ? ` (dont ${s.late} en retard)` : ''}`,
    `${s.atHubOrly + s.atHubRouen} au hub (Orly ${s.atHubOrly} · Rouen ${s.atHubRouen})`,
    `${s.toMada} en route vers Madagascar${s.valueInTransit > 0 ? ` · valeur ${formatEuros(s.valueInTransit)}` : ''}`,
    lostLine,
    customsLine,
  ];
  return `*Point hebdo Shipment Manager — ${dateLabel}*\n${lines.map((l) => `• ${l}`).join('\n')}`;
}
