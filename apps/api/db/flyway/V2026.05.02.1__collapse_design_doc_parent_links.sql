-- Collapse design-doc parent links into row fields on design_docs.
--
-- Replaces four junction tables (design_doc_task_relations,
-- design_doc_initiative_relations, design_doc_design_doc_relations,
-- service_design_docs) with parent_entity_id + parent_entity_type columns
-- on design_docs. Only TASK and DESIGN_DOC are valid parent types in the
-- new model; ServiceDesignDoc and DesignDocInitiativeRelation are dropped
-- without backfill (Service and Initiative are no longer parent types).

-- 1. Add columns (nullable for backfill).
CREATE TYPE "DesignDocParentEntityType" AS ENUM ('TASK', 'DESIGN_DOC');

ALTER TABLE "design_docs"
  ADD COLUMN "parent_entity_id" TEXT,
  ADD COLUMN "parent_entity_type" "DesignDocParentEntityType";

-- 2. Backfill: prefer DOC_CREATED_FROM_TASK rows over design-doc parents.
--    Each design doc gets at most one parent. Conflicting rows are surfaced
--    via NOTICE so the migration emits a warning rather than picking
--    silently.
DO $$
DECLARE
  conflict RECORD;
BEGIN
  -- Surface design docs that have both a DOC_CREATED_FROM_TASK link and a
  -- design-doc parent.
  FOR conflict IN
    SELECT
      dd.id AS design_doc_id,
      tr.task_id,
      ddr.parent_design_doc_id
    FROM design_docs dd
    JOIN design_doc_task_relations tr
      ON tr.design_doc_id = dd.id
      AND tr.relation_type = 'DOC_CREATED_FROM_TASK'
    JOIN design_doc_design_doc_relations ddr
      ON ddr.child_design_doc_id = dd.id
  LOOP
    RAISE NOTICE 'design_doc % has multiple parents (task=%, design_doc=%); using task parent',
      conflict.design_doc_id, conflict.task_id, conflict.parent_design_doc_id;
  END LOOP;

  -- Surface design docs that have multiple DOC_CREATED_FROM_TASK rows.
  FOR conflict IN
    SELECT
      design_doc_id,
      COUNT(*) AS task_parent_count
    FROM design_doc_task_relations
    WHERE relation_type = 'DOC_CREATED_FROM_TASK'
    GROUP BY design_doc_id
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'design_doc % has % DOC_CREATED_FROM_TASK rows; picking earliest by created_at',
      conflict.design_doc_id, conflict.task_parent_count;
  END LOOP;

  -- Surface design docs that have multiple design-doc parents.
  FOR conflict IN
    SELECT
      child_design_doc_id,
      COUNT(*) AS doc_parent_count
    FROM design_doc_design_doc_relations
    GROUP BY child_design_doc_id
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'design_doc % has % design-doc parents; picking earliest by created_at',
      conflict.child_design_doc_id, conflict.doc_parent_count;
  END LOOP;
END
$$;

-- 2a. Backfill task parents (highest priority).
WITH task_parents AS (
  SELECT DISTINCT ON (design_doc_id)
    design_doc_id,
    task_id
  FROM design_doc_task_relations
  WHERE relation_type = 'DOC_CREATED_FROM_TASK'
  ORDER BY design_doc_id, created_at ASC, id ASC
)
UPDATE design_docs dd
SET
  parent_entity_id = tp.task_id,
  parent_entity_type = 'TASK'
FROM task_parents tp
WHERE dd.id = tp.design_doc_id
  AND dd.parent_entity_id IS NULL;

-- 2b. Backfill design-doc parents for any design doc that didn't get a task
--     parent above.
WITH doc_parents AS (
  SELECT DISTINCT ON (child_design_doc_id)
    child_design_doc_id,
    parent_design_doc_id
  FROM design_doc_design_doc_relations
  ORDER BY child_design_doc_id, created_at ASC, id ASC
)
UPDATE design_docs dd
SET
  parent_entity_id = dp.parent_design_doc_id,
  parent_entity_type = 'DESIGN_DOC'
FROM doc_parents dp
WHERE dd.id = dp.child_design_doc_id
  AND dd.parent_entity_id IS NULL;

-- 3. Validate: parent_entity_id and parent_entity_type are either both set
--    or both null. We do not NOT NULL them because design docs without a
--    parent are valid (e.g. ones authored directly).
ALTER TABLE "design_docs"
  ADD CONSTRAINT "design_docs_parent_entity_consistency_chk"
  CHECK (
    (parent_entity_id IS NULL AND parent_entity_type IS NULL)
    OR (parent_entity_id IS NOT NULL AND parent_entity_type IS NOT NULL)
  );

-- 4. Index for parent lookups (e.g. "design docs whose parent is task X").
CREATE INDEX "design_docs_parent_entity_idx"
  ON "design_docs"("parent_entity_type", "parent_entity_id");

-- 5. Drop obsolete junction tables. FK constraints from the dropping side
--    cascade automatically; nothing else in the schema references these
--    rows.
DROP TABLE "design_doc_task_relations";
DROP TABLE "design_doc_initiative_relations";
DROP TABLE "design_doc_design_doc_relations";
DROP TABLE "service_design_docs";

-- 6. Drop the relation-type enum that only design_doc_task_relations used.
DROP TYPE "DesignDocTaskRelationType";
