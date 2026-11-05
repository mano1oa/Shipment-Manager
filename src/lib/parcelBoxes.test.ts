import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxSummary, findMergeSuspects, invoiceBoxesLabel, isPartialOverdue, lossDeadline, normalizeParcelNumber } from './parcelBoxes.js';
import type { ParcelForMerge } from './parcelBoxes.js';
import { DEFAULT_TRACKING_SETTINGS } from './parcelTracking.js';

const settings = { ...DEFAULT_TRACKING_SETTINGS, parcel_loss_days_after_eta: 3, parcel_loss_days_without_eta: 10 };
const boxes = (n: number) => Array.from({ length: n }, () => ({}));

test('normalisation des autres n°', () => {
  // Carrier / box number: read like the main number
  assert.equal(normalizeParcelNumber('piece', ' 8785 0410 4073 '), '878504104073');
  assert.equal(normalizeParcelNumber('carrier', '1Z-999.AA1'), '1Z999AA1');
  // Supplier reference: case, spaces, dashes and dots only
  assert.equal(normalizeParcelNumber('supplier', ' bl-2026.0042 '), 'BL20260042');
  assert.equal(normalizeParcelNumber('supplier', 'ABC/12'), 'ABC/12');
});

test('badge boîtes', () => {
  assert.equal(boxSummary({ boxes: boxes(1), boxes_expected: null }).label, null);
  assert.equal(boxSummary({ boxes: boxes(2), boxes_expected: null }).label, '2 boîtes');
  assert.equal(boxSummary({ boxes: boxes(2), boxes_expected: 3 }).label, '2/3 boîtes');
  const full = boxSummary({ boxes: boxes(3), boxes_expected: 3 });
  assert.equal(full.label, 'Complet 3/3');
  assert.equal(full.complete, true);
  const over = boxSummary({ boxes: boxes(4), boxes_expected: 3 });
  assert.equal(over.over, true);
  assert.equal(over.label, '4/3 boîtes');
});

test('libellé boîtes de la facture', () => {
  assert.equal(invoiceBoxesLabel(0, null), null);
  assert.equal(invoiceBoxesLabel(3, null), '3 boîte(s) reçue(s)');
  assert.equal(invoiceBoxesLabel(2, 3), '2/3 boîtes reçues');
});

test('délai : livraison prévue, sinon plus ancienne facture', () => {
  assert.equal(lossDeadline({ expected_delivery: '2026-10-10', invoices: [] }, settings), '2026-10-13');
  assert.equal(
    lossDeadline({ expected_delivery: null, invoices: [{ invoice_date: '2026-10-05' }, { invoice_date: '2026-10-01' }] }, settings),
    '2026-10-11'
  );
  assert.equal(lossDeadline({ expected_delivery: null, invoices: [] }, settings), null);
});

test('alerte « Reçu partiel »', () => {
  const p = { status: 'received' as const, boxes: boxes(2), boxes_expected: 3, expected_delivery: '2026-10-10', invoices: [] };
  assert.equal(isPartialOverdue(p, settings, '2026-10-13'), false, 'jour du délai');
  assert.equal(isPartialOverdue(p, settings, '2026-10-14'), true);
  assert.equal(isPartialOverdue({ ...p, boxes_expected: null }, settings, '2026-12-01'), false, 'N inconnu');
  assert.equal(isPartialOverdue({ ...p, boxes: boxes(3) }, settings, '2026-12-01'), false, 'complet');
  assert.equal(isPartialOverdue({ ...p, status: 'lost' }, settings, '2026-12-01'), false, 'pas reçu');
  assert.equal(isPartialOverdue({ ...p, expected_delivery: null }, settings, '2026-12-01'), false, 'aucune date');
});

const parcel = (over: Partial<ParcelForMerge>): ParcelForMerge => ({
  id: 'x',
  tracking_number: null,
  carrier: 'FEDEX',
  carrier_name: null,
  supplier_name: 'EET',
  destination: 'ORLY',
  status: 'received',
  created_at_point: false,
  invoices: [{ id: 'inv-1646140', ref: '1646140' }],
  ...over,
});

test('encart « Colis à fusionner ? » : cas 1646140', () => {
  const master = parcel({ id: 'm', tracking_number: '878504104051', status: 'lost', carrier_name: 'FedEx' });
  const b2 = parcel({ id: 'b2', tracking_number: '878504104073', created_at_point: true });
  const b3 = parcel({ id: 'b3', tracking_number: '878504104084', created_at_point: true });
  const suspects = findMergeSuspects([master, b2, b3]);
  assert.equal(suspects.length, 1);
  assert.equal(suspects[0].principal.id, 'm');
  assert.deepEqual(suspects[0].boxes.map((b) => b.id), ['b2', 'b3']);
});

test('encart : critères qui excluent', () => {
  const master = parcel({ id: 'm', status: 'lost' });
  // Not created at a point, other supplier, other carrier, other hub, under search
  assert.equal(findMergeSuspects([master, parcel({ id: 'a' })]).length, 0);
  assert.equal(findMergeSuspects([master, parcel({ id: 'a', created_at_point: true, supplier_name: 'AUTRE' })]).length, 0);
  assert.equal(findMergeSuspects([master, parcel({ id: 'a', created_at_point: true, carrier: 'UPS' })]).length, 0);
  assert.equal(findMergeSuspects([master, parcel({ id: 'a', created_at_point: true, destination: 'ROUEN' })]).length, 0);
  assert.equal(findMergeSuspects([master, parcel({ id: 'a', created_at_point: true, status: 'search' })]).length, 0);
  // No lost parcel on the invoice
  assert.equal(findMergeSuspects([parcel({ id: 'm' }), parcel({ id: 'a', created_at_point: true })]).length, 0);
  // Same carrier by name, even when the connector differs
  assert.equal(
    findMergeSuspects([
      parcel({ id: 'm', status: 'lost', carrier_name: 'FedEx', carrier: 'UNKNOWN' }),
      parcel({ id: 'a', created_at_point: true, carrier_name: 'fedex' }),
    ]).length,
    1
  );
});
