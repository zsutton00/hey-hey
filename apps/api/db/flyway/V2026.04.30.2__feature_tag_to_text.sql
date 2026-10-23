-- Switch `tasks.tag` from the Postgres `feature_tag` ENUM to TEXT so the
-- allowed-values list can evolve without ALTER TYPE migrations and (later)
-- accept organization-defined tags. Application-layer validation (the Zod
-- featureTagSchema and the OpenAPI FeatureTag enum) remains the source of
-- truth for the core list. The FEATURE-only invariant is preserved by the
-- existing CHECK constraint, which works identically on TEXT.
ALTER TABLE "tasks" ALTER COLUMN "tag" TYPE text USING "tag"::text;

DROP TYPE "feature_tag";
