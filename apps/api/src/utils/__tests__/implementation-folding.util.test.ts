import { foldImplementationIntoSections } from '../implementation-folding.util';

describe('foldImplementationIntoSections', () => {
  const IMPL = 'Touch src/foo.ts; follow the bar pattern.';
  const BLOCK = `## Implementation\n\n${IMPL}`;

  it('returns sections untouched when implementation is empty', () => {
    const sections = [{ key: 'description', content: 'body' }];
    expect(foldImplementationIntoSections(sections, undefined)).toBe(sections);
    expect(foldImplementationIntoSections(sections, '   ')).toBe(sections);
  });

  it('appends the implementation block to an existing description section', () => {
    const result = foldImplementationIntoSections(
      [{ key: 'description', content: 'Base.' }],
      IMPL,
    );
    expect(result).toEqual([
      { key: 'description', content: `Base.\n\n${BLOCK}` },
    ]);
  });

  it('creates a description section when none is supplied (no fallback)', () => {
    const result = foldImplementationIntoSections(undefined, IMPL);
    expect(result).toEqual([{ key: 'description', content: BLOCK }]);
  });

  it('appends to the fallback description when sections lack a description', () => {
    const result = foldImplementationIntoSections(
      [{ key: 'acceptanceCriteria', content: '- ac' }],
      IMPL,
      'Existing body.',
    );
    expect(result).toEqual([
      { key: 'acceptanceCriteria', content: '- ac' },
      { key: 'description', content: `Existing body.\n\n${BLOCK}` },
    ]);
  });

  it('falls back to the original description when the supplied description section is empty', () => {
    const result = foldImplementationIntoSections(
      [{ key: 'description', content: '' }],
      IMPL,
      'Existing body.',
    );
    expect(result).toEqual([
      { key: 'description', content: `Existing body.\n\n${BLOCK}` },
    ]);
  });

  it('emits only the block when both supplied and fallback descriptions are empty', () => {
    const result = foldImplementationIntoSections(
      [{ key: 'description', content: '' }],
      IMPL,
    );
    expect(result).toEqual([{ key: 'description', content: BLOCK }]);
  });

  describe('escaped newline repair', () => {
    const fold = (impl: string) =>
      foldImplementationIntoSections(undefined, impl)?.[0]?.content;

    it('turns escaped newlines outside code into real line breaks', () => {
      expect(fold('One.\\n\\nTwo.')).toBe('## Implementation\n\nOne.\n\nTwo.');
    });

    it('leaves escaped newlines inside an inline code span', () => {
      expect(fold('Use `a\\nb` here.\\nNext.')).toBe(
        '## Implementation\n\nUse `a\\nb` here.\nNext.',
      );
    });

    it('leaves escaped newlines inside a fenced code block', () => {
      expect(fold('Before.\\n```\nconst s = "a\\nb";\n```\\nAfter.')).toBe(
        '## Implementation\n\nBefore.\n```\nconst s = "a\\nb";\n```\nAfter.',
      );
    });

    it('leaves text with real line breaks unchanged', () => {
      expect(fold('One.\n\nTwo.')).toBe('## Implementation\n\nOne.\n\nTwo.');
    });

    it('does not rewrite the description section', () => {
      const result = foldImplementationIntoSections(
        [{ key: 'description', content: 'Keep \\n literal.' }],
        'Impl.',
      );
      expect(result?.[0]?.content).toBe(
        'Keep \\n literal.\n\n## Implementation\n\nImpl.',
      );
    });
  });

  it('does not mutate the input sections array', () => {
    const sections = [{ key: 'description', content: 'Base.' }];
    foldImplementationIntoSections(sections, IMPL);
    expect(sections[0]?.content).toBe('Base.');
  });
});
