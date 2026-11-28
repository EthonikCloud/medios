#!/usr/bin/env bash
# Deja listo el motor de video de Ethonik (HyperFrames) en un contenedor nuevo.
#
# Uso:  bash motor-video/instalar.sh
#
# Requisitos que NO instala: Node >= 22, ffmpeg/ffprobe y python3 (el contenedor ya los trae).
# No es interactivo. Qué hace:
#   1. npm ci: instala las versiones exactas de package-lock.json (hyperframes, gsap, @fontsource/inter).
#   2. numpy para la cama sonora (motor/audio.py): usa el del sistema si ya existe; si no, crea
#      un entorno virtual en motor-video/.venv con la versión de requirements.txt.
#   3. Navegador: usa CHROME_PATH, o el Chromium de Playwright de /opt/pw-browsers. Solo si no hay
#      ninguno descarga Chrome Headless Shell (ver LEEME.md: qué baja y de dónde).
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$AQUI"
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1
export npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false

falta() { echo "ERROR: $1" >&2; exit 1; }

# --- requisitos --------------------------------------------------------------------------
command -v node >/dev/null 2>&1    || falta "falta Node (se necesita >= 22)."
command -v npm >/dev/null 2>&1     || falta "falta npm."
command -v ffmpeg >/dev/null 2>&1  || falta "falta ffmpeg."
command -v ffprobe >/dev/null 2>&1 || falta "falta ffprobe."
command -v python3 >/dev/null 2>&1 || falta "falta python3."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || falta "se necesita Node >= 22 (hay $(node -v))."

# --- 1) dependencias de Node -------------------------------------------------------------
echo "[1/3] npm ci (versiones exactas de package-lock.json)…"
npm ci --no-audit --no-fund --loglevel=error

# --- 2) Python: numpy ---------------------------------------------------------------------
echo "[2/3] numpy para la cama sonora…"
if python3 -c "import numpy" 2>/dev/null; then
  echo "      numpy del sistema: $(python3 -c 'import numpy; print(numpy.__version__)')"
else
  if ! python3 -m venv .venv 2>/dev/null; then
    # Ubuntu/Debian traen venv en un paquete aparte; solo se puede instalar siendo root.
    if [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-venv >/dev/null
      python3 -m venv .venv
    else
      falta "no se pudo crear el entorno virtual (instala python3-venv) y tampoco hay numpy en el sistema."
    fi
  fi
  .venv/bin/pip install --quiet --disable-pip-version-check -r requirements.txt
  echo "      numpy en .venv: $(.venv/bin/python -c 'import numpy; print(numpy.__version__)')"
fi

# --- 3) navegador -------------------------------------------------------------------------
echo "[3/3] navegador…"
# shellcheck source=navegador.sh
source "$AQUI/navegador.sh"
elegir_navegador || exit 1
HF="$AQUI/node_modules/.bin/hyperframes"
if [ "$NAVEGADOR_ORIGEN" != "ninguno" ]; then
  echo "      usando $HYPERFRAMES_BROWSER_PATH  [$NAVEGADOR_ORIGEN]; no se descarga nada."
else
  echo "      sin CHROME_PATH ni Chromium de Playwright: se usa el Chrome Headless Shell de HyperFrames."
  # Librerías del sistema que necesita Chrome en Linux (mismas que el Dockerfile oficial de HyperFrames)
  if [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
    ASOUND=libasound2; apt-cache show libasound2t64 >/dev/null 2>&1 && ASOUND=libasound2t64
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates unzip libgbm1 libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
      libxrandr2 libcups2 "$ASOUND" libpangocairo-1.0-0 libxshmfence1 libgtk-3-0 fonts-liberation fontconfig >/dev/null
  fi
  # No descarga nada si ya está en caché; solo baja Chrome (storage.googleapis.com) si falta.
  "$HF" browser ensure
fi

echo "listo. Prueba: bash motor-video/render.sh motor-video/ejemplos/guion-2026-10-19.json /tmp/salida"
