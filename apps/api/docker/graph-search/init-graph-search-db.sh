#!/bin/sh
# Runs once, as the PostgreSQL superuser, when the graph/search data volume is first created.
# Creates the service's own non-superuser role and logical database, and installs the extensions
# it needs. The service applies its own migrations inside this database on startup.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v role_password="$GRAPH_SEARCH_DB_PASSWORD" <<'SQL'
CREATE ROLE graph_search LOGIN PASSWORD :'role_password';
CREATE DATABASE heyhey_graph_search OWNER graph_search;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname heyhey_graph_search <<'SQL'
CREATE EXTENSION vector VERSION '0.8.7';
CREATE EXTENSION pg_trgm;
SQL
