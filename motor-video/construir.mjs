#!/usr/bin/env node
// Motor de video de Ethonik (HyperFrames) — generador de proyectos.
//
// Lee un guion.json (mismo formato que usa motor/video.py) y motor/marca.json EN CADA
// CORRIDA, y escribe un proyecto HyperFrames por video en <trabajo>/<id>/.
// No renderiza: eso lo hace render.sh. Solo usa módulos estándar de Node.
//
// Uso:
//   node construir.mjs --guion g.json --marca ../motor/marca.json --modo oscuro --trabajo trabajo

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirMedidor } from "./medir.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Constantes del formato
// ---------------------------------------------------------------------------
const ANCHO = 1080;
const ALTO = 1920;
const FPS = 30;
const MEDIO_FUNDIDO = 0.2; // el fundido entre escenas dura 0,4 s, centrado en el límite
const VOLUMEN_CAMA = 1; // la cama ya sale normalizada a -18 LUFS desde cama.py; aquí no se baja
// Bloque de texto: centrado en el cuadro (centro y = 960) y dentro de la zona segura (nada en los 420 px de abajo,
// por eso termina en y = 1500). Arriba, la franja del logo/indicador (CAB) ocupa y = 232–344.
const CAJA = { x: 140, y: 420, w: 800, h: 1080 };
// WCAG AA: texto grande (titulares: >= 64 px, peso 900) pide 3:1; el resto del texto, 4,5:1.
const CONTRASTE_TITULAR = 3;
const CONTRASTE_TEXTO = 4.5;
const VELO_MIN = 0.4; // opacidad mínima del velo oscuro (modo oscuro), donde el brillo del fondo es más claro
const LIMITES = { gancho: 45, punto: 60, apoyo: 55, cierre: 55 };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function fallar(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function argumentos(argv) {
  const a = { modo: "oscuro", trabajo: path.join(AQUI, "trabajo"), marca: path.join(AQUI, "..", "motor", "marca.json") };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) fallar(`argumento inesperado: ${k}`);
    const v = argv[++i];
    if (v === undefined) fallar(`falta el valor de ${k}`);
    a[k.slice(2)] = v;
  }
  if (!a.guion) fallar("falta --guion");
  if (!["claro", "oscuro"].includes(a.modo)) fallar(`--modo debe ser claro u oscuro (recibí "${a.modo}")`);
  return a;
}

const esc = (t) =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (t) => esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const num = (n) => String(Math.round(n * 1000) / 1000);
// "GPT-4.1" no debe partirse en dos líneas: el guion entre letras/dígitos pasa a guion no separable (U+2011)
const sinCorte = (t) => String(t).replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, "\u2011");

// Las palabras de 1–2 letras (y los signos de apertura ¿ ¡, que ya van pegados a su palabra) no pueden quedar
// solas al final de una línea: se pegan a la palabra siguiente con espacio no separable (U+00A0).
function pegarCortas(t) {
  const ps = String(t).trim().split(/\s+/);
  let out = ps[0] ?? "";
  for (let i = 1; i < ps.length; i++) {
    const prev = ps[i - 1];
    const letras = prev.replace(/[^\p{L}]/gu, "");
    const corta = letras.length >= 1 && letras.length <= 2 && !/[\p{N}\u2011-]/u.test(prev);
    out += (corta ? "\u00A0" : " ") + ps[i];
  }
  return out;
}

// Mismo criterio que slug() de motor/render.py
function slug(t) {
  const s = String(t ?? "").toLowerCase().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 60) || "pieza";
}

