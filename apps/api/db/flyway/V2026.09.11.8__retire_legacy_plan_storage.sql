-- Apply only after the one-time Plan conversion and runtime-reference cutover.
-- Deliberately no CASCADE: an unaccounted-for dependency must block removal.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM plans p LEFT JOIN tasks t ON t.id = p.id
             WHERE t.id IS NULL OR t.type <> 'PLAN'
                OR t.organization_id <> p.organization_id
                OR t.project_id <> p.originating_project_id) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: Plan identities have not been converted';
  END IF;
  IF EXISTS (SELECT 1 FROM plan_stages s LEFT JOIN tasks t ON t.id = s.id
             WHERE t.id IS NULL OR t.type <> 'PLAN_STAGE' OR t.parent_task_id IS DISTINCT FROM s.plan_id) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: Stage identities or parents have not been converted';
  END IF;
  IF EXISTS (SELECT 1 FROM proposals WHERE target_entity_type::text IN ('PLAN', 'PLAN_STAGE', 'PLAN_STEP')) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: proposal references must be converted or archived';
  END IF;
  IF EXISTS (SELECT 1 FROM conversations WHERE workflow_about_type IN ('plan', 'plan-stage', 'plan-step', 'plan_stage', 'plan_step', 'planstage', 'planstep')) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: conversation associations remain';
  END IF;
  IF EXISTS (SELECT 1 FROM agent_sessions WHERE entity_type::text IN ('PLAN', 'PLAN_STAGE', 'PLAN_STEP')) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: agent session associations remain';
  END IF;
  IF EXISTS (SELECT 1 FROM flow_executions WHERE entity_type::text IN ('PLAN', 'PLAN_STAGE', 'PLAN_STEP')) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: flow execution associations remain';
  END IF;
  IF EXISTS (SELECT 1 FROM message_mentions WHERE entity_type::text IN ('PLAN', 'PLAN_STAGE', 'PLAN_STEP')) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: message mention references remain';
  END IF;
  IF EXISTS (SELECT 1 FROM attention_events WHERE entity_type::text IN ('PLAN', 'PLAN_STAGE', 'PLAN_STEP')) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: attention references remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM influences
    WHERE influenced_type IN ('plan', 'plan-stage', 'plan_stage', 'planstage', 'plan-step', 'plan_step', 'planstep')
       OR influencing_type IN ('plan', 'plan-stage', 'plan_stage', 'planstage', 'plan-step', 'plan_step', 'planstep')
  ) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: influence references remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM agent_session_work_item_associations
    WHERE work_item_type = 'PLAN_STEP'
  ) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: PlanStep session work-item associations remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM plan_steps step
    JOIN plan_stages stage ON stage.id = step.stage_id
    JOIN plans plan ON plan.id = stage.plan_id
    LEFT JOIN tasks task ON task.id = step.entity_id
    WHERE step.type::text = 'TASK' AND
      (task.id IS NULL OR task.parent_task_id IS DISTINCT FROM stage.id
       OR task.organization_id <> plan.organization_id
       OR task.project_id <> plan.originating_project_id)
  ) THEN
    RAISE EXCEPTION 'Plan cutover incomplete: implementation Task identities or parents differ';
  END IF;
END $$;

-- Migration audit data is deliberately outside the application Prisma/API model.
-- Preserve complete source rows before removing the retired persistence family.
CREATE TABLE IF NOT EXISTS plan_work_item_migration_archive (
  source_table text NOT NULL,
  source_id text NOT NULL,
  source_record jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_id)
);
DO $$
DECLARE source_table text;
BEGIN
  FOREACH source_table IN ARRAY ARRAY[
    'plans', 'plan_stages', 'plan_steps', 'plan_step_relations',
    'plan_relationships', 'plan_execution_guidance', 'plan_versions', 'plan_sign_offs'
  ] LOOP
    EXECUTE format(
      'INSERT INTO plan_work_item_migration_archive (source_table, source_id, source_record) SELECT %L, id::text, to_jsonb(source) FROM %I source',
      source_table, source_table
    );
  END LOOP;
