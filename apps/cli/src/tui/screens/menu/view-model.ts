import type {
  MachineActionDescriptor,
  MachineActionId,
  MachineActionUnavailableReason,
  MachineStatusSnapshot,
} from '../../../commands/machine-actions';
import type { SharedBrowserSnapshot } from '../../browser-source';
import type { LocalSessionSnapshot } from '../../../server/local-session-read-source';
import { MACHINE_ACTION_IDS, menuItems, sameMenuItem, selectedIndex } from '../../menu-items';
import type { MenuItem, PresentationState, RuntimeTarget } from '../../presentation-state';
import { bodyHeight, type ScreenModel } from '../../screen-model';
import {
  providerLabel,
  sessionContextPath,
  sessionStateLabel,
  sessionTitle,
} from '../../session-labels';
import { DIVIDER, heading, line, plural, row, segment, type Row, type Tone } from '../../text';

const ACTION_LABEL: Record<MachineActionId, string> = {
  pair: 'Pair',
  'add-controller': 'Add controller',
  'log-out': 'Log out',
};

const ACTION_HINT: Record<MachineActionId, string> = {
  pair: 'Pair this machine with Hey Hey',
  'add-controller': 'Connect another device',
  'log-out': 'Account only',
};

const UNAVAILABLE_HINT: Record<MachineActionUnavailableReason, string> = {
  'operation-in-progress': 'Another action is running',
  'signed-out': 'Already signed out',
  'machine-not-paired': 'Pair this machine first',
  'machine-authority-unusable': 'Pair this machine again first',
  'already-paired': 'Already paired',
};
const READINESS_LABEL: Record<MachineStatusSnapshot['readiness'], [string, Tone]> = {
  unknown: ['unknown', 'muted'],
  ready: ['ready', 'success'],
  unpaired: ['not paired', 'warning'],
  'legacy-controller-enrollment-required': ['controller re-enrollment needed', 'warning'],
  'enrollment-pending': ['enrollment pending', 'warning'],
  'no-controller': ['no controller', 'warning'],
  'machine-revoked': ['machine revoked', 'danger'],
  'machine-unrecognized': ['machine not recognized', 'danger'],
  'locally-inconsistent': ['local state inconsistent', 'danger'],
};

const ACCOUNT_LABEL: Record<MachineStatusSnapshot['account'], [string, Tone]> = {
  unknown: ['checking', 'muted'],
  'signed-in': ['signed in', 'success'],
  'signed-out': ['signed out', 'warning'],
};

const CONNECTION_LABEL: Record<MachineStatusSnapshot['connection'], [string, Tone]> = {
  connected: ['connected', 'success'],
  connecting: ['connecting', 'muted'],
  disconnected: ['disconnected', 'warning'],
  revoked: ['revoked', 'danger'],
};

const statusRows = (state: PresentationState): Row[] => {
  const machine = state.machine;
  switch (state.startup.kind) {
    case 'starting':
      return [row('Starting Hey Hey…', 'muted')];
    case 'stopping':
      return [row('Stopping Hey Hey…', 'warning', true)];
    case 'failed':
      return [row(state.startup.heading, 'danger', true), row(state.startup.body)];
    case 'running':
      break;
  }
  if (machine === null) return [row('Status unavailable', 'muted')];
  const [account, accountTone] = ACCOUNT_LABEL[machine.account];
  const [connection, connectionTone] = CONNECTION_LABEL[machine.connection];
  const [readiness, readinessTone] = READINESS_LABEL[machine.readiness];
  // One line; each fact keeps its own tone and its words read without color.
  return [
    line([
      segment('Account ', 'muted'),
      segment(account, accountTone),
      segment('   Machine ', 'muted'),
      segment(connection, connectionTone),
      segment('   Execution ', 'muted'),
      segment(readiness, readinessTone),
      ...targetSegments(state.target),
    ]),
  ];
};

const STAGING_API_HOST = 'staging.heyhey.dev';

const environmentLabel = (host: string): string => (host === STAGING_API_HOST ? 'Staging' : host);

/** Shown only when the CLI is not on the default profile and production target. */
const targetSegments = (target: RuntimeTarget) => [
  ...(target.profile === null ? [] : [segment('   Profile ', 'muted'), segment(target.profile)]),
  ...(target.environment === null
    ? []
    : [segment('   Environment ', 'muted'), segment(environmentLabel(target.environment))]),
];

