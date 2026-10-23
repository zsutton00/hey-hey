-- Plans may coordinate work across Features without a structural parent.
-- Keep FEATURE as the allowed parent type when a parent is supplied.
UPDATE work_item_type_template
SET capabilities = jsonb_set(capabilities, '{requiresParent}', 'false'::jsonb),
    writing_standards = jsonb_set(writing_standards, '{create}',
      to_jsonb('Create a Plan with an optional parent Feature after intake and the up-front Design Doc are complete. A Plan may span multiple Features. Author outcome, description, and plan configuration; represent chronology and prerequisites with DEPENDS_ON edges.'::text)),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'PLAN';

UPDATE work_item_type
SET capabilities = jsonb_set(capabilities, '{requiresParent}', 'false'::jsonb),
    writing_standards = jsonb_set(writing_standards, '{create}',
      to_jsonb('Create a Plan with an optional parent Feature after intake and the up-front Design Doc are complete. A Plan may span multiple Features. Author outcome, description, and plan configuration; represent chronology and prerequisites with DEPENDS_ON edges.'::text)),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'PLAN';
