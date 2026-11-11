import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPLIER_LABEL_MAX, shipmentSupplierLabel } from './shipmentSuppliers';

test('shipmentSupplierLabel: names in order, each once (case-insensitive), blanks skipped', () => {
  assert.equal(shipmentSupplierLabel(['Alpha', 'beta', 'ALPHA', '  ', null, '—', 'Beta']), 'Alpha, beta');
});

test('shipmentSupplierLabel: one supplier, or none', () => {
  assert.equal(shipmentSupplierLabel(['Alpha']), 'Alpha');
  assert.equal(shipmentSupplierLabel([]), '—');
});

test('shipmentSupplierLabel: cut to the column size with the count left out', () => {
  const names = Array.from({ length: 30 }, (_, i) => `Fournisseur numéro ${i + 1}`);
  const label = shipmentSupplierLabel(names);
  assert.ok(label.length <= SUPPLIER_LABEL_MAX);
  assert.match(label, /^Fournisseur numéro 1, .*… \(\+\d+\)$/);
});
