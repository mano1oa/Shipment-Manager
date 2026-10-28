/**
 * Parcel tracking model (supplier → Orly → Madagascar): shared statuses, rules
 * and labels. Runs in the browser and on the server (no Node or DOM dependency).
 *
 *   Invoice (DIGI or "hors DIGI")  ── 1..n PARCELS (one per tracking number)
 *                                       a parcel can cover several invoices
 *                                       of the same supplier
 *   Parcel confirmed by Antoine (photo optional) → "Reçu à Orly"
 *   Invoice received = all its parcels received
 *   SHIPMENT Orly → Mada = received invoices grouped + Réf FA DIGI-NXT
 */
import { detectTrackingNumber } from './carrierDetection.js';
import type { CarrierCode } from './carrierDetection.js';

// ---------------------------------------------------------------------------
// Shipment (Orly → Mada)
// ---------------------------------------------------------------------------

export const SHIPMENT_STATUSES = [
  'En préparation',
  'Expédiée vers Mada',
  'Bloquée douane',
  'Livrée entrepôt',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_HINTS: Record<ShipmentStatus, string> = {
  'En préparation': 'Créée, pas encore partie',
  'Expédiée vers Mada': 'Départ (samedi) saisi',
  'Bloquée douane': 'Retenue en douane',
  'Livrée entrepôt': 'Date de réception à Madagascar saisie',
};

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return (SHIPMENT_STATUSES as readonly string[]).includes(value as string);
}

const hasText = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/**
 * Status of a shipment saved before the parcel model (old "statut global").
 * `needsReview`: not departed yet — under the old model it was one supplier
 * parcel, so Supply Chain must regroup or delete it.
 */
export function convertLegacyShipmentStatus(s: {
  global_status?: string | null;
  orly_scan_date?: string | null;
  mada_receipt_date?: string | null;
}): { status: ShipmentStatus; needsReview: boolean } {
  const old = (s.global_status || '').trim();
  if (isShipmentStatus(old)) return { status: old, needsReview: false };
  if (hasText(s.mada_receipt_date) || old === 'Livré entrepôt' || old === 'Livré Client/Entrepôt') {
    return { status: 'Livrée entrepôt', needsReview: false };
  }
  if (old.toLowerCase() === 'bloqué douane') return { status: 'Bloquée douane', needsReview: false };
  if (old === 'Reçu et expédié' || hasText(s.orly_scan_date)) {
    return { status: 'Expédiée vers Mada', needsReview: false };
  }
  // Attente confirmation transitaire, En livraison vers Orly, Livré Orly,
  // Perdu Orly, Statut non défini, empty
  return { status: 'En préparation', needsReview: true };
}

/** "Livrée entrepôt" as soon as the Madagascar receipt date is entered. */
export function applyAutomaticShipmentStatus<T extends { global_status?: string; mada_receipt_date?: string }>(
  s: T
): T {
  if (hasText(s.mada_receipt_date) && s.global_status !== 'Livrée entrepôt') {
    return { ...s, global_status: 'Livrée entrepôt' };
  }
  return s;
}

// ---------------------------------------------------------------------------
// Parcel (supplier → Orly)
// ---------------------------------------------------------------------------

export const PARCEL_STATUSES = ['to_receive', 'received', 'lost', 'search'] as const;
export type ParcelStatus = (typeof PARCEL_STATUSES)[number];

export const PARCEL_STATUS_LABELS: Record<ParcelStatus, string> = {
  to_receive: 'À recevoir',
  received: 'Reçu à Orly',
  lost: 'Perdu avant Orly',
  search: 'Avis de recherche',
};

export const PARCEL_STATUS_HINTS: Record<ParcelStatus, string> = {
  to_receive: 'Attendu chez Antoine',
  received: 'Confirmé par Antoine (photo facultative)',
  lost: 'Pas de confirmation à temps : réclamation fournisseur',
  search: 'Reçu à Orly mais absent à l’arrivée à Madagascar : réclamation MIDEX',
};

export function isParcelStatus(value: unknown): value is ParcelStatus {
  return (PARCEL_STATUSES as readonly string[]).includes(value as string);
}

