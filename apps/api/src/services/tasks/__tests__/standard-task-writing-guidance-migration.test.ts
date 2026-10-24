import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  STANDARD_WRITING_GUIDANCE,
  createWarmWorkItemTypeRegistry,
} from '../../../../test/setup/work-item-type-registry.fixture';

const sql = readFileSync(
  resolve(
    __dirname,
    '../../../../db/flyway/V2026.10.24.062624__refocus_standard_task_writing_guidance.sql',
  ),
  'utf8',
);

function literal(tag: string): string {
  const delimiter = `$${tag}$`;
  const parts = sql.split(delimiter);
  expect(parts).toHaveLength(3);
  return parts[1]!;
}

describe('reviewable STANDARD writing guidance migration', () => {
  it('replaces only canonical STANDARD standards and preserves project overrides and other types', () => {
    expect(sql).toContain('UPDATE "work_item_type_template" AS template');
    expect(sql).toContain('WHERE template."type_key" = \'STANDARD\'');
    expect(sql).not.toContain('UPDATE "work_item_type"');
    expect(sql).toContain('IF NOT EXISTS (');
    expect(sql).toContain('canonical STANDARD template is missing');
    expect(sql).not.toContain('template."writing_standards"->>');
  });

  it('publishes the agreed block verbatim with no project-specific entity reference', () => {
    expect(literal('writing')).toBe(STANDARD_WRITING_GUIDANCE);
    expect(sql).not.toMatch(/@\[\w+:[0-9a-f-]{36}\|/i);
  });

  it.each(['create', 'edit'] as const)(
    'keeps %s fixtures faithful to the migrated canonical definition',
    async (mode) => {
      const registry = await createWarmWorkItemTypeRegistry();
      const migrated = [
        literal('writing'),
        literal(`${mode}_field`),
        literal('relationships'),
        literal('scope'),
      ].join('\n\n');
      expect(sql).toContain(
        `'${mode}', concat_ws(E'\\n\\n', guidance.writing, guidance.${mode}_field, guidance.relationships, guidance.scope)`,
      );
      expect(
        registry.getRulesForProject(
          'STANDARD',
          '123e4567-e89b-42d3-a456-426614174003',
        )!.writingStandards[mode],
      ).toBe(migrated);
    },
  );
});
