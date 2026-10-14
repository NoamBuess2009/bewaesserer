import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRun } from '../../src/lib.js';

const cases = [
  ['before morning', ['07:00', '19:00'], '2026-10-14T04:00:00Z', '2026-10-14T05:00:00Z'],
  ['before evening', ['07:00', '19:00'], '2026-10-14T10:00:00Z', '2026-10-14T17:00:00Z'],
  ['tomorrow', ['07:00', '19:00'], '2026-10-14T20:00:00Z', '2026-10-15T05:00:00Z'],
  ['missing spring hour', ['02:30', '19:00'], '2026-03-28T23:00:00Z', '2026-03-29T17:00:00Z'],
  ['first occurrence of repeated autumn hour', ['02:30', '19:00'], '2026-10-24T23:30:00Z', '2026-10-25T00:30:00Z'],
  ['repeated autumn hour already passed', ['02:30', '19:00'], '2026-10-25T00:45:00Z', '2026-10-25T18:00:00Z'],
];

for (const [name, times, now, expected] of cases) {
  test(`next Zurich watering: ${name}`, () => {
    assert.equal(nextRun(times, new Date(now)).date.toISOString(), new Date(expected).toISOString());
  });
}
