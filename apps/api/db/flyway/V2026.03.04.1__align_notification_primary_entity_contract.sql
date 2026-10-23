DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'EntityType'
      AND e.enumlabel = 'REPORT'
  ) THEN
    ALTER TYPE "EntityType" ADD VALUE 'REPORT';
  END IF;
END
$$;

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "entity_id" TEXT,
  ADD COLUMN IF NOT EXISTS "entity_type" "EntityType",
  ADD COLUMN IF NOT EXISTS "entity_title" TEXT;

ALTER TABLE "notifications"
  ALTER COLUMN "report_id" DROP NOT NULL;

UPDATE "notifications" AS n
SET
  "entity_id" = n."report_id",
  "entity_type" = 'REPORT'::"EntityType",
  "entity_title" = CASE r."report_type"
    WHEN 'CODING_RESEARCH' THEN 'Coding Research'
    WHEN 'SNAPSHOT' THEN 'Snapshot'
    WHEN 'FINAL_RECOMMENDATIONS' THEN 'Final Recommendations'
    ELSE NULL
  END
FROM "reports" AS r
WHERE n."event_type" = 'report.created'
  AND n."report_id" IS NOT NULL
  AND r."id" = n."report_id"
  AND (
    n."entity_id" IS NULL
    OR n."entity_type" IS NULL
    OR n."entity_title" IS NULL
  );

WITH task_reference AS (
  SELECT
    n."id" AS "notification_id",
    task_entity."value" ->> 'id' AS "task_id"
  FROM "notifications" AS n
  LEFT JOIN LATERAL (
    SELECT value
    FROM jsonb_array_elements(n."affected_entities") WITH ORDINALITY AS entity(value, ordinality)
    WHERE value ->> 'type' = 'TASK'
      AND COALESCE(value ->> 'id', '') <> ''
    ORDER BY ordinality
    LIMIT 1
  ) AS task_entity ON TRUE
  WHERE n."event_type" IN ('task.completed', 'child_unblocked')
),
task_titles AS (
  SELECT
    ref."notification_id",
    ref."task_id",
    t."name" AS "task_name"
  FROM task_reference AS ref
  LEFT JOIN "tasks" AS t ON t."id" = ref."task_id"
)
UPDATE "notifications" AS n
SET
  "entity_id" = task_titles."task_id",
  "entity_type" = 'TASK'::"EntityType",
  "entity_title" = task_titles."task_name"
FROM task_titles
WHERE n."id" = task_titles."notification_id"
  AND (
    n."entity_id" IS NULL
    OR n."entity_type" IS NULL
    OR n."entity_title" IS NULL
  );

UPDATE "notifications" AS n
SET "affected_entities" = normalized."normalized_entities"
FROM (
  SELECT
    n."id",
    jsonb_build_array(
      jsonb_build_object(
        'id',
        n."entity_id",
        'type',
        n."entity_type"
      )
    ) || COALESCE(
      (
        SELECT jsonb_agg(filtered."value" ORDER BY filtered."ordinality")
        FROM (
          SELECT DISTINCT ON (
            (value ->> 'type'),
            (value ->> 'id')
          )
            value,
            ordinality
          FROM jsonb_array_elements(n."affected_entities") WITH ORDINALITY AS entity(value, ordinality)
          WHERE value ->> 'id' IS NOT NULL
            AND value ->> 'id' <> ''
            AND value ->> 'type' IS NOT NULL
            AND value ->> 'type' <> ''
            AND NOT (
              value ->> 'id' = n."entity_id"
              AND value ->> 'type' = n."entity_type"::text
            )
          ORDER BY
            (value ->> 'type'),
            (value ->> 'id'),
            ordinality
        ) AS filtered
      ),
      '[]'::jsonb
    ) AS "normalized_entities"
  FROM "notifications" AS n
  WHERE n."entity_id" IS NOT NULL
    AND n."entity_type" IS NOT NULL
) AS normalized
WHERE n."id" = normalized."id";

DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO unresolved_count
  FROM "notifications"
  WHERE "entity_id" IS NULL
    OR "entity_type" IS NULL
    OR "entity_title" IS NULL
    OR btrim("entity_title") = '';

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Failed to backfill notification primary entities for % rows',
      unresolved_count;
  END IF;

  SELECT COUNT(*)
  INTO unresolved_count
  FROM "notifications"
  WHERE "event_type" = 'report.created'
    AND (
      "entity_type" <> 'REPORT'::"EntityType"
      OR "report_id" IS NULL
      OR "entity_id" <> "report_id"
    );

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Invalid report.created notification primary entity mapping for % rows',
      unresolved_count;
  END IF;

  SELECT COUNT(*)
  INTO unresolved_count
  FROM "notifications"
  WHERE "event_type" IN ('task.completed', 'child_unblocked')
    AND (
      "entity_type" <> 'TASK'::"EntityType"
      OR "entity_id" IS NULL
      OR btrim("entity_title") = ''
    );

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Invalid task notification primary entity mapping for % rows',
      unresolved_count;
  END IF;
END
$$;

ALTER TABLE "notifications"
  ALTER COLUMN "entity_id" SET NOT NULL,
  ALTER COLUMN "entity_type" SET NOT NULL,
  ALTER COLUMN "entity_title" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "notifications_org_entity_idx"
  ON "notifications"("organization_id", "entity_type", "entity_id");
