-- Evals and Eval Cases are managed through the evaluation surfaces under
-- agents, not browsed as project work or knowledge. Give them the monitor role
-- Task Monitor uses and take them out of the Explorer sidebar.
UPDATE work_item_type_template
SET role = 'monitor',
    capabilities = jsonb_set(capabilities, '{showsInExplorerSidebar}', 'false'::jsonb),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('EVAL', 'EVAL_CASE');

UPDATE work_item_type
SET role = 'monitor',
    capabilities = jsonb_set(capabilities, '{showsInExplorerSidebar}', 'false'::jsonb),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('EVAL', 'EVAL_CASE');
