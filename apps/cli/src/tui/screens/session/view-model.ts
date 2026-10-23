import type {
  BoundedText,
  SessionActivityEntry,
  SessionActivityLane,
} from '../../../server/session-activity-source';
import { layoutFeed, maxFeedOffset } from '../../feed-layout';
import type { RunIdentity } from '../../navigation';
import type { FeedScroll, PresentationState } from '../../presentation-state';
import { bodyHeight, contentWidth, type ScreenModel } from '../../screen-model';
import {
  providerLabel,
  sessionContextPath,
  sessionStateLabel,
  sessionTitle,
} from '../../session-labels';
import type { LocalSessionSnapshot } from '../../../server/local-session-read-source';
import {
  blockRows,
  formatBytes,
  formatDuration,
  formatElapsed,
  heading,
  line,
  plural,
  row,
  sanitize,
  segment,
  wrapLines,
  type Row,
  type Tone,
} from '../../text';
import { conversationWebHandoff } from '../../web-handoff';

/** The time column and its gap; entry text lines up after it. */
const TEXT_INDENT = 7;

const isSubagent = (lane: SessionActivityLane): boolean =>
  lane.subagentTurnId !== null || lane.parentToolUseId !== null || lane.providerThreadId !== null;

const truncationNote = (text: BoundedText): Row =>
  line([segment(`… ${formatBytes(text.truncatedBytes)} not kept`, 'muted')], {
    indent: TEXT_INDENT,
  });

const boundedRows = (
  text: BoundedText,
  toRows: (clean: string) => Row[],
  cutAt: 'start' | 'end',
): Row[] => {
  const rows = toRows(sanitize(text.text));
  if (text.truncatedBytes === 0) return rows;
  return cutAt === 'start' ? [truncationNote(text), ...rows] : [...rows, truncationNote(text)];
};

const toolStatus = (
  entry: Extract<SessionActivityEntry, { kind: 'tool' }>,
  nowMs: number,
): { symbol: string; text: string; tone: Tone } => {
  const started = Date.parse(entry.createdAt);
  const took = (endMs: number): string => formatDuration(endMs - started);
  switch (entry.status) {
    case 'running':
      return { symbol: '›', text: `running · ${took(nowMs)}`, tone: 'accent' };
    case 'completed':
      return {
        symbol: '✓',
        text: `completed · ${took(Date.parse(entry.updatedAt))}`,
        tone: 'success',
      };
    case 'failed':
      return {
        symbol: '✗',
        text: `${entry.exitCode === null ? 'failed' : `failed · exit ${String(entry.exitCode)}`} · ${took(Date.parse(entry.updatedAt))}`,
        tone: 'danger',
      };
  }
};

/**
 * The rows for one activity entry. Its time is elapsed since this process
 * first started a Turn for the Run, the moment activity capture can begin.
 */
const activityEntryRows = (
  entry: SessionActivityEntry,
  width: number,
  nowMs: number,
  startedAtMs: number,
): Row[] => {
  const time = segment(
    formatElapsed(Date.parse(entry.createdAt) - startedAtMs).padEnd(TEXT_INDENT),
    'muted',
  );
  const who = isSubagent(entry.lane) ? 'Subagent' : 'Agent';
  if (entry.kind === 'narration') {
    return [
      line([time, segment(`${who}${entry.open ? ' …' : ''}`, 'muted')]),
      ...boundedRows(entry.text, (text) => wrapLines(text, 'normal', width, TEXT_INDENT), 'start'),
    ];
  }
  const status = toolStatus(entry, nowMs);
  const name = entry.toolName ?? 'Tool (name not reported)';
  const rows: Row[] = [
    line(
      [
        time,
        segment(`${status.symbol} `, status.tone),
        segment(`${name}${who === 'Subagent' ? ' (subagent)' : ''}`),
      ],
      { right: [segment(status.text, status.tone)] },
    ),
  ];
  if (entry.input) {
    rows.push(...boundedRows(entry.input, (text) => blockRows(`$ ${text}`, 'muted', width), 'end'));
  }
  if (entry.output.text.length > 0) {
    rows.push(...boundedRows(entry.output, (text) => blockRows(text, 'normal', width), 'start'));
  }
  if (entry.result && entry.result.text.length > 0) {
    rows.push(
      ...boundedRows(entry.result, (text) => blockRows(`→ ${text}`, 'normal', width), 'end'),
    );
  }
  return rows;
};

const sessionStartMs = (session: LocalSessionSnapshot): number => Date.parse(session.activeSince);

/** Rows the session header takes; the activity feed gets the rest. */
const SESSION_HEADER_ROWS = 5;

