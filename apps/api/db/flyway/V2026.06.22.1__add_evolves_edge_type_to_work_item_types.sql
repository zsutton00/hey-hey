-- Add EVOLVES to edge_targets and update STANDARD writing_standards vocab.
--
-- Background. EVOLVES was added to the agent-authorable edge vocabulary in
-- the API (AGENT_EDGE_TYPES) after V2026.06.13.2 had already been deployed.
-- That reseed wrote edge_targets for all four system types without EVOLVES;
-- and V2026.06.12.1 seeded STANDARD's writing_standards with the old vocab.
--
-- This migration appends the EVOLVES entry to the edge_targets JSONB array on
-- all four built-in work_item_type rows, and patches the two prose occurrences
-- of the edge vocabulary inside STANDARD's writing_standards.
--
-- V2026.06.12.1 and V2026.06.13.2 stay frozen (Flyway validateOnMigrate=true).

-- Add EVOLVES to edge_targets for all four built-in types.
UPDATE "work_item_type"
SET "edge_targets" = "edge_targets" || '[{"edgeType":"EVOLVES","targetTypeKeys":[]}]'::jsonb,
    "updated_at"   = CURRENT_TIMESTAMP
WHERE "id" IN (
  'c1a70000-0000-0000-0000-000000000001',
  'c1a70000-0000-0000-0000-000000000002',
  'c1a70000-0000-0000-0000-000000000003',
  'c1a70000-0000-0000-0000-000000000004'
);

-- Update STANDARD writing_standards: add `EVOLVES` to the edge vocabulary
-- fragment in both the create and edit prose blocks.
UPDATE "work_item_type"
SET "writing_standards" = jsonb_set(
      jsonb_set(
        "writing_standards",
        '{create}',
        to_jsonb(replace(
          "writing_standards"->>'create',
          '`RELATED_TO`, `DEPENDS_ON`, `DERIVES_FROM`, `SUPERSEDES`, `CONTRADICTS`) —',
          '`RELATED_TO`, `DEPENDS_ON`, `DERIVES_FROM`, `SUPERSEDES`, `CONTRADICTS`, `EVOLVES`) —'
        ))
      ),
      '{edit}',
      to_jsonb(replace(
        "writing_standards"->>'edit',
        '`RELATED_TO`, `DEPENDS_ON`, `DERIVES_FROM`, `SUPERSEDES`, `CONTRADICTS`)',
        '`RELATED_TO`, `DEPENDS_ON`, `DERIVES_FROM`, `SUPERSEDES`, `CONTRADICTS`, `EVOLVES`)'
      ))
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'c1a70000-0000-0000-0000-000000000001';
