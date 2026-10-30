import type { LoadedEntity, TitledRef } from './types';
import { textForJev } from './entity-text';

// Require at least moderate cosine similarity; weak token matches must not hide context.
export const EXCERPT_SPAN_MIN_STRENGTH = 0.5;
export interface ExcerptMetadata {
  partial: boolean;
  paragraphs: number[];
  totalParagraphs: number;
  source: 'spans' | 'full';
  fullReason?: 'no-spans' | 'weak-spans' | 'text-mismatch';
}

/** Offsets are native UTF-16 indices into exactly the filtered text, never realigned. */
export function excerptEntity(entity: LoadedEntity, hit?: TitledRef): LoadedEntity {
  const text = textForJev(entity.text);
  const blocks = [...text.matchAll(/\S[^]*?(?=\r?\n[ \t]*\r?\n|$)/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }));
  // A standalone heading belongs to the paragraph immediately beneath it.
  const paragraphs: typeof blocks = [];
  for (const block of blocks) {
    const previous = paragraphs.at(-1);
    if (previous && /^(?:#{1,6}[^\n]*\n?)+$/u.test(previous.text)) {
      previous.end = block.end;
      previous.text = text.slice(previous.start, block.end);
    } else {
      paragraphs.push({ ...block });
    }
  }
  const spans = hit?.matchSpans ?? [];
  const strong = spans.filter(
    ({ start, end, strength }) =>
      strength >= EXCERPT_SPAN_MIN_STRENGTH && start >= 0 && end > start && end <= text.length,
  );
  const fullReason =
    spans.length === 0
      ? 'no-spans'
      : hit?.indexedText !== text
        ? 'text-mismatch'
        : strong.length === 0
          ? 'weak-spans'
          : undefined;
  const selected = paragraphs.flatMap((paragraph, index) =>
    fullReason || strong.some(({ start, end }) => start < paragraph.end && end > paragraph.start)
      ? [{ ...paragraph, number: index + 1 }]
      : [],
  );
  if (selected.length === 0) {
    return {
      ...entity,
      text,
      excerpt: {
        partial: false,
        paragraphs: paragraphs.map((_, i) => i + 1),
        totalParagraphs: paragraphs.length,
        source: 'full',
        fullReason: 'weak-spans',
      },
    };
  }
  const partial = selected.length < paragraphs.length;
  return {
    ...entity,
    text: partial ? selected.map((p) => p.text).join('\n\n') : text,
    excerpt: {
      partial,
      paragraphs: selected.map((p) => p.number),
      totalParagraphs: paragraphs.length,
      source: fullReason ? 'full' : 'spans',
      ...(fullReason ? { fullReason } : {}),
    },
  };
}
