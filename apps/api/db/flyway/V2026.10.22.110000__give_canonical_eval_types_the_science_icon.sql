-- Canonical Eval and Eval Case definitions use the beaker (science) icon.
-- Their orange color is mapped by type key in the UI, since canonical
-- definitions cannot author a color. Project-owned rows in work_item_type
-- remain untouched.
UPDATE work_item_type_template
SET icon_key = 'science',
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('EVAL', 'EVAL_CASE')
  AND icon_key IS DISTINCT FROM 'science';
