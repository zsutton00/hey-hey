-- One row per searchable unit: a whole document or one chunk of it.
-- Writing a document replaces all of its units, so changed or cleared text
-- never leaves stale units behind.
CREATE TABLE search.unit (
    organization_id text NOT NULL,
    -- Units without a project are reachable only by organization-wide search.
    project_id text,
    -- The id returned to callers: the document id, or "<id>_chunk_<n>".
    id text NOT NULL,
    document_id text NOT NULL,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    type text NOT NULL,
    -- Work-item type key, preserved exactly as written.
    task_type text,
    title text NOT NULL DEFAULT '',
    text text NOT NULL,
    metadata jsonb NOT NULL,
    created_at timestamptz,
    updated_at timestamptz,
    search_text tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', text), 'B')
    ) STORED,
    -- Dimension is enforced by search.embedding_model, which refuses a model change.
    embedding halfvec NOT NULL,
    PRIMARY KEY (organization_id, id)
);

CREATE INDEX unit_project ON search.unit (organization_id, project_id);
CREATE INDEX unit_document ON search.unit (organization_id, document_id);
CREATE INDEX unit_search_text ON search.unit USING gin (search_text);
CREATE INDEX unit_title_trigram ON search.unit USING gin (title gin_trgm_ops);
CREATE INDEX unit_text_trigram ON search.unit USING gin (text gin_trgm_ops);
-- No approximate vector index: project-scoped exact scans are the default
-- until measurement shows one is needed.

-- Immutable record of an organization's irreversible closure. Retained after
-- its content is deleted, and refuses later writes for that organization.
CREATE TABLE search.projection_deletion (
    organization_id text PRIMARY KEY,
    marker_id uuid NOT NULL,
    irreversible_closure_at timestamptz NOT NULL,
    deletion_deadline timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now()
);
