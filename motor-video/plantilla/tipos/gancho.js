    // El texto completo ya está visible en el fotograma 0 (portada en TikTok/Reels).
    // Solo se enfatiza: ajuste leve de escala y un subrayado que se dibuja.
    tl.fromTo("#{{ID}}-titular", { scale: 1.02 }, { scale: 1, duration: 0.9, ease: "power2.out" }, {{T0}});
    tl.fromTo("#{{ID}}-subrayado", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.out" }, {{T0_SUB}});