const actionRow = (
  descriptor: MachineActionDescriptor | undefined,
  id: MachineActionId,
  selected: boolean,
): Row => {
  const label = ACTION_LABEL[id];
  if (!descriptor) {
    return line([segment(label, 'muted')], { right: [segment('Starting…', 'muted')], selected });
  }
  if (!descriptor.availability.available) {
    return line([segment(label, 'muted')], {
      right: [segment(UNAVAILABLE_HINT[descriptor.availability.reason], 'muted')],
      selected,
    });
  }
  return line([segment(label, selected ? 'accent' : 'normal', selected)], {
    right: [segment(ACTION_HINT[id], 'muted')],
    selected,
  });
};

const sharedBrowserRows = (
  sharedBrowser: SharedBrowserSnapshot,
  isSelected: (item: MenuItem) => boolean,
): Row[] => {
  const toggleSelected = isSelected({ kind: 'browser-toggle' });
  const toggle: Row = line(
    [segment('Shared Browser', toggleSelected ? 'accent' : 'normal', toggleSelected)],
    {
      right:
        sharedBrowser.enabled === null
          ? [segment('Checking…', 'muted')]
          : sharedBrowser.enabled
            ? [segment('On', 'success'), segment('   Enter to turn off', 'muted')]
            : [segment('Off', 'warning'), segment('   Enter to turn on', 'muted')],
      selected: toggleSelected,
    },
  );
  const projects = sharedBrowser.projects.map((project): Row => {
    const selected = isSelected({ kind: 'browser', projectId: project.projectId });
    const running = project.status === 'running';
    return line(
      [
        segment(
          project.name ?? `Project ${project.projectId}`,
          selected ? 'accent' : running ? 'normal' : 'muted',
          selected,
        ),
      ],
      {
        right: running
          ? [segment('running', 'success'), segment('   Enter to close', 'muted')]
          : [segment('stopped', 'muted')],
        selected,
        indent: 3,
      },
    );
  });
  return [toggle, ...projects];
};

const sessionRows = (
  state: PresentationState,
  session: LocalSessionSnapshot,
  selected: boolean,
): Row[] => {
  const metadata = state.metadata.get(session.runId);
  const resolvedMetadata = metadata?.runInstanceId === session.runInstanceId ? metadata : undefined;
  const title = sessionTitle(resolvedMetadata);
  const status = sessionStateLabel(session, state.nowMs);
  const context = sessionContextPath(resolvedMetadata);
  const detail = [context, providerLabel(session.provider)]
    .filter((part) => part !== null)
    .join(' · ');
  return [
    line([segment(title.text, selected ? 'accent' : title.tone, selected)], {
      right: [segment(status.text, status.tone)],
      selected,
    }),
    line([segment(detail, 'muted')], { indent: 3 }),
  ];
};

const SESSION_SPACER: Row = line([]);

const sessionRowPrefix = (blocks: Row[][]): number[] => {
  const prefix = [0];
  for (const block of blocks) prefix.push((prefix.at(-1) ?? 0) + block.length);
  return prefix;
};

const sessionWindowRows = (blocks: Row[][], first: number, last: number): Row[] =>
  blocks
    .slice(first, last)
    .flatMap((block, index) => (index === 0 ? block : [SESSION_SPACER, ...block]));

const sessionWindowCost = (
  rowPrefix: readonly number[],
  first: number,
  last: number,
  includeOverflowRows: boolean,
): number => {
  const visibleCount = last - first;
  const rows = (rowPrefix[last] ?? 0) - (rowPrefix[first] ?? 0);
  const spacers = Math.max(0, visibleCount - 1);
  const overflowRows = includeOverflowRows
    ? Number(first > 0) + Number(last < rowPrefix.length - 1)
    : 0;
  return rows + spacers + overflowRows;
};

/**
 * Keeps the selected session visible when the list is longer than the space
 * left for it, marking what is scrolled out of view.
 */
