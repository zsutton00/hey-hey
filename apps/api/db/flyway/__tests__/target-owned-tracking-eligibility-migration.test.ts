import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('V2026.08.07.3.1: target-owned tracking eligibility', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../V2026.08.07.3.1__make_tracking_eligibility_target_owned.sql',
    ),
    'utf8',
  );

  it('preflights conflicting and unresolved project and template policy', () => {
    const firstUpdate = sql.indexOf('UPDATE work_item_type');
    expect(sql.indexOf('DO $migration$')).toBeLessThan(firstUpdate);
    expect(sql).toContain("tracking ? 'allowedSourceEntityTypes'");
    expect(sql).toContain('Unresolved project tracking type keys');
    expect(sql).toContain('Unresolved canonical-template tracking type keys');
    expect(sql).toContain("target_key <> 'PLAN'");
  });

  it('inverts task-target authorization and removes legacy capability input', () => {
    expect(sql).toContain("tracking->'allowedTargetTaskTypes'");
    expect(sql).toContain("tracking->'allowedTargetEntityTypes'");
    expect(sql).toContain("'allowedSourceEntityTypes'");
    expect(sql).toContain("'allowedSourceTaskTypes'");
    expect(sql).toContain("capabilities - 'canBeTrackedByGoals'");
    expect(sql).toContain('UPDATE work_item_type_template');
  });
});
