-- Substrate for the in-product help library.
--
-- `help_node` is a tree of help articles: each row owns a markdown body and
-- nests under a parent (NULL for roots). Sibling-uniqueness on `slug` lets
-- URLs resolve by walking the parent chain. Help content is global to the
-- product — there are no organization_id / project_id columns by design.
--
-- `help_demo` carries the inline, runnable demos attached to a node. `kind`
-- discriminates the payload: a 'preset' row points at a hard-coded scene by
-- key, a 'dsl' row carries an authored JSON definition. The payload CHECK
-- enforces that exactly one of preset_key / definition is populated.

CREATE TABLE "help_node" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id"  UUID NULL,
    "slug"       TEXT NOT NULL,
    "title"      TEXT NOT NULL,
    "body"       TEXT NOT NULL DEFAULT '',
    "ordering"   INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "help_node_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "help_node_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "help_node"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Slug uniqueness among non-root siblings. NULL parent_id rows escape
    -- this constraint because (NULL, slug) tuples are never equal in
    -- Postgres; the partial unique index below covers the root grouping.
    CONSTRAINT "help_node_parent_id_slug_key" UNIQUE ("parent_id", "slug")
);

-- Sibling-slug uniqueness for roots (parent_id IS NULL), which the table-
-- level UNIQUE above cannot enforce.
CREATE UNIQUE INDEX "help_node_root_slug_key"
    ON "help_node"("slug")
    WHERE "parent_id" IS NULL;

-- Trigram index over the title+body concatenation for the later search step.
CREATE INDEX "help_node_title_body_trgm_idx"
    ON "help_node"
    USING GIN ((("title" || ' ' || "body")) gin_trgm_ops);

CREATE TABLE "help_demo" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "help_node_id" UUID NOT NULL,
    "ordering"     INTEGER NOT NULL,
    "caption"      TEXT NOT NULL DEFAULT '',
    "kind"         TEXT NOT NULL,
    "preset_key"   TEXT NULL,
    "definition"   JSONB NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "help_demo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "help_demo_help_node_id_fkey"
        FOREIGN KEY ("help_node_id") REFERENCES "help_node"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "help_demo_kind_check"
        CHECK ("kind" IN ('preset', 'dsl')),
    -- Exactly one payload column is populated, matching `kind`. A preset row
    -- points at a hard-coded scene by key; a dsl row carries its definition
    -- inline. The two forms never coexist on the same row.
    CONSTRAINT "help_demo_payload_check" CHECK (
        ("kind" = 'preset' AND "preset_key" IS NOT NULL AND "definition" IS NULL)
        OR ("kind" = 'dsl' AND "definition" IS NOT NULL AND "preset_key" IS NULL)
    )
);

CREATE INDEX "help_demo_help_node_id_idx" ON "help_demo"("help_node_id");
