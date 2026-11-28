// Mide los textos en Chrome (con el mismo CSS y las mismas fuentes que el render) para elegir el tamaño de letra
// más grande que cabe. Reemplaza a la estimación de anchos de construir.mjs cuando hay un navegador disponible.
//
// Los textos llevan espacios no separables (U+00A0) tras ¿, ¡ y las palabras de 1–2 letras. Eso forma bloques
// indivisibles que pueden ser más anchos que la caja: si no caben ni al tamaño mínimo, se suelta el último enlace
// de ese bloque (y se avisa), en vez de desbordar.
import path from "node:path";

export async function abrirMedidor({ chrome, paginaRuta, familia, pesos }) {
  let puppeteer;
  try {
    ({ default: puppeteer } = await import("puppeteer-core"));
  } catch {
    return null;
  }
  const headless = path.basename(chrome).toLowerCase().includes("headless") ? "shell" : true;
  const browser = await puppeteer.launch({ executablePath: chrome, headless, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });
  await page.goto("file://" + paginaRuta, { waitUntil: "load" });
  await page.evaluate(async (fam, ws) => {
    for (const w of ws) await document.fonts.load(`${w} 40px "${fam}"`);
    await document.fonts.ready;
  }, familia, pesos);

  return {
    /**
     * @returns {{tam:number, texto:string, ok:boolean, relajados:number}}
     * clase: clase CSS del elemento (grad | punto-titular | apoyo | cta). margen: se mide al 97 % del ancho para
     * tolerar pequeñas diferencias de métrica entre versiones de Chrome.
     */
    ajustar(texto, { clase, base, min, maxAlto, margen = 0.97 }) {
      return page.evaluate(
        ({ texto, clase, base, min, maxAlto, margen }) => {
          const caja = document.getElementById("__b");
          caja.innerHTML = "";
          const el = document.createElement("div");
          el.className = clase;
          el.style.width = margen * 100 + "%";
          caja.appendChild(el);
          const probar = (txt, t) => {
            el.textContent = txt;
            el.style.fontSize = t + "px";
            return el.scrollWidth <= el.clientWidth + 0.5 && el.getBoundingClientRect().height <= maxAlto;
          };
          const limite = el.clientWidth || 800 * margen;
          const anchoBloque = (txt, t) => {
            const s = document.createElement("span");
            s.style.cssText = "position:absolute;white-space:nowrap;visibility:hidden";
            s.className = clase;
            s.style.fontSize = t + "px";
            s.style.width = "auto";
            s.style.padding = "0";
            s.textContent = txt;
            caja.appendChild(s);
            const w = s.getBoundingClientRect().width;
            s.remove();
            return w;
          };
          let actual = texto, relajados = 0;
          for (;;) {
            for (let t = base; t >= min; t -= 2) if (probar(actual, t)) return { tam: t, texto: actual, ok: true, relajados };
            // Ni al mínimo cabe: buscar el bloque indivisible más ancho y soltar su último espacio no separable.
            const bloques = actual.split(" ");
            let peor = -1, peorAncho = 0;
            bloques.forEach((b, i) => {
              if (!b.includes(" ")) return;
              const w = anchoBloque(b, min);
              if (w > peorAncho) { peorAncho = w; peor = i; }
            });
            if (peor < 0 || peorAncho <= limite) return { tam: min, texto: actual, ok: false, relajados };
            const b = bloques[peor], k = b.lastIndexOf(" ");
            bloques[peor] = b.slice(0, k) + " " + b.slice(k + 1);
            actual = bloques.join(" ");
            relajados++;
          }
        },
        { texto, clase, base, min, maxAlto, margen },
      );
    },
    cerrar: () => browser.close(),
  };
}