END $$;

-- Preserve authored template revisions before changing their entity selector.
-- Only template placeholders change: Plan title/outcome already migrated to
-- Task name/outcome section. Historical source content remains in the archive.
INSERT INTO plan_work_item_migration_archive (source_table, source_id, source_record)
SELECT 'entity_prompt_template_revisions', id::text, to_jsonb(revision)
FROM entity_prompt_template_revisions revision
WHERE selector ->> 'entityType' = 'PLAN';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM entity_prompt_template_revisions WHERE template_key = 'entity_context.plan')
     AND EXISTS (SELECT 1 FROM entity_prompt_template_revisions WHERE template_key = 'entity_context.work_item.plan') THEN
    RAISE EXCEPTION 'Plan cutover incomplete: old and canonical Plan template histories collide';
  END IF;
END $$;

UPDATE entity_prompt_template_revisions
SET selector = '{"entityType":"WORK_ITEM","workItemTypeKey":"PLAN"}'::jsonb,
    template_key = CASE WHEN template_key = 'entity_context.plan'
      THEN 'entity_context.work_item.plan' ELSE template_key END,
    content = regexp_replace(
      regexp_replace(content, '\{\{[[:space:]]*entity\.title[[:space:]]*\}\}', '{{entity.name}}', 'g'),
      '\{\{[[:space:]]*entity\.outcome[[:space:]]*\}\}', '{{entity.sections.outcome}}', 'g')
WHERE selector ->> 'entityType' = 'PLAN';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM entity_prompt_template_revisions
             WHERE template_key = 'entity_context.plan'
                OR selector ->> 'entityType' = 'PLAN') THEN
    RAISE EXCEPTION 'Plan cutover incomplete: legacy prompt-template selector or key remains';
  END IF;
END $$;

-- Stage context uses the same Task fields and materialized sections as the
-- existing validated Standard template. Preserve any already-authored Stage
-- template; otherwise seed the canonical Stage heading from that template.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM entity_prompt_template_revisions
    WHERE template_key = 'entity_context.work_item.plan_stage'
      AND ownership_scope = 'CANONICAL' AND lifecycle_state = 'PUBLISHED'
      AND validation_status = 'VALID'
      AND selector = '{"entityType":"WORK_ITEM","workItemTypeKey":"PLAN_STAGE"}'::jsonb
  ) THEN
    IF EXISTS (SELECT 1 FROM entity_prompt_template_revisions
               WHERE template_key = 'entity_context.work_item.plan_stage') THEN
      RAISE EXCEPTION 'Plan cutover incomplete: Stage template exists without a valid canonical revision';
    END IF;
    IF (SELECT count(*) FROM entity_prompt_template_revisions
        WHERE template_key = 'entity_context.work_item.standard'
          AND ownership_scope = 'CANONICAL' AND lifecycle_state = 'PUBLISHED'
          AND validation_status = 'VALID') <> 1 THEN
      RAISE EXCEPTION 'Plan cutover requires exactly one valid canonical Standard template';
    END IF;
    INSERT INTO entity_prompt_template_revisions (
      id, template_key, selector, syntax_version, revision_number, content,
      ownership_scope, lifecycle_state, validation_status, validation_issues,
      validated_at, validator_version, created_at, published_at
    )
    SELECT gen_random_uuid(), 'entity_context.work_item.plan_stage',
      '{"entityType":"WORK_ITEM","workItemTypeKey":"PLAN_STAGE"}'::jsonb,
      syntax_version, 1, replace(content, '## Task', '## Plan Stage'),
      ownership_scope, lifecycle_state, validation_status, validation_issues,
      validated_at, validator_version, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM entity_prompt_template_revisions
    WHERE template_key = 'entity_context.work_item.standard'
      AND ownership_scope = 'CANONICAL' AND lifecycle_state = 'PUBLISHED'
      AND validation_status = 'VALID';
  END IF;
