import { deriveMessageTitle } from '../message-title';

describe('deriveMessageTitle', () => {
  it('strips the role label and collapses whitespace', () => {
    expect(deriveMessageTitle('ASSISTANT:  Hello\n\n  there\tfriend ')).toBe(
      'Hello there friend',
    );
    expect(deriveMessageTitle('comment: looks good')).toBe('looks good');
  });

  it('keeps text of exactly 150 characters without an ellipsis', () => {
    const text = 'a'.repeat(150);
    expect(deriveMessageTitle(`USER: ${text}`)).toBe(text);
  });

  it('truncates to 150 characters with an ellipsis', () => {
    const title = deriveMessageTitle(`USER: ${'b'.repeat(200)}`);
    expect(title).toHaveLength(150);
    expect(title.endsWith('…')).toBe(true);
  });

  it('returns an empty title when there is no usable text', () => {
    expect(deriveMessageTitle(undefined)).toBe('');
    expect(deriveMessageTitle(null)).toBe('');
    expect(deriveMessageTitle('   \n ')).toBe('');
    expect(deriveMessageTitle('ASSISTANT:   ')).toBe('');
  });
});
