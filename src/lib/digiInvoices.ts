/**
 * DIGI LOGISTIC invoices addressed to NextHope: shared types, validation and
 * Excel parsing. Runs in the browser (Excel preview) and on the server (API
 * validation), so it has no Node or DOM dependency.
 *
 * Fields (Odoo account.move on DIGI LOGISTIC):
 *   partner_id → supplier_name        ref → ref
 *   dest_partner_id → dest_partner_name   invoice_date → invoice_date
 *   num_cmd_amz → amazon_order_ref     sale_move_id → sale_move_ref
 *   lines: name, quantity, price_unit, price_subtotal
 */

export interface DigiInvoiceLineInput {
  name: string;
  quantity: number | null;
  price_unit: number | null;
  price_subtotal: number | null;
  odoo_line_id?: number | null;
  /** Fee line (DEEE, RCP, FRDP…): not an item to ship. */
  is_service?: boolean;
}

export interface DigiInvoiceInput {
  supplier_name: string;
  dest_partner_name: string | null;
  ref: string;
  invoice_date: string | null; // YYYY-MM-DD
  amazon_order_ref: string | null;
  sale_move_ref: string | null;
  lines: DigiInvoiceLineInput[];
}

export const DIGI_TEXT_MAX_LENGTH = 255;
export const DIGI_LINE_NAME_MAX_LENGTH = 2000;
export const DIGI_MAX_LINES_PER_INVOICE = 500;
export const DIGI_IMPORT_MAX_INVOICES = 2000;

// ---------------------------------------------------------------------------
// Service (fee) lines
// ---------------------------------------------------------------------------

/**
 * Odoo product codes of fee lines (eco-participation DEEE, RCP, shipping
 * costs FRDP). They are not items to track: they are merged into a single
 * "[SERVICES]" line so that the invoice total still equals the Odoo total.
 * SERVICES is the code of the merged line itself (merging is idempotent).
 */
export const SERVICE_PRODUCT_CODES = ['DEEE', 'RCP', 'FRDP'] as const;
const MERGED_SERVICE_CODE = 'SERVICES';
const SERVICE_CODE_RE = new RegExp(`^\\s*\\[(${[...SERVICE_PRODUCT_CODES, MERGED_SERVICE_CODE].join('|')})\\]`, 'i');

/** True when a label starts with a fee product code, e.g. "[FRDP] Frais de port". */
export function isServiceLabel(name: string | null | undefined): boolean {
  return Boolean(name) && SERVICE_CODE_RE.test(name as string);
}

function lineAmount(line: DigiInvoiceLineInput): number | null {
  if (line.price_subtotal !== null) return line.price_subtotal;
  if (line.quantity !== null && line.price_unit !== null) return line.quantity * line.price_unit;
  return null;
}

/**
 * Keeps item lines as they are and replaces all fee lines with one
 * "[SERVICES] …" line (quantity 1, price = sum of the fee lines).
 */
export function mergeServiceLines(lines: DigiInvoiceLineInput[]): DigiInvoiceLineInput[] {
  const services = lines.filter((l) => l.is_service || isServiceLabel(l.name));
  if (services.length === 0) return lines;

  const items = lines.filter((l) => !services.includes(l));
  const amounts = services.map(lineAmount);
  const total = amounts.some((a) => a !== null)
    ? Math.round(amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0) * 100) / 100
    : null;

  const codes = new Set<string>();
  for (const line of services) {
    const code = /^\s*\[([^\]]+)\]/.exec(line.name)?.[1]?.toUpperCase();
    if (code && code !== MERGED_SERVICE_CODE) codes.add(code);
    // Already merged line: keep the codes listed in its label
    if (code === MERGED_SERVICE_CODE) {
      for (const known of SERVICE_PRODUCT_CODES) if (line.name.toUpperCase().includes(known)) codes.add(known);
    }
  }

  return [
    ...items,
    {
      name: `[${MERGED_SERVICE_CODE}] ${codes.size ? [...codes].join(', ') : 'Frais'} — services, non expédiés`,
      quantity: 1,
      price_unit: total,
      price_subtotal: total,
      is_service: true,
    },
  ];
}

