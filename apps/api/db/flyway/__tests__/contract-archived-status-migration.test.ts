import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    __dirname,
    '../V2026.10.27.100100__allow_archiving_canonical_contracts.sql',
  ),
  'utf8',
);

describe('Canonical CONTRACT archive migration', () => {
  it('adds ARCHIVED to the canonical CONTRACT lifecycle and agent-settable list', () => {
    expect(sql).toMatch(
      /UPDATE work_item_type_template\s+SET allowed_statuses = allowed_statuses \|\| '\["ARCHIVED"\]'::jsonb/,
    );
    expect(sql).toContain('SET agent_settable_statuses = allowed_statuses');
    expect(sql).toContain("WHERE type_key = 'CONTRACT'");
  });

  it('leaves stored project overrides untouched', () => {
    expect(sql).not.toMatch(/UPDATE\s+work_item_type\b(?!_template)/);
  });

  it('fails if CONTRACT still cannot be archived by agents', () => {
    expect(sql).toContain(
      "RAISE EXCEPTION 'Canonical CONTRACT does not allow agents to propose ARCHIVED'",
    );
  });
});
