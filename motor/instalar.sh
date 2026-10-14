#!/usr/bin/env bash
# Reconstruye el motor de imágenes y video de Ethonik en un contenedor nuevo.
# Las tareas programadas arrancan con el disco vacío: esto lo deja listo en ~40 s.
#
# Uso:  bash instalar.sh <carpeta-destino>
#       (los .py, marca.json y los .svg deben estar ya en la carpeta,
#        traídos del proyecto con project_read)
set -euo pipefail
DEST="${1:-$HOME/motor-ethonik}"
cd "$DEST"

mkdir -p fuentes logos salida

# Tipografía Inter: viene de npm, no de Google Fonts (no requiere red a fonts.googleapis).
if [ ! -f fuentes/inter-latin-400-normal.woff2 ]; then
  npm pack @fontsource/inter --pack-destination fuentes >/dev/null 2>&1
  ( cd fuentes && tar xzf fontsource-inter-*.tgz \
      && cp package/files/inter-latin-{400,600,700,900}-normal.woff2 . \
      && rm -rf package fontsource-inter-*.tgz )
fi

# Los logos llegan del proyecto como logo_principal_*.svg y van en logos/
for f in logo_principal_color.svg logo_principal_blanco.svg; do
  [ -f "$f" ] && mv -f "$f" logos/ || true
done

python3 -c "import playwright" 2>/dev/null || pip install playwright --break-system-packages -q
python3 -c "import numpy"     2>/dev/null || pip install numpy      --break-system-packages -q
command -v ffmpeg >/dev/null || { echo "AVISO: falta ffmpeg, el video no se podrá ensamblar"; }

echo "Motor listo en $DEST"
echo "  imágenes: python3 render.py contenido.json --salida salida"
echo "  video:    python3 video.py guion.json --salida salida"
