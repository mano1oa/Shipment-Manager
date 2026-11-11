import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  carrierSlas,
  hubDepartureDate,
  madaArrivalDate,
  meanTransitDays,
  parcelCarrierSlas,
  promisedDate,
  shipmentSla,
  summarizeSla,
} from './carrierSla.js';
import type { ShipmentSla } from './carrierSla.js';
import type { Shipment } from '../types';

const ship = (over: Partial<Shipment>): Shipment =>
  ({ id: 'S1', mode: 'Air', global_status: 'Expédiée vers Mada', ...over }) as Shipment;

// Scan Orly lundi 02-11-2026 → ETA MADA S du lundi 09-11-2026
const air = (over: Partial<Shipment> = {}) => ship({ orly_scan_date: '2026-11-02', ...over });

test('date promise : aérien = ETA MADA S du, maritime = ETA arrivée Madagascar', () => {
  assert.equal(promisedDate(air()), '2026-11-09');
  assert.equal(promisedDate(ship({ orly_scan_date: undefined })), null); // "Non parti"
  assert.equal(promisedDate(ship({ mode: 'Sea', arrival_madagascar_eta: '2026-10-01T00:00:00Z' })), '2026-10-01');
  assert.equal(promisedDate(ship({ mode: 'Sea', arrival_madagascar_eta: 'à confirmer' })), null);
});

test('date d’arrivée : priorité selon le mode', () => {
  const both = { mada_receipt_date: '2026-11-10', actual_arrival_date: '2026-11-12' };
  assert.equal(madaArrivalDate(ship({ mode: 'Air', ...both })), '2026-11-10');
  assert.equal(madaArrivalDate(ship({ mode: 'Sea', ...both })), '2026-11-12');
  assert.equal(madaArrivalDate(ship({ mode: 'Air', actual_arrival_date: '2026-11-12' })), '2026-11-12');
  assert.equal(madaArrivalDate(ship({ mode: 'Sea' })), null);
});

test('SLA : tolérance incluse (promis + tolérance = à temps)', () => {
  // promis 09-11, tolérance 2 → limite 11-11
  const onTime = shipmentSla(air({ mada_receipt_date: '2026-11-11' }), 2, '2026-12-01');
  assert.equal(onTime?.outcome, 'on_time');
  assert.equal(onTime?.delayDays, 2); // retard compté depuis la date promise, pas depuis la limite
  const late = shipmentSla(air({ mada_receipt_date: '2026-11-12' }), 2, '2026-12-01');
  assert.equal(late?.outcome, 'late');
  assert.equal(late?.delayDays, 3);
  // Tolérance 0 : un jour après la promesse = en retard
  assert.equal(shipmentSla(air({ mada_receipt_date: '2026-11-10' }), 0, '2026-12-01')?.outcome, 'late');
  // En avance : délai négatif
  assert.equal(shipmentSla(air({ mada_receipt_date: '2026-11-07' }), 2, '2026-12-01')?.delayDays, -2);
});

test('SLA : en retard sur la route seulement après la limite', () => {
  assert.equal(shipmentSla(air(), 2, '2026-11-11'), null); // limite le jour même : pas encore
  const lit = shipmentSla(air(), 2, '2026-11-12');
  assert.equal(lit?.outcome, 'late_in_transit');
  assert.equal(lit?.arrival, null);
  assert.equal(lit?.delayDays, 3);
  assert.equal(shipmentSla(air({ global_status: 'Bloquée douane' }), 2, '2026-11-20')?.outcome, 'late_in_transit');
  // Livrée sans date d'arrivée : non mesurable
  assert.equal(shipmentSla(air({ global_status: 'Livrée entrepôt' }), 2, '2026-11-20'), null);
});

test('SLA : non mesurable (pas partie, pas de promesse)', () => {
  assert.equal(shipmentSla(air({ global_status: 'En préparation', mada_receipt_date: '2026-11-20' }), 2, '2026-12-01'), null);
  assert.equal(shipmentSla(ship({ mada_receipt_date: '2026-11-20' }), 2, '2026-12-01'), null);
  assert.equal(shipmentSla(ship({ mode: 'Sea', actual_arrival_date: '2026-11-20' }), 2, '2026-12-01'), null);
});

test('carrierSlas : ne garde que les mesurables', () => {
  assert.deepEqual(carrierSlas([], 2, '2026-12-01'), []);
  const list = carrierSlas(
    [
      air({ id: 'A', mada_receipt_date: '2026-11-10' }),
      air({ id: 'B', global_status: 'En préparation' }),
      air({ id: 'C' }),
      ship({ id: 'D', mode: 'Sea', arrival_madagascar_eta: '2026-10-01', actual_arrival_date: '2026-10-05' }),
    ],
    2,
    '2026-12-01'
  );
  assert.deepEqual(
    list.map((x) => [x.shipment.id, x.outcome]),
    [
      ['A', 'on_time'],
      ['C', 'late_in_transit'],
      ['D', 'late'],
    ]
  );
});

