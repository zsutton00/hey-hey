import { describe, expect, it } from 'vitest';
import { textForJev } from './entity-text';

describe('textForJev', () => {
  it('drops an Implementation heading inside a description section', () => {
    const text = [
      '# Task',
      '',
      '### description',
      '',
      'Stop reminders once paid.',
      '',
      '## Implementation',
      '',
      'Call the scheduler.',
      '',
      '### acceptanceCriteria',
      '',
      '- Paid invoices get no reminder.',
    ].join('\n');
    const result = textForJev(text);
    expect(result).not.toContain('Implementation');
    expect(result).not.toContain('scheduler');
    expect(result).toContain('Stop reminders once paid.');
    expect(result).toContain('### acceptanceCriteria');
    expect(result).toContain('- Paid invoices get no reminder.');
  });

  it('drops an implementation section of its own and keeps the sections after it', () => {
    const text = [
      '# Doc',
      '',
      '### implementation',
      '',
      'Use a queue.',
      '',
      '#### Details',
      '',
      'Retry thrice.',
      '',
      '### notes',
      '',
      'Kept.',
    ].join('\n');
    expect(textForJev(text)).toBe(['# Doc', '', '### notes', '', 'Kept.'].join('\n'));
  });

  it('ends the section at a heading no deeper than its own', () => {
    const text = ['## Implementation', 'hidden', '## Other', 'shown'].join('\n');
    expect(textForJev(text)).toBe('## Other\nshown');
  });

  it('ignores headings inside code fences', () => {
    const text = [
      '## Implementation',
      'hidden',
      '```md',
      '## Other',
      '```',
      'still hidden',
      '## Next',
      'shown',
    ].join('\n');
    expect(textForJev(text)).toBe('## Next\nshown');
    const fencedOnly = ['Intro', '```', '## Implementation', '```', 'Outro'].join('\n');
    expect(textForJev(fencedOnly)).toBe(fencedOnly);
  });

  it('leaves text without an Implementation section unchanged', () => {
    const text = '# Title\n\n### description\n\nImplementation details are elsewhere.';
    expect(textForJev(text)).toBe(text);
  });
});
