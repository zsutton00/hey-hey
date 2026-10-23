-- The read tool formerly named get_workflow is now get_diagram. The canonical
-- Diagram create guidance still sends agents to the removed name, so only that
-- text is rewritten. Project-owned Diagram definitions are deliberately left alone.
UPDATE work_item_type_template
SET writing_standards = jsonb_set(
      writing_standards,
      '{create}',
      to_jsonb(replace(writing_standards->>'create', '`get_workflow`', '`get_diagram`'))
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND position('`get_workflow`' IN writing_standards->>'create') > 0;
