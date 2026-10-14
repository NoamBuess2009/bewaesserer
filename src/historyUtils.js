import { zurichParts } from './lib.js';

const FINISHED = new Set(['completed', 'stopped', 'restarted', 'shutdown']);

function localDate(date) {
  const parts = zurichParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function midnight(date) {
  const desired = Date.parse(`${date}T00:00:00Z`);
  let instant = desired;
  for (let i = 0; i < 3; i += 1) {
    const parts = zurichParts(new Date(instant));
    instant += desired - Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  }
  return instant;
}

export function validDemoHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && (typeof entry.id === 'number' || typeof entry.id === 'string') &&
    Number.isFinite(Date.parse(entry.started_at)) && ['manual', 'schedule'].includes(entry.source) &&
    (FINISHED.has(entry.outcome) || ['running', 'interrupted'].includes(entry.outcome)) &&
    Number.isInteger(entry.planned_duration_seconds) && entry.planned_duration_seconds > 0 &&
    (entry.actual_duration_seconds === null || (typeof entry.actual_duration_seconds === 'number' && Number.isFinite(entry.actual_duration_seconds) && entry.actual_duration_seconds >= 0)));
}

export function demoStatistics(entries, now, days) {
  const today = Date.parse(`${localDate(now)}T12:00:00Z`);
  const daily = Array.from({ length: days }, (_, index) => ({
    date: new Date(today - (days - index - 1) * 86400000).toISOString().slice(0, 10),
    count: 0, duration_seconds: 0, manual_seconds: 0, schedule_seconds: 0,
  }));
  const bounds = daily.map((day) => {
    const tomorrow = new Date(Date.parse(`${day.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    return [midnight(day.date), midnight(tomorrow)];
  });
  const finished = entries.filter((entry) => FINISHED.has(entry.outcome) && entry.actual_duration_seconds !== null);
  for (const entry of finished) {
    const start = Date.parse(entry.started_at);
    const end = start + entry.actual_duration_seconds * 1000;
    daily.forEach((day, index) => {
      const [lower, upper] = bounds[index];
      if (start >= lower && start < upper) day.count += 1;
      const duration = Math.max(0, Math.min(end, upper) - Math.max(start, lower)) / 1000;
      day.duration_seconds += duration;
      day[`${entry.source}_seconds`] += duration;
    });
  }
  const count = daily.reduce((sum, day) => sum + day.count, 0);
  const duration = daily.reduce((sum, day) => sum + day.duration_seconds, 0);
  const total = finished.reduce((sum, entry) => sum + entry.actual_duration_seconds, 0);
  const startedInPeriod = finished.filter((entry) => Date.parse(entry.started_at) >= bounds[0][0] && Date.parse(entry.started_at) < bounds.at(-1)[1]);
  const periodRunDuration = startedInPeriod.reduce((sum, entry) => sum + entry.actual_duration_seconds, 0);
  return {
    days, timezone: 'Europe/Zurich',
    today: { count: daily.at(-1).count, duration_seconds: daily.at(-1).duration_seconds },
    period: { count, duration_seconds: duration, average_duration_seconds: count ? periodRunDuration / count : 0 },
    total: { count: finished.length, duration_seconds: total, average_duration_seconds: finished.length ? total / finished.length : 0,
      unknown_duration_count: entries.filter((entry) => entry.outcome === 'interrupted').length },
    daily,
  };
}

export function demoPage(entries, statistics, source, limit) {
  const first = statistics.daily[0].date;
  const last = statistics.daily.at(-1).date;
  const filtered = entries.filter((entry) => {
    const date = localDate(new Date(entry.started_at));
    return date >= first && date <= last && (!source || source === 'all' || entry.source === source);
  }).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || Number(b.id) - Number(a.id));
  return { entries: filtered.slice(0, limit), total: filtered.length, limit, offset: 0 };
}

export function demoCsv(entries) {
  const headers = ['Beginn', 'Ende', 'Geplante Dauer (Sekunden)', 'Tatsächliche Dauer (Sekunden)', 'Auslöser', 'Ergebnis'];
  const outcomes = { running: 'Läuft', completed: 'Automatisch beendet', stopped: 'Gestoppt', restarted: 'Neu gestartet',
    shutdown: 'Dienst beendet', interrupted: 'Unterbrochen – Dauer unbekannt' };
  function localTimestamp(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    const date = new Date(value);
    const parts = zurichParts(date);
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const offset = Math.round((local - Math.floor(date.getTime() / 1000) * 1000) / 60000);
    const sign = offset >= 0 ? '+' : '-';
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${hours}:${minutes}`;
  }
  const rows = entries.map((entry) => [localTimestamp(entry.started_at), localTimestamp(entry.ended_at), entry.planned_duration_seconds,
    entry.actual_duration_seconds === null ? '' : entry.actual_duration_seconds,
    entry.source === 'schedule' ? 'Zeitplan' : 'Manuell', outcomes[entry.outcome]]);
  return '\ufeff' + [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\r\n');
}
