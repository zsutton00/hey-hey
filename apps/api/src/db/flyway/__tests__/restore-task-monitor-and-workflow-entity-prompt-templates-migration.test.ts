import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateEntityPromptTemplateContent } from '../../../services/entity-prompt-template.service';
import { WORK_ITEM_TYPE_KEYS } from '../../../services/tasks/work-item-type-keys';

describe('V2026.09.01.2: restore Task Monitor and Workflow entity prompt templates', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.09.01.2__restore_task_monitor_and_workflow_entity_prompt_templates.sql',
    ),
    'utf8',
  );
  const canonicalContents = [...sql.matchAll(/'V1',\s*\d+,\s*'([^']+)'/gu)].map(
    (match) => match[1] ?? '',
  );

  it('retires only the legacy Workflow publication', () => {
    expect(sql).toContain("SET lifecycle_state = 'RETIRED'");
    expect(sql).toContain(
      "WHERE template_key = 'entity_context.work_item.workflow'",
    );
    expect((sql.match(/SET lifecycle_state = 'RETIRED'/g) ?? []).length).toBe(
      1,
    );
  });

  it('publishes canonical Task Monitor and Workflow selectors using registry keys', () => {
    expect(sql).toContain(
      `'entity_context.work_item.task_monitor',\n    '{"entityType":"WORK_ITEM","workItemTypeKey":"${WORK_ITEM_TYPE_KEYS.TaskMonitor}"}'::jsonb`,
    );
    expect(sql).toContain(
      `'entity_context.work_item.workflow',\n    '{"entityType":"WORK_ITEM","workItemTypeKey":"${WORK_ITEM_TYPE_KEYS.Workflow}"}'::jsonb`,
    );
    expect(
      (sql.match(/'CANONICAL',\s*'PUBLISHED',\s*'VALID'/g) ?? []).length,
    ).toBe(2);
  });

  it('uses only V1 paths accepted by the runtime validator', () => {
    expect(canonicalContents).toHaveLength(2);
    for (const content of canonicalContents) {
      expect(validateEntityPromptTemplateContent(content, 'V1')).toEqual([]);
    }
  });
});
