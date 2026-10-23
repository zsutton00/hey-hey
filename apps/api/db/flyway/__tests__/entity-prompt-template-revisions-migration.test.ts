import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('V2026.08.18.7: entity prompt-template revisions', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../V2026.08.18.7__create_entity_prompt_template_revisions.sql',
    ),
    'utf8',
  );

  it('defines the unvalidated initial state and structured issue storage', () => {
    expect(sql).toContain("'UNVALIDATED'");
    expect(sql).toContain("jsonb_typeof(validation_issues) = 'array'");
    expect(sql).toContain('validation_issues JSONB NOT NULL');
    expect(sql).toContain('selector JSONB NOT NULL');
    expect(sql).toContain("syntax_version = 'V1'");
  });

  it('enforces project ownership and one published revision per scope', () => {
    expect(sql).toContain('entity_prompt_template_revisions_scope_owner_check');
    expect(sql).toContain(
      'entity_prompt_template_revisions_canonical_published_key',
    );
    expect(sql).toContain(
      'entity_prompt_template_revisions_project_published_key',
    );
    expect(sql).toContain(
      'FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
    );
  });

  it('keeps content validation aligned with the OpenAPI minimum length', () => {
    expect(sql).toContain('content TEXT NOT NULL CHECK (length(content) > 0)');
    expect(sql).not.toContain('length(btrim(content))');
  });

  it('seeds every canonical selector with context-bearing content', () => {
    for (const selector of [
      'PROJECT',
      'PLAN',
      'DESIGN_DOC',
      'AGENT_SESSION',
      'STANDARD',
      'FEATURE',
      'GOAL',
      'BUG',
      'WORKFLOW',
      'WORKFLOW_STEP',
    ]) {
      expect(sql).toContain(selector);
    }
    expect((sql.match(/'CANONICAL', 'PUBLISHED', 'VALID'/g) ?? []).length).toBe(
      10,
    );
    expect(sql).toContain('{{entity.id}}');
    expect(sql).toContain('{{context.projectId}}');
  });
});
