#!/bin/sh
set -eu

for sql in \
  bible_timeline_schema.sql \
  bible_timeline_bundle.rv60.seed.sql \
  content_schema.sql \
  notes_schema.sql
do
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --file "/bootstrap/$sql"
done

if [ "${SEED_DEVELOPMENT_ADMIN:-false}" = "true" ]; then
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --file /bootstrap/seed_admin_user.sql
fi
