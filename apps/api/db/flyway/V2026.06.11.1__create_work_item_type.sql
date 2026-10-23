-- One definition per work-item type. System-supplied built-in types carry
-- is_system = true and project_id = NULL; project-scoped overrides carry the
-- owning project_id. The per-type axes from WorkItemTypeConfigEntry are
-- stored as JSONB (complex shapes) or native columns (scalars/booleans).
--
-- Uniqueness: system rows are unique on type_key globally; project rows are
-- unique on (project_id, type_key). Two partial indexes enforce this because
-- a single UNIQUE constraint treats NULL as not-equal-to-NULL, which would
-- allow duplicate system rows.

CREATE TABLE "work_item_type" (
    "id"                              TEXT        NOT NULL,
    "type_key"                        TEXT        NOT NULL,
    "is_system"                       BOOLEAN     NOT NULL DEFAULT false,
    "project_id"                      TEXT,
    "lifecycle_status"                TEXT        NOT NULL DEFAULT 'active',

    -- Complex axes serialized as JSONB
    "allowed_statuses"                JSONB       NOT NULL,
    "initial_status_policy"           JSONB       NOT NULL,
    "sections"                        JSONB       NOT NULL,
    "required_scalars"                JSONB       NOT NULL,
    "forbidden_scalars"               JSONB       NOT NULL,
    "parentage"                       JSONB       NOT NULL,
    "allowed_child_task_types"        JSONB       NOT NULL,
    "tracking"                        JSONB       NOT NULL,
    "allowed_edge_target_entity_types" JSONB      NOT NULL,
    "agent_settable_statuses"         JSONB       NOT NULL,
    "anchorable_report_types"         JSONB       NOT NULL,
    "writing_standards"               JSONB       NOT NULL,

    -- Boolean axes stored as native columns
    "can_have_parent"                 BOOLEAN     NOT NULL,
    "requires_parent"                 BOOLEAN     NOT NULL,
    "can_have_children"               BOOLEAN     NOT NULL,
    "is_hierarchy_node"               BOOLEAN     NOT NULL,
    "plan_eligible"                   BOOLEAN     NOT NULL,

    "created_at"                      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_type_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_item_type_lifecycle_status_check"
        CHECK ("lifecycle_status" IN ('active', 'archived')),
    CONSTRAINT "work_item_type_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- System rows: type_key globally unique when project_id is NULL
CREATE UNIQUE INDEX "work_item_type_system_type_key_unique"
    ON "work_item_type" ("type_key")
    WHERE "project_id" IS NULL;

-- Project rows: (project_id, type_key) unique within each project
CREATE UNIQUE INDEX "work_item_type_project_type_key_unique"
    ON "work_item_type" ("project_id", "type_key")
    WHERE "project_id" IS NOT NULL;

-- Support efficient lookup of all types visible to a project
CREATE INDEX "work_item_type_project_id_idx" ON "work_item_type" ("project_id");
