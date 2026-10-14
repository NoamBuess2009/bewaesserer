import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronRight, CircleHelp,
  Clock3, Droplets, History, Leaf, LayoutDashboard, LoaderCircle, Menu, Moon, PlugZap,
  Radio, Settings2, ShieldCheck, Sprout, Square, Sun, Timer, Wifi, WifiOff, X,
} from 'lucide-react';
import Botanical from './Botanical.jsx';
import useWatering from './useWatering.js';
import useHistory from './useHistory.js';
import HistoryPanel from './HistoryPanel.jsx';
import { apiRequest, clockDuration, defaultApiUrl, durationLabel, nextRun, normalizeApiUrl, readStorage, writeStorage } from './lib.js';

function Dialog({ title, children, close, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => { previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`dialog ${className}`} onCancel={close}
    onClick={(event) => { if (event.target === ref.current) close(); }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Schliessen"><X size={20}/></button></div>
    {children}
  </dialog>;
}

function ConnectionDialog({ apiUrl, demo, onConnect, onDemo, close }) {
  const [address, setAddress] = useState(apiUrl);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const url = normalizeApiUrl(address.trim());
      await apiRequest(url, '/state');
      onConnect(url);
      close();
    } catch (err) { setError(err.message.includes('fetch') || err.name === 'TimeoutError'
      ? 'Die Anlage ist nicht erreichbar. Prüfe die Adresse und ob die Python-Steuerung läuft.' : err.message); }
    finally { setBusy(false); }
  }
  return <Dialog title="Deine Anlage verbinden" close={close}>
    <div className="dialog-art"><PlugZap size={30}/></div>
    <p>Verbinde Grünzeit mit deinem Raspberry Pi, um deinen Garten direkt zu bewässern.</p>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="api-address">Adresse deiner Steuerung</label>
      <input id="api-address" className="address-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="http://raspberrypi.local:8080" required autoComplete="url" spellCheck="false"/>
      <p className="field-hint">Zum Beispiel http://192.168.1.50:8080. Beide Geräte müssen die Anlage erreichen können.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="button button-primary button-full" disabled={busy} type="submit">{busy ? <LoaderCircle size={17} className="spin"/> : <Wifi size={17}/>} {busy ? 'Verbindung wird geprüft …' : 'Verbinden'}</button>
    </form>
    <div className="dialog-divider"><span>Erst einmal umsehen?</span></div>
    <button className="button button-secondary button-full" onClick={() => { onDemo(); close(); }} disabled={busy}><Leaf size={17}/>{demo ? 'Demomodus fortsetzen' : 'Demo ausprobieren'}<ArrowRight size={16}/></button>
    <p className="field-hint centered">In der Demo wird keine echte Bewässerung ausgelöst.</p>
  </Dialog>;
}

function HelpDialog({ close }) {
  return <Dialog title="Ein guter Rhythmus für deinen Garten" close={close}>
    <div className="help-step"><span>01</span><div><h3>Anlage verbinden</h3><p>Trage die Adresse deiner Raspberry-Pi-Steuerung unter «Verbindung» ein.</p></div></div>
    <div className="help-step"><span>02</span><div><h3>Deinen Rhythmus finden</h3><p>Wähle zwei tägliche Uhrzeiten und eine gemeinsame Bewässerungsdauer. Mit «Zeitplan speichern» übernimmt die Anlage deine Einstellungen.</p></div></div>
    <div className="help-step"><span>03</span><div><h3>Zurücklehnen</h3><p>Die Steuerung auf dem Raspberry Pi führt deinen Plan auch aus, wenn diese Seite geschlossen ist. Bei Bedarf kannst du jederzeit manuell starten oder stoppen.</p></div></div>
    <div className="help-note"><Clock3 size={18}/><span>Alle Bewässerungszeiten gelten für Europe/Zurich.</span></div>
  </Dialog>;
}

