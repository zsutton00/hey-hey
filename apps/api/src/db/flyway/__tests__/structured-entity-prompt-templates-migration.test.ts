import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from '../../../generated/entity-prompt-template-language';
import { validateEntityPromptTemplateContent } from '../../../services/entity-prompt-template.service';

describe('V2026.09.03.1: structured entity prompt-template publication', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.09.03.2__publish_structured_entity_prompt_templates.sql',
    ),
    'utf8',
  );
  const canonicalContents = [...sql.matchAll(/'V1',\s*\d+,\s*'([^']+)'/gu)].map(
    (match) => match[1] ?? '',
  );

  it('retires the prior canonical publication and publishes one revision per selector', () => {
    expect(sql).toContain("SET lifecycle_state = 'RETIRED'");
    expect(sql).toContain("AND lifecycle_state = 'PUBLISHED'");
    expect(canonicalContents).toHaveLength(12);
    expect(
      (sql.match(/'CANONICAL',\s*'PUBLISHED',\s*'VALID'/g) ?? []).length,
    ).toBe(12);
  });

  it('publishes content accepted by the generated V1 validator and using every structured identifier', () => {
    for (const content of canonicalContents) {
      expect(validateEntityPromptTemplateContent(content, 'V1')).toEqual([]);
    }

    for (const path of [
      'entity.sections',
      'context.relatedEntities',
      'context.featureHierarchy',
      'context.proposals',
      'context.agentSessions',
    ]) {
      expect(ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1.supportedPaths).toContain(
        path,
      );
      expect(sql).toContain(`{{${path}}}`);
    }
  });
});
