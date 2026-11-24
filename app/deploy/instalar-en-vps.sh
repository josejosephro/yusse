#!/usr/bin/env bash
# Instala o actualiza Yussè Clip en la VPS. Se ejecuta EN LA VPS como root, desde
# la carpeta del codigo subido (por ejemplo /tmp/yusse-src). Se puede repetir.
#   bash deploy/instalar-en-vps.sh [puerto]
set -euo pipefail
APP=yusse
PORT="${1:-3070}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST=/opt/yusse
DATA=/var/lib/yusse
export DEBIAN_FRONTEND=noninteractive

echo ">> Paquetes del sistema (ffmpeg, python, tipografias)"
apt-get update -qq
apt-get install -y -qq ffmpeg python3 python3-venv python3-pip build-essential ca-certificates curl \
  fonts-montserrat fonts-roboto fonts-open-sans fonts-lato fonts-dejavu-core >/dev/null

node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }
if ! node_ok; then
  echo ">> Node 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

id -u "$APP" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP"
mkdir -p "$DEST" "$DATA"

echo ">> Copiando la app"
# copia de seguridad del codigo anterior (los datos de usuarios viven aparte, en $DATA)
if [ -d "$DEST/server" ]; then tar -czf "/root/yusse-codigo-$(date +%Y%m%d-%H%M%S).tgz" -C "$DEST" server public py package.json 2>/dev/null || true; fi
cp -r "$SRC/server" "$SRC/public" "$SRC/py" "$SRC/package.json" "$SRC/package-lock.json" "$DEST/"
cd "$DEST"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

echo ">> Entorno de Python (transcripcion, caras, enlaces)"
[ -d "$DEST/venv" ] || python3 -m venv "$DEST/venv"
"$DEST/venv/bin/pip" install -q --upgrade pip
"$DEST/venv/bin/pip" install -q faster-whisper opencv-python-headless yt-dlp
"$DEST/venv/bin/pip" install -q --upgrade yt-dlp

# modelo de transcripcion segun la memoria de la maquina
MEM_GB=$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo)
MODEL=small; [ "$MEM_GB" -lt 4 ] && MODEL=base; [ "$MEM_GB" -ge 15 ] && MODEL=medium
echo ">> Descargando el modelo de transcripcion ($MODEL)"
sudo -u "$APP" HOME="/home/$APP" "$DEST/venv/bin/python" -c "from faster_whisper import WhisperModel; WhisperModel('$MODEL', device='cpu', compute_type='int8')" >/dev/null

chown -R "$APP:$APP" "$DEST" "$DATA"

cat > /etc/systemd/system/$APP.service <<EOF
[Unit]
Description=Yussè Clip
After=network.target

[Service]
User=$APP
WorkingDirectory=$DEST
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=DATA_DIR=$DATA
Environment=COOKIE_SECURE=1
Environment=WHISPER_MODEL=$MODEL
Environment=PYTHON_BIN=$DEST/venv/bin/python
Environment=YTDLP_BIN=$DEST/venv/bin/yt-dlp
Environment=HOME=/home/$APP
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env node server/index.js
Restart=always
RestartSec=3
Nice=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$APP" >/dev/null 2>&1
systemctl restart "$APP"
sleep 2
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo && echo ">> Yussè Clip en marcha en 127.0.0.1:$PORT (modelo $MODEL, ${MEM_GB} GB RAM)"
