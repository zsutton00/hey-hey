-- Update shared canonical advice for all following projects. Complete project
-- overrides remain authoritative and retain their existing guidance.
UPDATE work_item_type_template
SET maintenance_guidance = $feature$During feature maintenance, check not only whether the description and requirements are current but whether accumulated scope has made the feature a catch-all. A feature with roughly 16–20 or more requirements is a cue to consider this. When it no longer represents one coherent product capability, suggest splitting it into smaller capability-focused features and reparenting or linking the affected work.$feature$,
updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'FEATURE';
