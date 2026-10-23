import { render } from 'ink-testing-library';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadInk } from './ink';
import { createOwner, FakeSources, metadata, session } from './presentation.test-support';
import { PresentationRoot, RootErrorBoundary } from './root';

const ARROW_DOWN = '\u001B[B';
const ARROW_UP = '\u001B[A';

/** Lets the owner publish its frame and Ink commit it. */
const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

const mounted = (sessions = [session()]) => {
  const fake = new FakeSources();
  fake.sessionList = sessions;
  fake.metadataList = sessions.map((listed, index) =>
    metadata({
      runId: listed.runId,
      conversationId: listed.conversationId,
      title: {
        status: 'available',
        value: index === 0 ? 'Investigate a failing build' : `Session ${String(index + 1)}`,
        fetchedAt: '',
      },
    }),
  );
  const { owner } = createOwner({ frameIntervalMs: 0, now: Date.now });
  owner.attach(fake.sources);
  const view = render(<PresentationRoot owner={owner} />);
  return { fake, owner, view };
};

describe('PresentationRoot (Ink)', () => {
  const cleanups: Array<() => void> = [];

  beforeAll(async () => {
    await loadInk();
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('renders the menu without color codes when color is off', async () => {
    const { owner, view } = mounted();
    cleanups.push(
      () => view.unmount(),
      () => owner.dispose(),
    );
    await nextFrame();
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('HEY HEY');
    expect(frame).toMatch(/SESSIONS ON THIS MACHINE +1/u);
    expect(frame).toContain('Investigate a failing build');
    expect(frame).not.toContain('\u001B');
    // Content keeps a compact width and the key hints follow it directly.
    const lines = frame.split('\n');
    expect(Math.max(...lines.map((text) => text.length))).toBeLessThanOrEqual(100);
    expect(lines.at(-1)).toMatch(/^↑↓ move/u);
    expect(lines.at(-2)).toMatch(/^─+$/u);
  });

  it('renders one blank line between session entries only', async () => {
    const { owner, view } = mounted([
      session(),
      session({ runId: 'run-2', conversationId: 'conversation-2' }),
    ]);
    cleanups.push(
      () => view.unmount(),
      () => owner.dispose(),
    );
    await nextFrame();

    const lines = (view.lastFrame() ?? '').split('\n');
    const section = lines.findIndex((text) => text.includes('SESSIONS ON THIS MACHINE'));
    const first = lines.findIndex((text) => text.includes('Investigate a failing build'));
    const second = lines.findIndex((text) => text.includes('Session 2'));
    expect(first).toBe(section + 1);
    expect(lines[first + 1]).toMatch(/Claude|Codex/u);
    expect(lines[first + 2]?.trim()).toBe('');
    expect(lines[second - 2]).toMatch(/Claude|Codex/u);
    expect(lines[second - 1]?.trim()).toBe('');
    expect(lines[second + 1]).toMatch(/Claude|Codex/u);
    expect(lines[second + 2]).toMatch(/^─+$/u);
  });

  it('routes keys through the keybinding layer to open a session', async () => {
    const { owner, view, fake } = mounted();
    cleanups.push(
      () => view.unmount(),
      () => owner.dispose(),
    );
    await nextFrame();
    // The cursor starts on the first session; Down then Up returns to it.
    view.stdin.write(ARROW_DOWN);
    await nextFrame();
    view.stdin.write(ARROW_UP);
    await nextFrame();
    view.stdin.write('\r');
    await nextFrame();
    expect(view.lastFrame()).toContain('HEY HEY / session');
    expect(view.lastFrame()).toMatch(/ACTIVITY +Following live/u);
    expect(fake.activityObservers.size).toBe(1);

    view.stdin.write('\u001B');
    await nextFrame();
    await nextFrame();
    expect(view.lastFrame()).toContain('SESSIONS ON THIS MACHINE');
    expect(fake.activityObservers.size).toBe(0);
  });

  it('opens Options from the menu, switches Intent-first and returns', async () => {
    const { owner, view, fake } = mounted([]);
    cleanups.push(
      () => view.unmount(),
      () => owner.dispose(),
    );
    await nextFrame();
    expect(view.lastFrame()).toContain('Choose how agents work on this machine');

    // Pair, Add controller, Log out, Shared Browser, Options.
    for (let step = 0; step < 5; step += 1) view.stdin.write(ARROW_DOWN);
    view.stdin.write('\r');
    await nextFrame();
    expect(view.lastFrame()).toContain('AGENTS');
    expect(view.lastFrame()).toMatch(/Intent-first \(experimental\) +Off +Enter to turn on/u);

    view.stdin.write('\r');
    await nextFrame();
    expect(fake.setIntentFirst).toHaveBeenCalledWith(true);
    expect(view.lastFrame()).toMatch(/Intent-first \(experimental\) +On +Enter to turn off/u);

    view.stdin.write('\u001B');
    await nextFrame();
    expect(view.lastFrame()).toContain('SESSIONS ON THIS MACHINE');
  });

  it('shows a notice below the minimum size and recovers on resize', async () => {
    const { owner, view } = mounted();
    cleanups.push(
      () => view.unmount(),
      () => owner.dispose(),
    );
    owner.resize({ columns: 40, rows: 10 });
    await nextFrame();
    expect(view.lastFrame()).toContain('Terminal too small');
    owner.resize({ columns: 100, rows: 30 });
    await nextFrame();
    expect(view.lastFrame()).toContain('SESSIONS ON THIS MACHINE');
  });

  it('draws at most the viewport height while streaming high-volume output', async () => {
    const { owner, view, fake } = mounted();
    cleanups.push(
      () => view.unmount(),
      () => owner.dispose(),
    );
    owner.resize({ columns: 80, rows: 20 });
    owner.dispatch({ kind: 'activate-selection' });
    const { tool } = await import('./presentation.test-support');
    const output = Array.from({ length: 2_000 }, (_, index) => `out ${String(index)}`).join('\n');
    fake.emitActivity('run-1', tool(1, { output: { text: output, truncatedBytes: 0 } }));
    await nextFrame();
    const frame = view.lastFrame() ?? '';
    expect(frame.split('\n').length).toBeLessThan(20);
    expect(frame).toContain('out 1999');
    expect(frame).not.toContain('out 1000\n');
  });

  it('reports a render failure through the error boundary', async () => {
    const onRenderError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = (): never => {
      throw new Error('render exploded');
    };
    const view = render(
      <RootErrorBoundary onRenderError={onRenderError}>
        <Broken />
      </RootErrorBoundary>,
    );
    cleanups.push(
      () => view.unmount(),
      () => consoleError.mockRestore(),
    );
    await nextFrame();
    expect(onRenderError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'render exploded' }),
    );
    expect(view.lastFrame()).toBe('');
  });
});
