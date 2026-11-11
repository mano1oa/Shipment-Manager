import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateParcelAlerts } from './parcelAlerts.js';
import type { ParcelForAlerts } from './parcelAlerts.js';
import { DEFAULT_TRACKING_SETTINGS } from './parcelTracking.js';

// evaluateParcelAlerts lit la date du jour elle-même : on fige l'horloge (restaurée
// automatiquement à la fin de chaque test par t.mock).
const freeze = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-11T12:00:00Z') });

const settings = { ...DEFAULT_TRACKING_SETTINGS, parcel_loss_days_after_eta: 3, parcel_loss_days_without_eta: 10 };

const parcel = (over: Partial<ParcelForAlerts>): ParcelForAlerts => ({
  id: 'p1',
  tracking_number: '1Z999',
  carrier_name: 'UPS',
  supplier_name: 'ACME',
  destination: 'ORLY',
  status: 'received',
  expected_delivery: null,
  received_at: null,
  status_changed_at: null,
  photo_count: 0,
  shipment_ids: [],
  invoices: [{ ref: 'FA-1', invoice_date: '2026-10-20' }],
  boxes: [],
  boxes_expected: null,
  ...over,
});

const partial = (over: Partial<ParcelForAlerts> = {}) =>
  parcel({ boxes: [{ piece_number: 'A1' }, { piece_number: null }], boxes_expected: 3, expected_delivery: '2026-11-01', ...over });

test('aucun colis, aucune alerte', (t) => {
  freeze(t);
  assert.deepEqual(evaluateParcelAlerts([], settings), []);
  assert.deepEqual(evaluateParcelAlerts([parcel({}), parcel({ status: 'to_receive' })], settings), []);
});

test('R9 reçu partiel après le délai de perte', (t) => {
  freeze(t);
  const [a, ...rest] = evaluateParcelAlerts([partial({ shipment_ids: ['S1', 'S2'] })], settings);
  assert.equal(rest.length, 0);
  assert.equal(a.rule_code, 'R9_PARCEL_PARTIAL');
  assert.equal(a.severity, 'warning');
  assert.equal(a.id, 'ALT-PARCEL-PARTIAL-p1-3');
  assert.equal(a.shipment_id, 'S1');
  assert.equal(a.created_at, '2026-11-04'); // prévue 01-11 + 3 j
  assert.equal(a.title, '📦 REÇU PARTIEL 2/3 À ORLY');
  assert.match(a.reason, /2 boîte\(s\) reçue\(s\) sur 3, 1 manquante\(s\) — reçues : A1\./);
  assert.match(a.relance_draft!, /Facture\(s\) : FA-1/);
});

test('R9 : la limite dépend des paramètres de suivi', (t) => {
  freeze(t);
  // prévue 08-11 + 3 = 11-11 : limite aujourd'hui → pas encore
  assert.deepEqual(evaluateParcelAlerts([partial({ expected_delivery: '2026-11-08' })], settings), []);
  assert.equal(evaluateParcelAlerts([partial({ expected_delivery: '2026-11-07' })], settings).length, 1);
  // prévue 05-11 : +3 → alerte ; +7 (défaut) → pas encore
  assert.equal(evaluateParcelAlerts([partial({ expected_delivery: '2026-11-05' })], settings).length, 1);
  assert.equal(evaluateParcelAlerts([partial({ expected_delivery: '2026-11-05' })], DEFAULT_TRACKING_SETTINGS).length, 0);
  // Sans date prévue : plus ancienne facture (25-10) + 10 j = 04-11
  const noEta = partial({
    expected_delivery: null,
    invoices: [
      { ref: 'FA-2', invoice_date: '2026-10-31' },
      { ref: null, invoice_date: '2026-10-25' },
    ],
  });
  const [a] = evaluateParcelAlerts([noEta], settings);
  assert.equal(a.created_at, '2026-11-04');
  assert.match(a.relance_draft!, /Facture\(s\) : FA-2, —/);
  assert.equal(evaluateParcelAlerts([noEta], { ...settings, parcel_loss_days_without_eta: 20 }).length, 0);
  // Ni date prévue ni facture datée : jamais d'alerte
  assert.equal(evaluateParcelAlerts([partial({ expected_delivery: null, invoices: [] })], settings).length, 0);
});

