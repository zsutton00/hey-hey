-- Setup runs in the background after the PROVISIONING reservation, so the row
-- records how far it has got for the browser holding the binding cookie.
CREATE TYPE demo_sandbox_stage AS ENUM ('COPYING', 'CONNECTING', 'READY', 'FAILED');

ALTER TABLE demo_sandboxes
  ADD COLUMN stage demo_sandbox_stage NOT NULL DEFAULT 'COPYING',
  ADD COLUMN readiness_feature_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN connected_feature_count INTEGER NOT NULL DEFAULT 0 CHECK (connected_feature_count >= 0);

UPDATE demo_sandboxes SET stage = CASE
  WHEN status = 'DISCARDING' THEN 'FAILED'::demo_sandbox_stage
  WHEN status = 'PROVISIONING' AND organization_id IS NOT NULL THEN 'CONNECTING'::demo_sandbox_stage
  WHEN status = 'PROVISIONING' THEN 'COPYING'::demo_sandbox_stage
  ELSE 'READY'::demo_sandbox_stage
END;

-- Readiness now waits for every copied feature; the earlier single sample
-- becomes a one-element set for attempts already in flight.
UPDATE demo_sandboxes SET readiness_feature_ids = ARRAY[readiness_feature_id]
WHERE readiness_feature_id IS NOT NULL;

ALTER TABLE demo_sandboxes DROP CONSTRAINT demo_sandboxes_tenancy_prepared_check;
ALTER TABLE demo_sandboxes DROP COLUMN readiness_feature_id;

-- A failed attempt keeps a cleared DELETED/FAILED tombstone so the browser can
-- still learn that its setup failed.
ALTER TABLE demo_sandboxes ADD CONSTRAINT demo_sandboxes_tenancy_prepared_check CHECK (
  (organization_id IS NULL AND project_id IS NULL AND cardinality(readiness_feature_ids) = 0
    AND (status = 'PROVISIONING' OR (status = 'DELETED' AND stage = 'FAILED')))
  OR (organization_id IS NOT NULL AND project_id IS NOT NULL AND cardinality(readiness_feature_ids) > 0)
);
