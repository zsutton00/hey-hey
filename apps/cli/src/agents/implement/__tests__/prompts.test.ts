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
      prompt.indexOf('## Maintain Memory'),
    );
    expect(prompt).toContain('Do not expand its scope or substitute a different approach.');
    expect(prompt).toMatchSnapshot();
  });

  it('includes the maintain-Memory instruction with all three hint operations', () => {
    const result = buildImplementPrompt();
    expect(result).toContain('## Maintain Memory');
    expect(result).toContain('create_implementation_hint');
    expect(result).toContain('edit_implementation_hint');
    expect(result).toContain('delete_implementation_hint');
    expect(result).toContain('non-obvious');
  });

  it('frames Memory as a search target peers query via search_implementation_hints at start of work', () => {
    const result = buildImplementPrompt();
    expect(result).toContain('search_implementation_hints');
    expect(result).toContain('serviceId');
    expect(result).toContain('start of work');
    expect(result).not.toContain('prepends every session');
  });

  it('instructs selective location annotation on report decisions', () => {
    const result = buildImplementPrompt();
    expect(result).toContain('location');
    expect(result).toContain('startLine');
    expect(result).toContain('endLine');
    expect(result).toContain('1–3 decisions per run');
    expect(result).toContain('do not attach a `location` to every decision');
  });

  it('places the maintain-Memory section between the how-to-work and IMPLEMENT-report sections', () => {
    const result = buildImplementPrompt();
    const howToWorkIdx = result.indexOf('## How to work');
    const memoryIdx = result.indexOf('## Maintain Memory');
    const reportIdx = result.indexOf('## Persist an IMPLEMENT report');
    expect(howToWorkIdx).toBeGreaterThan(-1);
    expect(memoryIdx).toBeGreaterThan(howToWorkIdx);
    expect(reportIdx).toBeGreaterThan(memoryIdx);
  });
});
