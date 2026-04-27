# Timeline Layout — Vista horizontal tipo Google Maps

**Autor:** skill `ux-ui`
**Fecha:** 2026-04-21
**Contratos relacionados:** `timeline-viewport-request.schema.json`, `timeline-viewport-response.schema.json`

## 1. Principios

1. El **lienzo** (canvas WebGL/2D) ocupa el 100% del viewport del navegador. Nada se renderiza dentro de un contenedor con márgenes: el timeline ES la ventana.
2. Los controles son **flotantes sobre el canvas**, nunca roban espacio. Se diseñan mobile-first: superficies de tap ≥ 44×44 px, separación segura del notch/home indicator.
3. El eje **X es tiempo narrativo** (verse sequence). Crece de izquierda (Génesis 1:1) a derecha (Apocalipsis 22:21).
4. El eje **Y es profundidad jerárquica**. Los eventos padre se dibujan en carriles superiores; los hijos se apilan debajo de su padre.
5. El **zoom cambia el nivel semántico visible** (niveles 0..4 definidos en `navigation.zoomLevels`), no solo la escala de píxel. El servidor decide qué eventos entran; el cliente solo renderiza lo que le devuelven.
6. El **foco** siempre está centrado horizontalmente. Pan/zoom desplaza el foco; al soltar, se re-centra suavemente.

## 2. Anatomía del lienzo

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ carril L0 ┤ ━━━━━━━━Creación━━━━━━━━━━━━━━━━━━ ┤ ━━Caída━━ ┤ ━━Patriarcas━ │  ← zoomLevel 0 (Panorama)
│                       ▲ expandido                                            │
│ carril L1 ┤ ─D1─ ─D2─ ─D3─ ─D4─ ─D5─ ─D6─ ─D7─                              │  ← zoomLevel 1 (Eras)
│                                ▲ expandido                                    │
│ carril L2 ┤  ──humanidad── ──bendición──                                    │  ← zoomLevel 2 (Narrativas)
│                   ▲ focusedEvent                                              │
│ carril L3 ┤                                                                  │
│ carril L4 ┤                                                                  │
│ ─── eje de referencia (libro / capítulo) ────────────────────────────────    │
│ Génesis                                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
         ↑ foco centrado                  ↑ margen de contexto (~20% ancho cada lado)
```

- Los eventos **en el `focusPath`** se dibujan como carriles horizontales con el título dentro de la cápsula.
- El evento **focused** (`isFocused: true`) se resalta con borde y color de acento; el resto del path (`isFocusAncestor: true`) queda con borde sutil.
- Los **hermanos no expandidos** (`state: "collapsed"`) se dibujan como cápsulas compactas con solo el título truncado.
- Los **descendientes del foco expandido** (`state: "expanded"` con hijos) ocupan el carril de su zoomLevel.
- El ancho de una cápsula = `endSequence − startSequence` escalado por el `zoomFactor` actual.

## 3. Vista móvil (≤ 640 px)

```
┌────────────────────────────────┐  ← safe-area top
│ ⌕  [  buscar referencia  ]  ⚙ │  ← topbar flotante (56px, fondo translúcido)
├────────────────────────────────┤
│                                │
│   canvas                       │
│   timeline                     │
│   horizontal                   │
│                                │
│   (pan/pinch/doble-tap)        │
│                                │
│                                │
│                                │
├────────────────────────────────┤
│ ▲▼  Génesis 1:26 · Humanidad  │  ← handle del bottom-sheet (48px)
├────────────────────────────────┤
│  RV60 | + versión             │  ← tabs de versiones (visible si sheet abierto)
│                                │
│  26 Entonces dijo Dios…        │
│  27 Y creó Dios al hombre…     │  ← contenido del sheet (scrollable)
└────────────────────────────────┘
  [ ⊖ ] [ ⌖ ] [ ⊕ ]  ← FAB trío zoom-/home/zoom+ (flotante bottom-right)
