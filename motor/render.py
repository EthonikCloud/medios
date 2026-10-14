#!/usr/bin/env python3
"""
Motor de imágenes de marca — Ethonik
------------------------------------
Convierte un JSON de contenido (lo que produce el radar semanal) en PNG listos
para publicar, aplicando la identidad real de Ethonik definida en marca.json.

Uso:
    python3 render.py contenido.json
    python3 render.py contenido.json --salida ./salida

Tipos de lámina:
    lista    logo + antetítulo + titular en gradiente + bajada + píldoras numeradas
    titular  igual pero sin píldoras (portada de carrusel)
    cierre   titular + CTA
    dato     cifra grande en gradiente + titular + fuente obligatoria
    foto     imagen del banco con velo y capa de texto

Cada pieza declara modo: "claro" u "oscuro".
Ningún texto se inventa aquí: todo sale del JSON de contenido.
"""

import argparse
import base64
import json
import mimetypes
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

RAIZ = pathlib.Path(__file__).resolve().parent
CHROMIUM = "/opt/pw-browsers/chromium"


def data_uri(ruta: pathlib.Path) -> str:
    tipo = mimetypes.guess_type(ruta.name)[0] or "application/octet-stream"
    if ruta.suffix == ".woff2":
        tipo = "font/woff2"
    if ruta.suffix == ".svg":
        tipo = "image/svg+xml"
    return f"data:{tipo};base64," + base64.b64encode(ruta.read_bytes()).decode()


def esc(t) -> str:
    if t is None:
        return ""
    return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def negrita(t) -> str:
    """**texto** -> <b>texto</b>, aplicado después de escapar."""
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", esc(t))


def slug(t: str) -> str:
    t = re.sub(r"[^a-zA-Z0-9]+", "-", (t or "").lower()).strip("-")
    return t[:60] or "pieza"


def resolver(ruta: str) -> pathlib.Path:
    p = pathlib.Path(ruta)
    return p if p.is_absolute() else (RAIZ / p)


# --------------------------------------------------------------------------
# CSS
# --------------------------------------------------------------------------

def css(m, modo_nombre, ancho, alto):
    mo = m["modos"][modo_nombre]
    L = m["layout"]
    caras = "\n".join(
        f"@font-face{{font-family:'{f['familia']}';font-weight:{f['peso']};font-style:normal;"
        f"src:url('{data_uri(resolver(f['archivo']))}') format('woff2');}}"
        for f in m["tipografia"]["archivos"] if resolver(f["archivo"]).exists()
    )
    grad = m["gradiente_titulo_oscuro"] if modo_nombre == "oscuro" else m["gradiente_titulo"]
    return f"""
{caras}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:{ancho}px;height:{alto}px}}
body{{
  font-family:'{m["tipografia"]["familia"]}',system-ui,sans-serif;
  background:{mo["fondo"]};color:{mo["texto"]};
  -webkit-font-smoothing:antialiased;overflow:hidden;
}}
.lienzo{{
  position:relative;width:{ancho}px;height:{alto}px;
  padding:{L["margen"]}px {L["margen"]}px {int(L["margen"]*0.72)}px;
  display:flex;flex-direction:column;align-items:center;text-align:center;
}}
.logo{{height:{L["logo_alto"]}px;width:auto;flex:none}}
.antetitulo{{
  font-size:{L["antetitulo_px"]}px;font-weight:900;text-transform:uppercase;
  letter-spacing:.005em;line-height:1.1;color:{mo["texto"]};text-wrap:balance;
}}
.titular{{
  font-size:{L["titulo_px"]}px;font-weight:900;text-transform:uppercase;
  line-height:.98;letter-spacing:-.015em;text-wrap:balance;
  background:{grad};-webkit-background-clip:text;background-clip:text;color:transparent;
}}
.bajada{{
  font-size:{L["bajada_px"]}px;font-weight:500;line-height:1.32;
  color:{mo["texto"]};max-width:86%;text-wrap:balance;
}}
.items{{display:flex;flex-direction:column;gap:26px;width:100%}}
.item{{
  display:flex;align-items:stretch;border-radius:999px;overflow:hidden;
  background:{mo["pildora_fondo"]};min-height:118px;text-align:left;
}}
.item .cap{{
  flex:none;width:118px;background:{mo["cap"]};
  display:flex;align-items:center;justify-content:center;
}}
.item .cap span{{
  display:flex;align-items:center;justify-content:center;
  width:58px;height:58px;border:3px solid rgba(255,255,255,.85);border-radius:12px;
  font-size:24px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;
}}
.item .txt{{
  padding:20px 40px 20px 26px;display:flex;align-items:center;
  font-size:{L["item_px"]}px;line-height:1.34;color:{mo["pildora_texto"]};font-weight:400;
}}
.item .txt b{{font-weight:700;color:{mo["pildora_titulo"]}}}
.pie{{font-size:{L["pie_px"]}px;font-weight:400;color:{mo["pie"]};letter-spacing:.01em}}
.esp{{flex:1}}
.cta{{
  display:inline-block;padding:22px 46px;border-radius:999px;
  background:{m["colores"]["lima"]};color:{m["colores"]["bosque_profundo"]};
  font-size:30px;font-weight:700;letter-spacing:.01em;
}}
.fuente{{
  width:100%;border-top:2px solid {mo["pildora_fondo"]};padding-top:22px;
  font-size:23px;line-height:1.35;color:{mo["texto_suave"]};text-align:left;
}}
.fuente b{{color:{mo["texto"]};font-weight:700}}
.cifra{{
  font-size:230px;font-weight:900;line-height:.9;letter-spacing:-.03em;
  font-variant-numeric:tabular-nums;
  background:{grad};-webkit-background-clip:text;background-clip:text;color:transparent;
}}
.foto{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}}
.velo{{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,16,12,.42) 0%,rgba(7,16,12,.72) 48%,rgba(7,16,12,.94) 100%)}}
.velo-suave{{background:linear-gradient(180deg,rgba(7,16,12,.55) 0%,rgba(7,16,12,.30) 40%,rgba(7,16,12,.78) 100%)}}
.lienzo>*{{position:relative;z-index:2}}
"""


