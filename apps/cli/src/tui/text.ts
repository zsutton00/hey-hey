/** Pure text helpers shared by the view models. */

/** Semantic emphasis; components map it to color only when color is enabled. */
export type Tone = 'normal' | 'muted' | 'accent' | 'success' | 'warning' | 'danger';

/** A run of text drawn in one tone. */
export interface Segment {
  readonly text: string;
  readonly tone: Tone;
  readonly bold?: boolean;
}

/**
 * One terminal row. The frame lays a `line` out as a left part that truncates
 * first and a right part that keeps its width, so a row never wraps on screen.
 * `selected` marks a menu item: present means selectable, true means the cursor
 * is on it.
 */
export type Row =
  | {
      readonly kind: 'line';
      readonly left: readonly Segment[];
      readonly right?: readonly Segment[];
      readonly selected?: boolean;
      readonly indent?: number;
    }
  | { readonly kind: 'heading'; readonly text: string; readonly right?: readonly Segment[] }
  | { readonly kind: 'divider' }
  /** One row of command arguments or output, drawn behind a left rule. */
  | { readonly kind: 'block'; readonly text: string; readonly tone: Tone };

export type LineRow = Extract<Row, { kind: 'line' }>;

export const segment = (text: string, tone: Tone = 'normal', bold = false): Segment =>
  bold ? { text, tone, bold } : { text, tone };

/** A single-segment line. */
export const row = (text: string, tone: Tone = 'normal', bold = false): LineRow => ({
  kind: 'line',
  left: [segment(text, tone, bold)],
});

export const line = (
  left: readonly Segment[],
  options: Omit<LineRow, 'kind' | 'left'> = {},
): LineRow => ({ kind: 'line', left, ...options });

export const heading = (text: string, right?: readonly Segment[]): Row =>
  right ? { kind: 'heading', text, right } : { kind: 'heading', text };

export const DIVIDER: Row = Object.freeze({ kind: 'divider' });

/** Columns a block row's indent, left rule and gap take before its text. */
export const BLOCK_RULE_WIDTH = 7;

/** The plain text of a row as the frame would draw it, without layout. */
export const rowText = (source: Row): string => {
  switch (source.kind) {
    case 'line': {
      const left = source.left.map((part) => part.text).join('');
      const right = (source.right ?? []).map((part) => part.text).join('');
      return right.length > 0 ? `${left}  ${right}` : left;
    }
    case 'heading': {
      const right = (source.right ?? []).map((part) => part.text).join('');
      return right.length > 0 ? `${source.text}  ${right}` : source.text;
    }
    case 'divider':
      return '';
    case 'block':
      return source.text;
  }
};

// CSI/OSC sequences and the remaining C0/C1 controls a tool may print. They
// would move the cursor or restyle the screen if passed through.
const ESCAPE_SEQUENCES =
  // eslint-disable-next-line no-control-regex
  /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[@-_]/gu;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;

/** Makes untrusted output safe to draw: escapes removed, tabs expanded, CRLF normalized. */
export const sanitize = (text: string): string =>
  text
    .replace(ESCAPE_SEQUENCES, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/\t/gu, '  ')
    .replace(CONTROL_CHARACTERS, '');

/** Wraps sanitized text to `width` columns, breaking long words. Empty text is one empty row. */
export const wrapText = (text: string, width: number): string[] => {
  const columns = Math.max(1, width);
  const rows: string[] = [];
  for (const line of text.split('\n')) {
    const characters = Array.from(line);
    if (characters.length === 0) {
      rows.push('');
      continue;
    }
    for (let start = 0; start < characters.length; start += columns) {
      rows.push(characters.slice(start, start + columns).join(''));
    }
  }
  return rows;
};

/** Wraps one-tone text into lines, each indented by `indent` columns. */
export const wrapLines = (
  text: string,
  tone: Tone,
  width: number,
  indent = 0,
  bold = false,
): LineRow[] =>
  wrapText(text, Math.max(1, width - indent)).map((part) =>
    indent > 0 ? line([segment(part, tone, bold)], { indent }) : line([segment(part, tone, bold)]),
  );

/** Wraps a single-segment line; other rows pass through. */
export const wrapRows = (source: Row, width: number): Row[] => {
  if (source.kind !== 'line' || source.left.length !== 1 || source.right) return [source];
  const only = source.left[0]!;
  return wrapLines(only.text, only.tone, width, source.indent ?? 0, only.bold === true);
};

/** Wraps text into block rows, drawn indented behind a left rule. */
export const blockRows = (text: string, tone: Tone, width: number): Row[] =>
  wrapText(text, Math.max(1, width - BLOCK_RULE_WIDTH)).map(
    (part): Row => ({ kind: 'block', text: part, tone }),
  );

export const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** Local wall-clock time of an ISO timestamp, or `--:--:--` when unparsable. */
export const formatClock = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;

export const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${String(count)} ${count === 1 ? singular : pluralForm}`;

/** `mm:ss`, or `h:mm:ss` past an hour; negative spans read as zero. */
export const formatElapsed = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const rest = `${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  return hours > 0 ? `${String(hours)}:${rest}` : rest;
};
