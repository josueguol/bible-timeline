# Verse Timeline Persistence

## Goal
Persistir cuatro capas relacionadas sin acoplarlas:

1. versión bíblica importada,
2. preorden editable por capítulo,
3. orden cronológico por versículo,
4. jerarquía de eventos con niveles de zoom.

Esto permite:
- cambiar o corregir el orden cronológico sin reimportar todas las versiones,
- comparar varias traducciones sobre la misma secuencia cronológica,
- recalcular rangos `startSequence` y `endSequence` sin rehacer la curaduría conceptual,
- renderizar el timeline por zoom usando una sola jerarquía canónica.

## Persistence Model

### `bible_versions`
Define cada traducción disponible.

Suggested columns:
- `version_id`
- `code`
- `title`
- `language`
- `source_path`

### `bible_verses`
Guarda el texto de cada versículo por versión.

Suggested columns:
- `version_id`
- `ref`
- `book`
- `chapter`
- `verse`
- `text`

Rule:
- el texto del versículo vive aquí, no en la cronología.

### `timeline_manifests`
Representa un preorden curado por capítulo que sigue siendo editable.

Suggested columns:
- `manifest_id`
- `source_version_id`
- `title`
- `source_path`
- `is_editable`

Rule:
- cambiar el orden del timeline empieza aquí, no en `timeline_events`.

### `timeline_chapter_entries`
Expande el manifiesto a capítulos individuales y preserva su secuencia editorial.

Suggested columns:
- `manifest_id`
- `entry_id`
- `sequence`
- `book`
- `chapter`
- `source_line`
- `status`

Rule:
- esta tabla es la capa más barata de reordenar manualmente.

### `timeline_verse_order`
Materializa el orden cronológico por versículo.

Suggested columns:
- `manifest_id`
- `sequence`
- `ref`
- `book`
- `chapter`
- `verse`
- `entry_id`
- `status`

Rule:
- esta secuencia es el ancla compartida para todas las versiones y para la jerarquía de eventos.

### `timelines`
Metadatos del timeline navegable.

Suggested columns:
- `timeline_id`
- `manifest_id`
- `title`
- `root_event_count`
- `expansion_mode`

### `timeline_zoom_levels`
Define bandas de zoom y expectativa de densidad visual.

Suggested columns:
- `timeline_id`
- `level`
- `label`
- `min_zoom_factor`
- `max_zoom_factor`
- `target_visible_events`
- `description`

Rule:
- el comportamiento escalonado del viewport debe salir de esta tabla, no de lógica implícita en UI.

### `timeline_events`
Guarda la jerarquía canónica de eventos.

Suggested columns:
- `id`
- `timeline_id`
- `parent_id`
- `zoom_level`
- `sequence`
- `title`
- `start_label`
- `end_label`
- `start_ref`
- `end_ref`
- `start_sequence`
- `end_sequence`
- `summary`
- `importance`
- `canonical`

Rules:
- `parent_id` forma el árbol padre-hijo,
- `zoom_level` controla aparición por nivel,
- `sequence` ordena hermanos,
- `start_sequence` y `end_sequence` anclan el evento al timeline por versículo.

### `timeline_event_sources`
Asocia cada evento con sus fuentes.

Suggested columns:
- `event_id`
- `source_ref`
- `source_type`

Rule:
- al menos una fuente por evento.

## Insert Order
Cuando `backend-sql` genere un bundle SQL, el orden recomendado es:

1. `bible_versions`
2. `bible_verses`
3. `timeline_manifests`
4. `timeline_chapter_entries`
5. `timeline_verse_order`
6. `timelines`
7. `timeline_zoom_levels`
8. `timeline_events`
9. `timeline_event_sources`

## Reordering Strategy
Si se detecta un ajuste cronológico:

1. editar `Lectura.md` o el manifiesto expandido,
2. regenerar `timeline_chapter_entries`,
3. regenerar `timeline_verse_order`,
4. recalcular `startSequence` y `endSequence` de la jerarquía,
5. volver a emitir el bundle SQL.

La curaduría histórica no debe editar directamente el texto de los versículos ni la estructura de versiones.

## Repo Artifacts
- DDL base: `resources/sql/bible_timeline_schema.sql`
- Bundle SQL generado: `resources/sql/bible_timeline_bundle.rv60.seed.sql`
- Smoke test de importación: `docs/database/import-bundle-smoke-test.md`
