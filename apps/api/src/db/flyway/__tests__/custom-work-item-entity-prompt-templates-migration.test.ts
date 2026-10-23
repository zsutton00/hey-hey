import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('custom work-item entity prompt-template migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../../db/flyway/V2026.09.08.4__seed_custom_work_item_entity_prompt_templates.sql',
    ),
    'utf8',
  );

  it('seeds only active custom types missing an exact valid publication', () => {
    expect(sql).toContain("wit.lifecycle_status = 'active'");
    expect(sql).toContain('canonical_type.id IS NULL');
    expect(sql).toContain("existing.lifecycle_state = 'PUBLISHED'");
    expect(sql).toContain("existing.validation_status = 'VALID'");
    expect(sql).toContain("existing.selector = jsonb_build_object(");
    expect(sql).toContain("'entity_context.work_item.' || lower(wit.type_key)");
  });

  const repairSql = readFileSync(
    join(
      __dirname,
      '../../../../db/flyway/V2026.09.08.5__repair_skipped_work_item_entity_prompt_templates.sql',
    ),
    'utf8',
  );

  it('prefers the project STANDARD publication and persists exact provenance', () => {
    expect(sql).toContain(
      "source.template_key = 'entity_context.work_item.standard'",
    );
    expect(sql).toContain(
      "CASE source.ownership_scope WHEN 'PROJECT' THEN 0 ELSE 1 END",
    );
    expect(sql).toContain("'workItemTypeKey', source.type_key");
    expect(sql).toContain('source.validated_at');
    expect(sql).toContain('source.validator_version');
  });

  it('retires a conflicting publication before inserting the repair', () => {
    expect(sql).toContain('retired_conflicting_publications AS (');
    expect(sql).toContain("SET lifecycle_state = 'RETIRED'");
    expect(sql).toContain('published_at = NULL');
  });

  it('repairs active types skipped only because they have a canonical type definition', () => {
    expect(repairSql).not.toContain(
      'LEFT JOIN work_item_type_template canonical_type',
    );
    expect(repairSql).toContain(
      'LEFT JOIN entity_prompt_template_revisions canonical_prompt',
    );
    expect(repairSql).toContain('canonical_prompt.id IS NULL');
    expect(repairSql).toContain("wit.lifecycle_status = 'active'");
    expect(repairSql).toContain("'workItemTypeKey', candidate.type_key");
  });
});
