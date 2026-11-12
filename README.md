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

## Inicio rápido

```bash
./start.sh
```

El script prepara PostgreSQL, aplica schemas/seeds faltantes, compila .NET + frontends y levanta API, servicios auxiliares, web y admin. Usa `./start.sh --help` para ver opciones como `--no-strong`, `--build-only` o `--postgres-docker`.

Si no tienes `psql` instalado localmente, el script usa automáticamente `psql` dentro del contenedor PostgreSQL detectado, por defecto `local-dev-postgres`.

### Entornos Docker en Windows

Los scripts PowerShell levantan un stack completo y aislado: PostgreSQL, API principal,
servicios de contenido/notas, web, admin y un gateway Caddy. PostgreSQL y las APIs no
publican puertos al host; solo se expone el gateway en `127.0.0.1`.

```powershell
# Desarrollo/integración: crea .env.dev desde la plantilla en el primer arranque.
.\start-dev.ps1
# Web: http://localhost:7410
# Admin: http://localhost:7411

# Detener desarrollo y preservar los datos PostgreSQL.
.\stop-dev.ps1

# Producción: copiar la plantilla, reemplazar todos los secretos y revisar los dominios.
Copy-Item .env.production.example .env.prod
notepad .env.prod
.\start-prod.ps1

# Detener producción y preservar los datos PostgreSQL.
.\stop-prod.ps1
```

`-RemoveData` es deliberadamente opcional y borra únicamente el volumen PostgreSQL del
entorno indicado:

```powershell
.\stop-dev.ps1 -RemoveData
```

Los proyectos Compose se llaman `bible-timeline-dev` y `bible-timeline-prod`, por lo que
detener uno no afecta IODA, Firecrawl ni el otro entorno. Sus únicos puertos de host son
`127.0.0.1:7410` y `127.0.0.1:7411` (dev), y `127.0.0.1:7310` (prod); el script comprueba
que los puertos estén disponibles antes de crear el stack.

Producción no toma los puertos 80/443. El túnel Cloudflare compartido `ioda-admin` termina TLS
en Cloudflare y debe enviar cada hostname al gateway local `http://localhost:7310`, preservando
la cabecera `Host`:

```yaml
- hostname: chrono.llamado.de
  service: http://localhost:7310
- hostname: chrono-api.pixcan.com
  service: http://localhost:7310
- hostname: chrono-notes-api.pixcan.com
  service: http://localhost:7310
- hostname: chrono-content-api.pixcan.com
  service: http://localhost:7310
- hostname: chrono-admin.pixcan.com
  service: http://localhost:7310
- hostname: chrono-admin-api.pixcan.com
  service: http://localhost:7310
```

Estas reglas pertenecen al `ingress` de `C:\\Users\\Looper\\.cloudflared\\config.yml` y se
deben colocar antes de la regla final `http_status:404`. Cada hostname requiere además un CNAME
proxied al UUID del túnel (`b7c4fbb1-7fd8-4291-a02a-ff1807de1a29.cfargotunnel.com`) creado en
una zona activa de la **misma cuenta Cloudflare** que posee `ioda-admin`. Un CNAME equivalente
en un proveedor DNS externo no puede enrutar tráfico hacia este túnel. En planes Free/Pro, esto
requiere que Cloudflare sea el DNS autoritativo: se cambian los nameservers en el registrador,
pero no hace falta transferir el registro del dominio. Cloudflare gestiona los certificados
Universal SSL (la primera emisión puede tardar unos minutos); `start-prod.ps1` y `stop-prod.ps1`
no arrancan, paran ni reinician el túnel compartido de IODA. Los nombres se pueden cambiar en
`.env.prod` sin editar Compose, pero requieren sus correspondientes rutas DNS e `ingress`.

El entorno de producción no crea el usuario admin de desarrollo. Para provisionar el primer
administrador, activa temporalmente `ADMIN_SETUP_ENABLED=true`, define un
`ADMIN_SETUP_TOKEN` aleatorio en `.env.prod`, reinicia `start-prod.ps1` y llama una vez:

