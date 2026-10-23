import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('V2026.08.08.1: canonical project overrides', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../V2026.08.08.1__replace_canonical_revisions_with_project_overrides.sql',
    ),
    'utf8',
  );

  it('classifies followers against their recorded revision before removing provenance', () => {
    expect(sql).toContain('b.revision = p.template_revision');
    expect(sql).toContain(
      'p.template_key IS NULL AND p.template_revision IS NOT NULL',
    );
    expect(sql).toContain('canonical.type_key = p.type_key');
    expect(sql).toContain('IS NOT DISTINCT FROM');
    expect(sql.indexOf('DELETE FROM work_item_type p')).toBeLessThan(
      sql.indexOf('DROP COLUMN template_key'),
    );
  });

  it('deletes only active exact followers and preserves divergent or archived rows', () => {
    expect(sql).toContain("p.lifecycle_status = 'active'");
    expect(sql).toContain('p.graph_configuration');
  });

  it('collapses the catalog to one canonical row per key', () => {
    expect(sql).toContain('historical.revision < newer.revision');
    expect(sql).toContain('UNIQUE (type_key)');
    expect(sql).toContain('DROP COLUMN revision');
  });
});
