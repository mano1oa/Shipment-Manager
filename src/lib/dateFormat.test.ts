import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDateDesc, formatDate, formatDateTime } from './dateFormat.js';

test('affichage JJ-MM-AAAA', () => {
  assert.equal(formatDate('2026-10-21'), '21-10-2026');
  assert.equal(formatDate(' 2026-10-21 '), '21-10-2026');
  assert.equal(formatDate('2026-10-21 14:05'), '21-10-2026 14:05');
  // Horodatage ISO : date locale (midi UTC = même jour dans tous les fuseaux courants)
  assert.equal(formatDate('2026-10-21T12:00:00Z'), '21-10-2026');
  assert.equal(formatDate('Non parti'), 'Non parti');
  assert.equal(formatDate('2026-13-45T00:00:00Z'), '2026-13-45T00:00:00Z'); // illisible : rendu tel quel
  assert.equal(formatDate(''), '—');
  assert.equal(formatDate('   '), '—');
  assert.equal(formatDate(null, 'N/A'), 'N/A');
  assert.equal(formatDate(undefined), '—');
});

test('affichage date et heure', () => {
  assert.equal(formatDateTime(new Date(2026, 9, 21, 14, 5)), '21-10-2026 14:05');
  assert.equal(formatDateTime(new Date(2026, 0, 2, 3, 4).toISOString()), '02-01-2026 03:04');
  assert.equal(formatDateTime('pas une date'), '—');
  assert.equal(formatDateTime(null, 'N/A'), 'N/A');
});

test('tri « plus récent d’abord », dates absentes à la fin', () => {
  const list = ['2026-10-01', null, '2026-11-05', 'Non parti', '2026-10-15T08:00:00Z', undefined, '2026-11-05'];
  assert.deepEqual([...list].sort(compareDateDesc), [
    '2026-11-05',
    '2026-11-05',
    '2026-10-15T08:00:00Z',
    '2026-10-01',
    null,
    'Non parti',
    undefined,
  ]);
  assert.equal(compareDateDesc(null, 'Non parti'), 0);
});
