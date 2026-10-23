import type { DiagnosticRecord } from '../../../server/diagnostic-feed';
import { layoutFeed, maxFeedOffset } from '../../feed-layout';
import type { FeedScroll, PresentationState } from '../../presentation-state';
import { bodyHeight, contentWidth, type ScreenModel } from '../../screen-model';
import {
  formatBytes,
  formatClock,
  plural,
  row,
  sanitize,
  wrapRows,
  type Row,
  type Tone,
} from '../../text';

const LEVEL_TONE: Record<string, Tone> = {
  trace: 'muted',
  debug: 'muted',
  info: 'normal',
  warn: 'warning',
  error: 'danger',
};

const diagnosticRecordRows = (record: DiagnosticRecord, width: number): Row[] => {
  const time = formatClock(record.timestamp);
  const head =
    record.kind === 'log'
      ? row(
          `${time} ${record.level.toUpperCase().padEnd(5)} ${sanitize(record.text)}`,
          LEVEL_TONE[record.level] ?? 'normal',
        )
      : row(
          `${time} ${record.stream.toUpperCase().padEnd(6)} ${sanitize(record.text)}`,
          record.stream === 'stderr' ? 'warning' : 'normal',
        );
  const rows = wrapRows(head, width);
  if (record.truncatedBytes > 0) {
    rows.push(row(`  … ${formatBytes(record.truncatedBytes)} not kept`, 'muted'));
  }
  return rows;
};

/** The follow line and retention counts precede the feed. */
const DEBUG_HEADER_ROWS = 3;

const exportResultRows = (state: PresentationState): Row[] => {
  const result = state.diagnostics?.exportResult;
  const width = contentWidth(state.viewport.columns);
  if (!result) return [];
  if (result.kind === 'choosing') {
    return wrapRows(row('Choose where to save the export in the save dialog.', 'muted'), width);
  }
  if (result.kind === 'cancelled') return wrapRows(row('Export cancelled.', 'muted'), width);
  if (result.kind === 'failure') {
    return wrapRows(row(`Export failed: ${sanitize(result.message)}`, 'danger'), width);
  }
  return [
    ...wrapRows(
      row(
        `Exported ${plural(result.count, 'entry', 'entries')}; ${plural(result.evictedCount, 'earlier entry', 'earlier entries')} evicted; ${plural(result.expiredCount, 'entry', 'entries')} expired.`,
        'success',
      ),
      width,
    ),
    ...wrapRows(row(sanitize(result.path), 'muted'), width),
  ];
};

export const diagnosticsFeedHeight = (rows: number, resultRows = 0): number =>
  Math.max(1, bodyHeight(rows, true) - DEBUG_HEADER_ROWS - resultRows);

export const diagnosticsResultHeight = (state: PresentationState): number =>
  exportResultRows(state).length;

const pinnedRecords = (
  records: readonly DiagnosticRecord[],
  scroll: FeedScroll,
): readonly DiagnosticRecord[] =>
  scroll.mode === 'live'
    ? records
    : records.filter((record) => record.seq <= scroll.pinnedThroughSeq);

export const diagnosticsMaxOffset = (state: PresentationState): number => {
  const diagnostics = state.diagnostics;
  if (!diagnostics) return 0;
  return maxFeedOffset(
    pinnedRecords(diagnostics.records, state.diagnosticsScroll),
    (record) => diagnosticRecordRows(record, contentWidth(state.viewport.columns)),
    diagnosticsFeedHeight(state.viewport.rows, diagnosticsResultHeight(state)),
  );
};

export const debugViewModel = (state: PresentationState): ScreenModel => {
  const diagnostics = state.diagnostics;
  const scroll = state.diagnosticsScroll;
  const losses: string[] = [
    plural(diagnostics?.records.length ?? 0, 'entry', 'entries') + ' held',
    plural(diagnostics?.evictedCount ?? 0, 'earlier entry', 'earlier entries') + ' evicted',
  ];
  losses.push(
    `${diagnostics?.expiredCount ?? 0} expired · ${diagnostics?.repetitionCount ?? 0} repetitions summarized`,
  );
  if (diagnostics && diagnostics.droppedReentrantCount > 0) {
    losses.push(`${plural(diagnostics.droppedReentrantCount, 'nested record')} dropped`);
  }
  const header: Row[] = [
    row(
      scroll.mode === 'live' ? 'Following live' : 'Paused · f to follow live',
      scroll.mode === 'live' ? 'accent' : 'warning',
      true,
    ),
    row(losses.join(' · '), 'muted'),
    row(
      diagnostics?.coverage.oldestTimestamp && diagnostics.coverage.newestTimestamp
        ? `Retained ${diagnostics.coverage.oldestTimestamp} – ${diagnostics.coverage.newestTimestamp} · gaps possible · up to 2 hours`
        : 'No retained time coverage · up to 2 hours',
      'muted',
    ),
  ];
  const resultRows = exportResultRows(state);
  let feed: Row[];
  if (!diagnostics || diagnostics.records.length === 0) {
    feed = [row('No diagnostics recorded yet.', 'muted')];
  } else {
    feed = [
      ...layoutFeed(
        pinnedRecords(diagnostics.records, scroll),
        (record) => diagnosticRecordRows(record, contentWidth(state.viewport.columns)),
        diagnosticsFeedHeight(state.viewport.rows, resultRows.length),
        scroll.mode === 'live' ? 0 : scroll.offset,
      ).rows,
    ];
  }
  return {
    body: [...header, ...resultRows, ...feed].slice(0, bodyHeight(state.viewport.rows, true)),
    footer: 'Esc back  ↑↓ PgUp PgDn scroll  f follow live  e export  q quit',
  };
};
