import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.29.2__teach_coherent_workflow_abstraction_levels.sql',
);

describe('coherent workflow abstraction guidance migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const guidanceMatch = sql.match(
    /\$workflow_guidance\$\n([\s\S]*?)\n\$workflow_guidance\$/,
  );
  const guidance = guidanceMatch?.[1];

  it('updates only the canonical workflow template', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain(`"type_key" = 'workflow'`);
    expect(sql).not.toContain('UPDATE "work_item_type"');
    expect(sql).not.toContain('"revision"');
    expect(sql).not.toContain(`"type_key" = 'workflow_step'`);
  });

  it('adds the same guidance to create and edit standards', () => {
    expect(sql.match(/\|\| abstraction_guidance/g)).toHaveLength(2);
    expect(sql).toContain("'create',");
    expect(sql).toContain("'edit',");
  });

  it('requires an explicit purpose, boundary, and coherent altitude', () => {
    expect(guidance).toContain(
      'system design, a\nuser journey, or an implementation lifecycle',
    );
    expect(guidance).toContain('state the process boundary');
    expect(guidance).toContain(
      'Keep every step at one coherent abstraction level',
    );
    expect(guidance).toContain('cited child workflow or supporting entity');
  });

  it('uses tree context as a default without making it a rigid formula', () => {
    expect(guidance).toContain('strong altitude default, not a rigid');
    expect(guidance).toContain('At a top-level product feature');
    expect(guidance).toContain('At a cross-feature or subsystem feature');
    expect(guidance).toContain('At a leaf technical feature');
    expect(guidance).toContain('At an implementation task');
    expect(guidance).toContain(
      'Cross-feature workflows belong at the nearest meaningful shared product',
    );
  });

  it('does not hide material participants or boundaries at higher altitude', () => {
    expect(guidance).toContain(
      'must not omit a materially different participant',
    );
    expect(guidance).toContain('provider boundary');
    expect(guidance).toContain('independent enforcement point');
    expect(guidance).toContain('failure outcome');
    expect(guidance).toContain('applicable Contract');
    expect(guidance).toContain(
      'A service reference does not replace a participant step',
    );
  });

  it('uses service ownership semantically and preserves Contract edge meaning', () => {
    expect(guidance).toContain(
      'Set a workflow_step serviceId when a known codebase',
    );
    expect(guidance).toContain(
      'Do not invent or require\ndecorative service ownership',
    );
    expect(guidance).toContain(
      'workflow_step DEPENDS_ON Contract\nonly for steps that author or enforce',
    );
    expect(guidance).toContain('including rejection\nsteps');
    expect(guidance).toContain('FULFILLED_BY implementation evidence');
  });
});
