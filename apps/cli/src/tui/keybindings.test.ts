import { describe, expect, it } from 'vitest';
import { resolveKeyCommand, type KeymapContext, type TerminalKey } from './keybindings';

const NO_KEY: TerminalKey = {
  upArrow: false,
  downArrow: false,
  pageUp: false,
  pageDown: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
};

const key = (overrides: Partial<TerminalKey>): TerminalKey => ({ ...NO_KEY, ...overrides });
const on = (screen: KeymapContext['screen'], reviewPending = false): KeymapContext => ({
  screen,
  reviewPending,
});

describe('resolveKeyCommand', () => {
  it('maps Ctrl+C to interrupt on every screen', () => {
    for (const screen of [
      'menu',
      'session',
      'debug',
      'options',
      'pairing',
      'add-controller',
      'quit-confirmation',
    ] as const) {
      expect(resolveKeyCommand(on(screen), 'c', key({ ctrl: true }))).toEqual({
        kind: 'interrupt',
      });
    }
  });

  it('moves and activates on the menu', () => {
    expect(resolveKeyCommand(on('menu'), '', key({ downArrow: true }))).toEqual({
      kind: 'move-selection',
      delta: 1,
    });
    expect(resolveKeyCommand(on('menu'), '', key({ return: true }))).toEqual({
      kind: 'activate-selection',
    });
    expect(resolveKeyCommand(on('menu'), 'o', NO_KEY)).toEqual({ kind: 'open-web' });
    expect(resolveKeyCommand(on('menu'), 'q', NO_KEY)).toEqual({ kind: 'quit' });
    expect(resolveKeyCommand(on('menu'), '', key({ escape: true }))).toBeNull();
  });

  it('scrolls and follows live on the session and Debug screens', () => {
    expect(resolveKeyCommand(on('session'), '', key({ pageUp: true }))).toEqual({
      kind: 'scroll',
      direction: -1,
      amount: 'page',
    });
    expect(resolveKeyCommand(on('debug'), '', key({ upArrow: true }))).toEqual({
      kind: 'scroll',
      direction: -1,
      amount: 'line',
    });
    expect(resolveKeyCommand(on('session'), 'f', NO_KEY)).toEqual({ kind: 'follow-live' });
    expect(resolveKeyCommand(on('debug'), 'e', NO_KEY)).toEqual({ kind: 'export-debug' });
    expect(resolveKeyCommand(on('session'), '', key({ escape: true }))).toEqual({ kind: 'back' });
    expect(resolveKeyCommand(on('debug'), 'o', NO_KEY)).toBeNull();
  });

  it('moves, switches, goes back and quits on the Options screen', () => {
    expect(resolveKeyCommand(on('options'), '', key({ upArrow: true }))).toEqual({
      kind: 'move-selection',
      delta: -1,
    });
    expect(resolveKeyCommand(on('options'), '', key({ downArrow: true }))).toEqual({
      kind: 'move-selection',
      delta: 1,
    });
    expect(resolveKeyCommand(on('options'), '', key({ return: true }))).toEqual({
      kind: 'activate-selection',
    });
    expect(resolveKeyCommand(on('options'), '', key({ escape: true }))).toEqual({ kind: 'back' });
    expect(resolveKeyCommand(on('options'), 'q', NO_KEY)).toEqual({ kind: 'quit' });
    expect(resolveKeyCommand(on('options'), 'o', NO_KEY)).toBeNull();
  });

  it('accepts review answers only while a review is pending', () => {
    expect(resolveKeyCommand(on('pairing'), 'y', NO_KEY)).toBeNull();
    expect(resolveKeyCommand(on('pairing', true), 'y', NO_KEY)).toEqual({
      kind: 'answer-review',
      approved: true,
    });
    expect(resolveKeyCommand(on('add-controller', true), 'n', NO_KEY)).toEqual({
      kind: 'answer-review',
      approved: false,
    });
    expect(resolveKeyCommand(on('pairing'), 'q', NO_KEY)).toBeNull();
  });

  it('confirms or cancels quitting', () => {
    expect(resolveKeyCommand(on('quit-confirmation'), 'y', NO_KEY)).toEqual({
      kind: 'confirm-quit',
    });
    expect(resolveKeyCommand(on('quit-confirmation'), '', key({ return: true }))).toEqual({
      kind: 'confirm-quit',
    });
    expect(resolveKeyCommand(on('quit-confirmation'), 'n', NO_KEY)).toEqual({ kind: 'back' });
    expect(resolveKeyCommand(on('quit-confirmation'), '', key({ escape: true }))).toEqual({
      kind: 'back',
    });
  });
});
