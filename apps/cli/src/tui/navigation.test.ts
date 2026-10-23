import { describe, expect, it } from 'vitest';
import { initialNavigation, navigate, SESSION_REMOVED_NOTICE, topScreen } from './navigation';

const run = { runId: 'run-1', runInstanceId: 1 };

describe('navigate', () => {
  it('opens the Options screen once and goes back to the menu', () => {
    let state = navigate(initialNavigation(), { kind: 'open', screen: { kind: 'options' } });
    state = navigate(state, { kind: 'open', screen: { kind: 'options' } });
    expect(state.stack.map((screen) => screen.kind)).toEqual(['menu', 'options']);
    expect(navigate(state, { kind: 'back' }).stack.map((screen) => screen.kind)).toEqual(['menu']);
  });

  it('opens, goes back and never pops the menu', () => {
    let state = navigate(initialNavigation(), { kind: 'open', screen: { kind: 'session', run } });
    state = navigate(state, { kind: 'open', screen: { kind: 'debug' } });
    expect(state.stack.map((screen) => screen.kind)).toEqual(['menu', 'session', 'debug']);
    state = navigate(state, { kind: 'back' });
    expect(topScreen(state)).toEqual({ kind: 'session', run });
    state = navigate(navigate(state, { kind: 'back' }), { kind: 'back' });
    expect(state.stack).toEqual([{ kind: 'menu' }]);
  });

  it('keeps each screen at most once and moves a reopened screen to the top', () => {
    let state = navigate(initialNavigation(), { kind: 'open', screen: { kind: 'debug' } });
    state = navigate(state, { kind: 'open', screen: { kind: 'session', run } });
    state = navigate(state, { kind: 'open', screen: { kind: 'debug' } });
    expect(state.stack.map((screen) => screen.kind)).toEqual(['menu', 'session', 'debug']);
  });

  it('replaces the top screen', () => {
    const state = navigate(
      navigate(initialNavigation(), { kind: 'open', screen: { kind: 'pairing' } }),
      { kind: 'replace', screen: { kind: 'add-controller' } },
    );
    expect(state.stack.map((screen) => screen.kind)).toEqual(['menu', 'add-controller']);
  });

  it('returns from a removed Run with a short explanation', () => {
    const state = navigate(
      navigate(initialNavigation(), { kind: 'open', screen: { kind: 'session', run } }),
      { kind: 'run-removed', run },
    );
    expect(state.stack).toEqual([{ kind: 'menu' }]);
    expect(state.notice).toBe(SESSION_REMOVED_NOTICE);
  });

  it('ignores removal of a different Run instance under the same runId', () => {
    const opened = navigate(initialNavigation(), {
      kind: 'open',
      screen: { kind: 'session', run },
    });
    const state = navigate(opened, {
      kind: 'run-removed',
      run: { runId: 'run-1', runInstanceId: 2 },
    });
    expect(state).toBe(opened);
  });

  it('keeps a quit confirmation open when the session under it is removed', () => {
    let state = navigate(initialNavigation(), { kind: 'open', screen: { kind: 'session', run } });
    state = navigate(state, { kind: 'open', screen: { kind: 'quit-confirmation' } });
    state = navigate(state, { kind: 'run-removed', run });
    expect(state.stack.map((screen) => screen.kind)).toEqual(['menu', 'quit-confirmation']);
  });

  it('clears the notice when another screen opens', () => {
    const noticed = navigate(initialNavigation(), { kind: 'notice', message: 'Hello' });
    expect(navigate(noticed, { kind: 'open', screen: { kind: 'debug' } }).notice).toBeNull();
  });
});
