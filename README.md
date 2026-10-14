# Grünzeit · Raspberry Pi Bewässerung

Eine React-Oberfläche mit Python-Steuerung für den Raspberry Pi 5. Die Steuerung schaltet **BCM GPIO 18 (physischer Pin 12)** zweimal täglich für eine einstellbare Dauer ein. **Ground ist physischer Pin 6**.

Das Dashboard bietet einen editierbaren Tagesplan, manuelles Starten und Stoppen, den nächsten Bewässerungstermin, eine Restlaufzeit und einen ausdrücklich gekennzeichneten Demomodus. Es funktioniert auf Desktop und Smartphone. Pflanzenillustration, Icons und Schrift-Fallbacks benötigen keine externen Dienste.

## React-Oberfläche starten

Voraussetzung: Node.js 22.12+ (oder 20.19+).

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

```bash
git clone https://github.com/DEIN-NAME/bewaesserer.git
cd bewaesserer
chmod +x install.sh
sudo ./install.sh
```

Danach zeigt das Installationsskript die Adresse der Python-Steuerung an, üblicherweise `http://raspberrypi.local:8080` oder `http://<IP-DES-RASPI>:8080`. Der Dienst startet künftig automatisch beim Booten. Baue die React-Oberfläche vor der Installation, wenn sie zusätzlich direkt über den Python-Dienst erreichbar sein soll. Standardplan: **07:00 und 19:00 Uhr**, jeweils **2,5 Minuten (150 Sekunden)**.

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

Die schreibenden JSON-Endpunkte geben den aktualisierten Zeitplan und Status zurück. Die bisherigen Formular-Endpunkte bleiben kompatibel.

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

`npm test` prüft die Berechnung des nächsten Termins, einschliesslich der Zeitumstellungen in Zürich.
