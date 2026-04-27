# Inventario de controles flotantes

**Autor:** skill `ux-ui`
**Fecha:** 2026-04-21
**Consumen:** `GET /api/bible/versions`, `GET /api/bible/verses`, `GET /api/search`, `GET /api/timelines/{id}/viewport`

Todos los controles son **DOM sobre canvas** (no dibujados en canvas). Esto permite accesibilidad nativa del navegador (focus rings, lectores de pantalla, atajos del SO) y evita rehacer inputs desde cero.

## Convenciones

- Los controles usan `position: fixed` + `z-index` ordenado: topbar (40), FAB/sidebar (30), sheet (20), minimapa (10).
- Fondo translúcido con `backdrop-filter: blur(12px)` para mantener contexto visual del canvas.
- Todas las áreas activas miden ≥ 44×44 px (guía iOS/Material).
- Cada control declara su **estado** (visible/hidden/disabled) en el store del cliente; nadie toca el DOM directamente fuera del componente dueño.
- Animaciones de entrada/salida con `transform` + `opacity`, nunca `width/height/top` (repaint costoso).

## 1. Topbar (móvil y desktop)

**Archivo:** `web/src/ui/topbar.ts`

| Pieza | Móvil | Desktop |
|---|---|---|
| Logo/título | oculto | visible a la izquierda, 18 px |
| Buscador | icono ⌕ que expande input full-width overlay | input inline, 320 px ancho, placeholder "Buscar referencia o texto" |
| Selector de versiones | un chip compacto "RV60 +" que abre modal | dos chips "RV60 ▼" y "+ versión" inline |
| Settings ⚙ | dentro del menú ⋮ | botón aparte a la derecha |

Comportamiento:
- En móvil la topbar se **auto-oculta en scroll vertical del sheet** y reaparece en pan horizontal del canvas.
- El buscador envía `GET /api/search?q=...` con debounce 200 ms. Sugerencias debajo en dropdown, con categorías: "Referencia" (Génesis 1:1), "Libro", "Evento", "Texto".
- Al elegir una sugerencia → emit `focusRef` o `focusEventId` al store → el canvas recentraliza.

## 2. FAB de zoom (móvil)

**Archivo:** `web/src/ui/zoom-fab.ts`

Trío de botones redondos apilados horizontalmente en bottom-right, separados 8 px:

```
[ ⊖ ] [ ⌖ ] [ ⊕ ]
```

- `⊖` (zoom-out): decrementa `zoomFactor` un 20% del rango del nivel actual.
- `⌖` (home/center): centra el foco actual; long-press → vuelve a `focusEventId: <primer root>`.
- `⊕` (zoom-in): incrementa `zoomFactor` un 20%.

Estados:
- `⊖` disabled si `zoomFactor ≤ 0.01`.
- `⊕` disabled si `zoomFactor ≥ 0.99`.
- En desktop estos controles viven en la esquina bottom-left en tamaño más pequeño (32 px), con tooltip de atajo `+/-`.

Se oculta automáticamente cuando el sheet está expandido > 80%.

## 3. Bottom-sheet de lectura (móvil)

**Archivo:** `web/src/ui/reading-sheet.ts`

```
┌────────────────────────────────┐
│ ═══  (handle de 36 px)         │  ← tap = toggle, drag = resize
├────────────────────────────────┤
│  Génesis 1:26 · Humanidad  ⓘ  │  ← header sticky con ref actual
├────────────────────────────────┤
│  [RV60]  [+ comparar]          │  ← tabs de versiones
├────────────────────────────────┤
│  26 Entonces dijo Dios:        │
│     Hagamos al hombre a        │  ← contenido scrollable
│     nuestra imagen...          │
│  27 Y creó Dios al hombre...   │
│                                │
│     (scroll sincroniza foco)   │
└────────────────────────────────┘
```

Snap points: 0 px (oculto, solo handle de 36 px visible), 40% alto, 90% alto.

Al hacer scroll vertical dentro del sheet, el verso que queda centrado vertical se convierte en el **nuevo focus**. El canvas actualiza el foco sin disparar una nueva request hasta que el verso cruza el rango de un evento diferente.

Botón ⓘ abre tarjeta de detalle del evento enfocado (summary extendido, fuentes `timeline_event_sources`, enlaces a referencias relacionadas).

## 4. Sidebar de lectura (tablet/desktop)

**Archivo:** `web/src/ui/reading-sidebar.ts`

Versión expandida del sheet, ancla derecha:

- Ancho: 384 px mínimo, 640 px máximo, `resize handle` en el borde izquierdo.
- Colapsable con botón `>` que la esconde, quedando un rail de 48 px con el título vertical del evento enfocado.
- Hasta 2 columnas paralelas (RV60 + una segunda versión). La segunda columna se añade con el botón "+ versión"; al añadir, el layout divide 50/50.
- Cada columna tiene su propio header con el código de versión y un ✕ para cerrarla (no aplica a la primera).

## 5. Selector de versiones

**Archivo:** `web/src/ui/version-picker.ts`

Modal centrado (móvil) o popover debajo del chip (desktop):

