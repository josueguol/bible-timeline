# Import Bundle Smoke Test

## Goal
Verificar que el esquema SQL y el bundle generado pueden cargarse juntos en una base SQLite limpia.

## Commands

```bash
rm -f /tmp/bible_timeline_smoke.db
sqlite3 /tmp/bible_timeline_smoke.db < resources/sql/bible_timeline_schema.sql
sqlite3 /tmp/bible_timeline_smoke.db < resources/sql/bible_timeline_bundle.rv60.seed.sql
sqlite3 /tmp/bible_timeline_smoke.db "SELECT COUNT(*) AS versions FROM bible_versions;"
sqlite3 /tmp/bible_timeline_smoke.db "SELECT COUNT(*) AS verses FROM bible_verses;"
sqlite3 /tmp/bible_timeline_smoke.db "SELECT COUNT(*) AS events FROM timeline_events;"
sqlite3 /tmp/bible_timeline_smoke.db "SELECT COUNT(*) AS sources FROM timeline_event_sources;"
```

## Expected
- `bible_versions` debe devolver `1`
- `bible_verses` debe devolver `31102`
- `timeline_events` debe devolver más de `14`
- `timeline_event_sources` debe devolver al menos una fuente por evento

## Notes
- Esta prueba no reemplaza la validación de contratos.
- Su objetivo es detectar incompatibilidades reales entre el DDL y el SQL generado.
