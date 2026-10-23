-- Collapse work_item_type to the stored WorkItemTypeDefinitionDto plus a single
-- capabilities map. Every engine-facing rule is now DERIVED from the definition
-- (see deriveRules in work-item-type-registry.service.ts), so the columns that
-- merely duplicated derivable facts are dropped.
--
-- What stays: the DTO axes (name, description, section_definitions,
-- allowed_parent_types, allowed_child_types, edge_targets, allowed_statuses,
-- required_scalars, forbidden_scalars, parentage, tracking,
-- agent_settable_statuses, anchorable_report_types, writing_standards).
-- What is new: capabilities — the boolean switches the engine reads, collapsed
-- from the five native boolean columns plus initial_status_policy's
-- hasSetInitialStatus flag.
-- What is dropped: sections, allowed_child_task_types, initial_status_policy,
-- allowed_edge_target_entity_types (all derivable), the five boolean columns
-- (now inside capabilities), and the vestigial scalar_definitions.
--
-- Order matters: add capabilities, backfill it from the columns about to be
-- dropped so pre-existing custom rows survive, tighten NOT NULL, drop last.

ALTER TABLE "work_item_type"
    ADD COLUMN "capabilities" JSONB;

-- Backfill the capabilities map for every existing row (system and custom)
-- from the boolean columns and initial_status_policy before they are dropped.
UPDATE "work_item_type" SET "capabilities" = jsonb_build_object(
    'canHaveParent',       "can_have_parent",
    'requiresParent',      "requires_parent",
    'canHaveChildren',     "can_have_children",
    'isHierarchyNode',     "is_hierarchy_node",
    'planEligible',        "plan_eligible",
    'hasSetInitialStatus',
        COALESCE(("initial_status_policy" ->> 'hasSetInitialStatus')::boolean, false)
);

-- Tighten the definition columns the registry now relies on. description stays
-- nullable per the DTO; the remaining axes are already NOT NULL from V2026.06.11.1.
ALTER TABLE "work_item_type"
    ALTER COLUMN "name"                 SET NOT NULL,
    ALTER COLUMN "section_definitions"  SET NOT NULL,
    ALTER COLUMN "allowed_parent_types" SET NOT NULL,
    ALTER COLUMN "allowed_child_types"  SET NOT NULL,
    ALTER COLUMN "edge_targets"         SET NOT NULL,
    ALTER COLUMN "capabilities"         SET NOT NULL;

-- Drop the derivable duplicates and the vestigial scalar_definitions.
ALTER TABLE "work_item_type"
    DROP COLUMN "sections",
    DROP COLUMN "allowed_child_task_types",
    DROP COLUMN "initial_status_policy",
    DROP COLUMN "allowed_edge_target_entity_types",
    DROP COLUMN "scalar_definitions",
    DROP COLUMN "can_have_parent",
    DROP COLUMN "requires_parent",
    DROP COLUMN "can_have_children",
    DROP COLUMN "is_hierarchy_node",
    DROP COLUMN "plan_eligible";