export const activityFeedHeight = (rows: number): number =>
  Math.max(1, bodyHeight(rows) - SESSION_HEADER_ROWS);

/** Entries the current scroll position shows: everything live, or up to the pin. */
const pinnedEntries = (
  entries: readonly SessionActivityEntry[],
  scroll: FeedScroll,
): readonly SessionActivityEntry[] =>
  scroll.mode === 'live'
    ? entries
    : entries.filter((entry) => entry.seq <= scroll.pinnedThroughSeq);

export const activityMaxOffset = (state: PresentationState): number => {
  const activity = state.activity;
  if (!activity) return 0;
  const session = state.sessions.find(
    (candidate) =>
      candidate.runId === activity.run.runId &&
      candidate.runInstanceId === activity.run.runInstanceId,
  );
  if (!session) return 0;
  const startedAtMs = sessionStartMs(session);
  return maxFeedOffset(
    pinnedEntries(activity.entries, state.activityScroll),
    (entry) =>
      activityEntryRows(entry, contentWidth(state.viewport.columns), state.nowMs, startedAtMs),
    activityFeedHeight(state.viewport.rows),
  );
};

export const sessionViewModel = (state: PresentationState, run: RunIdentity): ScreenModel => {
  const session = state.sessions.find(
    (candidate) => candidate.runId === run.runId && candidate.runInstanceId === run.runInstanceId,
  );
  const width = contentWidth(state.viewport.columns);
  if (!session) {
    return {
      title: 'HEY HEY / session',
      aside: 'Esc back to menu',
      body: [row('This session is no longer on this machine.', 'muted')],
      footer: 'Esc menu',
    };
  }
  const metadata = state.metadata.get(session.runId);
  const resolved = metadata?.runInstanceId === session.runInstanceId ? metadata : undefined;
  const title = sessionTitle(resolved);
  const status = sessionStateLabel(session, state.nowMs);
  const context = sessionContextPath(resolved);
  const handoff = conversationWebHandoff(state.webOrigin, session);

  const activity = state.activity;
  const scroll = state.activityScroll;
  const newerThanPin =
    scroll.mode === 'paused' &&
    (activity?.entries.some((entry) => entry.seq > scroll.pinnedThroughSeq) ?? false);
  const followLabel =
    scroll.mode === 'live'
      ? 'Following live'
      : `Paused${newerThanPin ? ' · new activity below' : ''} · f to follow live`;

  const startedAtMs = sessionStartMs(session);
  const header: Row[] = [
    line([segment(title.text, title.tone, true)], { right: [segment(status.text, status.tone)] }),
    row(context ?? 'No focal entity', context ? 'normal' : 'muted'),
    line([
      segment(providerLabel(session.provider)),
      segment(' · ', 'muted'),
      segment(`Active here ${formatElapsed(state.nowMs - startedAtMs)}`),
      segment(' · ', 'muted'),
      segment('This machine', 'muted'),
    ]),
    state.navigation.notice ? row(state.navigation.notice, 'warning') : row(''),
    heading('ACTIVITY', [segment(followLabel, scroll.mode === 'live' ? 'accent' : 'warning')]),
  ];

  const feedHeight = activityFeedHeight(state.viewport.rows);
  let feed: Row[];
  if (!activity || activity.entries.length === 0) {
    feed = [
      row(
        activity && activity.gap.evictedCount > 0
          ? `Earlier activity is no longer kept (${plural(activity.gap.evictedCount, 'entry', 'entries')}).`
          : 'No activity recorded for this session yet.',
        'muted',
      ),
    ];
  } else {
    const window = layoutFeed(
      pinnedEntries(activity.entries, scroll),
      (entry) => activityEntryRows(entry, width, state.nowMs, startedAtMs),
      feedHeight,
      scroll.mode === 'live' ? 0 : scroll.offset,
    );
    feed = [...window.rows];
    if (!window.moreAbove && activity.gap.evictedCount > 0 && feed.length < feedHeight) {
      feed.unshift(
        row(
          `Earlier activity is no longer kept (${plural(activity.gap.evictedCount, 'entry', 'entries')}).`,
          'muted',
        ),
      );
    }
  }

  return {
    title: 'HEY HEY / session',
    aside: 'Esc back to menu',
    body: [...header, ...feed].slice(0, bodyHeight(state.viewport.rows)),
    footer: `Esc menu  ↑↓ PgUp PgDn scroll  f follow live  ${handoff.available ? 'o open in web' : 'web link unavailable'}  d debug  ·  read-only, recent activity only`,
  };
};
