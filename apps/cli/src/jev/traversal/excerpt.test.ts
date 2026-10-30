import { describe, expect, it } from 'vitest';
import { excerptEntity } from './excerpt';

describe('matched whole paragraphs', () => {
  const paragraphs = Array.from(
    { length: 10 },
    (_, i) =>
      `Paragraph ${i + 1}: Customers review requirements 😀 and preserve the complete original wording for this capability.`,
  );
  const text = paragraphs.join('\n\n');
  const entity = { id: 'document', kind: 'task', title: 'Requirements', text };
  const span = (index: number) => ({
    start: text.indexOf(paragraphs[index]!),
    end: text.indexOf(paragraphs[index]!) + paragraphs[index]!.length,
    strength: 0.9,
  });
  it('keeps every matched paragraph once in original order with UTF-16 offsets', () => {
    const result = excerptEntity(entity, {
      ...entity,
      indexedText: text,
      matchSpans: [span(5), span(2), span(2)],
    });
    expect(result.text).toBe([paragraphs[2], paragraphs[5]].join('\n\n'));
    expect(result.excerpt).toMatchObject({
      partial: true,
      paragraphs: [3, 6],
      totalParagraphs: 10,
    });
    const emoji = text.indexOf('😀', span(5).start);
    expect(
      excerptEntity(entity, {
        ...entity,
        indexedText: text,
        matchSpans: [{ start: emoji, end: emoji + 2, strength: 1 }],
      }).text,
    ).toBe(paragraphs[5]);
  });
  it.each(['no-spans', 'weak-spans', 'text-mismatch'] as const)(
    'returns full content for %s',
    (reason) => {
      const hit = {
        ...entity,
        indexedText: reason === 'text-mismatch' ? 'different' : text,
        matchSpans:
          reason === 'no-spans'
            ? []
            : [{ ...span(2), strength: reason === 'weak-spans' ? 0.1 : 1 }],
      };
      expect(excerptEntity(entity, hit)).toMatchObject({
        text,
        excerpt: { partial: false, fullReason: reason },
      });
    },
  );
  it('keeps single paragraphs and oversized paragraphs whole', () => {
    const single = { ...entity, text: 'x'.repeat(210_000) };
    expect(excerptEntity(single).text).toBe(single.text);
    expect(excerptEntity(single).excerpt?.partial).toBe(false);
  });
  it('keeps headings with their paragraph', () => {
    const content = '# Heading\n\nMatched content\n\nOther content';
    expect(
      excerptEntity(
        { ...entity, text: content },
        { ...entity, indexedText: content, matchSpans: [{ start: 12, end: 20, strength: 1 }] },
      ).text,
    ).toBe('# Heading\n\nMatched content');
  });
});
