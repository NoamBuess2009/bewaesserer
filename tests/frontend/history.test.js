import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoCsv, demoPage, demoStatistics, validDemoHistory } from '../../src/historyUtils.js';

function run(id, start, duration, source = 'manual', outcome = 'stopped') {
  return { id, started_at: start, ended_at: duration === null ? null : new Date(Date.parse(start) + duration * 1000).toISOString(),
    planned_duration_seconds: 150, actual_duration_seconds: duration, source, outcome };
}

test('demo totals include actual completed runs and exclude unknown or running durations', () => {
  const records = [run(1, '2026-10-14T07:00:00+02:00', 12), run(2, '2026-10-14T19:00:00+02:00', 150, 'schedule', 'completed'),
    run(3, '2026-10-14T20:00:00+02:00', null, 'manual', 'interrupted'), run(4, '2026-10-14T20:30:00+02:00', null, 'manual', 'running')];
  const stats = demoStatistics(records, new Date('2026-10-14T21:00:00+02:00'), 7);
  assert.equal(stats.today.duration_seconds, 162);
  assert.equal(stats.period.count, 2);
  assert.equal(stats.period.average_duration_seconds, 81);
  assert.equal(stats.total.unknown_duration_count, 1);
  assert.equal(stats.daily.at(-1).manual_seconds, 12);
  assert.equal(stats.daily.at(-1).schedule_seconds, 150);
});

test('demo splits elapsed time at Zurich midnight and across the DST switch', () => {
  const records = [run(1, '2026-10-24T23:59:30+02:00', 90), run(2, '2026-10-25T02:30:00+02:00', 3600)];
  const stats = demoStatistics(records, new Date('2026-10-25T12:00:00+01:00'), 7);
  assert.equal(stats.daily.at(-2).duration_seconds, 30);
  assert.equal(stats.today.duration_seconds, 3660);
  assert.equal(stats.period.duration_seconds, 3690);
  assert.equal(stats.period.count, 2);
});

test('demo history filters by local calendar date/source and preserves pagination totals', () => {
  const records = [run(1, '2026-10-14T07:00:00+02:00', 20), run(2, '2026-10-14T19:00:00+02:00', 30),
    run(3, '2026-10-14T20:00:00+02:00', 40, 'schedule'), run(4, '2026-01-01T07:00:00+01:00', 50)];
  const stats = demoStatistics(records, new Date('2026-10-14T21:00:00+02:00'), 7);
  const page = demoPage(records, stats, 'manual', 1);
  assert.equal(page.total, 2);
  assert.equal(page.entries[0].id, 2);
  assert.equal(stats.total.count, 4);
  assert.equal(stats.period.count, 3);
});

test('average measures full runs started in the period, without carry-in time', () => {
  const records = [run(1, '2026-10-13T23:59:30+02:00', 120), run(2, '2026-10-14T07:00:00+02:00', 10)];
  const stats = demoStatistics(records, new Date('2026-10-14T12:00:00+02:00'), 1);
  assert.equal(stats.period.duration_seconds, 100);
  assert.equal(stats.period.count, 1);
  assert.equal(stats.period.average_duration_seconds, 10);
});

test('demo CSV includes actual seconds, unknown durations as empty, and German labels', () => {
  const csv = demoCsv([run(1, '2026-10-14T07:00:00+02:00', 12), run(2, '2026-10-14T19:00:00+02:00', null, 'schedule', 'interrupted')]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"150";"12";"Manuell";"Gestoppt"'));
  assert.ok(csv.includes('"150";"";"Zeitplan";"Unterbrochen – Dauer unbekannt"'));
  assert.ok(csv.includes('2026-10-14T07:00:00+02:00'));
});

test('invalid browser storage cannot create fictitious history records', () => {
  assert.deepEqual(validDemoHistory(null), []);
  assert.deepEqual(validDemoHistory([null, {}, { ...run(1, '2026-10-14T07:00:00Z', 1), started_at: 'bad-date' }, run(2, '2026-10-14T07:00:00Z', -1)]), []);
  const valid = run(3, '2026-10-14T07:00:00Z', 0.5);
  assert.deepEqual(validDemoHistory([valid]), [valid]);
});
