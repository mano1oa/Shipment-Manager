import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDaysBetween, calculateDepartureMadagascar, calculateEtaMadaSDu, evaluateShipmentRules } from './rulesEngine.js';
import type { Shipment } from '../types';

// Le moteur lit la date du jour lui-même : horloge figée, restaurée par t.mock.
const NOW = '2026-11-11T12:00:00Z'; // mercredi
const freeze = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: new Date(NOW) });

const ship = (over: Partial<Shipment> = {}): Shipment =>
  ({
    id: 'S1',
    mode: 'Air',
    global_status: 'Expédiée vers Mada',
    customs_status: 'Non Requis',
    carrier_status: '',
    tracking_no: 'T1',
    order_reference: 'CMD-1',
    carrier: 'UPS',
    carrier_last_location: 'Paris',
    eta: '',
    created_at: '2026-11-10T12:00:00Z',
    ...over,
  }) as Shipment;

const codes = (s: Shipment) => evaluateShipmentRules([s]).allAlerts.map((a) => a.rule_code);

test('ETA MADA S du : lundi suivant (lun–jeu), lundi d’après (ven–dim)', () => {
  assert.equal(calculateEtaMadaSDu('2026-11-02'), '2026-11-09'); // lundi
  assert.equal(calculateEtaMadaSDu('2026-11-05'), '2026-11-09'); // jeudi
  assert.equal(calculateEtaMadaSDu('2026-11-06'), '2026-11-16'); // vendredi
  assert.equal(calculateEtaMadaSDu('2026-11-07'), '2026-11-16'); // samedi
  assert.equal(calculateEtaMadaSDu('2026-11-08'), '2026-11-16'); // dimanche
  assert.equal(calculateEtaMadaSDu('2026-12-31'), '2027-01-04'); // changement d'année
  assert.equal(calculateEtaMadaSDu(' 2026-11-02 '), '2026-11-09');
  assert.equal(calculateEtaMadaSDu('2026-11-02T10:00:00Z'), '2026-11-09'); // horodatage : jour lu tel quel
  assert.equal(calculateEtaMadaSDu(''), 'Non parti');
  assert.equal(calculateEtaMadaSDu(undefined), 'Non parti');
  assert.equal(calculateEtaMadaSDu('02/11/2026'), 'Non parti');
  assert.equal(calculateEtaMadaSDu('aaaa-bb-cc'), 'Non parti');
});

test('départ Madagascar : samedi suivant le scan Orly', () => {
  assert.equal(calculateDepartureMadagascar('2026-11-02'), '2026-11-07');
  assert.equal(calculateDepartureMadagascar('2026-11-06'), '2026-11-07');
  // Scan un samedi : départ le jour même (pas le samedi d'après)
  assert.equal(calculateDepartureMadagascar('2026-11-07'), '2026-11-07');
  assert.equal(calculateDepartureMadagascar('2026-11-08'), '2026-11-14');
  assert.equal(calculateDepartureMadagascar(''), 'Non parti');
  assert.equal(calculateDepartureMadagascar('2026-11'), 'Non parti');
  // SUSPECT : une date impossible n'est pas refusée, elle « déborde »
  // (30-02-2026 lu comme 02-03-2026) au lieu de donner "Non parti".
  assert.equal(calculateDepartureMadagascar('2026-02-30'), '2026-03-07');
  assert.equal(calculateEtaMadaSDu('2026-02-30'), '2026-03-09');
});

test('écart en jours entre deux dates', () => {
  assert.equal(calculateDaysBetween('2026-11-01', '2026-11-11'), 10);
  assert.equal(calculateDaysBetween('2026-11-01T18:00:00Z', '2026-11-02T06:00:00Z'), 0); // jours entiers, arrondi bas
  // SUSPECT (mineur) : écart en valeur absolue, une date dans le futur compte
  // comme du passé (voir le test R1 plus bas).
  assert.equal(calculateDaysBetween('2026-11-11', '2026-11-01'), 10);
  assert.equal(calculateDaysBetween('', '2026-11-01'), 0);
  assert.equal(calculateDaysBetween('pas une date', '2026-11-01'), 0);
});

test('écart en jours jusqu’à aujourd’hui', (t) => {
  freeze(t);
  assert.equal(calculateDaysBetween('2026-11-01'), 10);
  assert.equal(calculateDaysBetween('2026-11-01T12:00:01Z'), 9);
});

test('aucune expédition, aucune alerte', (t) => {
  freeze(t);
  assert.deepEqual(evaluateShipmentRules([]), { shipmentsWithAlerts: [], allAlerts: [] });
  const res = evaluateShipmentRules([ship()]);
  assert.deepEqual(res.allAlerts, []);
  assert.deepEqual(res.shipmentsWithAlerts[0].alerts, []);
});

test('R0 expédition de l’ancien modèle à revoir', (t) => {
  freeze(t);
  const [a] = evaluateShipmentRules([ship({ needs_review: true, global_status: 'En préparation', legacy_global_status: null })]).allAlerts;
  assert.equal(a.rule_code, 'R0_LEGACY_REVIEW');
  assert.equal(a.id, 'ALT-REVIEW-S1');
  assert.equal(a.created_at, '2026-11-11');
  assert.match(a.reason, /ancien statut : non défini/);
  assert.deepEqual(codes(ship({ needs_review: true, global_status: 'Expédiée vers Mada' })), []);
});

