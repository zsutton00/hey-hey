import { describe, expect, it } from 'vitest';
import { buildImplementPrompt } from '../prompts';
import { implementationResponsibility } from '../../prompts/knowledge-responsibilities';

describe('buildImplementPrompt', () => {
  it('composes whole-result verification after the work rules without changing the scope', () => {
    const prompt = buildImplementPrompt();
    expect(prompt).toContain(implementationResponsibility);
    expect(prompt.indexOf(implementationResponsibility)).toBeGreaterThan(
      prompt.indexOf('## How to work'),
    );
    expect(prompt.indexOf(implementationResponsibility)).toBeLessThan(
      prompt.indexOf('## Read and maintain graph Hints'),
    );
    expect(prompt).toContain('Do not expand its scope or substitute a different approach.');
    expect(prompt).toMatchSnapshot();
  });

  it('instructs selective location annotation on report decisions', () => {
    const result = buildImplementPrompt();
    expect(result).toContain('location');
    expect(result).toContain('startLine');
    expect(result).toContain('endLine');
    expect(result).toContain('1–3 decisions per run');
    expect(result).toContain('do not attach a `location` to every decision');
  });

  it('carries approved project-context findings into completion reconciliation', () => {
    const result = buildImplementPrompt({
      approvedPlan:
        '## Supporting planning discussion\n{"category":"project_context","findingId":"doc-update","disposition":"changes_existing_behavior"}',
    });
    expect(result).toContain('"findingId":"doc-update","disposition":"changes_existing_behavior"');
    expect(result).toContain('each project-context finding and its current disposition');
    expect(result).toContain('Check each relevant finding against its cited governing context');
    expect(result).toContain('suggest_feature_verification');
    expect(result).toContain('affected Feature, and impacted entities');
    expect(result).toContain('exactly one visible disposition');
    expect(result).toContain('state the evidence in your completion message');
    expect(result).toContain('is not raising it');
    expect(result).toContain('clears only what it actually updated');
    expect(result).toContain('never reopens implementation readiness');
  });

  it('reads graph Hints at session start and records relevant implementation learning before the report', () => {
    const result = buildImplementPrompt();
    expect(result).toContain('At the start of this session');
    expect(result).toContain('get_hints_for_items');
    expect(result).toContain('relevant user IDs when supplied');
    expect(result).toContain('create_hint');
    expect(result).toContain('add_hint_connection');
    expect(result).toContain('delete_hint');
    expect(result.indexOf('## Read and maintain graph Hints')).toBeLessThan(
      result.indexOf('## Persist an IMPLEMENT report'),
    );
  });
});