export interface ParcelInput {
  /** Null when not known yet (parcel created at reception in Orly). */
  tracking_number: string | null;
  /** Tracking connector: detected from the number, or the one linked to the carrier picked. */
  carrier: CarrierCode;
  /** Carrier of the Settings list (Paramètres › Transporteurs); null = from the number format. */
  carrier_name: string | null;
  expected_delivery: string | null; // YYYY-MM-DD
  notes: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a parcel payload. The tracking number is normalised and its
 * connector detected from its format (the server resolves the carrier name).
 */
export function validateParcelInput(raw: any): { value: ParcelInput | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { value: null, errors: ['Colis invalide.'] };

  let trackingNumber: string | null = null;
  let carrier: CarrierCode = 'UNKNOWN';
  if (typeof raw.tracking_number === 'string' && raw.tracking_number.trim()) {
    const detected = detectTrackingNumber(raw.tracking_number);
    if (!detected.number) errors.push('N° de suivi invalide.');
    else if (detected.number.length > 100) errors.push('N° de suivi : 100 caractères maximum.');
    trackingNumber = detected.number || null;
    carrier = detected.carrier;
  }
  let carrierName: string | null = null;
  if (raw.carrier_name !== undefined && raw.carrier_name !== null && raw.carrier_name !== '') {
    if (typeof raw.carrier_name === 'string' && raw.carrier_name.trim().length <= 100) carrierName = raw.carrier_name.trim();
    else errors.push('Transporteur invalide.');
  }

  let expected: string | null = null;
  if (raw.expected_delivery) {
    if (typeof raw.expected_delivery === 'string' && ISO_DATE.test(raw.expected_delivery)) expected = raw.expected_delivery;
    else errors.push('Date de livraison prévue invalide.');
  }

  const notes = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 2000) : null;
  return {
    value:
      errors.length === 0
        ? { tracking_number: trackingNumber, carrier, carrier_name: carrierName, expected_delivery: expected, notes }
        : null,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** DIGI invoices are sorted by hand; "hors DIGI" invoices are goods. */
export const INVOICE_TRIAGES = ['to_sort', 'goods', 'services'] as const;
export type InvoiceTriage = (typeof INVOICE_TRIAGES)[number];

export const INVOICE_TRIAGE_LABELS: Record<InvoiceTriage, string> = {
  to_sort: 'À trier',
  goods: 'Marchandises',
  services: 'Services',
};

/** "Hors DIGI" invoices entered by Sourcing wait for Supply Chain validation. */
export const VALIDATION_STATUSES = ['pending', 'validated', 'rejected'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const VALIDATION_STATUS_LABELS: Record<ValidationStatus, string> = {
  pending: 'À valider',
  validated: 'Validée',
  rejected: 'Refusée',
};

export const CURRENCIES = ['EUR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

// ---------------------------------------------------------------------------
// Settings (Paramètres › Intégrations)
// ---------------------------------------------------------------------------

export interface TrackingSettings {
  /** EUR for 1 USD. Null until Supply Chain sets it: USD amounts are then left out of values. */
  usd_eur_rate: number | null;
  /** An invoice not sorted after N days is flagged. */
  triage_alert_days: number;
  /** A parcel not confirmed N days after its expected delivery is flagged as lost. */
  parcel_loss_days_after_eta: number;
  /** Without expected delivery: N days after the invoice date. */
  parcel_loss_days_without_eta: number;
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
  usd_eur_rate: null,
  triage_alert_days: 3,
  parcel_loss_days_after_eta: 7,
  parcel_loss_days_without_eta: 14,
};

export const SETTING_LIMITS: Record<Exclude<keyof TrackingSettings, 'usd_eur_rate'>, [number, number]> = {
  triage_alert_days: [1, 60],
  parcel_loss_days_after_eta: [1, 90],
  parcel_loss_days_without_eta: [1, 180],
};

/** Amount in EUR, or null when it cannot be converted (no rate yet). */
export function amountInEur(amount: number | null, currency: Currency | null, usdEurRate: number | null): number | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  if (!currency || currency === 'EUR') return amount;
  if (usdEurRate === null || !(usdEurRate > 0)) return null;
  return Math.round(amount * usdEurRate * 100) / 100;
}

// ---------------------------------------------------------------------------
// Deadlines (dates as YYYY-MM-DD)
// ---------------------------------------------------------------------------

function addDays(date: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Date after which a parcel not confirmed at Orly is considered lost:
 * expected delivery + 7 days, else invoice date + 14 days (settings).
 * Null when neither date is known.
 */
export function parcelLossDeadline(
  expectedDelivery: string | null | undefined,
  invoiceDate: string | null | undefined,
  settings: TrackingSettings = DEFAULT_TRACKING_SETTINGS
): string | null {
  if (expectedDelivery) return addDays(expectedDelivery, settings.parcel_loss_days_after_eta);
  if (invoiceDate) return addDays(invoiceDate, settings.parcel_loss_days_without_eta);
  return null;
}

export function isParcelOverdue(
  parcel: { status: ParcelStatus; expected_delivery: string | null },
  invoiceDate: string | null | undefined,
  today: string,
  settings: TrackingSettings = DEFAULT_TRACKING_SETTINGS
): boolean {
  if (parcel.status !== 'to_receive') return false;
  const deadline = parcelLossDeadline(parcel.expected_delivery, invoiceDate, settings);
  return deadline !== null && today > deadline;
}

/** Date after which an unsorted invoice is flagged. */
export function triageDeadline(createdAt: string, settings: TrackingSettings = DEFAULT_TRACKING_SETTINGS): string | null {
  return addDays(createdAt.slice(0, 10), settings.triage_alert_days);
}
