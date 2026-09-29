import type { CarrierCode } from '../../lib/carrierDetection.js';
import type { TrackingProvider } from './types.js';

/**
 * Registered tracking providers. Empty for now: each provider (La Poste for
 * Colissimo/Chronopost, UPS, DHL, FedEx, Amazon Business…) is added here once
 * its credentials exist and it has been tested against real numbers.
 *
 * Carriers without a configured provider are tracked manually.
 */
const PROVIDERS: TrackingProvider[] = [];

export function getConfiguredProviders(): TrackingProvider[] {
  return PROVIDERS.filter((p) => p.isConfigured());
}

export function getProviderForCarrier(carrier: CarrierCode): TrackingProvider | null {
  return getConfiguredProviders().find((p) => p.carriers.includes(carrier)) ?? null;
}

export function getAutomatedCarriers(): CarrierCode[] {
  return [...new Set(getConfiguredProviders().flatMap((p) => p.carriers))];
}
