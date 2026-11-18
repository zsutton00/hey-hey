import { useState } from 'react';
import { render, cleanup } from 'ink-testing-library';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadInk } from '../tui/ink';
import { LocalScreen } from './LocalScreen';
import type { LocalState } from './local-application';

beforeAll(async () => {
  await loadInk();
});
afterEach(cleanup);
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('setup progress detail', () => {
  it('shows combined image download status under the active step', () => {
    const { lastFrame } = render(
      <LocalScreen
        state={{
          kind: 'progress',
          steps: ['Local storage created'],
          current: 'Downloading matching application images',
          detail: {
            kind: 'images',
            bytesDone: 412_000_000,
            bytesTotal: 1_100_000_000,
            percent: 37,
            layersDone: 14,
            layersTotal: 41,
          },
          elapsedMs: 5000,
        }}
        selected={0}
        onSelect={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('412 MB of 1.1 GB (37%) · 14 of 41 layers done');
    expect(lastFrame()).toContain('✓ Local storage created');
  });
});

describe('local terminal states', () => {
  it.each([
    [{ kind: 'installation' }, 'Install and start', 'Cancel'],
    [
      { kind: 'prerequisite', message: 'Install Docker Desktop for Mac, then retry.' },
      'Retry',
      'Cancel',
    ],
    [
      {
        kind: 'recovery',
        message: 'Could not download model_quantized.onnx: HTTP 503. Retry.',
      },
      'Retry',
      'Exit',
    ],
  ] satisfies [LocalState, string, string][])(
    'renders %j with actions delegated through callbacks',
    async (state, confirmLabel, cancelLabel) => {
      const confirm = vi.fn();
      const cancel = vi.fn();
      function Screen() {
        const [selected, select] = useState(0);
        return (
          <LocalScreen
            state={state}
            selected={selected}
            onSelect={select}
            onConfirm={confirm}
            onCancel={cancel}
          />
        );
      }
      const view = render(<Screen />);
      await nextFrame();
      expect(view.lastFrame()).toContain('HEY HEY');
      expect(view.lastFrame()).toContain('LOCAL');
      expect(view.lastFrame()).toContain(confirmLabel);
      expect(view.lastFrame()).toContain(cancelLabel);
      if ('message' in state) {
        expect(view.lastFrame()).toContain(state.message);
      }
      view.stdin.write('\r');
      await nextFrame();
      expect(confirm).toHaveBeenCalledTimes(1);
      view.stdin.write('\u001B[B');
      await nextFrame();
      view.stdin.write('\r');
      await nextFrame();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledTimes(1);
    },
  );

  it('renders completed progress and current service state without offering setup actions', async () => {
    const confirm = vi.fn();
    const view = render(
      <LocalScreen
        state={{
          kind: 'progress',
          steps: ['Docker is ready', 'Local storage created'],
          current: 'Starting application services',
        }}
        selected={0}
        onSelect={vi.fn()}
        onConfirm={confirm}
        onCancel={vi.fn()}
      />,
    );
    await nextFrame();
    expect(view.lastFrame()).toContain('✓ Docker is ready');
    expect(view.lastFrame()).toContain('✓ Local storage created');
    expect(view.lastFrame()).toContain('⋯ Starting application services');
    view.stdin.write('\r');
    await nextFrame();
    expect(confirm).not.toHaveBeenCalled();
  });
});

it('defaults shutdown to Keep running, discloses active work and renders state-derived return commands', async () => {
  const confirm = vi.fn(),
    cancel = vi.fn();
  function Stop() {
    const [selected, select] = useState(0);
    return (
      <LocalScreen
        state={{ kind: 'stop', activeCount: 3, restartCommand: 'custom restart' }}
        selected={selected}
        onSelect={select}
        onConfirm={confirm}
        onCancel={cancel}
      />
    );
  }
  const view = render(<Stop />);
  await nextFrame();
  expect(view.lastFrame()).toContain('3 sessions are active');
  expect(view.lastFrame()).toContain('Your local data will be kept');
  view.stdin.write('\r');
  await nextFrame();
  expect(cancel).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
  view.stdin.write('\u001B[B');
  await nextFrame();
  view.stdin.write('\r');
  await nextFrame();
  expect(confirm).toHaveBeenCalledOnce();
  view.rerender(
    <LocalScreen
      state={{
        kind: 'exited',
        url: 'http://127.0.0.1:8765',
        reconnectCommand: 'custom reconnect',
        stopCommand: 'custom stop',
      }}
      selected={0}
      onSelect={vi.fn()}
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );
  await nextFrame();
  expect(view.lastFrame()).toContain('http://127.0.0.1:8765');
  expect(view.lastFrame()).toContain('custom reconnect');
  expect(view.lastFrame()).toContain('custom stop');
  view.rerender(
    <LocalScreen
      state={{ kind: 'stopped', restartCommand: 'custom restart' }}
      selected={0}
      onSelect={vi.fn()}
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );
  await nextFrame();
  expect(view.lastFrame()).toContain('custom restart');
});

it('renders the reviewed CLI version and exact image set and defaults an update to keeping the current release', async () => {
  const { RELEASE_PLATFORMS } = await import('../release/release-manifest');
  const image = {
    reference: `example.test/image@sha256:${'b'.repeat(64)}`,
    platforms: [...RELEASE_PLATFORMS],
  };
  const cancel = vi.fn(),
    confirm = vi.fn();
  const view = render(
    <LocalScreen
      state={{
        kind: 'update',
        required: false,
        activeCount: 2,
        release: {
          schemaVersion: 1,
          cliVersion: '9.8.7',
          images: { api: image, ui: image, graphSearch: image, postgres: image, redis: image },
        },
      }}
      selected={0}
      onSelect={vi.fn()}
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );
  await nextFrame();
  expect(view.lastFrame()).toContain('9.8.7');
  expect(view.lastFrame()?.replace(/\s/g, '')).toContain(image.reference);
  for (const name of ['api', 'ui', 'graphSearch', 'postgres', 'redis']) {
    expect(view.lastFrame()).toContain(`${name}:`);
  }
  view.stdin.write('\r');
  await nextFrame();
  expect(cancel).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
  view.rerender(
    <LocalScreen
      state={{
        kind: 'ready',
        url: 'http://127.0.0.1:8765',
        reconnectCommand: 'custom reconnect',
        stopCommand: 'custom stop',
        bridgeConnected: false,
        executionAuthorized: false,
      }}
      selected={0}
      onSelect={vi.fn()}
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );
  await nextFrame();
  expect(view.lastFrame()).toContain('http://127.0.0.1:8765');
  expect(view.lastFrame()).toContain('custom reconnect');
  expect(view.lastFrame()).toContain('custom stop');
});

it('requires an explicit repair choice after disclosing that the selected VM stops other containers', async () => {
  const confirm = vi.fn();
  const cancel = vi.fn();
  function Repair() {
    const [selected, select] = useState(0);
    return (
      <LocalScreen
        state={{
          kind: 'docker-repair',
          message: 'Docker refused the model mount.',
          profile: 'work',
        }}
        selected={selected}
        onSelect={select}
        onConfirm={confirm}
        onCancel={cancel}
      />
    );
  }
  const view = render(<Repair />);
  await nextFrame();
  expect(view.lastFrame()).toContain('profile work');
  expect(view.lastFrame()).toContain('stops its other containers');
  view.stdin.write('\r');
  await nextFrame();
  expect(cancel).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
  view.stdin.write('\u001B[B');
  await nextFrame();
  view.stdin.write('\r');
  await nextFrame();
  expect(confirm).toHaveBeenCalledOnce();
});

describe('troubleshooting prompt on screen', () => {
  const prompt = {
    text: [
      '# Help me fix `heyhey local` setup',
      ...Array.from({ length: 40 }, (_, i) => `evidence line ${i}`),
    ].join('\n'),
    savedPath: '/home/dev/.heyhey/local-application/diagnostics/troubleshooting-prompt.md',
    saveFailure: null,
  };

  it('offers the prompt as a third choice after Retry and Exit', async () => {
    const troubleshoot = vi.fn();
    const confirm = vi.fn();
    function Screen() {
      const [selected, select] = useState(0);
      return (
        <LocalScreen
          state={{ kind: 'recovery', message: 'Could not start.' }}
          selected={selected}
          onSelect={select}
          onConfirm={confirm}
          onCancel={vi.fn()}
          onTroubleshoot={troubleshoot}
        />
      );
    }
    const view = render(<Screen />);
    await nextFrame();
    expect(view.lastFrame()).toContain('Get troubleshooting prompt');
    view.stdin.write('\u001B[B');
    await nextFrame();
    view.stdin.write('\u001B[B');
    await nextFrame();
    view.stdin.write('\r');
    await nextFrame();
    expect(troubleshoot).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows the whole prompt, scrolls it, copies it and goes back', async () => {
    const scroll = vi.fn();
    const copy = vi.fn();
    const cancel = vi.fn();
    const state = {
      kind: 'troubleshooting',
      prompt,
      notice: 'Clipboard unavailable (xclip: not installed). Saved to /home/dev/saved.md.',
      offset: 0,
      previous: { kind: 'recovery', message: 'Could not start.' },
    } satisfies LocalState;
    const view = render(
      <LocalScreen
        state={state}
        selected={0}
        onSelect={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={cancel}
        onScroll={scroll}
        onCopy={copy}
      />,
    );
    await nextFrame();
    expect(view.lastFrame()).toContain('# Help me fix `heyhey local` setup');
    expect(view.lastFrame()).toContain('evidence line 0');
    expect(view.lastFrame()).not.toContain('evidence line 39');
    expect(view.lastFrame()).toContain('more line(s) below');
    expect(view.lastFrame()).toContain('Clipboard unavailable (xclip: not installed)');
    view.stdin.write('\u001B[B');
    await nextFrame();
    expect(scroll).toHaveBeenCalledWith(1);
    view.stdin.write('c');
    await nextFrame();
    expect(copy).toHaveBeenCalledOnce();
    view.stdin.write('\u001B');
    await nextFrame();
    await nextFrame();
    expect(cancel).toHaveBeenCalledOnce();
    view.rerender(
      <LocalScreen
        state={{ ...state, offset: 100, notice: null }}
        selected={0}
        onSelect={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={cancel}
      />,
    );
    await nextFrame();
    expect(view.lastFrame()).toContain('evidence line 39');
    expect(view.lastFrame()).toContain(prompt.savedPath);
  });
});