const fitSessions = (blocks: Row[][], selectedBlock: number, height: number): Row[] => {
  const rowPrefix = sessionRowPrefix(blocks);
  if (sessionWindowCost(rowPrefix, 0, blocks.length, false) <= height) {
    return sessionWindowRows(blocks, 0, blocks.length);
  }

  let first = selectedBlock;
  let last = selectedBlock + 1;

  while (true) {
    const canAddBefore = first > 0;
    const canAddAfter = last < blocks.length;
    if (!canAddBefore && !canAddAfter) break;

    const beforeCost = canAddBefore
      ? sessionWindowCost(rowPrefix, first - 1, last, true)
      : Number.POSITIVE_INFINITY;
    const afterCost = canAddAfter
      ? sessionWindowCost(rowPrefix, first, last + 1, true)
      : Number.POSITIVE_INFINITY;
    const preferBefore = selectedBlock - first <= last - selectedBlock - 1;
    const nextBefore = beforeCost <= height && (afterCost > height || preferBefore);
    if (nextBefore) {
      first -= 1;
      continue;
    }
    if (afterCost <= height) {
      last += 1;
      continue;
    }
    break;
  }

  const rows = sessionWindowRows(blocks, first, last);
  const above = first > 0;
  const below = last < blocks.length;
  const remainingRows = height - rows.length;
  let showAbove = above && remainingRows >= 1;
  let showBelow = below && remainingRows >= 1;
  // A very short session region may fit only one marker. Keep the one for the
  // larger hidden side so the selected session remains visible.
  if (showAbove && showBelow && remainingRows === 1) {
    if (first >= blocks.length - last) showBelow = false;
    else showAbove = false;
  }
  const aboveRow = line([segment(`↑ ${plural(first, 'more session')}`, 'muted')], { indent: 3 });
  const belowRow = line([segment(`↓ ${plural(blocks.length - last, 'more session')}`, 'muted')], {
    indent: 3,
  });
  return [...(showAbove ? [aboveRow] : []), ...rows, ...(showBelow ? [belowRow] : [])];
};

export const menuViewModel = (state: PresentationState): ScreenModel => {
  const items = menuItems(state);
  const selected = items[selectedIndex(items, state.selection)] ?? null;
  const isSelected = (item: MenuItem): boolean => selected !== null && sameMenuItem(item, selected);

  const head: Row[] = [...statusRows(state)];
  if (state.navigation.notice) head.push(row(state.navigation.notice, 'warning'));
  head.push(
    DIVIDER,
    heading('SESSIONS ON THIS MACHINE', [segment(String(state.sessions.length), 'muted')]),
  );

  const tail: Row[] = [DIVIDER, heading('MACHINE')];
  for (const id of MACHINE_ACTION_IDS) {
    const descriptor = state.machine?.actions.find((action) => action.id === id);
    tail.push(actionRow(descriptor, id, isSelected({ kind: 'action', id })));
  }
  if (state.sharedBrowser) {
    tail.push(
      DIVIDER,
      heading('SHARED BROWSER'),
      ...sharedBrowserRows(state.sharedBrowser, isSelected),
    );
  }
  const optionsSelected = isSelected({ kind: 'options' });
  const debugSelected = isSelected({ kind: 'debug' });
  tail.push(
    DIVIDER,
    heading('OPTIONS'),
    line([segment('Options', optionsSelected ? 'accent' : 'normal', optionsSelected)], {
      right: [segment('Choose how agents work on this machine', 'muted')],
      selected: optionsSelected,
    }),
    DIVIDER,
    heading('DIAGNOSTICS'),
    line([segment('Debug logs', debugSelected ? 'accent' : 'normal', debugSelected)], {
      right: [segment('View CLI diagnostics', 'muted')],
      selected: debugSelected,
    }),
  );

  let sessionBlock: Row[];
  if (state.sessions.length === 0) {
    sessionBlock = [
      line(
        [
          segment(
            state.startup.kind === 'running'
              ? 'No sessions on this machine'
              : 'Sessions appear once Hey Hey has started',
            'muted',
          ),
        ],
        { indent: 3 },
      ),
    ];
  } else {
    const blocks = state.sessions.map((session) =>
      sessionRows(
        state,
        session,
        isSelected({
          kind: 'session',
          run: { runId: session.runId, runInstanceId: session.runInstanceId },
        }),
      ),
    );
    const selectedBlock =
      selected?.kind === 'session'
        ? state.sessions.findIndex((session) => session.runId === selected.run.runId)
        : 0;
    const room = bodyHeight(state.viewport.rows) - head.length - tail.length;
    sessionBlock = fitSessions(blocks, Math.max(0, selectedBlock), Math.max(3, room));
  }

  return {
    title: 'HEY HEY',
    aside: 'This machine',
    body: [...head, ...sessionBlock, ...tail].slice(0, bodyHeight(state.viewport.rows)),
    footer:
      selected?.kind === 'session'
        ? '↑↓ move  Enter open  o open in web  d debug  q quit'
        : '↑↓ move  Enter select  d debug  q quit',
  };
};