function rellenar(plantilla, valores) {
  return plantilla.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
    if (!(k in valores)) fallar(`la plantilla pide {{${k}}} y no se le dio valor`);
    return valores[k];
  });
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------
const hexARgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) fallar(`color no válido en marca.json: ${h}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbAHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const luminancia = (c) => {
  const l = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const contraste = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mezcla = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function parsearGradiente(css) {
  const paradas = [...css.matchAll(/(#[0-9a-fA-F]{6})\s+(\d+(?:\.\d+)?)%/g)].map((m) => ({
    c: hexARgb(m[1]),
    p: parseFloat(m[2]) / 100,
  }));
  if (paradas.length < 2) fallar(`no pude leer el gradiente de marca.json: ${css}`);
  return paradas;
}
function colorEn(paradas, t) {
  if (t <= paradas[0].p) return paradas[0].c;
  for (let i = 1; i < paradas.length; i++) {
    if (t <= paradas[i].p) {
      const a = paradas[i - 1], b = paradas[i];
      return mezcla(a.c, b.c, (t - a.p) / (b.p - a.p || 1));
    }
  }
  return paradas[paradas.length - 1].c;
}
/**
 * Usa el gradiente de la marca TAL CUAL si todos sus tramos llegan al contraste de
 * titular (3:1) sobre el fondo efectivo. Si algún extremo no llega (p. ej. el lima sobre
 * crema en modo claro), recorta al tramo más largo que sí llega. marca.json no se toca.
 */
function gradienteLegible(css, fondo, nombre) {
  const paradas = parsearGradiente(css);
  const N = 400;
  const ok = [];
  for (let i = 0; i <= N; i++) ok.push(contraste(colorEn(paradas, i / N), fondo) >= CONTRASTE_TITULAR);
  if (ok.every(Boolean)) return { css, recortado: false, t0: 0, t1: 1 };
  let mejor = { ini: -1, fin: -1 };
  for (let i = 0; i <= N; ) {
    if (!ok[i]) { i++; continue; }
    let j = i;
    while (j + 1 <= N && ok[j + 1]) j++;
    if (j - i > mejor.fin - mejor.ini) mejor = { ini: i, fin: j };
    i = j + 1;
  }
  if (mejor.ini < 0) fallar(`ningún tramo del gradiente (${nombre}) llega a ${CONTRASTE_TITULAR}:1 sobre el fondo`);
  const t0 = mejor.ini / N, t1 = mejor.fin / N;
  const dentro = paradas.filter((s) => s.p > t0 && s.p < t1);
  const lista = [{ c: colorEn(paradas, t0), p: t0 }, ...dentro, { c: colorEn(paradas, t1), p: t1 }];
  const css2 = `linear-gradient(90deg,${lista
    .map((s) => `${rgbAHex(s.c)} ${num(((s.p - t0) / (t1 - t0 || 1)) * 100)}%`)
    .join(",")})`;
  return { css: css2, recortado: true, t0, t1 };
}

// ---------------------------------------------------------------------------
// Medición de texto (estimación conservadora de Inter; la verificación real es
// `hyperframes check` y la inspección de fotogramas)
// ---------------------------------------------------------------------------
function anchoLetra(ch, mayus) {
  if (ch === " " || ch === "\u00A0") return 0.28;
  if (/[.,;:!¡¿?'’"“”«»]/.test(ch)) return 0.36;
  if (/[-–—/()]/.test(ch)) return 0.52;
  if (/[0-9%$€#&]/.test(ch)) return 0.72;
  if (mayus || /[A-Z]/.test(ch)) {
    if ("I".includes(ch)) return 0.38;
    if ("J".includes(ch)) return 0.64;
    if ("LEFTZ".includes(ch)) return 0.7;
    if ("M".includes(ch)) return 1.0;
    if ("W".includes(ch)) return 1.15;
    if ("OQCDGHNU".includes(ch)) return 0.88;
    return 0.8;
  }
  if ("il".includes(ch)) return 0.32;
  if ("jtf".includes(ch)) return 0.44;
  if ("r".includes(ch)) return 0.46;
  if ("m".includes(ch)) return 1.04;
  if ("w".includes(ch)) return 0.98;
  return 0.69;
}
const FACTOR_PESO = { 400: 0.88, 600: 0.93, 700: 0.95, 900: 1 };

function envolver(texto, tam, { mayus, peso, ancho }) {
  const base = mayus ? texto.toUpperCase() : texto;
  const palabras = base.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[ \t\n]+/).filter(Boolean);
  const f = FACTOR_PESO[peso] ?? 1;
  const medida = (w) => [...w].reduce((s, ch) => s + anchoLetra(ch, mayus), 0) * f * tam;
  const espacio = anchoLetra(" ", mayus) * f * tam;
  let lineas = 1, actual = 0, palabraLarga = 0;
  for (const w of palabras) {
    const m = medida(w);
    palabraLarga = Math.max(palabraLarga, m);
    if (actual === 0) actual = m;
    else if (actual + espacio + m <= ancho) actual += espacio + m;
    else { lineas++; actual = m; }
  }
  return { lineas, desborda: palabraLarga > ancho };
}

function ajustarTamano(texto, { base, min, lh, maxAlto, mayus, peso, ancho = CAJA.w, etiqueta }) {
  for (let t = base; t >= min; t -= 2) {
    const r = envolver(texto, t, { mayus, peso, ancho });
    if (!r.desborda && r.lineas * t * lh <= maxAlto) return { tam: t, lineas: r.lineas };
  }
  const r = envolver(texto, min, { mayus, peso, ancho });
  console.warn(`  AVISO: "${etiqueta}" no cabe con holgura ni a ${min}px (${r.lineas} líneas estimadas)`);
  return { tam: min, lineas: r.lineas };
}

// ---------------------------------------------------------------------------
// Fondo abstracto (port a SVG del canvas_fondo de motor/render.py; misma semilla,
// mismo generador congruencial y mismo orden de sorteos, así el trazo es el de siempre)
// ---------------------------------------------------------------------------
function fondoSvg(id, semilla, p) {
  let s = Math.trunc(semilla) >>> 0;
  const r = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const W = ANCHO, H = ALTO;
  const rgb = (c) => `rgb(${c.map(Math.round).join(",")})`;
  const f2 = (n) => n.toFixed(2);
  const out = [];

  const gx = W * (0.3 + r() * 0.4);
  const gy = H * (0.42 + r() * 0.26);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<defs><radialGradient id="${id}-brillo" gradientUnits="userSpaceOnUse" cx="${f2(gx)}" cy="${f2(gy)}" r="${f2(H * 0.62)}">` +
      `<stop offset="0" stop-color="${rgb(p.brillo)}" stop-opacity="${p.brilloA[0]}"/>` +
      `<stop offset="0.45" stop-color="${rgb(p.brillo)}" stop-opacity="${p.brilloA[1]}"/>` +
      `<stop offset="1" stop-color="${rgb(p.brillo)}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="${rgb(p.base)}"/>`,
    `<rect width="${W}" height="${H}" fill="url(#${id}-brillo)"/>`,
  );

  // arcos circulares
  for (let i = 0; i < 7; i++) {
    const rad = H * (0.16 + i * 0.085);
    const a0 = r() * 6.28;
    const a1 = a0 + 1.1 + r() * 2.6;
    const op = (0.05 + r() * 0.13) * p.arcoK;
    const lw = 1 + r() * 2;
    const x0 = gx + rad * Math.cos(a0), y0 = gy + rad * Math.sin(a0);
    const x1 = gx + rad * Math.cos(a1), y1 = gy + rad * Math.sin(a1);
    const grande = a1 - a0 > Math.PI ? 1 : 0;
    out.push(
      `<path d="M${f2(x0)} ${f2(y0)}A${f2(rad)} ${f2(rad)} 0 ${grande} 1 ${f2(x1)} ${f2(y1)}" fill="none" stroke="${rgb(p.arco)}" stroke-opacity="${op.toFixed(3)}" stroke-width="${f2(lw)}"/>`,
    );
  }
  // ondas sutiles
  for (let w = 0; w < 4; w++) {
    const base = H * (0.3 + w * 0.16);
    const amp = 26 + r() * 54;
    const pts = [];
    for (let px = 0; px <= W; px += 12) pts.push(`${px},${f2(base + Math.sin(px / (150 + w * 60) + w * 1.7) * amp)}`);
    const op = (0.1 + r() * 0.1) * p.ondaK;
    out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${rgb(p.onda)}" stroke-opacity="${op.toFixed(3)}" stroke-width="1.4"/>`);
  }
  // nodos y líneas
  const N = 34, n = [];
  for (let k = 0; k < N; k++) n.push({ x: r() * W, y: r() * H });
  for (let a = 0; a < N; a++)
    for (let b = a + 1; b < N; b++) {
      const d = Math.hypot(n[a].x - n[b].x, n[a].y - n[b].y);
      if (d < 250)
        out.push(
          `<line x1="${f2(n[a].x)}" y1="${f2(n[a].y)}" x2="${f2(n[b].x)}" y2="${f2(n[b].y)}" stroke="${rgb(p.nodo)}" stroke-opacity="${(0.13 * (1 - d / 250) * p.nodoK).toFixed(3)}" stroke-width="1"/>`,
        );
    }
  for (let k = 0; k < N; k++) {
    const rad = 1.6 + r() * 2.6;
    const op = (0.16 + r() * 0.3) * p.nodoK;
    out.push(`<circle cx="${f2(n[k].x)}" cy="${f2(n[k].y)}" r="${f2(rad)}" fill="${rgb(p.nodo)}" fill-opacity="${op.toFixed(3)}"/>`);
  }
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------
// Marca
// ---------------------------------------------------------------------------
function cargarMarca(rutaMarca, modoNombre) {
  const m = JSON.parse(fs.readFileSync(rutaMarca, "utf8"));
  const dirMarca = path.dirname(path.resolve(rutaMarca));
  const mo = m.modos?.[modoNombre];
  if (!mo) fallar(`marca.json no tiene el modo "${modoNombre}"`);
  const c = m.colores;
  const oscuro = modoNombre === "oscuro";

  // Logo: la ruta de marca.json (relativa a marca.json) o, si no existe, el mismo
  // archivo suelto junto a marca.json (así está en el repositorio).
  const candidatos = [path.resolve(dirMarca, mo.logo), path.resolve(dirMarca, path.basename(mo.logo))];
  const logo = candidatos.find((p) => fs.existsSync(p));
  if (!logo) fallar(`no encuentro el logo del modo ${modoNombre}: probé ${candidatos.join(" y ")}`);

  const base = hexARgb(mo.fondo);
  const rv = hexARgb(c.fondo_oscuro);

  // Paleta del fondo abstracto: oscuro = la de motor/render.py; claro = la misma
  // geometría en tonos teal/verde sobre el crema de la marca.
  const paleta = oscuro
    ? {
        base: hexARgb(c.fondo_oscuro), brillo: hexARgb(c.verde_tecnico), brilloA: [0.36, 0.13],
        arco: hexARgb(c.lima), arcoK: 1, onda: hexARgb(c.verde_tecnico), ondaK: 1, nodo: hexARgb(c.lima), nodoK: 1,
      }
    : {
        base, brillo: hexARgb(c.teal_claro), brilloA: [0.55, 0.2],
        arco: hexARgb(c.teal), arcoK: 0.6, onda: hexARgb(c.verde_tecnico), ondaK: 0.5, nodo: hexARgb(c.teal), nodoK: 0.55,
      };
  const velo = oscuro
    ? `linear-gradient(180deg,rgba(${rv},0.55) 0%,rgba(${rv},${VELO_MIN}) 40%,rgba(${rv},0.78) 100%)`
    : "none";

  // Fondo efectivo más claro que queda detrás del texto (centro del brillo, velo mínimo)
  const veloMin = oscuro ? VELO_MIN : 0;
  const conBrillo = mezcla(paleta.base, paleta.brillo, paleta.brilloA[0]);
  const fondoEfectivo = mezcla(conBrillo, paleta.base, veloMin);

  // Acento y color del apoyo: de la paleta, el primero que cumple el contraste
  const acento = oscuro ? c.lima : c.verde_tecnico; // decorativo (no es texto)
  const textoSuave = hexARgb(mo.texto_suave);
  const candidatosApoyo = oscuro
    ? [c.teal_claro, mo.texto_suave]
    : [c.teal, c.teal_oscuro, mo.texto_suave];
  const apoyo = candidatosApoyo.find((h) => contraste(hexARgb(h), fondoEfectivo) >= CONTRASTE_TEXTO);
  if (!apoyo) fallar(`ningún color de la paleta sirve para el apoyo con contraste ${CONTRASTE_TEXTO}:1`);
  if (contraste(textoSuave, fondoEfectivo) < CONTRASTE_TEXTO) fallar(`texto_suave no llega a ${CONTRASTE_TEXTO}:1`);
  if (contraste(hexARgb(mo.texto), fondoEfectivo) < CONTRASTE_TEXTO) fallar(`texto no llega a ${CONTRASTE_TEXTO}:1`);

  const gradBase = oscuro ? m.gradiente_titulo_oscuro : m.gradiente_titulo;
  const grad = gradienteLegible(gradBase, fondoEfectivo, oscuro ? "gradiente_titulo_oscuro" : "gradiente_titulo");

  // Tipografía: archivos de pesos declarados en marca.json, tomados del paquete npm
  const familia = m.tipografia.familia;
  const dirFuente = path.join(AQUI, "node_modules", "@fontsource", familia.toLowerCase().replace(/\s+/g, "-"), "files");
  const fuentes = m.tipografia.archivos.map((f) => {
    const nombre = path.basename(f.archivo);
    const ruta = path.join(dirFuente, nombre);
    if (!fs.existsSync(ruta)) fallar(`falta ${ruta}: corre bash instalar.sh (npm ci)`);
    return { peso: f.peso, nombre, ruta };
  });

  return { m, mo, c, oscuro, logo, paleta, velo, fondoEfectivo, acento, apoyo, grad, familia, fuentes };
}

