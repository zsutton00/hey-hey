import { contentWidth, type ScreenModel } from '../screen-model';
import { ink } from '../ink';
import { BLOCK_RULE_WIDTH, type Row, type Segment, type Tone } from '../text';

/** The approved mockup palette; used only when color is on. */
const TONE_COLOR: Record<Tone, string | undefined> = {
  normal: undefined,
  muted: '#a8b6c3',
  accent: '#89d9c5',
  success: 'green',
  warning: '#edce8d',
  danger: 'red',
};

const SELECTED_BACKGROUND = '#213b40';

/** Columns a selectable line's marker gutter takes. */
const GUTTER_WIDTH = 3;

/** One drawn run: a segment, possibly cut to fit, with its row's background. */
export interface DrawnSegment extends Segment {
  readonly background?: boolean;
}

const width = (text: string): number => Array.from(text).length;

const truncate = (parts: readonly Segment[], room: number): Segment[] => {
  const total = parts.reduce((sum, part) => sum + width(part.text), 0);
  if (total <= room) return [...parts];
  const kept: Segment[] = [];
  let left = Math.max(0, room - 1);
  for (const part of parts) {
    if (left <= 0) break;
    const characters = Array.from(part.text);
    kept.push({ ...part, text: characters.slice(0, left).join('') });
    left -= Math.min(left, characters.length);
  }
  if (room > 0) kept.push({ text: '…', tone: 'muted' });
  return kept;
};

const fill = (count: number): Segment => ({ text: ' '.repeat(Math.max(0, count)), tone: 'normal' });

/**
 * Lays one row out to exactly `columns` wide: the left part truncates first
 * and the right part keeps its width. Pure, so layout is testable without Ink.
 */
export const layoutRow = (row: Row, columns: number, color: boolean): DrawnSegment[] => {
  switch (row.kind) {
    case 'divider':
      return [{ text: '─'.repeat(columns), tone: 'muted' }];
    case 'block': {
      const indent = fill(BLOCK_RULE_WIDTH - 2);
      const rule: Segment = { text: '│ ', tone: 'muted' };
      const room = columns - BLOCK_RULE_WIDTH;
      return [indent, rule, ...truncate([{ text: row.text, tone: row.tone }], room)];
    }
    case 'heading':
      return layoutRow(
        {
          kind: 'line',
          left: [{ text: row.text, tone: 'muted', bold: true }],
          ...(row.right ? { right: row.right } : {}),
        },
        columns,
        color,
      );
    case 'line': {
      const selected = row.selected === true;
      const gutter: Segment[] =
        row.selected === undefined
          ? []
          : selected
            ? color
              ? [
                  { text: '▌', tone: 'accent' },
                  { text: '> ', tone: 'accent' },
                ]
              : [{ text: ' > ', tone: 'normal' }]
            : [fill(GUTTER_WIDTH)];
      const indent = row.indent ? [fill(row.indent)] : [];
      const lead = [...gutter, ...indent];
      const leadWidth = lead.reduce((sum, part) => sum + width(part.text), 0);
      const right = row.right ?? [];
      const rightWidth = right.reduce((sum, part) => sum + width(part.text), 0);
      const gap = rightWidth > 0 ? 2 : 0;
      const left = truncate(row.left, columns - leadWidth - rightWidth - gap);
      const leftWidth = left.reduce((sum, part) => sum + width(part.text), 0);
      const padding = fill(columns - leadWidth - leftWidth - rightWidth);
      const drawn = [...lead, ...left, padding, ...right];
      return selected && color ? drawn.map((part) => ({ ...part, background: true })) : drawn;
    }
  }
};

export interface FrameProps {
  readonly model: ScreenModel;
  readonly color: boolean;
  readonly columns: number;
  readonly rows: number;
}

/** Draws a screen model: optional header and divider, body rows, divider and key hints. Rows never wrap. */
export const Frame = ({ model, color, columns }: FrameProps): React.JSX.Element => {
  const { Box, Text } = ink();
  const frameWidth = contentWidth(columns);
  const draw = (row: Row, key: number | string): React.JSX.Element => (
    <Text key={key} wrap="truncate-end">
      {layoutRow(row, frameWidth, color).map((part, index) => {
        const tone = color ? TONE_COLOR[part.tone] : undefined;
        return (
          <Text
            key={index}
            bold={part.bold === true}
            {...(tone ? { color: tone } : {})}
            {...(part.background ? { backgroundColor: SELECTED_BACKGROUND } : {})}
          >
            {part.text}
          </Text>
        );
      })}
    </Text>
  );
  return (
    <Box flexDirection="column" width={frameWidth}>
      {model.title !== undefined && (
        <>
          {draw(
            {
              kind: 'line',
              left: [{ text: model.title, tone: 'normal', bold: true }],
              ...(model.aside !== undefined
                ? { right: [{ text: model.aside, tone: 'muted' as const }] }
                : {}),
            },
            'title',
          )}
          {draw({ kind: 'divider' }, 'header-divider')}
        </>
      )}
      {model.body.map((row, index) => draw(row, index))}
      {draw({ kind: 'divider' }, 'footer-divider')}
      {draw({ kind: 'line', left: [{ text: model.footer, tone: 'muted' }] }, 'footer')}
    </Box>
  );
};
