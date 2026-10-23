import type { MachineActionId } from '../commands/machine-actions';
import type { MenuItem, PresentationState } from './presentation-state';

/** Machine actions keep a stable order whether or not their owner is running yet. */
export const MACHINE_ACTION_IDS: readonly MachineActionId[] = ['pair', 'add-controller', 'log-out'];

/**
 * Sessions first, then the machine actions, then Shared Browser (the toggle,
 * then one row per known project), then Options, then Debug.
 */
export const menuItems = (
  state: Pick<PresentationState, 'sessions' | 'sharedBrowser'>,
): MenuItem[] => [
  ...state.sessions.map(
    (session): MenuItem => ({
      kind: 'session',
      run: { runId: session.runId, runInstanceId: session.runInstanceId },
    }),
  ),
  ...MACHINE_ACTION_IDS.map((id): MenuItem => ({ kind: 'action', id })),
  ...(state.sharedBrowser
    ? [
        { kind: 'browser-toggle' } as const,
        ...state.sharedBrowser.projects.map(
          (project): MenuItem => ({ kind: 'browser', projectId: project.projectId }),
        ),
      ]
    : []),
  { kind: 'options' },
  { kind: 'debug' },
];

export const sameMenuItem = (left: MenuItem, right: MenuItem): boolean => {
  switch (left.kind) {
    case 'action':
      return right.kind === 'action' && right.id === left.id;
    case 'session':
      return (
        right.kind === 'session' &&
        right.run.runId === left.run.runId &&
        right.run.runInstanceId === left.run.runInstanceId
      );
    case 'browser-toggle':
      return right.kind === 'browser-toggle';
    case 'browser':
      return right.kind === 'browser' && right.projectId === left.projectId;
    case 'options':
      return right.kind === 'options';
    case 'debug':
      return right.kind === 'debug';
  }
};

/**
 * Index of the selected item. An absent or departed selection resolves to the
 * first session, or to -1 (nothing selected) when there are no sessions: the
 * cursor never starts on a machine action.
 */
export const selectedIndex = (items: readonly MenuItem[], selection: MenuItem | null): number => {
  const index = selection === null ? -1 : items.findIndex((item) => sameMenuItem(item, selection));
  if (index !== -1) return index;
  return items[0]?.kind === 'session' ? 0 : -1;
};
