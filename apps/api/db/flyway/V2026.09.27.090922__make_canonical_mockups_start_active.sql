-- Preserve complete project overrides and existing items. Replacing just the
-- lifecycle sentence also preserves appended visual-reference guidance.
UPDATE "work_item_type_template"
SET "allowed_statuses" = '["ACTIVE","BACKLOG","READY","ARCHIVED"]'::jsonb,
    "writing_standards" = jsonb_set(
      "writing_standards",
      '{create}',
      to_jsonb(replace(
        "writing_standards"->>'create',
        'Backlog is the initial state; Active means drafting;',
        'Active is the initial drafting state;'
      )),
      false
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'mockup';
