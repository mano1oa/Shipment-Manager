import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRACKING_SETTINGS,
  amountInEur,
  applyAutomaticShipmentStatus,
  convertLegacyShipmentStatus,
  isParcelOverdue,
  parcelLossDeadline,
  parcelStatusLabel,
  validateParcelInput,
} from './parcelTracking.js';

const settings = { ...DEFAULT_TRACKING_SETTINGS, parcel_loss_days_after_eta: 3, parcel_loss_days_without_eta: 10 };

test('date de perte : livraison prévue + N, sinon facture + M', () => {
  // Valeurs par défaut : +7 / +14
  assert.equal(parcelLossDeadline('2026-10-10', '2026-09-01'), '2026-10-17');
  assert.equal(parcelLossDeadline(null, '2026-10-01'), '2026-10-15');
  assert.equal(parcelLossDeadline(undefined, undefined), null);
  // Paramètres
  assert.equal(parcelLossDeadline('2026-10-10', null, settings), '2026-10-13');
  assert.equal(parcelLossDeadline(null, '2026-10-01', settings), '2026-10-11');
  // Mois et année suivants, horodatage
  assert.equal(parcelLossDeadline('2026-12-28', null), '2027-01-04');
  assert.equal(parcelLossDeadline('2028-02-25', null, settings), '2028-02-28');
  assert.equal(parcelLossDeadline('2028-02-27', null, settings), '2028-03-01'); // année bissextile
  assert.equal(parcelLossDeadline('2026-10-10T23:30:00Z', null), '2026-10-17');
  // SUSPECT (mineur) : une date prévue illisible donne null au lieu de
  // se rabattre sur la date de facture.
  assert.equal(parcelLossDeadline('bientôt', '2026-10-01'), null);
});

test('colis en retard (perdu) : strictement après la limite', () => {
  const p = { status: 'to_receive' as const, expected_delivery: '2026-10-10' };
  assert.equal(isParcelOverdue(p, null, '2026-10-17'), false);
  assert.equal(isParcelOverdue(p, null, '2026-10-18'), true);
  assert.equal(isParcelOverdue(p, null, '2026-10-14', settings), true);
  assert.equal(isParcelOverdue({ ...p, expected_delivery: null }, '2026-10-01', '2026-10-15'), false);
  assert.equal(isParcelOverdue({ ...p, expected_delivery: null }, '2026-10-01', '2026-10-16'), true);
  assert.equal(isParcelOverdue({ ...p, expected_delivery: null }, null, '2030-01-01'), false);
  for (const status of ['received', 'lost', 'search'] as const) {
    assert.equal(isParcelOverdue({ ...p, status }, null, '2030-01-01'), false);
  }
});

test('montant en EUR', () => {
  assert.equal(amountInEur(100, 'EUR', null), 100);
  assert.equal(amountInEur(100, null, null), 100);
  assert.equal(amountInEur(100, 'USD', 0.92), 92);
  assert.equal(amountInEur(33.333, 'USD', 0.9), 30); // arrondi au centime
  assert.equal(amountInEur(100, 'USD', null), null);
  assert.equal(amountInEur(100, 'USD', 0), null);
  assert.equal(amountInEur(100, 'USD', -1), null);
  assert.equal(amountInEur(null, 'EUR', 1), null);
  assert.equal(amountInEur(Number.NaN, 'EUR', 1), null);
  assert.equal(amountInEur(0, 'USD', 0.9), 0);
});

test('statut d’une expédition de l’ancien modèle', () => {
  assert.deepEqual(convertLegacyShipmentStatus({ global_status: 'Bloquée douane' }), { status: 'Bloquée douane', needsReview: false });
  assert.deepEqual(convertLegacyShipmentStatus({ global_status: 'Livré entrepôt' }), { status: 'Livrée entrepôt', needsReview: false });
  assert.deepEqual(convertLegacyShipmentStatus({ global_status: 'Livré Client/Entrepôt' }), { status: 'Livrée entrepôt', needsReview: false });
  // La date de réception Mada l'emporte sur l'ancien statut
  assert.deepEqual(convertLegacyShipmentStatus({ global_status: 'Bloqué Douane', mada_receipt_date: '2026-10-01' }), {
    status: 'Livrée entrepôt',
    needsReview: false,
  });
  assert.deepEqual(convertLegacyShipmentStatus({ global_status: 'BLOQUÉ DOUANE' }), { status: 'Bloquée douane', needsReview: false });
  assert.deepEqual(convertLegacyShipmentStatus({ global_status: 'Reçu et expédié' }), { status: 'Expédiée vers Mada', needsReview: false });
  assert.deepEqual(convertLegacyShipmentStatus({ global_status: 'Livré Orly', orly_scan_date: '2026-10-01' }), {
    status: 'Expédiée vers Mada',
    needsReview: false,
  });
  for (const old of ['Livré Orly', 'Perdu Orly', 'En livraison vers Orly', '', null]) {
    assert.deepEqual(convertLegacyShipmentStatus({ global_status: old, orly_scan_date: '  ' }), { status: 'En préparation', needsReview: true });
  }
});

