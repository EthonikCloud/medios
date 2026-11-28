#!/usr/bin/env bash
# Elige el Chrome/Chromium con el que HyperFrames renderiza. Se carga con `source` desde
# render.sh e instalar.sh. No descarga nada: solo decide y exporta HYPERFRAMES_BROWSER_PATH.
#
# Orden de decisión:
#   1. CHROME_PATH definida  -> se usa ese ejecutable (si no existe, error: no se cae a otro).
#   2. HYPERFRAMES_BROWSER_PATH / PRODUCER_HEADLESS_SHELL_PATH ya definidas -> se respetan.
#   3. Existe /opt/pw-browsers (o $PLAYWRIGHT_BROWSERS_PATH) -> se busca ahí el Chromium de Playwright.
#   4. Nada de lo anterior -> NAVEGADOR_ORIGEN="ninguno": la CLI usará su caché o Chrome del sistema,
#      y solo si no hay ninguno (ver `hyperframes browser path`) se descarga con `browser ensure`.
#
# HYPERFRAMES_BROWSER_PATH es la variable que lee HyperFrames 0.8.191 para usar un ejecutable propio
# (alias: PRODUCER_HEADLESS_SHELL_PATH). Si el archivo no existe, la CLI falla en vez de descargar.

NAVEGADOR_ORIGEN=""

_nav_ejecutable() { [ -f "$1" ] && [ -x "$1" ]; }

# Elige el ejecutable más nuevo entre los que coinciden con los patrones (orden de versión).
_nav_mas_nuevo() {
  local f
  for f in "$@"; do _nav_ejecutable "$f" && printf '%s\n' "$f"; done | sort -V | tail -n 1
}

_nav_buscar_playwright() {
  local raiz="${1}" hallado
  [ -d "$raiz" ] || return 1
  shopt -s nullglob
  # 0) algunos contenedores dejan un ejecutable o enlace directo en <raiz>/chromium
  if _nav_ejecutable "$raiz/chromium"; then printf '%s\n' "$raiz/chromium"; shopt -u nullglob; return 0; fi
  # 1) headless shell (es el binario con el que HyperFrames hace captura determinista)
  hallado="$(_nav_mas_nuevo \
    "$raiz"/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell \
    "$raiz"/chromium_headless_shell-*/chrome-linux*/headless_shell \
    "$raiz"/chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell)"
  # 2) Chromium completo
  [ -n "$hallado" ] || hallado="$(_nav_mas_nuevo \
    "$raiz"/chromium-*/chrome-linux*/chrome \
    "$raiz"/chromium-*/chrome-mac*/*.app/Contents/MacOS/*)"
  shopt -u nullglob
  [ -n "$hallado" ] || return 1
  printf '%s\n' "$hallado"
}

elegir_navegador() {
  NAVEGADOR_ORIGEN=""
  if [ -n "${CHROME_PATH:-}" ]; then
    if ! _nav_ejecutable "$CHROME_PATH"; then
      echo "ERROR: CHROME_PATH=\"$CHROME_PATH\" no existe o no es ejecutable." >&2
      return 1
    fi
    export HYPERFRAMES_BROWSER_PATH="$CHROME_PATH"
    NAVEGADOR_ORIGEN="CHROME_PATH"
    return 0
  fi
  local previa="${HYPERFRAMES_BROWSER_PATH:-${PRODUCER_HEADLESS_SHELL_PATH:-}}"
  if [ -n "$previa" ]; then
    if ! _nav_ejecutable "$previa"; then
      echo "ERROR: HYPERFRAMES_BROWSER_PATH=\"$previa\" no existe o no es ejecutable." >&2
      return 1
    fi
    export HYPERFRAMES_BROWSER_PATH="$previa"
    NAVEGADOR_ORIGEN="HYPERFRAMES_BROWSER_PATH"
    return 0
  fi
  local raiz hallado
  for raiz in "${PLAYWRIGHT_BROWSERS_PATH:-}" /opt/pw-browsers; do
    [ -n "$raiz" ] || continue
    if hallado="$(_nav_buscar_playwright "$raiz")" && [ -n "$hallado" ]; then
      export HYPERFRAMES_BROWSER_PATH="$hallado"
      NAVEGADOR_ORIGEN="Playwright ($raiz)"
      return 0
    fi
  done
  NAVEGADOR_ORIGEN="ninguno"
  return 0
}
