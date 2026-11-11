import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from './exportCsv';

test('toCsv: ";" separator, French decimals, empty cells', () => {
  assert.equal(toCsv(['A', 'B', 'C'], [[1.5, null, 'x']]), 'A;B;C\r\n1,5;;x');
});

test('toCsv: quotes cells holding ";", quotes or line breaks', () => {
  assert.equal(toCsv(['A'], [['a;b'], ['dit "oui"'], ['l1\nl2']]), 'A\r\n"a;b"\r\n"dit ""oui"""\r\n"l1\nl2"');
});
