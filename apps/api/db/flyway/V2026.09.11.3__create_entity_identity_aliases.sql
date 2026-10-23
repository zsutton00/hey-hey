CREATE TABLE "entity_identity_aliases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_entity_type" TEXT NOT NULL,
  "source_entity_id" UUID NOT NULL,
  "canonical_entity_type" TEXT NOT NULL,
  "canonical_entity_id" UUID NOT NULL,
  "migration_name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_identity_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entity_identity_alias_source_unique"
    UNIQUE ("source_entity_type", "source_entity_id")
);

CREATE INDEX "entity_identity_alias_canonical_idx"
  ON "entity_identity_aliases" ("canonical_entity_type", "canonical_entity_id");

CREATE INDEX "entity_identity_alias_migration_idx"
  ON "entity_identity_aliases" ("migration_name");
