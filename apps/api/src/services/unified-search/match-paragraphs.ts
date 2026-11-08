import type { UnifiedMatchParagraph } from '@hey-hey/contracts/api/models';
import type { MatchSpan } from 'src/generated/embeddings';

export const MAX_MATCH_PARAGRAPHS = 3;
export const OPENING_SNIPPET_LENGTH = 300;

/** The opening of an entity's indexed text, so a hit never carries the whole document. */
export function openingSnippet(text: string): string {
  if (text.length <= OPENING_SNIPPET_LENGTH) {
    return text;
  }

  return text.slice(0, OPENING_SNIPPET_LENGTH - 1) + '…';
}

interface Block {
  start: number;
  end: number;
}

const STANDALONE_HEADING = /^(?:#{1,6}[^\n]*\n?)+$/u;

function isValidSpan(span: unknown, textLength: number): span is MatchSpan {
  if (typeof span !== 'object' || span === null) {
    return false;
  }

  const { start, end, strength } = span as Record<string, unknown>;

  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    typeof strength === 'number' &&
    (start as number) >= 0 &&
    (start as number) < (end as number) &&
    (end as number) <= textLength &&
    strength >= -1 &&
    strength <= 1
  );
}

/** Blank-line separated blocks; a standalone heading joins the block beneath it. */
function splitParagraphs(text: string): Block[] {
  const blocks = [...text.matchAll(/\S[^]*?(?=\r?\n[ \t]*\r?\n|$)/gu)].map(
    (match) => ({ start: match.index, end: match.index + match[0].length }),
  );

  const paragraphs: Block[] = [];
  for (const block of blocks) {
    const previous = paragraphs.at(-1);
    const previousIsHeading =
      previous !== undefined &&
      STANDALONE_HEADING.test(text.slice(previous.start, previous.end));

    if (previous && previousIsHeading) {
      previous.end = block.end;
    } else {
      paragraphs.push({ ...block });
    }
  }

  return paragraphs;
}

function clipSpans(spans: MatchSpan[], paragraph: Block): MatchSpan[] {
  return spans
    .filter((span) => span.start < paragraph.end && span.end > paragraph.start)
    .map((span) => ({
      start: Math.max(span.start, paragraph.start) - paragraph.start,
      end: Math.min(span.end, paragraph.end) - paragraph.start,
      strength: span.strength,
    }));
}

/**
 * Builds the best-matching paragraphs of an indexed text from untrusted match
 * spans. Offsets are UTF-16 code units, re-based to each paragraph. Returns
 * undefined when no valid span exists.
 */
export function buildMatchParagraphs(
  text: string,
  rawSpans: unknown,
): UnifiedMatchParagraph[] | undefined {
  if (!Array.isArray(rawSpans)) {
    return undefined;
  }

  const spans = rawSpans.filter((span) => isValidSpan(span, text.length));
  if (spans.length === 0) {
    return undefined;
  }

  const candidates = splitParagraphs(text)
    .map((paragraph, index) => {
      const matchSpans = clipSpans(spans, paragraph);
      const best = Math.max(...matchSpans.map((span) => span.strength));
      return { paragraph, index, matchSpans, best };
    })
    .filter((candidate) => candidate.matchSpans.length > 0);

  const strongest = [...candidates]
    .sort((a, b) => b.best - a.best || a.index - b.index)
    .slice(0, MAX_MATCH_PARAGRAPHS)
    .sort((a, b) => a.index - b.index);

  return strongest.map(({ paragraph, matchSpans }) => ({
    text: text.slice(paragraph.start, paragraph.end),
    matchSpans,
  }));
}
