#!/usr/bin/env python3
"""
Generador de video vertical de marca — Ethonik
----------------------------------------------
Convierte un guion en JSON en un MP4 9:16 listo para TikTok, Reels y Shorts.
Sin cámara, sin modelos de generación de video: renderiza escenas con la
identidad de Ethonik (mismo motor que las imágenes) y las ensambla con ffmpeg.

Uso:
    python3 video.py guion.json
    python3 video.py guion.json --salida ./salida

Formato del guion:
{
  "id": "slug-del-video",
  "escenas": [
    {"tipo":"gancho",    "duracion":3, "texto":"Frase que detiene el scroll"},
    {"tipo":"punto",     "duracion":9, "texto":"Idea principal", "apoyo":"Dato o matiz"},
    {"tipo":"punto",     "duracion":9, "texto":"...", "apoyo":"..."},
    {"tipo":"punto",     "duracion":9, "texto":"...", "apoyo":"..."},
    {"tipo":"cierre",    "duracion":5, "texto":"Cierre", "cta":"ethonik.com"}
  ]
}

El video sale mudo a propósito: la mayoría ve TikTok sin audio y el texto
en pantalla es el que carga el mensaje. Si quieres música, pásala con --audio.
"""

import argparse
import json
import pathlib
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

import render as R

RAIZ = pathlib.Path(__file__).resolve().parent
ANCHO, ALTO = 1080, 1920
FPS = 30
TRANSICION = 0.45  # segundos de fundido entre escenas


# --------------------------------------------------------------------------
# escenas
# --------------------------------------------------------------------------

def html_escena(m, esc, indice, total):
    """Una escena a pantalla completa, sobre el fondo abstracto de marca."""
    mo = m["modos"]["oscuro"]
    tipo = esc.get("tipo", "punto")
    fondo = R.canvas_fondo(m, esc.get("semilla", 1000 + indice * 137), ANCHO, ALTO)
    logo = R.bloque_logo(m, "oscuro")
    grad = m["gradiente_titulo_oscuro"]

    # progreso: cuánto falta del video
    pct = int(indice / max(total - 1, 1) * 100)

    if tipo == "gancho":
        cuerpo = f"""
  <div class="esp"></div>
  <div class="titular" style="font-size:120px;line-height:.97">{R.esc(esc["texto"])}</div>
  <div class="esp"></div>"""
    elif tipo == "cierre":
        cuerpo = f"""
  <div class="esp"></div>
  <div class="titular" style="font-size:96px">{R.esc(esc["texto"])}</div>
  <div style="height:44px"></div>
  <div class="cta">{R.esc(esc.get("cta", m["sitio"]))}</div>
  <div class="esp"></div>"""
    else:
        cuerpo = f"""
  <div class="esp"></div>
  <div style="font-size:86px;font-weight:900;line-height:1.06;color:{mo["texto"]};text-wrap:balance">
    {R.esc(esc["texto"])}</div>
  {f'<div style="height:38px"></div><div style="font-size:46px;font-weight:600;line-height:1.3;color:{m["colores"]["lima"]};text-wrap:balance">{R.esc(esc.get("apoyo"))}</div>' if esc.get("apoyo") else ''}
  <div class="esp"></div>"""

    barra = f"""
  <div style="width:100%;height:8px;border-radius:999px;background:rgba(255,255,255,.16);overflow:hidden">
    <div style="width:{pct}%;height:100%;background:{m["colores"]["lima"]}"></div>
  </div>"""

    css = R.css(m, "oscuro", ANCHO, ALTO).replace(
        f'padding:{m["layout"]["margen"]}px', "padding:110px"
    )
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>{css}
.lienzo{{padding:110px 90px 120px}}
.titular{{font-size:110px}}
</style></head><body>
<div class="lienzo">
  {fondo}
  <div class="velo velo-suave"></div>
  {logo}
  {cuerpo}
  {barra}
