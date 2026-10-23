-- Structural work-item parentage is authored on each child definition. Remove
-- the retired duplicate capability gates from
-- both canonical definitions and complete project-owned definitions.

UPDATE work_item_type_template
SET capabilities = capabilities - 'canHaveParent' - 'canHaveChildren'
WHERE capabilities ?| ARRAY['canHaveParent', 'canHaveChildren'];

UPDATE work_item_type
SET capabilities = capabilities - 'canHaveParent' - 'canHaveChildren'
WHERE capabilities ?| ARRAY['canHaveParent', 'canHaveChildren'];
