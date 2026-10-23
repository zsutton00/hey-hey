-- Keep the canonical Goal lifecycle focused without rewriting project-owned
-- definitions or statuses already saved on Goal work items.
UPDATE "work_item_type_template"
SET "allowed_statuses" = '["ACTIVE","ON_HOLD","VERIFYING","COMPLETED","CANCELLED","ARCHIVED"]'::jsonb,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'GOAL';