test('R1 aérien en préparation depuis 10 jours ou plus', (t) => {
  freeze(t);
  const prep = (over: Partial<Shipment>) => ship({ global_status: 'En préparation', ...over });
  const [a] = evaluateShipmentRules([prep({ created_at: '2026-11-01T12:00:00Z', ref_fa_digi_nxt: 'FA-9' })]).allAlerts;
  assert.equal(a.rule_code, 'R1_HUB_ORLY_TIMEOUT');
  assert.equal(a.severity, 'critical');
  assert.equal(a.id, 'ALT-ORLY-S1');
  assert.equal(a.reason, 'En préparation depuis 10 jours sans départ vers Madagascar.');
  assert.match(a.relance_draft!, /Réf FA: FA-9\n- LTA: N\/A/);
  // 9 jours et 23 h 59 : pas encore
  assert.deepEqual(codes(prep({ created_at: '2026-11-01T12:00:01Z' })), []);
  assert.deepEqual(codes(prep({ created_at: '2026-11-01T12:00:00Z', mode: 'Sea' })), []);
  assert.deepEqual(codes(prep({ created_at: '2026-10-01T12:00:00Z', global_status: 'Expédiée vers Mada' })), []);
  // À revoir : R0 seulement, pas R1
  assert.deepEqual(codes(prep({ created_at: '2026-10-01T12:00:00Z', needs_review: true })), ['R0_LEGACY_REVIEW']);
  // SUSPECT (mineur) : date de création dans le futur (horloge décalée, saisie)
  // → l'écart absolu déclenche quand même l'alerte.
  assert.deepEqual(codes(prep({ created_at: '2026-11-21T12:00:00Z' })), ['R1_HUB_ORLY_TIMEOUT']);
});

test('R3 blocage douane', (t) => {
  freeze(t);
  assert.deepEqual(codes(ship({ customs_status: 'Bloqué Douane' })), ['R3_CUSTOMS_BLOCKED']);
  assert.deepEqual(codes(ship({ global_status: 'Bloquée douane' })), ['R3_CUSTOMS_BLOCKED']);
  assert.deepEqual(codes(ship({ customs_status: 'En cours' })), []);
  // SUSPECT : une expédition livrée dont le statut douane est resté « Bloqué Douane »
  // garde l'alerte douane.
  assert.deepEqual(codes(ship({ customs_status: 'Bloqué Douane', global_status: 'Livrée entrepôt' })), ['R3_CUSTOMS_BLOCKED']);
});

test('R4 ETA transporteur dépassée', (t) => {
  freeze(t);
  const [a] = evaluateShipmentRules([ship({ eta: '2026-11-08' })]).allAlerts;
  assert.equal(a.rule_code, 'R4_CARRIER_ETA_OVERDUE');
  assert.equal(a.severity, 'warning');
  assert.equal(a.reason, 'L’ETA (08-11-2026) est dépassée de 3 jour(s) sans livraison confirmée.');
  assert.match(a.relance_draft!, /Ref: CMD-1 \(UPS\)/);
  assert.deepEqual(codes(ship({ eta: '2026-11-10' })), ['R4_CARRIER_ETA_OVERDUE']);
  assert.deepEqual(codes(ship({ eta: '2026-11-11' })), []); // ETA aujourd'hui
  assert.deepEqual(codes(ship({ eta: '2026-11-20' })), []);
  assert.deepEqual(codes(ship({ eta: '2026-11-08', carrier_status: 'Delivered' as Shipment['carrier_status'] })), []);
  assert.deepEqual(codes(ship({ eta: '2026-11-08', global_status: 'Livrée entrepôt' })), []);
  assert.deepEqual(codes(ship({ eta: 'Non parti' })), []);
});

test('plusieurs règles et plusieurs expéditions', (t) => {
  freeze(t);
  const res = evaluateShipmentRules([
    ship({ id: 'A', global_status: 'Bloquée douane', eta: '2026-11-01' }),
    ship({ id: 'B' }),
    ship({ id: 'C', global_status: 'En préparation', created_at: '2026-10-01T00:00:00Z' }),
  ]);
  assert.deepEqual(
    res.allAlerts.map((a) => a.id),
    ['ALT-CUST-A', 'ALT-ETA-A', 'ALT-ORLY-C']
  );
  assert.deepEqual(
    res.shipmentsWithAlerts.map((s) => s.alerts?.length),
    [2, 0, 1]
  );
});

test('valueOf n’est jamais appelé', (t) => {
  freeze(t);
  // SUSPECT : le paramètre valueOf (valeur DIGI dans les messages de réclamation)
  // n'est plus utilisé depuis la suppression de la règle « Perdu Orly ».
  let calls = 0;
  evaluateShipmentRules(
    [ship({ customs_status: 'Bloqué Douane', eta: '2026-11-01', global_status: 'En préparation', created_at: '2026-10-01' })],
    () => {
      calls++;
      return 0;
    }
  );
  assert.equal(calls, 0);
});
