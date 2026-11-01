import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.10.27.070000__drop_work_item_type_agent_guidance.sql',
  ),
  'utf8',
);
const prismaSchema = readFileSync(
  resolve(process.cwd(), 'prisma/schema.prisma'),
  'utf8',
);

describe('drop work-item type agent guidance migration', () => {
  it('drops semantic guidance from canonical and project-owned definitions', () => {
    expect(sql).toContain(
      'ALTER TABLE work_item_type DROP COLUMN agent_guidance;',
    );
    expect(sql).toContain(
      'ALTER TABLE work_item_type_template DROP COLUMN agent_guidance;',
    );
  });

  it('rewrites the published MODE fallback sentences to the STANDARD default', () => {
    const published = readFileSync(
      resolve(
        process.cwd(),
        'db/flyway/V2026.10.16.090000__correct_mode_eligibility_guidance_and_feature_edge.sql',
      ),
      'utf8',
    );
    for (const name of ['settings', 'create', 'edit']) {
      const stale = sql.match(
        new RegExp(`${name}_stale constant text := '((?:[^']|'')*)';`),
      )?.[1];
      const current = sql.match(
        new RegExp(`${name}_current constant text := '((?:[^']|'')*)';`),
      )?.[1];
      expect(stale).toBeDefined();
      expect(published).toContain(stale!);
      expect(current).toContain('STANDARD');
      expect(current).not.toContain('agentGuidance');
    }
    expect(sql).toContain("WHERE mode.type_key = 'MODE'");
    expect(sql).not.toContain('UPDATE work_item_type ');
  });

  it('leaves session-role and maintenance guidance in place', () => {
    expect(sql).not.toMatch(/session_role_guidance|maintenance_guidance/);
    expect(prismaSchema).not.toContain('agent_guidance');
    expect(prismaSchema.match(/@map\("session_role_guidance"\)/g)).toHaveLength(
      2,
    );
    expect(prismaSchema.match(/@map\("maintenance_guidance"\)/g)).toHaveLength(
      2,
    );
  });
});
