import { MirrorError, MirrorInvoice, fetchInvoiceDetails, fetchInvoiceIndex } from './mirrorClient.js';
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
import type { AuditActor } from '../../db/audit.js';

/**
 * Pulls the DIGI LOGISTIC invoices addressed to NextHope from the mirror API
 * (PostgreSQL copy of Odoo). The API owns the filters (destination, invoice
 * types, states) and lists cancelled invoices too, so that the ones synced
 * earlier are removed here.
 *
 * 1. Light index (id, state, sync_date) of every invoice of the perimeter.
 * 2. Details of the new invoices and of those whose sync_date changed.
 * 3. Invoices that disappear from the index are flagged, never deleted.
 */

// The mirror needs ~4 s per invoice: small chunks stay under the request timeout
const READ_CHUNK = 10;

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
}

/** Destination shown in the app and used to filter Excel imports. */
export function getDestinationFilter(): { name: string } {
  return { name: process.env.ODOO_DEST_PARTNER_NAME?.trim() || DEFAULT_DEST_PARTNER_NAME };
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

function id(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isInteger(n) && n > 0 ? n : null;
}

/** PostgreSQL numerics may come as strings. */
function amount(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function toInvoice(move: MirrorInvoice): OdooInvoiceInput {
  const lines: DigiInvoiceLineInput[] = [];
  for (const line of move.invoice_lines || []) {
    const productName = text(line.product_name);
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
      odoo_line_id: id(line.id),
    });
  }

  // Only one sale invoice is stored for now: the first one
  const sale = (move.sale_move_ids || [])[0];

  return {
    odoo_move_id: Number(move.odoo_move_id),
    // Draft invoices are named "/" in Odoo
    odoo_move_name: text(move.name) === '/' ? null : text(move.name),
    odoo_state: text(move.state),
    odoo_write_date: text(move.sync_date),
    supplier_name: text(move.partner_name),
    supplier_odoo_id: id(move.partner_id),
    dest_partner_name: text(move.dest_partner_name),
    dest_partner_odoo_id: id(move.dest_partner_id),
    ref: text(move.ref),
    invoice_date: text(move.invoice_date)?.slice(0, 10) ?? null,
    amazon_order_ref: text(move.num_cmd_amz),
    sale_move_ref: sale ? text(sale.name) : null,
    sale_move_odoo_id: sale ? id(sale.id) : null,
    lines: mergeServiceLines(lines),
  };
}

export async function syncDigiInvoicesFromOdoo(options: { timeBudgetMs: number }): Promise<DigiOdooSyncResult> {
  const startedAt = Date.now();

  // 1. Every invoice of the perimeter with its state and last change (light call).
  // Cancelled ones are listed too, to remove those synced before.
  const all = await fetchInvoiceIndex();
  const listed = all.filter((m) => m.state !== 'cancel');
  const cancelledIds = all.filter((m) => m.state === 'cancel').map((m) => m.odoo_move_id);

  const known = await getOdooWriteDates();
  const cancelledRemoved = await deleteOdooInvoices(cancelledIds.filter((moveId) => known.has(moveId)));
  const toRead = listed.filter((m) => known.get(m.odoo_move_id) !== m.sync_date).map((m) => m.odoo_move_id);

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

  // 2. New and changed invoices, by chunks, within the time budget
  for (let offset = 0; offset < toRead.length; offset += READ_CHUNK) {
    if (Date.now() - startedAt > options.timeBudgetMs) {
      result.remaining = toRead.length - offset;
      result.complete = false;
      break;
    }

    const moves = await fetchInvoiceDetails(toRead.slice(offset, offset + READ_CHUNK));
    for (const move of moves) {
      // Cancelled between the index and the details: not tracked
      if (move.state === 'cancel') {
        await deleteOdooInvoices([Number(move.odoo_move_id)]);
        continue;
      }
      try {
        const outcome = await upsertOdooInvoice(toInvoice(move));
        result[outcome]++;
      } catch (err: any) {
        result.failed++;
        console.error('[DIGI Mirror Sync] Could not store invoice', move.odoo_move_id, err?.message || err);
      }
    }
  }

  // 3. Flag invoices no longer returned by the mirror
  result.missing = await markMissingOdooInvoices(listed.map((m) => m.odoo_move_id));

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
      error: err instanceof MirrorError ? err.publicMessage : 'Échec de la synchronisation Odoo',
    });
    throw err;
  }
}
