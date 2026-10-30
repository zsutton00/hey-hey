-- Only executed in the disposable test server, never the existing API server.
CREATE TABLE flyway_schema_history (version text PRIMARY KEY);
INSERT INTO flyway_schema_history VALUES ('api-owned');

CREATE ROLE graph_search LOGIN PASSWORD 'local_graph_search';
CREATE DATABASE heyhey_graph_search OWNER graph_search;
\connect heyhey_graph_search
-- An administrator installs extensions; the app role is not a superuser.
CREATE EXTENSION vector VERSION '0.8.7';
CREATE EXTENSION pg_trgm;
