# Reglas de visibilidad por nivel de zoom

**Autor:** skill `ux-ui`
**Fecha:** 2026-04-21
**Base de datos:** `timeline_zoom_levels` + `timeline_events` (esquema en `resources/sql/bible_timeline_schema.sql`)

## Premisa

El servidor (API C#) decide **qué eventos entran** en cada viewport según el `zoomFactor` + `focus` de la request, siguiendo la misma lógica de `scripts/resolve_timeline_viewport.py`. El cliente solo aplica **reglas de presentación** sobre la lista `visibleEvents` que recibe.

Este documento describe ambos lados: las reglas semánticas que debe respetar el servidor y las reglas visuales que aplica el cliente.

## 1. Niveles de zoom (fuente: `navigation.zoomLevels` del seed)

| Nivel | Label | zoomFactor | targetVisibleEvents | Significado |
|---|---|---|---|---|
| 0 | Panorama | 0.00 – 0.12 | 14 | Los 14 eventos raíz canónicos de Génesis a Apocalipsis |
| 1 | Eras | 0.12 – 0.28 | 28 | Eventos de segunda fila dentro del foco + contexto cercano |
| 2 | Narrativas | 0.28 – 0.50 | 56 | Subeventos narrativos del foco |
| 3 | Escenas | 0.50 – 0.75 | 112 | Escenas específicas, grupos pequeños |
| 4 | Versículos | 0.75 – 1.00 | 224 | Máximo detalle; versículos individuales cuando aplique |

El `zoomFactor` que envía el cliente se mapea al nivel cuyo rango lo contenga. Si `zoomFactor` está exactamente en un borde, cae en el nivel superior (`< maxZoomFactor` es estricto, salvo el último nivel).

## 2. Reglas del servidor (ya implementadas en el resolver Python)

**R-S1.** Todo evento `e` con `e.zoomLevel ≤ activeLevel` cuyo rango `[startSequence, endSequence]` intersecta el viewport horizontal debe entrar en la lista de candidatos.

**R-S2.** El `focusPath` debe incluirse siempre que `includeAncestors` sea `true` (default). Sus eventos conservan `state: "expanded"` si tienen hijos cuyo `zoomLevel ≤ activeLevel`; si no, `collapsed`.

**R-S3.** Los hijos de un nodo del `focusPath` se incluyen solo si su `zoomLevel ≤ activeLevel`. Los hijos de **otros** nodos NO se incluyen (evita explotar el viewport con detalle irrelevante).

**R-S4.** El `viewportEventBudget` (default = `targetVisibleEvents` del nivel) es un límite suave. Si el total supera el budget, se prioriza:
1. `focusPath` (siempre visible)
2. Eventos con `importance ≥ 75`
3. Eventos con `canonical: true`
4. El resto, ordenado por cercanía al `resolvedFocusSequence`

**R-S5.** Si `focus` no se especifica, se resuelve al primer root por `sequence`.

## 3. Reglas del cliente (presentación)

### 3.1 Carriles verticales

**R-C1.** Cada `zoomLevel` usa un carril vertical fijo:

| zoomLevel | posición Y (top) | altura |
|---|---|---|
| 0 | 8% del alto del canvas | 15% |
| 1 | 25% | 15% |
| 2 | 42% | 15% |
| 3 | 59% | 15% |
| 4 | 76% | 15% |

En móvil se pueden comprimir los carriles superiores al rango visible (si no se está en nivel 0, ocultar el carril L0 y subir los demás).

**R-C2.** Una cápsula nunca cruza carriles. Si por layout no cabe, se empuja a un sub-carril invisible dentro del mismo nivel (offset vertical ±4 px).

### 3.2 Estados visuales

**R-C3.** Cápsula con `isFocused: true`:
- Borde 2 px color acento (`#f59e0b`)
- Tinte del fill: +12% lightness
- Sombra difusa 8 px

**R-C4.** Cápsula con `isFocusAncestor: true` (y no focused):
- Borde 1 px color acento con alpha 0.6
- Resto normal

**R-C5.** Cápsula con `state: "expanded"`:
- Render como "marco" hueco (borde visible, fill con gradiente sutil)
- Los hijos se dibujan debajo y la cápsula padre actúa de header

**R-C6.** Cápsula con `state: "collapsed"`:
- Fill sólido
- El título se trunca con ellipsis si no cabe

**R-C7.** Cápsula con `canonical: false` OR `importance < 50`:
- Opacidad 0.65
- Textura de puntos diagonal en el fill para distinguir visualmente

### 3.3 Tipografía por ancho de cápsula

**R-C8.** Texto del título se oculta si el ancho en píxeles es:
- `< 24 px` → solo un indicador de color (sin texto ni icono)
- `< 80 px` → inicial + … (ej. "C…")
- `80–200 px` → primera palabra + …
- `≥ 200 px` → título completo (truncado con ellipsis si no cabe)

Esto evita que el texto se apile y lagee el canvas cuando hay muchos eventos.

### 3.4 Eje de referencia

**R-C9.** Debajo de los carriles, un eje horizontal muestra:
- En nivel 0: nombre de los libros
- En nivel 1-2: libro + capítulo
- En nivel 3-4: capítulo + versículo

Etiquetas pegadas al borde izquierdo del viewport (sticky) hasta que el siguiente libro/capítulo entra en pantalla.

## 4. Reglas de transición entre niveles

**R-T1.** Al cruzar un umbral (ej. 0.28 → 0.27 bajando, o 0.11 → 0.13 subiendo), el cliente:
1. Emite inmediatamente la nueva request con el `zoomFactor` destino.
2. Mientras llega la respuesta, sigue renderizando los eventos del nivel anterior con `zoomFactor` interpolado hasta `minZoomFactor` del nuevo nivel − 0.01 (evita "saltos" visuales).
3. Al recibir la respuesta, hace **cross-fade** (300 ms) entre el conjunto viejo y el nuevo. Los eventos que aparecen en ambos sets no se re-crean (animación continua de posición).

**R-T2.** La transición nunca pierde el foco. El evento focused del nivel anterior se mapea a su descendiente apropiado (si se hizo zoom-in) o a su ancestro (si zoom-out). El cliente usa `focusPath` para elegir.

## 5. Pseudocódigo del mapeo visible → canvas

```
for event in response.visibleEvents:
    x       = (event.startSequence - viewport.firstSequence) * pxPerVerse
    width   = (event.endSequence - event.startSequence + 1) * pxPerVerse
    y       = laneY[event.zoomLevel]
    height  = laneHeight
    fill    = computeFill(event, palette)
    border  = computeBorder(event, palette, acentoSiFocus)
    label   = computeLabel(event.title, width)
    drawCapsule(x, y, width, height, fill, border, label)
```

`pxPerVerse` depende del `zoomFactor`:
- Nivel 0: 0.02 px/verso (toda la Biblia cabe en ~600 px)
- Nivel 1: 0.05
- Nivel 2: 0.15
- Nivel 3: 0.4
- Nivel 4: 1.2 (un verso ocupa ≥1 px)

Estos valores son sugeridos; el canvas los recalcula suavemente en las transiciones.

## 6. Casos borde

- **Evento con startSequence == endSequence** (un solo versículo): ancho mínimo 4 px en L4, 2 px en niveles inferiores. Tooltip siempre disponible.
- **Evento que abarca todo un libro grande** (ej. Salmos 1-150): su ancho domina el viewport; el cliente acorta visualmente el texto pero conserva el rango real para el hit-test.
- **Sin focus resuelto**: si el servidor devuelve sin `resolvedFocusRef`, el cliente centra en `resolvedFocusSequence` usando el índice `sequence → ref` de la versión base (se obtiene de `/api/bible/verses/resolve-sequence`).
- **Viewport más ancho que todo el timeline** (desktop ultra-wide en nivel 0): se deja padding proporcional; el timeline no se estira para llenar.

## 7. Validación

Ningún cambio a estas reglas se acepta sin:
1. Actualizar el JSON golden de `resources/cronologia/timeline_viewport.creation.level2.response.json` (si aplica al servidor).
2. Volver a correr `python3 scripts/validate_timeline_viewport_response.py` sobre el golden.
3. Regenerar screenshots de referencia del cliente (ver `docs/workflows/`).
