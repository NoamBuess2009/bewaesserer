# Raspberry Pi Bewässerungsanlage

Eine kleine Webanwendung für den Raspberry Pi 5. Sie schaltet **BCM GPIO 18 (physischer Pin 12)** zweimal täglich für eine einstellbare Dauer ein. **Ground ist physischer Pin 6**. Das Webinterface ist im lokalen Netzwerk auf Port 8080 erreichbar.

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

Danach zeigt das Installationsskript die Adresse an, üblicherweise `http://raspberrypi.local:8080` oder `http://<IP-DES-RASPI>:8080`. Der Dienst startet künftig automatisch beim Booten. Standardplan: **07:00 und 19:00 Uhr**, jeweils **2,5 Minuten (150 Sekunden)**.

## Bedienung und Wartung

Im Webinterface lassen sich beide Uhrzeiten und die Dauer (1–3600 Sekunden) ändern sowie die Bewässerung manuell starten und stoppen. Einstellungen bleiben unter `data/settings.json` erhalten.

```bash
sudo systemctl status bewaesserer
sudo journalctl -u bewaesserer -f
sudo systemctl restart bewaesserer
```

Nach einem `git pull` erneut `sudo ./install.sh` ausführen. Beim Stoppen des Dienstes wird GPIO 18 ausgeschaltet.

## Entwicklung ohne Raspberry Pi

Die Hardware wird in den Tests simuliert:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt pytest
pytest
```
