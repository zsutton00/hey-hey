import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const testPostgres =
  process.env.RUN_DIAGRAM_MIGRATION_TESTS === '1' ? it : it.skip;
const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.10.02.184751__add_canonical_diagram_start_end_roles.sql',
  ),
  'utf8',
);

describe('canonical Start and End roles migration', () => {
  testPostgres.each([[], ['START'], ['END'], ['START', 'END']])(
    'adds each missing marker once with existing markers %j and preserves sections and overrides',
    (...existingMarkers: string[]) => {
      const markerDefinitions = [
        { key: 'START', label: 'Start', notation: 'box' },
        { key: 'END', label: 'End', notation: 'box' },
      ];
      const existing = markerDefinitions.filter((role) =>
        existingMarkers.includes(role.key),
      );
      const missing = markerDefinitions.filter(
        (role) => !existingMarkers.includes(role.key),
      );
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
          updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TEMP TABLE work_item_type (LIKE work_item_type_template INCLUDING ALL);
        INSERT INTO work_item_type_template (type_key, section_definitions)
        SELECT 'DIAGRAM_ELEMENT', jsonb_build_array(
          jsonb_build_object('key', 'description', 'kind', 'markdown'),
          jsonb_build_object('key', 'diagramElementMetadata', 'kind', 'json',
            'diagramElementPolicy', jsonb_build_object(
              'roles', jsonb_agg(jsonb_build_object(
                'key', role, 'label', initcap(replace(role, '_', ' ')),
                'notation', CASE role WHEN 'PERSON' THEN 'person'
                  WHEN 'DATABASE' THEN 'cylinder' WHEN 'DECISION' THEN 'diamond'
                  WHEN 'DIAGRAM_REFERENCE' THEN 'frame' ELSE 'box' END
              ) ORDER BY ordinal),
              'referenceTargets', '[{"entityType":"TASK"},{"entityType":"SERVICE"}]'::jsonb
            ))
        ) FROM unnest(ARRAY['GENERIC','PERSON','AGENT','SOFTWARE_SYSTEM','CONTAINER',
          'COMPONENT','CODE','DATABASE','UI','PRODUCT','DECISION',
          'EXTERNAL_SYSTEM','DIAGRAM_REFERENCE']) WITH ORDINALITY AS r(role, ordinal);
        INSERT INTO work_item_type_template (type_key, section_definitions)
          VALUES ('OTHER', '[{"key":"description"}]');
        UPDATE work_item_type_template SET section_definitions = jsonb_set(
          section_definitions, '{1,diagramElementPolicy,roles}',
          (section_definitions #> '{1,diagramElementPolicy,roles}') || '${JSON.stringify(existing)}'::jsonb
        ) WHERE type_key = 'DIAGRAM_ELEMENT';
        INSERT INTO work_item_type SELECT * FROM work_item_type_template;
        CREATE TEMP TABLE original_templates AS SELECT * FROM work_item_type_template;
        ${migration}
        ${migration}
        DO $test$
        DECLARE before_sections jsonb; after_sections jsonb; after_roles jsonb;
        BEGIN
          SELECT section_definitions INTO before_sections FROM original_templates
            WHERE type_key = 'DIAGRAM_ELEMENT';
          SELECT section_definitions INTO after_sections FROM work_item_type_template
            WHERE type_key = 'DIAGRAM_ELEMENT';
          after_roles := after_sections #> '{1,diagramElementPolicy,roles}';
          IF after_roles <> (before_sections #> '{1,diagramElementPolicy,roles}') ||
            '${JSON.stringify(missing)}'::jsonb THEN
            RAISE EXCEPTION 'Start and End must be appended once without changing existing roles';
          END IF;
          IF jsonb_set(after_sections, '{1,diagramElementPolicy,roles}',
            before_sections #> '{1,diagramElementPolicy,roles}') <> before_sections THEN
            RAISE EXCEPTION 'Unrelated section metadata changed';
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
        SELECT 'Start and End migration invariants passed';
      `,
        },
      );
      expect(output).toContain('Start and End migration invariants passed');
    },
  );
});
