import { readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../V2026.08.10.1__remove_redundant_work_item_parentage_capabilities.sql',
);

describe('redundant work-item parentage capabilities migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it('removes both retired keys from canonical definitions', () => {
    expect(sql).toContain('UPDATE work_item_type_template');
    expect(sql).toContain(
      "capabilities = capabilities - 'canHaveParent' - 'canHaveChildren'",
    );
  });

  it('removes both retired keys from complete project definitions', () => {
    expect(sql).toContain('UPDATE work_item_type\n');
    expect(sql.match(/WHERE capabilities \?\| ARRAY/g)).toHaveLength(2);
  });

  it('does not rewrite the surviving parentage axes', () => {
    expect(sql).not.toContain('allowed_parent_types');
    expect(sql).not.toContain('allowedParentEntityTypes');
    expect(sql).not.toContain("- 'requiresParent'");
  });
});
