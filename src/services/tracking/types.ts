import type { CarrierCode } from '../../lib/carrierDetection.js';
import type { TrackingStatus } from '../../db/tracking.js';

/**
 * A tracking provider fetches REAL events for a carrier tracking number.
 *
 * Contract:
 * - Return only data actually received from the carrier/provider.
 * - Throw on any failure (missing credentials, HTTP error, unexpected payload).
 * - Return `found: false` when the provider does not know the number.
 * Never fabricate or simulate events.
 */
export interface ProviderEvent {
  eventAt: string; // ISO date/time
  status: TrackingStatus;
  description: string;
  location?: string | null;
  raw?: unknown;
}

export interface ProviderResult {
  found: boolean;
  events: ProviderEvent[];
}

export interface TrackingProvider {
  /** Stable identifier, e.g. 'laposte', 'ups'. */
  code: string;
  /** Carriers this provider can track. */
  carriers: CarrierCode[];
  /** True when the provider's credentials are present in the environment. */
  isConfigured(): boolean;
  /** Minimum delay between two calls, in ms (provider rate limits). */
  minIntervalMs?: number;
  fetch(trackingNumber: string, carrier: CarrierCode): Promise<ProviderResult>;
}