# --------------------------------------------------------------------------
# láminas
# --------------------------------------------------------------------------

def canvas_fondo(m, semilla, ancho, alto):
    """
    Fondo abstracto generado con el sistema visual del Brand Book (pág. 10):
    nodos y líneas, arcos circulares, ondas sutiles. Sin fotografía de stock,
    sin modelos de imagen. La semilla hace el resultado reproducible.
    """
    c = m["colores"]
    return f"""
<canvas id="bg" width="{ancho}" height="{alto}"
        style="position:absolute;inset:0;width:{ancho}px;height:{alto}px;z-index:0"></canvas>
<script>
(function(){{
  var s = {int(semilla)} >>> 0;
  function r(){{ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }}
  var W = {ancho}, H = {alto};
  var cv = document.getElementById('bg'), x = cv.getContext('2d');

  x.fillStyle = '{c["fondo_oscuro"]}'; x.fillRect(0, 0, W, H);

  // resplandor: continuidad y ciclo
  var gx = W * (0.30 + r() * 0.40), gy = H * (0.42 + r() * 0.26);
  var g = x.createRadialGradient(gx, gy, 0, gx, gy, H * 0.62);
  g.addColorStop(0,   'rgba(46,125,50,0.36)');
  g.addColorStop(0.45,'rgba(46,125,50,0.13)');
  g.addColorStop(1,   'rgba(7,16,12,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  // arcos circulares
  for (var i = 0; i < 7; i++) {{
    var rad = H * (0.16 + i * 0.085), a0 = r() * 6.28, a1 = a0 + 1.1 + r() * 2.6;
    x.beginPath(); x.arc(gx, gy, rad, a0, a1);
    x.strokeStyle = 'rgba(149,224,0,' + (0.05 + r() * 0.13).toFixed(3) + ')';
    x.lineWidth = 1 + r() * 2; x.stroke();
  }}

  // ondas sutiles
  for (var w = 0; w < 4; w++) {{
    var base = H * (0.30 + w * 0.16), amp = 26 + r() * 54;
    x.beginPath(); x.moveTo(0, base);
    for (var px = 0; px <= W; px += 12) {{
      x.lineTo(px, base + Math.sin(px / (150 + w * 60) + w * 1.7) * amp);
    }}
    x.strokeStyle = 'rgba(46,125,50,' + (0.10 + r() * 0.10).toFixed(3) + ')';
    x.lineWidth = 1.4; x.stroke();
  }}

  // nodos y líneas: datos, flujos y conocimiento
  var n = [], N = 34;
  for (var k = 0; k < N; k++) n.push({{ x: r() * W, y: r() * H }});
  for (var a = 0; a < N; a++) for (var b = a + 1; b < N; b++) {{
    var dx = n[a].x - n[b].x, dy = n[a].y - n[b].y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 250) {{
      x.beginPath(); x.moveTo(n[a].x, n[a].y); x.lineTo(n[b].x, n[b].y);
      x.strokeStyle = 'rgba(149,224,0,' + (0.13 * (1 - d / 250)).toFixed(3) + ')';
      x.lineWidth = 1; x.stroke();
    }}
  }}
  for (var k2 = 0; k2 < N; k2++) {{
    x.beginPath(); x.arc(n[k2].x, n[k2].y, 1.6 + r() * 2.6, 0, 6.283);
    x.fillStyle = 'rgba(149,224,0,' + (0.16 + r() * 0.30).toFixed(3) + ')'; x.fill();
  }}
}})();
</script>"""


