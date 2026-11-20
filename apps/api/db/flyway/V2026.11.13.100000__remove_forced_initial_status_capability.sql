-- A type's first status is its default starting status; nothing forces it any
-- more. Strip the retired `hasSetInitialStatus` capability so stored
-- capabilities still match the strict capability schema.

UPDATE work_item_type
SET capabilities = capabilities - 'hasSetInitialStatus'
WHERE capabilities ? 'hasSetInitialStatus';

UPDATE work_item_type_template
SET capabilities = capabilities - 'hasSetInitialStatus'
WHERE capabilities ? 'hasSetInitialStatus';

-- Create proposals carry the capabilities at the updates root.
UPDATE proposals
SET updates = jsonb_set(updates, '{capabilities}', (updates -> 'capabilities') - 'hasSetInitialStatus')
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND updates #> '{capabilities}' ? 'hasSetInitialStatus';

-- Edit proposals wrap a complete definition.
UPDATE proposals
SET updates = jsonb_set(updates, '{definition,capabilities}', (updates #> '{definition,capabilities}') - 'hasSetInitialStatus')
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND updates #> '{definition,capabilities}' ? 'hasSetInitialStatus';

UPDATE proposals
SET retained_original_target_content = jsonb_set(
      retained_original_target_content,
      '{definition,capabilities}',
      (retained_original_target_content #> '{definition,capabilities}') - 'hasSetInitialStatus')
WHERE target_entity_type = 'WORK_ITEM_TYPE'
  AND retained_original_target_content #> '{definition,capabilities}' ? 'hasSetInitialStatus';
