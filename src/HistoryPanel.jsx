import { useEffect, useId, useRef, useState } from 'react';
import { Activity, CalendarDays, ChevronDown, Clock3, Download, History, LoaderCircle, Timer, WifiOff } from 'lucide-react';
import './history.css';

const TIMEZONE = 'Europe/Zurich';
const SOURCE_LABELS = { manual: 'Manuell', schedule: 'Zeitplan' };
const OUTCOME_LABELS = {
  running: 'Läuft gerade',
  completed: 'Abgeschlossen',
  stopped: 'Manuell gestoppt',
  restarted: 'Neu gestartet',
  shutdown: 'Heruntergefahren',
  interrupted: 'Unterbrochen',
};

function formatDuration(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const seconds = Math.max(0, Number(value));
  if (seconds > 0 && seconds < 1) return '< 1 Sek.';
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  return [hours ? `${hours} Std.` : '', minutes ? `${minutes} Min.` : '', rest || !rounded ? `${rest} Sek.` : ''].filter(Boolean).join(' ');
}

function formatCount(value) {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat('de-CH').format(value)} ${value === 1 ? 'Durchgang' : 'Durchgänge'}`;
}

function timestamp(value, options) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('de-CH', { timeZone: TIMEZONE, ...options }).format(date);
}

function calendarDate(value, options) {
  // The API supplies a Zurich calendar date rather than a timestamp.
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('de-CH', { timeZone: 'UTC', ...options }).format(date);
}

function RunTimestamp({ value, empty = '—' }) {
  const date = timestamp(value, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = timestamp(value, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (!date) return <span className="history-cell-muted">{empty}</span>;
  return <time className="history-timestamp" dateTime={value}><strong>{time}</strong><span>{date}</span></time>;
}

function Metric({ label, value, detail, icon: Icon, tone = '' }) {
  return <article className={`history-metric ${tone}`}>
    <div className="history-metric-top"><span>{label}</span><Icon size={17} strokeWidth={1.6} aria-hidden="true"/></div>
    <strong className="history-metric-value">{value}</strong>
    <p>{detail}</p>
  </article>;
}

function DailyChart({ daily, days }) {
  const tooltipId = useId();
  const scrollRef = useRef(null);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (days > 30 && scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [days, daily.length]);
  const active = daily.find((day) => day.date === selected);
  const highest = Math.max(0, ...daily.map((day) => Number(day.duration_seconds) || 0));
  const scale = highest > 0 ? highest * 1.1 : 60;
  const labelStep = Math.max(1, Math.ceil(daily.length / (daily.length > 30 ? 12 : 8)));

  return <div className="history-chart-card">
    <div className="history-chart-heading"><div><h3>Ein Blick auf deinen Rhythmus</h3><p>Tatsächliche Bewässerungsdauer pro Tag{days > 30 && ' · seitlich wischen für weitere Tage'}</p></div>
      <div className="history-chart-legend" aria-label="Diagrammlegende"><span><i className="history-key-schedule"/>Zeitplan</span><span><i className="history-key-manual"/>Manuell</span></div>
    </div>
    <div className={`history-chart-readout ${active ? 'has-selection' : ''}`} id={tooltipId} role="tooltip">
      {active ? <><strong>{calendarDate(active.date, { weekday: 'short', day: 'numeric', month: 'long' })}</strong><span>{formatDuration(active.duration_seconds)} · {formatCount(active.count)}</span></>
        : <><Activity size={14} aria-hidden="true"/><span>{highest ? 'Wähle einen Tag für die Details.' : `Noch keine erfasste Laufzeit in den letzten ${days} Tagen.`}</span></>}
    </div>
    {daily.length > 0 ? <div className="history-chart-layout">
      <div className="history-chart-axis" aria-hidden="true"><span>{formatDuration(scale)}</span><span>{formatDuration(scale / 2)}</span><span>0</span></div>
      <div ref={scrollRef} className="history-chart-scroll" tabIndex={daily.length > 30 ? 0 : undefined} aria-label={daily.length > 30 ? 'Tagesdiagramm, horizontal scrollbar' : undefined}>
        <div className="history-chart-grid" style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))`, minWidth: daily.length > 30 ? daily.length * 14 : undefined }}>
          {daily.map((day, index) => {
            const manual = Math.max(0, Number(day.manual_seconds) || 0);
            const scheduled = Math.max(0, Number(day.schedule_seconds) || 0);
            const label = `${calendarDate(day.date, { day: 'numeric', month: 'long', year: 'numeric' })}: ${formatDuration(day.duration_seconds)}, ${formatCount(day.count)}. Zeitplan: ${formatDuration(scheduled)}, manuell: ${formatDuration(manual)}.`;
            return <div className="history-chart-column" key={day.date}>
              <button className={`history-chart-day ${active?.date === day.date ? 'is-selected' : ''}`} type="button" aria-label={label} aria-describedby={active?.date === day.date ? tooltipId : undefined}
                onMouseEnter={() => setSelected(day.date)} onFocus={() => setSelected(day.date)} onClick={() => setSelected(day.date)}>
                <span className="history-chart-stack" aria-hidden="true">
                  <span className="history-bar-manual" style={{ height: `${Math.min(100, manual / scale * 100)}%` }}/>
                  <span className="history-bar-schedule" style={{ height: `${Math.min(100, scheduled / scale * 100)}%` }}/>
                </span>
              </button>
              <span className="history-chart-date" aria-hidden="true">{index === 0 || index === daily.length - 1 || (index % labelStep === 0 && index < daily.length - labelStep) ? calendarDate(day.date, { day: '2-digit', month: '2-digit' }) : ''}</span>
            </div>;
          })}
        </div>
      </div>
    </div> : <div className="history-chart-empty">Sobald eine Bewässerung erfasst wurde, siehst du hier deinen Verlauf.</div>}
  </div>;
}

