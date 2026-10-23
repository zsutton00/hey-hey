import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.09.19.1__add_canonical_mockup_visual_reference_guidance.sql',
  ),
  'utf8',
);

describe('canonical Mockup visual-reference guidance migration', () => {
  it('updates only the canonical Mockup authoring standards', () => {
    expect(migrationSql).toContain('UPDATE "work_item_type_template"');
    expect(migrationSql).toContain('SET "writing_standards" =');
    expect(migrationSql).toContain("'{create}'");
    expect(migrationSql).toContain("'{edit}'");
    expect(migrationSql).toContain('COALESCE(template."writing_standards"');
    expect(migrationSql).toContain('"updated_at" = CURRENT_TIMESTAMP');
    expect(migrationSql).toContain(
      'WHERE template."type_key" = \'mockup\'',
    );
    expect(migrationSql).not.toContain('agent_guidance');
    expect(migrationSql).not.toContain('UPDATE "work_item_type"');
    expect(migrationSql).not.toContain('INSERT INTO');
    expect(migrationSql).not.toContain('DELETE FROM');
  });

  it('requires viewable user-provided visuals before Mockup creation or editing', () => {
    expect(migrationSql).toContain(
      'Before creating or editing a Mockup that depends on a user-provided visual',
    );
    expect(migrationSql).toContain(
      'report the viewing limitation first and do not create or edit the Mockup',
    );
    expect(migrationSql).toContain(
      'until the visual is accessible or the request no longer depends on it',
    );
  });

  it('fails clearly when the canonical template is missing', () => {
    expect(migrationSql).toContain('IF NOT EXISTS (');
    expect(migrationSql).toContain(
      'Cannot add Mockup visual-reference guidance; canonical Mockup template is missing',
    );
  });
});