// ---------------------------------------------------------------------------
// Construcción de un video
// ---------------------------------------------------------------------------
async function construirVideo(g, marca, modoNombre, raizTrabajo, chrome) {
  const leer = (p) => fs.readFileSync(path.join(AQUI, "plantilla", p), "utf8");
  const tpl = { index: leer("index.html"), escena: leer("escena.html"), marco: leer("marco.html") };
  const tipos = {};
  for (const t of ["gancho", "punto", "cierre"]) tipos[t] = { html: leer(`tipos/${t}.html`), js: leer(`tipos/${t}.js`) };

  if (!Array.isArray(g.escenas) || g.escenas.length === 0) fallar(`el video "${g.id ?? "?"}" no tiene escenas`);
  const id = slug(g.id || g.escenas[0].texto);
  const escenas = g.escenas.map((e) => ({
    ...e,
    tipo: e.tipo === "gancho" || e.tipo === "cierre" ? e.tipo : "punto", // igual que video.py
    duracion: Number(e.duracion ?? 8),
  }));
  for (const e of escenas) {
    const limpiar = (t) => pegarCortas(sinCorte(t));
    e.texto = typeof e.texto === "string" ? limpiar(e.texto) : e.texto;
    if (typeof e.apoyo === "string") e.apoyo = limpiar(e.apoyo);
    if (typeof e.cta === "string") e.cta = limpiar(e.cta);
  }
  escenas.forEach((e, i) => {
    if (!(e.duracion > 0)) fallar(`${id}: la escena ${i + 1} tiene una duración no válida`);
    if (typeof e.texto !== "string" || !e.texto.trim()) fallar(`${id}: la escena ${i + 1} no tiene texto`);
    const lim = LIMITES[e.tipo];
    if ([...e.texto].length > lim) console.warn(`  AVISO: ${id} escena ${i + 1}: texto de ${[...e.texto].length} caracteres (límite ${lim})`);
    if (e.apoyo && [...e.apoyo].length > LIMITES.apoyo) console.warn(`  AVISO: ${id} escena ${i + 1}: apoyo de ${[...e.apoyo].length} caracteres (límite ${LIMITES.apoyo})`);
  });

  const total = escenas.reduce((s, e) => s + e.duracion, 0);
  const nPuntos = escenas.filter((e) => e.tipo === "punto").length;
  const dir = path.join(raizTrabajo, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "compositions"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "fonts"), { recursive: true });

  // assets locales: nada se carga de internet al renderizar
  fs.copyFileSync(path.join(AQUI, "node_modules", "gsap", "dist", "gsap.min.js"), path.join(dir, "assets", "gsap.min.js"));
  fs.copyFileSync(marca.logo, path.join(dir, "assets", "logo.svg"));
  for (const f of marca.fuentes) fs.copyFileSync(f.ruta, path.join(dir, "assets", "fonts", f.nombre));

  const familiaCss = `"${marca.familia} Local", system-ui, sans-serif`;
  const fuentesCss = marca.fuentes
    .map(
      (f) =>
        `    @font-face { font-family: "${marca.familia} Local"; font-weight: ${f.peso}; font-style: normal; font-display: block; src: url("assets/fonts/${f.nombre}") format("woff2"); }`,
    )
    .join("\n");

  // Medidor de texto en Chrome: usa el <style> real de la escena, así que mide exactamente lo que se renderiza.
  let medidor = null;
  const paginaMedida = path.join(dir, "_medida.html");
  if (chrome) {
    const estilo = /<style>[\s\S]*?<\/style>/.exec(tpl.escena)[0];
    const css = rellenar(estilo, {
      FUENTES: fuentesCss, FAMILIA: familiaCss, ANCHO: String(ANCHO), ALTO: String(ALTO),
      C_TEXTO: marca.mo.texto, C_SUAVE: marca.mo.texto_suave, C_APOYO: marca.apoyo, C_ACENTO: marca.acento,
      VELO: marca.velo, GRADIENTE: marca.grad.css,
      CAJA_X: String(CAJA.x), CAJA_Y: String(CAJA.y), CAJA_W: String(CAJA.w), CAJA_H: String(CAJA.h),
    });
    fs.writeFileSync(
      paginaMedida,
      `<!doctype html><html lang="es"><head><meta charset="utf-8">${css}<style>html,body{margin:0;width:${ANCHO}px;height:${ALTO}px}</style></head>` +
        `<body><div id="root"><div class="pantalla"><div class="caja"><div class="bloque" id="__b"></div></div></div></div></body></html>`,
    );
    try {
      medidor = await abrirMedidor({ chrome, paginaRuta: paginaMedida, familia: `${marca.familia} Local`, pesos: marca.fuentes.map((f) => f.peso) });
    } catch (err) {
      console.warn(`  AVISO: no pude abrir ${chrome} para medir (${err.message.split("\n")[0]}); uso la estimación de anchos.`);
    }
  }
  if (!medidor) console.warn("  AVISO: sin navegador para medir el texto; se usa la estimación conservadora de anchos (tamaños algo menores).");
  const fit = async (texto, o) => {
    if (medidor) {
      const r = await medidor.ajustar(texto, o);
      if (r.relajados) console.warn(`  AVISO: "${o.etiqueta}": un bloque con espacios no separables no cabía; se soltó ${r.relajados} enlace(s) de palabras cortas.`);
      if (!r.ok) console.warn(`  AVISO: "${o.etiqueta}" no cabe ni a ${o.min}px`);
      return r;
    }
    return { ...ajustarTamano(texto, o), texto };
  };

  const hosts = [];
  const acentos = [];
  const contadores = { gancho: 0, punto: 0, cierre: 0 };
  const estados = []; // por escena: instante de inicio nominal y qué muestra la franja superior
  let inicio = 0;

  for (let i = 0; i < escenas.length; i++) {
    const e = escenas[i];
    const primera = i === 0, ultima = i === escenas.length - 1;
    const h = Math.min(MEDIO_FUNDIDO, e.duracion / 4);
    const antes = primera ? 0 : h;
    const despues = ultima ? 0 : h;
    const t0 = antes; // instante local en que la escena "empieza de verdad"
    const fade = primera ? 0 : 2 * h;

    contadores[e.tipo]++;
    const sid = e.tipo === "punto" ? `punto-${contadores.punto}` : contadores[e.tipo] > 1 ? `${e.tipo}-${contadores[e.tipo]}` : e.tipo;
    if (!primera) acentos.push(Math.round(inicio * 1000) / 1000);
    estados.push({ t: inicio, logo: e.tipo === "gancho", k: e.tipo === "punto" ? contadores.punto : 0 });

    let contenido, tweens, variables;
    if (e.tipo === "gancho") {
      const aj = await fit(e.texto, { clase: "grad", base: 140, min: 64, lh: 1.12, maxAlto: 900, mayus: true, peso: 900, etiqueta: `${sid} texto` });
      contenido = rellenar(tipos.gancho.html, { ID: sid, TAM: String(aj.tam), TEXTO: esc(aj.texto) });
      tweens = rellenar(tipos.gancho.js, { ID: sid, T0: num(t0), T0_SUB: num(t0 + 0.35) });
      variables = [{ id: "texto", type: "string", label: "Texto del gancho", default: aj.texto }];
    } else if (e.tipo === "cierre") {
      const aj = await fit(e.texto, { clase: "grad", base: 116, min: 64, lh: 1.12, maxAlto: 540, mayus: true, peso: 900, etiqueta: `${sid} texto` });
      const cta = e.cta ?? marca.m.sitio.replace(/^https?:\/\//, "");
      const ajc = await fit(cta, { clase: "cta", base: 46, min: 40, lh: 1.2, maxAlto: 110, mayus: false, peso: 600, etiqueta: `${sid} cta` });
      contenido = rellenar(tipos.cierre.html, { ID: sid, TAM: String(aj.tam), TEXTO: esc(aj.texto), TAM_CTA: String(ajc.tam), CTA: esc(ajc.texto) });
      tweens = rellenar(tipos.cierre.js, { ID: sid, T0_FIRMA: num(t0 + 0.5), T0_CTA: num(t0 + 0.6) });
      variables = [
        { id: "texto", type: "string", label: "Texto de cierre", default: aj.texto },
        { id: "cta", type: "string", label: "Firma / CTA", default: ajc.texto },
      ];
    } else {
      const k = contadores.punto;
      const aj = await fit(e.texto, { clase: "punto-titular", base: 104, min: 64, lh: 1.1, maxAlto: 560, mayus: false, peso: 900, etiqueta: `${sid} texto` });
      let apoyoHtml = "", apoyoJs = "";
      variables = [{ id: "texto", type: "string", label: "Texto principal", default: aj.texto }];
      if (e.apoyo) {
        const ap = await fit(e.apoyo, { clase: "apoyo", base: 56, min: 40, lh: 1.28, maxAlto: 260, mayus: false, peso: 600, etiqueta: `${sid} apoyo` });
        apoyoHtml = `\n          <div id="${sid}-apoyo" class="apoyo" style="font-size:${ap.tam}px" data-var-text="apoyo">${esc(ap.texto)}</div>`;
        apoyoJs = `    tl.fromTo("#${sid}-apoyo", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, ${num(t0 + 1.0)});`;
        variables.push({ id: "apoyo", type: "string", label: "Apoyo", default: ap.texto });
      }
      contenido = rellenar(tipos.punto.html, { ID: sid, TAM: String(aj.tam), TEXTO: esc(aj.texto), APOYO_HTML: apoyoHtml });
      tweens = rellenar(tipos.punto.js, { ID: sid, T0: num(t0), APOYO_JS: apoyoJs });
    }

    // Fundido entre escenas, centrado en el límite nominal. El fondo se mezcla durante
    // 2h; el texto saliente se apaga ANTES del límite y el entrante aparece DESPUÉS,
    // para que nunca se superpongan dos textos. La primera escena no entra con fundido
    // (el fotograma 0 es la portada) y la última no sale (el video termina en su duración).
    const localFin = e.duracion + antes + despues;
    let comunes = "";
    if (fade > 0) comunes += `    tl.fromTo("#${sid}-pantalla", { opacity: 0 }, { opacity: 1, duration: ${num(fade)}, ease: "none" }, 0);\n`;
    if (!primera) comunes += `    tl.fromTo("#${sid}-caja", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, ${num(t0)});\n`;
    if (!ultima) comunes += `    tl.fromTo("#${sid}-caja", { opacity: 1 }, { opacity: 0, duration: ${num(h)}, ease: "power1.in", immediateRender: false }, ${num(localFin - 2 * h)});\n`;
    tweens = comunes + tweens;

    const semilla = e.semilla ?? 1000 + i * 137; // igual que video.py
    const html = rellenar(tpl.escena, {
      ID: sid, ANCHO: String(ANCHO), ALTO: String(ALTO),
      CAJA_X: String(CAJA.x), CAJA_Y: String(CAJA.y), CAJA_W: String(CAJA.w), CAJA_H: String(CAJA.h),
      FUENTES: fuentesCss, FAMILIA: familiaCss,
      C_TEXTO: marca.mo.texto, C_SUAVE: marca.mo.texto_suave, C_APOYO: marca.apoyo, C_ACENTO: marca.acento,
      VELO: marca.velo, GRADIENTE: marca.grad.css,
      VARIABLES: escAttr(JSON.stringify(variables)),
      FONDO_SVG: fondoSvg(sid, semilla, marca.paleta),
      CONTENIDO: contenido, TWEENS: tweens,
    });
    fs.writeFileSync(path.join(dir, "compositions", `${sid}.html`), html);

    hosts.push(
      `      <div\n        id="${sid}"\n        class="clip"\n        data-composition-id="${sid}"\n        data-composition-src="compositions/${sid}.html"\n        data-start="${num(inicio - antes)}"\n        data-duration="${num(e.duracion + antes + despues)}"\n        data-track-index="${i + 1}"\n        data-track-kind="graphics"\n        data-width="${ANCHO}"\n        data-height="${ALTO}"\n      ></div>`,
    );
    inicio += e.duracion;
  }

  // -------------------------------------------------------------------------
  // Marco: capa persistente sobre todas las escenas. Tiene el logo pequeño del gancho
  // (visible desde el fotograma 0) y el indicador de avance de los puntos. Entre escenas
  // estos elementos no se reconstruyen: se quedan fijos, o se intercambian con un fundido
  // cruzado corto, para que la franja superior nunca quede vacía ni parpadee.
  // -------------------------------------------------------------------------
  const CAB = { y: 232, h: 112 }; // dentro de la zona segura (los 220 px de arriba quedan libres)
  const hf = 0.1; // medio fundido cruzado (0,2 s en total)
  const visInd = (st) => (st.k > 0 ? 1 : 0);
  const e0 = estados[0];
  const barrasHtml = Array.from({ length: nPuntos }, (_, j) =>
    `<span class="barra"><span class="pista"></span><span id="marco-on-${j + 1}" class="on" style="opacity:${j < e0.k ? 1 : 0}"></span></span>`,
  ).join("");
  const etiquetasHtml = Array.from({ length: nPuntos }, (_, j) =>
    `<span id="marco-etq-${j + 1}" class="etq" style="opacity:${e0.k === j + 1 ? 1 : 0}">${j + 1}/${nPuntos}</span>`,
  ).join("");
  // Lo que sale se apaga en [límite − 0,2 s, límite]; lo que entra aparece en [límite, límite + 0,2 s].
  // Así el logo (que sale) y el indicador (que entra) nunca coinciden ni siquiera a medias.
  const anim = (sel, de, a, limite) =>
    `    tl.fromTo("${sel}", { opacity: ${de} }, { opacity: ${a}, duration: ${num(2 * hf)}, ease: "none", immediateRender: false }, ${num(a > de ? limite : limite - 2 * hf)});\n`;
  let marcoJs = "";
  let cur = { logo: e0.logo ? 1 : 0, ind: visInd(e0), k: e0.k };
  for (let i = 1; i < estados.length; i++) {
    const nx = estados[i], t = nx.t;
    const logoNx = nx.logo ? 1 : 0, indNx = visInd(nx);
    if (logoNx !== cur.logo) marcoJs += anim("#marco-logo", cur.logo, logoNx, t);
    if (indNx !== cur.ind) marcoJs += anim("#marco-indicador", cur.ind, indNx, t);
    if (indNx && nx.k !== cur.k) {
      for (let j = 1; j <= nPuntos; j++) {
        const o = j <= cur.k ? 1 : 0, n = j <= nx.k ? 1 : 0;
        if (o !== n) marcoJs += anim(`#marco-on-${j}`, o, n, t);
        const eo = cur.k === j ? 1 : 0, en = nx.k === j ? 1 : 0;
        if (eo !== en) marcoJs += anim(`#marco-etq-${j}`, eo, en, t);
      }
    }
    cur = { logo: logoNx, ind: indNx, k: indNx ? nx.k : cur.k };
  }
  fs.writeFileSync(
    path.join(dir, "compositions", "marco.html"),
    rellenar(tpl.marco, {
      ANCHO: String(ANCHO), ALTO: String(ALTO), FUENTES: fuentesCss, FAMILIA: familiaCss,
      C_SUAVE: marca.mo.texto_suave, C_ACENTO: marca.acento,
      CAJA_X: String(CAJA.x), CAJA_W: String(CAJA.w), CAB_Y: String(CAB.y), CAB_H: String(CAB.h),
      LOGO_O: e0.logo ? "1" : "0", IND_O: visInd(e0) ? "1" : "0",
      BARRAS: barrasHtml, ETIQUETAS: etiquetasHtml, TWEENS: marcoJs,
    }),
  );
  hosts.push(
    `      <div\n        id="marco"\n        class="clip"\n        data-composition-id="marco"\n        data-composition-src="compositions/marco.html"\n        data-start="0"\n        data-duration="${num(total)}"\n        data-track-index="${escenas.length + 1}"\n        data-track-kind="graphics"\n        data-width="${ANCHO}"\n        data-height="${ALTO}"\n        style="z-index:10"\n      ></div>`,
  );

  const audio = `      <audio id="cama" class="clip" src="assets/cama.wav" data-start="0" data-duration="${num(total)}" data-track-index="0" data-volume="${VOLUMEN_CAMA}"></audio>`;
  fs.writeFileSync(
    path.join(dir, "index.html"),
    rellenar(tpl.index, {
      TITULO: esc(`Ethonik — ${id}`), FONDO: marca.mo.fondo, DURACION: num(total),
      HOSTS: hosts.join("\n"), AUDIO: audio,
    }),
  );
  fs.writeFileSync(
    path.join(dir, "hyperframes.json"),
    JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: false } }, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id, name: id }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "cama.json"), JSON.stringify({ duracion: Math.round(total * 1000) / 1000, acentos, destino: path.join(dir, "assets", "cama.wav"), bpm: g.bpm ?? 88 }) + "\n");

  if (medidor) await medidor.cerrar();
  fs.rmSync(paginaMedida, { force: true });
  console.log(`  ${id}: ${escenas.length} escenas, ${num(total)} s, modo ${modoNombre}`);
  if (marca.grad.recortado) console.log(`    (gradiente del titular recortado al tramo con contraste ≥ ${CONTRASTE_TITULAR}:1)`);
  return { id, dir, total };
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------
const a = argumentos(process.argv);
let guiones;
try {
  guiones = JSON.parse(fs.readFileSync(a.guion, "utf8"));
} catch (e) {
  fallar(`no pude leer el guion ${a.guion}: ${e.message}`);
}
// Mismos tres formatos que acepta video.py
if (Array.isArray(guiones)) { /* lista de videos */ }
else if (guiones && Array.isArray(guiones.escenas)) guiones = [guiones];
else if (guiones && Array.isArray(guiones.videos)) guiones = guiones.videos;
else fallar("el guion debe traer {\"videos\":[...]}, un video con \"escenas\", o una lista de videos");
if (guiones.length === 0) fallar("el guion no trae videos");

const marca = cargarMarca(a.marca, a.modo);
const raiz = path.resolve(a.trabajo);
fs.mkdirSync(raiz, { recursive: true });
// Navegador con el que se mide el texto (render.sh lo exporta); sin él se usa una estimación.
const chrome = process.env.MOTOR_VIDEO_CHROME || process.env.CHROME_PATH || process.env.HYPERFRAMES_BROWSER_PATH || "";
const hechos = [];
for (const g of guiones) hechos.push(await construirVideo(g, marca, a.modo, raiz, chrome));
const ids = new Set();
for (const h of hechos) {
  if (ids.has(h.id)) fallar(`dos videos del guion terminan con el mismo id: ${h.id}`);
  ids.add(h.id);
}
fs.writeFileSync(path.join(raiz, "lista.tsv"), hechos.map((h) => `${h.id}\t${h.dir}\t${num(h.total)}`).join("\n") + "\n");
