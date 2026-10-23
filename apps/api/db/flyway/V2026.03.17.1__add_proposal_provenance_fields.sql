ALTER TABLE proposals ADD COLUMN influences JSONB;
ALTER TABLE proposals ADD COLUMN generated_with_version VARCHAR(255);
