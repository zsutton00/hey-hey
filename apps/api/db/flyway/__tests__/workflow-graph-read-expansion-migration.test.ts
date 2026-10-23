import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../V2026.08.19.1__configure_workflow_graph_read_expansion.sql',
);

describe('Workflow graph read expansion migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('updates only the canonical workflow template', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain(`WHERE "type_key" = 'workflow'`);
    expect(sql).not.toContain('UPDATE "work_item_type"');
  });

  it('declares the bounded Contract-linked workflow path', () => {
    expect(sql).toContain('"key": "contractLinkedWorkflows"');
    expect(sql.match(/"relationshipType": "DEPENDS_ON"/g)).toHaveLength(2);
    expect(sql).toContain('"relationshipType": "HAS_TASK"');
    expect(sql).toContain('"excludeRoot": true');
    expect(sql).toContain('"deduplicateBy": "entityId"');
    expect(sql).toContain('"limit": 100');
  });

  it('fails fast when the canonical graph capability is absent', () => {
    expect(sql).toContain('IF NOT EXISTS (');
    expect(sql).toContain(
      'canonical workflow template is missing its graph capability',
    );
  });
});
