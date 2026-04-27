# Workflow: Save Historical Timeline

## Steps

1. User Request
   "Guardar eventos históricos de X"

2. Orchestrator
   Detecta necesidad de investigación

3. Historian Research
   Genera timeline estructurado

4. Validation
   `python3 scripts/validate_timeline.py timeline.json`

5. Backend SQL
   Genera inserts SQL

6. Validation
   `python3 scripts/validate_sql.py events.sql`

7. Execution
   Guardar en base de datos

## Notes
- Si falla validación → detener flujo
- No continuar con datos inválidos
- Los skills locales se resuelven desde `/.agents/skills/<skill-name>/SKILL.md`

## Hierarchical Variant
1. User Request
   "Guardar timeline bíblico con zoom multinivel"

2. Orchestrator
   Decide la vista raíz y los niveles de expansión

3. Historian Research
   Genera una jerarquía canónica de eventos

4. Validation
   `python3 scripts/validate_timeline_hierarchy.py timeline-hierarchy.json`

5. Backend SQL
   Genera inserts para `timelines`, `timeline_events` y `timeline_event_sources`

6. Validation
   `python3 scripts/validate_sql_hierarchy.py timeline-hierarchy.sql`

## Verse Chronology Variant
1. Input
   `resources/cronologia/Lectura.md`

2. Expand
   `python3 expand_reading.py`

3. Build Manifest
   `python3 scripts/build_chapter_order_manifest.py resources/cronologia/Lectura_Expandida.md resources/biblias/RV60.xml --output resources/cronologia/lectura_expandida.rv60.manifest.json`

4. Validation
   `python3 scripts/validate_chapter_order_manifest.py resources/cronologia/lectura_expandida.rv60.manifest.json`

5. Expand To Verses
   `python3 scripts/build_verse_order.py resources/cronologia/lectura_expandida.rv60.manifest.json --output resources/cronologia/lectura_expandida.rv60.verse_order.json`

6. Validation
   `python3 scripts/validate_verse_order.py resources/cronologia/lectura_expandida.rv60.verse_order.json`

7. Event Curation
   Crear jerarquía de eventos sobre rangos o secuencias de versículos antes de generar UI o SQL final

## Viewport Resolution Variant
1. Input
   `timeline-hierarchy.json` + request de viewport

2. Validation
   `python3 scripts/validate_timeline_viewport_request.py viewport-request.json`

3. Resolve
   `python3 scripts/resolve_timeline_viewport.py resources/cronologia/bible_timeline_hierarchy.seed.json viewport-request.json --verse-order resources/cronologia/lectura_expandida.rv60.verse_order.json --output viewport-response.json`

4. Validation
   `python3 scripts/validate_timeline_viewport_response.py viewport-response.json`

## Persistable SQL Bundle
Cuando el objetivo sea importar de una vez la versión base, el manifiesto editable, el orden por versículo y la jerarquía con zoom:

1. Generar SQL para:
   - `bible_versions`
   - `bible_verses`
   - `timeline_manifests`
   - `timeline_chapter_entries`
   - `timeline_verse_order`
   - `timelines`
   - `timeline_zoom_levels`
   - `timeline_events`
   - `timeline_event_sources`
   - comando:
     `python3 scripts/generate_sql_timeline_bundle.py resources/cronologia/lectura_expandida.rv60.manifest.json resources/cronologia/lectura_expandida.rv60.verse_order.json resources/cronologia/bible_timeline_hierarchy.seed.json --output resources/sql/bible_timeline_bundle.rv60.seed.sql`

2. Validar:
   `python3 scripts/validate_sql_timeline_bundle.py bundle.sql`

3. Importar a la base de datos

Referencia de diseño:
`docs/database/verse-timeline-persistence.md`

Smoke test local:
`sqlite3 /tmp/bible_timeline_smoke.db < resources/sql/bible_timeline_schema.sql`
`sqlite3 /tmp/bible_timeline_smoke.db < resources/sql/bible_timeline_bundle.rv60.seed.sql`
