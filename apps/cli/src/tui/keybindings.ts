/**
 * The terminal's one input layer: maps a key on the active screen to a typed
 * command. Components never register input handlers; the root forwards every
 * key here and hands the command to the presentation owner.
 */

import type { ScreenKind } from './navigation';

/** The key facts the keymaps read; a subset of Ink's `Key`. */
export interface TerminalKey {
  readonly upArrow: boolean;
  readonly downArrow: boolean;
  readonly pageUp: boolean;
  readonly pageDown: boolean;
  readonly home: boolean;
  readonly end: boolean;
  readonly return: boolean;
  readonly escape: boolean;
  readonly ctrl: boolean;
}

export type ScrollAmount = 'line' | 'page' | 'edge';

export type PresentationCommand =
  | { readonly kind: 'move-selection'; readonly delta: -1 | 1 }
  | { readonly kind: 'activate-selection' }
  | { readonly kind: 'open-web' }
  | { readonly kind: 'open-debug' }
  | { readonly kind: 'export-debug' }
  | { readonly kind: 'back' }
  | { readonly kind: 'scroll'; readonly direction: -1 | 1; readonly amount: ScrollAmount }
  | { readonly kind: 'follow-live' }
  | { readonly kind: 'quit' }
  /** Ctrl+C, typed or delivered as SIGINT. */
  | { readonly kind: 'interrupt' }
  | { readonly kind: 'confirm-quit' }
  | { readonly kind: 'answer-review'; readonly approved: boolean };

export interface KeymapContext {
  readonly screen: ScreenKind;
  /** True while a pairing or add-controller ceremony waits for the local review answer. */
  readonly reviewPending: boolean;
}

const scrollCommand = (key: TerminalKey): PresentationCommand | null => {
  if (key.upArrow) return { kind: 'scroll', direction: -1, amount: 'line' };
  if (key.downArrow) return { kind: 'scroll', direction: 1, amount: 'line' };
  if (key.pageUp) return { kind: 'scroll', direction: -1, amount: 'page' };
  if (key.pageDown) return { kind: 'scroll', direction: 1, amount: 'page' };
  if (key.home) return { kind: 'scroll', direction: -1, amount: 'edge' };
  if (key.end) return { kind: 'scroll', direction: 1, amount: 'edge' };
  return null;
};

export const resolveKeyCommand = (
  context: KeymapContext,
  input: string,
  key: TerminalKey,
): PresentationCommand | null => {
  if (key.ctrl && input === 'c') return { kind: 'interrupt' };
  if (key.ctrl) return null;

  switch (context.screen) {
    case 'menu':
      if (key.upArrow) return { kind: 'move-selection', delta: -1 };
      if (key.downArrow) return { kind: 'move-selection', delta: 1 };
      if (key.return) return { kind: 'activate-selection' };
      if (input === 'o') return { kind: 'open-web' };
      if (input === 'd') return { kind: 'open-debug' };
      if (input === 'q') return { kind: 'quit' };
      return null;
    case 'session':
      if (key.escape) return { kind: 'back' };
      if (input === 'f') return { kind: 'follow-live' };
      if (input === 'o') return { kind: 'open-web' };
      if (input === 'd') return { kind: 'open-debug' };
      if (input === 'q') return { kind: 'quit' };
      return scrollCommand(key);
    case 'options':
      if (key.escape) return { kind: 'back' };
      if (key.upArrow) return { kind: 'move-selection', delta: -1 };
      if (key.downArrow) return { kind: 'move-selection', delta: 1 };
      if (key.return) return { kind: 'activate-selection' };
      if (input === 'q') return { kind: 'quit' };
      return null;
    case 'debug':
      if (key.escape) return { kind: 'back' };
      if (input === 'f') return { kind: 'follow-live' };
      if (input === 'e') return { kind: 'export-debug' };
      if (input === 'q') return { kind: 'quit' };
      return scrollCommand(key);
    case 'pairing':
    case 'add-controller':
      if (context.reviewPending && input === 'y') return { kind: 'answer-review', approved: true };
      if (context.reviewPending && input === 'n') return { kind: 'answer-review', approved: false };
      if (key.escape) return { kind: 'back' };
      return null;
    case 'quit-confirmation':
      if (input === 'y' || key.return) return { kind: 'confirm-quit' };
      if (input === 'n' || key.escape) return { kind: 'back' };
      return null;
  }
};
