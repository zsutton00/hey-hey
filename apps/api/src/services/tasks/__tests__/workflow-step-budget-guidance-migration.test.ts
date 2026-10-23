import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.31.1__add_soft_workflow_step_budgets.sql',
);

describe('soft workflow step budget guidance migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const guidanceMatch = sql.match(
    /\$workflow_budget_guidance\$\n([\s\S]*?)\n\$workflow_budget_guidance\$/,
  );
  const guidance = guidanceMatch?.[1];

  it('updates only canonical workflow create and edit standards', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain(`"type_key" = 'workflow'`);
    expect(sql.match(/\|\| budget_guidance/g)).toHaveLength(2);
    expect(sql).not.toContain('UPDATE "work_item_type"');
    expect(sql).not.toContain(`"type_key" = 'workflow_step'`);
  });

  it('requires the abstraction guidance before appending the diagnostic', () => {
    expect(sql).toContain('## Purpose, boundary, and abstraction level');
    expect(sql).toContain(
      'canonical workflow abstraction guidance is missing',
    );
  });

  it('sets inclusive root and below-root boundaries', () => {
    expect(guidance).toContain(
      'soft maximum of 8 workflow_step children when the workflow is owned\ndirectly by the project or by a top-level feature',
    );
    expect(guidance).toContain(
      'soft maximum of 12\nwhen the workflow is below that root altitude',
    );
    expect(guidance).toContain(
      'Eight and twelve steps are\nwithin their respective budgets; the diagnostic begins at nine and thirteen',
    );
  });

  it('counts only authored workflow steps and excludes derived graph context', () => {
    expect(guidance).toContain('count\nonly its workflow_step children');
    expect(guidance).toContain('Do not count displayed Contract nodes');
    expect(guidance).toContain('flow\nedges, fulfillment links');
    expect(guidance).toContain('other derived graph context');
  });

  it('performs one silent reconsideration without blocking continuation', () => {
    expect(guidance).toContain('make one silent simplification\npass');
    expect(guidance).toContain("reconsider the workflow's altitude and boundary");
    expect(guidance).toContain('cited child workflow');
    expect(guidance).toContain('not schema validation or proposal admission');
    expect(guidance).toContain(
      'Do not block proposal creation or automatically ask the user',
    );
    expect(guidance).toContain('After that single reconsideration, continue');
  });

  it('preserves material workflow and Contract semantics above budget', () => {
    expect(guidance).toContain('materially distinct participants');
    expect(guidance).toContain('provider\nboundaries');
    expect(guidance).toContain('admissions, handoffs, failures');
    expect(guidance).toContain('enforcement points');
    expect(guidance).toContain('applicable\nContracts');
  });
});
