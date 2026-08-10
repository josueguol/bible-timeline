#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${ROOT_DIR}/logs/start"

DB_NAME="${DB_NAME:-bible_timeline}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-local-dev-postgres}"
PSQL_DRIVER="${PSQL_DRIVER:-auto}"

RUN_DB=1
RUN_STRONG="${RUN_STRONG:-1}"
REQUIRE_STRONG="${REQUIRE_STRONG:-0}"
RUN_NOTES=1
RUN_CONTENT=1
RUN_ADMIN=1
RUN_WEB=1
INSTALL_DEPS=1
BUILD_ONLY=0
USE_DOCKER_POSTGRES="${USE_DOCKER_POSTGRES:-auto}"
START_MODE="${START_MODE:-auto}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-bible-timeline}"

PIDS=()
NAMES=()
COMPOSE_SERVICES=()
COMPOSE_DISABLED_SERVICES=()

usage() {
  cat <<'EOF'
Uso:
  ./start.sh [opciones]

Opciones:
  --build-only          Solo instala deps/compila; no levanta servicios.
  --no-db              No prepara PostgreSQL ni aplica schemas/seeds.
  --no-strong          No genera/aplica seed Strong.
  --require-strong     Falla si no se puede generar/aplicar Strong.
  --no-notes           No levanta notes-api.
  --no-content         No levanta content-api.
  --no-admin           No levanta content-admin-api ni admin UI.
  --no-web             No levanta web UI.
  --no-install         No ejecuta npm install.
  --docker             Reconstruye/recrea servicios con docker compose.
  --local              Levanta procesos locales con dotnet/npm.
  --postgres-docker    Si PostgreSQL no responde, levanta contenedor Docker.
  --no-postgres-docker No intenta levantar PostgreSQL con Docker.
  -h, --help           Muestra ayuda.

Variables útiles:
  DB_NAME=bible_timeline
  PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres
  POSTGRES_CONTAINER=local-dev-postgres
  PSQL_DRIVER=auto|local|docker
  START_MODE=auto|docker|local
  COMPOSE_PROJECT_NAME=bible-timeline
  RUN_STRONG=0
  DOTNET_ROLL_FORWARD=Major
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only) BUILD_ONLY=1 ;;
    --no-db) RUN_DB=0 ;;
    --no-strong) RUN_STRONG=0 ;;
    --require-strong) REQUIRE_STRONG=1; RUN_STRONG=1 ;;
    --no-notes) RUN_NOTES=0 ;;
    --no-content) RUN_CONTENT=0 ;;
    --no-admin) RUN_ADMIN=0 ;;
    --no-web) RUN_WEB=0 ;;
    --no-install) INSTALL_DEPS=0 ;;
    --docker) START_MODE=docker ;;
    --local) START_MODE=local ;;
    --postgres-docker) USE_DOCKER_POSTGRES=1 ;;
    --no-postgres-docker) USE_DOCKER_POSTGRES=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

log() {
  printf '\033[1;36m[start]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[start]\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31m[start]\033[0m %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

load_env_file() {
  local file="${ROOT_DIR}/.env"
  [[ -f "$file" ]] || return 0
  log "Cargando variables desde .env"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *"="* ]] || continue
    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key=$value"
  done < "$file"
}

require_command() {
  command_exists "$1" || fail "Falta comando requerido: $1"
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" docker compose "$@"
    return
  fi

  if command_exists docker-compose; then
    COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" docker-compose "$@"
    return
  fi

  fail "Falta docker compose. Instala Docker Compose v2 o docker-compose."
}

docker_compose_available() {
  command_exists docker && (docker compose version >/dev/null 2>&1 || command_exists docker-compose)
}

detect_existing_docker_stack() {
  docker_compose_available || return 1

  docker ps -a --format '{{.Names}}' 2>/dev/null \
    | grep -Eq "^${COMPOSE_PROJECT_NAME}-(web|notes-api|content-api|content-admin-api)-[0-9]+$"
}

resolve_start_mode() {
  case "$START_MODE" in
    local|docker)
      return 0
      ;;
    auto)
      if detect_existing_docker_stack; then
        START_MODE=docker
        log "Detecté stack Docker existente (${COMPOSE_PROJECT_NAME}); usaré modo Docker"
      else
        START_MODE=local
        log "No detecté stack Docker existente; usaré modo local"
      fi
      ;;
    *)
      fail "START_MODE inválido: ${START_MODE}. Usa auto, docker o local"
      ;;
  esac
}

