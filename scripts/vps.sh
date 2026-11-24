#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# vps.sh — lanza un comando en la VPS del usuario por SSH, con la clave de secret/.
# Parte de la skill /adrian-saenz-copia-software.
#
# La clave privada y la contrasena de root NUNCA salen del ordenador del usuario.
# Este script solo USA la clave privada local para conectarse; no la imprime ni
# la copia a ningun sitio.
#
# Uso:
#   scripts/vps.sh "<comando remoto>"        # ejecuta el comando en la VPS
#   scripts/vps.sh                            # sin argumentos: hostname + uptime
#
# Lee la conexion de variables de entorno, o usa los valores de CLAUDE.md:
#   VPS_HOST   IP o host de la VPS            (ej. 203.0.113.10)
#   VPS_USER   usuario SSH                    (por defecto: root)
#   VPS_KEY    ruta a la clave privada        (por defecto: secret/<carpeta>_vps)
# -----------------------------------------------------------------------------
set -euo pipefail

# Carpeta raiz de la skill (este script vive en scripts/).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="$(basename "$ROOT_DIR")"

VPS_USER="${VPS_USER:-root}"
VPS_KEY="${VPS_KEY:-$ROOT_DIR/secret/${PROJECT_NAME}_vps}"

if [ -z "${VPS_HOST:-}" ]; then
  echo "vps.sh: falta VPS_HOST (la IP o el host de la VPS). Mira CLAUDE.md." >&2
  exit 2
fi

if [ ! -f "$VPS_KEY" ]; then
  echo "vps.sh: no encuentro la clave privada en $VPS_KEY." >&2
  echo "        Genera primero el acceso (referencias/01-acceso-vps.md)." >&2
  exit 2
fi

# Opciones SSH: sin preguntas interactivas, timeout corto, solo esta clave.
SSH_OPTS=(-i "$VPS_KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
          -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

if [ "$#" -eq 0 ]; then
  # Verificacion por defecto: confirma la conexion mostrando hostname + uptime.
  ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" 'echo "host: $(hostname)"; echo "uptime:$(uptime -p 2>/dev/null || uptime)"'
else
  ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" "$@"
fi
