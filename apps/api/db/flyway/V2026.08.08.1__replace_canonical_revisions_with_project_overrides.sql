DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM work_item_type p
    LEFT JOIN work_item_type_template b
      ON b.type_key = p.template_key AND b.revision = p.template_revision
    WHERE
      (p.template_key IS NULL AND p.template_revision IS NOT NULL)
      OR (
        p.template_key IS NULL
        AND EXISTS (
          SELECT 1
          FROM work_item_type_template canonical
          WHERE canonical.type_key = p.type_key
        )
      )
      OR (
        p.template_key IS NOT NULL
        AND (
          p.template_revision IS NULL
          OR b.id IS NULL
          OR p.template_key <> p.type_key
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot classify canonical project definitions against their recorded catalog revision';
  END IF;
END
$migration$;

DELETE FROM work_item_type p
USING work_item_type_template b
WHERE p.template_key = b.type_key
  AND p.template_revision = b.revision
  AND p.type_key = b.type_key
  AND p.lifecycle_status = 'active'
  AND ROW(
    p.name,
    p.icon_key,
    p.description,
    p.section_definitions,
    p.allowed_parent_types,
    p.edge_targets,
    p.allowed_statuses,
    p.required_scalars,
    p.forbidden_scalars,
    p.parentage,
    p.tracking,
    p.agent_settable_statuses,
    p.anchorable_report_types,
    p.writing_standards,
    p.capabilities,
    p.graph_configuration
  )
      IS NOT DISTINCT FROM
      ROW(
        b.name,
        b.icon_key,
        b.description,
        b.section_definitions,
        b.allowed_parent_types,
        b.edge_targets,
        b.allowed_statuses,
        b.required_scalars,
        b.forbidden_scalars,
        b.parentage,
        b.tracking,
        b.agent_settable_statuses,
        b.anchorable_report_types,
        b.writing_standards,
        b.capabilities,
        b.graph_configuration
      );

ALTER TABLE work_item_type DROP CONSTRAINT work_item_type_template_fkey;
DROP INDEX work_item_type_template_lookup_idx;
ALTER TABLE work_item_type DROP COLUMN template_key, DROP COLUMN template_revision;

DELETE FROM work_item_type_template historical
USING work_item_type_template newer
WHERE historical.type_key = newer.type_key
  AND historical.revision < newer.revision;

ALTER TABLE work_item_type_template
  DROP CONSTRAINT work_item_type_template_type_key_revision_key,
  DROP CONSTRAINT work_item_type_template_revision_check,
  DROP COLUMN revision,
  ADD CONSTRAINT work_item_type_template_type_key_key UNIQUE (type_key);
