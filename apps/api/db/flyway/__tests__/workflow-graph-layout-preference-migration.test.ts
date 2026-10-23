import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationSql = readFileSync(
  resolve(
    __dirname,
    '../V2026.09.08.2__add_workflow_graph_layout_preference.sql',
  ),
  'utf8',
);

describe('V2026.09.08.2: Workflow graph layout preference', () => {
  const sectionDefinition =
    '[{"key":"graphLayoutPreference","label":"Graph Layout Preference","kind":"json","schemaRef":"#/components/schemas/WorkItemGraphLayoutPreferenceValue"}]';
  const declaration =
    '{"sectionKey":"graphLayoutPreference","schemaRef":"#/components/schemas/WorkItemGraphLayoutPreferenceValue"}';

  it('updates project-owned and canonical Workflow definitions', () => {
    expect(migrationSql).toContain('UPDATE "work_item_type"');
    expect(migrationSql).toContain('UPDATE "work_item_type_template"');
    expect(migrationSql.match(/WHERE "type_key" = 'workflow'/g)).toHaveLength(
      2,
    );
  });

  it('appends the optional section only when it is absent', () => {
    expect(
      migrationSql.match(/@> '\[{"key":"graphLayoutPreference"}\]'/g),
    ).toHaveLength(2);
    expect(migrationSql.split(sectionDefinition)).toHaveLength(3);
  });

  it('adds the type-neutral declaration without replacing saved layout configuration', () => {
    expect(migrationSql.match(/jsonb_set\(/g)).toHaveLength(2);
    expect(migrationSql.match(/'\{layoutPreference\}'/g)).toHaveLength(2);
    expect(migrationSql.split(declaration)).toHaveLength(3);
    expect(migrationSql).not.toContain('"graphLayout"');
    expect(migrationSql).not.toContain('"tasks"');
    expect(migrationSql).not.toContain('"task_section"');
  });
});