test('statut automatique selon les dates', () => {
  const delivered = { global_status: 'Livrée entrepôt', mada_receipt_date: '2026-10-01' };
  assert.equal(applyAutomaticShipmentStatus(delivered), delivered); // même objet
  assert.equal(applyAutomaticShipmentStatus({ global_status: 'Bloquée douane', mada_receipt_date: '2026-10-01' }).global_status, 'Livrée entrepôt');
  assert.equal(applyAutomaticShipmentStatus({ global_status: 'En préparation', mode: 'Air', orly_scan_date: '2026-10-01' }).global_status, 'Expédiée vers Mada');
  assert.equal(applyAutomaticShipmentStatus({ global_status: '', mode: 'Air', orly_scan_date: '2026-10-01' }).global_status, 'Expédiée vers Mada');
  // Aérien : l'ETD ne compte pas ; maritime : le scan Orly ne compte pas
  assert.equal(applyAutomaticShipmentStatus({ global_status: 'En préparation', mode: 'Air', etd: '2026-10-01' }).global_status, 'En préparation');
  assert.equal(applyAutomaticShipmentStatus({ global_status: 'En préparation', mode: 'Sea', orly_scan_date: '2026-10-01' }).global_status, 'En préparation');
  // À VÉRIFIER : en maritime, une ETD (date de départ *estimée*) suffit à passer
  // « Expédiée vers Mada », même si le navire n'est pas encore parti.
  assert.equal(applyAutomaticShipmentStatus({ global_status: 'En préparation', mode: 'Sea', etd: '2026-12-01' }).global_status, 'Expédiée vers Mada');
  // Bloquée douane reste manuel
  assert.equal(applyAutomaticShipmentStatus({ global_status: 'Bloquée douane', mode: 'Air', orly_scan_date: '2026-10-01' }).global_status, 'Bloquée douane');
});

test('libellés de statut colis par hub', () => {
  assert.equal(parcelStatusLabel('received'), 'Reçu à Orly');
  assert.equal(parcelStatusLabel('lost', 'ROUEN'), 'Perdu avant Rouen');
  assert.equal(parcelStatusLabel('search', 'ROUEN'), 'Avis de recherche');
});

test('validation d’un colis', () => {
  assert.deepEqual(validateParcelInput(null), { value: null, errors: ['Colis invalide.'] });
  const empty = validateParcelInput({});
  assert.deepEqual(empty.errors, []);
  assert.deepEqual(empty.value, {
    tracking_number: null,
    carrier: 'UNKNOWN',
    carrier_name: null,
    expected_delivery: null,
    notes: null,
    destination: 'ORLY',
    description: null,
    packing_info: null,
    volume_m3: null,
    delivery_type: null,
  });
  const full = validateParcelInput({
    carrier_name: '  UPS  ',
    expected_delivery: '2026-10-10',
    notes: '  fragile ',
    destination: 'ROUEN',
    volume_m3: 1.23456,
    delivery_type: 'Enlèvement à prévoir',
  });
  assert.deepEqual(full.errors, []);
  assert.equal(full.value?.carrier_name, 'UPS');
  assert.equal(full.value?.notes, 'fragile');
  assert.equal(full.value?.volume_m3, 1.235);
  assert.equal(full.value?.destination, 'ROUEN');

  const bad = validateParcelInput({
    expected_delivery: '10/10/2026',
    destination: 'LYON',
    volume_m3: -1,
    delivery_type: 'Drone',
    carrier_name: 'x'.repeat(101),
  });
  assert.equal(bad.value, null);
  assert.deepEqual(bad.errors, [
    'Transporteur invalide.',
    'Date de livraison prévue invalide.',
    'Destination invalide (Orly ou Rouen).',
    'Volume invalide.',
    'Type de livraison invalide.',
  ]);
});