/** Default destination entity on DIGI LOGISTIC. */
export const DEFAULT_DEST_PARTNER_NAME = 'NextHope';

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Accepts a Date, an Excel serial number, "YYYY-MM-DD[...]" or "DD/MM/YYYY"
 * (also "-" or "." separators). Returns "YYYY-MM-DD", null when empty, or
 * undefined when the value cannot be read as a date.
 */
export function parseDateValue(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }

  if (typeof value === 'number') {
    // Excel serial date (days since 1899-12-30)
    if (!Number.isFinite(value) || value < 1 || value > 120000) return undefined;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return parseDateValue(date);
  }

  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return null;

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isValidYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : undefined;
  }

  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(text);
  if (match) {
    const d = Number(match[1]);
    const m = Number(match[2]);
    const y = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return isValidYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : undefined;
  }

  return undefined;
}

/**
 * Accepts numbers and French or English formatted strings ("1 234,56",
 * "1,234.56", "12,50 €"). Returns null when empty, undefined when invalid.
 */
export function parseNumberValue(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;

  let text = value.replace(/[\s  €$]/g, '').replace(/EUR|USD|MGA/gi, '');
  if (!text) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The last separator is the decimal one
    text = lastComma > lastDot
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (lastComma > -1) {
    text = text.replace(',', '.');
  }

  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return parseDateValue(value) || '';
  return String(value).trim();
}

/** True when an entity name designates the configured destination (case, spaces and accents ignored). */
export function matchesDestination(name: string | null | undefined, destination: string): boolean {
  const norm = (s: string) => normalizeHeader(s).replace(/[^a-z0-9]/g, '');
  const target = norm(destination);
  return Boolean(name) && target !== '' && norm(name as string).includes(target);
}

// ---------------------------------------------------------------------------
// Validation (API payloads)
// ---------------------------------------------------------------------------

function optionalText(value: unknown, label: string, errors: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    errors.push(`${label} invalide.`);
    return null;
  }
  const text = value.trim();
  if (text.length > DIGI_TEXT_MAX_LENGTH) {
    errors.push(`${label} : ${DIGI_TEXT_MAX_LENGTH} caractères maximum.`);
  }
  return text || null;
}

function optionalAmount(value: unknown, label: string, errors: string[]): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) >= 1e10) {
    errors.push(`${label} invalide.`);
    return null;
  }
  return value;
}

/**
 * Validates an invoice payload (manual entry or Excel import).
 */
export function validateDigiInvoiceInput(raw: any): { value: DigiInvoiceInput | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { value: null, errors: ['Facture invalide.'] };
  }

  const supplier = optionalText(raw.supplier_name, 'Fournisseur', errors);
  const ref = optionalText(raw.ref, 'Référence de la facture', errors);
  if (!supplier) errors.push('Le fournisseur est obligatoire.');
  if (!ref) errors.push('La référence de la facture est obligatoire.');

  let invoiceDate: string | null = null;
  if (raw.invoice_date !== null && raw.invoice_date !== undefined && raw.invoice_date !== '') {
    const parsed = typeof raw.invoice_date === 'string' ? parseDateValue(raw.invoice_date) : undefined;
    if (!parsed) errors.push('Date de facturation invalide.');
    else invoiceDate = parsed;
  }

  const lines: DigiInvoiceLineInput[] = [];
  if (raw.lines !== undefined && !Array.isArray(raw.lines)) {
    errors.push('Lignes de facture invalides.');
  } else if (Array.isArray(raw.lines)) {
    if (raw.lines.length > DIGI_MAX_LINES_PER_INVOICE) {
      errors.push(`${DIGI_MAX_LINES_PER_INVOICE} lignes maximum par facture.`);
    }
    raw.lines.slice(0, DIGI_MAX_LINES_PER_INVOICE).forEach((line: any, index: number) => {
      const label = `Ligne ${index + 1}`;
      const name = typeof line?.name === 'string' ? line.name.trim() : '';
      if (!name) errors.push(`${label} : le libellé est obligatoire.`);
      else if (name.length > DIGI_LINE_NAME_MAX_LENGTH) {
        errors.push(`${label} : libellé trop long (${DIGI_LINE_NAME_MAX_LENGTH} caractères maximum).`);
      }
      lines.push({
        name,
        quantity: optionalAmount(line?.quantity, `${label} : quantité`, errors),
        price_unit: optionalAmount(line?.price_unit, `${label} : prix`, errors),
        price_subtotal: optionalAmount(line?.price_subtotal, `${label} : sous-total`, errors),
      });
    });
  }

  const value: DigiInvoiceInput = {
    supplier_name: supplier || '',
    dest_partner_name: optionalText(raw.dest_partner_name, 'Entité de destination', errors),
    ref: ref || '',
    invoice_date: invoiceDate,
    amazon_order_ref: optionalText(raw.amazon_order_ref, 'Commande Amazon', errors),
    sale_move_ref: optionalText(raw.sale_move_ref, 'Facture vente', errors),
    lines: mergeServiceLines(lines),
  };

  return { value: errors.length === 0 ? value : null, errors };
}

