import type { LoadedEntity, TitledRef } from './types';
import { textForJev } from './entity-text';

// Require at least moderate cosine similarity; weak token matches must not hide context.
export const EXCERPT_SPAN_MIN_STRENGTH = 0.5;
export interface ExcerptMetadata {
  partial: boolean;
  paragraphs: number[];
  totalParagraphs: number;
  source: 'spans' | 'full';
  fullReason?: 'no-spans' | 'weak-spans';
}

interface Paragraph {
  start: number;
  end: number;
  text: string;
}

/** A line the indexed text puts before each section's content, such as `description:`. */
const SECTION_LABEL = /^[A-Za-z][A-Za-z0-9]*:$/u;
const IMPLEMENTATION_LABEL = /^implementation$/iu;

/** Splits on blank lines; a standalone heading belongs to the paragraph immediately beneath it. */
const paragraphsOf = (text: string): Paragraph[] => {
  const blocks = [...text.matchAll(/\S[^]*?(?=\r?\n[ \t]*\r?\n|$)/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }));
  const paragraphs: Paragraph[] = [];
  for (const block of blocks) {
    const previous = paragraphs.at(-1);
    if (previous && /^(?:#{1,6}[^\n]*\n?)+$/u.test(previous.text)) {
      previous.end = block.end;
      previous.text = text.slice(previous.start, block.end);
    } else {
      paragraphs.push({ ...block });
    }
  }
  return paragraphs;
};

/**
 * The indexed text has no markdown headings, so an Implementation section is the paragraphs from a
 * line reading `Implementation` to the next section label. Jev never reads them, as in `textForJev`.
 */
const withoutImplementation = (paragraphs: readonly Paragraph[]): Paragraph[] => {
  let skipping = false;
  return paragraphs.filter(({ text }) => {
    const firstLine = text.split('\n')[0]?.trim() ?? '';
    if (IMPLEMENTATION_LABEL.test(firstLine)) {
      skipping = true;
    } else if (SECTION_LABEL.test(firstLine)) {
      skipping = false;
    }
    return !skipping;
  });
};

const fullEntity = (
  entity: LoadedEntity,
  fullReason: NonNullable<ExcerptMetadata['fullReason']>,
): LoadedEntity => ({
  ...entity,
  text: textForJev(entity.text),
  excerpt: { partial: false, paragraphs: [], totalParagraphs: 0, source: 'full', fullReason },
});

/**
 * Cuts an entity down to the whole paragraphs its search hit matched. The hit's offsets are valid
 * only against the text the search indexed, which is a different rendering of the entity from the
 * one the reader loads, so the paragraphs come from that indexed text. Without usable spans the
 * entity is returned in full with the reason.
 */
export function excerptEntity(entity: LoadedEntity, hit?: TitledRef): LoadedEntity {
  const indexed = hit?.indexedText;
  const spans = hit?.matchSpans ?? [];
  if (indexed === undefined || spans.length === 0) {
    return fullEntity(entity, 'no-spans');
  }

  const strong = spans.filter(
    ({ start, end, strength }) =>
      strength >= EXCERPT_SPAN_MIN_STRENGTH && start >= 0 && end > start && end <= indexed.length,
  );
  const paragraphs = withoutImplementation(paragraphsOf(indexed));
  const selected = paragraphs.flatMap((paragraph, index) =>
    strong.some(({ start, end }) => start < paragraph.end && end > paragraph.start)
      ? [{ ...paragraph, number: index + 1 }]
      : [],
  );
  if (selected.length === 0) {
    return fullEntity(entity, 'weak-spans');
  }

  const partial = selected.length < paragraphs.length;
  return {
    ...entity,
    text: partial ? selected.map((p) => p.text).join('\n\n') : textForJev(entity.text),
    excerpt: {
      partial,
      paragraphs: selected.map((p) => p.number),
      totalParagraphs: paragraphs.length,
      source: 'spans',
    },
  };
}
