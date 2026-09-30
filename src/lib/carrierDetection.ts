/**
 * Tracking number normalization and carrier detection.
 *
 * Rules calibrated on the historical RECEP_IMPORT tracking file (supplier →
 * Orly deliveries). Detection is a SUGGESTION: the user can always override
 * the carrier. Unknown formats return 'UNKNOWN' — never a guessed carrier.
 *
 * Shared by the server and the browser (pure TypeScript, no dependencies).
 */

export const CARRIER_CODES = [
  'AMAZON',
  'COLISSIMO',
  'CHRONOPOST',
  'LA_POSTE',
  'UPS',
  'DHL',
  'FEDEX',
  'DPD',
  'GLS',
  'TNT',
  'SCHENKER',
  'RABEN',
  'CIBLEX',
  'POSTAL_INTL',
  'OTHER',
  'UNKNOWN',
] as const;

export type CarrierCode = (typeof CARRIER_CODES)[number];

export const CARRIER_LABELS: Record<CarrierCode, string> = {
  AMAZON: 'Amazon Logistics',
  COLISSIMO: 'Colissimo',
  CHRONOPOST: 'Chronopost',
  LA_POSTE: 'La Poste',
  UPS: 'UPS',
  DHL: 'DHL',
  FEDEX: 'FedEx',
  DPD: 'DPD',
  GLS: 'GLS',
  TNT: 'TNT',
  SCHENKER: 'DB Schenker',
  RABEN: 'Raben',
  CIBLEX: 'Ciblex',
  POSTAL_INTL: 'Poste étrangère',
  OTHER: 'Autre transporteur',
  UNKNOWN: 'Non identifié',
};

export type TrackingWarning =
  | 'LOOKS_LIKE_DELIVERY_NOTE' // "BL ..." = supplier delivery note, not a carrier number
  | 'LOOKS_TRUNCATED_BY_EXCEL' // e.g. 90000000000: digits lost by Excel number formatting
  | 'NOT_A_TRACKING_NUMBER'; // e.g. "Enlèvement MIDEX"

export interface DetectedTrackingNumber {
  raw: string;
  number: string; // normalized: uppercase, no spaces, carrier prefix removed
  carrier: CarrierCode;
  warnings: TrackingWarning[];
}

// Carrier names sometimes typed in front of the number ("UPS 1Z...", "LA POSTE 6A...")
const PREFIXES: Array<[RegExp, CarrierCode]> = [
  [/^LA\s*POSTE\b/, 'LA_POSTE'],
  [/^COLISSIMO\b/, 'COLISSIMO'],
  [/^CHRONOPOST\b|^CHRONO\b/, 'CHRONOPOST'],
  [/^UPS\b/, 'UPS'],
  [/^DHL\b/, 'DHL'],
  [/^FEDEX\b/, 'FEDEX'],
  [/^DPD\b/, 'DPD'],
  [/^GLS\b/, 'GLS'],
  [/^TNT\b/, 'TNT'],
  [/^SCHENKER\b|^DB\s*SCHENKER\b/, 'SCHENKER'],
  [/^RABEN\b/, 'RABEN'],
  [/^CIBLEX\b/, 'CIBLEX'],
  [/^AMAZON\b/, 'AMAZON'],
];

function detectFromFormat(n: string): CarrierCode {
  if (/^FR\d{10}$/.test(n) || /^TBA\d{12}$/.test(n)) return 'AMAZON';
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'UPS';
  if (/^X[A-Z]\d{9}FR$/.test(n)) return 'CHRONOPOST';
  if (/^\d[A-Z]\d{11}$/.test(n)) return 'COLISSIMO'; // 6A…, 6G…, 8R…
  if (/^[A-Z]{2}\d{9}FR$/.test(n)) return 'LA_POSTE'; // UPU S10, French post
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) return 'POSTAL_INTL'; // UPU S10, other posts
  if (/^JJD\d{18}$/.test(n) || /^JVGL\d+$/.test(n)) return 'DHL';
  if (/^FRMSY\d{6,}$/.test(n)) return 'SCHENKER';
  // Pure digit formats (10, 12, 14 digits…) are ambiguous in the source data
  // (DHL Express, FedEx, DPD, but also supplier references): not guessed.
  return 'UNKNOWN';
}

/**
 * Normalizes one tracking number and suggests a carrier.
 */
export function detectTrackingNumber(input: string): DetectedTrackingNumber {
  const raw = String(input ?? '').trim();
  let s = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  const warnings: TrackingWarning[] = [];

  if (/\bENL[EÈ]VEMENT\b|\bMIDEX\b/.test(s)) {
    return { raw, number: '', carrier: 'UNKNOWN', warnings: ['NOT_A_TRACKING_NUMBER'] };
  }

  let carrier: CarrierCode | null = null;

  if (/^BL\b|^BL°|^BL N°|^B\.L\./.test(s)) {
    warnings.push('LOOKS_LIKE_DELIVERY_NOTE');
    s = s.replace(/^B\.?L\.?\s*(N°|°)?\s*/, '');
  }

  for (const [re, code] of PREFIXES) {
    if (re.test(s)) {
      carrier = code;
      s = s.replace(re, '');
      break;
    }
  }

  const number = s.replace(/[\s\-.:]/g, '');

  if (/^\d{11,}$/.test(number) && /0{6,}$/.test(number)) {
    warnings.push('LOOKS_TRUNCATED_BY_EXCEL');
  }

  const fromFormat = detectFromFormat(number);
  const finalCarrier: CarrierCode =
    carrier && !(carrier === 'LA_POSTE' && fromFormat === 'COLISSIMO') ? carrier : fromFormat;

  return { raw, number, carrier: finalCarrier, warnings };
}

/**
 * Splits a free-text cell that may contain several numbers
 * ("2 parmi : FR284… FR284…", comma/newline separated).
 */
export function splitTrackingInput(text: string): string[] {
  const value = String(text ?? '').trim();
  if (!value) return [];

  const parts = value
    .split(/[\n,;/]+|\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const result: string[] = [];
  for (const part of parts) {
    // "UC25LG0026771 UC25LG0026772": several bare numbers on one line
    const tokens = part.split(' ');
    const looksLikeList =
      tokens.length > 1 &&
      tokens.every((t) => /^[0-9A-Z]{8,}$/i.test(t)) &&
      !PREFIXES.some(([re]) => re.test(part.toUpperCase()));
    if (looksLikeList) {
      result.push(...tokens);
    } else if (!/^\d+\s*parmi\s*:?$/i.test(part)) {
      result.push(part);
    }
  }
  return result;
}

export const WARNING_LABELS: Record<TrackingWarning, string> = {
  LOOKS_LIKE_DELIVERY_NOTE:
    'Ressemble à un n° de bon de livraison fournisseur, pas à un n° de suivi transporteur.',
  LOOKS_TRUNCATED_BY_EXCEL:
    'Numéro probablement tronqué par Excel (derniers chiffres remplacés par des zéros).',
  NOT_A_TRACKING_NUMBER: 'Ce n’est pas un numéro de suivi.',
};
