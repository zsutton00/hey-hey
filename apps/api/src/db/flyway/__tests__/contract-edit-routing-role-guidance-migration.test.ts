import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.11.23.120000__contract_edit_routing_role_guidance.sql',
  ),
  'utf8',
);
const canonical = JSON.parse(
  readFileSync(
    resolve(__dirname, 'fixtures/canonical-session-role-guidance.json'),
    'utf8',
  ),
).CONTRACT as Record<string, string>;
const syncSeed: Record<string, string> = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'db/flyway/V2026.11.20.055556__seed_canonical_sync_session_role_guidance.sql',
    ),
    'utf8',
  ).match(/\$advice\$([\s\S]*?)\$advice\$/)![1]!,
);

describe('Contract edit routing role guidance migration', () => {
  it('extends only wording that still matches the canonical guidance', () => {
    expect(sql).toContain(canonical.research);
    expect(sql).toContain(canonical.implementation);
    expect(sql).toContain(syncSeed.CONTRACT);
    expect(sql).toContain('guidance->>role = canonical');
  });

  it('gives sync and implementation the separate-proposal rule', () => {
    const rule =
      'Propose a Contract content edit as a separate proposal that mentions the Contract, and surface any changed guarantee for the user to decide instead of transferring a promise yourself.';
    expect(sql.split(rule)).toHaveLength(3);
  });

  it('frames research as a finding without naming who edits', () => {
    expect(sql).toContain(
      'Report an affected Contract as a finding: the Contract, what it governs and why it is affected. A research handoff does not say who must edit it or how.',
    );
  });
});
