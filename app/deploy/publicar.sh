#!/usr/bin/env bash
# Publica Yussè Clip en esta VPS de un tirón, respetando lo que ya haya.
# Se lanza como root desde la consola de hPanel con el comando de una línea del README.
# Se puede repetir sin miedo: actualiza sin borrar datos de usuarios.
set -uo pipefail
APP=yusse
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG=/root/yusse-publicar.log
exec > >(tee -a "$LOG") 2>&1
say() { echo; echo "==> $*"; }
fail() { echo; echo "############ ALTO: $* ############"; echo "Haz una captura de esta pantalla y envíasela a Claude."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
[ "$(id -u)" -eq 0 ] || fail "hay que lanzarlo como root"

HOST="$(hostname -f 2>/dev/null || hostname)"
case "$HOST" in *.*) ;; *) HOST="$(hostname).hstgr.cloud" ;; esac
say "VPS: $HOST · $(nproc) CPU · $(awk '/MemTotal/ {printf "%.1f GB", $2/1048576}' /proc/meminfo) RAM · disco libre $(df -h / | awk 'NR==2{print $4}')"

# --- 1. Que hay ya en la maquina (no se pisa nada) ---
say "Revisando lo que ya hay en la VPS"
PORT=3070
while ss -ltn "( sport = :$PORT )" | grep -q ":$PORT"; do
  if systemctl is-active --quiet $APP && [ "$(systemctl show -p Environment $APP | grep -o "PORT=[0-9]*" | cut -d= -f2)" = "$PORT" ]; then break; fi
  PORT=$((PORT+1))
done
echo "   puerto interno para la app: $PORT"
WEB80="$(ss -ltnp '( sport = :80 or sport = :443 )' | grep -o 'users:(("[^"]*' | cut -d'"' -f2 | sort -u | tr '\n' ' ')"
echo "   quien usa los puertos web: ${WEB80:-nadie}"
for p in $WEB80; do
  [ "$p" = "nginx" ] || fail "los puertos web los usa '$p' (no nginx). Para no romper lo que ya tienes, Claude debe revisarlo antes"
done

# --- 2. Instalar / actualizar la app ---
say "Instalando Yussè Clip (puede tardar 5-15 minutos la primera vez)"
bash "$SRC/deploy/instalar-en-vps.sh" "$PORT" || fail "la instalación de la app falló (detalle en $LOG)"

# --- 3. nginx + candado ---
say "Configurando la dirección web con candado"
apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null || fail "no se pudo instalar nginx/certbot"
mkdir -p /root/backups
tar -czf "/root/backups/nginx-antes-de-yusse-$(date +%Y%m%d-%H%M%S).tgz" -C /etc nginx
OWNER="$(grep -rlsE "server_name[^;]*\b${HOST//./\\.}\b" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | grep -v "/$APP\$" | head -n1)"
HASMAP="$(grep -rlsE 'map\s+\$http_upgrade\s+\$connection_upgrade' /etc/nginx 2>/dev/null | grep -v "/$APP\$" | head -n1)"
MAP='map $http_upgrade $connection_upgrade { default upgrade; '"''"' close; }'
[ -n "$HASMAP" ] && MAP="# map connection_upgrade ya definido en $HASMAP"
LOC="client_max_body_size 4G; proxy_request_buffering off;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 3600s; proxy_send_timeout 3600s;"
if [ -z "$OWNER" ]; then
  URL="https://$HOST/"
  cat > /etc/nginx/sites-available/$APP <<EOF
$MAP
server {
    listen 80;
    server_name $HOST;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        $LOC
    }
}
EOF
  ln -sf /etc/nginx/sites-available/$APP /etc/nginx/sites-enabled/$APP
else
  # El nombre ya lo sirve otro proyecto: Yussè va en /yusse/ sin tocar lo demas.
  URL="https://$HOST/yusse/"
  echo "   $HOST ya lo usa $OWNER -> publico en la subcarpeta /yusse/"
  cp "$OWNER" "/root/backups/$(basename "$OWNER").antes-de-yusse"
  [ -z "$HASMAP" ] && { echo "$MAP" > /etc/nginx/conf.d/yusse-upgrade-map.conf; }
  cat > /etc/nginx/snippets-yusse.conf <<EOF
location = /yusse { return 301 /yusse/; }
location /yusse/ {
    proxy_pass http://127.0.0.1:$PORT/;
    $LOC
}
EOF
  if ! grep -q "snippets-yusse.conf" "$OWNER"; then
    # se inserta en cada bloque server de ese fichero que tenga ese server_name
    python3 - "$OWNER" "$HOST" <<'PY'
import re,sys
path,host=sys.argv[1],sys.argv[2]
s=open(path).read()
out=[];i=0
for m in re.finditer(r'server_name[^;]*;',s):
    if re.search(r'(^|\s)'+re.escape(host)+r'(\s|;)',m.group(0)):
        out.append((m.end(),'\n    include /etc/nginx/snippets-yusse.conf;'))
for pos,txt in reversed(out): s=s[:pos]+txt+s[pos:]
open(path,'w').write(s)
PY
  fi
fi
nginx -t || { say "nginx no acepta el cambio: lo deshago"; rm -f /etc/nginx/sites-enabled/$APP; [ -n "$OWNER" ] && cp "/root/backups/$(basename "$OWNER").antes-de-yusse" "$OWNER"; nginx -t && systemctl reload nginx; fail "configuración de nginx"; }
systemctl enable --now nginx >/dev/null 2>&1; systemctl reload nginx
if [ -z "$OWNER" ]; then
  certbot --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect || fail "no se pudo poner el candado (certificado)"
fi
command -v ufw >/dev/null && ufw status | grep -q "Status: active" && { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; }

# --- 4. IA con la cuenta de Claude ---
say "Preparando la IA (Claude) para la app"
bash "$SRC/deploy/instalar-ia.sh" $APP || echo "   (la IA no se pudo preparar; la app funciona igual con reglas)"
systemctl restart $APP; sleep 3

# --- 5. Comprobacion final ---
say "Comprobando la dirección en vivo"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL")"
HEALTH="$(curl -s "${URL}api/health")"
echo
echo "================ RESULTADO ================"
echo " Dirección:  $URL"
echo " Respuesta:  $CODE   (200 = funciona)"
echo " Estado app: $HEALTH"
echo " Registro:   $LOG"
echo "==========================================="
echo " Siguiente paso para activar la IA: escribe  conectar-ia  y pulsa Enter."
