-- The identity-preserving cutover must retain canonical registration prose for
-- the global templates. Repair only the known legacy values produced when the
-- cutover merged the saved Workflow definitions over those registrations.
DO $migration$
BEGIN
  IF (SELECT count(*) FROM work_item_type_template
      WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')) <> 2 THEN
    RAISE EXCEPTION 'Cannot repair Diagram templates: expected two global canonical definitions';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET name = CASE type_key
      WHEN 'DIAGRAM' THEN 'Diagram'
      WHEN 'DIAGRAM_ELEMENT' THEN 'Diagram Element'
    END,
    description = CASE type_key
      WHEN 'DIAGRAM' THEN 'A graph-shaped design artifact with explicit kind and abstraction level.'
      WHEN 'DIAGRAM_ELEMENT' THEN 'A semantic element in a Diagram with an optional canonical reference.'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND ((type_key = 'DIAGRAM'
        AND name = 'Workflow'
        AND description = 'A graph-shaped design artifact that owns workflow_step children and renders inline as a flow chart when mentioned.')
    OR (type_key = 'DIAGRAM_ELEMENT'
        AND name = 'Workflow Step'
        AND description = 'A leaf node inside a workflow that captures one state, action, decision, or handoff.'));

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE ((type_key = 'DIAGRAM' AND (name, description) <> (
        'Diagram',
        'A graph-shaped design artifact with explicit kind and abstraction level.'))
        OR (type_key = 'DIAGRAM_ELEMENT' AND (name, description) <> (
          'Diagram Element',
          'A semantic element in a Diagram with an optional canonical reference.')))
  ) THEN
    RAISE EXCEPTION 'Canonical Diagram template prose was customized; reconcile it before continuing';
  END IF;
END
$migration$;
