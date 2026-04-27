# Project Agents Definition

## Objective
Orquestar la generación de datos históricos estructurados y su transformación a SQL.

## Global Rules
- Ningún agente inventa datos.
- Todo output debe cumplir su contrato en /docs/contracts.
- Cada agente tiene una única responsabilidad.
- Si el input no cumple contrato → se rechaza.
- Siempre validar antes de pasar al siguiente paso.

## Workflow
1. Detectar si la tarea requiere investigación histórica
   → usar skill: historian-research

2. Validar salida contra:
   /docs/contracts/timeline.schema.json

3. Transformar a SQL
   → usar skill: backend-sql

4. Validar salida contra:
   /docs/contracts/insert-events.schema.json

5. Si hay UI requerida:
   → ux-ui → frontend-ui

## Hierarchical Timeline Workflow
1. Detectar si la tarea requiere navegación por zoom o expansión padre-hijo
   → usar skill: orchestrator

2. Investigar y curar eventos jerárquicos
   → usar skill: historian-research

3. Validar salida contra:
   /docs/contracts/timeline-hierarchy.schema.json

4. Transformar a SQL relacional
   → usar skill: backend-sql

5. Validar salida contra:
   /docs/contracts/insert-hierarchical-events.schema.json

6. Si hay UI requerida:
   → ux-ui → frontend-ui

## Verse Timeline Workflow
1. Tomar `resources/cronologia/Lectura.md` como plan curado fuente
2. Expandir a capítulos individuales
   → generar `resources/cronologia/Lectura_Expandida.md`
3. Tratar `Lectura_Expandida.md` como preorden editable, no como verdad definitiva
4. Normalizar nombres de libros y validar contra la versión base
   → usar `resources/biblias/RV60.xml`
5. Validar manifiesto por capítulo contra:
   /docs/contracts/chapter-order-manifest.schema.json
6. Expandir a versículos
7. Validar orden por versículo contra:
   /docs/contracts/verse-order.schema.json
8. Curar eventos jerárquicos sobre rangos de versículos
   → usar skill: historian-research
9. Validar jerarquía contra:
   /docs/contracts/timeline-hierarchy.schema.json

## Local Skills Convention
- Los skills locales viven en `/.agents/skills/<skill-name>/SKILL.md`
- El nombre de la carpeta es el identificador canónico del skill
- `AGENTS.md` define cuándo invocarlos y en qué orden
- Los contratos se validan con scripts del repo antes de delegar al siguiente paso

## Validation Commands
- Timeline JSON → `python3 scripts/validate_timeline.py <archivo.json>`
- SQL INSERT → `python3 scripts/validate_sql.py <archivo.sql>`
- Hierarchical timeline JSON → `python3 scripts/validate_timeline_hierarchy.py <archivo.json>`
- Hierarchical SQL → `python3 scripts/validate_sql_hierarchy.py <archivo.sql>`
- Chapter-order manifest → `python3 scripts/validate_chapter_order_manifest.py <archivo.json>`
- Verse-order timeline → `python3 scripts/validate_verse_order.py <archivo.json>`
- Timeline viewport request → `python3 scripts/validate_timeline_viewport_request.py <archivo.json>`
- Timeline viewport response → `python3 scripts/validate_timeline_viewport_response.py <archivo.json>`
- Verse timeline bundle SQL → `python3 scripts/generate_sql_timeline_bundle.py <manifest.json> <verse-order.json> <hierarchy.json> --output <archivo.sql>`
- Verse timeline SQL bundle → `python3 scripts/validate_sql_timeline_bundle.py <archivo.sql>`
- Versions list response → `python3 scripts/validate_versions_list_response.py <archivo.json>`
- Verses range request → `python3 scripts/validate_verses_range_request.py <archivo.json>`
- Verses range response → `python3 scripts/validate_verses_range_response.py <archivo.json>`
- Search request → `python3 scripts/validate_search_request.py <archivo.json>`
- Search response → `python3 scripts/validate_search_response.py <archivo.json>`
- Event detail response → `python3 scripts/validate_event_detail_response.py <archivo.json>`
- No se permite continuar el flujo si cualquiera de las validaciones falla

## Delegation Rules
- Historia → historian-research
- Orquestación del flujo → orchestrator
- Transformación de datos → backend-sql
- Experiencia visual → ux-ui
- Implementación UI → frontend-ui

## Critical Constraints
- No mezclar responsabilidades
- No transformar sin validar
- No generar SQL sin estructura previa válida
- En timelines con zoom, los eventos raíz y sus hijos deben modelarse en una sola jerarquía canónica
- `Lectura_Expandida.md` es un preorden curado y editable; siempre puede ser reordenado si se detectan ajustes cronológicos
