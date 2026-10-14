# Grünzeit · Raspberry Pi Bewässerung

Eine React-Oberfläche mit Python-Steuerung für den Raspberry Pi 5. Die Steuerung schaltet **BCM GPIO 18 (physischer Pin 12)** zweimal täglich für eine einstellbare Dauer ein. **Ground ist physischer Pin 6**.

Das Dashboard bietet einen editierbaren Tagesplan, manuelles Starten und Stoppen, den nächsten Bewässerungstermin, eine Restlaufzeit und einen ausdrücklich gekennzeichneten Demomodus. Unter **Verlauf & Statistik** findest du gespeicherte Durchgänge, tatsächliche Laufzeiten, Tagesdiagramme und CSV-Exporte. Es funktioniert auf Desktop und Smartphone. Pflanzenillustration, Icons und Schrift-Fallbacks benötigen keine externen Dienste.

## React-Oberfläche starten

Zum Bauen: Node.js 22.12+; empfohlen ist Node.js 24 LTS. Einen bereits gebauten `dist/`-Ordner kann der Python-Dienst auch ohne Node.js ausliefern.

```bash
npm ci
npm run build
npx serve -s dist -l 3000
```

Öffne **http://localhost:3000**. Der Build liegt vollständig in `dist/` und lässt sich auch mit einem global installierten `serve` genau so starten:

```bash
serve -s dist -l 3000
```

`npm start` beziehungsweise `npm run preview` verwendet das mitinstallierte `serve`. Für die Entwicklung mit automatischem Neuladen: `npm run dev` (Port 5173).

Unter **Verbindung → Demo ausprobieren** kannst du ohne Raspberry Pi die Oberfläche testen. Start/Stopp und Zeitplan funktionieren in diesem Modus lokal; es werden keine Hardware-Befehle gesendet. Demo-Einstellungen werden im Browser gespeichert. Der Demo-Zeitplan löst keine zeitgesteuerten Bewässerungen aus.

## Mit dem Raspberry Pi verbinden

Die Python-Steuerung läuft auf Port **8080**. Die React-Seite verbindet sich standardmässig mit demselben Hostnamen auf diesem Port. Wenn die Oberfläche auf deinem Computer läuft, trage unter **Verbindung** beispielsweise `http://raspberrypi.local:8080` oder `http://192.168.1.50:8080` ein. Die Adresse wird in diesem Browser gespeichert.

Optional lässt sich die Standardadresse beim Build festlegen:

```bash
VITE_API_URL=http://raspberrypi.local:8080 npm run build
```

Die API erlaubt standardmässig `localhost` und `127.0.0.1` auf Port 3000/5173 sowie denselben Raspberry-Pi-Hostnamen auf diesen Ports. Wird die Oberfläche von einem anderen Rechner im LAN ausgeliefert, ergänze dessen genaue Webadresse im Python-systemd-Dienst:

```ini
Environment=BEWAESSERER_ALLOWED_ORIGINS=http://192.168.1.10:3000
```

Mehrere Adressen werden durch Kommas getrennt. Nach Änderungen den Dienst neu starten. Ein bereits gebautes `dist/` wird vom Python-Dienst zusätzlich unter Port 8080 ausgeliefert. Ohne Build verweist dessen Startseite auf Port 3000.

Die Zeitplanung läuft auf dem Raspberry Pi weiter, wenn der Browser geschlossen ist. Die Oberfläche verwendet die Zeitzone **Europe/Zurich**.

## Sicherheit und Anschluss

**Keine Pumpe und kein Magnetventil direkt an den GPIO anschließen.** Der GPIO liefert nur ein 3,3-V-Steuersignal und darf nur gering belastet werden. Verwende ein für 3,3-V-Logik geeignetes Relaismodul oder einen MOSFET-Treiber, eine separate Stromversorgung für die Last sowie bei induktiven DC-Lasten eine Freilaufdiode. Netzspannung gehört in die Hände einer Elektrofachkraft.

Typischer Anschluss eines aktiv-HIGH Treibermoduls:

| Raspberry Pi | Physischer Pin | Treibermodul |
|---|---:|---|
| GPIO 18 | 12 | IN / Signal |
| Ground | 6 | GND |

Wenn dein Relais **aktiv-LOW** arbeitet, ergänze im systemd-Service `Environment=BEWAESSERER_ACTIVE_HIGH=0` und installiere erneut.

