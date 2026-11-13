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
