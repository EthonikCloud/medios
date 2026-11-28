#!/usr/bin/env python3
"""
Genera la cama sonora de un video con motor/audio.py (sin modificarlo) y la deja a -18 LUFS integrados.

Uso:  python3 cama.py trabajo/<id>/cama.json
El JSON lo escribe construir.mjs: {"duracion": s, "acentos": [s, ...], "destino": ruta.wav, "bpm": 88}

Normalización: se mide la cama con ffmpeg (filtro ebur128: sonoridad integrada y pico verdadero) y se aplica una
ganancia fija para llegar a OBJETIVO_LUFS. Si esa ganancia hiciera pasar el pico verdadero de PICO_MAX_DBTP, se
reduce hasta quedar justo en el techo (la sonoridad queda entonces por debajo del objetivo y se avisa).
"""
import json
import pathlib
import re
import subprocess
import sys

RAIZ = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ.parent / "motor"))

from audio import generar_cama  # noqa: E402  (motor/audio.py; requiere numpy)

OBJETIVO_LUFS = -18.0   # sonoridad integrada objetivo
PICO_MAX_DBTP = -1.0    # techo de pico verdadero (el AAC final puede añadir unas décimas: se mide en el MP4)


def medir(ruta):
    """(LUFS integrados, pico verdadero en dBTP) de un audio, con el filtro ebur128 de ffmpeg."""
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(ruta), "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    resumen = p.stderr.split("Summary:")[-1]
    i = re.search(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", resumen)
    t = re.search(r"Peak:\s+(-?\d+(?:\.\d+)?) dBFS", resumen)
    if p.returncode != 0 or not i or not t:
        sys.exit(f"no pude medir la sonoridad de {ruta}:\n{p.stderr[-800:]}")
    return float(i.group(1)), float(t.group(1))


def normalizar(ruta):
    ruta = pathlib.Path(ruta)
    lufs, pico = medir(ruta)
    ganancia = OBJETIVO_LUFS - lufs
    limitada = pico + ganancia > PICO_MAX_DBTP
    if limitada:
        ganancia = PICO_MAX_DBTP - pico
    tmp = ruta.with_suffix(".norm.wav")
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", str(ruta), "-af", f"volume={ganancia:.3f}dB",
         "-c:a", "pcm_s16le", str(tmp)],
        capture_output=True, text=True,
    )
    if p.returncode != 0:
        sys.exit(f"ffmpeg no pudo normalizar la cama:\n{p.stderr[-800:]}")
    tmp.replace(ruta)
    lufs2, pico2 = medir(ruta)
    aviso = "  (limitada por el techo de pico)" if limitada else ""
    print(f"  · cama normalizada: {lufs:.1f} → {lufs2:.1f} LUFS, pico verdadero {pico2:.1f} dBTP{aviso}")
    return lufs2, pico2


def main():
    if len(sys.argv) != 2:
        sys.exit("uso: cama.py <cama.json>")
    p = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    destino = pathlib.Path(p["destino"])
    destino.parent.mkdir(parents=True, exist_ok=True)
    generar_cama(float(p["duracion"]), [float(a) for a in p["acentos"]], str(destino), bpm=p.get("bpm", 88))
    print(f"  · cama sonora: {destino.name} ({p['duracion']} s, {len(p['acentos'])} acentos)")
    normalizar(destino)


if __name__ == "__main__":
    main()