test('R9 : pas d’alerte si complet, sans nombre annoncé, ou non reçu', (t) => {
  freeze(t);
  const none = (over: Partial<ParcelForAlerts>) => assert.deepEqual(evaluateParcelAlerts([partial(over)], settings), []);
  none({ boxes_expected: 2 });
  none({ boxes_expected: 1 }); // plus de boîtes qu'annoncé
  none({ boxes_expected: null });
  none({ boxes: [] });
  none({ status: 'to_receive' });
  // Avis de recherche : l'alerte R7 sort, mais pas de R9
  assert.deepEqual(
    evaluateParcelAlerts([partial({ status: 'search' })], settings).map((a) => a.rule_code),
    ['R7_AVIS_RECHERCHE']
  );
});

test('R9 : un nouveau nombre annoncé donne une nouvelle alerte', (t) => {
  freeze(t);
  const [a] = evaluateParcelAlerts([partial({ boxes_expected: 4 })], settings);
  assert.equal(a.id, 'ALT-PARCEL-PARTIAL-p1-4');
  assert.match(a.reason, /2 manquante\(s\)/);
});

test('R6 colis perdu : selon le statut uniquement', (t) => {
  freeze(t);
  const [a] = evaluateParcelAlerts(
    [parcel({ status: 'lost', expected_delivery: '2026-11-01', status_changed_at: '2026-11-08T22:15:00Z', destination: 'ROUEN' })],
    settings
  );
  assert.equal(a.rule_code, 'R6_PARCEL_LOST');
  assert.equal(a.severity, 'critical');
  assert.equal(a.id, 'ALT-PARCEL-LOST-p1');
  assert.equal(a.shipment_id, '');
  assert.equal(a.created_at, '2026-11-08');
  assert.equal(a.title, '🚨 COLIS NON REÇU À ROUEN');
  assert.match(a.reason, /non confirmé à Rouen — livraison prévue le 01-11-2026\./);
  // Sans date de changement de statut : aujourd'hui
  const [b] = evaluateParcelAlerts([parcel({ status: 'lost', tracking_number: null, supplier_name: null, invoices: [] })], settings);
  assert.equal(b.created_at, '2026-11-11');
  assert.match(b.reason, /^Colis sans n° de suivi \(fournisseur inconnu\) non confirmé à Orly\.$/);
  assert.match(b.relance_draft!, /Facture\(s\) : N\/A/);
  // Un colis "à recevoir" en retard n'est pas évalué ici (le statut "lost" est posé ailleurs)
  assert.deepEqual(evaluateParcelAlerts([parcel({ status: 'to_receive', expected_delivery: '2026-01-01' })], settings), []);
});

test('R7 avis de recherche : destinataire selon le hub', (t) => {
  freeze(t);
  const [orly] = evaluateParcelAlerts(
    [parcel({ status: 'search', received_at: '2026-10-30', photo_count: 2, shipment_ids: ['S9'] })],
    settings
  );
  assert.equal(orly.rule_code, 'R7_AVIS_RECHERCHE');
  assert.equal(orly.id, 'ALT-PARCEL-SEARCH-p1');
  assert.equal(orly.shipment_id, 'S9');
  assert.equal(orly.created_at, '2026-11-11');
  assert.equal(orly.suggested_action, 'Ouvrir un avis de recherche auprès de MIDEX (Antoine), photo de réception jointe.');
  assert.match(orly.reason, /reçu à Orly le 30-10-2026/);
  assert.match(orly.relance_draft!, /Expédition : S9/);
  assert.match(orly.relance_draft!, /Photo de réception : 2 \(dans l'application\)/);
  const [rouen] = evaluateParcelAlerts([parcel({ status: 'search', destination: 'ROUEN' })], settings);
  assert.equal(rouen.suggested_action, 'Ouvrir un avis de recherche auprès du transitaire.');
  assert.match(rouen.relance_draft!, /Expédition : N\/A/);
  assert.match(rouen.relance_draft!, /Photo de réception : aucune/);
});

test('plusieurs colis : alertes dans l’ordre des colis', (t) => {
  freeze(t);
  const res = evaluateParcelAlerts(
    [parcel({ id: 'a', status: 'search' }), partial({ id: 'b' }), parcel({ id: 'c', status: 'lost' })],
    settings
  );
  assert.deepEqual(
    res.map((a) => a.id),
    ['ALT-PARCEL-SEARCH-a', 'ALT-PARCEL-PARTIAL-b-3', 'ALT-PARCEL-LOST-c']
  );
});
