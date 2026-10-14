import { useEffect, useState } from 'react';
import { jsonRequest } from './lib.js';
import { demoCsv, demoPage, demoStatistics } from './historyUtils.js';

export default function useHistory(apiUrl, demo, status, demoHistory) {
  const [days, setDays] = useState(7);
  const [source, setSource] = useState('');
  const [limit, setLimit] = useState(20);
  const [history, setHistory] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setHistory(null); setStatistics(null); setLimit(20); }, [apiUrl, demo, days, source]);

  useEffect(() => {
    let disposed = false;
    let timer;
    const abort = new AbortController();
    setLoading(true);
    async function refresh() {
      try {
        if (demo) {
          const stats = demoStatistics(demoHistory, new Date(), days);
          setStatistics(stats);
          setHistory(demoPage(demoHistory, stats, source, limit));
          setError('');
        } else {
          const query = new URLSearchParams({ days, source: source || 'all' });
          const signal = () => AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]);
          async function getHistory() {
            let result;
            const entries = [];
            while (entries.length < limit) {
              const page = await jsonRequest(apiUrl, `/history?${query}&limit=${Math.min(500, limit - entries.length)}&offset=${entries.length}`, { signal: signal() });
              if (!Array.isArray(page?.entries)) throw new Error('Bitte die Python-Steuerung für den Verlauf aktualisieren.');
              result = page;
              entries.push(...page.entries);
              if (entries.length >= page.total || !page.entries.length) break;
            }
            return { ...result, entries, limit, offset: 0 };
          }
          const [page, stats] = await Promise.all([getHistory(), jsonRequest(apiUrl, `/statistics?days=${days}`, { signal: signal() })]);
          if (!stats?.daily || !stats?.total) throw new Error('Bitte die Python-Steuerung für die Statistik aktualisieren.');
          if (!disposed) { setHistory(page); setStatistics(stats); setError(''); }
        }
      } catch {
        if (!disposed) setError('Verlauf und Statistik sind gerade nicht erreichbar. Prüfe die Verbindung und die Version der Python-Steuerung.');
      } finally {
        if (!disposed) { setLoading(false); timer = setTimeout(refresh, 5000); }
      }
    }
    refresh();
    return () => { disposed = true; abort.abort(); clearTimeout(timer); };
  }, [apiUrl, demo, days, source, limit, status.watering, status.started_at, status.last_finished_at, demoHistory]);

  async function exportCsv() {
    let content;
    if (demo) {
      const stats = demoStatistics(demoHistory, new Date(), days);
      content = new Blob([demoCsv(demoPage(demoHistory, stats, source, Infinity).entries)], { type: 'text/csv;charset=utf-8' });
    } else {
      const query = new URLSearchParams({ days, source: source || 'all' });
      const response = await fetch(`${apiUrl}/api/history/export.csv?${query}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      if (!response.ok) throw new Error('Der CSV-Export ist fehlgeschlagen.');
      content = await response.blob();
    }
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bewaesserung${demo ? '-demo' : ''}-${days}-tage.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { history, statistics, loading, error, days, source, setDays, setSource,
    loadMore: () => setLimit((old) => old + 20), exportCsv };
}
