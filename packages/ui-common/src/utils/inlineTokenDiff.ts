/**
 * Inline-token-aware wrappers around jsdiff's word-level diffs.
 *
 * jsdiff tokenizes on word/punctuation/whitespace boundaries, which tears
 * inline constructs apart: a mention `@[task:id|Title with spaces]` or an inline
 * code span `` `some_code` `` gets split into many fragments. When the diff then
 * scatters those fragments across operations, no rendered segment ever holds a
 * complete construct, so it falls back to raw text (literal `@[...]` tokens and
 * literal backticks).
 *
 * To keep these constructs atomic we replace each one with a whitespace-free
 * sentinel before diffing (so the differ treats it as a single, indivisible
 * word), then restore the original text in every resulting change. The restored
 * change objects carry the real text, so downstream operation indices and the
 * output of `applyDiffOperations` are identical to diffing the raw strings.
 */
import { type Change, diffWords, diffWordsWithSpace } from "diff";
import { MENTION_TOKEN_REGEX } from "./mentionFormatting";

// Each protected token is replaced by a single Unicode Private Use Area
// character (U+E000..U+F8FF). A one-character sentinel is critical: jsdiff
// tokenizes PUA characters individually, so a multi-character sentinel like
// `<open><index><close>` would be split into separate tokens. When two
// different tokens occupy the same position (e.g. `` `code` `` replaced by
// `` `compact_run` ``), jsdiff would align the shared delimiter characters as
// "equal" and only diff the index digits \u2014 stranding the delimiters in equal
// segments and breaking restoration. A single char per unique token has no
// shared sub-parts to mis-align: distinct tokens become distinct, indivisible
// sentinels that diff as a clean replace.
const SENTINEL_BASE_CODE_POINT = 0xe000;
const SENTINEL_MAX_CODE_POINT = 0xf8ff;
const SENTINEL_CAPACITY =
  SENTINEL_MAX_CODE_POINT - SENTINEL_BASE_CODE_POINT + 1;
const SENTINEL_PATTERN = /[\uE000-\uF8FF]/g;

// Inline constructs that commonly span multiple words and would otherwise be
// torn across diff operations. Each requires non-space flanking so empty
// delimiters (e.g. `** **`) are not captured. Restoration is verbatim and the
// renderer re-parses these, so an occasional over-match here only coarsens diff
// granularity — it can never change the reconstructed text or the rendering.
const INLINE_CODE_SPAN_SOURCE = "`[^`\\n]+`"; // `code`
const STRONG_STAR_SOURCE = "\\*\\*(?=\\S)[\\s\\S]*?\\S\\*\\*"; // **bold**
const STRONG_UNDERSCORE_SOURCE = "__(?=\\S)[\\s\\S]*?\\S__"; // __bold__
const STRIKETHROUGH_SOURCE = "~~(?=\\S)[\\s\\S]*?\\S~~"; // ~~struck~~

// Match the first inline construct at a position. Mentions and code spans come
// first so their literal contents are never re-interpreted as emphasis. Only
// the full match is needed (restoration is verbatim), so capture groups inside
// each alternative are ignored.
const ATOMIC_TOKEN_SOURCE = [
  MENTION_TOKEN_REGEX.source,
  INLINE_CODE_SPAN_SOURCE,
  STRONG_STAR_SOURCE,
  STRONG_UNDERSCORE_SOURCE,
  STRIKETHROUGH_SOURCE,
]
  .map((source) => `(?:${source})`)
  .join("|");

interface InlineTokenRegistry {
  protect: (value: string) => string;
  restore: (value: string) => string;
}

const createInlineTokenRegistry = (): InlineTokenRegistry => {
  const tokens: string[] = [];
  const indexByToken = new Map<string, number>();
  const atomicRegex = new RegExp(ATOMIC_TOKEN_SOURCE, "g");

  return {
    protect: (value) =>
      value.replace(atomicRegex, (token) => {
        let index = indexByToken.get(token);
        if (index === undefined) {
          index = tokens.length;
          tokens.push(token);
          indexByToken.set(token, index);
        }
        // More distinct tokens than the PUA range can hold is implausible for a
        // single diff, but if it happens leave the token unprotected rather than
        // alias two tokens to the same sentinel.
        if (index >= SENTINEL_CAPACITY) {
          return token;
        }
        return String.fromCodePoint(SENTINEL_BASE_CODE_POINT + index);
      }),
    restore: (value) =>
      value.replace(SENTINEL_PATTERN, (sentinel) => {
        const index = sentinel.codePointAt(0)! - SENTINEL_BASE_CODE_POINT;
        return tokens[index] ?? "";
      }),
  };
};

const diffWithProtectedTokens = (
  oldStr: string,
  newStr: string,
  diffFn: (oldStr: string, newStr: string) => Change[]
): Change[] => {
  const registry = createInlineTokenRegistry();
  const changes = diffFn(registry.protect(oldStr), registry.protect(newStr));
  return changes.map((change) => ({
    ...change,
    value: registry.restore(change.value),
  }));
};

/** `diffWords` that keeps mention tokens and inline code spans atomic. */
export const diffWordsInlineAware = (
  oldStr: string,
  newStr: string
): Change[] => diffWithProtectedTokens(oldStr, newStr, diffWords);

/** `diffWordsWithSpace` that keeps mention tokens and inline code spans atomic. */
export const diffWordsWithSpaceInlineAware = (
  oldStr: string,
  newStr: string
): Change[] => diffWithProtectedTokens(oldStr, newStr, diffWordsWithSpace);
