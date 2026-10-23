-- A PROVISIONING row reserves capacity before its tenancy is prepared, so the
-- tenancy columns stay empty until the preparation transaction fills them in.
ALTER TABLE demo_sandboxes
  ALTER COLUMN organization_id DROP NOT NULL,
  ALTER COLUMN project_id DROP NOT NULL,
  ALTER COLUMN readiness_feature_id DROP NOT NULL;

ALTER TABLE demo_sandboxes ADD CONSTRAINT demo_sandboxes_tenancy_prepared_check CHECK (
  (organization_id IS NULL AND project_id IS NULL AND readiness_feature_id IS NULL AND status = 'PROVISIONING')
  OR (organization_id IS NOT NULL AND project_id IS NOT NULL AND readiness_feature_id IS NOT NULL)
);