def bloque_logo(m, modo_nombre):
    ruta = resolver(m["modos"][modo_nombre]["logo"])
    if not ruta.exists():
        return f'<div class="antetitulo">{esc(m["nombre"]).upper()}</div>'
    return f'<img class="logo" src="{data_uri(ruta)}" alt="Ethonik">'


def bloque_items(items):
    if not items:
        return ""
    filas = "".join(
        f'<div class="item"><div class="cap"><span>{i:02d}</span></div>'
        f'<div class="txt"><span>{negrita(it)}</span></div></div>'
        for i, it in enumerate(items, start=1)
    )
    return f'<div class="items">{filas}</div>'


def envolver(m, modo_nombre, ancho, alto, cuerpo, extra_body=""):
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>{css(m, modo_nombre, ancho, alto)}</style></head><body>
<div class="lienzo">{extra_body}{cuerpo}</div></body></html>"""


def html_lamina(m, lam, modo_nombre, ancho, alto):
    tipo = lam.get("tipo", "lista")
    mo = m["modos"][modo_nombre]
    pie = esc(lam.get("pie", m["sitio"]))

    if tipo == "foto":
        ruta = lam.get("foto", "auto")
        if ruta == "auto":
            # Fondo generado con el sistema visual del brand book.
            semilla = lam.get("semilla", abs(hash(lam["titulo"])) % 100000)
            extra = canvas_fondo(m, semilla, ancho, alto) + '<div class="velo velo-suave"></div>'
        else:
            foto = resolver(ruta)
            if not foto.exists():
                raise FileNotFoundError(f"No existe la foto: {foto}")
            extra = f'<img class="foto" src="{data_uri(foto)}" alt=""><div class="velo"></div>'
        cuerpo = f"""
  {bloque_logo(m, "oscuro")}
  <div class="esp"></div>
  {f'<div class="antetitulo" style="font-size:38px;color:#fff">{esc(lam.get("antetitulo"))}</div>' if lam.get("antetitulo") else ''}
  <div style="height:22px"></div>
  <div class="titular" style="background:{m["gradiente_titulo_oscuro"]};-webkit-background-clip:text;background-clip:text">{esc(lam["titulo"])}</div>
  {f'<div style="height:26px"></div><div class="bajada" style="color:rgba(255,255,255,.85)">{esc(lam.get("bajada"))}</div>' if lam.get("bajada") else ''}
  <div class="esp"></div>
  <div class="pie" style="color:rgba(255,255,255,.62)">{esc(lam.get("credito", pie))}</div>"""
        return envolver(m, "oscuro", ancho, alto, cuerpo, extra)

    if tipo == "dato":
        cuerpo = f"""
  {bloque_logo(m, modo_nombre)}
  <div class="esp"></div>
  <div class="cifra">{esc(lam["cifra"])}</div>
  <div style="height:34px"></div>
  <div class="antetitulo" style="font-size:56px">{esc(lam["titulo"])}</div>
  {f'<div style="height:24px"></div><div class="bajada" style="color:{mo["texto_suave"]}">{esc(lam.get("cuerpo"))}</div>' if lam.get("cuerpo") else ''}
  <div class="esp"></div>
  <div class="fuente"><b>Fuente:</b> {esc(lam.get("fuente", "[FALTA FUENTE]"))}{f' &middot; {esc(lam.get("tipo_fuente"))}' if lam.get("tipo_fuente") else ''}</div>
  <div style="height:20px"></div>
  <div class="pie">{pie}</div>"""
        return envolver(m, modo_nombre, ancho, alto, cuerpo)

    if tipo == "cierre":
        cuerpo = f"""
  {bloque_logo(m, modo_nombre)}
  <div class="esp"></div>
  <div class="titular" style="font-size:82px">{esc(lam["titulo"])}</div>
  {f'<div style="height:30px"></div><div class="bajada">{esc(lam.get("bajada"))}</div>' if lam.get("bajada") else ''}
  <div style="height:52px"></div>
  <div class="cta">{esc(lam.get("cta", "Hablemos"))}</div>
  <div class="esp"></div>
  <div class="pie">{pie}</div>"""
        return envolver(m, modo_nombre, ancho, alto, cuerpo)

    # lista / titular
    items = lam.get("items", [])
    cuerpo = f"""
  {bloque_logo(m, modo_nombre)}
  <div class="esp"></div>
  {f'<div class="antetitulo">{esc(lam.get("antetitulo"))}</div><div style="height:16px"></div>' if lam.get("antetitulo") else ''}
  <div class="titular">{esc(lam["titulo"])}</div>
  {f'<div style="height:28px"></div><div class="bajada">{esc(lam.get("bajada"))}</div>' if lam.get("bajada") else ''}
  <div class="esp"></div>
  {bloque_items(items)}
  {'<div style="height:34px"></div>' if items else ''}
  <div class="pie">{pie}</div>"""
    return envolver(m, modo_nombre, ancho, alto, cuerpo)


# --------------------------------------------------------------------------
# render
# --------------------------------------------------------------------------

def construir(m, contenido):
    trabajos = []
    for pieza in contenido["piezas"]:
        base = slug(pieza.get("id") or pieza.get("titulo"))
        ancho, alto = m["formatos"][pieza.get("formato", "vertical")]
        modo = pieza.get("modo", "claro")
        if modo not in m["modos"]:
            raise ValueError(f"modo desconocido: {modo}")
        laminas = pieza.get("laminas") or [pieza]
        multiple = len(laminas) > 1
        for i, lam in enumerate(laminas, start=1):
            nombre = f"{base}-{i:02d}.png" if multiple else f"{base}.png"
            trabajos.append((nombre, html_lamina(m, lam, lam.get("modo", modo), ancho, alto), ancho, alto))
    return trabajos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("contenido")
    ap.add_argument("--marca", default=str(RAIZ / "marca.json"))
    ap.add_argument("--salida", default=str(RAIZ / "salida"))
    args = ap.parse_args()

    m = json.loads(pathlib.Path(args.marca).read_text(encoding="utf-8"))
    contenido = json.loads(pathlib.Path(args.contenido).read_text(encoding="utf-8"))
    salida = pathlib.Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)

    trabajos = construir(m, contenido)
    with sync_playwright() as pw:
        nav = pw.chromium.launch(executable_path=CHROMIUM, args=["--font-render-hinting=none"])
        for nombre, html, ancho, alto in trabajos:
            pag = nav.new_page(viewport={"width": ancho, "height": alto}, device_scale_factor=1)
            pag.set_content(html, wait_until="load")
            pag.wait_for_timeout(140)
            pag.screenshot(path=str(salida / nombre))
            pag.close()
            print(f"  ✓ {nombre}  ({ancho}x{alto})")
        nav.close()
    print(f"\n{len(trabajos)} imagen(es) en {salida}")


if __name__ == "__main__":
    main()