```powershell
Invoke-RestMethod -Method Post https://chrono-admin-api.pixcan.com/auth/setup `
  -Headers @{ "X-Setup-Token" = "<ADMIN_SETUP_TOKEN>" } `
  -ContentType "application/json" `
  -Body '{"email":"admin@example.com","password":"una-contraseña-de-12-o-más-caracteres"}'
```

Después vuelve a poner `ADMIN_SETUP_ENABLED=false` y ejecuta `start-prod.ps1` otra vez.

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

Para habilitar Strong word-level en hebreo/griego, genera y aplica el seed adicional:

```bash
OPENAI_MODEL=<modelo> OPENAI_API_KEY=<clave> \
  python3 scripts/translate_strongs_es.py
python3 scripts/generate_strongs_seed.py --output resources/sql/bible_strongs.seed.sql
psql -U postgres -d bible_timeline -f resources/sql/bible_strongs.seed.sql
```

`translate_strongs_es.py` genera `resources/diccionarios/strongs.es.jsonl` en lotes y puede reanudarse. Si el archivo no existe, el seed Strong conserva el inglés original y la API marca `definitionLanguage: "en"`.

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
| GET | `/api/bible/verses?versions=HEB_OSHB&fromRef=Génesis%201:1&toRef=Génesis%201:1&includeStrong=true` |
| GET | `/api/strongs/{strongNumber}` |
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

### 5.3 Generar seed Strong

```bash
python3 scripts/generate_strongs_seed.py \
  --output resources/sql/bible_strongs.seed.sql
```

El seed Strong inserta `HEB_OSHB`, `GRC_TR`, diccionarios Strong y segmentos por palabra. Los diccionarios vienen de `openscriptures/strongs`; los segmentos salen de `resources/biblias/HEB_OSHB.xml` y `resources/biblias/GRC_TR.xml`.

Para generar traducciones españolas revisables del diccionario completo (~14,200
entradas, ~1-3 h). Recomendado: piloto de 50 primero para validar calidad, luego
la corrida completa — el script reanuda donde quedó (`strongs.es.jsonl` es el
checkpoint), así que re-ejecutarlo continúa, no repite:

```bash
# 0) Sanity sin API key (no llama a OpenAI):
python3 scripts/translate_strongs_es.py --dry-run --limit 5

# 1) Piloto: 50 entradas — revisar el español en strongs.es.jsonl antes de seguir.
OPENAI_MODEL=<modelo> OPENAI_API_KEY=<clave> \
  python3 scripts/translate_strongs_es.py --limit 50

# 2) Corrida completa (reanudable):
OPENAI_MODEL=<modelo> OPENAI_API_KEY=<clave> \
  python3 scripts/translate_strongs_es.py

# Alternativa con OpenRouter (o cualquier API compatible-OpenAI):
# los ids de modelo llevan prefijo de vendor (openai/..., google/..., anthropic/...)
# y el modelo debe soportar structured outputs.
OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
OPENAI_API_KEY=<openrouter-key> \
OPENAI_MODEL=openai/gpt-4o-mini \
  python3 scripts/translate_strongs_es.py --limit 50

# 3) Seed con traducciones (falla si falta alguna) y aplicar (upsert idempotente):
python3 scripts/generate_strongs_seed.py \
  --output resources/sql/bible_strongs.seed.sql \
  --require-spanish-translations
psql -U postgres -d bible_timeline -f resources/sql/bible_strongs.seed.sql

