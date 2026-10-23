-- Flip the BUG work-item-type's requiresParent capability to true.
--
-- Background. V2026.06.13.4 reseeded the four built-in capabilities maps
-- with BUG requiresParent: false. The ontology framing 'not tied to a
-- single feature' is about scope (a bug can span multiple features), not
-- parentage — a BUG must still be parented in the graph. Without that
-- constraint, orphan BUGs land on DEFAULT_CONFIG in
-- permission-evaluation.ts, and auto-approving PATCH proposals on them
-- sit PENDING because no top-level non-FEATURE rule applies.
--
-- This is a surgical UPDATE that overrides only the requiresParent key
-- on the BUG row's capabilities JSONB, leaving the other capability
-- switches and the row's allowed_statuses untouched.
--
-- Source of truth for new fresh installs and for future reseeds is the
-- generator script (scripts/generate-work-item-type-seed.ts, TYPE_SPECS
-- for BUG). V2026.06.13.4 stays frozen — Flyway validateOnMigrate is on,
-- so editing committed migrations breaks deployed envs.

UPDATE "work_item_type"
SET "capabilities" = jsonb_set("capabilities", '{requiresParent}', 'true'::jsonb),
    "updated_at"   = CURRENT_TIMESTAMP
WHERE "id" = 'c1a70000-0000-0000-0000-000000000004';
