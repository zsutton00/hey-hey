CREATE EXTENSION IF NOT EXISTS vector VERSION '0.8.7';
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA graph;
CREATE SCHEMA search;

-- Full-text search is built into PostgreSQL; no extension is required.
-- Fail startup if any required primitive is unavailable.
SELECT '[1,2,3]'::vector;
SELECT similarity('graph', 'graph');
SELECT to_tsvector('english', 'search foundation') @@ plainto_tsquery('english', 'search');
