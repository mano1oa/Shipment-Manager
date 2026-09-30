import {
  TrackingNumberRecord,
  listNumbersDueForSync,
  listNumbersForShipment,
  markSyncAttempt,
  recordTrackingEvents,
} from '../../db/tracking.js';
import { getAutomatedCarriers, getProviderForCarrier } from './registry.js';

/**
 * Tracking synchronization.
 *
 * Production rule: only real provider data is persisted. On any failure the
 * error is recorded on the tracking number and its existing status/events are
 * left unchanged. Numbers whose carrier has no configured provider are skipped
 * (manual tracking).
 */

export type SyncOutcome = 'UPDATED' | 'UNCHANGED' | 'NOT_FOUND' | 'FAILED' | 'NO_PROVIDER' | 'SKIPPED';

export interface SyncItemResult {
  tracking_number_id: string;
  tracking_number: string;
  carrier: string;
  outcome: SyncOutcome;
  new_events: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const lastCallAt = new Map<string, number>();

async function syncOne(n: TrackingNumberRecord): Promise<SyncItemResult> {
  const base = {
    tracking_number_id: n.id,
    tracking_number: n.tracking_number,
    carrier: n.carrier,
  };

  if (!n.is_active) return { ...base, outcome: 'SKIPPED', new_events: 0 };

  const provider = getProviderForCarrier(n.carrier);
  if (!provider) return { ...base, outcome: 'NO_PROVIDER', new_events: 0 };

  // Respect the provider's minimum interval between calls
  if (provider.minIntervalMs) {
    const wait = (lastCallAt.get(provider.code) ?? 0) + provider.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
  }
  lastCallAt.set(provider.code, Date.now());

  try {
    const result = await provider.fetch(n.tracking_number, n.carrier);

    if (!result.found) {
      await markSyncAttempt(n.id, 'Numéro inconnu du transporteur (aucune donnée)');
      return { ...base, outcome: 'NOT_FOUND', new_events: 0 };
    }

    const inserted = await recordTrackingEvents(
      n.id,
      result.events.map((ev) => ({
        eventAt: ev.eventAt,
        status: ev.status,
        description: ev.description,
        location: ev.location ?? null,
        source: 'carrier_api' as const,
        rawPayload: ev.raw,
      }))
    );
    await markSyncAttempt(n.id, null);
    return { ...base, outcome: inserted > 0 ? 'UPDATED' : 'UNCHANGED', new_events: inserted };
  } catch (err: any) {
    // Internal detail stays server-side; the stored error is short and generic.
    console.error(`[Tracking] ${provider.code} failed for ${n.tracking_number}:`, err);
    await markSyncAttempt(n.id, `Échec ${provider.code} : ${String(err?.message || err).slice(0, 200)}`);
    return { ...base, outcome: 'FAILED', new_events: 0, error: 'Provider error' };
  }
}

export async function syncShipmentTracking(shipmentId: string): Promise<SyncItemResult[]> {
  const numbers = await listNumbersForShipment(shipmentId);
  const results: SyncItemResult[] = [];
  for (const n of numbers) {
    if (n.status === 'DELIVERED') {
      results.push({
        tracking_number_id: n.id,
        tracking_number: n.tracking_number,
        carrier: n.carrier,
        outcome: 'SKIPPED',
        new_events: 0,
      });
      continue;
    }
    results.push(await syncOne(n));
  }
  return results;
}

/**
 * Batch refresh (daily cron / manual "sync all"). Stops before `timeBudgetMs`
 * so the serverless function never hits its maximum duration mid-write.
 */
export async function syncDueTracking(options: {
  limit: number;
  timeBudgetMs: number;
}): Promise<{
  automated_carriers: string[];
  processed: number;
  updated: number;
  failed: number;
  not_found: number;
  stopped_early: boolean;
}> {
  const started = Date.now();
  const carriers = getAutomatedCarriers();
  const due = await listNumbersDueForSync(carriers, options.limit);

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let notFound = 0;
  let stoppedEarly = false;

  for (const n of due) {
    if (Date.now() - started > options.timeBudgetMs) {
      stoppedEarly = true;
      break;
    }
    const r = await syncOne(n);
    processed++;
    if (r.outcome === 'UPDATED') updated++;
    if (r.outcome === 'FAILED') failed++;
    if (r.outcome === 'NOT_FOUND') notFound++;
  }

  return {
    automated_carriers: carriers,
    processed,
    updated,
    failed,
    not_found: notFound,
    stopped_early: stoppedEarly,
  };
}
