import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildParcelHistory } from './parcelHistory.js';
import type { ParcelHistoryInput } from './parcelHistory.js';

const base: ParcelHistoryInput = {
  parcel: {
    status: 'received',
    destination: 'ORLY',
    status_changed_at: '2026-11-05T10:00:00.000Z',
    created_at: '2026-11-01T08:00:00.000Z',
    created_by_email: 'sourcing@x.fr',
    created_point_date: null,
  },
  receptions: [
    {
      received_at: '2026-11-05',
      received_by_email: 'sc@x.fr',
      point_date: '2026-11-05',
      photo_id: 'ph1',
      piece_number: null,
      box_index: null,
      created_at: '2026-11-05T10:00:00.000Z',
    },
  ],
  photos: [
    { id: 'ph1', uploaded_at: '2026-11-05T09:00:00.000Z', uploaded_by_email: 'sc@x.fr', point_date: '2026-11-05', linked_at: '2026-11-05T10:00:00.000Z', linked_by_email: 'sc@x.fr' },
  ],
  shipments: [{ label: 'AIR-12', invoice_refs: ['F1'], at: '2026-11-07T12:00:00.000Z' }],
  invoices: [{ id: 'inv1', ref: 'F1' }],
  audit: [
    { action: 'CREATE_PARCEL', details: { actor_email: 'sourcing@x.fr' }, created_at: '2026-11-01T08:00:01.000Z' },
    { action: 'LINK_POINT_PHOTO', details: { photo_id: 'ph1' }, created_at: '2026-11-05T10:00:01.000Z' },
    { action: 'RECEIVE_BOX', details: { photo_id: 'ph1', received_at: '2026-11-05' }, created_at: '2026-11-05T10:00:01.000Z' },
    { action: 'SET_PARCEL_STATUS', details: { from: 'received', to: 'search', actor_email: 'sc@x.fr' }, created_at: '2026-11-09T10:00:00.000Z' },
    { action: 'SET_PARCEL_STATUS', details: { from: 'search', to: 'received', actor_email: 'sc@x.fr' }, created_at: '2026-11-10T10:00:00.000Z' },
  ],
  boxes_expected: null,
};

test('historique : création, réception avec photo, expédition, avis de recherche', () => {
  const events = buildParcelHistory(base);
  assert.deepEqual(
    events.map((e) => e.title),
    [
      'Colis créé',
      'Réception confirmée à Orly le 05-11-2026',
      "Rattaché à l'expédition AIR-12",
      'Avis de recherche ouvert',
      'Avis de recherche levé : colis retrouvé',
    ]
  );
  // The photo of the box, shown once (not again as a photo apart)
  assert.equal(events[1].photo_id, 'ph1');
  assert.equal(events.filter((e) => e.photo_id === 'ph1').length, 1);
  assert.equal(events[3].by, 'sc@x.fr');
});

test('historique : réception sans photo non dupliquée, perte automatique', () => {
  const noPhoto = buildParcelHistory({
    ...base,
    receptions: [{ ...base.receptions[0], photo_id: null, point_date: null }],
    photos: [],
    audit: [{ action: 'SET_PARCEL_STATUS', details: { from: 'to_receive', to: 'received' }, created_at: '2026-11-05T10:00:00.500Z' }],
    shipments: [],
  });
  assert.equal(noPhoto.filter((e) => e.title.startsWith('Réception confirmée')).length, 1);

  // Lost before the per-parcel log: its current state only
  const lost = buildParcelHistory({ ...base, parcel: { ...base.parcel, status: 'lost' }, receptions: [], photos: [], audit: [], shipments: [] });
  assert.equal(lost.at(-1)?.title, 'Déclaré perdu avant Orly');
  assert.equal(lost.at(-1)?.by, 'automatique');

  // Logged per parcel: not shown twice
  const logged = buildParcelHistory({
    ...base,
    parcel: { ...base.parcel, status: 'lost' },
    receptions: [],
    photos: [],
    shipments: [],
    audit: [{ action: 'AUTO_MARK_PARCEL_LOST', details: { actor_email: 'alerte-automatique' }, created_at: '2026-11-05T10:00:00.100Z' }],
  });
  assert.equal(logged.filter((e) => e.tone === 'danger').length, 1);
});