// ---------------------------------------------------------------------------
// Excel parsing (DIGI export)
// ---------------------------------------------------------------------------

type InvoiceField =
  | 'supplier_name'
  | 'dest_partner_name'
  | 'ref'
  | 'invoice_date'
  | 'amazon_order_ref'
  | 'sale_move_ref'
  | 'state';
type LineField = 'name' | 'quantity' | 'price_unit' | 'price_subtotal';

/** Lowercase, no accents, single spaces, "_" and "-" read as spaces. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-.:°]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Odoo technical field names and their French labels (Odoo export headers)
const INVOICE_ALIASES: Record<InvoiceField, string[]> = {
  supplier_name: ['partner id', 'fournisseur', 'partenaire', 'partner'],
  dest_partner_name: ['dest partner id', 'entite de destination', 'destination', 'entite destination'],
  ref: ['ref', 'reference', 'reference de la facture', 'reference facture', 'ref facture', 'reference fournisseur'],
  invoice_date: ['invoice date', 'date de facturation', 'date facture', 'date de facture'],
  amazon_order_ref: ['num cmd amz', 'commande amazon', 'n commande amazon', 'numero commande amazon', 'cmd amazon'],
  sale_move_ref: ['sale move id', 'facture vente', 'facture de vente'],
  state: ['state', 'etat', 'statut'],
};

const LINE_ALIASES: Record<LineField, string[]> = {
  name: ['name', 'libelle', 'description', 'designation'],
  quantity: ['quantity', 'quantite', 'qte', 'qty'],
  price_unit: ['price unit', 'prix', 'prix unitaire', 'pu'],
  price_subtotal: ['price subtotal', 'sous total', 'sous total ht', 'montant ht'],
};

const LINE_PREFIXES = ['invoice line ids', 'lignes de facture', 'lignes de factures', 'line ids', 'lignes'];

function lookup<F extends string>(aliases: Record<F, string[]>, key: string): F | null {
  for (const field of Object.keys(aliases) as F[]) {
    if (aliases[field].includes(key)) return field;
  }
  return null;
}

type ColumnTarget = { kind: 'invoice'; field: InvoiceField } | { kind: 'line'; field: LineField };

/**
 * Maps one header cell. "Lignes de facture/Libellé" or "invoice_line_ids/name"
 * → line field; "partner_id/name" → invoice field.
 */
export function mapHeader(header: string): ColumnTarget | null {
  const raw = header.trim();
  if (!raw) return null;

  const slash = raw.indexOf('/');
  if (slash > -1) {
    const prefix = normalizeHeader(raw.slice(0, slash));
    const tail = normalizeHeader(raw.slice(slash + 1));
    if (LINE_PREFIXES.includes(prefix)) {
      const field = lookup(LINE_ALIASES, tail);
      return field ? { kind: 'line', field } : null;
    }
    const field = lookup(INVOICE_ALIASES, prefix);
    return field ? { kind: 'invoice', field } : null;
  }

  const key = normalizeHeader(raw);
  const invoiceField = lookup(INVOICE_ALIASES, key);
  if (invoiceField) return { kind: 'invoice', field: invoiceField };
  const lineField = lookup(LINE_ALIASES, key);
  return lineField ? { kind: 'line', field: lineField } : null;
}

