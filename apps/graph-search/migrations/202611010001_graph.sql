CREATE TABLE graph.node (
    organization_id text NOT NULL,
    project_id text NOT NULL,
    id text NOT NULL,
    entity_type text NOT NULL,
    -- Partition ownership is distinct from canonical project membership.
    -- Organization-wide User and Project records cannot become scoped endpoints.
    project_scoped boolean NOT NULL DEFAULT true,
    labels text[] NOT NULL,
    properties jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(properties)='object'),
    stub boolean NOT NULL DEFAULT false,
    deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz,
    updated_at timestamptz,
    PRIMARY KEY (organization_id, project_id, id)
);
CREATE INDEX node_type ON graph.node (organization_id, project_id, entity_type, id);
-- The legacy batch route supplies endpoint IDs rather than a project. Resolve
-- these only within the authenticated organization, then authorize the project.
CREATE INDEX node_endpoint ON graph.node (organization_id, id, project_id);

CREATE TABLE graph.edge (
    organization_id text NOT NULL,
    project_id text NOT NULL,
    id text NOT NULL DEFAULT gen_random_uuid()::text,
    -- Retry identity is operation-owned; distinct authored edges may share endpoints.
    deduplication_key text,
    source_id text NOT NULL,
    target_id text NOT NULL,
    relationship_type text NOT NULL,
    properties jsonb NOT NULL DEFAULT '{"source":"system"}' CHECK (jsonb_typeof(properties)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, project_id, id),
    UNIQUE (organization_id, project_id, deduplication_key),
    FOREIGN KEY (organization_id, project_id, source_id)
        REFERENCES graph.node ON DELETE CASCADE,
    FOREIGN KEY (organization_id, project_id, target_id)
        REFERENCES graph.node ON DELETE CASCADE
);
CREATE INDEX edge_outgoing ON graph.edge
    (organization_id, project_id, source_id, relationship_type, target_id);
CREATE INDEX edge_incoming ON graph.edge
    (organization_id, project_id, target_id, relationship_type, source_id);
CREATE INDEX edge_type ON graph.edge (organization_id, project_id, relationship_type);
