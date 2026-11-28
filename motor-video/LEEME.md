# Motor de video de Ethonik (HyperFrames)

Genera los videos verticales semanales (≈35 s) con **motion graphics hechos en HTML y renderizados con
[HyperFrames](https://hyperframes.heygen.com)**, en vez de animar una captura fija con zoom en FFmpeg
(`motor/video.py`). Lee **el mismo `guion.json`** y la **misma identidad** (`motor/marca.json`).

Todo es tipografía y formas dibujadas por código: sin fotos, sin video, sin imágenes generadas por IA y sin voz.
El audio es la cama sonora sintetizada de `motor/audio.py`.

> **Pendiente: la prueba en Linux.** Todo se probó en **macOS arm64**. **No se ha probado en un contenedor Linux
> (Ubuntu)**: ni la instalación, ni el límite de 3 minutos, ni las librerías del sistema que necesita Chrome, ni la
> descarga de Chrome en Linux. Hasta que se pruebe ahí, no hay que darlo por validado para producción.
> Detalle en «Qué se probó y qué no».
>
> **Variable del navegador:** HyperFrames 0.8.191 lee **`HYPERFRAMES_BROWSER_PATH`** (alias
> `PRODUCER_HEADLESS_SHELL_PATH`) para usar un Chrome/Chromium propio. `CHROME_PATH` es solo la comodidad de estos
> scripts: `render.sh` e `instalar.sh` la copian a `HYPERFRAMES_BROWSER_PATH`.

## Uso

```bash
bash motor-video/instalar.sh                                   # una vez, en un contenedor nuevo
bash motor-video/render.sh <guion.json> <carpeta-salida> [--modo claro|oscuro]
```

- Por cada video del guion deja `<carpeta-salida>/<id>.mp4`, con el mismo nombre que genera `video.py`.
- Salida: **1080×1920, 30 fps, H.264, yuv420p, AAC, `+faststart`**. La duración es **la suma exacta de las escenas**.
- Modo por defecto: `oscuro`. No es interactivo; sale con código distinto de 0 si algo falla.
- `render.sh` verifica cada MP4 con `ffprobe` (`verificar.py`) antes de darlo por bueno.

Variables opcionales:

| Variable | Para qué |
|---|---|
| `CHROME_PATH` | Ejecutable de Chrome/Chromium a usar; se exporta como `HYPERFRAMES_BROWSER_PATH`. No se descarga nada. Si no existe, error. |
| `HYPERFRAMES_BROWSER_PATH` | La variable que lee HyperFrames. Si ya está definida, se respeta. |
| `MARCA` | Otra ruta a `marca.json` (por defecto `../motor/marca.json`). |
| `HF_WORKERS` | Procesos de captura en paralelo (por defecto, automático). |
| `MOTOR_VIDEO_CONSERVAR=1` | No borra la carpeta de trabajo temporal (para abrirla en el Studio, ver «Desarrollo»). |
| `MOTOR_VIDEO_CHROME` | Navegador con el que `construir.mjs` mide el texto. `render.sh` la fija sola. |

## Entrada: `guion.json` (contrato fijo)

Acepta los tres formatos de `video.py`: `{"videos":[...]}`, un video con `"escenas"`, o una lista de videos.

```json
{"videos":[{"id":"slug","escenas":[
  {"tipo":"gancho","duracion":3.5,"texto":"..."},
  {"tipo":"punto","duracion":9,"texto":"...","apoyo":"..."},
  {"tipo":"cierre","duracion":5,"texto":"...","cta":"ethonik.com"}]}]}
```

Límites que respeta quien escribe el guion: gancho 45, texto de punto 60, apoyo 55, cierre 55 caracteres.
Si se pasan, el motor **avisa pero no falla**. Cualquier `tipo` que no sea `gancho` ni `cierre` se trata como `punto`
(igual que `video.py`). El `id` se convierte a `slug` con el mismo criterio que `motor/render.py`.
Ejemplos: `ejemplos/guion-2026-10-19.json` (real) y `ejemplos/guion-estres.json` (textos exactamente al límite, con
Á É Í Ó Ú Ñ y palabras largas como «RESPONSABILIDAD»).

## Cómo funciona

```
render.sh ─► construir.mjs   lee guion.json + motor/marca.json, mide los textos en Chrome y escribe un proyecto
                             HyperFrames por video
          ─► cama.py         llama a motor/audio.py y normaliza la cama a -18 LUFS (ffmpeg)
          ─► hyperframes     renderiza el proyecto a MP4 (Chrome headless + FFmpeg)
          ─► verificar.py    ffprobe: resolución, fps, códec, pix_fmt, audio AAC, +faststart, duración ±0,1 s
```

Cada escena es una composición (`compositions/gancho.html`, `punto-1.html`… `cierre.html`) montada con su
`data-start`/`data-duration` tomados del guion. Una composición más, `marco.html`, dura todo el video y guarda lo que
persiste entre escenas (logo pequeño del gancho e indicador de avance), así no parpadea al cambiar de escena.
Los textos son variables de HyperFrames, editables en el Studio.

Plantillas: `plantilla/` (`index.html`, `escena.html`, `marco.html` y `tipos/*.html|js`).

### Marca (se lee en cada corrida, nada se copia a mano)

De `motor/marca.json` se usan `colores`, `gradiente_titulo`, `gradiente_titulo_oscuro`, `modos` (fondo, texto,
texto suave, logo) y `tipografia` (familia y pesos). Si ese archivo cambia, el video cambia solo.
No se usan `layout` ni `formatos` (la geometría del video es fija).

- **Logos:** `modos[modo].logo`. En el repo los SVG están sueltos junto a `marca.json`, así que si la ruta del JSON
  (`logos/…`) no existe se busca el mismo nombre de archivo junto a `marca.json`.
- **Tipografía:** Inter 400/600/700/900 **desde `@fontsource/inter`** (npm), copiada a `assets/fonts/` de cada proyecto
  y registrada con `@font-face` local, con el alias «Inter Local» para que siempre se use ese archivo y no una fuente
  incluida en la CLI.

### Diseño

| Escena | Qué pasa |
|---|---|
| **gancho** | Texto completo desde el fotograma 0 (es la portada). Logo pequeño visible desde el 0. Luego, ajuste de escala 1,02→1 y un subrayado que se dibuja. |
| **punto** | Indicador 1/3, 2/3, 3/3. El texto principal entra primero; el apoyo, 1 s después, en otro color de la paleta y más pequeño. Después todo queda quieto. |
| **cierre** | Logo, texto de cierre y firma (`cta`, p. ej. ethonik.com) como firma de marca, sin forma de botón. |

- **Transiciones:** fundido de 0,4 s centrado en el límite entre escenas. El texto saliente se apaga antes del límite y
  el entrante aparece después; nunca se superponen dos textos. En la franja superior, lo que sale (logo del gancho)
  termina de apagarse **antes** de que empiece a aparecer lo que entra (indicador), sin que coincidan nunca; entre
  puntos, el indicador se queda fijo y solo cambian las barras y la etiqueta. Hay un instante (≈ 1 cuadro, en el
  límite) con solo el fondo. **Cada escena conserva su duración**, por eso el total es la suma exacta (con `xfade`,
  `video.py` acortaba ~0,45 s por empalme).
- **Posición:** el bloque de texto se centra en el cuadro (centro vertical y = 960) y termina antes de y = 1500.
  El logo/indicador ocupa la franja y = 232–344.
- **Zonas seguras (TikTok/Reels):** nada en los 220 px de arriba, los 420 de abajo ni los 140 de la derecha. Se usa una
  caja de 800 px de ancho centrada (140 px a cada lado).
- **Tamaños:** texto principal ≥ 64 px; apoyo ≥ 40 px. El motor **mide cada texto en Chrome** (`medir.mjs`, con el
  mismo CSS y las mismas fuentes que el render) y usa el tamaño más grande que cabe, con un margen del 3 %.
  Los titulares en mayúsculas usan peso 900 con `line-height` 1,12 y `padding-top`, para que las tildes no se
  monten sobre la línea de arriba.
- **Saltos de línea:** los signos de apertura ¿ ¡ y las palabras de 1–2 letras se pegan a la palabra siguiente con
  espacio no separable (U+00A0), para que nunca queden solos al final de una línea. Los guiones dentro de palabras
  (`GPT-4.1`) usan guion no separable (U+2011). Consecuencia: una cadena de palabras cortas forma un bloque
  indivisible (p. ej. «La·IA·encontró») y puede obligar a un titular más pequeño. Si un bloque no cabe ni a 64 px, el
  motor suelta el último enlace de ese bloque y avisa (`AVISO` en la salida); en el guion de estrés pasa una vez
  («NO ES / RESPONSABILIDAD:»: la palabra ya ocupa casi toda la línea).
- **Contraste (WCAG AA):** 3:1 para titulares (texto grande) y 4,5:1 para el resto, calculado en cada corrida contra el
  fondo real. En oscuro se usa el gradiente oficial completo; en claro, el lima sobre crema no llega a 3:1, así que el
  gradiente se **recorta** al tramo legible (sin tocar `marca.json`). El lima es solo acento (indicador, subrayado).
- **Audio:** cama de `motor/audio.py` normalizada a **−18 LUFS integrados** con techo de **−1 dBTP** (`cama.py`: se
  mide con `ffmpeg ebur128` y se aplica una ganancia fija). Medido en los MP4 finales: **−18,0 LUFS y pico verdadero
  de −2,8 dBTP**. Los acentos caen en el inicio de cada escena salvo la primera, como en `video.py`.

## Dependencias

| Qué | Versión | Cómo se instala |
|---|---|---|
| Node | ≥ 22 | ya viene en el contenedor |
| FFmpeg / ffprobe | cualquiera reciente | ya viene en el contenedor |
| Python 3 | 3.9 – 3.12 | ya viene en el contenedor (numpy 2.0.2 solo tiene ruedas hasta 3.12; con 3.13 debe haber un numpy en el sistema) |
| `hyperframes` | 0.8.191 | `npm ci` |
| `puppeteer-core` | 25.16.0 | `npm ci` (solo para medir texto; no descarga ningún navegador) |
| `gsap` | 3.15.0 | `npm ci` (se copia a `assets/`, sin CDN) |
| `@fontsource/inter` | 5.3.0 | `npm ci` |
| `numpy` | 2.0.2 | el del sistema si existe; si no, `.venv` con `requirements.txt` |

Todas las versiones están **fijas y con más de 14 días de publicadas** (verificado el 2026-11-07 contra el registro
de npm para las dependencias de `package-lock.json`, también las transitivas). Al instalar, 8 transitivas
resolvieron a versiones de los últimos días (la más reciente, `hono@4.13.17`, ese mismo día), así que `package.json`
trae `overrides` que las dejan en la versión más nueva con más de 14 días. Al actualizar, hay que repetir esa
comprobación.

Red que necesita cada paso: `instalar.sh` usa el registro de npm y, solo si no hay numpy, PyPI. `render.sh` **no
necesita red** si hay navegador (se probó con la red saliente bloqueada). Se desactivan la telemetría y el aviso de
actualizaciones de la CLI (`HYPERFRAMES_NO_TELEMETRY`, `DO_NOT_TRACK`, `HYPERFRAMES_NO_UPDATE_CHECK`).

## El navegador (Chrome) en producción

HyperFrames necesita un Chrome/Chromium headless. Se elige así, en este orden (`navegador.sh`):

1. **`CHROME_PATH`**, si está definida: se usa ese ejecutable (se exporta como `HYPERFRAMES_BROWSER_PATH`) y no se
   descarga nada. Si no existe, error.
2. Si ya está definida `HYPERFRAMES_BROWSER_PATH`, se respeta.
3. Si existe **`/opt/pw-browsers`** (o `$PLAYWRIGHT_BROWSERS_PATH`), se busca el Chromium de Playwright: primero el
   *headless shell* (`chromium_headless_shell-*/…`), luego el Chromium completo (`chromium-*/chrome-linux*/chrome`) y,
   si existe, un ejecutable directo `chromium`.
4. Solo si no hay ninguno, se usa el Chrome Headless Shell de HyperFrames con `hyperframes browser ensure`, que **no
   descarga nada si ya está en caché** (`~/.cache/hyperframes/chrome`).

**Cómo se le indica un ejecutable propio a HyperFrames 0.8.191:** con la variable de entorno
**`HYPERFRAMES_BROWSER_PATH`** (alias: `PRODUCER_HEADLESS_SHELL_PATH`). Si el archivo no existe, la CLI falla en vez de
descargar. Sin esa variable, la CLI ignora el Chrome del sistema.

**Qué se descarga en el caso 4** (leído del código de la CLI y confirmado con una consulta HEAD):

- Chrome Headless Shell **v152.0.7977.30** («Chrome for Testing»).
- Desde `https://storage.googleapis.com/chrome-for-testing-public/152.0.7977.30/<plataforma>/chrome-headless-shell-<plataforma>.zip`.
- `linux64`: 119 388 396 bytes (≈ 119 MB); `mac-arm64`: 97 532 843 bytes. Se guarda en `~/.cache/hyperframes/chrome/`.
- Si ese dominio está bloqueado, la descarga falla: en ese contenedor hay que usar `CHROME_PATH` o `/opt/pw-browsers`.
- No existe build de Chrome for Testing para **Linux arm64**; allí solo sirve un Chromium propio.
- En Linux, Chrome necesita librerías del sistema. `instalar.sh` las instala con `apt-get` **solo si es root y solo en
  el caso 4**: `libgbm1 libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 libxrandr2 libcups2 libasound2
  (libasound2t64 en Ubuntu 24.04) libpangocairo-1.0-0 libxshmfence1 libgtk-3-0 fonts-liberation fontconfig`.
  Con el Chromium de Playwright se asume que ya están.

## Qué se probó y qué no

Probado en **macOS arm64 (Apple M5 Pro)** con Node 22.23.4 y FFmpeg 9.0.2:

- `hyperframes check` sin errores ni avisos en los 3 guiones, en los dos modos (layout, movimiento y contraste).
- Los 3 guiones en los dos modos → 6 MP4 que cumplen el contrato (`ffprobe` directo: 1080×1920, 30 fps, H.264,
  yuv420p, AAC, 35,500 s exactos) y miden **−18,0 LUFS / −2,8 dBTP**.
- 30 fotogramas a mitad de escena extraídos de los MP4: 0 píxeles de texto o logo en las zonas prohibidas, y el
  bloque de texto centrado (centro vertical medio 975; el del cuadro es 960).
- Saltos de línea medidos en Chrome sobre los 3 guiones: ningún ¿/¡ ni palabra de 1–2 letras queda al final de una
  línea, salvo el caso inevitable del guion de estrés descrito arriba.
- Transición gancho → punto 1 con fotogramas cada 0,1 s (3,2–3,9 s): el logo termina de apagarse antes de que
  empiece a aparecer el indicador (`muestras/transicion-gancho-punto1-*.png`).
- Render con tres navegadores (medido con una versión anterior del diseño): Chrome headless shell de la CLI (152), el
  headless shell de Playwright (149) y el Chromium completo de Playwright. Diferencia media ≤ 0,35 sobre 255.
- Copia limpia (`HOME` vacío, sin `node_modules`) con `CHROME_PATH` y **con la red saliente bloqueada**:
  `instalar.sh` tardó 19 s y `render.sh` renderizó el guion real (2 videos) con el headless shell de Playwright y
  el de estrés con el Chromium completo de Playwright. `CHROME_PATH` inválido y «ningún navegador y sin red» fallan con un mensaje claro y código 1.

**No probado (pendiente):**

- **Un contenedor Linux/Ubuntu real** (no hay Docker aquí): instalación, librerías de Chrome, descarga de Chrome en
  Linux y los **3 minutos** de `instalar.sh`. Los tiempos de render (≈ 19 s por video en esta Mac, 15 núcleos) serán
  mayores con menos CPU.
- La estructura real de `/opt/pw-browsers` del contenedor de producción: la búsqueda cubre los nombres habituales de
  Playwright, pero solo se probó con la estructura de macOS (`chromium-*/chrome-mac-arm64/…`,
  `chromium_headless_shell-*/chrome-headless-shell-mac-arm64/…`).

## Limitaciones

- Sin navegador disponible al construir, `construir.mjs` usa una **estimación conservadora** de anchos (titulares algo
  más pequeños) y lo avisa. Si se edita un texto en el Studio, el tamaño no se reajusta.
- Las palabras cortas pegadas pueden dar titulares más pequeños (ver «Saltos de línea»).
- La geometría es fija (1080×1920); `marca.json → formatos/layout` no se usan.
- Las dependencias están fijadas en 0.8.191 de la CLI. Las skills de HyperFrames para asistentes de IA (0.9.x) pueden
  describir funciones más nuevas que las de esta versión.
- `construir.mjs` avisa si un texto pasa el límite de caracteres, pero no lo recorta.

## Desarrollo

```bash
MOTOR_VIDEO_CONSERVAR=1 bash motor-video/render.sh motor-video/ejemplos/guion-2026-10-19.json /tmp/salida
cd <carpeta de trabajo que imprime>/fecha-de-caducidad
../../node_modules/.bin/hyperframes check      # lint + runtime + layout + contraste
../../node_modules/.bin/hyperframes preview    # Studio, para ver y editar
../../node_modules/.bin/hyperframes snapshot --at 0,17,33
```

Ajustes comunes: duración del fundido (`MEDIO_FUNDIDO`), zona segura (`CAJA`), volumen de la cama (`VOLUMEN_CAMA`) y
umbrales de contraste (`CONTRASTE_TITULAR`, `CONTRASTE_TEXTO`) están al principio de `construir.mjs`; el objetivo de
sonoridad (`OBJETIVO_LUFS`, `PICO_MAX_DBTP`) está en `cama.py`.

`.gitignore` excluye `node_modules/`, `.venv/`, `salida/`, `trabajo/`, `*.mp4` y `*.wav`.
`muestras/` guarda unas imágenes fijas de referencia.