export default function HistoryPanel({
  history, statistics, loading, error, days = 7, onDaysChange, source = '', onSourceChange,
  onLoadMore, onExport, demo = false, connected = false,
}) {
  const entries = history?.entries || [];
  const available = Boolean(history || statistics);
  const filtersEnabled = demo || connected || available;
  const total = history?.total ?? 0;
  const filtered = source && source !== 'all';
  const unknownDurationCount = statistics?.total?.unknown_duration_count || 0;

  return <section className="history-panel" id="verlauf" aria-labelledby="history-heading" aria-busy={loading}>
    <div className="history-section-heading"><div><span className="eyebrow"><History size={14} aria-hidden="true"/>DEIN GARTEN, TAG FÜR TAG</span><h2 id="history-heading">Verlauf &amp; Statistik</h2><p>Wann bewässert wurde. Und wie lange wirklich.</p></div>
      <div className="history-period-control" role="group" aria-label="Zeitraum für Verlauf und Statistik">{[7, 30, 90].map((period) => <button type="button" key={period} aria-pressed={days === period} onClick={() => onDaysChange?.(period)} disabled={!filtersEnabled}>{period} Tage</button>)}</div>
    </div>

    {demo && <p className="history-demo-note"><span>DEMO</span>Hier werden nur deine ausprobierten Demo-Durchgänge angezeigt.</p>}
    {error && <div className="history-message history-error" role="alert"><WifiOff size={18} aria-hidden="true"/><p>{error}{available && <span>Die zuletzt geladenen Daten bleiben sichtbar.</span>}</p></div>}

    {!available ? <div className="history-empty" role="status">
      <span className="history-empty-icon">{loading ? <LoaderCircle size={24} className="spin" aria-hidden="true"/> : !connected && !demo ? <WifiOff size={24} aria-hidden="true"/> : <History size={24} aria-hidden="true"/>}</span>
      <h3>{loading ? 'Dein Verlauf wird geladen …' : !connected && !demo ? 'Verbinde deine Anlage' : 'Noch kein Verlauf verfügbar'}</h3>
      <p>{loading ? 'Die erfassten Bewässerungen werden von deiner Steuerung abgerufen.' : !connected && !demo ? 'Sobald die Verbindung steht, erscheinen hier die gespeicherten Bewässerungen und ihre Laufzeiten.' : 'Die Steuerung liefert aktuell keine Verlaufsdaten. Prüfe, ob die aktuelle Version installiert ist.'}</p>
    </div> : <>
      <div className="history-metrics" aria-label="Bewässerungsstatistik">
        <Metric label="Heute bewässert" value={formatDuration(statistics?.today?.duration_seconds)} detail={statistics?.today ? formatCount(statistics.today.count) : 'Noch nicht verfügbar'} icon={CalendarDays} tone="history-metric-featured"/>
        <Metric label={`In ${days} Tagen`} value={formatDuration(statistics?.period?.duration_seconds)} detail={statistics?.period ? formatCount(statistics.period.count) : 'Noch nicht verfügbar'} icon={Clock3}/>
        <Metric label="Durchschnitt" value={formatDuration(statistics?.period?.average_duration_seconds)} detail="Pro Durchgang im gewählten Zeitraum" icon={Timer}/>
        <Metric label="Seit Beginn erfasst" value={formatDuration(statistics?.total?.duration_seconds)} detail={statistics?.total ? formatCount(statistics.total.count) : 'Noch nicht verfügbar'} icon={History}/>
      </div>

      {unknownDurationCount > 0 && <p className="history-statistics-note"><Activity size={14} aria-hidden="true"/><span>{new Intl.NumberFormat('de-CH').format(unknownDurationCount)} {unknownDurationCount === 1 ? 'unterbrochener Durchgang ist' : 'unterbrochene Durchgänge sind'} mangels verlässlicher Dauer nicht in den Zeitsummen enthalten.</span></p>}

      {statistics && <DailyChart key={days} daily={statistics.daily || []} days={days}/>}

      <div className="history-log-card">
        <div className="history-log-heading"><div><h3>Dein Bewässerungsprotokoll</h3><p>{history ? `${formatCount(total)} in den letzten ${days} Tagen${filtered ? ` · ${SOURCE_LABELS[source] || 'Gefiltert'}` : ''}` : 'Verlauf wird geladen …'}</p></div>
          <div className="history-log-actions"><div className="history-source-control" role="group" aria-label="Auslöser filtern">{[['', 'Alle'], ['schedule', 'Zeitplan'], ['manual', 'Manuell']].map(([value, label]) => <button type="button" key={label} aria-pressed={value === source || (!value && source === 'all')} onClick={() => onSourceChange?.(value)} disabled={!filtersEnabled}>{label}</button>)}</div>
            <button className="history-export-button" type="button" onClick={onExport} disabled={loading || !history || !total || (!connected && !demo)}><Download size={15} aria-hidden="true"/>CSV exportieren</button>
          </div>
        </div>
        <p className="history-filter-caption">Der Auslöserfilter gilt für Protokoll und CSV. Die Statistik umfasst alle Auslöser.</p>

        {entries.length > 0 ? <>
          <div className="history-table-scroll" tabIndex="0" role="region" aria-label="Bewässerungsprotokoll, horizontal scrollbar">
            <table className="history-table"><caption className="history-sr-only">Bewässerungen der letzten {days} Tage. Alle Uhrzeiten in Europe/Zurich.</caption>
              <thead><tr><th scope="col">Beginn</th><th scope="col">Ende</th><th scope="col">Laufzeit</th><th scope="col">Geplant</th><th scope="col">Auslöser</th><th scope="col">Ergebnis</th></tr></thead>
              <tbody>{entries.map((entry) => <tr key={entry.id}>
                <td><RunTimestamp value={entry.started_at}/></td>
                <td><RunTimestamp value={entry.ended_at} empty={entry.outcome === 'running' ? 'Läuft noch' : 'Nicht erfasst'}/></td>
                <td className="history-actual-duration">{entry.outcome === 'running' ? <span className="history-cell-muted">Wird erfasst</span> : entry.actual_duration_seconds === null || entry.actual_duration_seconds === undefined ? <span className="history-unknown-duration">Nicht bekannt</span> : formatDuration(entry.actual_duration_seconds)}</td>
                <td className="history-cell-muted">{formatDuration(entry.planned_duration_seconds)}</td>
                <td><span className="history-source-label">{entry.source === 'schedule' ? <CalendarDays size={13} aria-hidden="true"/> : <Activity size={13} aria-hidden="true"/>}{SOURCE_LABELS[entry.source] || entry.source}</span></td>
                <td><span className={`history-outcome history-outcome-${entry.outcome}`}><i aria-hidden="true"/>{OUTCOME_LABELS[entry.outcome] || entry.outcome}</span></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="history-log-footer"><p>{entries.length} von {total} Durchgängen angezeigt</p>{entries.length < total && <button className="history-load-button" type="button" onClick={onLoadMore} disabled={loading || (!connected && !demo)}>{loading ? <LoaderCircle size={15} className="spin" aria-hidden="true"/> : <ChevronDown size={15} aria-hidden="true"/>}{loading ? 'Wird geladen …' : 'Mehr laden'}</button>}</div>
        </> : <div className="history-log-empty" role="status"><History size={26} strokeWidth={1.4} aria-hidden="true"/><h4>{loading ? 'Bewässerungen werden geladen …' : filtered ? 'Keine passenden Durchgänge' : 'Dein Protokoll beginnt mit der nächsten Bewässerung'}</h4><p>{filtered ? 'Für diesen Auslöser wurde im gewählten Zeitraum keine Bewässerung erfasst.' : 'Jeder neue Durchgang wird mit Beginn, Ende und tatsächlicher Laufzeit gespeichert.'}</p></div>}
      </div>
      <p className="history-footnote"><Clock3 size={13} aria-hidden="true"/><span>Alle Uhrzeiten in Europe/Zurich. Durchgänge zählen am Starttag. Laufzeiten werden an Mitternacht aufgeteilt. Laufende oder unbekannte Dauern werden nicht geschätzt.{demo ? ' Demo-Daten bleiben in diesem Browser.' : ' Die erfassten Durchgänge bleiben auf deiner Anlage gespeichert.'}</span></p>
    </>}
  </section>;
}
