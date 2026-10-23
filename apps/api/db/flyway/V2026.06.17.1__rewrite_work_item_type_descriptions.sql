-- Rewrite the description prose on three of the four system work_item_type
-- rows. The descriptions are surfaced verbatim in agent system prompts
-- (cli/src/agents/prompts/render-type-ontology.ts), so they carry the
-- type's place in the topology and need to read well as prose.
--
-- STANDARD: re-incorporate the engineering-container path (a task may live
--   under a feature OR under a cross-cutting engineering container).
-- FEATURE: restore the "opinionated structural backbone" framing and add
--   generic product-concept examples (onboarding flow, billing surface,
--   activity dashboard). Project-specific names are intentionally avoided
--   — this description ships in the prompt to every project that uses
--   the FEATURE built-in type.
-- GOAL: drop the "Top-level only — a goal cannot be parented..." clause.
--   The prompt render now derives that signal procedurally from the
--   allowed_parent_types / allowed_child_types arrays, so the description
--   no longer needs to restate it.
-- BUG: unchanged.

UPDATE "work_item_type" SET
  "description" = 'A unit of implementation work under a feature. Tasks describe *how* a feature is realized — the concrete engineering work that ladders up to a deliverable.',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'c1a70000-0000-0000-0000-000000000001';

UPDATE "work_item_type" SET
  "description" = 'A user-facing product capability — describes *what is delivered* as a product concept (e.g. an onboarding flow, a billing surface, an activity dashboard). Features form the opinionated structural backbone of a project and nest to build the hierarchy the agent navigates.',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'c1a70000-0000-0000-0000-000000000002';

UPDATE "work_item_type" SET
  "description" = 'A tracked, time-bound outcome that references the features, tasks, and plans expected to deliver it.',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'c1a70000-0000-0000-0000-000000000003';