# 4) Validar contrato de la API:
python3 scripts/validate_strong_entry_response.py
```

### 5.4 Regenerar golden de tests

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

## 7. Servicios de contenido (Docker)

Los tres servicios adicionales corren en Docker. El PostgreSQL se gestiona externamente.

### 7.1 Configuración del entorno

```bash
cp .env.example .env
```

Edita `.env` y llena los valores obligatorios:

| Variable | Descripción | Requerido |
|---|---|---|
| `CONTENT_API_DB` | Connection string para content-api | Sí |
| `CONTENT_ADMIN_DB` | Connection string para content-admin-api | Sí |
| `NOTES_API_DB` | Connection string para notes-api | Sí |
| `ADMIN_JWT_SECRET` | Secret JWT del admin (≥ 32 chars) | Sí |
| `NOTES_JWT_SECRET` | Secret JWT de notas (≥ 32 chars) | Sí |
| `GOOGLE_CLIENT_ID` | OAuth Google (notas) | No |
| `TWITTER_CLIENT_ID` | OAuth Twitter (notas) | No |
| `TWITTER_CLIENT_SECRET` | OAuth Twitter (notas) | No |
| `FACEBOOK_APP_ID` | OAuth Facebook (notas) | No |
| `FACEBOOK_APP_SECRET` | OAuth Facebook (notas) | No |
| `FRONTEND_BASE_URL` | URL del frontend (redirect OAuth) | No |

Generar secrets seguros:

```bash
echo "ADMIN_JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "NOTES_JWT_SECRET=$(openssl rand -base64 32)" >> .env
```

### 7.2 Aplicar schemas de contenido y notas (una sola vez)

```bash
psql -U postgres -d bible_timeline -f resources/sql/content_schema.sql
psql -U postgres -d bible_timeline -f resources/sql/notes_schema.sql
```

### 7.3 Arrancar los servicios

```bash
docker compose up -d --build
```

| Servicio | Puerto | Descripción |
|---|---|---|
| `content-api` | 5082 | API pública (float cards, solo publicadas) |
| `content-admin-api` | 5083 | API privada (CRUD + auth de admin) |
| `notes-api` | 5081 | API de notas de usuario |

Verificar que están corriendo:

```bash
curl http://localhost:5082/health
curl http://localhost:5083/health
curl http://localhost:5081/health
```

### 7.4 Crear el primer usuario admin

Solo funciona cuando la tabla `content.admin_users` está vacía.

```bash
curl -X POST http://localhost:5083/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@email.com","password":"tuPasswordSeguro"}'
```

Respuesta esperada: `{"message":"Admin user created."}`

Después de crear el usuario, el endpoint devuelve 409 y ya no funciona.

### 7.5 Acceder al admin

```bash
cd admin && npm install && npm run dev
```

Corre en `http://localhost:5174`. Inicia sesión con el usuario creado en el paso anterior.

Para cambiar la contraseña: botón 🔑 en la esquina superior derecha del admin.

---

## 8. Flujo de arranque completo (orden)

```bash
# 1. Base de datos (externa — asegúrate de que bible_timeline existe)
psql -U postgres -c "CREATE DATABASE bible_timeline;"
psql -U postgres -d bible_timeline -f resources/sql/bible_timeline_schema.sql
psql -U postgres -d bible_timeline -f resources/sql/content_schema.sql
psql -U postgres -d bible_timeline -f resources/sql/notes_schema.sql

# 2. API principal (viewport, biblia, búsqueda)
cd api && dotnet run              # puerto 5080

# 3. Servicios de contenido y notas (Docker)
cp .env.example .env              # llenar ADMIN_JWT_SECRET y NOTES_JWT_SECRET
docker compose up -d --build      # puertos 5081, 5082, 5083

# 4. Primer usuario admin (solo la primera vez)
curl -X POST http://localhost:5083/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@email.com","password":"tuPassword"}'

# 5. Frontend timeline
cd web && npm install && npm run dev    # puerto 5173

# 6. Frontend admin (en otra terminal)
cd admin && npm install && npm run dev  # puerto 5174
```

| URL | Descripción |
|---|---|
| `http://localhost:5173` | Timeline público |
| `http://localhost:5174` | Admin de contenido |
| `http://localhost:5080/swagger` | API principal Swagger |
