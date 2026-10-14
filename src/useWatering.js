import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, DEFAULT_SETTINGS, EMPTY_STATUS, readStorage, writeStorage } from './lib.js';
import { validDemoHistory } from './historyUtils.js';

export default function useWatering(apiUrl, demo) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [demoHistory, setDemoHistory] = useState(() => validDemoHistory(readStorage('gruenzeit-demo-history', [])));
  const demoHistoryRef = useRef(demoHistory);
  const demoRunning = useRef(null);
  const demoEnd = useRef(null);
  const generation = useRef(0);
  const mutation = useRef(0);

  const updateDemoHistory = useCallback((change) => {
    const next = change(demoHistoryRef.current);
    demoHistoryRef.current = next;
    setDemoHistory(next);
    writeStorage('gruenzeit-demo-history', next);
  }, []);

  const finishDemo = useCallback((outcome) => {
    const running = demoRunning.current;
    if (!running) return;
    demoRunning.current = null;
    const ended = new Date().toISOString();
    const elapsed = Math.max(0, (performance.now() - running.tick) / 1000);
    updateDemoHistory((entries) => entries.map((entry) => entry.id === running.id
      ? { ...entry, ended_at: ended, actual_duration_seconds: elapsed, outcome } : entry));
  }, [updateDemoHistory]);

  const apply = useCallback((data) => {
    setSettings(data.settings);
    setStatus(data.status);
    setConnection('online');
    setError('');
    setLastSync(new Date());
    if (data.status.server_time) setClockOffset(new Date(data.status.server_time).getTime() - Date.now());
  }, []);

  useEffect(() => {
    const id = ++generation.current;
    let disposed = false;
    let timer;
    const abort = new AbortController();
    setStatus(EMPTY_STATUS);
    setError('');
    setLastSync(null);
    setClockOffset(0);
    demoEnd.current = null;
    demoRunning.current = null;
    if (demo) {
      updateDemoHistory((entries) => entries.map((entry) => entry.outcome === 'running'
        ? { ...entry, ended_at: null, actual_duration_seconds: null, outcome: 'interrupted' } : entry));
      const stored = readStorage('gruenzeit-demo-settings', DEFAULT_SETTINGS);
      const valid = Array.isArray(stored.times) && stored.times.length === 2 &&
        stored.times.every((time) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) &&
        Number.isInteger(stored.duration_seconds) && stored.duration_seconds >= 1 && stored.duration_seconds <= 3600;
      setSettings(valid ? stored : DEFAULT_SETTINGS);
      setConnection('demo');
      return () => { disposed = true; };
    }
    setSettings(DEFAULT_SETTINGS);
    setConnection('connecting');
    async function poll() {
      const revision = mutation.current;
      try {
        const data = await apiRequest(apiUrl, '/state', { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
        if (!disposed && id === generation.current && revision === mutation.current) apply(data);
      } catch (err) {
        if (!disposed && id === generation.current) {
          setConnection('offline');
          setError(err.message);
        }
      } finally {
        if (!disposed) timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => { disposed = true; abort.abort(); clearTimeout(timer); };
  }, [apiUrl, demo, apply, updateDemoHistory]);

  useEffect(() => {
    if (!demo) return undefined;
    const timer = setInterval(() => {
      if (!demoEnd.current) return;
      const remaining = Math.max(0, Math.ceil((demoEnd.current - Date.now()) / 1000));
      setStatus((old) => ({ ...old, watering: remaining > 0, remaining_seconds: remaining,
        last_finished_at: remaining ? old.last_finished_at : new Date().toISOString() }));
      if (!remaining) { demoEnd.current = null; finishDemo('completed'); }
    }, 250);
    return () => clearInterval(timer);
  }, [demo, finishDemo]);

  async function act(action, nextSettings) {
    if (busy) return false;
    setBusy(true);
    mutation.current += 1;
    const id = generation.current;
    try {
      if (demo) {
        if (action === 'settings') {
          setSettings(nextSettings);
          writeStorage('gruenzeit-demo-settings', nextSettings);
        } else if (action === 'start') {
          finishDemo('restarted');
          const started = new Date().toISOString();
          const runId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
          demoRunning.current = { id: runId, tick: performance.now() };
          updateDemoHistory((entries) => [{ id: runId, started_at: started, ended_at: null,
            planned_duration_seconds: settings.duration_seconds, actual_duration_seconds: null,
            source: 'manual', outcome: 'running' }, ...entries]);
          demoEnd.current = Date.now() + settings.duration_seconds * 1000;
          setStatus((old) => ({ ...old, watering: true, started_at: started,
            duration_seconds: settings.duration_seconds, remaining_seconds: settings.duration_seconds }));
        } else {
          finishDemo('stopped');
          demoEnd.current = null;
          setStatus((old) => ({ ...old, watering: false, remaining_seconds: 0, last_finished_at: new Date().toISOString() }));
        }
      } else {
        const data = await apiRequest(apiUrl, `/${action}`, {
          method: action === 'settings' ? 'PUT' : 'POST',
          ...(nextSettings ? { body: JSON.stringify(nextSettings) } : {}),
        });
        if (id === generation.current) apply(data);
      }
      return id === generation.current;
    } catch (err) {
      if (id === generation.current) { setError(err.message); setConnection('offline'); }
      throw err;
    } finally { setBusy(false); }
  }

  return { settings, status, connection, error, busy, lastSync, clockOffset, act, demoHistory };
}
