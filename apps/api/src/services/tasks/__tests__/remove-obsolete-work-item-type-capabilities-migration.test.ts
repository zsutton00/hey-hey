import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('V2026.08.09.2: remove obsolete work-item type capabilities', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.08.09.2__remove_obsolete_work_item_type_capabilities.sql',
    ),
    'utf8',
  );

  it.each([
    'canOwnReports',
    'canOwnAgentSessions',
    'supportsJsonSections',
    'participatesInFeatureHierarchy',
  ])('removes %s from every active definition source', (key) => {
    expect(sql.match(new RegExp(`- '${key}'`, 'g'))).toHaveLength(2);
  });

  it('repairs both project-owned definitions and canonical templates', () => {
    expect(sql).toContain('UPDATE work_item_type\n');
    expect(sql).toContain('UPDATE work_item_type_template\n');
  });
});
