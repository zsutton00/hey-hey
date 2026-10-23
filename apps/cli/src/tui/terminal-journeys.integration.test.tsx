/**
 * Combined terminal journeys: the real local session, metadata, activity and
 * Debug sources feed the real presentation owner, rendered by Ink through the
 * real keybinding layer. Providers are controlled by publishing their raw
 * events through the real provider normalizers; the Run registry and machine
 * actions are the only stand-ins.
 */

import { render } from 'ink-testing-library';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mapCodexEvent } from '../agents/providers/codex/codex-event-mapper';
import {
  normalizeProviderEventPayload,
  type NormalizeProviderEventInput,
  type ProviderEventNormalizationConfig,
} from '../agents/providers/provider-event-normalization';
import type { MachineEnrollmentActivationResponse } from '../auth/machine-enrollment-confirmation';
import type { Run } from '../run/run';
import type { LocalAgentOutputEvent } from '../run/types';
import type { AgentSessionCurrentState } from '../shared/api/generated/api';
import { DiagnosticFeed } from '../server/diagnostic-feed';
import {
  ConversationTitleReadError,
  LocalSessionMetadataSource,
} from '../server/local-session-metadata-source';
import { LocalSessionReadSource } from '../server/local-session-read-source';
import { NOOP_LOGGER } from '../server/logger';
import type { RunOutputAttribution, RunOutputListener } from '../server/run-event-publisher';
import { RunLifecycleEvents } from '../server/run-lifecycle-events';
import {
  SESSION_ACTIVITY_LIMITS,
  SessionActivitySource,
  type SessionActivityLimits,
} from '../server/session-activity-source';
import { loadInk } from './ink';
import { topScreen } from './navigation';
import { PresentationOwner } from './presentation-owner';
import { SharedBrowserSource } from './browser-source';
import { OptionsSource } from './options-source';
import {
  ControlledBrowserManager,
  machineStatus,
  startedCeremony,
} from './presentation.test-support';
import type {
  MachineActionId,
  MachineActionStart,
  MachineStatusSnapshot,
} from '../commands/machine-actions';
import { PresentationRoot } from './root';
import { installTerminalCapture } from './terminal-capture';

const KEY = {
  down: '\u001B[B',
  up: '\u001B[A',
  pageUp: '\u001B[5~',
  enter: '\r',
  escape: '\u001B',
  ctrlC: '\u0003',
};

const TRACKED: ProviderEventNormalizationConfig = {
  validationMode: 'permissive',
  maxDiffBlobBytes: 65_536,
  trackTools: true,
};

/** Lets the owner publish its frame and Ink commit it. */
const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

interface ControlledRun {
  runId: string;
  agentSessionId: string;
  conversationId: string;
  organizationId: string;
  projectId: string;
  provider: 'claude' | 'codex' | 'opencode';
  providerSessionId: string | null;
  session: { provider_conversation_id: string | null };
  entity: null;
  effectiveState: {
    agentSessionId: string;
    currentState: AgentSessionCurrentState;
    observedAt: string;
  } | null;
  hasActiveWork: boolean;
  createdAt: string;
  activeSince: string | null;
  loadedEntityContext: null;
  entityContextLoadStatus: null;
}

/** The Run output stream the activity source subscribes to, driven by the test. */
class ControlledRunOutput {
  private readonly listeners = new Set<RunOutputListener>();

  public onRunOutput(listener: RunOutputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public publish(event: LocalAgentOutputEvent, attribution: RunOutputAttribution): void {
    for (const listener of this.listeners) listener(event, attribution);
  }
}

/** Machine actions stand-in; the real ceremony is handed out by `startedCeremony`. */
class ControlledMachineActions {
  public snapshot: MachineStatusSnapshot = machineStatus();
  public readonly start = vi.fn<(id: MachineActionId) => MachineActionStart>();
  private readonly observers = new Set<(snapshot: MachineStatusSnapshot) => void>();

  public observe(observer: (snapshot: MachineStatusSnapshot) => void) {
    this.observers.add(observer);
    return { snapshot: this.snapshot, unsubscribe: () => this.observers.delete(observer) };
  }

