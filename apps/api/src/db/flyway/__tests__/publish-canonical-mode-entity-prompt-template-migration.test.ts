import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateEntityPromptTemplateContent } from '../../../services/entity-prompt-template.service';
import { WORK_ITEM_TYPE_KEYS } from '../../../services/tasks/work-item-type-keys';

describe('V2026.09.30.120000: publish canonical MODE entity prompt template', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.09.30.120000__publish_canonical_mode_entity_prompt_template.sql',
    ),
    'utf8',
  );
  const canonicalContents = [...sql.matchAll(/\+ 1,\s*E'([^']+)'/gu)].map(
    (match) => (match[1] ?? '').replace(/\\n/gu, '\n'),
  );

  it('matches the canonical Markdown entity-context format', () => {
    expect(canonicalContents[0]).toContain('\n## Agent Mode\n');
    expect(canonicalContents[0]).toContain('### Context identity:');
    expect(canonicalContents[0]).toContain('### Agent sessions:');
  });

  it('publishes one canonical revision under the exact MODE selector', () => {
    expect(sql).toContain(
      `'entity_context.work_item.mode',\n  '{"entityType":"WORK_ITEM","workItemTypeKey":"${WORK_ITEM_TYPE_KEYS.Mode}"}'::jsonb`,
    );
    expect(
      (sql.match(/'CANONICAL',\s*'PUBLISHED',\s*'VALID'/g) ?? []).length,
    ).toBe(1);
  });

  it('is idempotent and leaves project-owned revisions untouched', () => {
    expect(sql).toMatch(
      /WHERE NOT EXISTS \(\s*SELECT 1\s*FROM entity_prompt_template_revisions\s*WHERE template_key = 'entity_context\.work_item\.mode'\s*AND ownership_scope = 'CANONICAL'\s*AND lifecycle_state = 'PUBLISHED'/u,
    );
    expect(sql).not.toMatch(/\b(UPDATE|DELETE)\b/u);
    expect(sql).not.toContain("'PROJECT'");
  });

  it('uses only V1 paths accepted by the runtime validator', () => {
    expect(canonicalContents).toHaveLength(1);
    expect(
      validateEntityPromptTemplateContent(canonicalContents[0] ?? '', 'V1'),
    ).toEqual([]);
  });
});
