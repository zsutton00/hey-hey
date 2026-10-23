-- Separate MODE placement from launch applicability. Every MODE work item is
-- structurally owned by one Feature; graph DEPENDS_ON edges remain the only
-- Feature-scoped launch signal.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'MODE'
  ) THEN
    RAISE EXCEPTION
      'Cannot require a Feature parent for project MODE items; canonical MODE template is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tasks AS mode
    LEFT JOIN tasks AS parent ON parent.id = mode.parent_task_id
    WHERE mode.type = 'MODE'
      AND (
        mode.parent_task_id IS NULL
        OR parent.id IS NULL
        OR parent.type <> 'FEATURE'
        OR parent.project_id IS DISTINCT FROM mode.project_id
        OR parent.organization_id IS DISTINCT FROM mode.organization_id
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot require a Feature parent for project MODE items; existing MODE rows are orphaned, non-FEATURE-parented, or cross-project';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET allowed_parent_types = '["FEATURE"]'::jsonb,
    edge_targets = (
      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN edge->>'edgeType' = 'DEPENDS_ON' THEN jsonb_set(
              edge,
              '{targetTypeKeys}',
              (
                SELECT jsonb_agg(target ORDER BY target)
                FROM (
                  SELECT value AS target
                  FROM jsonb_array_elements_text(
                    COALESCE(edge->'targetTypeKeys', '[]'::jsonb)
                  )
                  UNION
                  SELECT 'FEATURE'
                ) AS targets
              ),
              true
            )
            ELSE edge
          END
          ORDER BY ordinal
        ),
        '[{"edgeType":"DEPENDS_ON","targetTypeKeys":["FEATURE"]}]'::jsonb
      )
      FROM jsonb_array_elements(
        COALESCE(work_item_type_template.edge_targets, '[]'::jsonb)
      ) WITH ORDINALITY AS edges(edge, ordinal)
    ),
    parentage = jsonb_set(
      COALESCE(parentage, '{}'::jsonb),
      '{allowedParentEntityTypes}',
      '["TASK"]'::jsonb,
      true
    ),
    capabilities = jsonb_set(
      COALESCE(capabilities, '{}'::jsonb),
      '{requiresParent}',
      'true'::jsonb,
      true
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'MODE';

UPDATE work_item_type
SET allowed_parent_types = '["FEATURE"]'::jsonb,
    edge_targets = (
      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN edge->>'edgeType' = 'DEPENDS_ON' THEN jsonb_set(
              edge,
              '{targetTypeKeys}',
              (
                SELECT jsonb_agg(target ORDER BY target)
                FROM (
                  SELECT value AS target
                  FROM jsonb_array_elements_text(
                    COALESCE(edge->'targetTypeKeys', '[]'::jsonb)
                  )
                  UNION
                  SELECT 'FEATURE'
                ) AS targets
              ),
              true
            )
            ELSE edge
          END
          ORDER BY ordinal
        ),
        '[{"edgeType":"DEPENDS_ON","targetTypeKeys":["FEATURE"]}]'::jsonb
      )
      FROM jsonb_array_elements(
        COALESCE(work_item_type.edge_targets, '[]'::jsonb)
      ) WITH ORDINALITY AS edges(edge, ordinal)
    ),
    parentage = jsonb_set(
      COALESCE(parentage, '{}'::jsonb),
      '{allowedParentEntityTypes}',
      '["TASK"]'::jsonb,
      true
    ),
    capabilities = jsonb_set(
      COALESCE(capabilities, '{}'::jsonb),
      '{requiresParent}',
      'true'::jsonb,
      true
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'MODE';
