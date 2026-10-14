#!/usr/bin/env python3
"""
Cama sonora generada por código — Ethonik
-----------------------------------------
Sintetiza una pista instrumental para los videos verticales. No descarga nada
ni usa música de terceros: todo se genera con osciladores, así que no hay
derechos de autor que reclamar ni sorpresas de copyright en las plataformas.

Diseño: pad sostenido en modo menor, pulso de bajo, percusión seca, y un golpe
de acento en cada cambio de escena. Volumen bajo a propósito — es una cama, no
una canción: el mensaje lo carga el texto en pantalla.

Uso como módulo:
    from audio import generar_cama
    generar_cama(duracion=34.2, acentos=[3.5, 12.5, 22.0, 31.0], destino="cama.wav")
"""

import math
import struct
import wave

import numpy as np

SR = 44100

# La menor natural: raíces de la progresión Am – F – C – G, en Hz.
PROGRESION = [220.00, 174.61, 261.63, 196.00]   # A3, F3, C4, G3
COMPAS = 4.0                                     # segundos por acorde


def _env(n, ataque, caida, sostenido=1.0, liberacion=0.0):
    """Envolvente ADSR sencilla en muestras."""
    e = np.ones(n) * sostenido
    a = min(int(ataque * SR), n)
    if a:
        e[:a] = np.linspace(0, 1, a) * sostenido
    d = min(int(caida * SR), n - a)
    if d:
        e[a:a+d] = np.linspace(sostenido, sostenido, d)
    r = min(int(liberacion * SR), n)
    if r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def _pad(dur):
    """Acordes sostenidos: tres armónicos por nota, con vibrato lento."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    salida = np.zeros(n)
    for i in range(int(math.ceil(dur / COMPAS))):
        raiz = PROGRESION[i % len(PROGRESION)]
        ini, fin = int(i * COMPAS * SR), min(int((i + 1) * COMPAS * SR), n)
        if fin <= ini:
            break
        tt = t[ini:fin] - t[ini]
        voz = np.zeros(fin - ini)
        # fundamental, quinta y octava, cada una más suave
        for mult, amp in ((1.0, 0.55), (1.5, 0.28), (2.0, 0.18), (2.5, 0.08)):
            lfo = 1 + 0.0016 * np.sin(2 * np.pi * 0.22 * tt + mult)
            voz += amp * np.sin(2 * np.pi * raiz * mult * lfo * tt)
        # entrada y salida suaves para que no se oiga el corte entre acordes
        cruce = int(0.55 * SR)
        env = np.ones(len(voz))
        env[:cruce] = np.linspace(0, 1, min(cruce, len(voz)))
        env[-cruce:] *= np.linspace(1, 0.35, min(cruce, len(voz)))
        salida[ini:fin] += voz * env
    return salida * 0.16


def _bajo(dur, bpm=88):
    """Pulso de bajo en las negras, con caída rápida."""
    n = int(dur * SR)
    salida = np.zeros(n)
    paso = 60.0 / bpm
    golpe = int(0.34 * SR)
    tg = np.arange(golpe) / SR
    for k in range(int(dur / paso)):
        ini = int(k * paso * SR)
        if ini + golpe > n:
            break
        raiz = PROGRESION[int((k * paso) // COMPAS) % len(PROGRESION)] / 2
        onda = np.sin(2 * np.pi * raiz * tg) * np.exp(-tg * 7.5)
        salida[ini:ini+golpe] += onda
    return salida * 0.22


def _percusion(dur, bpm=88):
    """Tick seco en contratiempo: da movimiento sin robar atención."""
    rng = np.random.default_rng(11)
    n = int(dur * SR)
    salida = np.zeros(n)
    paso = 60.0 / bpm / 2
    tick = int(0.045 * SR)
    tt = np.arange(tick) / SR
    for k in range(int(dur / paso)):
        if k % 2 == 0:
            continue
        ini = int(k * paso * SR)
        if ini + tick > n:
            break
        salida[ini:ini+tick] += rng.normal(0, 1, tick) * np.exp(-tt * 190)
    return salida * 0.055


def _acentos(dur, tiempos):
    """Golpe grave y barrido corto en cada cambio de escena."""
    n = int(dur * SR)
    salida = np.zeros(n)
    largo = int(0.9 * SR)
    tt = np.arange(largo) / SR
    for s in tiempos:
        ini = int(max(s - 0.12, 0) * SR)
        if ini + largo > n:
            continue
        # golpe: seno que baja de 120 a 45 Hz
        f = 120 * np.exp(-tt * 3.4) + 45
        golpe = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 4.2) * 0.5
        # barrido: ruido filtrado que sube
        rng = np.random.default_rng(int(s * 100))
        ruido = rng.normal(0, 1, largo) * np.linspace(0, 1, largo) ** 3 * 0.09
        salida[ini:ini+largo] += golpe + ruido
    return salida


def _suavizar(x, ventana=64):
    """Filtro de media móvil: quita el filo digital del ruido."""
    k = np.ones(ventana) / ventana
    return np.convolve(x, k, mode="same")


def generar_cama(duracion: float, acentos=None, destino="cama.wav", bpm=88):
    acentos = acentos or []
    mezcla = (
        _pad(duracion)
        + _bajo(duracion, bpm)
        + _suavizar(_percusion(duracion, bpm), 8)
        + _acentos(duracion, acentos)
    )

    # entrada y salida de la pista completa
    n = len(mezcla)
    ent, sal = int(1.2 * SR), int(2.0 * SR)
    mezcla[:ent] *= np.linspace(0, 1, ent)
    mezcla[-sal:] *= np.linspace(1, 0, sal)

    # normalizar con margen: la cama nunca debe tapar nada
    pico = np.max(np.abs(mezcla)) or 1.0
    mezcla = mezcla / pico * 0.62

    datos = (mezcla * 32767).astype(np.int16)
    estereo = np.repeat(datos[:, None], 2, axis=1).flatten()
    with wave.open(destino, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack(f"<{len(estereo)}h", *estereo))
    return destino


if __name__ == "__main__":
    import sys
    dur = float(sys.argv[1]) if len(sys.argv) > 1 else 34.2
    generar_cama(dur, [3.5, 12.5, 22.0, 31.0], "cama.wav")
    print(f"cama.wav — {dur:.1f}s")
