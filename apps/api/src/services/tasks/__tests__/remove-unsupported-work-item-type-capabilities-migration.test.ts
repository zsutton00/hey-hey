import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('V2026.08.11.1: remove unsupported work-item type capabilities', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.08.11.1__remove_unsupported_work_item_type_capabilities.sql',
    ),
    'utf8',
  );

  it.each([
    'supportsDesignDocs',
    'requiresFeatureParent',
    'canHaveImplementationTasks',
  ])('removes %s from every effective definition source', (key) => {
    expect(sql.match(new RegExp(`- '${key}'`, 'g'))).toHaveLength(2);
  });

  it('repairs both project-owned definitions and canonical templates', () => {
    expect(sql).toContain('UPDATE work_item_type\n');
    expect(sql).toContain('UPDATE work_item_type_template\n');
  });
});
