import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateEntityPromptTemplateContent } from '../../../services/entity-prompt-template.service';
import { WORK_ITEM_TYPE_KEYS } from '../../../services/tasks/work-item-type-keys';

describe('V2026.09.01.1: restore Contract and workflow-step entity prompt templates', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.09.01.1__restore_contract_and_workflow_step_entity_prompt_templates.sql',
    ),
    'utf8',
  );
  const canonicalContents = [
    ...sql.matchAll(
      /'entity_context[^']*',\s*'[^']+'::jsonb,\s*'V1',\s*\d+,\s*'([^']+)'/gu,
    ),
  ].map((match) => match[1] ?? '');

  it('retires only the malformed workflow-step publication', () => {
    expect(sql).toContain("SET lifecycle_state = 'RETIRED'");
    expect(sql).toContain(
      "WHERE template_key = 'entity_context.work_item.workflow_step'",
    );
    expect((sql.match(/SET lifecycle_state = 'RETIRED'/g) ?? []).length).toBe(
      1,
    );
  });

  it('publishes canonical Contract and workflow-step selectors using registry keys', () => {
    expect(sql).toContain(
      `'entity_context.work_item.contract', '{"entityType":"WORK_ITEM","workItemTypeKey":"${WORK_ITEM_TYPE_KEYS.Contract}"}'::jsonb`,
    );
    expect(sql).toContain(
      `'entity_context.work_item.workflow_step', '{"entityType":"WORK_ITEM","workItemTypeKey":"${WORK_ITEM_TYPE_KEYS.WorkflowStep}"}'::jsonb`,
    );
    expect((sql.match(/'CANONICAL', 'PUBLISHED', 'VALID'/g) ?? []).length).toBe(
      2,
    );
  });

  it('uses only V1 paths accepted by the runtime validator', () => {
    expect(canonicalContents).toHaveLength(2);
    for (const content of canonicalContents) {
      expect(validateEntityPromptTemplateContent(content, 'V1')).toEqual([]);
    }
  });
});
