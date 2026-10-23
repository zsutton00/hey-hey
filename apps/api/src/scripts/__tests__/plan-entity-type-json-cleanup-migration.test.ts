import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    __dirname,
    '../../../db/flyway/V2026.09.11.9__normalize_plan_entity_types_in_work_item_definitions.sql',
  ),
  'utf8',
);

describe('Plan EntityType JSON cleanup migration', () => {
  it.each(['work_item_type_template', 'work_item_type'])(
    'normalizes parentage and tracking arrays in %s',
    (table) => {
      const statements = migration.match(
        new RegExp(`UPDATE ${table}\\n[\\s\\S]*?;`, 'g'),
      );
      expect(statements).toHaveLength(2);
      expect(statements?.[0]).toContain('allowedParentEntityTypes');
      expect(statements?.[1]).toContain('allowedSourceEntityTypes');
    },
  );

  it('maps every retired Plan entity type to TASK and deduplicates by mapped value', () => {
    for (const legacyType of ['PLAN', 'PLAN_STAGE', 'PLAN_STEP']) {
      expect(migration).toContain(`WHEN '${legacyType}' THEN 'TASK'`);
    }
    expect(migration).toContain('GROUP BY mapped.value');
    expect(migration).toContain('ORDER BY normalized.first_ordinal');
  });

  it('does not rewrite subtype-valued arrays', () => {
    expect(migration).not.toContain("'{allowedParentTypes}'");
    expect(migration).not.toContain("'{allowedSourceTaskTypes}'");
  });

  it('fails if a retired value remains on either EntityType axis', () => {
    expect(migration).toContain(
      'Retired Plan entity types remain in persisted work-item type EntityType arrays',
    );
    for (const field of [
      'allowedParentEntityTypes',
      'allowedSourceEntityTypes',
    ]) {
      expect(migration).toContain(
        `$.${field}[*] ? (@ == \"PLAN\" || @ == \"PLAN_STAGE\" || @ == \"PLAN_STEP\")`,
      );
    }
  });
});
