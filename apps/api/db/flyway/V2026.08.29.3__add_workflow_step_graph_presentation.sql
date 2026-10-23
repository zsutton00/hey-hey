-- Add optional authored presentation data to the canonical workflow_step type.
-- Project-owned type overrides intentionally remain untouched; they opt out of
-- canonical definition deltas and can add this section through their own type
-- definition proposal when needed.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'workflow_step'
  ) THEN
    RAISE EXCEPTION 'Cannot add workflow_step graph presentation; canonical template is missing';
  END IF;
END
$$;

UPDATE "work_item_type_template"
SET
  "section_definitions" = CASE
    WHEN "section_definitions" @> '[{"key":"graphPresentation"}]'::jsonb
      THEN "section_definitions"
    ELSE "section_definitions" || '[{"key":"graphPresentation","label":"Graph Presentation","kind":"json","schemaRef":"#/components/schemas/WorkItemGraphNodePresentationValue","required":false}]'::jsonb
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'workflow_step';
