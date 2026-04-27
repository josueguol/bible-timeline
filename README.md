# Bible Timeline

Timeline horizontal interactivo de la Biblia. Backend .NET 9 Minimal API + PostgreSQL. Frontend TypeScript vanilla + Canvas 2D.

---

## Requisitos previos

| Herramienta | Versión mínima | Propósito |
|---|---|---|
| .NET SDK | 9.0 | API |
| Node.js | 20 LTS | Frontend |
| PostgreSQL | 15+ | Base de datos |
| Python | 3.10+ | Pipeline de datos (solo si regeneras el bundle) |

---

## 1. Base de datos

### 1.1 Crear la base de datos

```bash
psql -U postgres -c "CREATE DATABASE bible_timeline;"
```

### 1.2 Aplicar esquema y seed manualmente (opcional)

El API aplica esquema + seed automáticamente al arrancar si `AutoApplySeedIfMissing: true` (valor por defecto). Si prefieres aplicarlos a mano:

```bash
psql -U postgres -d bible_timeline -f resources/sql/bible_timeline_schema.sql
psql -U postgres -d bible_timeline -f resources/sql/bible_timeline_bundle.rv60.seed.sql
```

### 1.3 Restaurar desde cero (borrar y recrear)

```bash
psql -U postgres -c "DROP DATABASE IF EXISTS bible_timeline;"
psql -U postgres -c "CREATE DATABASE bible_timeline;"
psql -U postgres -d bible_timeline -f resources/sql/bible_timeline_schema.sql
psql -U postgres -d bible_timeline -f resources/sql/bible_timeline_bundle.rv60.seed.sql
```

### Cadena de conexión por defecto

```
Host=localhost;Port=5432;Username=postgres;Password=postgres;Database=bible_timeline
```

Para cambiarla sin tocar `appsettings.json`, edita `api/appsettings.Development.json`:

```json
{
  "BibleTimeline": {
    "ConnectionString": "Host=localhost;Port=5432;Username=TU_USUARIO;Password=TU_PASSWORD;Database=bible_timeline"
  }
}
```

---

## 2. API (backend)

```bash
cd api
dotnet run
```

| URL | Descripción |
|---|---|
| `http://localhost:5080` | API base |
| `http://localhost:5080/swagger` | Swagger UI |
| `http://localhost:5080/health` | Healthcheck (`{"status":"ok"}`) |

### Endpoints disponibles

| Método | Ruta |
|---|---|
| GET | `/health` |
| GET | `/api/timelines/{timelineId}/viewport` |
| GET | `/api/timelines/{timelineId}/events/{eventId}` |
| GET | `/api/bible/versions` |
| GET | `/api/bible/verses` |
| GET | `/api/search?q=…` |

Ejemplo rápido:

```bash
curl "http://localhost:5080/api/timelines/bible-history-hierarchy-seed/viewport?zoomFactor=0.35&focusRef=G%C3%A9nesis%201:26"
```

---

## 3. Frontend

```bash
cd web
npm install
npm run dev
```

Corre en `http://localhost:5173`. Vite proxea `/api` y `/health` hacia `http://localhost:5080`, por lo que el API debe estar corriendo primero.

### Otros comandos

```bash
npm run build      # build de producción (tsc + vite build)
npm run typecheck  # solo verificación de tipos
npm run preview    # preview del build de producción
```

---

## 4. Tests

Los tests de integración requieren PostgreSQL corriendo.

```bash
dotnet test
```

Los golden tests (`api.tests/TimelineViewportServiceGoldenTests.cs`) levantan un esquema PostgreSQL aislado, aplican el seed real y comparan contra `resources/cronologia/timeline_viewport.creation.level2.response.json`.

---

## 5. Pipeline de datos (regenerar bundle SQL)

Solo necesario si modificas el seed o los manifiestos.

### 5.1 Generar bundle SQL

```bash
python3 scripts/generate_sql_timeline_bundle.py \
  resources/cronologia/lectura_expandida.rv60.manifest.json \
  resources/cronologia/lectura_expandida.rv60.verse_order.json \
  resources/cronologia/bible_timeline_hierarchy.seed.json \
  --output resources/sql/bible_timeline_bundle.rv60.seed.sql
```

### 5.2 Validar el bundle generado

```bash
python3 scripts/validate_sql_timeline_bundle.py \
  resources/sql/bible_timeline_bundle.rv60.seed.sql
```

### 5.3 Regenerar golden de tests

Si cambias el seed, actualiza el golden antes de correr `dotnet test`:

```bash
python3 scripts/resolve_timeline_viewport.py \
  resources/cronologia/bible_timeline_hierarchy.seed.json \
  resources/cronologia/timeline_viewport.creation.level2.request.json \
  --verse-order resources/cronologia/lectura_expandida.rv60.verse_order.json \
  --output resources/cronologia/timeline_viewport.creation.level2.response.json

python3 scripts/validate_timeline_viewport_response.py \
  resources/cronologia/timeline_viewport.creation.level2.response.json
```

---

## 6. Estructura del proyecto

```
bible-timeline/
├── api/                        # .NET 9 Minimal API
│   ├── Program.cs
│   ├── appsettings.json        # config base (DB, paths, defaults)
│   ├── appsettings.Development.json
│   ├── Endpoints/              # TimelineEndpoints, BibleEndpoints, SearchEndpoints
│   ├── Services/               # lógica de negocio (viewport, biblia, búsqueda)
│   ├── Infrastructure/         # NpgsqlConnectionFactory
│   ├── Models/                 # DTOs
│   └── Options/                # BibleTimelineOptions
├── api.tests/                  # xunit + WebApplicationFactory
├── web/                        # TypeScript 5 + Canvas 2D + Vite
│   ├── src/
│   │   ├── api/                # clientes HTTP tipados
│   │   ├── canvas/             # TimelineCanvas, GestureHandler, InertiaEngine
│   │   ├── store/              # AppStore (EventTarget, sin framework)
│   │   └── ui/                 # componentes DOM vanilla
│   └── vite.config.ts
├── resources/
│   ├── sql/
│   │   ├── bible_timeline_schema.sql
│   │   └── bible_timeline_bundle.rv60.seed.sql
│   └── cronologia/             # JSONs de jerarquía, manifiestos, orden de versos
├── docs/
│   ├── contracts/              # JSON Schema (fuente de verdad de contratos API)
│   └── ...
├── scripts/                    # pipeline Python (validación, generación SQL)
└── architecture.md             # decisiones de arquitectura detalladas
```

---

## 7. Flujo de arranque completo (orden)

```bash
# 1. Base de datos
psql -U postgres -c "CREATE DATABASE bible_timeline;"

# 2. API (aplica schema+seed automáticamente si la DB está vacía)
cd api && dotnet run

# 3. Frontend (en otra terminal)
cd web && npm install && npm run dev
```

Abre `http://localhost:5173`.