</div></body></html>"""


def render_escenas(m, guion, destino: pathlib.Path):
    escenas = guion["escenas"]
    salidas = []
    with sync_playwright() as pw:
        nav = pw.chromium.launch(executable_path=R.CHROMIUM, args=["--font-render-hinting=none"])
        for i, esc in enumerate(escenas):
            pag = nav.new_page(viewport={"width": ANCHO, "height": ALTO}, device_scale_factor=1)
            pag.set_content(html_escena(m, esc, i, len(escenas)), wait_until="load")
            pag.wait_for_timeout(140)
            ruta = destino / f"escena_{i:02d}.png"
            pag.screenshot(path=str(ruta))
            pag.close()
            salidas.append((ruta, float(esc.get("duracion", 8))))
            print(f"  · escena {i+1}/{len(escenas)}  {esc.get('tipo','punto'):8s} {esc.get('duracion',8)}s")
        nav.close()
    return salidas


# --------------------------------------------------------------------------
# ensamblado
# --------------------------------------------------------------------------

def ensamblar(escenas, salida: pathlib.Path, audio: str | None):
    """
    Cada escena entra con un empuje lento (zoompan) y se encadena a la siguiente
    con un fundido. El empuje evita el efecto de diapositiva estática, que es lo
    que más penaliza el alcance en video vertical.
    """
    entradas, filtros = [], []
    for i, (ruta, dur) in enumerate(escenas):
        # Una sola imagen de entrada: zoompan genera los `cuadros` de salida.
        # Con -loop 1 el filtro se aplicaría a cada cuadro de entrada y el
        # render se vuelve cuadrático — es el error clásico de este filtro.
        entradas += ["-i", str(ruta)]
        cuadros = int(dur * FPS)
        filtros.append(
            f"[{i}:v]scale={int(ANCHO*1.25)}:{int(ALTO*1.25)}:flags=bicubic,"
            f"zoompan=z='min(zoom+0.00045,1.09)':d={cuadros}:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={ANCHO}x{ALTO}:fps={FPS},"
            f"setsar=1[v{i}]"
        )

    # cadena de fundidos
    if len(escenas) == 1:
        cadena, ultimo = "", "v0"
    else:
        partes, desplazamiento, ultimo = [], 0.0, "v0"
        for i in range(1, len(escenas)):
            desplazamiento += escenas[i-1][1] - TRANSICION
            etiqueta = f"x{i}"
            partes.append(
                f"[{ultimo}][v{i}]xfade=transition=fade:duration={TRANSICION}:"
                f"offset={desplazamiento:.2f}[{etiqueta}]"
            )
            ultimo = etiqueta
        cadena = ";" + ";".join(partes)

    filtro = ";".join(filtros) + cadena
    cmd = ["ffmpeg", "-y", *entradas]
    if audio:
        cmd += ["-i", audio]
    cmd += [
        "-filter_complex", filtro,
        "-map", f"[{ultimo}]",
    ]
    if audio:
        cmd += ["-map", f"{len(escenas)}:a", "-shortest", "-c:a", "aac", "-b:a", "128k"]
    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-r", str(FPS), "-crf", "21", "-movflags", "+faststart",
        str(salida),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr[-2500:], file=sys.stderr)
        raise RuntimeError("ffmpeg falló")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("guion")
    ap.add_argument("--marca", default=str(RAIZ / "marca.json"))
    ap.add_argument("--salida", default=str(RAIZ / "salida"))
    ap.add_argument("--audio", default="auto",
                    help='Pista de audio: "auto" genera una cama sintetizada (por defecto), '
                         'una ruta usa tu archivo, "mudo" deja el video sin sonido.')
    args = ap.parse_args()

    m = json.loads(pathlib.Path(args.marca).read_text(encoding="utf-8"))
    guiones = json.loads(pathlib.Path(args.guion).read_text(encoding="utf-8"))
    if isinstance(guiones, dict) and "escenas" in guiones:
        guiones = [guiones]
    elif isinstance(guiones, dict):
        guiones = guiones.get("videos", [])

    destino = pathlib.Path(args.salida)
    destino.mkdir(parents=True, exist_ok=True)

    for g in guiones:
        nombre = R.slug(g.get("id") or g["escenas"][0]["texto"])
        total = sum(float(e.get("duracion", 8)) for e in g["escenas"])
        print(f"\n{nombre}  —  {len(g['escenas'])} escenas, {total:.0f}s")
        with tempfile.TemporaryDirectory() as tmp:
            escenas = render_escenas(m, g, pathlib.Path(tmp))

            audio = None if args.audio == "mudo" else args.audio
            if args.audio == "auto":
                import audio as A
                # el video dura la suma de escenas menos los solapes de fundido
                dur = total - TRANSICION * (len(escenas) - 1)
                acentos, acum = [], 0.0
                for _, d in escenas[:-1]:
                    acum += d - TRANSICION
                    acentos.append(acum)
                audio = str(pathlib.Path(tmp) / "cama.wav")
                A.generar_cama(dur, acentos, audio, bpm=g.get("bpm", 88))
                print("  · cama sonora sintetizada")

            mp4 = destino / f"{nombre}.mp4"
            ensamblar(escenas, mp4, audio)
        mb = mp4.stat().st_size / 1e6
        print(f"  ✓ {mp4.name}  ({ANCHO}x{ALTO}, {mb:.1f} MB)")


if __name__ == "__main__":
    main()
