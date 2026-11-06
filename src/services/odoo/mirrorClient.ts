/**
 * Client of the DIGI LOGISTIC mirror API (read only).
 *
 * The API runs elsewhere, on a PostgreSQL copy of the Odoo database, and owns
 * the filters (NextHope destination, invoice types, states). The app only
 * calls it.
 *
 * Configuration (server side only, never exposed to the browser):
 *   MIRROR_API_URL  e.g. https://mirror.example.com/api
 *   MIRROR_API_KEY  sent as "Authorization: Bearer <key>"
 *
 * Contract:
 *   GET  /invoices/index    → { items: MirrorIndexEntry[] }
 *   POST /invoices/details  { ids: number[] } → { items: MirrorInvoice[] }
 */

export interface MirrorConfig {
  url: string;
  apiKey: string;
}

export class MirrorError extends Error {
  constructor(
    public kind: 'NOT_CONFIGURED' | 'AUTH' | 'NETWORK' | 'REMOTE',
    message: string,
    public publicMessage: string
  ) {
    super(message);
  }
}

/** One invoice of the light listing. */
export interface MirrorIndexEntry {
  odoo_move_id: number;
  state: string;
  /** Last change of the invoice or of one of its lines, compared as is. */
  sync_date: string;
}

export interface MirrorInvoiceLine {
  id: number;
  name: string | null;
  product_name: string | null;
  quantity: number | string | null;
  price_unit: number | string | null;
  price_subtotal: number | string | null;
}

export interface MirrorInvoice {
  odoo_move_id: number;
  name: string | null;
  state: string;
  sync_date: string;
  partner_id: number | null;
  partner_name: string | null;
  dest_partner_id: number | null;
  dest_partner_name: string | null;
  ref: string | null;
  invoice_date: string | null;
  num_cmd_amz: string | null;
  sale_move_ids: { id: number; name: string | null }[];
  invoice_lines: MirrorInvoiceLine[];
}

// The mirror is slow (index up to ~25 s, details ~4 s per invoice)
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Routes live under /api. Accepts the site root, the docs page or a full
 * route URL too, as people paste what they have at hand.
 */
function normalizeMirrorUrl(raw: string): string {
  const url = raw.replace(/\/+$/, '').replace(/\/(docs|invoices\/(index|details))$/i, '');
  return /\/api$/i.test(url) ? url : `${url}/api`;
}

export function getMirrorConfig(): MirrorConfig | null {
  const raw = process.env.MIRROR_API_URL?.trim();
  const apiKey = process.env.MIRROR_API_KEY?.trim();
  if (!raw || !apiKey || !/^https?:\/\//i.test(raw)) return null;
  return { url: normalizeMirrorUrl(raw), apiKey };
}

export function isMirrorConfigured(): boolean {
  return getMirrorConfig() !== null;
}

async function call(path: string, body?: unknown): Promise<unknown[]> {
  const config = getMirrorConfig();
  if (!config) {
    throw new MirrorError('NOT_CONFIGURED', 'Mirror API is not configured', 'L\'API du miroir Odoo n\'est pas configurée.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new MirrorError('NETWORK', `Mirror request failed: ${err?.message || err}`, 'L\'API du miroir Odoo est injoignable.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new MirrorError('AUTH', `Mirror HTTP ${response.status}`, 'Clé de l\'API du miroir Odoo refusée.');
  }
  if (!response.ok) {
    throw new MirrorError(
      'REMOTE',
      `Mirror HTTP ${response.status} on ${config.url}${path}`,
      `L'API du miroir Odoo a répondu une erreur HTTP ${response.status}.`
    );
  }

  const payload: any = await response.json().catch(() => null);
  const items = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(items)) {
    throw new MirrorError('REMOTE', 'Mirror returned an unexpected payload', 'Réponse de l\'API du miroir Odoo illisible.');
  }
  return items;
}

/** Every invoice of the perimeter, cancelled ones included (light call). */
export async function fetchInvoiceIndex(): Promise<MirrorIndexEntry[]> {
  const items = await call('/invoices/index');
  return items
    .map((raw: any) => ({
      odoo_move_id: Number(raw?.odoo_move_id),
      state: String(raw?.state ?? ''),
      sync_date: raw?.sync_date == null ? '' : String(raw.sync_date),
    }))
    .filter((entry) => Number.isInteger(entry.odoo_move_id) && entry.odoo_move_id > 0);
}

/** Full invoices (header, sale invoices, lines) for the given ids. */
export async function fetchInvoiceDetails(ids: number[]): Promise<MirrorInvoice[]> {
  if (ids.length === 0) return [];
  return (await call('/invoices/details', { ids })) as MirrorInvoice[];
}
