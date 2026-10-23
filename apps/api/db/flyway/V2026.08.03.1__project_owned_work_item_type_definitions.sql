-- Move the canonical work-item definitions into a versioned template catalog
-- and materialize one project-owned copy of each current canonical key.
--
-- The collision guard is deliberately the first database operation. A
-- project-scoped row already occupying a canonical key is ambiguous: this
-- migration must not pick a winner or partially backfill projects.

DO $migration$
DECLARE
  collisions TEXT;
  missing_keys TEXT;
BEGIN
  WITH canonical(type_key) AS (
    VALUES
      ('STANDARD'),
      ('FEATURE'),
      ('GOAL'),
      ('BUG'),
      ('CONTRACT'),
      ('workflow'),
      ('workflow_step'),
      ('TASK_MONITOR')
  )
  SELECT string_agg(
    format('%s (project_id=%s)', work_item_type.type_key, work_item_type.project_id),
    ', '
    ORDER BY work_item_type.project_id, work_item_type.type_key
  )
  INTO collisions
  FROM "work_item_type" work_item_type
  JOIN canonical ON canonical.type_key = work_item_type.type_key
  WHERE work_item_type.project_id IS NOT NULL;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot materialize project-owned canonical work-item definitions; existing project-scoped canonical-key collision(s): %',
      collisions
      USING HINT = 'Resolve or remove the listed project-scoped rows, then rerun the migration.';
  END IF;

  WITH canonical(type_key) AS (
    VALUES
      ('STANDARD'),
      ('FEATURE'),
      ('GOAL'),
      ('BUG'),
      ('CONTRACT'),
      ('workflow'),
      ('workflow_step'),
      ('TASK_MONITOR')
  )
  SELECT string_agg(canonical.type_key, ', ' ORDER BY canonical.type_key)
  INTO missing_keys
  FROM canonical
  LEFT JOIN "work_item_type" work_item_type
    ON work_item_type.type_key = canonical.type_key
   AND work_item_type.is_system = true
   AND work_item_type.project_id IS NULL
   AND work_item_type.lifecycle_status = 'active'
  WHERE work_item_type.id IS NULL;

  IF missing_keys IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot materialize project-owned canonical work-item definitions; active global canonical definition(s) missing: %',
      missing_keys
      USING HINT = 'Restore the missing canonical work-item type rows before rerunning the migration.';
  END IF;
END
$migration$;

CREATE TABLE "work_item_type_template" (
    "id"                    TEXT        NOT NULL DEFAULT gen_random_uuid(),
    "type_key"              TEXT        NOT NULL,
    "revision"              INTEGER     NOT NULL,
    "name"                  TEXT        NOT NULL,
    "description"           TEXT,
    "section_definitions"   JSONB       NOT NULL,
    "allowed_parent_types"  JSONB       NOT NULL,
    "allowed_child_types"   JSONB       NOT NULL,
    "edge_targets"          JSONB       NOT NULL,
    "allowed_statuses"      JSONB       NOT NULL,
    "required_scalars"      JSONB       NOT NULL,
    "forbidden_scalars"     JSONB       NOT NULL,
    "parentage"             JSONB       NOT NULL,
    "tracking"              JSONB       NOT NULL,
    "agent_settable_statuses" JSONB     NOT NULL,
    "anchorable_report_types" JSONB     NOT NULL,
    "writing_standards"     JSONB       NOT NULL,
    "capabilities"          JSONB       NOT NULL,
    "graph_configuration"   JSONB,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_type_template_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_item_type_template_type_key_revision_key"
      UNIQUE ("type_key", "revision"),
    CONSTRAINT "work_item_type_template_revision_check"
      CHECK ("revision" > 0)
);

CREATE INDEX "work_item_type_template_type_key_idx"
  ON "work_item_type_template" ("type_key");

ALTER TABLE "work_item_type"
  ADD COLUMN IF NOT EXISTS "template_key" TEXT,
  ADD COLUMN IF NOT EXISTS "template_revision" INTEGER;

ALTER TABLE "work_item_type"
  ADD CONSTRAINT "work_item_type_template_fkey"
  FOREIGN KEY ("template_key", "template_revision")
  REFERENCES "work_item_type_template" ("type_key", "revision")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "work_item_type_template_lookup_idx"
  ON "work_item_type" ("template_key", "template_revision");

-- The existing global rows are the effective source after every prior
-- definition/capability delta. Copying them, rather than replaying historical
-- JSON literals, keeps the initial template revisions complete and current.
INSERT INTO "work_item_type_template" (
  "type_key",
  "revision",
  "name",
  "description",
  "section_definitions",
  "allowed_parent_types",
  "allowed_child_types",
  "edge_targets",
  "allowed_statuses",
  "required_scalars",
  "forbidden_scalars",
  "parentage",
  "tracking",
  "agent_settable_statuses",
  "anchorable_report_types",
  "writing_standards",
  "capabilities",
  "graph_configuration",
  "created_at",
  "updated_at"
)
SELECT
  source.type_key,
  1,
  source.name,
  source.description,
  source.section_definitions,
  source.allowed_parent_types,
  source.allowed_child_types,
  source.edge_targets,
  source.allowed_statuses,
  source.required_scalars,
  source.forbidden_scalars,
  source.parentage,
  source.tracking,
  source.agent_settable_statuses,
  source.anchorable_report_types,
  source.writing_standards,
  source.capabilities,
  source.graph_configuration,
  source.created_at,
  source.updated_at
