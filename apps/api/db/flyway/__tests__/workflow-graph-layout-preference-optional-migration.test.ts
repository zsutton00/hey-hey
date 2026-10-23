import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationSql = readFileSync(
  resolve(
    __dirname,
    '../V2026.09.08.3__make_workflow_graph_layout_preference_optional.sql',
  ),
  'utf8',
);

describe('Workflow graph-layout preference optional correction migration', () => {
  it('corrects canonical and project-owned Workflow definitions', () => {
    expect(migrationSql).toContain('UPDATE "work_item_type"');
    expect(migrationSql).toContain('UPDATE "work_item_type_template"');
    expect(migrationSql.match(/"type_key" = 'workflow'/g)).toHaveLength(2);
    expect(
      migrationSql.match(
        /@> '\[{"key":"graphLayoutPreference"}\]'::jsonb/g,
      ),
    ).toHaveLength(2);
  });

  it('sets required to false on the existing preference definition while preserving section order', () => {
    expect(
      migrationSql.match(/->> 'key' = 'graphLayoutPreference'/g),
    ).toHaveLength(2);
    expect(
      migrationSql.match(
        /jsonb_set\([\s\S]*?'\{required\}'[\s\S]*?'false'::jsonb[\s\S]*?true[\s\S]*?\)/g,
      ),
    ).toHaveLength(2);
    expect(migrationSql.match(/WITH ORDINALITY/g)).toHaveLength(2);
    expect(migrationSql.match(/ORDER BY "section"\."ordinality"/g)).toHaveLength(
      2,
    );
  });

  it('does not rewrite the saved graph-layout position declaration', () => {
    expect(migrationSql).not.toContain('graph_configuration');
    expect(migrationSql).not.toContain("'{layout}'");
    expect(migrationSql).not.toContain('WorkItemGraphLayoutValue');
  });
});