select_compose_services() {
  COMPOSE_SERVICES=()
  COMPOSE_DISABLED_SERVICES=()

  if [[ "$RUN_WEB" == "1" ]]; then
    COMPOSE_SERVICES+=("web")
  else
    COMPOSE_DISABLED_SERVICES+=("web")
  fi

  if [[ "$RUN_NOTES" == "1" ]]; then
    COMPOSE_SERVICES+=("notes-api")
  else
    COMPOSE_DISABLED_SERVICES+=("notes-api")
  fi

  if [[ "$RUN_CONTENT" == "1" ]]; then
    COMPOSE_SERVICES+=("content-api")
  else
    COMPOSE_DISABLED_SERVICES+=("content-api")
  fi

  if [[ "$RUN_ADMIN" == "1" ]]; then
    COMPOSE_SERVICES+=("content-admin-api")
  else
    COMPOSE_DISABLED_SERVICES+=("content-admin-api")
  fi
}

sql_literal() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

sql_identifier() {
  local value="$1"
  value="${value//\"/\"\"}"
  printf '"%s"' "$value"
}

detect_postgres_container() {
  command_exists docker || return 1

  if docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
    return 0
  fi

  local detected
  detected="$(
    docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' \
      | awk -v port=":${PGPORT}->5432" '$0 ~ port && $2 ~ /(postgres|pgvector)/ {print $1; exit}'
  )"
  if [[ -n "$detected" ]]; then
    POSTGRES_CONTAINER="$detected"
    return 0
  fi

  return 1
}

select_psql_driver() {
  case "$PSQL_DRIVER" in
    local)
      command_exists psql || fail "PSQL_DRIVER=local pero falta psql local"
      return 0
      ;;
    docker)
      detect_postgres_container || fail "PSQL_DRIVER=docker pero no encontré contenedor PostgreSQL corriendo"
      return 0
      ;;
    auto)
      if command_exists psql; then
        PSQL_DRIVER=local
        return 0
      fi
      if detect_postgres_container; then
        PSQL_DRIVER=docker
        log "Usando psql dentro del contenedor Docker: ${POSTGRES_CONTAINER}"
        return 0
      fi
      if [[ "$USE_DOCKER_POSTGRES" == "1" || "$USE_DOCKER_POSTGRES" == "auto" ]]; then
        start_docker_postgres || fail "No encontré psql local ni pude levantar PostgreSQL con Docker"
        PSQL_DRIVER=docker
        return 0
      fi
      fail "Falta psql local y no encontré contenedor PostgreSQL; define POSTGRES_CONTAINER o usa --postgres-docker"
      ;;
    *)
      fail "PSQL_DRIVER inválido: ${PSQL_DRIVER}. Usa auto, local o docker"
      ;;
  esac
}

psql_postgres() {
  if [[ "$PSQL_DRIVER" == "docker" ]]; then
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$PGUSER" -d postgres "$@"
  else
    PGPASSWORD="$PGPASSWORD" psql \
      -h "$PGHOST" \
      -p "$PGPORT" \
      -U "$PGUSER" \
      -d postgres \
      "$@"
  fi
}

psql_db() {
  if [[ "$PSQL_DRIVER" == "docker" ]]; then
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$PGUSER" -d "$DB_NAME" "$@"
  else
    PGPASSWORD="$PGPASSWORD" psql \
      -h "$PGHOST" \
      -p "$PGPORT" \
      -U "$PGUSER" \
      -d "$DB_NAME" \
      "$@"
  fi
}

postgres_responds() {
  psql_postgres -Atc "SELECT 1;" >/dev/null 2>&1
}

start_docker_postgres() {
  command_exists docker || return 1

  if docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
    log "PostgreSQL Docker ya está corriendo: ${POSTGRES_CONTAINER}"
    return 0
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
    log "Iniciando contenedor PostgreSQL existente: ${POSTGRES_CONTAINER}"
    docker start "$POSTGRES_CONTAINER" >/dev/null
  else
    log "Creando PostgreSQL Docker en localhost:${PGPORT}"
    docker run -d \
      --name "$POSTGRES_CONTAINER" \
      -e POSTGRES_USER="$PGUSER" \
      -e POSTGRES_PASSWORD="$PGPASSWORD" \
      -e POSTGRES_DB="$DB_NAME" \
      -p "${PGPORT}:5432" \
      postgres:16 >/dev/null
  fi

  PSQL_DRIVER=docker

  local retries=60
  while (( retries > 0 )); do
    if postgres_responds; then
      log "PostgreSQL listo"
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done

  return 1
}

