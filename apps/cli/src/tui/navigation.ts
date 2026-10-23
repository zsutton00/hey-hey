/**
 * The terminal's one navigation model: a closed screen union held in a stack
 * and changed only by this pure reducer. There is no navigation context, no
 * per-screen navigation hook and nothing is persisted across restarts.
 */

/** A Run as the session sources identify it; a replacement Run is a different identity. */
export interface RunIdentity {
  readonly runId: string;
  readonly runInstanceId: number;
}

export type Screen =
  | { readonly kind: 'menu' }
  | { readonly kind: 'session'; readonly run: RunIdentity }
  | { readonly kind: 'debug' }
  | { readonly kind: 'options' }
  | { readonly kind: 'pairing' }
  | { readonly kind: 'add-controller' }
  | { readonly kind: 'quit-confirmation' };

export type ScreenKind = Screen['kind'];

export interface NavigationState {
  /** Bottom is always the menu. */
  readonly stack: readonly [Screen, ...Screen[]];
  /** A short explanation shown on the menu, e.g. why a session closed. */
  readonly notice: string | null;
}

export type NavigationCommand =
  | { readonly kind: 'open'; readonly screen: Screen }
  | { readonly kind: 'back' }
  | { readonly kind: 'replace'; readonly screen: Screen }
  | { readonly kind: 'run-removed'; readonly run: RunIdentity }
  | { readonly kind: 'notice'; readonly message: string | null };

export const SESSION_REMOVED_NOTICE = 'That session ended and left this machine.';

export const initialNavigation = (): NavigationState => ({
  stack: [{ kind: 'menu' }],
  notice: null,
});

export const topScreen = (state: NavigationState): Screen =>
  state.stack[state.stack.length - 1] ?? state.stack[0];

const sameRun = (left: RunIdentity, right: RunIdentity): boolean =>
  left.runId === right.runId && left.runInstanceId === right.runInstanceId;

const withStack = (state: NavigationState, rest: readonly Screen[]): NavigationState => ({
  stack: [state.stack[0], ...rest],
  notice: state.notice,
});

export const navigate = (state: NavigationState, command: NavigationCommand): NavigationState => {
  const above = state.stack.slice(1);
  switch (command.kind) {
    case 'open': {
      if (command.screen.kind === 'menu') return { stack: [state.stack[0]], notice: null };
      // A screen is open at most once; reopening brings it back to the top.
      const kept = above.filter((screen) => screen.kind !== command.screen.kind);
      return { stack: [state.stack[0], ...kept, command.screen], notice: null };
    }
    case 'back':
      return above.length === 0 ? state : withStack(state, above.slice(0, -1));
    case 'replace':
      if (above.length === 0 || command.screen.kind === 'menu') {
        return navigate(state, { kind: 'open', screen: command.screen });
      }
      return withStack(state, [...above.slice(0, -1), command.screen]);
    case 'run-removed': {
      const kept = above.filter(
        (screen) => screen.kind !== 'session' || !sameRun(screen.run, command.run),
      );
      if (kept.length === above.length) return state;
      return { stack: [state.stack[0], ...kept], notice: SESSION_REMOVED_NOTICE };
    }
    case 'notice':
      return { stack: state.stack, notice: command.message };
  }
};
