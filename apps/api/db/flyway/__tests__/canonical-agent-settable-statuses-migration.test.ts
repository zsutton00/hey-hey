import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    __dirname,
    '../V2026.10.27.100000__canonical_agent_settable_statuses_match_allowed.sql',
  ),
  'utf8',
);

describe('Canonical agent-settable statuses migration', () => {
  it('sets every canonical template agent-settable list to its allowed statuses', () => {
    expect(sql).toMatch(
      /UPDATE work_item_type_template\s+SET agent_settable_statuses = allowed_statuses/,
    );
  });

  it('leaves stored project overrides and custom types untouched', () => {
    expect(sql).not.toMatch(/UPDATE\s+work_item_type\b(?!_template)/);
    expect(sql).not.toMatch(/(INSERT INTO|DELETE FROM)\s+work_item_type\b/);
  });

  it('fails if any canonical template still differs', () => {
    expect(sql).toContain(
      "RAISE EXCEPTION 'Canonical agent-settable statuses do not match allowed statuses'",
    );
  });
});
