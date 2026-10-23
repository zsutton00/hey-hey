import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from '../../../generated/entity-prompt-template-language';
import { validateEntityPromptTemplateContent } from '../../../services/entity-prompt-template.service';

describe('V2026.08.31.2: canonical entity prompt-template repair', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.08.31.2__repair_canonical_entity_prompt_templates.sql',
    ),
    'utf8',
  );
  const canonicalContents = [
    ...sql.matchAll(
      /'entity_context[^']*',\s*'[^']+'::jsonb,\s*'V1',\s*2,\s*'([^']+)'/gu,
    ),
  ].map((match) => match[1] ?? '');

  it('retires the prior publication and publishes one new revision per canonical selector', () => {
    expect(sql).toContain("SET lifecycle_state = 'RETIRED'");
    expect(sql).toContain("AND lifecycle_state = 'PUBLISHED'");
    expect(canonicalContents).toHaveLength(10);
    expect((sql.match(/'CANONICAL', 'PUBLISHED', 'VALID'/g) ?? []).length).toBe(
      10,
    );
  });

  it('uses only generated V1 paths accepted by the runtime validator', () => {
    for (const content of canonicalContents) {
      expect(validateEntityPromptTemplateContent(content, 'V1')).toEqual([]);
    }
    expect(sql).not.toContain('{{context.projectId}}');
    expect(sql).not.toContain('{{session.id}}');
    expect(ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1.supportedPaths).toContain(
      'context.entityId',
    );
  });
});