test('summarizeSla : taux et retard moyen', () => {
  const empty = summarizeSla([]);
  assert.deepEqual(empty, { measured: 0, onTime: 0, late: 0, lateInTransit: 0, rate: null, meanDelay: null });

  const item = (outcome: ShipmentSla['outcome'], delayDays: number) => ({ outcome, delayDays }) as ShipmentSla;
  const sum = summarizeSla([item('on_time', 2), item('late', 3), item('late_in_transit', 6)]);
  assert.equal(sum.measured, 3);
  assert.equal(sum.onTime, 1);
  assert.equal(sum.late, 1);
  assert.equal(sum.lateInTransit, 1);
  assert.equal(sum.rate, 33);
  assert.equal(sum.meanDelay, 4.5); // retards seulement (le "à temps" à +2 ne compte pas)
  assert.equal(summarizeSla([item('on_time', 0), item('on_time', 1)]).meanDelay, null);
  assert.equal(summarizeSla([item('on_time', 0), item('late', 5)]).rate, 50);
  // arrondi à 1 décimale
  assert.equal(summarizeSla([item('late', 3), item('late', 3), item('late', 4)]).meanDelay, 3.3);
});

test('départ du hub : réel, sinon ETD, sinon scan Orly', () => {
  assert.equal(hubDepartureDate(ship({ departure_madagascar: '2026-11-07', etd: '2026-11-05', orly_scan_date: '2026-11-02' })), '2026-11-07');
  assert.equal(hubDepartureDate(ship({ departure_madagascar: 'Non parti', etd: '2026-11-05' })), '2026-11-05');
  assert.equal(hubDepartureDate(ship({ orly_scan_date: '2026-11-02' })), '2026-11-02');
  assert.equal(hubDepartureDate(ship({})), null);
});

test('transit moyen hub → Madagascar par mode', () => {
  assert.deepEqual(meanTransitDays([], 'Air'), { days: null, count: 0 });
  const res = meanTransitDays(
    [
      ship({ departure_madagascar: '2026-11-07', mada_receipt_date: '2026-11-12' }), // 5 j
      // SUSPECT : sans départ saisi, l'aérien part de la date de scan Orly et non
      // du samedi calculé (calculateDepartureMadagascar) → transit gonflé.
      ship({ orly_scan_date: '2026-11-02', mada_receipt_date: '2026-11-12' }), // 10 j
      ship({ departure_madagascar: '2026-11-12', mada_receipt_date: '2026-11-10' }), // négatif : ignoré
      ship({ departure_madagascar: '2026-11-07' }), // pas d'arrivée : ignoré
      ship({ mode: 'Sea', etd: '2026-09-01', actual_arrival_date: '2026-10-01' }), // autre mode
    ],
    'Air'
  );
  assert.deepEqual(res, { days: 7.5, count: 2 });
  assert.deepEqual(meanTransitDays([ship({ mode: 'Sea', etd: '2026-09-01', actual_arrival_date: '2026-10-01' })], 'Sea'), {
    days: 30,
    count: 1,
  });
});

type P = Parameters<typeof parcelCarrierSlas>[0][number];
const parcel = (over: Partial<P>): P => ({
  carrier: 'UPS',
  carrier_name: null,
  destination: 'ORLY',
  status: 'received',
  expected_delivery: null,
  received_at: null,
  ...over,
});

test('SLA fournisseur → hub par transporteur', () => {
  assert.deepEqual(parcelCarrierSlas([], (p) => p.carrier), []);
  const res = parcelCarrierSlas(
    [
      parcel({ expected_delivery: '2026-10-01', received_at: '2026-10-01' }), // à temps
      parcel({ expected_delivery: '2026-10-01', received_at: '2026-09-28' }), // en avance
      parcel({ expected_delivery: '2026-10-01', received_at: '2026-10-04', destination: 'ROUEN' }), // +3
      parcel({ expected_delivery: '2026-10-01', received_at: '2026-10-06T08:00:00Z', destination: 'ROUEN' }), // +5
      parcel({ status: 'lost', expected_delivery: '2026-10-01', destination: 'ROUEN' }),
      parcel({ received_at: '2026-10-02' }), // pas de date prévue : non mesuré
      parcel({ carrier: 'GLS', status: 'lost' }),
      parcel({ carrier: 'DHL', status: 'to_receive', expected_delivery: '2026-10-01' }),
      parcel({ carrier: 'CHRONO', expected_delivery: '2026-10-01', received_at: '2026-10-02', destination: 'ROUEN' }),
    ],
    (p) => p.carrier
  );
  assert.deepEqual(
    res.map((x) => x.carrier),
    ['UPS', 'CHRONO', 'GLS'] // DHL (rien de mesuré ni perdu) écarté ; tri par nombre mesuré
  );
  const ups = res[0];
  assert.equal(ups.measured, 4);
  assert.equal(ups.onTime, 2);
  assert.equal(ups.late, 2);
  assert.equal(ups.meanDelay, 4);
  assert.equal(ups.lost, 1);
  assert.equal(ups.rate, 50);
  assert.equal(ups.destination, 'ORLY'); // 3 Orly / 3 Rouen : égalité → Orly
  assert.equal(res[1].destination, 'ROUEN');
  assert.equal(res[1].rate, 0);
  const gls = res[2];
  assert.equal(gls.measured, 0);
  assert.equal(gls.rate, null);
  assert.equal(gls.meanDelay, null);
  assert.equal(gls.lost, 1);
});

test('SLA fournisseur → hub : regroupement par libellé', () => {
  const res = parcelCarrierSlas(
    [
      parcel({ carrier: 'UPS', carrier_name: 'UPS Express', expected_delivery: '2026-10-01', received_at: '2026-10-01' }),
      parcel({ carrier: 'UNKNOWN', carrier_name: 'UPS Express', expected_delivery: '2026-10-01', received_at: '2026-10-01' }),
    ],
    (p) => p.carrier_name || p.carrier
  );
  assert.equal(res.length, 1);
  assert.equal(res[0].carrier, 'UPS Express');
  assert.equal(res[0].measured, 2);
  assert.equal(res[0].rate, 100);
});
