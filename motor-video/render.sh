#!/usr/bin/env bash
# Motor de video de Ethonik (HyperFrames): renderiza los videos de un guion.json.
#
# Uso:  bash motor-video/render.sh <guion.json> <carpeta-salida> [--modo claro|oscuro]
#
# Por cada video del guion deja <carpeta-salida>/<id>.mp4 (el mismo nombre que genera motor/video.py):
# 1080x1920, 30 fps, H.264, yuv420p, AAC, +faststart, duración = suma de las escenas.
# No es interactivo. Variables opcionales:
#   CHROME_PATH   ejecutable de Chrome/Chromium a usar (no se descarga nada).
#                 Si no está, se busca el Chromium de Playwright en /opt/pw-browsers; solo si no hay
#                 ninguno se descarga Chrome (ver LEEME.md).
#   MARCA         ruta a marca.json (por defecto ../motor/marca.json)
#   HF_WORKERS    procesos de captura en paralelo (por defecto, automático)
#   MOTOR_VIDEO_CONSERVAR=1   no borra la carpeta de trabajo temporal (para depurar)
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USO="uso: bash motor-video/render.sh <guion.json> <carpeta-salida> [--modo claro|oscuro]"

# --- argumentos -----------------------------------------------------------------------
GUION=""; SALIDA=""; MODO="oscuro"
while [ $# -gt 0 ]; do
  case "$1" in
    --modo) [ $# -ge 2 ] || { echo "falta el valor de --modo. $USO" >&2; exit 2; }; MODO="$2"; shift 2 ;;
    --modo=*) MODO="${1#--modo=}"; shift ;;
    -h|--help) echo "$USO"; exit 0 ;;
    -*) echo "opción desconocida: $1. $USO" >&2; exit 2 ;;
    *) if [ -z "$GUION" ]; then GUION="$1"; elif [ -z "$SALIDA" ]; then SALIDA="$1"
       else echo "sobran argumentos: $1. $USO" >&2; exit 2; fi; shift ;;
  esac
done
[ -n "$GUION" ] && [ -n "$SALIDA" ] || { echo "$USO" >&2; exit 2; }
case "$MODO" in claro|oscuro) ;; *) echo "--modo debe ser claro u oscuro (recibí \"$MODO\")" >&2; exit 2 ;; esac
[ -f "$GUION" ] || { echo "no existe el guion: $GUION" >&2; exit 2; }
GUION="$(cd "$(dirname "$GUION")" && pwd)/$(basename "$GUION")"
mkdir -p "$SALIDA"; SALIDA="$(cd "$SALIDA" && pwd)"

# --- dependencias ----------------------------------------------------------------------
for bin in node ffmpeg ffprobe python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "falta '$bin'. Corre: bash motor-video/instalar.sh" >&2; exit 1; }
done
HF="$AQUI/node_modules/.bin/hyperframes"
[ -x "$HF" ] || { echo "no está instalado HyperFrames. Corre: bash motor-video/instalar.sh" >&2; exit 1; }
PY="$AQUI/.venv/bin/python"; [ -x "$PY" ] || PY="python3"
"$PY" -c "import numpy" 2>/dev/null || { echo "falta numpy para la cama sonora. Corre: bash motor-video/instalar.sh" >&2; exit 1; }

# Sin telemetría ni avisos de actualización: el contenedor tiene la red restringida.
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1

# --- navegador ---------------------------------------------------------------------------
# shellcheck source=navegador.sh
source "$AQUI/navegador.sh"
elegir_navegador || exit 1
if [ "$NAVEGADOR_ORIGEN" = "ninguno" ]; then
  # Sin CHROME_PATH ni Chromium de Playwright: se usa el Chrome Headless Shell de HyperFrames.
  # `browser ensure` no descarga nada si ya está en caché (~/.cache/hyperframes); solo baja Chrome si falta.
  # (`browser path` no sirve para decidir: también devuelve el Chrome del sistema, que `render` no usa sin override.)
  "$HF" browser ensure >&2 </dev/null || { echo "ERROR: no hay Chrome disponible y no se pudo descargar (ver LEEME.md)." >&2; exit 1; }
  echo "navegador: el de HyperFrames ($("$HF" browser path 2>/dev/null | tail -n 1))"
else
  echo "navegador: $HYPERFRAMES_BROWSER_PATH  [$NAVEGADOR_ORIGEN]"
fi

# Navegador con el que construir.mjs mide el texto (el mismo que renderiza).
if [ "$NAVEGADOR_ORIGEN" = "ninguno" ]; then
  MOTOR_VIDEO_CHROME="$("$HF" browser path 2>/dev/null | tail -n 1)"
else
  MOTOR_VIDEO_CHROME="$HYPERFRAMES_BROWSER_PATH"
fi
export MOTOR_VIDEO_CHROME

# --- construir los proyectos -----------------------------------------------------------
TRABAJO="$(mktemp -d "${TMPDIR:-/tmp}/motor-video.XXXXXX")"
if [ "${MOTOR_VIDEO_CONSERVAR:-0}" = "1" ]; then echo "carpeta de trabajo: $TRABAJO"; else trap 'rm -rf "$TRABAJO"' EXIT; fi

MARCA="${MARCA:-$AQUI/../motor/marca.json}"
echo "construyendo ($MODO)…"
node "$AQUI/construir.mjs" --guion "$GUION" --marca "$MARCA" --modo "$MODO" --trabajo "$TRABAJO"

# --- renderizar y verificar cada video -------------------------------------------------
FALLOS=0
while IFS=$'\t' read -r ID DIR TOTAL <&3; do
  [ -n "$ID" ] || continue
  echo "[$ID] cama sonora…"
  "$PY" "$AQUI/cama.py" "$DIR/cama.json" </dev/null

  echo "[$ID] renderizando ${TOTAL} s…"
  LOG="$TRABAJO/$ID.render.log"
  ARGS=(render "$DIR" -o "$SALIDA/$ID.mp4" --fps 30 --quiet --strict --no-best-effort)
  [ -n "${HF_WORKERS:-}" ] && ARGS+=(--workers "$HF_WORKERS")
  if ! ( cd "$DIR" && "$HF" "${ARGS[@]}" ) >"$LOG" 2>&1 </dev/null; then
    echo "[$ID] ERROR: el render falló. Últimas líneas del registro:" >&2
    sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' "$LOG" | tail -n 25 >&2
    FALLOS=$((FALLOS + 1)); continue
  fi

  echo "[$ID] verificando $SALIDA/$ID.mp4"
  if ! "$PY" "$AQUI/verificar.py" "$SALIDA/$ID.mp4" --duracion "$TOTAL" --arreglar-faststart </dev/null; then
    echo "[$ID] ERROR: el video no cumple el contrato de salida." >&2
    FALLOS=$((FALLOS + 1))
  fi
done 3< "$TRABAJO/lista.tsv"

[ "$FALLOS" -eq 0 ] || { echo "$FALLOS video(s) con error." >&2; exit 1; }
echo "listo: $SALIDA"
