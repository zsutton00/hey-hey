import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('V2026.09.04.2: readable entity-context Markdown', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.09.04.2__format_entity_context_as_markdown.sql',
    ),
    'utf8',
  );

  const expectedHeadings = new Map([
    ['entity_context.project', 'Project'],
    ['entity_context.plan', 'Plan'],
    ['entity_context.design_doc', 'Design Doc'],
    ['entity_context.agent_session', 'Agent Session'],
    ['entity_context.work_item.standard', 'Task'],
    ['entity_context.work_item.feature', 'Feature'],
    ['entity_context.work_item.goal', 'Goal'],
    ['entity_context.work_item.bug', 'Bug'],
    ['entity_context.work_item.contract', 'Contract'],
    ['entity_context.work_item.task_monitor', 'Task Monitor'],
    ['entity_context.work_item.workflow', 'Workflow'],
    ['entity_context.work_item.workflow_step', 'Workflow Step'],
  ]);

  it('maps every supported selector to its canonical entity-kind heading', () => {
    for (const [templateKey, heading] of expectedHeadings) {
      expect(sql).toContain(`WHEN '${templateKey}' THEN '${heading}'`);
    }
    expect(sql.match(/WHEN 'entity_context\.[^']+' THEN '[^']+'/gu)).toHaveLength(12);
  });

  it('publishes a forward revision with readable Markdown sections', () => {
    expect(sql).toContain("SET lifecycle_state = 'RETIRED'");
    expect(sql).toContain('current_canonical.revision_number + 1');
    expect(sql).toContain("E'\\n\\n## ' || current_canonical.entity_kind_label");
    expect(sql).toContain("E'\\n\\n### Context identity:");
    expect(sql).toContain("E'\\n\\n### Related entities:");
    expect(sql).toContain("### Feature hierarchy:");
    expect(sql).toContain("### Proposals:");
    expect(sql).toContain("### Agent sessions:");
    expect(sql).toContain("'CANONICAL'");
    expect(sql).toContain("'PUBLISHED'");
    expect(sql).toContain("'VALID'");
  });

  it('uses the specific entity kind for every body label', () => {
    for (const heading of expectedHeadings.values()) {
      expect(sql).toContain(`${heading} body: {{entity.`);
    }
    expect(sql).not.toContain('Work Item body:');
  });
});
