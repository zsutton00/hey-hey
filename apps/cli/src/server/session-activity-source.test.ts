import { describe, expect, it } from 'vitest';
import {
  normalizeProviderEventPayload,
  type NormalizeProviderEventInput,
  type ProviderEventNormalizationConfig,
} from '../agents/providers/provider-event-normalization';
import { mapCodexEvent } from '../agents/providers/codex/codex-event-mapper';
import type { Run } from '../run/run';
import type { LocalAgentOutputEvent } from '../run/types';
import type {
  LocalSessionObserver,
  LocalSessionSnapshot,
  LocalSessionUpdate,
} from './local-session-read-source';
import { NOOP_LOGGER, type ServerLogger } from './logger';
import type { RunOutputAttribution, RunOutputListener } from './run-event-publisher';
import {
  SESSION_ACTIVITY_LIMITS,
  SessionActivitySource,
  type SessionActivityEntry,
  type SessionActivityLimits,
  type SessionActivityUpdate,
  type SessionNarrationEntry,
  type SessionToolEntry,
} from './session-activity-source';

const CONFIG: ProviderEventNormalizationConfig = {
  validationMode: 'permissive',
  maxDiffBlobBytes: 65_536,
  trackTools: true,
};

let clock = Date.parse('2026-10-04T10:00:00.000Z');
const at = (offsetMs = 0): string => new Date(clock + offsetMs).toISOString();

/** Fake read source: membership is driven by the test, instance ids by Run identity. */
class FakeReadSource {
  private readonly ids = new WeakMap<Run, number>();
  private nextId = 1;
  private readonly observers = new Set<LocalSessionObserver>();
  private readonly listed = new Map<string, LocalSessionSnapshot>();
  private revision = 0;

  public runInstanceIdOf(run: Run): number {
    let id = this.ids.get(run);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(run, id);
    }
    return id;
  }

  public observe(observer: LocalSessionObserver) {
    this.observers.add(observer);
    return {
      snapshot: { revision: this.revision, sessions: [...this.listed.values()] },
      unsubscribe: () => this.observers.delete(observer),
    };
  }

  public register(run: Run): void {
    const previous = this.listed.get(run.runId);
    if (previous) this.remove(run.runId);
    const session = {
      runId: run.runId,
      runInstanceId: this.runInstanceIdOf(run),
    } as LocalSessionSnapshot;
    this.listed.set(run.runId, session);
    this.emit({ revision: ++this.revision, kind: 'registered', session });
  }

  public remove(runId: string): void {
    const previous = this.listed.get(runId);
    if (!previous) return;
    this.listed.delete(runId);
    this.emit({
      revision: ++this.revision,
      kind: 'removed',
      runId,
      runInstanceId: previous.runInstanceId,
    });
  }

  private emit(update: LocalSessionUpdate): void {
    for (const observer of this.observers) observer(update);
  }
}

class FakeRunOutput {
  private readonly listeners = new Set<RunOutputListener>();

  public onRunOutput(listener: RunOutputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public publish(event: LocalAgentOutputEvent, attribution: RunOutputAttribution): void {
    for (const listener of this.listeners) listener(event, attribution);
  }
}

const fakeRun = (runId: string): Run => ({ runId }) as unknown as Run;

interface Harness {
  source: SessionActivitySource;
  readSource: FakeReadSource;
  output: FakeRunOutput;
  updates: SessionActivityUpdate[];
  emit: (
    run: Run,
    input: Omit<NormalizeProviderEventInput, 'runId' | 'timestamp' | 'config'> & {
      timestamp?: string;
      config?: ProviderEventNormalizationConfig;
    },
    attribution?: Partial<Omit<RunOutputAttribution, 'run'>>,
  ) => void;
  entries: (runId: string) => readonly SessionActivityEntry[];
}

const harness = (
  options: { limits?: Partial<SessionActivityLimits>; logger?: ServerLogger } = {},
): Harness => {
  const readSource = new FakeReadSource();
  const output = new FakeRunOutput();
  const source = new SessionActivitySource({
    runOutput: output,
    readSource,
    logger: options.logger ?? NOOP_LOGGER,
    limits: { ...SESSION_ACTIVITY_LIMITS, ...options.limits },
    now: () => new Date(clock),
  });
  const updates: SessionActivityUpdate[] = [];
  source.observe((update) => updates.push(update));
  return {
    source,
    readSource,
    output,
    updates,
    emit: (run, input, attribution = {}) => {
      const timestamp = input.timestamp ?? at();
      const normalizeInput: NormalizeProviderEventInput = {
        ...input,
        runId: run.runId,
        timestamp,
        config: input.config ?? CONFIG,
      };
      const normalized =
        input.provider === 'codex'
          ? mapCodexEvent(normalizeInput)
          : normalizeProviderEventPayload(normalizeInput);
      output.publish(
        {
          runId: run.runId,
          source: 'provider',
          eventType: normalized.resolvedEventType ?? input.eventType,
          timestamp,
          sessionId: input.sessionId,
          agentId: input.agentId,
          payload: normalized.payload,
          ...(normalized.facts ? { providerFacts: normalized.facts } : {}),
        },
        { run, turnId: 'turn-1', subagentTurnId: null, ...attribution },
      );
    },
    entries: (runId) =>
      source.snapshot().runs.find((candidate) => candidate.runId === runId)?.entries ?? [],
  };
};

const claude = (rawEvent: Record<string, unknown>) => ({
  provider: 'claude' as const,
  eventType: String(rawEvent['type']),
  sessionId: 'claude-session',
  agentId: 'claude',
  rawEvent,
});

const claudeAssistant = (
  content: Array<Record<string, unknown>>,
  parentToolUseId: string | null = null,
) =>
  claude({
    type: 'assistant',
    message: { content },
    parent_tool_use_id: parentToolUseId,
  });

const claudeResult = (
  toolUseId: string,
  text: string,
  isError = false,
  parentToolUseId: string | null = null,
) =>
  claude({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: isError }],
    },
    parent_tool_use_id: parentToolUseId,
  });