ensure_database() {
  select_psql_driver

  if ! postgres_responds; then
    if [[ "$USE_DOCKER_POSTGRES" == "1" || "$USE_DOCKER_POSTGRES" == "auto" ]]; then
      start_docker_postgres || fail "PostgreSQL no responde y no se pudo levantar con Docker"
    else
      fail "PostgreSQL no responde en ${PGHOST}:${PGPORT}"
    fi
  fi

  local exists
  exists="$(psql_postgres -Atc "SELECT 1 FROM pg_database WHERE datname = $(sql_literal "$DB_NAME");" | tr -d '[:space:]')"
  if [[ "$exists" != "1" ]]; then
    log "Creando base de datos ${DB_NAME}"
    psql_postgres -c "CREATE DATABASE $(sql_identifier "$DB_NAME");" >/dev/null
  fi
}

sql_count() {
  psql_db -Atc "$1" | tr -d '[:space:]'
}

apply_sql() {
  local file="$1"
  log "Aplicando ${file}"
  psql_db -v ON_ERROR_STOP=1 < "${ROOT_DIR}/${file}" >/dev/null
}

prepare_database() {
  ensure_database
  apply_sql "resources/sql/bible_timeline_schema.sql"

  local timeline_count
  timeline_count="$(sql_count "SELECT COUNT(*) FROM timeline_manifests WHERE manifest_id = 'lectura-expandida-rv60';")"
  if [[ "$timeline_count" == "0" ]]; then
    apply_sql "resources/sql/bible_timeline_bundle.rv60.seed.sql"
  else
    log "Seed RV60/timeline ya aplicado"
  fi

  apply_sql "resources/sql/content_schema.sql"
  apply_sql "resources/sql/notes_schema.sql"
  apply_sql "resources/sql/seed_admin_user.sql"

  if [[ "$RUN_STRONG" == "1" ]]; then
    prepare_strong_seed || {
      if [[ "$REQUIRE_STRONG" == "1" ]]; then
        fail "No se pudo preparar Strong"
      fi
      warn "Strong no quedó aplicado; continúa sin léxico word-level"
    }
  fi
}

prepare_strong_seed() {
  local strong_count segment_count seed_file
  strong_count="$(sql_count "SELECT COUNT(*) FROM strong_entries;")"
  segment_count="$(sql_count "SELECT COUNT(*) FROM bible_verse_segments WHERE version_id IN ('heb_oshb', 'grc_tr');")"
  if [[ "$strong_count" != "0" && "$segment_count" != "0" ]]; then
    log "Seed Strong ya aplicado"
    return 0
  fi

  require_command python3
  seed_file="${TMPDIR:-/tmp}/bible_strongs.seed.sql"
  log "Generando seed Strong en ${seed_file}"
  python3 "${ROOT_DIR}/scripts/generate_strongs_seed.py" --output "$seed_file"
  log "Aplicando seed Strong"
  psql_db -v ON_ERROR_STOP=1 < "$seed_file" >/dev/null
}

install_node_deps() {
  local dir="$1"
  [[ -f "${ROOT_DIR}/${dir}/package.json" ]] || return 0
  if [[ "$INSTALL_DEPS" == "0" ]]; then
    return 0
  fi
  if [[ -d "${ROOT_DIR}/${dir}/node_modules" ]]; then
    log "Dependencias Node ya instaladas: ${dir}"
    return 0
  fi
  log "Instalando dependencias Node: ${dir}"
  npm --prefix "${ROOT_DIR}/${dir}" install
}

build_all() {
  require_command dotnet
  require_command npm
  export DOTNET_ROLL_FORWARD="${DOTNET_ROLL_FORWARD:-Major}"

  install_node_deps "web"
  [[ "$RUN_ADMIN" == "1" ]] && install_node_deps "admin"

  log "Compilando solución .NET"
  dotnet build "${ROOT_DIR}/bible-timeline.sln" -maxcpucount:1 -nodereuse:false

  if [[ "$RUN_WEB" == "1" ]]; then
    log "Compilando web"
    npm --prefix "${ROOT_DIR}/web" run build
  fi

  if [[ "$RUN_ADMIN" == "1" ]]; then
    log "Compilando admin"
    npm --prefix "${ROOT_DIR}/admin" run build
  fi
}

