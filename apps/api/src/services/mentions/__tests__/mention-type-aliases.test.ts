import { normalizeMentionTypeAlias } from '../mention-type-aliases';

describe('normalizeMentionTypeAlias', () => {
  it('maps product-facing aliases to the canonical task wire string', () => {
    expect(normalizeMentionTypeAlias('feature')).toBe('task');
    expect(normalizeMentionTypeAlias('goal')).toBe('task');
    expect(normalizeMentionTypeAlias('bug')).toBe('task');
    expect(normalizeMentionTypeAlias('plan')).toBe('task');
    expect(normalizeMentionTypeAlias('plan_stage')).toBe('task');
  });

  it('passes through canonical wire strings unchanged', () => {
    expect(normalizeMentionTypeAlias('task')).toBe('task');
    expect(normalizeMentionTypeAlias('design-doc')).toBe('design-doc');
    expect(normalizeMentionTypeAlias('proposal')).toBe('proposal');
    expect(normalizeMentionTypeAlias('artifact')).toBe('artifact');
  });

  it('lowercases and converts underscores to dashes for case-insensitive contract', () => {
    expect(normalizeMentionTypeAlias('TASK')).toBe('task');
    expect(normalizeMentionTypeAlias('Feature')).toBe('task');
    expect(normalizeMentionTypeAlias('FEATURE')).toBe('task');
    expect(normalizeMentionTypeAlias('DESIGN_DOC')).toBe('design-doc');
    expect(normalizeMentionTypeAlias('Design_Doc')).toBe('design-doc');
  });

  it('returns lowercased input for unknown types so callers can decide', () => {
    expect(normalizeMentionTypeAlias('widget')).toBe('widget');
    expect(normalizeMentionTypeAlias('UNKNOWN_THING')).toBe('unknown-thing');
  });
});
