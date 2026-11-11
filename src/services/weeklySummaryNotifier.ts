import { listParcels } from '../db/parcels.js';
import { getShipmentsFromNeon } from '../db/shipments.js';
import { getInvoiceTotalsByShipment, listDigiInvoices } from '../db/digiInvoices.js';
import { getTrackingSettings } from '../db/settings.js';
import { buildDigiValueLookup } from '../lib/digiShipmentValue.js';
import { computeWeeklySummary, summaryDateLabel, weeklySummaryMessage } from '../lib/weeklySummary.js';
import type { WeeklySummary } from '../lib/weeklySummary.js';
import { sendChatMessage } from './googleChat.js';

/**
 * Weekly summary for the management, every Monday morning (webhooks
 * "Point hebdo direction"). Always sent, even when everything is at zero.
 */

/** Reads the data and builds the message, without sending it. */
export async function buildWeeklySummary(now = new Date()): Promise<{ summary: WeeklySummary; text: string }> {
  const [parcels, shipments, digiInvoices, settings] = await Promise.all([
    listParcels(),
    getShipmentsFromNeon(),
    listDigiInvoices(),
    getTrackingSettings(),
  ]);
  const totals = await getInvoiceTotalsByShipment(settings.usd_eur_rate);

  // Shipment value as on the dashboard: linked invoices, else the DIGI invoice
  // found by reference, else the cost entered on the shipment.
  const byReference = buildDigiValueLookup(digiInvoices);
  const byId = new Map(shipments.map((s) => [s.id, s]));
  const valueOf = (summaryShipment: { id: string }) => {
    const s = byId.get(summaryShipment.id);
    if (!s) return 0;
    const linked = totals.get(s.id)?.total;
    if (linked !== null && linked !== undefined) return linked;
    return byReference(s)?.amount ?? (Number(s.cost_eur) || 0);
  };

  const today = now.toISOString().slice(0, 10);
  const summary = computeWeeklySummary(parcels, shipments, valueOf, today);
  return { summary, text: weeklySummaryMessage(summary, summaryDateLabel(now)) };
}

export async function runWeeklySummary(): Promise<{ sent: number; error: string | null; summary: WeeklySummary }> {
  const { summary, text } = await buildWeeklySummary();
  const { sent, error } = await sendChatMessage('weekly_summary', text);
  return { sent, error, summary };
}
