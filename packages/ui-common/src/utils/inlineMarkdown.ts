/**
 * A small, inline-only markdown parser for the word-level diff views.
 *
 * The diff renderer's word-level paths (interactive review and the split-view
 * "inline-changed" segments) render individual diff fragments, where a full
 * markdown renderer can't be used (a fragment can't carry block structure, and
 * react-markdown would parse `## ` / `- ` as blocks and mangle them). This
 * parser handles only the *inline* constructs that appear within a line —
 * inline code, mentions, bold, italic, strikethrough — and leaves everything
 * else (including block syntax like `##`) as literal text, matching how those
 * views already behave.
 *
 * It deliberately follows GFM's flanking rules closely enough to avoid the
 * common false positives that a naive regex would hit: `** **` is not bold,
 * `snake_case` is not italic, and `a * b` is not emphasis.
 */
import {
  type EntityMentionType,
  MENTION_TOKEN_SINGLE_REGEX,
  parseMention,
} from "./mentionFormatting";

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "mention"; mention: EntityMentionType }
  | { type: "strong"; children: InlineNode[] }
  | { type: "emphasis"; children: InlineNode[] }
  | { type: "strikethrough"; children: InlineNode[] };

// Sticky regexes anchored via `lastIndex`. Each emphasis/strong/strike pattern
// requires the delimited content to start and end with a non-space character
// (GFM flanking), which rejects `** **`, `~~ ~~`, etc.
const CODE_RE = /`([^`\n]+)`/y;
const STRONG_STAR_RE = /\*\*(?=\S)([\s\S]*?\S)\*\*/y;
const STRONG_UNDERSCORE_RE = /__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9])/y;
const STRIKE_RE = /~~(?=\S)([\s\S]*?\S)~~/y;
const EM_STAR_RE = /\*(?!\*)(?=\S)([\s\S]*?\S)\*(?!\*)/y;
const EM_UNDERSCORE_RE = /_(?=\S)([\s\S]*?\S)_(?![A-Za-z0-9])/y;
const MENTION_RE = new RegExp(MENTION_TOKEN_SINGLE_REGEX.source, "y");

const isAlphaNumeric = (char: string | undefined): boolean =>
  char !== undefined && /[A-Za-z0-9]/.test(char);

interface InlineMatch {
  length: number;
  node: InlineNode;
}

const matchSticky = (
  regex: RegExp,
  text: string,
  index: number
): RegExpExecArray | null => {
  regex.lastIndex = index;
  const result = regex.exec(text);
  return result && result.index === index ? result : null;
};

const matchLeaf = (
  regex: RegExp,
  text: string,
  index: number,
  build: (match: RegExpExecArray) => InlineNode | null
): InlineMatch | null => {
  const match = matchSticky(regex, text, index);
  if (!match) return null;
  const node = build(match);
  return node ? { length: match[0].length, node } : null;
};

const matchContainer = (
  regex: RegExp,
  text: string,
  index: number,
  type: "strong" | "emphasis" | "strikethrough"
): InlineMatch | null => {
  const match = matchSticky(regex, text, index);
  if (!match) return null;
  return {
    length: match[0].length,
    // Recurse so nested constructs (code/mentions/italic inside bold) render.
    node: { type, children: parseInlineMarkdown(match[1]) },
  };
};

const matchAt = (text: string, index: number): InlineMatch | null => {
  const char = text[index];

  switch (char) {
    case "`":
      return matchLeaf(CODE_RE, text, index, (match) => ({
        type: "code",
        value: match[1],
      }));
    case "@":
      return matchLeaf(MENTION_RE, text, index, (match) => {
        const mention = parseMention(match[0], { allowMentionEscapes: true });
        return mention ? { type: "mention", mention } : null;
      });
    case "*":
      return (
        matchContainer(STRONG_STAR_RE, text, index, "strong") ??
        matchContainer(EM_STAR_RE, text, index, "emphasis")
      );
    case "_":
      // Underscore emphasis only at a word boundary (so `snake_case` is plain).
      if (isAlphaNumeric(text[index - 1])) return null;
      return (
        matchContainer(STRONG_UNDERSCORE_RE, text, index, "strong") ??
        matchContainer(EM_UNDERSCORE_RE, text, index, "emphasis")
      );
    case "~":
      return matchContainer(STRIKE_RE, text, index, "strikethrough");
    default:
      return null;
  }
};

/** Parse a single line/run of text into inline markdown nodes. */
export function parseInlineMarkdown(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let pending = "";
  let index = 0;

  const flushPending = () => {
    if (pending.length > 0) {
      nodes.push({ type: "text", value: pending });
      pending = "";
    }
  };

  while (index < text.length) {
    const match = matchAt(text, index);
    if (match) {
      flushPending();
      nodes.push(match.node);
      index += match.length;
    } else {
      pending += text[index];
      index += 1;
    }
  }

  flushPending();
  return nodes;
}
