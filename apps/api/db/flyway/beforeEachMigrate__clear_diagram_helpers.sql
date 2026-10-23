-- Flyway reuses its PostgreSQL session across migrations. These helpers are
-- private to each Diagram guidance migration, but pg_temp functions survive
-- transaction commits and otherwise collide with the next CREATE FUNCTION.
-- Clear only the two reused helpers; preserve the immutable migration files
-- and leave persistent schema functions untouched.
DROP FUNCTION IF EXISTS pg_temp.diagram_writing_standards(text);
DROP FUNCTION IF EXISTS pg_temp.diagram_semantics_guidance();
