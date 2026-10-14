export const DEFAULT_SETTINGS = { times: ['07:00', '19:00'], duration_seconds: 150 };
export const EMPTY_STATUS = { watering: false, started_at: null, last_finished_at: null, remaining_seconds: 0, duration_seconds: 0 };

export function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The app also works without browser storage. */ }
}

export function durationLabel(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return [minutes ? `${minutes} Min.` : '', rest ? `${rest} Sek.` : ''].filter(Boolean).join(' ') || '0 Sek.';
}

export function clockDuration(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function zurichParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
}

export function nextRun(times, now) {
  // Resolve local clock times in Zurich, including the DST change, rather than
  // treating tomorrow as a fixed 24 hours after today.
  const parts = zurichParts(now);
  const today = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  const candidates = [];
  for (let day = 0; day < 3; day += 1) {
    const date = new Date(today + day * 86400000);
    for (const time of times) {
      const [hour, minute] = time.split(':').map(Number);
      const desired = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
      let candidate = desired;
      for (let pass = 0; pass < 3; pass += 1) {
        const local = zurichParts(new Date(candidate));
        const represented = Date.UTC(+local.year, +local.month - 1, +local.day, +local.hour, +local.minute);
        candidate += desired - represented;
      }
      const occurrences = [-3600000, 0, 3600000].map((offset) => candidate + offset).filter((instant) => {
        const local = zurichParts(new Date(instant));
        return `${local.hour}:${local.minute}` === time && +local.day === date.getUTCDate();
      });
      // On the autumn clock change the controller runs a repeated local minute
      // once. Prefer its first occurrence, then move to the next schedule slot.
      const first = Math.min(...occurrences);
      if (Number.isFinite(first) && first > now.getTime()) candidates.push({ time, date: new Date(first) });
    }
  }
  return candidates.sort((a, b) => a.date - b.date)[0];
}

export function defaultApiUrl() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  const url = new URL(window.location.origin);
  url.port = '8080';
  return url.origin;
}

export function normalizeApiUrl(value) {
  const url = new URL(value.includes('://') ? value : `http://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Bitte eine gültige Adresse wie http://raspberrypi.local:8080 eingeben.');
  }
  return url.href.replace(/\/$/, '');
}

export async function jsonRequest(base, path, options = {}) {
  const response = await fetch(`${base}/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Die Anlage konnte die Anfrage nicht ausführen.');
  return data;
}

export async function apiRequest(base, path, options = {}) {
  const data = await jsonRequest(base, path, options);
  if (!data?.settings || typeof data?.status?.watering !== 'boolean') {
    throw new Error('Diese Adresse liefert keine Grünzeit-Steuerung. Bitte das Python-Backend aktualisieren.');
  }
  return data;
}