const codex = (eventType: string, rawEvent: Record<string, unknown>) => ({
  provider: 'codex' as const,
  eventType,
  sessionId: 'codex-session',
  agentId: 'codex',
  rawEvent: { threadId: 'thread-root', turnId: 'pturn-1', ...rawEvent },
});

const opencode = (eventType: string, rawEvent: Record<string, unknown>) => ({
  provider: 'opencode' as const,
  eventType,
  sessionId: 'opencode-session',
  agentId: 'opencode',
  rawEvent,
});

const tools = (entries: readonly SessionActivityEntry[]): SessionToolEntry[] =>
  entries.filter((entry): entry is SessionToolEntry => entry.kind === 'tool');
const narrations = (entries: readonly SessionActivityEntry[]): SessionNarrationEntry[] =>
  entries.filter((entry): entry is SessionNarrationEntry => entry.kind === 'narration');

describe('SessionActivitySource provider coverage', () => {
  it('Claude: whole-message narration, tool call with arguments, and result; reasoning excluded', () => {
    const h = harness();
    const run = fakeRun('run-claude');
    h.readSource.register(run);

    h.emit(
      run,
      claudeAssistant([
        { type: 'thinking', thinking: 'hidden reasoning' },
        { type: 'text', text: 'Reading the config.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } },
      ]),
    );
    h.emit(run, claudeResult('toolu_1', 'file contents'));

    const entries = h.entries('run-claude');
    expect(narrations(entries)).toEqual([
      expect.objectContaining({
        text: { text: 'Reading the config.', truncatedBytes: 0 },
        open: false,
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('hidden reasoning');
    expect(tools(entries)).toEqual([
      expect.objectContaining({
        toolUseId: 'toolu_1',
        toolName: 'Read',
        input: { text: '{"file_path":"a.ts"}', truncatedBytes: 0 },
        status: 'completed',
        result: { text: 'file contents', truncatedBytes: 0 },
        // Claude does not stream command output or report exit codes or turn ids.
        output: { text: '', truncatedBytes: 0 },
        exitCode: null,
        providerTurnId: null,
      }),
    ]);
  });

  it('Claude with tool tracking disabled: results still appear, unnamed and without arguments', () => {
    const h = harness();
    const run = fakeRun('run-untracked');
    h.readSource.register(run);
    const untracked = { ...CONFIG, trackTools: false };

    h.emit(run, {
      ...claudeAssistant([
        { type: 'tool_use', id: 'toolu_9', name: 'Bash', input: { command: 'ls' } },
      ]),
      config: untracked,
    });
    h.emit(run, { ...claudeResult('toolu_9', 'boom', true), config: untracked });

    expect(tools(h.entries('run-untracked'))).toEqual([
      expect.objectContaining({
        toolUseId: 'toolu_9',
        toolName: null,
        input: null,
        status: 'failed',
        result: { text: 'boom', truncatedBytes: 0 },
      }),
    ]);
  });

  it('Codex: streamed narration, command start, output chunks and exit code', () => {
    const h = harness();
    const run = fakeRun('run-codex');
    h.readSource.register(run);

    h.emit(run, codex('item/agentMessage/delta', { itemId: 'msg-1', delta: 'Running ' }));
    h.emit(run, codex('item/agentMessage/delta', { itemId: 'msg-1', delta: 'tests' }));
    h.emit(
      run,
      codex('item/started', {
        item: { type: 'commandExecution', id: 'cmd-1', command: 'pnpm test', cwd: '/repo' },
      }),
    );
    const partial = narrations(h.entries('run-codex'))[0];
    expect(partial).toMatchObject({ text: { text: 'Running tests' }, open: true });
    h.emit(run, codex('item/commandExecution/outputDelta', { itemId: 'cmd-1', delta: 'ok 1\n' }));
    h.emit(run, codex('item/commandExecution/outputDelta', { itemId: 'cmd-1', delta: 'ok 2\n' }));
    h.emit(
      run,
      codex('item/completed', {
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          status: 'failed',
          exitCode: 1,
          aggregatedOutput: 'ok 1\nok 2\n',
        },
      }),
    );
    h.emit(
      run,
      codex('item/completed', {
        item: { type: 'agentMessage', id: 'msg-1', text: 'Running tests.' },
      }),
    );

    const entries = h.entries('run-codex');
    expect(narrations(entries)).toEqual([
      expect.objectContaining({
        entryId: partial?.entryId,
        text: { text: 'Running tests.', truncatedBytes: 0 },
        open: false,
        providerTurnId: 'pturn-1',
      }),
    ]);
    expect(tools(entries)).toEqual([
      expect.objectContaining({
        toolUseId: 'cmd-1',
        toolName: 'shell',
        input: { text: '{"command":"pnpm test","cwd":"/repo"}', truncatedBytes: 0 },
        output: { text: 'ok 1\nok 2\n', truncatedBytes: 0 },
        status: 'failed',
        exitCode: 1,
        result: { text: 'ok 1\nok 2', truncatedBytes: 0 },
      }),
    ]);
  });

  it('OpenCode: in-flight tool call before completion and streamed narration', () => {
    const h = harness();
    const run = fakeRun('run-opencode');
    h.readSource.register(run);
    const part = (state: Record<string, unknown>) =>
      opencode('message.part.updated', {
        part: { type: 'tool', tool: 'bash', callID: 'call-1', state },
      });

    h.emit(run, part({ status: 'running', input: { command: 'ls' } }));
    expect(tools(h.entries('run-opencode'))).toEqual([
      expect.objectContaining({ toolUseId: 'call-1', toolName: 'bash', status: 'running' }),
    ]);
    h.emit(run, part({ status: 'completed', input: { command: 'ls' }, output: 'a.ts' }));
    h.emit(run, opencode('message.part.delta', { field: 'text', delta: 'Found ' }));
    h.emit(run, opencode('message.part.delta', { field: 'text', delta: 'a.ts' }));
    h.emit(
      run,
      opencode('message.part.updated', {
        part: { type: 'reasoning', text: 'secret', time: { end: 1 } },
      }),
    );
    h.emit(
      run,
      opencode('message.part.updated', {
        part: { type: 'text', text: 'Found a.ts.', time: { end: 1 } },
      }),
    );

    const entries = h.entries('run-opencode');
    expect(tools(entries)).toEqual([
      expect.objectContaining({
        toolUseId: 'call-1',
        status: 'completed',
        result: { text: 'a.ts', truncatedBytes: 0 },
        // OpenCode reports no exit code, streamed output or provider turn.
        exitCode: null,
        output: { text: '', truncatedBytes: 0 },
        providerTurnId: null,
      }),
    ]);
    expect(narrations(entries)).toEqual([
      expect.objectContaining({ text: { text: 'Found a.ts.', truncatedBytes: 0 }, open: false }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('secret');
  });
});

describe('SessionActivitySource correlation', () => {
  it('keeps root and subagent tools with equal ids distinct through interleaved, late completions', () => {
    const h = harness();
    const run = fakeRun('run-sub');
    h.readSource.register(run);

    h.emit(run, claudeAssistant([{ type: 'tool_use', id: 'toolu_A', name: 'Task', input: {} }]));
    h.emit(
      run,
      claudeAssistant([{ type: 'tool_use', id: 'toolu_X', name: 'Grep', input: {} }], 'toolu_A'),
    );
    h.emit(run, claudeAssistant([{ type: 'tool_use', id: 'toolu_X', name: 'Read', input: {} }]), {
      subagentTurnId: 'sub-turn',
    });
    h.emit(run, claudeResult('toolu_X', 'from subagent turn'), { subagentTurnId: 'sub-turn' });
    h.emit(run, claudeResult('toolu_X', 'from nested agent', false, 'toolu_A'));
    h.emit(run, claudeResult('toolu_A', 'task done'));

    const byLane = tools(h.entries('run-sub')).map((entry) => ({
      toolUseId: entry.toolUseId,
      toolName: entry.toolName,
      result: entry.result?.text,
      lane: entry.lane,
    }));
    expect(byLane).toEqual([
      {
        toolUseId: 'toolu_A',
        toolName: 'Task',
        result: 'task done',
        lane: { subagentTurnId: null, providerThreadId: null, parentToolUseId: null },
      },
      {
        toolUseId: 'toolu_X',
        toolName: 'Grep',
        result: 'from nested agent',
        lane: { subagentTurnId: null, providerThreadId: null, parentToolUseId: 'toolu_A' },
      },
      {
        toolUseId: 'toolu_X',
        toolName: 'Read',
        result: 'from subagent turn',
        lane: { subagentTurnId: 'sub-turn', providerThreadId: null, parentToolUseId: null },
      },
    ]);
  });

  it('opens an entry from a result that arrives before its start and fills it in later', () => {
    const h = harness();
    const run = fakeRun('run-early');
    h.readSource.register(run);

    h.emit(run, claudeResult('toolu_late', 'done first'));
    h.emit(
      run,
      claudeAssistant([
        { type: 'tool_use', id: 'toolu_late', name: 'Bash', input: { command: 'x' } },
      ]),
    );

    expect(tools(h.entries('run-early'))).toEqual([
      expect.objectContaining({
        toolUseId: 'toolu_late',
        toolName: 'Bash',
        status: 'completed',
        result: { text: 'done first', truncatedBytes: 0 },
      }),
    ]);
  });

  it('keeps Codex descendant-thread commands apart from root commands', () => {
    const h = harness();
    const run = fakeRun('run-codex-sub');
    h.readSource.register(run);
    const start = (threadId: string) =>
      codex('item/started', {
        threadId,
        item: { type: 'commandExecution', id: 'cmd-1', command: threadId, cwd: '/' },
      });

    h.emit(run, start('thread-root'));
    h.emit(run, start('thread-child'));

    expect(tools(h.entries('run-codex-sub')).map((entry) => entry.lane.providerThreadId)).toEqual([
      'thread-root',
      'thread-child',
    ]);
  });
});

describe('SessionActivitySource membership and handoff', () => {
  it('captures without any observer and hands a mid-Turn snapshot plus later updates to a late observer', () => {
    const h = harness();
    const run = fakeRun('run-late');
    h.readSource.register(run);
    h.emit(run, claudeAssistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]));

    const seen: SessionActivityUpdate[] = [];
    const { snapshot } = h.source.observe((update) => seen.push(update));
    h.emit(run, claudeResult('t1', 'out'));

    expect(snapshot.runs[0]?.entries).toEqual([
      expect.objectContaining({ toolUseId: 't1', status: 'running' }),
    ]);
    expect(seen).toHaveLength(1);
    const [update] = seen;
    expect(update?.revision).toBe(snapshot.revision + 1);
    expect(update?.kind === 'entry' && update.entry).toMatchObject({
      toolUseId: 't1',
      status: 'completed',
    });
  });

  it('ignores Runs the registry does not list and replaced Run instances', () => {
    const h = harness();
    const unlisted = fakeRun('run-x');
    h.emit(unlisted, claudeAssistant([{ type: 'text', text: 'ignored' }]));
    expect(h.source.snapshot().runs).toEqual([]);

    const original = fakeRun('run-x');
    const replacement = fakeRun('run-x');
    h.readSource.register(original);
    h.emit(original, claudeAssistant([{ type: 'text', text: 'first' }]));
    h.readSource.register(replacement);
    h.emit(original, claudeAssistant([{ type: 'text', text: 'stale' }]));
    h.emit(replacement, claudeAssistant([{ type: 'text', text: 'second' }]));

    const runs = h.source.snapshot().runs;
    expect(runs).toHaveLength(1);
    expect(narrations(runs[0]?.entries ?? []).map((entry) => entry.text.text)).toEqual(['second']);
    expect(h.updates).toContainEqual(
      expect.objectContaining({ kind: 'disposed', runId: 'run-x', runInstanceId: 2 }),
    );
  });

  it('disposes a Run buffer and its bookkeeping when the Run leaves the registry', () => {
    const h = harness();
    const run = fakeRun('run-gone');
    h.readSource.register(run);
    h.emit(run, claudeAssistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]));
    h.readSource.remove('run-gone');
    h.emit(run, claudeResult('t1', 'late'));

    expect(h.source.snapshot().runs).toEqual([]);
    expect(h.updates.at(-1)).toMatchObject({ kind: 'disposed', runId: 'run-gone' });
  });

  it('isolates a throwing observer from other observers and the publisher', () => {
    const warnings: string[] = [];
    const logger = {
      ...NOOP_LOGGER,
      warn: (event: string) => warnings.push(event),
    } as ServerLogger;
    const h = harness({ logger });
    h.source.observe(() => {
      throw new Error('display failed');
    });
    const run = fakeRun('run-iso');
    h.readSource.register(run);

    expect(() => h.emit(run, claudeAssistant([{ type: 'text', text: 'hi' }]))).not.toThrow();
    expect(h.updates).toContainEqual(expect.objectContaining({ kind: 'entry' }));
    expect(warnings).toContain('session_activity.observer_failed');
  });
});

describe('SessionActivitySource retention', () => {
  it('truncates oversized output visibly, keeping the most recent bytes', () => {
    const h = harness({ limits: { maxTextBytes: 8 } });
    const run = fakeRun('run-big');
    h.readSource.register(run);
    h.emit(
      run,
      codex('item/started', {
        item: { type: 'commandExecution', id: 'c', command: 'x', cwd: '/' },
      }),
    );
    h.emit(run, codex('item/commandExecution/outputDelta', { itemId: 'c', delta: '0123456789' }));
    h.emit(run, codex('item/commandExecution/outputDelta', { itemId: 'c', delta: 'abc' }));

    expect(tools(h.entries('run-big'))[0]?.output).toEqual({ text: '56789abc', truncatedBytes: 5 });
  });

  it('evicts oldest entries past the per-Run byte and entry limits and reports the gap', () => {
    const h = harness({ limits: { maxEntriesPerRun: 2 } });
    const run = fakeRun('run-evict');
    h.readSource.register(run);
    for (const text of ['one', 'two', 'three']) {
      h.emit(run, claudeAssistant([{ type: 'text', text }]));
    }

    const [snapshot] = h.source.snapshot().runs;
    expect(narrations(snapshot?.entries ?? []).map((entry) => entry.text.text)).toEqual([
      'two',
      'three',
    ]);
    expect(snapshot?.gap).toEqual({ evictedCount: 1, throughSeq: 1 });
    expect(h.updates).toContainEqual(
      expect.objectContaining({ kind: 'evicted', reason: 'entry-count', entryIds: ['1:1'] }),
    );

    const bytes = harness({ limits: { maxRunBytes: 600 } });
    bytes.readSource.register(run);
    for (const text of ['a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200)]) {
      bytes.emit(run, claudeAssistant([{ type: 'text', text }]));
    }
    expect(bytes.entries('run-evict')).toHaveLength(1);
    expect(bytes.updates).toContainEqual(expect.objectContaining({ reason: 'run-bytes' }));
  });

  it('evicts across Runs to hold the aggregate budget, oldest first', () => {
    const h = harness({ limits: { maxTotalBytes: 1000 } });
    const first = fakeRun('run-1');
    const second = fakeRun('run-2');
    h.readSource.register(first);
    h.readSource.register(second);
    h.emit(first, {
      ...claudeAssistant([{ type: 'text', text: 'x'.repeat(200) }]),
      timestamp: at(0),
    });
    h.emit(second, {
      ...claudeAssistant([{ type: 'text', text: 'y'.repeat(200) }]),
      timestamp: at(1),
    });
    h.emit(second, {
      ...claudeAssistant([{ type: 'text', text: 'z'.repeat(200) }]),
      timestamp: at(2),
    });

    expect(h.entries('run-1')).toEqual([]);
    expect(h.entries('run-2')).toHaveLength(2);
    expect(h.updates).toContainEqual(
      expect.objectContaining({ kind: 'evicted', runId: 'run-1', reason: 'total-bytes' }),
    );
  });

  it('expires entries not updated within the age limit', () => {
    const h = harness();
    const run = fakeRun('run-age');
    h.readSource.register(run);
    h.emit(run, claudeAssistant([{ type: 'text', text: 'old' }]));
    clock += SESSION_ACTIVITY_LIMITS.maxEntryAgeMs + 1;

    const [snapshot] = h.source.snapshot().runs;
    expect(snapshot?.entries).toEqual([]);
    expect(snapshot?.gap).toEqual({ evictedCount: 1, throughSeq: 1 });
  });
});
