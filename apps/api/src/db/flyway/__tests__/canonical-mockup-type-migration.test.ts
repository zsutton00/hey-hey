import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.09.17.1__register_canonical_mockup_type.sql',
  ),
  'utf8',
);

describe('canonical Mockup work-item type migration', () => {
  it('contains the complete staging definition under the canonical lowercase identity', () => {
    expect(migrationSql).toContain('INSERT INTO work_item_type_template');
    expect(migrationSql).toContain("'mockup',\n  'Mockup',\n  'project-info',");
    expect(migrationSql).toContain(
      'Houses reviewable static interface previews for new interfaces and interface changes.',
    );
    expect(migrationSql).toContain(
      '[{"key":"purpose","kind":"markdown","label":"Purpose"',
    );
    expect(migrationSql).toContain(
      '{"key":"mockup","kind":"html/css","label":"Mockup"',
    );
    expect(migrationSql).toContain(
      '{"key":"requirements","kind":"markdown","label":"Requirements"',
    );
    expect(migrationSql).toContain(
      '"key":"desktop","label":"Desktop","breakpoints":[{"page":{"width":1440,"height":900},"inline":{"width":1440,"height":900}',
    );
    expect(migrationSql).toContain(
      '"key":"tablet","label":"Tablet","breakpoints":[{"page":{"width":768,"height":1024},"inline":{"width":768,"height":1024}',
    );
    expect(migrationSql).toContain(
      '"key":"mobile","label":"Mobile","breakpoints":[{"page":{"width":390,"height":844},"inline":{"width":390,"height":844}',
    );
    expect(migrationSql).toContain('"defaultSizeKey":"desktop"');
    expect(migrationSql).toContain('\'["FEATURE","STANDARD"]\'::jsonb');
    expect(migrationSql).toContain(
      '"targetTypeKeys":["FEATURE","STANDARD","mockup"]',
    );
    expect(migrationSql).toContain(
      '\'["BACKLOG","ACTIVE","READY","ARCHIVED"]\'::jsonb',
    );
    expect(migrationSql).toContain(
      '\'{"allowedParentEntityTypes":["TASK"]}\'::jsonb',
    );
    expect(migrationSql).toContain('\'["BACKLOG","ACTIVE"]\'::jsonb');
    expect(migrationSql).toContain(
      '"requiresParent":true,"planEligible":false,"hasSetInitialStatus":true,"rendersInline":true,"showsInExplorerSidebar":false',
    );
    expect(migrationSql).toContain('New Mockup items must be attached');
    expect(migrationSql).toContain('Keep the three sections, their order');
    expect(migrationSql).not.toMatch(/mockups_v2|MockupsV2|\bMOCKUP\b/);
  });

  it('inserts only when the lowercase key is absent from both registry sources', () => {
    expect(migrationSql).toMatch(
      /WHERE NOT EXISTS \(\s*SELECT 1\s+FROM work_item_type_template\s+WHERE type_key = 'mockup'\s*\)/s,
    );
    expect(migrationSql).toMatch(
      /AND NOT EXISTS \(\s*SELECT 1\s+FROM work_item_type\s+WHERE type_key = 'mockup'\s*\)/s,
    );
    expect(migrationSql).not.toMatch(/^\s*(?:UPDATE|DELETE|RAISE)\b/im);
    expect(migrationSql).not.toMatch(/ON\s+CONFLICT/i);
    expect(migrationSql).not.toContain('work_item_type (');
  });
});
