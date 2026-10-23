import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY,
  validateEntityPromptTemplateContent,
} from '../../../services/entity-prompt-template.service';
import { WORK_ITEM_TYPE_KEYS } from '../../../services/tasks/work-item-type-keys';

// Matches Postgres E'' literals including '' and backslash escapes, so content
// containing apostrophes is not silently truncated.
const ESCAPE_STRING_LITERAL = /\bE'((?:[^'\\]|\\.|'')*)'/gu;

const decodeEscapeString = (body: string): string =>
  body.replace(/''|\\(.)/gu, (match, escaped: string | undefined) => {
    if (match === "''") return "'";
    switch (escaped) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      default:
        return escaped ?? '';
    }
  });

describe('V2026.10.01.090000: publish canonical Diagram entity prompt templates', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.10.01.090000__publish_canonical_diagram_entity_prompt_templates.sql',
    ),
    'utf8',
  );
  const canonicalContents = [...sql.matchAll(ESCAPE_STRING_LITERAL)].map(
    (match) => decodeEscapeString(match[1] ?? ''),
  );
  const cases = [
    {
      templateKey: 'entity_context.work_item.diagram',
      typeKey: WORK_ITEM_TYPE_KEYS.Diagram,
      heading: '## Diagram\n',
      index: 0,
    },
    {
      templateKey: 'entity_context.work_item.diagram_element',
      typeKey: WORK_ITEM_TYPE_KEYS.DiagramElement,
      heading: '## Diagram Element\n',
      index: 1,
    },
  ] as const;

  it('decodes apostrophes and escapes in E-string literals', () => {
    expect(decodeEscapeString("it''s\\na\\\\b")).toBe("it's\na\\b");
  });

  it('publishes exactly one canonical revision per selector', () => {
    expect(canonicalContents).toHaveLength(2);
    expect(
      (sql.match(/'CANONICAL',\s*'PUBLISHED',\s*'VALID'/g) ?? []).length,
    ).toBe(2);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE)\b/u);
    expect(sql).not.toContain("'PROJECT'");
  });

  it.each(cases)(
    '$templateKey uses the catalog selector, guard, and Markdown format',
    ({ templateKey, typeKey, heading, index }) => {
      expect(ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY[templateKey]).toEqual({
        entityType: 'WORK_ITEM',
        workItemTypeKey: typeKey,
      });
      expect(sql).toContain(
        `'${templateKey}',\n  '{"entityType":"WORK_ITEM","workItemTypeKey":"${typeKey}"}'::jsonb`,
      );
      expect(sql).toContain(
        `WHERE template_key = '${templateKey}'\n    AND ownership_scope = 'CANONICAL'\n    AND lifecycle_state = 'PUBLISHED'`,
      );
      const content = canonicalContents[index] ?? '';
      expect(content.startsWith(`\n\n${heading}`)).toBe(true);
      for (const section of [
        '### Context identity:',
        '### Related entities:',
        '### Feature hierarchy:',
        '### Proposals:',
        '### Agent sessions:',
      ]) {
        expect(content).toContain(section);
      }
      expect(validateEntityPromptTemplateContent(content, 'V1')).toEqual([]);
    },
  );
});
