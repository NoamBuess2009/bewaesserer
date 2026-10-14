#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo "Bitte mit sudo ausführen: sudo ./install.sh"
  exit 1
fi

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=/opt/bewaesserer
SERVICE_USER=${SUDO_USER:-pi}

apt-get update
apt-get install -y python3-venv python3-lgpio rsync
mkdir -p "$APP_DIR"
rsync -a --delete --exclude .git --exclude .venv --exclude data "$PROJECT_DIR/" "$APP_DIR/"
python3 -m venv --system-site-packages "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"
mkdir -p "$APP_DIR/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
usermod -aG gpio "$SERVICE_USER"
sed "s/^User=pi$/User=$SERVICE_USER/; s/^Group=pi$/Group=$SERVICE_USER/" "$APP_DIR/systemd/bewaesserer.service" > /etc/systemd/system/bewaesserer.service
systemctl daemon-reload
systemctl enable --now bewaesserer.service

echo "Fertig. Webinterface: http://$(hostname -I | awk '{print $1}'):8080"