FROM "work_item_type" source
WHERE source.is_system = true
  AND source.project_id IS NULL
  AND source.lifecycle_status = 'active'
  AND source.type_key IN (
    'STANDARD',
    'FEATURE',
    'GOAL',
    'BUG',
    'CONTRACT',
    'workflow',
    'workflow_step',
    'TASK_MONITOR'
  );

DO $migration$
DECLARE
  template_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO template_count
  FROM "work_item_type_template"
  WHERE "revision" = 1;

  IF template_count <> 8 THEN
    RAISE EXCEPTION
      'Canonical template materialization produced %, expected 8 initial revisions',
      template_count;
  END IF;
END
$migration$;

-- Materialize the complete project × canonical-template set. No conflict
-- handler is used: the guard above makes collisions explicit, and any
-- unexpected uniqueness failure rolls back the whole migration.
INSERT INTO "work_item_type" (
  "id",
  "type_key",
  "is_system",
  "project_id",
  "lifecycle_status",
  "template_key",
  "template_revision",
  "name",
  "description",
  "section_definitions",
  "allowed_parent_types",
  "allowed_child_types",
  "edge_targets",
  "allowed_statuses",
  "required_scalars",
  "forbidden_scalars",
  "parentage",
  "tracking",
  "agent_settable_statuses",
  "anchorable_report_types",
  "writing_standards",
  "capabilities",
  "graph_configuration",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::TEXT,
  template.type_key,
  false,
  project.id,
  'active',
  template.type_key,
  template.revision,
  template.name,
  template.description,
  template.section_definitions,
  template.allowed_parent_types,
  template.allowed_child_types,
  template.edge_targets,
  template.allowed_statuses,
  template.required_scalars,
  template.forbidden_scalars,
  template.parentage,
  template.tracking,
  template.agent_settable_statuses,
  template.anchorable_report_types,
  template.writing_standards,
  template.capabilities,
  template.graph_configuration,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "projects" project
CROSS JOIN "work_item_type_template" template
WHERE template.revision = 1;

DO $migration$
DECLARE
  project_count BIGINT;
  materialized_count BIGINT;
  invalid_pairs TEXT;
BEGIN
  SELECT COUNT(*) INTO project_count FROM "projects";
  SELECT COUNT(*)
  INTO materialized_count
  FROM "work_item_type"
  WHERE "is_system" = false
    AND "project_id" IS NOT NULL
    AND "template_revision" = 1;

  IF materialized_count <> project_count * 8 THEN
    RAISE EXCEPTION
      'Project-owned canonical materialization produced % rows for % projects; expected %',
      materialized_count,
      project_count,
      project_count * 8;
  END IF;

  WITH canonical(type_key) AS (
    VALUES
      ('STANDARD'),
      ('FEATURE'),
      ('GOAL'),
      ('BUG'),
      ('CONTRACT'),
      ('workflow'),
      ('workflow_step'),
      ('TASK_MONITOR')
  ),
  expected AS (
    SELECT project.id AS project_id, canonical.type_key
    FROM "projects" project
    CROSS JOIN canonical
  ),
  pair_state AS (
    SELECT
      expected.project_id,
      expected.type_key,
      COUNT(actual.id) AS row_count,
      BOOL_AND(actual.is_system = false) AS all_project_owned,
      BOOL_AND(actual.lifecycle_status = 'active') AS all_active,
      BOOL_AND(actual.template_key = expected.type_key) AS all_template_linked,
      BOOL_AND(actual.template_revision = 1) AS all_initial_revision
    FROM expected
    LEFT JOIN "work_item_type" actual
      ON actual.project_id = expected.project_id
     AND actual.type_key = expected.type_key
    GROUP BY expected.project_id, expected.type_key
  )
  SELECT string_agg(
    format(
      'project_id=%s type_key=%s rows=%s project_owned=%s active=%s template_linked=%s revision_one=%s',
      pair_state.project_id,
      pair_state.type_key,
      pair_state.row_count,
      pair_state.all_project_owned,
      pair_state.all_active,
      pair_state.all_template_linked,
      pair_state.all_initial_revision
    ),
    ', '
    ORDER BY pair_state.project_id, pair_state.type_key
  )
  INTO invalid_pairs
  FROM pair_state
  WHERE pair_state.row_count <> 1
     OR pair_state.all_project_owned IS DISTINCT FROM true
     OR pair_state.all_active IS DISTINCT FROM true
     OR pair_state.all_template_linked IS DISTINCT FROM true
     OR pair_state.all_initial_revision IS DISTINCT FROM true;

  IF invalid_pairs IS NOT NULL THEN
    RAISE EXCEPTION
      'Project-owned canonical materialization failed for project/key pair(s): %',
      invalid_pairs
      USING HINT = 'Inspect the listed project/key pairs and rerun only after each has exactly one active project-owned revision-one definition.';
  END IF;
END
$migration$;

-- Complete the cutover only after every project/key pair has been verified.
-- Templates now preserve canonical source history; global effective rows have
-- no remaining runtime role and must not survive as a fallback path.
DELETE FROM "work_item_type"
WHERE "project_id" IS NULL;

DROP INDEX IF EXISTS "work_item_type_system_type_key_unique";
DROP INDEX IF EXISTS "work_item_type_project_type_key_unique";

ALTER TABLE "work_item_type"
  ALTER COLUMN "project_id" SET NOT NULL,
  DROP COLUMN "is_system",
  ADD CONSTRAINT "work_item_type_project_type_key_unique"
    UNIQUE ("project_id", "type_key");
