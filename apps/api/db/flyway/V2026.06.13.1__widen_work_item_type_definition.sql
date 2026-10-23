-- Widen work_item_type to carry the full WorkItemTypeDefinitionDto shape
-- alongside the lean registry columns.
--
-- The lean columns (allowed_child_task_types, sections, required_scalars,
-- parentage, etc.) remain the projection source the registry reads — they
-- carry axes the DTO has no equivalent for (forbidden_scalars, EntityType
-- parentage, tracking, anchorable_report_types, per-mode writing_standards).
-- These new columns add the DTO's richer, type-key-based axes that the lean
-- columns cannot represent. They are write/round-trip-only for now: nothing
-- projects them yet, so they are nullable and existing rows survive the ALTER
-- untouched. The V2026.06.13.* reseed backfills them onto the system rows.

ALTER TABLE "work_item_type"
    ADD COLUMN "name"                 TEXT,
    ADD COLUMN "description"          TEXT,
    -- [{ key, label, writingStandard?, required? }]
    ADD COLUMN "section_definitions"  JSONB,
    -- [{ key, label, valueType, required?, options? }]
    ADD COLUMN "scalar_definitions"   JSONB,
    -- string[] of type keys
    ADD COLUMN "allowed_parent_types" JSONB,
    -- string[] of type keys
    ADD COLUMN "allowed_child_types"  JSONB,
    -- [{ edgeType, targetTypeKeys }]
    ADD COLUMN "edge_targets"         JSONB;
