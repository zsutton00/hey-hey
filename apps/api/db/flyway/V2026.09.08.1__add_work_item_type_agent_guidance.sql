-- Optional semantic guidance; complete project overrides remain authoritative.
ALTER TABLE work_item_type ADD COLUMN agent_guidance JSONB;
ALTER TABLE work_item_type_template ADD COLUMN agent_guidance JSONB;
