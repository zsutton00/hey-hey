import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('V2026.08.18.7: entity prompt-template revisions', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.08.18.7__create_entity_prompt_template_revisions.sql',
    ),
    'utf8',
  );

  it('runs the migration assertions under the normal Jest root', () => {
    expect(sql).toContain(
      'ALTER TYPE "target_entity_type" ADD VALUE IF NOT EXISTS \'ENTITY_PROMPT_TEMPLATE\'',
    );
    expect(sql).toContain('selector JSONB NOT NULL');
    expect(sql).toContain("syntax_version = 'V1'");
    expect(sql).toContain('content TEXT NOT NULL CHECK (length(content) > 0)');
    expect((sql.match(/'CANONICAL', 'PUBLISHED', 'VALID'/g) ?? []).length).toBe(
      10,
    );
    expect(sql).toContain('{{entity.id}}');
    expect(sql).toContain('{{context.projectId}}');
  });
});