```

- **Topbar** colapsa en scroll vertical dentro del sheet y re-aparece al hacer pan horizontal del canvas.
- **Bottom-sheet** tiene 3 snap points: oculto (solo handle), medio (40% alto), expandido (90%). El canvas siempre muestra el foco arriba del sheet.
- **FAB trío** se oculta cuando el sheet está expandido.
- **Pinch-to-zoom** en el canvas ajusta `zoomFactor` (0..1). Cada cruce de umbral (`minZoomFactor`/`maxZoomFactor`) dispara una nueva request al API.
- **Swipe horizontal en canvas** = pan. **Swipe horizontal en sheet** = cambio de versión (carousel).
- **Doble-tap** en una cápsula = foco en ese evento.
- **Long-press** en una cápsula = tarjeta modal con detalle (importance, fuentes, referencias cruzadas).

## 4. Vista tablet / desktop (≥ 1024 px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Bible Timeline    ⌕ [  buscar  ]    RV60 ▼  + NTV ▼    ⚙   │  ← topbar 64px
├──────────────────────────────────────────┬───────────────────────────────────┤
│                                          │  Génesis 1:26 · Humanidad         │
│                                          │  ─────────────────────────────    │
│                                          │  RV60           │ NTV             │
│   canvas timeline horizontal             │  ─────────────  ─────────────     │
│   (wheel = zoom, drag = pan,             │  26 Entonces    26 Entonces Dios  │
│    ← → = pan fino, ↑↓ = cambia           │     dijo Dios:     dijo: «Ahora   │
│    foco por sibling)                     │     Hagamos al     hagamos a los  │
│                                          │     hombre…        seres humanos» │
│                                          │  27 Y creó…     27 Así que Dios   │
│                                          │                                   │
│                                          │  [ ocultar segunda versión ]      │
│                                          │                                   │
│                                          │                                   │
├──────────────────────────────────────────┴───────────────────────────────────┤
│ Génesis ────────┬──── Éxodo ───┬─── Samuel ───┬── Reyes ──┬── Profetas ──┬── │  ← minimapa 32px
│                 ↑ foco actual                                                 │
└──────────────────────────────────────────────────────────────────────────────┘
      [−][⌖][+]                                                       [?][settings]
```

- **Sidebar de lectura** a la derecha, ancho configurable (384–640 px), con columnas paralelas por versión.
- **Minimapa inferior** de 32 px muestra los 66 libros con proporción real de versículos. Indicador del foco actual. Click → salto directo.
- **Atajos de teclado**: `←/→` pan 1 verso, `Shift+←/→` pan 1 capítulo, `+/−` zoom, `Space` centra en foco, `Esc` cierra sidebar, `/` enfoca el buscador, `v` alterna segunda versión.
- **Hover** en cápsula = tooltip con summary + rango de referencias.
- **Click** = foco. **Doble-click** = zoom-in a ese evento.

## 5. Estados del sistema

| Estado | Gatillo | Comportamiento |
|---|---|---|
| `idle` | después de settle | Canvas estático, se pueden leer tarjetas |
| `panning` | drag activo | Inercia con friction 0.92, re-centrado suave al soltar |
| `zooming` | pinch / wheel | Interpola `zoomFactor`; al cruzar umbral, descarta tiles viejos y pide nuevo viewport |
| `loading-viewport` | request pendiente | Overlay sutil (skeleton de cápsulas), no bloquea gestos |
| `focusing` | tap en cápsula | Animación 300 ms: la cápsula se centra y el foco salta |
| `sheet-open` | swipe-up / tap handle | Bottom-sheet crece; el canvas hace letter-box arriba |

## 6. Decisiones de tipografía y color

- **Escala tipográfica responsiva**: título de cápsula usa clamp(12px, 2.5vw, 16px). Summary en tarjeta usa 14 px.
- **Paleta**:
  - Fondo lienzo: `#0f172a` (slate-900) para contraste con tarjetas
  - Cápsulas canónicas: degradado `#1e293b → #334155` con borde `#475569`
  - Acento foco: `#f59e0b` (amber-500) — borde 2 px + tinte del fill
  - Cápsulas no canónicas (importance < 50): opacidad 0.6 + textura punteada
  - Texto de cápsula: `#e2e8f0`; texto sheet: `#f8fafc` sobre `#1e293b`
- **Modo claro**: invertir paleta base; se configura en settings.
- **Accesibilidad**: contrast AA mínimo en todo texto. Indicador de foco visible (no solo color). `prefers-reduced-motion` desactiva inercia y transiciones largas.

## 7. Flujo del primer uso

1. Usuario abre la app → canvas carga `GET /viewport?zoomFactor=0.05` (Panorama, sin foco → resuelve en el primer root).
2. Ve los 14 eventos raíz, el minimapa de libros, y un onboarding hint: "pellizca o usa scroll para acercar, desliza para moverte".
3. Al pellizcar dentro de "Creación", el cliente incrementa `zoomFactor` y cuando cruza 0.12 emite `GET /viewport?zoomFactor=0.15&focusEventId=creation` → aparecen los 7 días.
4. El bottom-sheet/sidebar muestra automáticamente el rango de versículos del evento enfocado. Usuario lee verso por verso.
5. Al tocar "+ versión", se abre el selector con las 15 disponibles en `resources/biblias/`. Selecciona una → segunda columna aparece sincronizada.

## 8. Fuera de alcance del MVP

- Búsqueda semántica (solo búsqueda de texto exacto/prefijos en RV60).
- Comentarios o notas personales del usuario.
- Compartir vista por URL con parámetros (queda para v1.1 pero sí se deja el estado reflejado en el fragment `#ref=...&zoom=...`).
- Más de 2 versiones simultáneas en el panel de lectura.
- Modo "lectura continua" sin timeline.

## 9. Referencias cruzadas

- Reglas de visibilidad por zoomLevel → ver `visibility-rules.md`.
- Catálogo de controles flotantes → ver `controls-inventory.md`.
- Contrato del viewport → `docs/contracts/timeline-viewport-request.schema.json` + `timeline-viewport-response.schema.json`.
