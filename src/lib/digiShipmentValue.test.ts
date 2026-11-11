import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigiValueLookup, normalizeInvoiceKey } from './digiShipmentValue.js';
import type { DigiInvoiceForValue } from './digiShipmentValue.js';

const inv = (over: Partial<DigiInvoiceForValue>): DigiInvoiceForValue => ({
  ref: null,
  odoo_move_name: null,
  sale_move_ref: null,
  amount_total: 100,
  ...over,
});

test('clé de facture : casse, espaces, tirets et soulignés ignorés', () => {
  assert.equal(normalizeInvoiceKey(' fa-2026_01 x '), 'FA202601X');
  assert.equal(normalizeInvoiceKey('FAC/2026/001'), 'FAC/2026/001');
  assert.equal(normalizeInvoiceKey(null), '');
  assert.equal(normalizeInvoiceKey(undefined), '');
});

test('valeur trouvée par Réf FA ou n° de facture', () => {
  const lookup = buildDigiValueLookup([inv({ ref: 'BL-1', odoo_move_name: 'FAC/2026/001', sale_move_ref: 'VE 42', amount_total: 1234.5 })]);
  const expected = { amount: 1234.5, invoiceLabel: 'Facture DIGI FAC/2026/001' };
  assert.deepEqual(lookup({ ref_fa_digi_nxt: 'fac/2026/001' }), expected);
  assert.deepEqual(lookup({ ref_fa_digi_nxt: 've-42' }), expected);
  assert.deepEqual(lookup({ invoice_no: 'bl 1' }), expected);
  assert.equal(lookup({ ref_fa_digi_nxt: 'AUTRE' }), null);
  assert.equal(lookup({}), null);
  assert.equal(lookup({ ref_fa_digi_nxt: ' - ', invoice_no: null }), null);
});

test('libellé : nom Odoo, sinon réf, sinon facture de vente', () => {
  assert.equal(buildDigiValueLookup([inv({ ref: 'R1' })])({ invoice_no: 'R1' })?.invoiceLabel, 'Facture DIGI R1');
  assert.equal(buildDigiValueLookup([inv({ sale_move_ref: 'V1' })])({ invoice_no: 'V1' })?.invoiceLabel, 'Facture DIGI V1');
});

test('factures écartées : absente d’Odoo ou sans montant ; zéro est gardé', () => {
  assert.equal(buildDigiValueLookup([inv({ ref: 'R1', odoo_missing: true })])({ invoice_no: 'R1' }), null);
  assert.equal(buildDigiValueLookup([inv({ ref: 'R1', amount_total: null })])({ invoice_no: 'R1' }), null);
  assert.equal(buildDigiValueLookup([inv({ ref: 'R1', amount_total: 0 })])({ invoice_no: 'R1' })?.amount, 0);
  // Une facture écartée ne rend pas la clé ambiguë
  const lookup = buildDigiValueLookup([inv({ ref: 'R1', amount_total: null }), inv({ ref: 'R1', amount_total: 50 })]);
  assert.equal(lookup({ invoice_no: 'R1' })?.amount, 50);
});

test('clé partagée : montants différents → pas de valeur, même montant → valeur', () => {
  const ambiguous = buildDigiValueLookup([
    inv({ ref: 'R1', odoo_move_name: 'FAC/1', amount_total: 100 }),
    inv({ ref: 'R-1', odoo_move_name: 'FAC/2', amount_total: 200 }),
    inv({ ref: 'r1', odoo_move_name: 'FAC/3', amount_total: 100 }), // reste ambiguë
  ]);
  assert.equal(ambiguous({ invoice_no: 'R1' }), null);
  // Les autres clés de ces factures restent utilisables
  assert.equal(ambiguous({ invoice_no: 'FAC/2' })?.amount, 200);
  // Réf FA ambiguë → on essaie le n° de facture
  assert.equal(ambiguous({ ref_fa_digi_nxt: 'R1', invoice_no: 'FAC/3' })?.amount, 100);

  const same = buildDigiValueLookup([
    inv({ ref: 'R1', odoo_move_name: 'FAC/1', amount_total: 100 }),
    inv({ ref: 'R1', odoo_move_name: 'FAC/2', amount_total: 100 }),
  ]);
  // Même montant : la première facture est retenue (son libellé)
  assert.deepEqual(same({ invoice_no: 'R1' }), { amount: 100, invoiceLabel: 'Facture DIGI FAC/1' });
});

test('Réf FA prioritaire sur le n° de facture', () => {
  const lookup = buildDigiValueLookup([inv({ ref: 'A', amount_total: 1 }), inv({ ref: 'B', amount_total: 2 })]);
  assert.equal(lookup({ ref_fa_digi_nxt: 'A', invoice_no: 'B' })?.amount, 1);
  assert.equal(lookup({ ref_fa_digi_nxt: 'Z', invoice_no: 'B' })?.amount, 2);
  assert.equal(buildDigiValueLookup([])({ ref_fa_digi_nxt: 'A' }), null);
});
