import { OdooError, OdooSession } from './client.js';
import {
  deleteOdooInvoices,
  recordOdooSyncRun,
  getOdooWriteDates,
  markMissingOdooInvoices,
  upsertOdooInvoice,
  OdooInvoiceInput,
} from '../../db/digiInvoices.js';
import { DEFAULT_DEST_PARTNER_NAME, isServiceLabel, mergeServiceLines } from '../../lib/digiInvoices.js';
import type { DigiInvoiceLineInput } from '../../lib/digiInvoices.js';
import { createPendingShipments, SYSTEM_ACTOR } from '../digiShipments.js';
import type { AuditActor } from '../../db/audit.js';

/**
 * Pulls the DIGI LOGISTIC invoices addressed to NextHope from Odoo.
 *
 * Conditions: account.move whose `dest_partner_id` is the NextHope entity
 * (ODOO_DEST_PARTNER_ID when set, otherwise name contains
 * ODOO_DEST_PARTNER_NAME, "NextHope" by default), drafts included,
 * cancelled invoices excluded (and removed when already synced).
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
  cancelled_removed: number; // synced earlier, cancelled since in Odoo
  complete: boolean;
  shipments_created?: number; // shipments created for the new invoices
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
    const productName = m2o(line.product_id).name;
    // Odoo can leave the label empty: fall back to the product name.
    let name = text(line.name) || productName || '(sans libellé dans Odoo)';
    // Fee product ([DEEE], [RCP], [FRDP]) with an edited label: keep its code
    const feeCode = isServiceLabel(productName) ? /^\s*(\[[^\]]+\])/.exec(productName as string)?.[1] : null;
    if (feeCode && !isServiceLabel(name)) name = `${feeCode} ${name}`;
    lines.push({
      name,
      is_service: Boolean(feeCode),
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
    lines: mergeServiceLines(lines),
  };
}

export async function syncDigiInvoicesFromOdoo(options: { timeBudgetMs: number }): Promise<DigiOdooSyncResult> {
  const startedAt = Date.now();
  const odoo = await OdooSession.connect();

  // 1. Every matching invoice id with its state and last modification date
  // (light call). Cancelled ones are listed too, to remove those synced before.
  const all = await odoo.searchRead<{ id: number; write_date: string; state: string }>(
    'account.move',
    destinationDomain(),
    ['write_date', 'state'],
    { order: 'id asc', limit: MAX_LISTED_INVOICES }
  );
  const listed = all.filter((m) => m.state !== 'cancel');
  const cancelledIds = all.filter((m) => m.state === 'cancel').map((m) => m.id);

  const known = await getOdooWriteDates();
  const cancelledRemoved = await deleteOdooInvoices(cancelledIds.filter((id) => known.has(id)));
  const toRead = listed.filter((m) => known.get(m.id) !== m.write_date).map((m) => m.id);

  const result: DigiOdooSyncResult = {
    listed: listed.length,
    created: 0,
    updated: 0,
    unchanged: listed.length - toRead.length,
    failed: 0,
    remaining: 0,
    missing: 0,
    cancelled_removed: cancelledRemoved,
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
      // Cancelled between the listing and the read: not tracked
      if (move.state === 'cancel') {
        await deleteOdooInvoices([move.id]);
        continue;
      }
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
  if (all.length < MAX_LISTED_INVOICES) {
    result.missing = await markMissingOdooInvoices(listed.map((m) => m.id));
  }

  return result;
}

/**
 * Runs a sync and records it in the sync history (manual button or cron).
 * Errors are recorded too, then rethrown.
 */
export async function runDigiOdooSync(params: {
  trigger: 'manual' | 'cron';
  actor: AuditActor | null;
  timeBudgetMs: number;
}): Promise<DigiOdooSyncResult> {
  const startedAt = new Date().toISOString();
  const actorEmail = params.actor?.email ?? null;
  try {
    const result = await syncDigiInvoicesFromOdoo({ timeBudgetMs: params.timeBudgetMs });
    // Every new invoice to ship gets its shipment
    result.shipments_created = await createPendingShipments(params.actor ?? SYSTEM_ACTOR);
    await recordOdooSyncRun({
      trigger: params.trigger,
      actor_email: actorEmail,
      started_at: startedAt,
      success: true,
      result: { ...result },
      error: null,
    });
    return result;
  } catch (err: any) {
    await recordOdooSyncRun({
      trigger: params.trigger,
      actor_email: actorEmail,
      started_at: startedAt,
      success: false,
      result: null,
      error: err instanceof OdooError ? err.publicMessage : 'Échec de la synchronisation Odoo',
    });
    throw err;
  }
}
