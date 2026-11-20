import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const testPostgres =
  process.env.RUN_DIAGRAM_MIGRATION_TESTS === '1' ? it : it.skip;
const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.11.12.020000__add_canonical_diagram_ui_start_role.sql',
  ),
  'utf8',
);

describe('canonical UI Start role migration', () => {
  testPostgres.each([[false], [true]])(
    'appends UI_START once (already present: %s), teaches it in standards, and leaves overrides and unrelated content untouched',
    (alreadyPresent: boolean) => {
      // Only session-local temporary tables are visible to the migration. No
      // application table or Flyway history is changed, even on assertion failure.
      const output = execFileSync(
        'psql',
        ['-X', '--dbname=postgres', '--set=ON_ERROR_STOP=1', '--quiet'],
        {
          encoding: 'utf8',
          input: `
        BEGIN;
        SET LOCAL search_path = pg_temp;
        CREATE TEMP TABLE work_item_type_template (
          type_key text PRIMARY KEY,
          section_definitions jsonb NOT NULL,
          writing_standards jsonb,
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TEMP TABLE work_item_type (LIKE work_item_type_template INCLUDING ALL);
        INSERT INTO work_item_type_template (type_key, section_definitions, writing_standards)
        VALUES ('DIAGRAM_ELEMENT', jsonb_build_array(
          jsonb_build_object('key', 'description', 'kind', 'markdown'),
          jsonb_build_object('key', 'diagramElementMetadata', 'kind', 'json',
            'diagramElementPolicy', jsonb_build_object(
              'roles', '[{"key":"GENERIC","label":"Generic","notation":"box"},
                {"key":"UI","label":"Ui","notation":"box"},
                {"key":"DIAGRAM_REFERENCE","label":"Diagram reference","notation":"frame"}]'::jsonb
                || CASE WHEN ${alreadyPresent} THEN
                  '[{"key":"UI_START","label":"UI Start","notation":"box"}]'::jsonb
                  ELSE '[]'::jsonb END,
              'referenceTargets', '[{"entityType":"TASK"},{"entityType":"SERVICE"}]'::jsonb
            ))
        ), jsonb_build_object(
          'create', 'Pick roles: UI for an interface surface; DECISION for a branch. Good: role UI and canonical reference X. UX_FLOW with UI screens "Public landing page" and "Demo project page".',
          'edit', 'Unrelated edit standards'
        ));
        INSERT INTO work_item_type_template (type_key, section_definitions, writing_standards)
          VALUES ('OTHER', '[{"key":"description"}]', '{"create":"UI for an interface surface;","edit":"x"}');
        INSERT INTO work_item_type SELECT * FROM work_item_type_template;
        CREATE TEMP TABLE original_templates AS SELECT * FROM work_item_type_template;
        ${migration}
        ${migration}
        DO $test$
        DECLARE before_sections jsonb; after_sections jsonb; after_standards jsonb;
        BEGIN
          SELECT section_definitions INTO before_sections FROM original_templates
            WHERE type_key = 'DIAGRAM_ELEMENT';
          SELECT section_definitions, writing_standards INTO after_sections, after_standards
            FROM work_item_type_template WHERE type_key = 'DIAGRAM_ELEMENT';
          IF (SELECT count(*) FROM jsonb_array_elements(
              after_sections #> '{1,diagramElementPolicy,roles}') AS r(role)
              WHERE r.role = '{"key":"UI_START","label":"UI Start","notation":"box"}'::jsonb) <> 1 THEN
            RAISE EXCEPTION 'UI_START must be present exactly once';
          END IF;
          IF NOT ${alreadyPresent} AND (after_sections #> '{1,diagramElementPolicy,roles}') <>
            (before_sections #> '{1,diagramElementPolicy,roles}') ||
            '[{"key":"UI_START","label":"UI Start","notation":"box"}]'::jsonb THEN
            RAISE EXCEPTION 'Existing roles must be preserved with UI_START appended';
          END IF;
          IF jsonb_set(after_sections, '{1,diagramElementPolicy,roles}',
            before_sections #> '{1,diagramElementPolicy,roles}') <> before_sections THEN
            RAISE EXCEPTION 'Unrelated section metadata changed';
          END IF;
          IF after_standards->>'create' NOT LIKE '%UI_START for the entrance%'
            OR after_standards->>'create' NOT LIKE '%a UI_START screen "Public landing page" and a UI screen%'
            OR after_standards->>'create' NOT LIKE '%role UI (UI_START for the flow''s entrance%' THEN
            RAISE EXCEPTION 'Standards must teach UI_START';
          END IF;
          IF after_standards->>'edit' <> 'Unrelated edit standards' THEN
            RAISE EXCEPTION 'Unrelated standards text changed';
          END IF;
          IF EXISTS (SELECT * FROM work_item_type EXCEPT SELECT * FROM original_templates) THEN
            RAISE EXCEPTION 'Complete project overrides changed';
          END IF;
          IF (SELECT section_definitions FROM work_item_type_template WHERE type_key = 'OTHER')
            <> (SELECT section_definitions FROM original_templates WHERE type_key = 'OTHER') THEN
            RAISE EXCEPTION 'Unrelated canonical definition changed';
          END IF;
        END
        $test$;
        ROLLBACK;
        SELECT 'UI Start migration invariants passed';
      `,
        },
      );
      expect(output).toContain('UI Start migration invariants passed');
    },
  );
});
