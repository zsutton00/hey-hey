import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateEntityPromptTemplateContent } from '../../../services/entity-prompt-template.service';
import { WORK_ITEM_TYPE_KEYS } from '../../../services/tasks/work-item-type-keys';

const flywayFile = (name: string) =>
  readFileSync(resolve(__dirname, '../../../../db/flyway', name), 'utf8');

describe('V2026.10.19.200000: register canonical Eval and Eval Case types', () => {
  const sql = flywayFile(
    'V2026.10.19.200000__register_canonical_eval_and_eval_case_types.sql',
  );
  const insertFor = (key: string) =>
    sql
      .split(/(?=INSERT INTO work_item_type_template)/u)
      .find((statement) => statement.includes(`\n  '${key}',\n`));

  it('inserts exactly one definition per key, guarded against existing rows', () => {
    for (const key of [
      WORK_ITEM_TYPE_KEYS.Eval,
      WORK_ITEM_TYPE_KEYS.EvalCase,
    ]) {
      const insert = insertFor(key);
      expect(insert).toBeDefined();
      expect(insert).toContain(
        `WHERE NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = '${key}')`,
      );
      expect(insert).toContain(
        `AND NOT EXISTS (SELECT 1 FROM work_item_type WHERE type_key = '${key}')`,
      );
    }
    expect(
      (sql.match(/INSERT INTO work_item_type_template/gu) ?? []).length,
    ).toBe(2);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE)\b/u);
    expect(sql).not.toContain('EVAL_SCENARIO');
  });

  it('places an Eval beneath a Feature as a work item', () => {
    const insert = insertFor(WORK_ITEM_TYPE_KEYS.Eval) ?? '';
    expect(insert).toContain("'Eval',\n  'work-item',");
    expect(insert).toContain(`'["FEATURE"]'::jsonb`);
    expect(insert).toContain('"requiresParent":true');
  });

  it('places an Eval Case beneath an Eval with the full case shape', () => {
    const insert = insertFor(WORK_ITEM_TYPE_KEYS.EvalCase) ?? '';
    expect(insert).toContain("'Eval Case',\n  'project-info',");
    expect(insert).toContain(`'["EVAL"]'::jsonb`);
    expect(insert).toContain('"requiresParent":true');
    for (const section of [
      'situation',
      'request',
      'items',
      'handler',
      'expectations',
      'checks',
      'rubric',
      'evidence',
    ]) {
      expect(insert).toContain(`{"key":"${section}","kind":"markdown"`);
    }
  });
});

describe('V2026.10.19.200100: publish canonical Eval entity prompt templates', () => {
  const sql = flywayFile(
    'V2026.10.19.200100__publish_canonical_eval_entity_prompt_templates.sql',
  );
  const inserts = sql.split(
    /(?=INSERT INTO entity_prompt_template_revisions)/u,
  );

  it.each([
    ['entity_context.work_item.eval', WORK_ITEM_TYPE_KEYS.Eval, 'Eval'],
    [
      'entity_context.work_item.eval_case',
      WORK_ITEM_TYPE_KEYS.EvalCase,
      'Eval Case',
    ],
  ])(
    'publishes one idempotent canonical V1 revision for %s',
    (templateKey, typeKey, heading) => {
      const insert = inserts.find((statement) =>
        statement.includes(`'${templateKey}',\n  '{`),
      );
      expect(insert).toBeDefined();
      expect(insert).toContain(
        `'{"entityType":"WORK_ITEM","workItemTypeKey":"${typeKey}"}'::jsonb`,
      );
      expect(insert).toMatch(
        new RegExp(
          `WHERE NOT EXISTS \\(\\s*SELECT 1\\s*FROM entity_prompt_template_revisions\\s*WHERE template_key = '${templateKey}'\\s*AND ownership_scope = 'CANONICAL'\\s*AND lifecycle_state = 'PUBLISHED'`,
          'u',
        ),
      );
      const content = (
        /\+ 1,\s*E'([^']+)'/u.exec(insert ?? '')?.[1] ?? ''
      ).replace(/\\n/gu, '\n');
      expect(content).toContain(`\n## ${heading}\n`);
      expect(validateEntityPromptTemplateContent(content, 'V1')).toEqual([]);
    },
  );

  it('leaves project-owned revisions untouched', () => {
    expect(sql).not.toMatch(/\b(UPDATE|DELETE)\b/u);
    expect(sql).not.toContain("'PROJECT'");
  });
});
