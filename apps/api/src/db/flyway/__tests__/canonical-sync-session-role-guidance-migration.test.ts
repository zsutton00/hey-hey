import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SessionRole } from '@hey-hey/contracts/api/models';

const readJson = (path: string) =>
  JSON.parse(readFileSync(resolve(__dirname, path), 'utf8'));
// Types that already carry the four-role matrix; the fixture is independent of any SQL.
const matrixKeys = Object.keys(
  readJson('fixtures/canonical-session-role-guidance.json'),
);
const sql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.11.20.055556__seed_canonical_sync_session_role_guidance.sql',
  ),
  'utf8',
);
const sync: Record<string, string> = JSON.parse(
  sql.match(/\$advice\$([\s\S]*?)\$advice\$/)![1]!,
);

describe('canonical sync session-role guidance migration', () => {
  it('gives sync advice to exactly the types that carry role guidance', () => {
    expect(SessionRole.Sync).toBe('sync');
    expect(Object.keys(sync).sort()).toEqual([...matrixKeys].sort());
    for (const text of Object.values(sync)) {
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('tells Mockup and Diagram work to offer updates on plausible impact without priority filtering', () => {
    for (const key of ['mockup', 'DIAGRAM']) {
      expect(sync[key]).toMatch(/plausible impact/i);
      expect(sync[key]).toMatch(/offer a reviewable/i);
      expect(sync[key]).toMatch(/do not filter by priority/i);
    }
  });

  it('treats Contract violations as high priority', () => {
    expect(sync.CONTRACT).toMatch(/high priority/i);
  });

  it('adds only the sync key and fails on missing templates', () => {
    const executable = sql
      .replace(/\$advice\$[\s\S]*?\$advice\$/, "''")
      .replace(/^--.*$/gm, '');
    expect(executable.match(/\bUPDATE\s+\w+/g)).toEqual([
      'UPDATE work_item_type_template',
    ]);
    expect(executable).not.toMatch(/\b(INSERT|DELETE|ALTER|CREATE)\b/i);
    expect(executable).toContain("'{sync}'");
    expect(executable).toContain('jsonb_set(');
    expect(executable).toContain('RAISE EXCEPTION');
    expect(executable.indexOf('RAISE EXCEPTION')).toBeLessThan(
      executable.indexOf('UPDATE work_item_type_template'),
    );
  });
});