prepare_docker_env_defaults() {
  local docker_conn="Host=host.docker.internal;Port=${PGPORT};Database=${DB_NAME};Username=${PGUSER};Password=${PGPASSWORD}"
  export CONTENT_API_DB="${CONTENT_API_DB:-$docker_conn}"
  export CONTENT_ADMIN_DB="${CONTENT_ADMIN_DB:-$docker_conn}"
  export NOTES_API_DB="${NOTES_API_DB:-$docker_conn}"
  export ADMIN_JWT_SECRET="${ADMIN_JWT_SECRET:-dev-admin-secret-change-me-32chars-minimum}"
  export NOTES_JWT_SECRET="${NOTES_JWT_SECRET:-dev-notes-secret-change-me-32chars-minimum}"
  export FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-http://localhost:5173}"
}

build_docker_stack() {
  require_command docker
  select_compose_services
  if (( ${#COMPOSE_SERVICES[@]} == 0 )); then
    fail "No hay servicios Docker seleccionados; revisa --no-notes/--no-content/--no-admin"
  fi

  prepare_docker_env_defaults
  log "Construyendo imágenes Docker (${COMPOSE_PROJECT_NAME}): ${COMPOSE_SERVICES[*]}"
  docker_compose build "${COMPOSE_SERVICES[@]}"
}

stop_disabled_docker_services() {
  if (( ${#COMPOSE_DISABLED_SERVICES[@]} == 0 )); then
    return 0
  fi

  log "Deteniendo servicios Docker deshabilitados: ${COMPOSE_DISABLED_SERVICES[*]}"
  docker_compose stop "${COMPOSE_DISABLED_SERVICES[@]}" >/dev/null 2>&1 || true
}

start_docker_stack() {
  require_command docker
  select_compose_services
  if (( ${#COMPOSE_SERVICES[@]} == 0 )); then
    fail "No hay servicios Docker seleccionados; revisa --no-notes/--no-content/--no-admin"
  fi

  prepare_docker_env_defaults

  log "Actualizando contenedores Docker (${COMPOSE_PROJECT_NAME}): ${COMPOSE_SERVICES[*]}"
  docker_compose up -d --build --force-recreate --remove-orphans "${COMPOSE_SERVICES[@]}"
  stop_disabled_docker_services

  [[ "$RUN_WEB" == "1" ]] && wait_for_url "web" "http://localhost:5173"
  [[ "$RUN_NOTES" == "1" ]] && wait_for_url "notes-api" "http://localhost:5081/health"
  [[ "$RUN_CONTENT" == "1" ]] && wait_for_url "content-api" "http://localhost:5082/health"
  [[ "$RUN_ADMIN" == "1" ]] && wait_for_url "content-admin-api" "http://localhost:5083/health"

  printf '\n'
  log "Stack Docker levantado"
  [[ "$RUN_WEB" == "1" ]] && printf '  Web:               http://localhost:5173\n'
  [[ "$RUN_NOTES" == "1" ]] && printf '  Notes API:         http://localhost:5081/health\n'
  [[ "$RUN_CONTENT" == "1" ]] && printf '  Content API:       http://localhost:5082/health\n'
  [[ "$RUN_ADMIN" == "1" ]] && printf '  Content Admin API: http://localhost:5083/health\n'
  printf '  Proyecto Compose:  %s\n\n' "$COMPOSE_PROJECT_NAME"

  docker_compose ps
}

port_is_open() {
  local port="$1"
  if command_exists nc; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    return 1
  fi
}

start_service() {
  local name="$1"
  local port="$2"
  shift 2

  if port_is_open "$port"; then
    warn "${name} parece estar activo en puerto ${port}; no inicio otro proceso"
    return 0
  fi

  log "Levantando ${name} en puerto ${port}"
  mkdir -p "$LOG_DIR"
  (
    cd "$ROOT_DIR"
    "$@"
  ) > "${LOG_DIR}/${name}.log" 2>&1 &

  PIDS+=("$!")
  NAMES+=("$name")
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local retries="${3:-45}"

  command_exists curl || return 0
  while (( retries > 0 )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "${name} listo: ${url}"
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  warn "${name} no respondió todavía: ${url}"
}

cleanup() {
  local count="${#PIDS[@]}"
  if (( count == 0 )); then
    return 0
  fi

  printf '\n'
  log "Deteniendo servicios..."
  local i
  for (( i = count - 1; i >= 0; i-- )); do
    if kill -0 "${PIDS[$i]}" >/dev/null 2>&1; then
      log "Deteniendo ${NAMES[$i]} (${PIDS[$i]})"
      kill "${PIDS[$i]}" >/dev/null 2>&1 || true
    fi
  done
}

start_all() {
  local conn="Host=${PGHOST};Port=${PGPORT};Username=${PGUSER};Password=${PGPASSWORD};Database=${DB_NAME}"
  local admin_secret="${ADMIN_JWT_SECRET:-dev-admin-secret-change-me-32chars-minimum}"
  local notes_secret="${NOTES_JWT_SECRET:-dev-notes-secret-change-me-32chars-minimum}"

  export DOTNET_ROLL_FORWARD="${DOTNET_ROLL_FORWARD:-Major}"

  start_service "api" 5080 env \
    ASPNETCORE_ENVIRONMENT=Development \
    ASPNETCORE_URLS=http://localhost:5080 \
    "BibleTimeline__ConnectionString=${conn}" \
    dotnet run --no-build --project api/Api.csproj

  if [[ "$RUN_NOTES" == "1" ]]; then
    start_service "notes-api" 5081 env \
      ASPNETCORE_ENVIRONMENT=Development \
      ASPNETCORE_URLS=http://localhost:5081 \
      "NotesApi__ConnectionString=${conn}" \
      "NotesApi__JwtSecret=${notes_secret}" \
      "NotesApi__FrontendBaseUrl=${FRONTEND_BASE_URL:-http://localhost:5173}" \
      dotnet run --no-build --project notes-api/NotesApi.csproj
  fi

  if [[ "$RUN_CONTENT" == "1" ]]; then
    start_service "content-api" 5082 env \
      ASPNETCORE_ENVIRONMENT=Development \
      ASPNETCORE_URLS=http://localhost:5082 \
      "ConnectionStrings__Default=${conn}" \
      dotnet run --no-build --project content-api/ContentApi.csproj
  fi

  if [[ "$RUN_ADMIN" == "1" ]]; then
    start_service "content-admin-api" 5083 env \
      ASPNETCORE_ENVIRONMENT=Development \
      ASPNETCORE_URLS=http://localhost:5083 \
      "ConnectionStrings__Default=${conn}" \
      "Jwt__Secret=${admin_secret}" \
      Jwt__Issuer=content-admin-api \
      Jwt__Audience=content-admin \
      dotnet run --no-build --project content-admin-api/ContentAdminApi.csproj
  fi

  if [[ "$RUN_WEB" == "1" ]]; then
    start_service "web" 5173 npm --prefix web run dev -- --host 127.0.0.1 --port 5173
  fi

  if [[ "$RUN_ADMIN" == "1" ]]; then
    start_service "admin" 5174 npm --prefix admin run dev -- --host 127.0.0.1 --port 5174
  fi

  wait_for_url "api" "http://localhost:5080/health"
  [[ "$RUN_NOTES" == "1" ]] && wait_for_url "notes-api" "http://localhost:5081/health"
  [[ "$RUN_CONTENT" == "1" ]] && wait_for_url "content-api" "http://localhost:5082/health"
  [[ "$RUN_ADMIN" == "1" ]] && wait_for_url "content-admin-api" "http://localhost:5083/health"

  printf '\n'
  log "Stack levantado"
  [[ "$RUN_WEB" == "1" ]] && printf '  Web:   http://localhost:5173\n'
  [[ "$RUN_ADMIN" == "1" ]] && printf '  Admin: http://localhost:5174\n'
  printf '  API:   http://localhost:5080/swagger\n'
  printf '  Logs:  %s\n\n' "$LOG_DIR"
  log "Presiona Ctrl+C para detener servicios."

  wait
}

main() {
  cd "$ROOT_DIR"
  load_env_file
  mkdir -p "$LOG_DIR"
  resolve_start_mode

  if [[ "$RUN_DB" == "1" ]]; then
    prepare_database
  fi

  if [[ "$START_MODE" == "docker" ]]; then
    build_docker_stack

    if [[ "$BUILD_ONLY" == "1" ]]; then
      log "Build Docker completo"
      exit 0
    fi

    start_docker_stack
    exit 0
  fi

  build_all

  if [[ "$BUILD_ONLY" == "1" ]]; then
    log "Build completo"
    exit 0
  fi

  trap cleanup EXIT INT TERM
  start_all
}

main "$@"
