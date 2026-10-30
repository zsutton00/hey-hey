import type { SharedBrowserProject } from './browser-source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiagnosticFeed } from '../server/diagnostic-feed';
import { topScreen, SESSION_REMOVED_NOTICE } from './navigation';
import {
  createOwner,
  FakeSources,
  flushFrame,
  narration,
  NOW,
  session,
  startedCeremony,
} from './presentation.test-support';

const run1 = { runId: 'run-1', runInstanceId: 1 };

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(60);
};

describe('PresentationOwner', () => {
  it('keeps incident entries when routine entries are removed and updates an idle Debug view on expiry', () => {
    const feed = new DiagnosticFeed(
      { maxRecords: 1, maxBytes: 1024, maxRecordTextBytes: 128 },
      () => Date.now(),
    );
    const { owner } = createOwner({ diagnostics: feed });
    const capture = (stream: 'stdout' | 'stderr', text: string) =>
      feed.capture({ stream, source: 'write', text, timestamp: new Date().toISOString() });
    owner.dispatch({ kind: 'open-debug' });
    capture('stderr', 'approval');
    capture('stdout', 'old routine');
    capture('stdout', 'new routine');
    flushFrame();
    expect(owner.getSnapshot().diagnostics?.records.map((record) => record.text)).toEqual([
      'approval',
      'new routine',
    ]);
    expect(owner.getSnapshot().diagnostics?.losses.routine.evicted).toBe(1);
    vi.advanceTimersByTime(7_200_000);
    flushFrame();
    expect(owner.getSnapshot().diagnostics?.records).toEqual([]);
    expect(owner.getSnapshot().diagnostics?.expiredCount).toBe(2);
    owner.dispose();
    feed.dispose();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const attached = (sessions = [session()]) => {
    const fake = new FakeSources();
    fake.sessionList = [...sessions];
    const created = createOwner();
    created.owner.attach(fake.sources);
    flushFrame();
    return { fake, ...created };
  };

  it('publishes a burst of updates at most once per frame', () => {
    const { owner, fake } = attached();
    owner.dispatch({ kind: 'activate-selection' });
    flushFrame();
    expect(topScreen(owner.getSnapshot().navigation)).toEqual({ kind: 'session', run: run1 });

    const listener = vi.fn();
    owner.subscribe(listener);
    for (let seq = 1; seq <= 200; seq += 1)
      fake.emitActivity('run-1', narration(seq, `chunk ${String(seq)}`));
    expect(listener).not.toHaveBeenCalled();
    flushFrame();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().activity?.entries).toHaveLength(200);
    owner.dispose();
  });

  it('keeps the selection on the same Run as the list changes', () => {
    const { owner, fake } = attached([
      session(),
      session({ runId: 'run-2', conversationId: 'c-2' }),
    ]);
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    flushFrame();
    expect(owner.getSnapshot().selection).toEqual({
      kind: 'session',
      run: { runId: 'run-2', runInstanceId: 1 },
    });
    fake.register(session({ runId: 'run-0', conversationId: 'c-0' }));
    fake.update(session({ runId: 'run-2', conversationId: 'c-2', hasActiveWork: false }));
    flushFrame();
    expect(owner.getSnapshot().selection).toEqual({
      kind: 'session',
      run: { runId: 'run-2', runInstanceId: 1 },
    });
    // Removing the selected Run keeps the selection at its position.
    fake.remove('run-2');
    flushFrame();
    expect(owner.getSnapshot().selection).toEqual({
      kind: 'session',
      run: { runId: 'run-0', runInstanceId: 1 },
    });
    owner.dispose();
  });

  it('starts with nothing selected without sessions; Down, Up and Enter work from nothing', () => {
    const { owner, fake } = attached([]);
    expect(owner.getSnapshot().selection).toBeNull();
    owner.dispatch({ kind: 'activate-selection' });
    expect(fake.startAction).not.toHaveBeenCalled();
    expect(topScreen(owner.getSnapshot().navigation)).toEqual({ kind: 'menu' });
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    flushFrame();
    expect(owner.getSnapshot().selection).toEqual({ kind: 'action', id: 'pair' });

    const fromNothing = attached([]);
    fromNothing.owner.dispatch({ kind: 'move-selection', delta: -1 });
    flushFrame();
    expect(fromNothing.owner.getSnapshot().selection).toEqual({ kind: 'debug' });
    fromNothing.owner.dispose();
    owner.dispose();
  });

  it('selects nothing when the last session leaves while selected', () => {
    const { owner, fake } = attached();
    owner.dispatch({ kind: 'activate-selection' });
    owner.dispatch({ kind: 'back' });
    fake.remove('run-1');
    flushFrame();
    expect(owner.getSnapshot().selection).toBeNull();
    owner.dispose();
  });

  it('declares display interest for the sessions on screen only', () => {
    const { owner, fake } = attached([
      session(),
      session({ runId: 'run-2', conversationId: 'c-2' }),
    ]);
    expect(fake.setDisplayInterest).toHaveBeenLastCalledWith(['run-1', 'run-2']);
    owner.dispatch({ kind: 'activate-selection' });
    expect(fake.setDisplayInterest).toHaveBeenLastCalledWith(['run-1']);
    owner.dispatch({ kind: 'open-debug' });
    expect(fake.setDisplayInterest).toHaveBeenLastCalledWith([]);
    owner.dispose();
  });

  it('subscribes to activity only while the session is shown, and leaving touches no Run', () => {
    const { owner, fake } = attached();
    fake.activityByRun.set('run-1', [narration(1, 'captured before opening')]);
    expect(fake.activityObservers.size).toBe(0);
    owner.dispatch({ kind: 'activate-selection' });
    flushFrame();
    expect(fake.activityObservers.size).toBe(1);
    expect(owner.getSnapshot().activity?.entries.map((entry) => entry.seq)).toEqual([1]);
    owner.dispatch({ kind: 'back' });
    expect(fake.activityObservers.size).toBe(0);
    expect(fake.sessionList).toHaveLength(1);
    owner.dispose();
  });

  it('returns to the menu with an explanation when the shown Run is removed', () => {
    const { owner, fake } = attached();
    owner.dispatch({ kind: 'activate-selection' });
    fake.remove('run-1');
    flushFrame();
    const snapshot = owner.getSnapshot();
    expect(topScreen(snapshot.navigation)).toEqual({ kind: 'menu' });
    expect(snapshot.navigation.notice).toBe(SESSION_REMOVED_NOTICE);
    expect(fake.activityObservers.size).toBe(0);
    owner.dispose();
  });

  it('exits directly when no Run holds active work', async () => {
    const { owner } = attached();
    const exited = vi.fn();
    void owner.exitRequested.then(exited);
    owner.dispatch({ kind: 'quit' });
    await settle();
    expect(exited).toHaveBeenCalled();
    expect(owner.getSnapshot().startup).toEqual({ kind: 'stopping' });
    owner.dispose();
  });

  it('confirms before stopping active Runs, refreshes the count and can be cancelled', async () => {
    const { owner, fake } = attached();
    fake.activeWork = 2;
    const exited = vi.fn();
    void owner.exitRequested.then(exited);
    owner.interrupt();
    flushFrame();
    expect(topScreen(owner.getSnapshot().navigation)).toEqual({ kind: 'quit-confirmation' });
    expect(owner.getSnapshot().activeWorkCount).toBe(2);

    fake.activeWork = 1;
    fake.update(session({ hasActiveWork: false }));
    flushFrame();
    expect(owner.getSnapshot().activeWorkCount).toBe(1);

    owner.dispatch({ kind: 'back' });
    await settle();
    expect(exited).not.toHaveBeenCalled();
    expect(topScreen(owner.getSnapshot().navigation)).toEqual({ kind: 'menu' });

    owner.dispatch({ kind: 'quit' });
    owner.dispatch({ kind: 'confirm-quit' });
    await settle();
    expect(exited).toHaveBeenCalled();
    owner.dispose();
  });

  it('treats a second Ctrl+C during confirmation as confirmed', async () => {
    const { owner, fake } = attached();
    fake.activeWork = 1;
    const exited = vi.fn();
    void owner.exitRequested.then(exited);
    owner.interrupt();
    owner.dispatch({ kind: 'quit' });
    await settle();
    expect(exited).not.toHaveBeenCalled();
    owner.interrupt();
    await settle();
    expect(exited).toHaveBeenCalled();
    owner.dispose();
  });

  it('quits without confirmation once the terminal view has stopped', async () => {
    const { owner, fake } = attached();
    fake.activeWork = 3;
    const exited = vi.fn();
    void owner.exitRequested.then(exited);
    owner.detachInteractive();
    owner.interrupt();
    await settle();
    expect(exited).toHaveBeenCalled();
    owner.dispose();
  });

  it('runs pairing as a screen, answers the local review and returns on confirmation', async () => {
    const { owner, fake } = attached();
    const started = startedCeremony('pair');
    fake.startAction.mockReturnValue(started.start);
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    owner.dispatch({ kind: 'activate-selection' });
    expect(fake.startAction).toHaveBeenCalledWith('pair');
    started.ceremony.ports.step({ kind: 'browser-handoff', userCode: 'CODE-1' });
    flushFrame();
    expect(topScreen(owner.getSnapshot().navigation)).toEqual({ kind: 'pairing' });
    expect(owner.getSnapshot().ceremony?.browserUrl).toBe('https://heyhey.dev/pairing?code=CODE-1');

    const answer = started.ceremony.ports.requestConfirmation({
      machineName: 'laptop',
      osFamily: 'MACOS' as never,
      controllerLabel: 'Phone',
      controllerCredentialFingerprint: 'AA',
      backupEligible: true,
      backupState: true,
      expiresAt: new Date(NOW + 60_000).toISOString(),
    });
    owner.dispatch({ kind: 'answer-review', approved: true });
    await expect(answer).resolves.toBe(true);

    started.finish('confirmed');
    await settle();
    const snapshot = owner.getSnapshot();
    expect(topScreen(snapshot.navigation)).toEqual({ kind: 'menu' });
    expect(snapshot.navigation.notice).toBe('This machine is paired.');
    owner.dispose();
  });

  it('cancels a ceremony when its screen is left', async () => {
    const { owner, fake } = attached();
    const started = startedCeremony('add-controller');
    fake.startAction.mockReturnValue(started.start);
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    owner.dispatch({ kind: 'activate-selection' });
    expect(fake.startAction).toHaveBeenCalledWith('add-controller');
    owner.dispatch({ kind: 'back' });
    await expect(started.start.started && started.start.operation.completion).resolves.toBe(
      'cancelled',
    );
    owner.dispose();
  });

  it('explains an unavailable action and reports logout', async () => {
    const { owner, fake } = attached();
    fake.startAction.mockReturnValueOnce({ started: false, reason: 'machine-not-paired' });
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    owner.dispatch({ kind: 'activate-selection' });
    flushFrame();
    expect(owner.getSnapshot().navigation.notice).toBe(
      'Pair this machine before adding a controller.',
    );

    fake.startAction.mockReturnValueOnce({
      started: true,
      operation: {
        kind: 'logout',
        actionId: 'log-out',
        completion: Promise.resolve({ outcome: 'signed-out' }),
      },
    });
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    owner.dispatch({ kind: 'activate-selection' });
    await settle();
    expect(owner.getSnapshot().navigation.notice).toBe(
      'Signed out of your account. This machine stays paired.',
    );
    owner.dispose();
  });

  it('opens the selected conversation in the web app', () => {
    const fake = new FakeSources();
    fake.sessionList = [session(), session({ runId: 'run-2', conversationId: '' })];
    const { owner, openUrl } = createOwner();
    owner.attach(fake.sources);
    owner.dispatch({ kind: 'open-web' });
    expect(openUrl).toHaveBeenCalledWith(
      'https://heyhey.dev/projects/project-1/resolve-agent-session/conversation-1',
    );
    owner.dispatch({ kind: 'move-selection', delta: 1 });
    owner.dispatch({ kind: 'open-web' });
    flushFrame();
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().navigation.notice).toBe('This session has no web conversation yet.');
    owner.dispose();
  });

  it('pauses following when scrolled and returns to live explicitly', () => {
    const { owner, fake } = attached();
    fake.activityByRun.set(
      'run-1',
      Array.from({ length: 50 }, (_, index) => narration(index + 1, `entry ${String(index + 1)}`)),
    );
    owner.dispatch({ kind: 'activate-selection' });
    owner.dispatch({ kind: 'scroll', direction: -1, amount: 'line' });
    flushFrame();
    expect(owner.getSnapshot().activityScroll).toEqual({
      mode: 'paused',
      pinnedThroughSeq: 50,
      offset: 1,
    });
    fake.emitActivity('run-1', narration(51, 'later'));
    owner.dispatch({ kind: 'scroll', direction: -1, amount: 'edge' });
    flushFrame();
    const paused = owner.getSnapshot().activityScroll;
    // 50 entries × 2 rows, less the feed height; the later entry stays out of the pin.
    expect(paused).toEqual({ mode: 'paused', pinnedThroughSeq: 50, offset: 100 - 20 });
    owner.dispatch({ kind: 'scroll', direction: 1, amount: 'edge' });
    flushFrame();
    expect(owner.getSnapshot().activityScroll).toMatchObject({ mode: 'paused', offset: 0 });
    owner.dispatch({ kind: 'follow-live' });
    flushFrame();
    expect(owner.getSnapshot().activityScroll).toEqual({ mode: 'live' });
    owner.dispose();
  });

  it('shows diagnostics captured before the server started', () => {
    const { owner, feed } = createOwner();
    feed.capture({
      stream: 'stderr',
      source: 'write',
      text: 'early warning',
      timestamp: new Date(NOW).toISOString(),
    });
    owner.dispatch({ kind: 'open-debug' });
    feed.capture({
      stream: 'stdout',
      source: 'log',
      text: 'later',
      timestamp: new Date(NOW).toISOString(),
    });
    flushFrame();
    expect(owner.getSnapshot().diagnostics?.records.map((record) => record.text)).toEqual([
      'early warning',
      'later',
    ]);
    owner.dispatch({ kind: 'back' });
    flushFrame();
    expect(owner.getSnapshot().diagnostics).toBeNull();
    owner.dispose();
  });

  const settledExport = (
    owner: ReturnType<typeof createOwner>['owner'],
  ): Promise<ReturnType<typeof owner.getSnapshot>> =>
    new Promise((resolve) => {
      const unsubscribe = owner.subscribe(() => {
        const snapshot = owner.getSnapshot();
        const kind = snapshot.diagnostics?.exportResult?.kind;
        if (kind && kind !== 'choosing') {
          unsubscribe();
          resolve(snapshot);
        }
      });
    });

  it('exports the feed as it was when the save dialog opened to the chosen path', async () => {
    vi.useRealTimers();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'heyhey-debug-owner-'));
    const destination = path.join(directory, 'chosen.jsonl');
    let choose!: () => void;
    const chooseSaveFile = vi.fn(
      () =>
        new Promise<{ status: 'selected'; path: string }>((resolve) => {
          choose = () => resolve({ status: 'selected', path: destination });
        }),
    );
    const { owner, feed } = createOwner({ now: () => NOW, chooseSaveFile, frameIntervalMs: 0 });
    feed.capture({
      stream: 'stderr',
      source: 'write',
      text: 'shareable diagnostic',
      timestamp: new Date(NOW).toISOString(),
    });
    owner.dispatch({ kind: 'open-debug' });
    const exported = settledExport(owner);

    try {
      owner.dispatch({ kind: 'export-debug' });
      expect(chooseSaveFile).toHaveBeenCalledWith(
        `debug-${new Date(NOW).toISOString().replace(/:/gu, '-')}.jsonl`,
      );
      await vi.waitFor(() =>
        expect(owner.getSnapshot().diagnostics?.exportResult).toEqual({ kind: 'choosing' }),
      );
      owner.dispatch({ kind: 'export-debug' });
      expect(chooseSaveFile).toHaveBeenCalledTimes(1);
      feed.capture({
        stream: 'stderr',
        source: 'write',
        text: 'appended while choosing',
        timestamp: new Date(NOW).toISOString(),
      });
      choose();
      const result = (await exported).diagnostics?.exportResult;
      expect(result).toMatchObject({
        kind: 'success',
        path: destination,
        count: 1,
        evictedCount: 0,
      });
      const contents = await readFile(destination, 'utf8');
      expect(contents).toContain('shareable diagnostic');
      expect(contents).not.toContain('appended while choosing');
    } finally {
      owner.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes nothing and keeps the feed when the save dialog is cancelled', async () => {
    vi.useRealTimers();
    const { owner, feed } = createOwner({ now: () => NOW, frameIntervalMs: 0 });
    feed.capture({
      stream: 'stderr',
      source: 'write',
      text: 'kept diagnostic',
      timestamp: new Date(NOW).toISOString(),
    });
    owner.dispatch({ kind: 'open-debug' });
    const exported = settledExport(owner);
    try {
      owner.dispatch({ kind: 'export-debug' });
      const snapshot = await exported;
      expect(snapshot.diagnostics?.exportResult).toEqual({ kind: 'cancelled' });
      expect(snapshot.diagnostics?.records.map((record) => record.text)).toContain(
        'kept diagnostic',
      );
    } finally {
      owner.dispose();
    }
  });

  it('keeps the Debug feed unchanged and publishes a reason when the dialog or write fails', async () => {
    vi.useRealTimers();
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'heyhey-debug-owner-'));
    const blocked = path.join(temporaryRoot, 'not-a-directory');
    await writeFile(blocked, 'file blocks the destination');
    const choices = [
      () => Promise.reject(new Error('Save dialog is unsupported on platform "aix".')),
      () => Promise.resolve({ status: 'selected' as const, path: path.join(blocked, 'x.jsonl') }),
    ];
    for (const chooseSaveFile of choices) {
      const { owner, feed } = createOwner({ now: () => NOW, chooseSaveFile, frameIntervalMs: 0 });
      feed.capture({
        stream: 'stderr',
        source: 'write',
        text: 'preserved diagnostic',
        timestamp: new Date(NOW).toISOString(),
      });
      const before = feed.snapshot();
      owner.dispatch({ kind: 'open-debug' });
      const exported = settledExport(owner);
      try {
        owner.dispatch({ kind: 'export-debug' });
        const result = (await exported).diagnostics?.exportResult;
        expect(result?.kind).toBe('failure');
        if (result?.kind !== 'failure') throw new Error('expected an export failure');
        expect(result.message.length).toBeGreaterThan(0);
        expect(feed.snapshot()).toEqual(before);
      } finally {
        owner.dispose();
      }
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it('recovers pairing at startup through the pairing screen', async () => {
    const { owner } = createOwner();
    const recovered = owner.recoverPairing(async (ports) => {
      ports.step({ kind: 'browser-handoff', userCode: 'START-1' });
      const approved = await ports.requestConfirmation({
        machineName: 'laptop',
        osFamily: 'MACOS' as never,
        controllerLabel: 'Phone',
        controllerCredentialFingerprint: 'AA',
        backupEligible: false,
        backupState: false,
        expiresAt: new Date(NOW).toISOString(),
      });
      return { outcome: approved ? 'confirmed' : 'declined' } as never;
    });
    await settle();
    expect(topScreen(owner.getSnapshot().navigation)).toEqual({ kind: 'pairing' });
    owner.dispatch({ kind: 'answer-review', approved: true });
    await expect(recovered).resolves.toBe(true);
    owner.dispose();
  });

  it('cancels startup pairing when the user quits', async () => {
    const { owner } = createOwner();
    const recovered = owner.recoverPairing(
      (ports) =>
        new Promise((_resolve, reject) => {
          ports.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    owner.dispatch({ kind: 'quit' });
    await expect(recovered).resolves.toBe(false);
    owner.dispose();
  });

  describe('Shared Browser', () => {
    const withBrowser = (enabled: boolean, projects: SharedBrowserProject[]) => {
      const fake = new FakeSources();
      fake.browserEnabled = enabled;
      fake.browserProjects = projects;
      const created = createOwner();
      created.owner.attach(fake.sources);
      flushFrame();
      return { fake, ...created };
    };
    const select = (owner: ReturnType<typeof createOwner>['owner'], steps: number) => {
      for (let step = 0; step < steps; step += 1)
        owner.dispatch({ kind: 'move-selection', delta: 1 });
    };

    it('publishes browser status updates into menu state', () => {
      const { owner, fake } = withBrowser(true, []);
      expect(owner.getSnapshot().sharedBrowser).toEqual({ enabled: true, projects: [] });
      fake.setSharedBrowser(true, [{ projectId: 'project-a', name: null, status: 'running' }]);
      flushFrame();
      expect(owner.getSnapshot().sharedBrowser?.projects).toEqual([
        { projectId: 'project-a', name: null, status: 'running' },
      ]);
      owner.dispose();
    });

    it('closes a running project browser and confirms it', async () => {
      const { owner, fake } = withBrowser(true, [
        { projectId: 'project-a', name: null, status: 'running' },
      ]);
      // Pair, Add controller, Log out, Shared Browser, project-a.
      select(owner, 5);
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(owner.getSnapshot().selection).toEqual({ kind: 'browser', projectId: 'project-a' });
      expect(fake.closeBrowser).toHaveBeenCalledWith('project-a');
      expect(owner.getSnapshot().navigation.notice).toContain("Closed this project's browser");
      owner.dispose();
    });

    it('explains instead of closing a stopped browser', async () => {
      const { owner, fake } = withBrowser(true, [
        { projectId: 'project-a', name: null, status: 'stopped' },
      ]);
      select(owner, 5);
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.closeBrowser).not.toHaveBeenCalled();
      expect(owner.getSnapshot().navigation.notice).toBe("This project's browser is not running.");
      owner.dispose();
    });

    it('toggles the machine setting and reports a failure', async () => {
      const { owner, fake, report } = withBrowser(true, []);
      select(owner, 4);
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.setBrowserEnabled).toHaveBeenCalledWith(false);
      expect(owner.getSnapshot().navigation.notice).toBe('Shared Browser turned off.');

      fake.setSharedBrowser(false, []);
      fake.setBrowserEnabled.mockRejectedValueOnce(new Error('disk full'));
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.setBrowserEnabled).toHaveBeenLastCalledWith(true);
      expect(owner.getSnapshot().navigation.notice).toBe(
        'Could not turn Shared Browser on: disk full',
      );
      expect(report).toHaveBeenCalledWith('presentation.shared_browser_action_failed', {
        error: 'disk full',
      });
      owner.dispose();
    });
  });

  describe('Options', () => {
    const openOptions = (intentFirst: boolean | null) => {
      const fake = new FakeSources();
      fake.intentFirst = intentFirst;
      const created = createOwner();
      created.owner.attach(fake.sources);
      // Pair, Add controller, Log out, Shared Browser, Options.
      for (let step = 0; step < 5; step += 1) {
        created.owner.dispatch({ kind: 'move-selection', delta: 1 });
      }
      created.owner.dispatch({ kind: 'activate-selection' });
      flushFrame();
      return { fake, ...created };
    };

    it('opens the Options screen from the menu and goes back', () => {
      const { owner } = openOptions(false);
      expect(topScreen(owner.getSnapshot().navigation).kind).toBe('options');
      expect(owner.getSnapshot().options).toEqual({
        intentFirst: false,
        remoteToolCallViewing: true,
        jevEnabled: true,
        jevKeyDefined: true,
      });
      owner.dispatch({ kind: 'back' });
      flushFrame();
      expect(topScreen(owner.getSnapshot().navigation).kind).toBe('menu');
      owner.dispose();
    });

    it('flips Intent-first and shows the new state straight away', async () => {
      const { owner, fake } = openOptions(false);
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.setIntentFirst).toHaveBeenLastCalledWith(true);
      expect(owner.getSnapshot().options).toEqual({
        intentFirst: true,
        remoteToolCallViewing: true,
        jevEnabled: true,
        jevKeyDefined: true,
      });

      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.setIntentFirst).toHaveBeenLastCalledWith(false);
      expect(owner.getSnapshot().options).toEqual({
        intentFirst: false,
        remoteToolCallViewing: true,
        jevEnabled: true,
        jevKeyDefined: true,
      });
      owner.dispose();
    });

    it('moves between the options and stops at the ends', () => {
      const { owner } = openOptions(false);
      expect(owner.getSnapshot().optionsRow).toBe('intent-first');
      owner.dispatch({ kind: 'move-selection', delta: -1 });
      flushFrame();
      expect(owner.getSnapshot().optionsRow).toBe('intent-first');
      owner.dispatch({ kind: 'move-selection', delta: 1 });
      owner.dispatch({ kind: 'move-selection', delta: 1 });
      flushFrame();
      expect(owner.getSnapshot().optionsRow).toBe('jev');
      owner.dispatch({ kind: 'move-selection', delta: 1 });
      flushFrame();
      expect(owner.getSnapshot().optionsRow).toBe('jev');
      expect(owner.getSnapshot().selection).toEqual({ kind: 'options' });
      expect(topScreen(owner.getSnapshot().navigation).kind).toBe('options');
      owner.dispose();
    });

    it('flips remote tool-call viewing on the highlighted row without touching Intent-first', async () => {
      const { owner, fake } = openOptions(false);
      owner.dispatch({ kind: 'move-selection', delta: 1 });
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.setRemoteToolCallViewing).toHaveBeenLastCalledWith(false);
      expect(fake.setIntentFirst).not.toHaveBeenCalled();
      expect(owner.getSnapshot().options).toEqual({
        intentFirst: false,
        remoteToolCallViewing: false,
        jevEnabled: true,
        jevKeyDefined: true,
      });
      owner.dispose();
    });

    it('flips the Jev on its own row', async () => {
      const { owner, fake } = openOptions(false);
      owner.dispatch({ kind: 'move-selection', delta: 1 });
      owner.dispatch({ kind: 'move-selection', delta: 1 });
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.setJevEnabled).toHaveBeenLastCalledWith(false);
      expect(fake.setIntentFirst).not.toHaveBeenCalled();
      expect(fake.setRemoteToolCallViewing).not.toHaveBeenCalled();
      expect(owner.getSnapshot().options).toEqual({
        intentFirst: false,
        remoteToolCallViewing: true,
        jevEnabled: false,
        jevKeyDefined: true,
      });
      owner.dispose();
    });

    it('refuses to turn the Jev-filtered load on without a Jev key and saves nothing', async () => {
      const fake = new FakeSources();
      fake.setOptions(false, true, true, false);
      const created = createOwner();
      created.owner.attach(fake.sources);
      for (let step = 0; step < 5; step += 1) {
        created.owner.dispatch({ kind: 'move-selection', delta: 1 });
      }
      created.owner.dispatch({ kind: 'activate-selection' });
      flushFrame();
      created.owner.dispatch({ kind: 'move-selection', delta: 1 });
      created.owner.dispatch({ kind: 'move-selection', delta: 1 });
      created.owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.setJevEnabled).not.toHaveBeenCalled();
      expect(created.owner.getSnapshot().navigation.notice).toBe(
        'Define a Jev key in your environment to turn this on.',
      );
      created.owner.dispose();
    });

    it('explains instead of changing anything while the choice is still loading', async () => {
      const { owner, fake } = openOptions(null);
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(fake.setIntentFirst).not.toHaveBeenCalled();
      expect(owner.getSnapshot().navigation.notice).toBe('Options are still loading.');
      owner.dispose();
    });

    it('reports a failed save and keeps the previous state', async () => {
      const { owner, fake, report } = openOptions(false);
      fake.setIntentFirst.mockRejectedValueOnce(new Error('disk full'));
      owner.dispatch({ kind: 'activate-selection' });
      await settle();
      expect(report).toHaveBeenCalledWith('presentation.options_write_failed', {
        error: 'disk full',
      });
      expect(owner.getSnapshot().navigation.notice).toBe('Could not save this option: disk full');
      expect(owner.getSnapshot().options).toEqual({
        intentFirst: false,
        remoteToolCallViewing: true,
        jevEnabled: true,
        jevKeyDefined: true,
      });
      owner.dispose();
    });
  });
});