END $$;

DROP TABLE plan_sign_offs;
DROP TABLE plan_versions;
DROP TABLE plan_step_relations;
DROP TABLE plan_relationships;
DROP TABLE plan_execution_guidance;
DROP TABLE plan_steps;
DROP TABLE plan_stages;
DROP TABLE plans;

DROP TYPE plan_sign_off_status;
DROP TYPE plan_relationship_type;
DROP TYPE plan_execution_guidance_status;
DROP TYPE plan_step_relation_type;
DROP TYPE plan_step_type;
DROP TYPE plan_step_status;
DROP TYPE plan_stage_status;
DROP TYPE plan_status;
DROP TYPE plan_type;
DROP TYPE plan_effort_unit;
DROP TYPE plan_duration_unit;

-- PostgreSQL cannot delete enum labels in place. Rebuild the two shared enums
-- after the retired tables are gone. Any remaining legacy scalar reference,
-- array, view, or other unaccounted-for dependency blocks this transaction.
DO $$
DECLARE
  enum_name text;
  old_name text;
  retained_labels text;
  enum_oid oid;
  field record;
  stale boolean;
BEGIN
  FOREACH enum_name IN ARRAY ARRAY['EntityType', 'target_entity_type'] LOOP
    SELECT oid INTO STRICT enum_oid FROM pg_type
      WHERE typname = enum_name AND typnamespace = 'public'::regnamespace;
    SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder)
      INTO retained_labels FROM pg_enum
      WHERE enumtypid = enum_oid AND enumlabel NOT IN ('PLAN', 'PLAN_STAGE', 'PLAN_STEP');
    IF retained_labels IS NULL THEN
      RAISE EXCEPTION 'No retained values for enum %', enum_name;
    END IF;
    FOR field IN
      SELECT namespace.nspname AS schema_name, relation.relname AS table_name,
             attribute.attname AS column_name
      FROM pg_attribute attribute
      JOIN pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE attribute.atttypid = enum_oid AND NOT attribute.attisdropped
        AND relation.relkind IN ('r', 'p')
    LOOP
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I::text IN (''PLAN'', ''PLAN_STAGE'', ''PLAN_STEP''))',
        field.schema_name, field.table_name, field.column_name
      ) INTO stale;
      IF stale THEN
        RAISE EXCEPTION 'Plan cutover incomplete: legacy entity identity remains in %.%.%',
          field.schema_name, field.table_name, field.column_name;
      END IF;
    END LOOP;
    old_name := '_plan_cutover_' || enum_name;
    EXECUTE format('ALTER TYPE public.%I RENAME TO %I', enum_name, old_name);
    EXECUTE format('CREATE TYPE public.%I AS ENUM (%s)', enum_name, retained_labels);
    FOR field IN
      SELECT namespace.nspname AS schema_name, relation.relname AS table_name,
             attribute.attname AS column_name,
             pg_get_expr(defaults.adbin, defaults.adrelid) AS default_sql
      FROM pg_attribute attribute
      JOIN pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_attrdef defaults ON defaults.adrelid = attribute.attrelid
        AND defaults.adnum = attribute.attnum
      WHERE attribute.atttypid = enum_oid AND NOT attribute.attisdropped
        AND relation.relkind IN ('r', 'p')
    LOOP
      IF field.default_sql IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
          field.schema_name, field.table_name, field.column_name);
      END IF;
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE public.%I USING %I::text::public.%I',
        field.schema_name, field.table_name, field.column_name, enum_name, field.column_name, enum_name);
      IF field.default_sql IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s',
          field.schema_name, field.table_name, field.column_name,
          replace(field.default_sql, quote_ident(old_name), quote_ident(enum_name)));
      END IF;
    END LOOP;
    EXECUTE format('DROP TYPE public.%I', old_name);
  END LOOP;
END $$;
