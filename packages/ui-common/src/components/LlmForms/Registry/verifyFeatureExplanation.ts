const PROTECTED_SPAN = /@\[[^\]]*\]|\[[^\]]*\]\([^)]*\)|`[^`]*`/g;
// Sentence punctuation, any closing Markdown emphasis or quote after it, then
// whitespace or the end of the paragraph.
const SENTENCE_END = /[.?!]+[*_~"'”’)]*(?=\s|$)/g;

export interface ExplanationParts {
  lead: string;
  details: string | null;
}

/**
 * Splits an explanation at its first sentence end in the first paragraph,
 * never inside a mention token, Markdown link or inline code. Adds and
 * rewords nothing; with no safe boundary the whole text is the lead.
 */
export const splitExplanation = (explanation: string): ExplanationParts => {
  const text = explanation.trim();
  const paragraphEnd = text.indexOf("\n\n");
  const firstParagraph =
    paragraphEnd === -1 ? text : text.slice(0, paragraphEnd);

  const protectedRanges = Array.from(
    firstParagraph.matchAll(PROTECTED_SPAN),
    (match) => [match.index, match.index + match[0].length] as const,
  );
  const isProtected = (index: number) =>
    protectedRanges.some(([start, end]) => index >= start && index < end);

  for (const match of firstParagraph.matchAll(SENTENCE_END)) {
    if (isProtected(match.index)) {
      continue;
    }

    const boundary = match.index + match[0].length;
    const lead = text.slice(0, boundary).trim();
    const details = text.slice(boundary).trim();

    return { lead, details: details.length > 0 ? details : null };
  }

  return { lead: text, details: null };
};
