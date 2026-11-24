#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# instalar-ia.sh — prepara la VPS para que la web use Claude como su IA.
# Parte de la skill /adrian-saenz-copia-software. Se ejecuta EN LA VPS, como root,
# y se puede repetir sin miedo (si algo ya está, no lo toca).
#
# Uso, desde el ordenador del usuario (la ruta de la clave, absoluta):
#   ssh -i <clave> -o IdentitiesOnly=yes root@<IP> "bash -s -- <usuario-app>" < scripts/instalar-ia.sh
#
# Deja:
#   - Node 24 (NodeSource) si no hay un Node 22+ ya instalado.
#   - Claude Code (npm i -g @anthropic-ai/claude-code) en /usr/bin/claude.
#   - El usuario de la app (<usuario-app>), con su carpeta en /home/<usuario-app>.
#     La sesión de Claude se guarda en /home/<usuario-app>/.claude: NUNCA en root,
#     porque la app no la vería.
#   - El comando /usr/local/bin/conectar-ia: lo único que el usuario lanza a mano.
#     Le explica qué hacer, abre el inicio de sesión como <usuario-app> y
#     comprueba al final que ha quedado conectado.
#
# No inicia sesión: eso solo lo puede hacer el usuario con su cuenta de Claude.
# -----------------------------------------------------------------------------
set -euo pipefail

APP_USER="${1:-}"
if ! [[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]{0,30}$ ]]; then
  echo "instalar-ia.sh: falta el usuario de la app (minúsculas, sin espacios). Ej.: bash -s -- miapp" >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "instalar-ia.sh: ejecútalo como root." >&2
  exit 2
fi
export DEBIAN_FRONTEND=noninteractive

# 1. Node 22+ (Claude Code lo necesita). Si no hay, Node 24 de NodeSource.
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local mayor
  mayor="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$mayor" -ge 22 ]
}
if ! node_ok; then
  echo ">> Instalando Node 24 ..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   node $(node -v) · npm $(npm -v)"

# 2. Claude Code, para todos los usuarios (/usr/bin/claude con el npm de NodeSource).
if ! command -v claude >/dev/null 2>&1; then
  echo ">> Instalando Claude Code ..."
  npm install -g @anthropic-ai/claude-code --no-audit --no-fund --loglevel=error >/tmp/claude-install.log 2>&1 \
    || { echo "No se pudo instalar Claude Code (detalle en /tmp/claude-install.log)" >&2; exit 1; }
fi
echo "   claude $(claude --version 2>/dev/null | head -n1)"

# 3. El usuario de la app, con su carpeta (ahí vive su sesión de Claude).
if ! id "$APP_USER" >/dev/null 2>&1; then
  echo ">> Creando el usuario $APP_USER ..."
  useradd --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
else
  # Si ya lo creó la publicación (sin shell y con la carpeta en /opt/<app>), se le
  # da su propia carpeta en /home y una shell: con nologin, `sudo -iu` no entra, y
  # la sesión de Claude en /opt/<app> se borraría en cada publicación. No se mueve
  # nada: el código sigue en /opt/<app>.
  if [ "$(getent passwd "$APP_USER" | cut -d: -f6)" != "/home/$APP_USER" ] \
     || [ "$(getent passwd "$APP_USER" | cut -d: -f7)" != "/bin/bash" ]; then
    echo ">> Preparando /home/$APP_USER para la sesión de Claude ..."
    mkdir -p "/home/$APP_USER"
    chown "$APP_USER:$APP_USER" "/home/$APP_USER"
    chmod 750 "/home/$APP_USER"
    usermod --home "/home/$APP_USER" --shell /bin/bash "$APP_USER"
  fi
fi
sudo -iu "$APP_USER" claude --version >/dev/null

# 4. El comando conectar-ia (lo que el usuario lanza para iniciar sesión).
cat > /usr/local/bin/conectar-ia <<EOF
#!/usr/bin/env bash
# Conecta la IA de la web con la cuenta de Claude del usuario (una sola vez).
# Instalado por la skill /adrian-saenz-copia-software. Usuario de la app: $APP_USER
U="\${1:-$APP_USER}"
conectada() { sudo -iu "\$U" claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; }
echo
echo "=========================================================="
echo "   CONECTAR LA IA DE TU WEB CON TU CUENTA DE CLAUDE"
echo "=========================================================="
if conectada; then
  echo
  echo "   Ya estaba conectada. No tienes que hacer nada más."
  exit 0
fi
echo
echo "   1. Abajo sale un enlace largo. Ábrelo: Ctrl + clic (en Mac,"
echo "      Cmd + clic) o selecciónalo entero, cópialo y pégalo en el navegador."
echo "   2. Entra con tu cuenta de Claude y pulsa «Authorize»."
echo "   3. Copia el código que te da, pégalo aquí donde pone"
echo "      «Paste code here» (Ctrl + V, Cmd + V o clic derecho) y pulsa Enter."
echo
sudo -iu "\$U" claude auth login
echo
if conectada; then
  echo "   LISTO: la IA de tu web ya está conectada."
  echo "   Cierra esta ventana, vuelve a Claude y escríbele: hecho"
else
  echo "   No se ha conectado. Vuelve a lanzarlo y pega el código"
  echo "   nada más copiarlo (caduca a los pocos minutos)."
  exit 1
fi
EOF
chmod 755 /usr/local/bin/conectar-ia

if sudo -iu "$APP_USER" claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
  echo "OK: todo listo y la IA ya tiene la sesión iniciada (usuario $APP_USER)."
else
  echo "OK: todo listo. Falta que el usuario lance conectar-ia e inicie sesión."
fi
