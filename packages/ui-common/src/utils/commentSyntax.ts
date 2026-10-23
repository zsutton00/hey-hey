/**
 * Resolve the comment syntax of a source file from its path, so the diff
 * viewer can recognise comment-only lines and hide them on request.
 *
 * A file's syntax is keyed purely off its extension. Unknown extensions
 * resolve to `null` — no markers — so nothing is ever treated as a comment
 * for file types we do not understand.
 */

interface BlockCommentMarker {
  /** Token that opens a block comment, e.g. `/*`. */
  open: string;
  /** Token that closes a block comment (the slash-star counterpart). */
  close: string;
}

export interface CommentSyntax {
  /**
   * Tokens that begin a single-line comment. A line is a single-line comment
   * only when its trimmed content starts with one of these markers.
   */
  lineMarkers: string[];
  /** Delimiter pairs for block comments that may span multiple lines. */
  blockMarkers: BlockCommentMarker[];
}

const C_STYLE_BLOCK: BlockCommentMarker[] = [{ open: "/*", close: "*/" }];

const SLASH_SYNTAX: CommentSyntax = {
  lineMarkers: ["//"],
  blockMarkers: C_STYLE_BLOCK,
};

const HASH_SYNTAX: CommentSyntax = {
  lineMarkers: ["#"],
  blockMarkers: [],
};

const SQL_SYNTAX: CommentSyntax = {
  lineMarkers: ["--"],
  blockMarkers: C_STYLE_BLOCK,
};

const CSS_SYNTAX: CommentSyntax = {
  lineMarkers: [],
  blockMarkers: C_STYLE_BLOCK,
};

/** Maps a lower-cased file extension to its comment syntax. */
const EXTENSION_SYNTAX: Record<string, CommentSyntax> = {
  // TypeScript / JavaScript family
  ts: SLASH_SYNTAX,
  tsx: SLASH_SYNTAX,
  js: SLASH_SYNTAX,
  jsx: SLASH_SYNTAX,
  mjs: SLASH_SYNTAX,
  cjs: SLASH_SYNTAX,
  // C-family and other slash-comment languages
  go: SLASH_SYNTAX,
  rs: SLASH_SYNTAX,
  java: SLASH_SYNTAX,
  // Python
  py: HASH_SYNTAX,
  // Shell / config
  sh: HASH_SYNTAX,
  bash: HASH_SYNTAX,
  zsh: HASH_SYNTAX,
  yaml: HASH_SYNTAX,
  yml: HASH_SYNTAX,
  rb: HASH_SYNTAX,
  // SQL
  sql: SQL_SYNTAX,
  // Stylesheets
  css: CSS_SYNTAX,
  scss: { lineMarkers: ["//"], blockMarkers: C_STYLE_BLOCK },
  less: { lineMarkers: ["//"], blockMarkers: C_STYLE_BLOCK },
};

const getExtension = (filePath: string): string | null => {
  const fileName = filePath.split("/").pop() ?? filePath;
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
};

/**
 * Resolve the comment syntax for a file path, or `null` when the extension is
 * unknown (in which case the diff viewer hides nothing for that file).
 */
export const resolveCommentSyntax = (
  filePath: string,
): CommentSyntax | null => {
  const extension = getExtension(filePath);
  if (extension === null) return null;
  return EXTENSION_SYNTAX[extension] ?? null;
};

/**
 * True only when `line`'s trimmed content is wholly a single-line comment —
 * a line such as `code(); // trailing` is not a comment line because code
 * precedes the marker. Blank lines and files with unknown syntax never match.
 */
export const isSingleLineCommentLine = (
  line: string,
  filePath: string,
): boolean => {
  const syntax = resolveCommentSyntax(filePath);
  if (syntax === null) return false;
  const trimmed = line.trim();
  if (trimmed === "") return false;
  return syntax.lineMarkers.some((marker) => trimmed.startsWith(marker));
};

/**
 * Scan `content` and return the set of 1-indexed line numbers that fall
 * wholly inside a block comment — every non-whitespace character on the line
 * is part of a block comment (including the opening/closing delimiters).
 *
 * A line that mixes code and a block comment (e.g. `code(); /* note`) is not
 * included, since its visible code must still be shown. Files whose syntax has
 * no block markers, or an unknown extension, yield an empty set.
 */
export const computeBlockCommentLines = (
  content: string,
  filePath: string,
): Set<number> => {
  const result = new Set<number>();
  const syntax = resolveCommentSyntax(filePath);
  if (syntax === null || syntax.blockMarkers.length === 0) return result;

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let activeClose: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let pos = 0;
    let sawComment = false;
    let sawNonCommentContent = false;

    while (pos < line.length) {
      if (activeClose !== null) {
        const closeIndex = line.indexOf(activeClose, pos);
        sawComment = true;
        if (closeIndex === -1) {
          pos = line.length;
        } else {
          pos = closeIndex + activeClose.length;
          activeClose = null;
        }
        continue;
      }

      let nextOpenIndex = -1;
      let nextMarker: BlockCommentMarker | null = null;
      for (const marker of syntax.blockMarkers) {
        const index = line.indexOf(marker.open, pos);
        if (index !== -1 && (nextOpenIndex === -1 || index < nextOpenIndex)) {
          nextOpenIndex = index;
          nextMarker = marker;
        }
      }

      if (nextOpenIndex === -1 || nextMarker === null) {
        if (line.slice(pos).trim() !== "") sawNonCommentContent = true;
        pos = line.length;
      } else {
        if (line.slice(pos, nextOpenIndex).trim() !== "") {
          sawNonCommentContent = true;
        }
        sawComment = true;
        activeClose = nextMarker.close;
        pos = nextOpenIndex + nextMarker.open.length;
      }
    }

    if (sawComment && !sawNonCommentContent && line.trim() !== "") {
      result.add(i + 1);
    }
  }

  return result;
};
