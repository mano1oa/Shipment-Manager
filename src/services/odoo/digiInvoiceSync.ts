import { OdooSession } from './client.js';
import {
  getOdooWriteDates,
  markMissingOdooInvoices,
  upsertOdooInvoice,
  OdooInvoiceInput,
} from '../../db/digiInvoices.js';
import { DEFAULT_DEST_PARTNER_NAME } from '../../lib/digiInvoices.js';
import type { DigiInvoiceLineInput } from '../../lib/digiInvoices.js';

/**
 * Pulls the DIGI LOGISTIC invoices addressed to NextHope from Odoo.
 *
 * Condition: account.move whose `dest_partner_id` is the NextHope entity
 * (ODOO_DEST_PARTNER_ID when set, otherwise name contains
 * ODOO_DEST_PARTNER_NAME, "NextHope" by default).
 *
 * Only invoices changed since the last sync (Odoo write_date) are re-read.
 * Invoices that disappear from the filter are flagged, never deleted.
 */

const MOVE_FIELDS = [
  'name',
  'state',
  'write_date',
  'partner_id',
  'dest_partner_id',
  'ref',
  'invoice_date',
  'num_cmd_amz',
  'sale_move_id',
  'invoice_line_ids',
];
const LINE_FIELDS = ['name', 'product_id', 'quantity', 'price_unit', 'price_subtotal', 'display_type'];
const READ_CHUNK = 100;
const MAX_LISTED_INVOICES = 50_000;

export interface DigiOdooSyncResult {
  listed: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  remaining: number; // not processed because of the time budget
  missing: number; // flagged as no longer present in Odoo
  complete: boolean;
}

export function getDestinationFilter(): { id: number | null; name: string } {
  const rawId = process.env.ODOO_DEST_PARTNER_ID?.trim();
  const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
  const name = process.env.ODOO_DEST_PARTNER_NAME?.trim() || DEFAULT_DEST_PARTNER_NAME;
  return { id, name };
}

function destinationDomain(): unknown[] {
  const dest = getDestinationFilter();
  return dest.id !== null
    ? [['dest_partner_id', '=', dest.id]]
    : [['dest_partner_id.name', 'ilike', dest.name]];
}

/** Odoo returns `false` for empty values. */
function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Many2one → [id, display_name] or false. */
function m2o(value: unknown): { id: number | null; name: string | null } {
  if (Array.isArray(value) && typeof value[0] === 'number') {
    return { id: value[0], name: text(value[1]) };
  }
  return { id: null, name: null };
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toInvoice(move: any, linesById: Map<number, any>): OdooInvoiceInput {
  const supplier = m2o(move.partner_id);
  const dest = m2o(move.dest_partner_id);
  const sale = m2o(move.sale_move_id);

  const lines: DigiInvoiceLineInput[] = [];
  for (const lineId of (move.invoice_line_ids || []) as number[]) {
    const line = linesById.get(lineId);
    if (!line) continue;
    if (line.display_type === 'line_section' || line.display_type === 'line_note') continue;
    lines.push({
      // Odoo can leave the label empty: fall back to the product name.
      name: text(line.name) || m2o(line.product_id).name || '(sans libellé dans Odoo)',
      quantity: amount(line.quantity),
      price_unit: amount(line.price_unit),
      price_subtotal: amount(line.price_subtotal),
      odoo_line_id: lineId,
    });
  }

  return {
    odoo_move_id: move.id,
    odoo_move_name: text(move.name),
    odoo_state: text(move.state),
    odoo_write_date: text(move.write_date),
    supplier_name: supplier.name,
    supplier_odoo_id: supplier.id,
    dest_partner_name: dest.name,
    dest_partner_odoo_id: dest.id,
    ref: text(move.ref),
    invoice_date: text(move.invoice_date),
    amazon_order_ref: text(move.num_cmd_amz),
    sale_move_ref: sale.name,
    sale_move_odoo_id: sale.id,
    lines,
  };
}

export async function syncDigiInvoicesFromOdoo(options: { timeBudgetMs: number }): Promise<DigiOdooSyncResult> {
  const startedAt = Date.now();
  const odoo = await OdooSession.connect();

  // 1. Every matching invoice id with its last modification date (light call)
  const listed = await odoo.searchRead<{ id: number; write_date: string }>(
    'account.move',
    destinationDomain(),
    ['write_date'],
    { order: 'id asc', limit: MAX_LISTED_INVOICES }
  );

  const known = await getOdooWriteDates();
  const toRead = listed.filter((m) => known.get(m.id) !== m.write_date).map((m) => m.id);

  const result: DigiOdooSyncResult = {
    listed: listed.length,
    created: 0,
    updated: 0,
    unchanged: listed.length - toRead.length,
    failed: 0,
    remaining: 0,
    missing: 0,
    complete: true,
  };

  // 2. Changed invoices, by chunks, within the time budget
  for (let offset = 0; offset < toRead.length; offset += READ_CHUNK) {
    if (Date.now() - startedAt > options.timeBudgetMs) {
      result.remaining = toRead.length - offset;
      result.complete = false;
      break;
    }

    const ids = toRead.slice(offset, offset + READ_CHUNK);
    const moves = await odoo.read<any>('account.move', ids, MOVE_FIELDS);
    const lineIds = moves.flatMap((m) => (m.invoice_line_ids || []) as number[]);
    const lines = await odoo.read<any>('account.move.line', lineIds, LINE_FIELDS);
    const linesById = new Map(lines.map((l) => [l.id as number, l]));

    for (const move of moves) {
      try {
        const outcome = await upsertOdooInvoice(toInvoice(move, linesById));
        result[outcome]++;
      } catch (err: any) {
        result.failed++;
        console.error('[DIGI Odoo Sync] Could not store invoice', move.id, err?.message || err);
      }
    }
  }

  // 3. Flag invoices no longer returned by Odoo (only after a full listing)
  if (listed.length < MAX_LISTED_INVOICES) {
    result.missing = await markMissingOdooInvoices(listed.map((m) => m.id));
  }

  return result;
}
