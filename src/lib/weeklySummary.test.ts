import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeeklySummary, summaryDateLabel, weeklySummaryMessage } from './weeklySummary.js';
import type { SummaryParcel, SummaryShipment } from './weeklySummary.js';

const parcel = (status: string, extra: Partial<SummaryParcel> = {}): SummaryParcel => ({
  status,
  destination: 'ORLY',
  expected_delivery: null,
  shipment_ids: [],
  ...extra,
});

const shipments: SummaryShipment[] = [
  { id: 'air', global_status: 'Expédiée vers Mada', customs_status: 'Non Requis' },
  { id: 'sea', global_status: 'Expédiée vers Mada', customs_status: 'Non Requis' },
  { id: 'prep', global_status: 'En préparation', customs_status: 'Non Requis' },
  { id: 'customs', global_status: 'Bloquée douane', customs_status: 'Bloqué Douane' },
  { id: 'done', global_status: 'Livrée entrepôt', customs_status: 'Dédouané' },
];
const values: Record<string, number> = { air: 1000.4, sea: 2500, prep: 99, customs: 400, done: 7 };

test('point hebdo : comptes par étape', () => {
  const s = computeWeeklySummary(
    [
      parcel('to_receive', { expected_delivery: '2026-11-10' }),
      parcel('to_receive', { expected_delivery: '2026-11-16' }),
      parcel('to_receive'),
      parcel('received', { shipment_ids: ['prep'] }),
      parcel('received', { destination: 'ROUEN' }),
      parcel('received', { shipment_ids: ['air'] }),
      parcel('received', { destination: 'ROUEN', shipment_ids: ['customs'] }),
      parcel('received', { shipment_ids: ['done'] }),
      parcel('lost'),
      parcel('search'),
    ],
    shipments,
    (sh) => values[sh.id],
    '2026-11-16'
  );
  assert.deepEqual(s, {
    toHub: 3,
    late: 1,
    atHubOrly: 1,
    atHubRouen: 1,
    toMada: 2,
    valueInTransit: 3500,
    lost: 1,
    search: 1,
    customsBlocked: 1,
  });
});

test('point hebdo : message', () => {
  const text = weeklySummaryMessage(
    { toHub: 31, late: 4, atHubOrly: 14, atHubRouen: 6, toMada: 12, valueInTransit: 184320, lost: 2, search: 1, customsBlocked: 1 },
    'lundi 16 novembre'
  );
  const lines = text.split('\n');
  assert.equal(lines[0], '*Point hebdo Shipment Manager — lundi 16 novembre*');
  assert.equal(lines[1], '• 31 colis attendus des fournisseurs (dont 4 en retard)');
  assert.equal(lines[2], '• 20 au hub (Orly 14 · Rouen 6)');
  assert.match(lines[3], /^• 12 en route vers Madagascar · valeur 184\s320\s€$/);
  assert.equal(lines[4], '• 2 perdus, 1 avis de recherche');
  assert.equal(lines[5], '• 1 expédition bloquée en douane');

  const empty = weeklySummaryMessage(
    { toHub: 1, late: 0, atHubOrly: 0, atHubRouen: 0, toMada: 0, valueInTransit: 0, lost: 0, search: 0, customsBlocked: 0 },
    'lundi 16 novembre'
  ).split('\n');
  assert.equal(empty[1], '• 1 colis attendu des fournisseurs');
  assert.equal(empty[3], '• 0 en route vers Madagascar');
  assert.equal(empty[4], '• Aucun colis perdu ni avis de recherche');
  assert.equal(empty[5], '• Aucune expédition bloquée en douane');
});

test('point hebdo : date en heure de Madagascar', () => {
  // Monday 05:30 UTC = 08:30 in Antananarivo
  assert.equal(summaryDateLabel(new Date('2026-11-16T05:30:00Z')), 'lundi 16 novembre');
});