## Installation auf Raspberry Pi OS

Kopiere den aktuellen Projektordner auf den Pi, beispielsweise nach `~/Bewaesserer`. Für den Pi 5 verwenden die Anforderungen `gpiozero==2.0.1.post3`, das den [GPIO-Chip-Fix für neuere Pi-5-Kernel](https://gpiozero.readthedocs.io/en/stable/changelog.html#release-2-0-1-post3-2026-07-27) enthält.

Baue zuerst die React-Oberfläche. Das geht entweder auf dem Mac (danach den erzeugten `dist/`-Ordner mitkopieren) oder direkt auf dem Pi mit Node.js 22.12+:

```bash
cd ~/Bewaesserer
npm ci
npm run build
```

Fehlt auf dem Pi eine passende Node-Version, lässt sich Node.js 24 mit [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) installieren. Diese Schritte sind bei einem bereits auf dem Mac gebauten und mitkopierten `dist/` nicht nötig:

```bash
sudo apt update
sudo apt install -y curl ca-certificates
export NVM_DIR="$HOME/.nvm"
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
. "$NVM_DIR/nvm.sh"
nvm install 24
```

Installiere anschliessend auf dem Pi den Python-Dienst:

```bash
cd ~/Bewaesserer
sudo bash install.sh
sudo systemctl restart bewaesserer
hostname -I
```

Öffne auf einem Computer oder Handy im selben Netzwerk **`http://<PI-IP>:8080`**. Dieser Dienst liefert die React-Oberfläche und die API gemeinsam aus und startet automatisch beim Booten. Wenn `dist/` bereits vom Mac mitkopiert wurde, braucht der Pi dafür keine Node.js-Installation.

Für die separat gehostete Variante auf Port 3000 starte im Projektordner mit installierten Node-Abhängigkeiten zusätzlich:

```bash
npm start
```

Das entspricht `serve -s dist -l 3000`. Öffne dann **`http://<PI-IP>:3000`**. Dieser zusätzliche Prozess läuft nur, solange das Terminal offen bleibt; der Python-Dienst läuft unabhängig davon weiter.

Standardplan: **07:00 und 19:00 Uhr**, jeweils **2,5 Minuten (150 Sekunden)**.

## Bedienung und Wartung

Im Webinterface lassen sich beide Uhrzeiten und die Dauer (1–3600 Sekunden) ändern sowie die Bewässerung manuell starten und stoppen. Einstellungen bleiben unter `data/settings.json` erhalten.

```bash
sudo systemctl status bewaesserer
sudo journalctl -u bewaesserer -f
sudo systemctl restart bewaesserer
```

Nach Änderungen die Oberfläche erneut mit `npm run build` bauen und `sudo ./install.sh` ausführen. Einen bereits laufenden Dienst anschliessend mit `sudo systemctl restart bewaesserer` neu starten. Der Dienst verwendet `KillSignal=SIGINT`, damit beim Stoppen die Abschaltroutine ausgeführt wird.

## API

| Endpunkt | Funktion |
| --- | --- |
| `GET /api/state` | Aktueller Zeitplan, Status, Restlaufzeit und Serverzeit |
| `GET /api/settings` | Zeitplan und Status |
| `PUT /api/settings` | JSON: `{"times":["07:00","19:00"],"duration_seconds":150}` |
| `POST /api/start` | Start mit der gespeicherten Dauer |
| `POST /api/stop` | Sofort stoppen |
| `GET /api/status` | Betriebszustand ohne Zeitplan |
| `GET /api/history?days=7&source=all&limit=20&offset=0` | Verlauf, nach neuestem Beginn sortiert |
| `GET /api/statistics?days=7` | Heutige, tägliche und gesamte erfasste Laufzeiten |
| `GET /api/history/export.csv?days=7&source=all` | CSV-Download für Zeitraum und Auslöser |

Die schreibenden JSON-Endpunkte geben den aktualisierten Zeitplan und Status zurück. Die bisherigen Formular-Endpunkte bleiben kompatibel.

## Verlauf und Statistik

Jeder neue Bewässerungsdurchgang wird auf dem Raspberry Pi in **`data/watering.sqlite3`** gespeichert; beim installierten Dienst liegt die Datei unter **`/opt/bewaesserer/data/watering.sqlite3`**. Verlauf und Zeitplan bleiben bei Neustarts und erneutem Installieren erhalten. Ein anderer Datenbankpfad lässt sich mit `BEWAESSERER_HISTORY` festlegen. SQLite gehört zur Python-Standardbibliothek, zusätzliche Datenbankdienste sind nicht nötig.

Ein Eintrag enthält Beginn, Ende, geplante Dauer, tatsächliche Einschaltzeit des GPIOs, den Auslöser (manuell oder Zeitplan) und den Abschlussgrund. Vorzeitiges Stoppen, erneutes Starten während eines laufenden Durchgangs und das Beenden des Dienstes werden jeweils erfasst. Die Laufzeit wird unabhängig von Korrekturen der Systemuhr gemessen.

Beim normalen Herunterfahren wird der aktive Durchgang beendet und gespeichert. Nach einem Stromausfall oder erzwungenen Prozessabbruch wird ein offener Eintrag beim nächsten Start als **unterbrochen** markiert. Da dann kein verlässliches Ende bekannt ist, bleiben Ende und tatsächliche Dauer leer. Solche Einträge und laufende Durchgänge werden nicht in die Laufzeitsummen eingerechnet. Ein Hinweis zeigt an, wenn unterbrochene Einträge vorhanden sind.

Im Dashboard kannst du 7, 30 oder 90 Tage wählen. Kennzahlen zeigen die tatsächliche Dauer und Anzahl für heute, den Zeitraum und insgesamt seit Beginn der Aufzeichnung sowie den Durchschnitt pro Durchgang. Das Tagesdiagramm unterscheidet manuelle und geplante Bewässerung. Durchgänge zählen am Tag ihres Beginns; Laufzeiten über Mitternacht werden auf die jeweiligen Zürcher Kalendertage aufgeteilt. Der Auslöserfilter gilt für die Tabelle und den CSV-Export; die Statistik berücksichtigt beide Auslöser.

Die CSV-Datei enthält alle Einträge des gewählten Zeitraums und Auslösers, auch wenn in der Tabelle erst eine Seite angezeigt wird. Sie verwendet UTF-8 mit BOM, Semikolon-Trennung, Zeitzonenangaben und tatsächliche Dauern in Sekunden. Die Aufzeichnung beginnt mit dieser Version; frühere Durchgänge lassen sich daraus nicht rekonstruieren. Es wird die GPIO-Einschaltzeit erfasst, kein gemessener Wasserdurchfluss.

Im Demomodus werden ausschliesslich selbst gestartete Demo-Durchgänge im Browser gespeichert. Demo-Daten werden getrennt vom echten Raspberry-Pi-Verlauf gehalten. Ein beim Verlassen oder Neuladen noch laufender Demo-Durchgang bekommt eine unbekannte Dauer.

Nach dem Übertragen der Änderungen auf den Pi installierst du das Update im dortigen Projektordner:

```bash
cd ~/bewaesserer
npm ci
npm run build
sudo bash install.sh
sudo systemctl restart bewaesserer
```

Der installierte Dienst liefert das aktualisierte Dashboard auf Port 8080 aus. Beim Betrieb mit `npm run dev` wird die React-Oberfläche automatisch neu geladen; der Python-Dienst muss für das neue Protokoll dennoch aktualisiert und neu gestartet werden.

## Entwicklung ohne Raspberry Pi

Die Hardware wird in den Tests simuliert:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt pytest
pytest
```

Die Browser-Tests prüfen die fertige React-Seite mit einer Python-Steuerung und simulierten GPIOs auf Desktop und Smartphone, einschliesslich echter HTTP-Anfragen über die beiden Ports:

```bash
npx playwright install chromium
TEST_PYTHON=.venv/bin/python npm run test:ui
```

Alternativ kann ein bereits installiertes Chrome verwendet werden:

```bash
PLAYWRIGHT_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
TEST_PYTHON=.venv/bin/python npm run test:ui
```

Für diese Tests müssen Port 3000 und 8080 frei sein. Tests nie gegen eine echte angeschlossene Bewässerungsanlage ausführen.

`npm test` prüft die Berechnung des nächsten Termins und der Demo-Statistik, einschliesslich der Zeitumstellungen in Zürich. Die Python-Tests prüfen zusätzlich Speicherung, Wiederanlauf, tatsächliche Laufzeiten, Datenbankfehler und die Verlaufs-API. Die Browser-Tests testen auch Verlauf, Filter, CSV-Download und die Trennung von Demo- und Anlagendaten.
