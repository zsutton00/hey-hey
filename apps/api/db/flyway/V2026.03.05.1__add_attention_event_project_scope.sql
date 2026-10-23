ALTER TABLE attention_events
ADD COLUMN IF NOT EXISTS project_id UUID NULL;

WITH task_project_candidates AS (
  SELECT
    t.organization_id,
    t.id AS task_id,
    pt.project_id::uuid
  FROM tasks t
  JOIN project_tasks pt ON pt.task_id = t.id
  WHERE pt.project_id IS NOT NULL

  UNION

  SELECT
    t.organization_id,
    t.id AS task_id,
    i.originating_project_id::uuid AS project_id
  FROM tasks t
  JOIN initiatives i ON i.id = t.initiative_id
  WHERE i.originating_project_id IS NOT NULL
),
task_project_single AS (
  SELECT
    organization_id,
    task_id,
    MIN(project_id::text)::uuid AS project_id
  FROM task_project_candidates
  GROUP BY organization_id, task_id
  HAVING COUNT(DISTINCT project_id) = 1
)
UPDATE attention_events ae
SET project_id = tps.project_id
FROM task_project_single tps
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'TASK'
  AND ae.organization_id = tps.organization_id
  AND ae.entity_id = tps.task_id::text;

WITH task_project_candidates AS (
  SELECT
    t.organization_id,
    t.id AS task_id,
    pt.project_id::uuid
  FROM tasks t
  JOIN project_tasks pt ON pt.task_id = t.id
  WHERE pt.project_id IS NOT NULL

  UNION

  SELECT
    t.organization_id,
    t.id AS task_id,
    i.originating_project_id::uuid AS project_id
  FROM tasks t
  JOIN initiatives i ON i.id = t.initiative_id
  WHERE i.originating_project_id IS NOT NULL
),
task_project_single AS (
  SELECT
    organization_id,
    task_id,
    MIN(project_id::text)::uuid AS project_id
  FROM task_project_candidates
  GROUP BY organization_id, task_id
  HAVING COUNT(DISTINCT project_id) = 1
),
coding_session_project_candidates AS (
  SELECT
    cs.organization_id,
    cs.id AS coding_session_id,
    tps.project_id
  FROM coding_sessions cs
  JOIN task_project_single tps
    ON tps.organization_id = cs.organization_id
   AND tps.task_id = cs.task_id

  UNION

  SELECT
    cs.organization_id,
    cs.id AS coding_session_id,
    i.originating_project_id::uuid AS project_id
  FROM coding_sessions cs
  JOIN initiatives i ON i.id = cs.initiative_id
  WHERE i.originating_project_id IS NOT NULL

  UNION

  SELECT
    cs.organization_id,
    cs.id AS coding_session_id,
    dd.project_id::uuid
  FROM coding_sessions cs
  JOIN design_docs dd ON dd.id = cs.design_doc_id
  WHERE dd.project_id IS NOT NULL

  UNION

  SELECT
    cs.organization_id,
    cs.id AS coding_session_id,
    s.project_id::uuid
  FROM coding_sessions cs
  JOIN services s ON s.id = cs.service_id
  WHERE s.project_id IS NOT NULL

  UNION

  SELECT
    cs.organization_id,
    cs.id AS coding_session_id,
    c.project_id::uuid
  FROM coding_sessions cs
  JOIN conversations c ON c.id = cs.conversation_id
  WHERE c.project_id IS NOT NULL
),
coding_session_project_single AS (
  SELECT
    organization_id,
    coding_session_id,
    MIN(project_id::text)::uuid AS project_id
  FROM coding_session_project_candidates
  GROUP BY organization_id, coding_session_id
  HAVING COUNT(DISTINCT project_id) = 1
)
UPDATE attention_events ae
SET project_id = csps.project_id
FROM coding_session_project_single csps
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'CODING_SESSION'
  AND ae.organization_id = csps.organization_id
  AND ae.entity_id = csps.coding_session_id::text;

UPDATE attention_events ae
SET project_id = i.originating_project_id::uuid
FROM initiatives i
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'INITIATIVE'
  AND ae.organization_id = i.organization_id
  AND ae.entity_id = i.id::text
  AND i.originating_project_id IS NOT NULL;

UPDATE attention_events ae
SET project_id = dd.project_id::uuid
FROM design_docs dd
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'DESIGN_DOC'
  AND ae.organization_id = dd.organization_id
  AND ae.entity_id = dd.id::text
  AND dd.project_id IS NOT NULL;

UPDATE attention_events ae
SET project_id = s.project_id::uuid
FROM services s
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'SERVICE'
  AND ae.organization_id = s.organization_id
  AND ae.entity_id = s.id::text
  AND s.project_id IS NOT NULL;

UPDATE attention_events ae
SET project_id = c.project_id::uuid
FROM conversations c
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'CONVERSATION'
  AND ae.organization_id = c.organization_id
  AND ae.entity_id = c.id::text
  AND c.project_id IS NOT NULL;

UPDATE attention_events ae
SET project_id = p.originating_project_id::uuid
FROM plans p
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'PLAN'
  AND ae.organization_id = p.organization_id
  AND ae.entity_id = p.id::text
  AND p.originating_project_id IS NOT NULL;

UPDATE attention_events ae
SET project_id = p.originating_project_id::uuid
FROM plan_stages ps
JOIN plans p ON p.id = ps.plan_id
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'PLAN_STAGE'
  AND ae.organization_id = p.organization_id
  AND ae.entity_id = ps.id::text
  AND p.originating_project_id IS NOT NULL;

UPDATE attention_events ae
SET project_id = p.originating_project_id::uuid
FROM plan_steps pstep
JOIN plan_stages ps ON ps.id = pstep.stage_id
JOIN plans p ON p.id = ps.plan_id
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'PLAN_STEP'
  AND ae.organization_id = p.organization_id
  AND ae.entity_id = pstep.id::text
  AND p.originating_project_id IS NOT NULL;

UPDATE attention_events ae
SET project_id = p.id::uuid
FROM projects p
WHERE ae.project_id IS NULL
  AND ae.entity_type = 'PROJECT'
  AND ae.organization_id = p.organization_id
  AND ae.entity_id = p.id::text;

CREATE INDEX IF NOT EXISTS attention_events_org_user_project_focus_end_desc_idx
  ON attention_events (organization_id, user_id, project_id, focus_end DESC);
