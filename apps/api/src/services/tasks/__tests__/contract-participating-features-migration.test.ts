import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.18.1__link_contract_participating_features.sql',
);

describe('Contract participating-features migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('updates only canonical Contract writing standards and their timestamp', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain(`WHERE "type_key" = 'CONTRACT'`);
    expect(sql).toContain('"writing_standards" = jsonb_set(');
    expect(sql).toContain('"updated_at" = CURRENT_TIMESTAMP');
    expect(sql).not.toContain('UPDATE "work_item_type"\n');
    expect(sql).not.toContain('SET "description"');
  });

  it('fails fast when the canonical Contract template is missing', () => {
    expect(sql).toContain('IF NOT EXISTS (');
    expect(sql).toContain(
      'Cannot update Contract feature-participation guidance; canonical Contract template is missing',
    );
  });

  it('uses the structural parent for ownership and RELATED_TO for direct non-parent participants', () => {
    expect(sql).toContain(
      "The structural feature parent records the Contract's owning feature; do not duplicate that ownership with a `RELATED_TO` edge.",
    );
    expect(sql).toContain(
      'declare `RELATED_TO` for every other feature directly evidenced as providing, consuming, or enforcing the promised behavior',
    );
    expect(sql).toContain(
      'parent the Contract to Configuration without a duplicate feature edge and declare Contract `RELATED_TO` Agents',
    );
  });

  it('keeps workflow-step dependencies and prose mentions semantically separate', () => {
    expect(sql).toContain(
      'Keep this feature participation separate from `workflow_step DEPENDS_ON Contract`',
    );
    expect(sql).toContain(
      'Prose mentions are navigation only and do not create either parentage or an edge',
    );
    expect(sql).toContain(
      'Mentions remain navigation and never materialize parentage, feature participation, or `workflow_step DEPENDS_ON Contract`',
    );
  });

  it('excludes ancestors, incidental implementation, and downstream fan-out', () => {
    expect(sql).toContain(
      'Do not automatically link ancestor features, incidental implementation features, every downstream feature',
    );
    expect(sql).toContain(
      'A storage feature merely used by the implementation receives no Contract edge',
    );
    expect(sql).toContain(
      'reserve feature-level `DEPENDS_ON` for a separately evidenced delivery dependency',
    );
  });
});