function StatCard({ icon: Icon, label, value, unit, detail, color }) {
  return <article className="stat-card"><div className={`stat-icon ${color || ''}`}><Icon size={20} strokeWidth={1.6}/></div>
    <div><p>{label}</p><div className="stat-value">{value}<span>{unit}</span></div><small>{detail}</small></div>
  </article>;
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(() => readStorage('gruenzeit-api', defaultApiUrl()));
  const [demo, setDemo] = useState(() => readStorage('gruenzeit-demo', false) === true);
  const { settings, status, connection, busy, lastSync, clockOffset, act, demoHistory } = useWatering(apiUrl, demo);
  const analytics = useHistory(apiUrl, demo, status, demoHistory);
  const [draft, setDraft] = useState(settings);
  const [now, setNow] = useState(new Date());
  const [modal, setModal] = useState(null);
  const [nav, setNav] = useState('overview');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const scheduleRef = useRef(null);

  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { setDraft({ times: [...settings.times], duration_seconds: settings.duration_seconds }); }, [settings.times[0], settings.times[1], settings.duration_seconds]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const connected = connection === 'online';
  const usable = connected || demo;
  const watering = status.watering;
  const adjustedNow = new Date(now.getTime() + clockOffset);
  const upcoming = nextRun(settings.times, adjustedNow);
  const untilNext = upcoming ? Math.max(0, Math.ceil((upcoming.date - adjustedNow) / 60000)) : 0;
  const remaining = Math.max(0, Math.ceil(status.remaining_seconds - (!demo && lastSync ? (now - lastSync) / 1000 : 0)));
  const progress = watering && status.duration_seconds ? Math.min(100, Math.max(0, (1 - remaining / status.duration_seconds) * 100)) : 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const dateLabel = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long' }).format(adjustedNow);
  const upcomingDate = upcoming && new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long' }).format(upcoming.date);
  const connectionLabel = { online: 'Verbunden', offline: 'Nicht verbunden', connecting: 'Verbindet …', demo: 'Demomodus' }[connection];

  function notify(message, error = false) {
    clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  function navigate(target) {
    setMobileMenu(false);
    if (target === 'connection' || target === 'help') { setModal(target); return; }
    setNav(target);
    if (target === 'history') document.getElementById('verlauf').scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (target === 'schedule') scheduleRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function connect(url) {
    setApiUrl(url); setDemo(false);
    writeStorage('gruenzeit-api', url); writeStorage('gruenzeit-demo', false);
    notify('Die Anlage wird verbunden.');
  }

  function startDemo() {
    setDemo(true); writeStorage('gruenzeit-demo', true);
    notify('Demo aktiv. Du kannst alles in Ruhe ausprobieren.');
  }

  async function control() {
    if (!usable && !watering) { setModal('connection'); return; }
    try {
      const success = await act(watering ? 'stop' : 'start');
      if (success) notify(watering ? 'Bewässerung gestoppt.' : demo ? 'Demo-Bewässerung gestartet.' : 'Bewässerung gestartet.');
    } catch { notify('Die Anlage hat nicht bestätigt. Bitte Verbindung prüfen und erneut versuchen.', true); }
  }

  async function save(event) {
    event.preventDefault();
    if (!usable) { setModal('connection'); return; }
    try {
      const success = await act('settings', draft);
      if (success) notify(demo ? 'Zeitplan für die Demo gespeichert.' : 'Dein Zeitplan wurde auf der Anlage gespeichert.');
    } catch { notify('Der Zeitplan konnte nicht gespeichert werden. Deine Eingaben bleiben erhalten.', true); }
  }

  return <div className="app-shell">
    {mobileMenu && <button className="sidebar-backdrop" aria-label="Menü schliessen" onClick={() => setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
      <a className="brand" href="#" onClick={(e) => { e.preventDefault(); navigate('overview'); }} aria-label="Grünzeit Übersicht"><span className="brand-icon"><Sprout size={29} strokeWidth={1.6}/></span><span>grünzeit<span className="brand-dot">.</span></span></a>
      <div className="workspace"><span className="workspace-avatar"><Leaf size={17}/></span><div><strong>Mein Garten</strong><small>Ein bisschen grüner, jeden Tag</small></div></div>
      <span className="nav-label">DEIN GARTEN</span>
      <nav aria-label="Hauptnavigation">
        <button className={`nav-item ${nav === 'overview' ? 'selected' : ''}`} onClick={() => navigate('overview')}><LayoutDashboard size={19}/>Übersicht{nav === 'overview' && <span className="nav-indicator"/>}</button>
        <button className={`nav-item ${nav === 'schedule' ? 'selected' : ''}`} onClick={() => navigate('schedule')}><CalendarDays size={19}/>Zeitplan{nav === 'schedule' && <span className="nav-indicator"/>}</button>
        <button className={`nav-item ${nav === 'history' ? 'selected' : ''}`} onClick={() => navigate('history')}><History size={19}/>Verlauf & Statistik{nav === 'history' && <span className="nav-indicator"/>}</button>
        <button className="nav-item" onClick={() => navigate('connection')}><PlugZap size={19}/>Verbindung<ArrowUpRight size={15} className="nav-trailing"/></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><Sprout size={27} strokeWidth={1.25}/><p>Weniger Aufwand.<br/><strong>Mehr Aufblühen.</strong></p><span>Dein Garten hat seinen Rhythmus.<br/>Wir helfen dir, ihn zu finden.</span></div>
        <button className="device-card" onClick={() => navigate('connection')}><span className="device-icon"><Radio size={21}/></span><span><strong>{demo ? 'Demo-Garten' : 'Raspberry Pi'}</strong><small><i className={`status-dot ${connection}`}/>{connectionLabel}</small></span><ChevronRight size={16}/></button>
        <button className="help-link" onClick={() => navigate('help')}><CircleHelp size={16}/>Gut zu wissen<ArrowUpRight size={14}/></button>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" onClick={() => setMobileMenu(true)} aria-label="Menü öffnen"><Menu size={22}/></button><Sprout size={17}/><span>Mein Garten</span><ChevronRight size={14}/><strong>Übersicht</strong></div>
        <div className="topbar-right"><span className="topbar-date"><CalendarDays size={16}/>{dateLabel}</span><span className="topbar-divider"/><button className="icon-button" onClick={() => setModal('connection')} aria-label="Verbindungseinstellungen"><Settings2 size={19}/></button><span className="garden-avatar" aria-label="Mein Garten"><Leaf size={20}/></span></div>
      </header>

      <main className="main-content">
        <div className="page-heading"><div><div className="eyebrow"><span/>DEIN GARTEN IM BLICK</div><h1>Ein guter Tag für mehr Grün<span>.</span></h1><p>Alles, was dein Garten braucht. Alles unter Kontrolle.</p></div><button className={`connection-pill ${connection}`} onClick={() => setModal('connection')}><i className={`status-dot ${connection}`}/>{connectionLabel}<ChevronRight size={13}/></button></div>

        {(demo || connection === 'offline') && <div className={`notice ${demo ? 'notice-demo' : ''}`}><span className="notice-icon">{demo ? <Leaf size={17}/> : <WifiOff size={17}/>}</span><p>{demo ? <><strong>Du bist im Demogarten.</strong> Alles zum Ausprobieren, ohne echte Bewässerung.</> : <><strong>Dein Dashboard ist bereit.</strong> Verbinde deine Anlage oder sieh dich in der Demo um.</>}</p><button onClick={() => setModal('connection')}>{demo ? 'Anlage verbinden' : 'Los geht’s'}<ArrowRight size={15}/></button></div>}

        <section className="overview-grid" aria-label="Bewässerungsübersicht">
          <article className={`hero-card ${watering ? 'is-watering' : ''}`}>
            <Botanical/>
            <div className="hero-content"><span className="hero-tag"><Leaf size={13}/>GUT VERSORGT. GANZ ENTSPANNT.</span><h2>{watering ? <>Dein Garten<br/>tankt auf.</> : <>Kleine Pause.<br/>Grosses Aufblühen.</>}</h2><p>{watering ? 'Ein Schluck frisches Wasser. Danach übernimmt wieder dein Zeitplan.' : 'Ein fester Rhythmus für deine Pflanzen. Und mehr Zeit, deinen Garten zu geniessen.'}</p>
              <div className="hero-action"><button className={`button ${watering ? 'button-stop' : 'button-primary'}`} onClick={control} disabled={busy || connection === 'connecting'}>{busy ? <LoaderCircle size={18} className="spin"/> : watering ? <Square size={16} fill="currentColor"/> : <Droplets size={18}/>} {watering ? 'Bewässerung stoppen' : usable ? 'Jetzt bewässern' : 'Anlage verbinden'}{!watering && <ArrowRight size={17}/>}</button><span>{watering ? 'Du kannst jederzeit stoppen' : `${durationLabel(settings.duration_seconds)} pro Durchgang`}</span></div>
            </div>
            <div className="hero-bottom"><span><i className={`status-dot ${watering ? 'online pulse' : usable ? 'online' : 'offline'}`}/>{watering ? 'Bewässerung läuft' : demo ? 'Bereit für eine Demo' : connected ? 'Anlage bereit' : 'Dein Garten wartet auf dich'}</span><span><ShieldCheck size={14}/>Automatische Abschaltung</span></div>
          </article>

          <article className={`next-card ${watering ? 'active' : ''}`}><div className="card-heading"><span className="eyebrow">{watering ? 'BEWÄSSERUNG LÄUFT' : 'ALS NÄCHSTES'}</span><span className="soft-icon"><Clock3 size={18}/></span></div>
            <p className="next-caption">{watering ? 'Noch ein kleiner Moment' : 'Die nächste Erfrischung'}</p>
            <div className="next-time">{watering ? clockDuration(remaining) : upcoming?.time || '—'}<span>{watering ? 'Min.' : 'Uhr'}</span></div>
            <div className="next-countdown">{watering ? <><span className="live-dot"/>Schaltet danach automatisch aus</> : <><span className="tiny-leaf"><Leaf size={12}/></span>{untilNext < 60 ? `In ${untilNext} Min.` : `In ${Math.floor(untilNext / 60)} Std.${untilNext % 60 ? ` ${untilNext % 60} Min.` : ''}`}{!usable && <span className="preview-label">Vorschau</span>}</>}</div>
            {watering ? <div className="watering-progress"><div><span>{Math.round(progress)} % geschafft</span><span>{durationLabel(status.duration_seconds)}</span></div><div className="progress-track"><span style={{ width: `${progress}%` }}/></div></div> : <div className="mini-timeline"><span><Sun size={15}/>{settings.times[0]}</span><div className="timeline-track"><i/><i/></div><span><Moon size={14}/>{settings.times[1]}</span></div>}
            <div className="next-details"><span><CalendarDays size={15}/>{watering ? 'Frisches Wasser für deine Pflanzen' : upcomingDate}</span><span><Timer size={15}/>{durationLabel(watering ? status.duration_seconds : settings.duration_seconds)}{!watering && ' Bewässerung'}</span></div>
          </article>
        </section>

        <section className="stats-grid" aria-label="Dein geplanter Rhythmus"><StatCard icon={Droplets} label="Geplante Durchgänge" value={new Set(settings.times).size} unit="× täglich" detail="Dein gespeicherter Zeitplan"/>
          <StatCard icon={Timer} label="Geplante Laufzeit" value={clockDuration(settings.duration_seconds)} unit="Min." detail="Dauer pro Bewässerung" color="sage"/>
          <StatCard icon={Sprout} label="Geplant pro Tag" value={clockDuration(settings.duration_seconds * new Set(settings.times).size)} unit="Min. / Tag" detail="Dein täglicher Bewässerungsplan" color="sand"/></section>

        <section className="lower-grid">
          <article className="schedule-card" id="zeitplan" ref={scheduleRef}><div className="section-heading"><div><h2>Dein täglicher Rhythmus</h2><p>Zwei kleine Auszeiten. Jeden Tag.</p></div><span className="subtle-badge"><span/>Täglich</span></div>
            <form onSubmit={save}>
              <div className="schedule-slots">{draft.times.map((time, index) => <div className={`schedule-slot ${index ? 'evening' : 'morning'}`} key={index}><span className="slot-icon">{index ? <Moon size={22} strokeWidth={1.5}/> : <Sun size={24} strokeWidth={1.5}/>}</span><div><label htmlFor={`time-${index}`}>{index ? 'Am Abend' : 'Am Morgen'}</label><input id={`time-${index}`} type="time" required value={time} aria-label={index ? 'Zweite Bewässerungszeit' : 'Erste Bewässerungszeit'} onChange={(e) => setDraft((old) => ({ ...old, times: old.times.map((item, i) => i === index ? e.target.value : item) }))}/></div><span className="slot-number">0{index + 1}</span></div>)}</div>
              <div className="duration-setting"><div><label htmlFor="duration">Wie lange darf’s sein?</label><p>Gilt für beide Bewässerungen</p></div><div className="duration-input"><Timer size={16}/><input id="duration" type="number" min="1" max="3600" required value={draft.duration_seconds} onChange={(e) => setDraft((old) => ({ ...old, duration_seconds: e.target.value === '' ? '' : Number(e.target.value) }))}/><span>Sek.</span></div></div>
              <div className="duration-presets" aria-label="Bewässerungsdauer auswählen">{[30, 60, 150, 300].map((seconds) => <button type="button" key={seconds} aria-pressed={draft.duration_seconds === seconds} className={draft.duration_seconds === seconds ? 'chosen' : ''} onClick={() => setDraft((old) => ({ ...old, duration_seconds: seconds }))}>{durationLabel(seconds)}</button>)}</div>
              <div className="schedule-footer"><span>{dirty ? <><span className="unsaved-dot"/>Noch nicht gespeichert</> : <><ShieldCheck size={15}/>{demo ? 'Lokal in der Demo gespeichert' : connected ? 'Auf deiner Anlage gespeichert' : 'Zeiten in Europe/Zurich'}</>}</span><button className="button button-primary save-button" type="submit" disabled={busy || (usable && !dirty)}>{busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}Zeitplan speichern</button></div>
            </form>
          </article>

          <article className="garden-note"><div className="note-doodle"><Sprout size={45} strokeWidth={1.15}/><span className="doodle-spark">✧</span><span className="doodle-dot"/></div><span className="eyebrow">KLEINER GARTENMOMENT</span><h2>Gute Dinge<br/>brauchen einen<br/><em>guten Rhythmus.</em></h2><p>Regelmässige Bewässerung, ganz nach deinem Plan. Deine Steuerung kümmert sich darum – auch wenn du gerade anderes im Kopf hast.</p><button onClick={() => setModal('help')}>So funktioniert’s<ArrowUpRight size={16}/></button><span className="note-bottom"><Leaf size={14}/>Mit Liebe zum Grünen.</span></article>
        </section>

        <HistoryPanel history={analytics.history} statistics={analytics.statistics} loading={analytics.loading}
          error={analytics.error || status.history_error} days={analytics.days} onDaysChange={analytics.setDays}
          source={analytics.source} onSourceChange={analytics.setSource} onLoadMore={analytics.loadMore}
          onExport={async () => { try { await analytics.exportCsv(); } catch { notify('Der CSV-Export konnte nicht heruntergeladen werden.', true); } }}
          demo={demo} connected={connected}/>

        <footer className="page-footer"><span><Sprout size={15}/>grünzeit<span className="footer-dot">.</span><span className="footer-separator">/</span>Ein bisschen Fürsorge. Jeden Tag.</span><span>{demo ? 'Demo · keine echte Anlage verbunden' : connected ? <><i className="status-dot online"/>Live mit deiner Anlage verbunden</> : <><i className="status-dot offline"/>Wartet auf deine Anlage</>}</span></footer>
      </main>
    </div>
    {modal === 'connection' && <ConnectionDialog apiUrl={apiUrl} demo={demo} onConnect={connect} onDemo={startDemo} close={() => setModal(null)}/>}
    {modal === 'help' && <HelpDialog close={() => setModal(null)}/>}
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <WifiOff size={18}/> : <Check size={18}/>}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Hinweis schliessen"><X size={16}/></button></div>}
  </div>;
}
