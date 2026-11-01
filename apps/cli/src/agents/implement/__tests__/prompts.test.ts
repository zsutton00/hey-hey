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
