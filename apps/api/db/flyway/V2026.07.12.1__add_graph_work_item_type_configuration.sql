-- Persist optional type-neutral graph configuration for work-item type
-- definitions. The public DTO carries this under capabilities.graph; the
-- registry stores it separately so the existing capabilities map can remain
-- the engine's boolean-switch map.

ALTER TABLE "work_item_type"
    ADD COLUMN IF NOT EXISTS "graph_configuration" JSONB;

UPDATE "work_item_type"
SET
    "graph_configuration" = "capabilities" -> 'graph',
    "capabilities" = "capabilities" - 'graph',
    "updated_at" = CURRENT_TIMESTAMP
WHERE
    "graph_configuration" IS NULL
    AND jsonb_typeof("capabilities" -> 'graph') = 'object';
