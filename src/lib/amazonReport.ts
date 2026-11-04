/**
 * Amazon shipment report ("Rapport d'expéditions" of Amazon Business): one row
 * per order and package, with the order number and the carrier tracking
 * number. Its parcels are matched to the invoices by their Amazon order
 * (Commande Amazon), so one invoice can get several parcels. When the report
 * gives the Amazon invoice number (one order can have several invoices, one
 * per seller), it matches the invoice reference first.
 *
 * Shared by the server and the browser (pure TypeScript, no dependencies).
 */

export interface AmazonReportColumns {
  order: number;
  tracking: number;
  /** Amazon invoice number (FR6E9DUABEY…); -1 when absent. */
  invoice: number;
  /** -1 when absent. */
  carrier: number;
  /** -1 when absent. */
  expected: number;
}

export interface AmazonReportRow {
  /** Line of the file (1 = first line). */
  line: number;
  order_ref: string;
  /** Amazon invoice number of the row, when the report has it. */
  invoice_ref: string | null;
  tracking_number: string;
  /** Carrier written in the report (e.g. "AMZN_FR", "Chronopost"). */
  carrier_text: string | null;
  /** YYYY-MM-DD */
  expected_delivery: string | null;
}

export interface AmazonReportParse {
  headerLine: number;
  headers: string[];
  columns: AmazonReportColumns;
  rows: AmazonReportRow[];
  skipped: { line: number; reason: string }[];
}

export type AmazonImportOutcome =
  /** New parcel for the invoice(s) of the order. */
  | 'created'
  /** A parcel of the invoice announced without number gets it. */
  | 'completed'
  /** The number belongs to a parcel: the invoice is added to it. */
  | 'linked'
  /** Already done (number known on these invoices). */
  | 'already'
  | 'unknown_order'
  | 'services'
  | 'invalid_tracking';

export const AMAZON_OUTCOME_LABELS: Record<AmazonImportOutcome, string> = {
  created: 'Colis créé',
  completed: 'N° ajouté au colis annoncé',
  linked: 'Facture ajoutée au colis existant',
  already: 'Déjà rattaché',
  unknown_order: 'Commande sans facture',
  services: 'Facture en services',
  invalid_tracking: 'N° de suivi invalide',
};

export interface AmazonImportLine {
  line: number;
  order_ref: string;
  tracking_number: string;
  outcome: AmazonImportOutcome;
  invoice_refs: string[];
}

export const AMAZON_IMPORT_MAX_ROWS = 2000;

/** Letters and digits only, uppercase: the matching key of order numbers. */
export const orderKey = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const ORDER_HEADER = /(commande|order)/;
const ORDER_ID_HINT = /(n°|no\b|num|id|number|#|ref)/;
const TRACKING_HEADER = /(suivi|tracking)/;
const CARRIER_HEADER = /(transporteur|carrier)/;
const EXPECTED_HEADER = /(livraison|delivery|arrivee)/;

/** Columns guessed from the headers of the report. */
export function guessColumns(headers: string[]): AmazonReportColumns {
  const h = headers.map((x) => norm(x));
  const find = (test: (s: string, i: number) => boolean) => h.findIndex(test);
  let order = find((s) => ORDER_HEADER.test(s) && ORDER_ID_HINT.test(s) && !/date|statut|status|quantit|montant|total/.test(s));
  if (order < 0) order = find((s) => ORDER_HEADER.test(s) && !/date|statut|status/.test(s));
  const tracking = find((s) => TRACKING_HEADER.test(s) && !/statut|status|date|url|lien/.test(s));
  const invoice = find((s) => /(facture|invoice)/.test(s) && ORDER_ID_HINT.test(s) && !/date|montant|total|adresse|address|statut|status/.test(s));
  const carrier = find((s, i) => i !== tracking && CARRIER_HEADER.test(s));
  const expected = find((s) => EXPECTED_HEADER.test(s) && /(prev|estim|expected|attendu|date)/.test(s) && !/adresse|address/.test(s));
  return { order, tracking, invoice, carrier, expected };
}

/** "04/11/2026", "2026-11-04", Excel date → "2026-11-04". */
export function parseReportDate(v: unknown): string | null {
  const text = cellText(v);
  if (!text) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Tracking numbers of a cell: "AMZN_FR(FR012345678)", "Chronopost: XY1, XY2"…
 * A package can be split: one row may hold several numbers.
 */
export function splitTrackingCell(text: string): { numbers: string[]; carrier: string | null } {
  if (!text.trim()) return { numbers: [], carrier: null };
  const inParens = Array.from(text.matchAll(/\(([^)]*)\)/g)).map((m) => m[1]);
  const outside = text.replace(/\([^)]*\)/g, ' ').trim();
  const source = inParens.length > 0 ? inParens.join(',') : text;
  const numbers = source
    .split(/[,;|\n/]+/)
    .map((t) => t.replace(/^[^:]*:\s*/, '').trim())
    .flatMap((t) => t.split(/\s{2,}/))
    .map((t) => t.trim())
    .filter((t) => /\d/.test(t) && t.replace(/[^A-Za-z0-9]/g, '').length >= 6);
  const carrier =
    inParens.length > 0 && outside ? outside.replace(/[,;:]+$/, '').trim() || null : /^([^:]+):/.exec(text)?.[1].trim() || null;
  return { numbers: Array.from(new Set(numbers)), carrier };
}

/** Header line: the first one with an order and a tracking column. */
export function findHeaderLine(sheet: unknown[][]): number {
  for (let i = 0; i < Math.min(sheet.length, 20); i++) {
    const c = guessColumns((sheet[i] || []).map(cellText));
    if (c.order >= 0 && c.tracking >= 0) return i;
  }
  return 0;
}

export function parseAmazonReport(sheet: unknown[][], forced?: Partial<AmazonReportColumns>): AmazonReportParse {
  const headerLine = findHeaderLine(sheet);
  const headers = (sheet[headerLine] || []).map(cellText);
  const columns = { ...guessColumns(headers), ...forced };
  const rows: AmazonReportRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  if (columns.order < 0 || columns.tracking < 0) return { headerLine, headers, columns, rows, skipped };

  for (let i = headerLine + 1; i < sheet.length; i++) {
    const r = sheet[i] || [];
    if (r.every((v) => !cellText(v))) continue;
    const line = i + 1;
    const order = cellText(r[columns.order]);
    if (!order) {
      skipped.push({ line, reason: 'sans n° de commande' });
      continue;
    }
    const { numbers, carrier } = splitTrackingCell(cellText(r[columns.tracking]));
    if (numbers.length === 0) {
      skipped.push({ line, reason: 'sans n° de suivi (pas encore expédié ?)' });
      continue;
    }
    const carrierText = (columns.carrier >= 0 ? cellText(r[columns.carrier]) : '') || carrier;
    const expected = columns.expected >= 0 ? parseReportDate(r[columns.expected]) : null;
    const invoiceRef = (columns.invoice >= 0 ? cellText(r[columns.invoice]) : '') || null;
    for (const n of numbers) {
      rows.push({ line, order_ref: order, invoice_ref: invoiceRef, tracking_number: n, carrier_text: carrierText || null, expected_delivery: expected });
    }
  }
  return { headerLine, headers, columns, rows, skipped };
}
