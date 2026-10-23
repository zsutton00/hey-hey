-- Server-authoritative Open Items: one collection per authenticated user and
-- project, item-granular rows with named virtual groups, removal tombstones,
-- and bounded idempotency results. Item and group revisions are minted from
-- the collection revision so a revision value is never reused after a row is
-- cleaned up and recreated.

CREATE TABLE "open_item_collections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "revision" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_item_collections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "open_item_collections_revision_check" CHECK ("revision" >= 0),
    CONSTRAINT "open_item_collections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "open_item_collections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "open_item_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "open_item_collections_project_id_user_id_key" ON "open_item_collections"("project_id", "user_id");
CREATE INDEX "open_item_collections_user_id_idx" ON "open_item_collections"("user_id");

CREATE TABLE "open_item_groups" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT COLLATE "C" NOT NULL,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "revision" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_item_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "open_item_groups_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "open_item_groups_position_check" CHECK ("position" ~ '^[0-9A-Za-z]{1,64}$'),
    CONSTRAINT "open_item_groups_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "open_item_groups_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "open_item_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Target of the item membership foreign key, which keeps every member in the
-- same collection as its group.
CREATE UNIQUE INDEX "open_item_groups_collection_id_id_key" ON "open_item_groups"("collection_id", "id");
CREATE INDEX "open_item_groups_collection_id_position_idx" ON "open_item_groups"("collection_id", "position");

CREATE TABLE "open_items" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    -- TEXT rather than the "EntityType" enum: the API EntityType contract also
    -- covers IMPLEMENTATION_HINT and USER, real platform entities the database
    -- enum lacks. Values are validated against the contract before writing.
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "note" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "position" TEXT COLLATE "C" NOT NULL,
    "group_id" TEXT,
    "member_position" TEXT COLLATE "C",
    "revision" BIGINT NOT NULL,
    "lineage" JSONB NOT NULL,
    "presentation" JSONB NOT NULL,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_items_pkey" PRIMARY KEY ("id"),
    -- A cleared note is stored as NULL only.
    CONSTRAINT "open_items_note_check" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 2000),
    CONSTRAINT "open_items_position_check" CHECK ("position" ~ '^[0-9A-Za-z]{1,64}$'),
    CONSTRAINT "open_items_member_position_check" CHECK ("member_position" IS NULL OR "member_position" ~ '^[0-9A-Za-z]{1,64}$'),
    CONSTRAINT "open_items_membership_check" CHECK (("group_id" IS NULL) = ("member_position" IS NULL)),
    CONSTRAINT "open_items_removed_ungrouped_check" CHECK ("removed_at" IS NULL OR "group_id" IS NULL),
    CONSTRAINT "open_items_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "open_items_lineage_check" CHECK (jsonb_typeof("lineage") = 'array' AND jsonb_array_length("lineage") <= 16),
    CONSTRAINT "open_items_presentation_check" CHECK (jsonb_typeof("presentation") = 'object'),
    CONSTRAINT "open_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "open_item_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "open_items_collection_id_group_id_fkey" FOREIGN KEY ("collection_id", "group_id") REFERENCES "open_item_groups"("collection_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- One row per canonical entity identity per collection; a removed row is a
-- tombstone that is revived by a later activation.
CREATE UNIQUE INDEX "open_items_collection_id_entity_type_entity_id_key" ON "open_items"("collection_id", "entity_type", "entity_id");
CREATE INDEX "open_items_collection_id_position_idx" ON "open_items"("collection_id", "position") WHERE "removed_at" IS NULL;
CREATE INDEX "open_items_collection_id_group_id_member_position_idx" ON "open_items"("collection_id", "group_id", "member_position") WHERE "group_id" IS NOT NULL;
CREATE INDEX "open_items_collection_id_removed_at_idx" ON "open_items"("collection_id", "removed_at") WHERE "removed_at" IS NOT NULL;

CREATE TABLE "open_item_idempotency_records" (
    "collection_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_item_idempotency_records_pkey" PRIMARY KEY ("collection_id", "idempotency_key"),
    CONSTRAINT "open_item_idempotency_records_key_check" CHECK ("idempotency_key" ~ '^[A-Za-z0-9._:-]{8,128}$'),
    CONSTRAINT "open_item_idempotency_records_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "open_item_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "open_item_idempotency_records_collection_id_created_at_idx" ON "open_item_idempotency_records"("collection_id", "created_at");
