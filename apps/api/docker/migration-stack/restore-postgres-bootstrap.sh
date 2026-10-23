#!/usr/bin/env bash
set -euo pipefail

bootstrap_dump=/bootstrap/application.dump

if [[ ! -f "$bootstrap_dump" ]]; then
  echo "Error: migration-stack bootstrap dump is missing at ${bootstrap_dump}." >&2
  exit 1
fi

source_database="${POSTGRES_DB}_bootstrap"

echo "Restoring migration-stack PostgreSQL bootstrap into source database ${source_database}."
dropdb --if-exists --username "$POSTGRES_USER" "$source_database"
createdb --username "$POSTGRES_USER" "$source_database"
psql --username "$POSTGRES_USER" --dbname "$source_database" --set ON_ERROR_STOP=1 \
  --command 'DROP SCHEMA IF EXISTS public CASCADE;'

restore_section() {
  pg_restore \
    --exit-on-error \
    --no-owner \
    --no-privileges \
    --username "$POSTGRES_USER" \
    --dbname "$source_database" \
    --section "$1" \
    "$bootstrap_dump"
}

restore_section pre-data
psql --username "$POSTGRES_USER" --dbname "$source_database" --set ON_ERROR_STOP=1 \
  --command 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;'
restore_section data
restore_section post-data