```
┌──────────────────────────────┐
│ Versión secundaria         ✕ │
├──────────────────────────────┤
│ Español                      │
│ ◉ RV60 — Reina-Valera 1960   │  ← activa como primaria
│ ○ NTV — Nueva Traducción V.  │
│ ○ DHH — Dios Habla Hoy       │
│ ○ LBA — La Biblia de las A.  │
│ ○ NBH, NBL, PDT, TLA         │
├──────────────────────────────┤
│ Idiomas originales           │
│ ○ BHS (Hebreo - OT)          │
│ ○ LXX (Griego - Septuaginta) │
│ ○ HEB_OSHB, HEB_OSMHB        │
│ ○ GRC_TR, GRC_WH, GRC_F35    │
└──────────────────────────────┘
```

Fuente de datos: `GET /api/bible/versions`. El modal se inicializa con la selección actual. Permite drag de tarjetas para reordenar columnas cuando se activen múltiples.

## 6. Buscador / palette

**Archivo:** `web/src/ui/search-palette.ts`

Overlay full-width en móvil, popover en desktop. Tres categorías de resultados:

1. **Referencias**: reconoce `Génesis 1:1`, `Gen 1`, `gn1:1`, `1 Rey 17:1`. Si matchea → ir directo.
2. **Eventos**: hits por `title` de `timeline_events` (`importance` desc, luego alfabético).
3. **Texto**: full-text de `bible_verses` en la versión primaria (FTS5 si está disponible).

Atajos:
- `/` desde cualquier lado abre el palette.
- `↑/↓` navegan resultados, `Enter` selecciona, `Esc` cierra.
- `Tab` alterna entre categorías (referencia/evento/texto).

## 7. Minimapa de libros (desktop)

**Archivo:** `web/src/ui/book-minimap.ts`

Barra horizontal de 32 px en el borde inferior:

```
Gn │Ex│Lv│Nm│Dt│...│Sal│...│Mt│Mr│Lc│Jn│...│Ap
```

- Cada libro con ancho proporcional a su número de versículos (así el minimapa refleja densidad real).
- Color suave para Antiguo Testamento, color ligeramente distinto para Nuevo Testamento.
- Cursor muestra indicador vertical sobre la posición actual del foco.
- Click → salta al primer versículo de ese libro.
- Oculto en móvil (se reemplaza por el indicador del eje de referencia).

## 8. Tarjeta modal de evento

**Archivo:** `web/src/ui/event-card.ts`

Se abre con:
- Long-press en cápsula (móvil)
- Click en `ⓘ` del sheet (móvil)
- Doble-click en cápsula (desktop)

Contenido:
- Título + rango de referencias
- Summary completo
- Nivel, importancia, canonical
- Lista de `scriptureRefs` (enlaces internos que reubican foco)
- Lista de `sources` con tipo (scripture/historical-note) y referencia externa
- Botón "Leer en contexto" → cierra modal, abre sheet en el primer versículo del evento

## 9. Settings ⚙

**Archivo:** `web/src/ui/settings.ts`

Opciones mínimas para MVP:
- Tema: claro / oscuro / sistema
- Tamaño de texto del sheet: 14/16/18 px
- `prefers-reduced-motion` override (auto / forzar / ignorar)
- Versión primaria activa
- Instalar como PWA (si el navegador soporta `beforeinstallprompt`)

## 10. Feedback y estados de carga

- **Offline**: banner superior con texto "Estás sin conexión. Navegas sobre datos cacheados de RV60." Se quita al reconectar.
- **Loading viewport**: skeleton de cápsulas fantasma en los carriles, sin bloquear gestos. Si el request tarda > 800 ms, aparece spinner en el FAB central.
- **Error de red**: toast en bottom-center "No pudimos cargar esta sección. Reintentando..." con botón manual `Reintentar`.
- **Versículo no encontrado** (al buscar): sugiere correcciones (ej. "¿Quisiste decir Gn 1:1?").

## 11. Interacciones sobre el canvas (aunque técnicamente no son "controles")

| Gesto | Acción |
|---|---|
| Drag horizontal | Pan en eje X, inercia al soltar |
| Drag vertical (desktop) | No-op (el eje Y es estructural, no navegable) |
| Wheel | Zoom centrado en cursor |
| Pinch | Zoom centrado en el punto medio |
| Doble-tap / doble-click en cápsula | Zoom-in sobre esa cápsula con animación 400 ms |
| Single-tap / click en cápsula | Cambia foco a esa cápsula |
| Long-press / doble-click fuera | Abre tarjeta modal |
| Keyboard `←/→` | Pan 1 verso |
| Keyboard `Shift+←/→` | Pan 1 capítulo |
| Keyboard `+/−` | Zoom escalonado |
| Keyboard `Home/End` | Ir al primer/último verso del timeline |
| Keyboard `Space` | Recentrar en foco |

## 12. Checklist de accesibilidad

- Todos los controles tienen rol y `aria-label` en español.
- El canvas tiene `role="application"` y expone el foco actual vía `aria-live="polite"` con el texto del evento.
- Atajos documentados en settings → "Ayuda y atajos".
- Contraste AA mínimo en todo texto sobre canvas/translúcido.
- `prefers-reduced-motion` desactiva: inercia del pan, cross-fade entre niveles, animaciones de snap.
- El selector de versiones y el buscador son completamente usables con solo teclado.
