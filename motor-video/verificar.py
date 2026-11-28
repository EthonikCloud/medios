#!/usr/bin/env python3
"""
Verifica con ffprobe que un MP4 cumple el contrato de salida de motor-video.

Contrato: 1080x1920, 30 fps, H.264, yuv420p, con pista de audio AAC, +faststart
(átomo moov antes que mdat) y duración igual a la suma de escenas (±0,1 s).

Uso:  python3 verificar.py video.mp4 --duracion 35.5 [--arreglar-faststart]
Sale con código 0 si todo cumple y 1 si algo falla. Solo usa la biblioteca estándar.
"""
import argparse
import json
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile


def ffprobe(ruta):
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(ruta)],
        capture_output=True, text=True,
    )
    if p.returncode != 0:
        sys.exit(f"ffprobe falló: {p.stderr.strip()}")
    return json.loads(p.stdout)


def atomos(ruta):
    """Átomos de primer nivel del MP4, en orden: [(tipo, posición)]."""
    salida = []
    tam_total = os.path.getsize(ruta)
    with open(ruta, "rb") as f:
        pos = 0
        while pos + 8 <= tam_total:
            f.seek(pos)
            cab = f.read(8)
            if len(cab) < 8:
                break
            tam, tipo = struct.unpack(">I4s", cab)
            if tam == 1:
                tam = struct.unpack(">Q", f.read(8))[0]
            elif tam == 0:
                tam = tam_total - pos
            salida.append((tipo.decode("latin-1"), pos))
            if tam < 8:
                break
            pos += tam
    return salida


def faststart(ruta):
    orden = [t for t, _ in atomos(ruta)]
    return "moov" in orden and "mdat" in orden and orden.index("moov") < orden.index("mdat")


def arreglar_faststart(ruta):
    """Reubica moov al inicio sin recodificar (-c copy)."""
    tmp = pathlib.Path(tempfile.mkdtemp()) / "fs.mp4"
    p = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(ruta), "-c", "copy", "-movflags", "+faststart", str(tmp)],
        capture_output=True, text=True,
    )
    if p.returncode != 0:
        sys.exit(f"ffmpeg no pudo aplicar +faststart: {p.stderr.strip()}")
    shutil.move(str(tmp), str(ruta))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--duracion", type=float, required=True, help="suma de las escenas, en segundos")
    ap.add_argument("--tolerancia", type=float, default=0.1)
    ap.add_argument("--arreglar-faststart", action="store_true")
    a = ap.parse_args()

    info = ffprobe(a.video)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    au = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    dur = float(info["format"].get("duration", 0))
    fs = faststart(a.video)
    if not fs and a.arreglar_faststart:
        arreglar_faststart(a.video)
        fs = faststart(a.video)
        info = ffprobe(a.video)
        dur = float(info["format"].get("duration", 0))

    def fps(s):
        n, _, d = s.get("avg_frame_rate", "0/1").partition("/")
        return float(n) / float(d or 1) if float(d or 1) else 0.0

    filas = []
    filas.append(("resolución", f"{v['width']}x{v['height']}" if v else "—", bool(v) and (v["width"], v["height"]) == (1080, 1920)))
    filas.append(("fps", f"{fps(v):.3f}" if v else "—", bool(v) and abs(fps(v) - 30) < 0.01))
    filas.append(("códec de video", v["codec_name"] if v else "—", bool(v) and v["codec_name"] == "h264"))
    filas.append(("formato de píxel", v.get("pix_fmt", "—") if v else "—", bool(v) and v.get("pix_fmt") == "yuv420p"))
    filas.append(("audio", f"{au['codec_name']} {au.get('sample_rate','?')} Hz" if au else "SIN AUDIO", bool(au) and au["codec_name"] == "aac"))
    filas.append(("+faststart (moov antes de mdat)", "sí" if fs else "no", fs))
    filas.append(("duración", f"{dur:.3f} s (esperado {a.duracion:.3f} ±{a.tolerancia})", abs(dur - a.duracion) <= a.tolerancia))

    ok = all(f[2] for f in filas)
    for nombre, valor, bien in filas:
        print(f"  {'✓' if bien else '✗'} {nombre:<34} {valor}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