/** "cancel" (Odoo technical value) or "Annulé(e)" (French label). */
export function isCancelledState(value: unknown): boolean {
  const state = normalizeHeader(cellText(value));
  return state === 'cancel' || state === 'cancelled' || state.startsWith('annul');
}

export interface SheetParseIssue {
  row: number; // 1-based spreadsheet row
  message: string;
}

export interface SheetParseResult {
  invoices: DigiInvoiceInput[];
  /** Invoices left out because their destination is not the configured one. */
  skippedOtherDestination: number;
  /** Invoices left out because they are cancelled (state column). */
  skippedCancelled: number;
  /** Invoices left out because one of their rows could not be read (see errors). */
  rejectedInvoices: number;
  errors: SheetParseIssue[];
  /** Detected columns, for display: header text → target field. */
  columns: { header: string; field: string }[];
  /** True when the file has a destination column (and the filter was applied). */
  hasDestinationColumn: boolean;
}

const MAX_HEADER_SCAN_ROWS = 15;

/**
 * Turns the rows of a DIGI spreadsheet into invoices.
 *
 * Supports both layouts:
 * - Odoo export: invoice columns filled on the first line of each invoice,
 *   empty on the following lines (one row per invoice line);
 * - flat table: invoice columns repeated on every row.
 * Rows are grouped by supplier + invoice ref.
 */