  public set(snapshot: MachineStatusSnapshot): void {
    this.snapshot = snapshot;
    for (const observer of this.observers) observer(snapshot);
  }
}

const journey = (
  options: {
    limits?: Partial<SessionActivityLimits>;
    readTitle?: (conversationId: string) => Promise<string | null>;
    viewport?: { columns: number; rows: number };
  } = {},
) => {
  const runs = new Map<string, ControlledRun>();
  const lifecycle = new RunLifecycleEvents();
  const registry = {
    get: (runId: string) => (runs.get(runId) ?? null) as Run | null,
    list: () => [...runs.values()] as unknown as readonly Run[],
  };
  const sessions = new LocalSessionReadSource({
    runRegistry: registry,
    runLifecycleEvents: lifecycle,
    logger: NOOP_LOGGER,
  });
  const output = new ControlledRunOutput();
  const activity = new SessionActivitySource({
    runOutput: output,
    readSource: sessions,
    logger: NOOP_LOGGER,
    limits: { ...SESSION_ACTIVITY_LIMITS, ...options.limits },
  });
  const titleReads = vi.fn(({ conversationId }: { conversationId: string }) =>
    options.readTitle
      ? options.readTitle(conversationId)
      : Promise.resolve(`Title of ${conversationId}`),
  );
  const metadata = new LocalSessionMetadataSource({
    readSource: sessions,
    readConversationTitle: titleReads,
    logger: NOOP_LOGGER,
    refreshIntervalMs: 60_000,
  });
  const machineActions = new ControlledMachineActions();
  const optionsStore = {
    saved: { intentFirst: false, remoteToolCallViewing: true, jevParentFeatureFilter: true },
    read() {
      return Promise.resolve({ ...this.saved });
    },
    update(
      patch: Partial<{
        intentFirst: boolean;
        remoteToolCallViewing: boolean;
        jevParentFeatureFilter: boolean;
      }>,
    ) {
      this.saved = { ...this.saved, ...patch };
      return Promise.resolve({ ...this.saved });
    },
  };
  const browsers = new ControlledBrowserManager();
  const diagnostics = new DiagnosticFeed();
  const report = vi.fn();
  const openUrl = vi.fn(() => Promise.resolve());
  const owner = new PresentationOwner({
    diagnostics,
    webOrigin: 'https://heyhey.dev',
    target: { profile: null, environment: null },
    pairingUrl: (code, route) => `https://heyhey.dev/${route}?code=${code}`,
    openUrl,
    chooseSaveFile: () => Promise.resolve({ status: 'cancelled' }),
    report,
    color: false,
    viewport: options.viewport ?? { columns: 100, rows: 30 },
    frameIntervalMs: 0,
  });
  const view = render(<PresentationRoot owner={owner} />);

  const register = (runId: string, overrides: Partial<ControlledRun> = {}): ControlledRun => {
    const run: ControlledRun = {
      runId,
      agentSessionId: `agent-session-${runId}`,
      conversationId: `conversation-${runId}`,
      organizationId: 'org-1',
      projectId: 'project-1',
      provider: 'codex',
      providerSessionId: `provider-${runId}`,
      session: { provider_conversation_id: null },
      entity: null,
      effectiveState: null,
      hasActiveWork: false,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      activeSince: new Date(Date.now() - 60_000).toISOString(),
      loadedEntityContext: null,
      entityContextLoadStatus: null,
      ...overrides,
    };
    runs.set(runId, run);
    lifecycle.publishRunRegistered(runId);
    return run;
  };
  const setState = (runId: string, state: AgentSessionCurrentState, active: boolean): void => {
    const run = runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    run.effectiveState = {
      agentSessionId: run.agentSessionId,
      currentState: state,
      observedAt: new Date(Date.now() - 5_000).toISOString(),
    };
    run.hasActiveWork = active;
    lifecycle.publishRunUpdated(runId);
  };
  const remove = (runId: string): void => {
    runs.delete(runId);
    lifecycle.publishRunRemoved(runId);
  };
  /** Publishes one raw provider event through the real normalizer for that provider. */
  const emit = (
    runId: string,
    input: Omit<NormalizeProviderEventInput, 'runId' | 'timestamp' | 'config'> & {
      config?: ProviderEventNormalizationConfig;
    },
  ): void => {
    const run = runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    const timestamp = new Date().toISOString();
    const normalizeInput: NormalizeProviderEventInput = {
      ...input,
      runId,
      timestamp,
      config: input.config ?? TRACKED,
    };
    const normalized =
      input.provider === 'codex'
        ? mapCodexEvent(normalizeInput)
        : normalizeProviderEventPayload(normalizeInput);
    output.publish(
      {
        runId,
        source: 'provider',
        eventType: normalized.resolvedEventType ?? input.eventType,
        timestamp,
        sessionId: input.sessionId,
        agentId: input.agentId,
        payload: normalized.payload,
        ...(normalized.facts ? { providerFacts: normalized.facts } : {}),
      },
      { run: run as unknown as Run, turnId: 'turn-1', subagentTurnId: null },
    );
  };
  const press = async (...keys: string[]): Promise<void> => {
    for (const key of keys) {
      view.stdin.write(key);
      await nextFrame();
    }
  };
  const frame = (): string => view.lastFrame() ?? '';
  const start = (): void => {
    owner.attach({
      sessions,
      sessionMetadata: metadata,
      sessionActivity: activity,
      machineActions,
      sharedBrowser: new SharedBrowserSource(
        browsers,
        (projectId) => Promise.resolve(projectId === 'project-a' ? 'Website' : null),
        report,
      ),
      options: new OptionsSource(optionsStore, true, report),
    });
  };
  const dispose = (): void => {
    view.unmount();
    owner.dispose();
    metadata.dispose();
    activity.dispose();
  };
  return {
    owner,
    view,
    sessions,
    metadata,
    activity,
    diagnostics,
    machineActions,
    browsers,
    optionsStore,
    titleReads,
    report,
    register,
    setState,
    remove,
    emit,
    press,
    frame,
    start,
    dispose,
  };
};

const codex = (eventType: string, rawEvent: Record<string, unknown>) => ({
  provider: 'codex' as const,
  eventType,
  sessionId: 'codex-session',
  agentId: 'codex',
  rawEvent: { threadId: 'thread-root', turnId: 'pturn-1', ...rawEvent },
});

const claude = (rawEvent: Record<string, unknown>) => ({
  provider: 'claude' as const,
  eventType: String(rawEvent['type']),
  sessionId: 'claude-session',
  agentId: 'claude',
  rawEvent,
});

const codexCommand = (itemId: string, command: string) =>
  codex('item/started', {
    item: { type: 'commandExecution', id: itemId, command, status: 'inProgress' },
  });
const codexOutput = (itemId: string, delta: string) =>
  codex('item/commandExecution/outputDelta', { itemId, delta });
const codexMessage = (itemId: string, text: string) =>
  codex('item/completed', { item: { type: 'agentMessage', id: itemId, text } });

/** From the first menu row, opens the session at `index`; machine actions are listed first. */
const openSession = async (j: ReturnType<typeof journey>, index: number): Promise<void> => {
  for (let step = 0; step < index; step += 1) await j.press(KEY.down);
  await j.press(KEY.enter);
};

describe('terminal journeys (real sources, owner and Ink)', () => {
  const cleanups: Array<() => void> = [];

  beforeAll(async () => {
    await loadInk();
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    vi.restoreAllMocks();
  });

  const start = (options?: Parameters<typeof journey>[0]) => {
    const j = journey(options);
    cleanups.push(j.dispose);
    return j;
  };

  it('starts empty, lists multiple registered Runs with titles and states, and counts only active work', async () => {
    const j = start();
    await nextFrame();
    expect(j.frame()).toContain('Starting');

    j.start();
    await nextFrame();
    expect(j.frame()).toMatch(/SESSIONS ON THIS MACHINE +0/u);

    j.register('idle', { provider: 'claude' });
    j.register('waiting');
    j.register('busy');
    j.setState('idle', 'IDLE', false);
    j.setState('waiting', 'AWAITING_APPROVAL', false);
    j.setState('busy', 'THINKING', true);
    await vi.waitFor(() => expect(j.titleReads).toHaveBeenCalledTimes(3));
    await nextFrame();

    const menu = j.frame();
    expect(menu).toMatch(/SESSIONS ON THIS MACHINE +3/u);
    expect(menu).toContain('Title of conversation-idle');
    expect(menu).toContain('Title of conversation-busy');
    expect(menu).toContain('Awaiting approval');
    expect(menu).toContain('Thinking for');

    const lines = menu.split('\n');
    const sessionTitles = [
      'Title of conversation-idle',
      'Title of conversation-waiting',
      'Title of conversation-busy',
    ]
      .map((title) => lines.findIndex((text) => text.includes(title)))
      .sort((left, right) => left - right);
    const heading = lines.findIndex((text) => text.includes('SESSIONS ON THIS MACHINE'));
    expect(sessionTitles[0]).toBe(heading + 1);
    for (const [index, titleLine] of sessionTitles.entries()) {
      expect(lines[titleLine + 1]).toMatch(/Claude|Codex/u);
      if (index < sessionTitles.length - 1) {
        expect(lines[titleLine + 2]?.trim()).toBe('');
      } else {
        expect(lines[titleLine + 2]).toMatch(/^─+$/u);
      }
    }
    expect(j.sessions.activeWorkCount()).toBe(1);
  });

  it('shows each project browser running or stopped, closes it from the menu and turns Shared Browser off', async () => {
    const j = start();
    j.start();
    await nextFrame();
    expect(j.frame()).toContain('SHARED BROWSER');
    expect(j.frame()).toMatch(/Shared Browser +On/u);

    j.browsers.launch('project-a');
    await nextFrame();
    expect(j.frame()).toMatch(/Website +running/u);

    // Pair, Add controller, Log out, Shared Browser, project-a.
    await j.press(KEY.down, KEY.down, KEY.down, KEY.down, KEY.down, KEY.enter);
    await nextFrame();
    expect(j.browsers.close).toHaveBeenCalledWith('project-a');
    expect(j.frame()).toMatch(/Website +stopped/u);
    expect(j.frame()).toContain('It opens again when an agent needs it');

    // The next agent browser call launches it again.
    j.browsers.launch('project-a');
    await nextFrame();
    expect(j.frame()).toMatch(/Website +running/u);

    await j.press(KEY.up, KEY.enter);
    await nextFrame();
    expect(j.browsers.setEnabled).toHaveBeenCalledWith(false);
    expect(j.frame()).toMatch(/Shared Browser +Off/u);
    expect(j.frame()).toMatch(/Website +stopped/u);

    await j.press(KEY.enter);
    await nextFrame();
    expect(j.browsers.setEnabled).toHaveBeenLastCalledWith(true);
    expect(j.frame()).toMatch(/Shared Browser +On/u);
  });

  it('opens Options from the menu, switches Intent-first on and off and returns', async () => {
    const j = start();
    j.start();
    await nextFrame();
    expect(j.frame()).toMatch(/OPTIONS\n.*Options +Choose how agents work on this machine/u);

    // Pair, Add controller, Log out, Shared Browser, Options.
    await j.press(KEY.down, KEY.down, KEY.down, KEY.down, KEY.down, KEY.enter);
    expect(j.frame()).toContain('AGENTS');
    expect(j.frame()).toMatch(/Intent-first \(experimental\) +Off +Enter to turn on/u);

    await j.press(KEY.enter);
    expect(j.optionsStore.saved).toEqual({
      intentFirst: true,
      remoteToolCallViewing: true,
      jevParentFeatureFilter: true,
    });
    expect(j.frame()).toMatch(/Intent-first \(experimental\) +On +Enter to turn off/u);

    await j.press(KEY.enter);
    expect(j.optionsStore.saved).toEqual({
      intentFirst: false,
      remoteToolCallViewing: true,
      jevParentFeatureFilter: true,
    });
    expect(j.frame()).toMatch(/Intent-first \(experimental\) +Off/u);

    await j.press(KEY.down, KEY.enter);
    expect(j.optionsStore.saved).toEqual({
      intentFirst: false,
      remoteToolCallViewing: false,
      jevParentFeatureFilter: true,
    });
    expect(j.frame()).toMatch(/Remote tool-call viewing +Off +Enter to turn on/u);

    await j.press(KEY.down, KEY.enter);
    expect(j.optionsStore.saved).toEqual({
      intentFirst: false,
      remoteToolCallViewing: false,
      jevParentFeatureFilter: false,
    });
    expect(j.frame()).toMatch(/Jev-filtered parent feature load +Off +Enter to turn on/u);

    await j.press(KEY.escape);
    expect(j.frame()).toContain('SESSIONS ON THIS MACHINE');
  });

  it('exits straight away when only idle or waiting Runs exist', async () => {
    const j = start();
    j.start();
    j.register('idle');
    j.register('waiting');
    j.setState('idle', 'IDLE', false);
    j.setState('waiting', 'AWAITING_APPROVAL', false);
    await nextFrame();
    const exited = vi.fn();
    void j.owner.exitRequested.then(exited);
    await j.press('q');
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it('confirms quitting active work, tracks the changing count, cancels and stops on a second Ctrl+C', async () => {
    const j = start();
    j.start();
    j.register('a');
    j.register('b');
    j.setState('a', 'WRITING', true);
    j.setState('b', 'IDLE', false);
    await nextFrame();
    const exited = vi.fn();
    void j.owner.exitRequested.then(exited);

    await j.press('q');
    expect(j.frame()).toContain('1 session is working. Quitting stops it.');

    // Cancelling keeps every Run registered and working.
    await j.press('n');
    expect(j.frame()).toMatch(/SESSIONS ON THIS MACHINE +2/u);
    expect(exited).not.toHaveBeenCalled();
    expect(j.sessions.activeWorkCount()).toBe(1);

    // The count is read again when confirmation reopens.
    j.setState('b', 'THINKING', true);
    await j.press(KEY.ctrlC);
    expect(j.frame()).toContain('2 sessions are working. Quitting stops them.');
    expect(exited).not.toHaveBeenCalled();

    await j.press(KEY.ctrlC);
    expect(exited).toHaveBeenCalledTimes(1);
    // Exit only signals the command; nothing here stops Runs.
    expect(j.sessions.snapshot().sessions).toHaveLength(2);
  });

  it('confirms with y and runs startup pairing and in-menu add-controller ceremonies', async () => {
    const j = start();
    const paired = j.owner.recoverPairing((ports) => {
      ports.step({ kind: 'browser-handoff', userCode: 'WXYZ-1234' });
      // The presentation reads only the outcome; activation is the pair command's.
      const confirmed = {
        outcome: 'confirmed' as const,
        activation: {} as MachineEnrollmentActivationResponse,
      };
      return new Promise((resolve) => setTimeout(() => resolve(confirmed), 60));
    });
    await nextFrame();
    expect(j.frame()).toContain('HEY HEY / pair this machine');
    expect(j.frame()).toContain('Code  WXYZ-1234');
    expect(j.frame()).toContain('https://heyhey.dev/');
    await expect(paired).resolves.toBe(true);

    j.start();
    await nextFrame();
    expect(j.frame()).toContain('This machine is paired.');

    const ceremony = startedCeremony('add-controller');
    j.machineActions.start.mockReturnValue(ceremony.start);
    j.owner.dispatch({ kind: 'back' });
    // Nothing is selected without sessions: Enter does nothing, Down takes Pair, then Add controller.
    await j.press(KEY.enter);
    expect(j.machineActions.start).not.toHaveBeenCalled();
    await j.press(KEY.down, KEY.down, KEY.enter);
    expect(j.machineActions.start).toHaveBeenCalledWith('add-controller');
    expect(j.frame()).toContain('HEY HEY / add a controller');

    // Leaving the screen cancels the ceremony and changes nothing.
    await j.press(KEY.escape);
    await expect(ceremony.start.started && ceremony.start.operation.completion).resolves.toBe(
      'cancelled',
    );
    expect(j.frame()).toMatch(/SESSIONS ON THIS MACHINE +0/u);
  });

  it('shows a failed title on its own row, recovers it, and withdraws account metadata on sign-out', async () => {
    let failing = true;
    const j = start({
      readTitle: (conversationId) => {
        if (conversationId === 'conversation-bad' && failing) {
          return Promise.reject(new ConversationTitleReadError('boom', false));
        }
        return Promise.resolve(`Title of ${conversationId}`);
      },
    });
    j.start();
    j.register('good');
    j.register('bad');
    await vi.waitFor(() => expect(j.titleReads).toHaveBeenCalledTimes(2));
    await nextFrame();
    expect(j.frame()).toContain('Title of conversation-good');
    expect(j.frame()).toContain('Title unavailable (could not be read)');

    failing = false;
    j.metadata.connectivityRestored();
    await vi.waitFor(() => expect(j.frame()).toContain('Title of conversation-bad'));

    // Sign-out invalidation (the local half of logout) keeps sessions listed.
    j.metadata.authorizationLost();
    await nextFrame();
    expect(j.frame()).toContain('Title unavailable (signed out)');
    expect(j.frame()).toMatch(/SESSIONS ON THIS MACHINE +2/u);
    j.metadata.authorizationRestored();
    await vi.waitFor(() => expect(j.frame()).toContain('Title of conversation-good'));
  });

  it('keeps healthy sessions updating beside a throwing observer on every source', async () => {
    const j = start();
    const throwing = () => {
      throw new Error('bad observer');
    };
    j.sessions.observe(throwing);
    j.metadata.observe(throwing);
    j.activity.observe(throwing);
    j.start();
    j.register('a');
    j.setState('a', 'THINKING', true);
    j.emit('a', codexMessage('m1', 'Still going fine.'));
    await openSession(j, 0);
    await nextFrame();
    expect(j.frame()).toContain('Title of conversation-a');
    expect(j.frame()).toContain('Still going fine.');
  });

  it('shows mid-Turn history when opened late, then a gap once retention evicts entries', async () => {
    const j = start({ limits: { maxEntriesPerRun: 3 } });
    j.start();
    j.register('a');
    j.setState('a', 'WRITING', true);
    j.emit('a', codexMessage('m1', 'First step done.'));
    j.emit('a', codexCommand('c1', 'pnpm test'));
    j.emit('a', codexOutput('c1', 'PASS src/a.test.ts\n'));
    await openSession(j, 0);
    expect(j.frame()).toContain('HEY HEY / session');
    expect(j.frame()).toContain('First step done.');
    expect(j.frame()).toContain('pnpm test');
    expect(j.frame()).toContain('PASS src/a.test.ts');

    j.emit('a', codexMessage('m2', 'Second.'));
    j.emit('a', codexMessage('m3', 'Third.'));
    await nextFrame();
    expect(j.frame()).toContain('Earlier activity is no longer kept');
    expect(j.frame()).not.toContain('First step done.');
    expect(j.frame()).toContain('Third.');
  });

  it('shows provider limitations as absences rather than invented output', async () => {
    const j = start();
    j.start();
    j.register('claude-run', { provider: 'claude' });
    j.register('untracked', { provider: 'claude' });
    j.emit(
      'claude-run',
      claude({
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'private reasoning' },
            { type: 'text', text: 'Reading the config.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } },
          ],
        },
        parent_tool_use_id: null,
      }),
    );
    // With tool tracking off (--no-track-tools) Claude tool calls lose their
    // name and arguments; the result still appears.
    const untracked = { ...TRACKED, trackTools: false };
    j.emit('untracked', {
      ...claude({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Narration still shows.' },
            { type: 'tool_use', id: 'toolu_9', name: 'Bash', input: { command: 'secret-command' } },
          ],
        },
        parent_tool_use_id: null,
      }),
      config: untracked,
    });
    j.emit('untracked', {
      ...claude({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'tool result text' }],
        },
        parent_tool_use_id: null,
      }),
      config: untracked,
    });

    await openSession(j, 0);
    expect(j.frame()).toContain('Reading the config.');
    expect(j.frame()).toContain('Read');
    expect(j.frame()).not.toContain('private reasoning');

    await j.press(KEY.escape, KEY.down, KEY.enter);
    expect(j.frame()).toContain('Narration still shows.');
    expect(j.frame()).toContain('tool result text');
    expect(j.frame()).not.toContain('secret-command');
  });

  it('streams high-volume output within the viewport, scrolls, follows live and survives resize', async () => {
    const j = start({ viewport: { columns: 80, rows: 20 } });
    j.start();
    j.register('a');
    j.setState('a', 'WRITING', true);
    await openSession(j, 0);
    j.emit('a', codexCommand('c1', 'yes'));
    for (let chunk = 0; chunk < 50; chunk += 1) {
      const lines = Array.from({ length: 40 }, (_, line) => `line ${String(chunk * 40 + line)}`);
      j.emit('a', codexOutput('c1', `${lines.join('\n')}\n`));
    }
    await nextFrame();
    const live = j.frame();
    expect(live.split('\n').length).toBeLessThanOrEqual(20);
    expect(live).toContain('line 1999');
    expect(live).toContain('Following live');

    await j.press(KEY.pageUp);
    expect(j.frame()).not.toContain('Following live');
    expect(j.frame()).not.toContain('line 1999');
    j.emit('a', codexOutput('c1', 'line 2000\n'));
    await nextFrame();
    expect(j.frame()).not.toContain('line 2000');

    await j.press('f');
    expect(j.frame()).toContain('line 2000');

    j.owner.resize({ columns: 50, rows: 12 });
    await nextFrame();
    expect(j.frame()).toContain('Terminal too small');
    j.owner.resize({ columns: 120, rows: 40 });
    await nextFrame();
    expect(j.frame()).toContain('line 2000');
    expect(j.frame().split('\n').length).toBeLessThanOrEqual(40);
  });

  it('returns to the menu with an explanation when the shown Run is removed', async () => {
    const j = start();
    j.start();
    j.register('a');
    j.register('b');
    await openSession(j, 1);
    expect(topScreen(j.owner.getSnapshot().navigation).kind).toBe('session');
    j.remove('b');
    await nextFrame();
    expect(topScreen(j.owner.getSnapshot().navigation).kind).toBe('menu');
    expect(j.frame()).toMatch(/SESSIONS ON THIS MACHINE +1/u);
    expect(j.owner.getSnapshot().navigation.notice).toBeTruthy();
  });

  it('captures console and stderr output into Debug with bounded, readable rows', async () => {
    const j = start();
    const target = {
      console: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      stdout: { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
      stderr: { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
    };
    const originalLog = target.console.log;
    const capture = installTerminalCapture(j.diagnostics, target);
    cleanups.push(() => capture.restore());
    j.start();

    target.console.log('third-party says hello');
    target.stderr.write('\u001B[31mwarning from a dependency\u001B[0m\n');
    target.console.error('x'.repeat(100_000));
    for (let index = 0; index < 10_000; index += 1) target.console.info(`noise ${String(index)}`);

    await j.press('d');
    const debug = j.frame();
    expect(debug).toContain('noise 9999');
    expect(debug.split('\n').length).toBeLessThanOrEqual(30);
    expect(debug).not.toContain('\u001B[31m');
    const retained = j.diagnostics.snapshot();
    expect(retained.records.length).toBeLessThanOrEqual(12_000);
    expect(retained.records.some((record) => record.text.includes('third-party'))).toBe(false);
    expect(
      retained.records.some((record) => record.text.includes('warning from a dependency')),
    ).toBe(true);
    expect(retained.losses.routine.evicted).toBeGreaterThan(0);
    expect(retained.losses.incident.evicted).toBe(0);
    // The original sinks never received captured output.
    expect(originalLog).not.toHaveBeenCalled();
  });
});