export function parseDigiSheet(rows: unknown[][], destination: string): SheetParseResult {
  const result: SheetParseResult = {
    invoices: [],
    skippedOtherDestination: 0,
    skippedCancelled: 0,
    rejectedInvoices: 0,
    errors: [],
    columns: [],
    hasDestinationColumn: false,
  };

  // 1. Header row: the first row mapping both supplier and ref
  let headerIndex = -1;
  let mapping: (ColumnTarget | null)[] = [];
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i++) {
    const candidate = (rows[i] || []).map((cell) => mapHeader(cellText(cell)));
    const fields = new Set(candidate.filter(Boolean).map((t) => `${t!.kind}.${t!.field}`));
    if (fields.has('invoice.supplier_name') && fields.has('invoice.ref')) {
      headerIndex = i;
      mapping = candidate;
      break;
    }
  }

  if (headerIndex === -1) {
    result.errors.push({
      row: 1,
      message:
        'En-têtes introuvables : le fichier doit contenir au moins les colonnes « Fournisseur » (partner_id) et « Référence » (ref).',
    });
    return result;
  }

  // Keep the first column for each field (ignore duplicates)
  const seen = new Set<string>();
  mapping = mapping.map((target, col) => {
    if (!target) return null;
    const key = `${target.kind}.${target.field}`;
    if (seen.has(key)) return null;
    seen.add(key);
    result.columns.push({ header: cellText(rows[headerIndex][col]), field: key });
    return target;
  });
  result.hasDestinationColumn = seen.has('invoice.dest_partner_name');

  // 2. Rows → invoices
  type Entry = { invoice: DigiInvoiceInput; firstRow: number; failed: boolean; cancelled: boolean };
  const byKey = new Map<string, Entry>();
  let current: Entry | null = null;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const rowNumber = i + 1;
    const row = rows[i] || [];
    const inv: Partial<Record<InvoiceField, unknown>> = {};
    const line: Partial<Record<LineField, unknown>> = {};

    mapping.forEach((target, col) => {
      if (!target) return;
      const value = row[col];
      if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return;
      if (target.kind === 'invoice') inv[target.field] = value;
      else line[target.field] = value;
    });

    const hasInvoicePart = Object.keys(inv).length > 0;
    const hasLinePart = Object.keys(line).length > 0;
    if (!hasInvoicePart && !hasLinePart) continue; // empty row

    if (hasInvoicePart) {
      const supplier = cellText(inv.supplier_name);
      const ref = cellText(inv.ref);
      if (!supplier || !ref) {
        result.errors.push({
          row: rowNumber,
          message: !supplier ? 'Fournisseur manquant.' : 'Référence de facture manquante.',
        });
        current = null;
        continue;
      }

      const invoiceDate = parseDateValue(inv.invoice_date);

      const key = `${normalizeHeader(supplier)}|${normalizeHeader(ref)}`;
      const existing = byKey.get(key);
      if (existing) {
        current = existing;
        // Fill fields still empty (flat layout repeats them)
        const invoice = existing.invoice;
        invoice.dest_partner_name ??= cellText(inv.dest_partner_name) || null;
        invoice.invoice_date ??= invoiceDate ?? null;
        invoice.amazon_order_ref ??= cellText(inv.amazon_order_ref) || null;
        invoice.sale_move_ref ??= cellText(inv.sale_move_ref) || null;
      } else {
        const invoice: DigiInvoiceInput = {
          supplier_name: supplier,
          dest_partner_name: cellText(inv.dest_partner_name) || null,
          ref,
          invoice_date: invoiceDate ?? null,
          amazon_order_ref: cellText(inv.amazon_order_ref) || null,
          sale_move_ref: cellText(inv.sale_move_ref) || null,
          lines: [],
        };
        current = { invoice, firstRow: rowNumber, failed: false, cancelled: false };
        byKey.set(key, current);
      }

      if (isCancelledState(inv.state)) current.cancelled = true;

      if (invoiceDate === undefined) {
        // Any unreadable value rejects the whole invoice: never a partial import
        current.failed = true;
        result.errors.push({ row: rowNumber, message: `Date de facturation illisible : « ${cellText(inv.invoice_date)} ».` });
      }
    }

    if (hasLinePart) {
      if (!current) {
        result.errors.push({ row: rowNumber, message: 'Ligne de produit sans facture (fournisseur et référence absents au-dessus).' });
        continue;
      }
      const name = cellText(line.name);
      if (!name) {
        current.failed = true;
        result.errors.push({ row: rowNumber, message: 'Libellé de ligne manquant.' });
        continue;
      }
      const numbers = {
        quantity: parseNumberValue(line.quantity),
        price_unit: parseNumberValue(line.price_unit),
        price_subtotal: parseNumberValue(line.price_subtotal),
      };
      const invalid = (Object.keys(numbers) as (keyof typeof numbers)[]).filter((k) => numbers[k] === undefined);
      if (invalid.length > 0) {
        const labels: Record<string, string> = { quantity: 'quantité', price_unit: 'prix', price_subtotal: 'sous-total' };
        current.failed = true;
        result.errors.push({ row: rowNumber, message: `Valeur numérique illisible : ${invalid.map((k) => labels[k]).join(', ')}.` });
        continue;
      }
      current.invoice.lines.push({
        name: name.slice(0, DIGI_LINE_NAME_MAX_LENGTH),
        quantity: numbers.quantity ?? null,
        price_unit: numbers.price_unit ?? null,
        price_subtotal: numbers.price_subtotal ?? null,
      });
    }
  }

  // 3. Destination filter (same condition as on Odoo: destination = NextHope)
  for (const { invoice, firstRow, failed, cancelled } of byKey.values()) {
    // Cancelled invoices are not tracked (same rule as the Odoo sync)
    if (cancelled) {
      result.skippedCancelled++;
      continue;
    }
    if (result.hasDestinationColumn && !matchesDestination(invoice.dest_partner_name, destination)) {
      result.skippedOtherDestination++;
      continue;
    }
    if (failed) {
      result.rejectedInvoices++;
      continue;
    }
    const check = validateDigiInvoiceInput(invoice);
    if (!check.value) {
      result.rejectedInvoices++;
      result.errors.push({ row: firstRow, message: `Facture ${invoice.ref} : ${check.errors.join(' ')}` });
      continue;
    }
    result.invoices.push(check.value);
  }

  return result;
}
