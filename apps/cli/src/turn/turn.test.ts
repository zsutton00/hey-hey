/**
 * Turn tests — the immutable value-object lifecycle.
 *
 * Turn no longer has a deps bag, a parentRun pointer, or nullable fields
 * that require runtime guards. Its surface is:
 *   - constructor — every field required and resolved upstream
 *   - begin()    — phase transition, no async work
 *   - run()      — invokes runner, always end()s in finally
 *   - end()      — fires onEnd, idempotent
 *   - abort()    — fires the abort controller
 *
 * The "Turn 1 late-completes vs Turn 2 begin" race is no longer tested
 * because it is no longer possible by construction: Run is the sole
 * scheduler, and Turn 2 can only be built inside Turn 1's onEnd callback.
 */

import { describe, expect, it, vi } from 'vitest';

import { Turn, type Runner, type TurnArgs } from './turn';
import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import { ActivePlatformToolCatalog } from '../agents/platform-mcp-proxy/catalog';
import { TurnPlatformMcpProxy } from '../agents/platform-mcp-proxy/turn-proxy';
import type { ServerLogger } from '../server/logger';
import { createTestRun } from '../run/run.test-support';

const makeLogger = (): ServerLogger =>
  ({
    trace: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as ServerLogger;

const makeHandler = (promptType = 'entity_conversation'): PromptTypeHandler<unknown> =>
  ({
    id: promptType,
    promptType,
    service: 'required',
    launchEntity: 'none',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],
    buildPrompt: () => 'system prompt',
  }) as PromptTypeHandler<unknown>;

interface Harness {
  turn: Turn;
  runnerRun: ReturnType<typeof vi.fn>;
  onRunnerCompleted: ReturnType<typeof vi.fn>;
  onRunnerFailed: ReturnType<typeof vi.fn>;
  onEnd: ReturnType<typeof vi.fn>;
  logger: ServerLogger;
}

const build = (overrides?: {
  runnerImpl?: (signal: AbortSignal) => Promise<void>;
  onEndImpl?: (turn: Turn) => Promise<void>;
  args?: Partial<TurnArgs>;
}): Harness => {
  const runnerRun = vi.fn<(signal: AbortSignal) => Promise<void>>(
    overrides?.runnerImpl ?? (async () => {}),
  );
  const runner: Runner = { run: runnerRun };
  const onRunnerCompleted = vi.fn<(turn: Turn) => Promise<void>>(async () => {});
  const onRunnerFailed = vi.fn<(turn: Turn, error: unknown) => Promise<void>>(async () => {});
  const onEnd = vi.fn<(turn: Turn) => Promise<void>>(overrides?.onEndImpl ?? (async () => {}));
  const logger = makeLogger();
  const owner = createTestRun();
  vi.spyOn(owner, 'onTurnRunnerCompleted').mockImplementation(onRunnerCompleted);
  vi.spyOn(owner, 'onTurnRunnerFailed').mockImplementation(onRunnerFailed);
  vi.spyOn(owner, 'onTurnEnded').mockImplementation(onEnd);

  const args: TurnArgs = {
    effectiveRole: 'implementation',
    turnId: 'turn-1',
    runId: 'run-1',
    resolvedPrompt: 'resolved',
    handler: makeHandler(),
    externalAgentNodeId: null,
    triggerMessageId: null,
    runner,
    platformMcpProxy: null,
    abortController: new AbortController(),
    effectiveModel: null,
    effectiveReasoningEffort: null,
    logger,
    owner,
    ...(overrides?.args ?? {}),
  };
  const turn = new Turn(args);
  return { turn, runnerRun, onRunnerCompleted, onRunnerFailed, onEnd, logger };
};

describe('Turn constructor', () => {
  it('retains the resolved role beside the fixed handler', () => {
    const { turn } = build({ args: { effectiveRole: 'research' } });
    expect(turn.effectiveRole).toBe('research');
    expect(turn.handler.id).toBe('entity_conversation');
  });
  it('snapshots reference metadata without retaining a mutable caller array', () => {
    const attachments = [{ attachmentId: 'attachment-id', fileName: 'notes.md' }];
    const { turn } = build({ args: { attachments } });
    attachments[0]!.fileName = 'changed.md';
    attachments.length = 0;
    expect(turn.attachments).toEqual([{ attachmentId: 'attachment-id', fileName: 'notes.md' }]);
    expect(Object.isFrozen(turn.attachments)).toBe(true);
    expect(Object.isFrozen(turn.attachments[0])).toBe(true);
  });

  it('freezes the resolved fields on the instance', () => {
    const { turn } = build();
    expect(turn.turnId).toBe('turn-1');
    expect(turn.runId).toBe('run-1');
    expect(turn.resolvedPrompt).toBe('resolved');
    expect(turn.handler.promptType).toBe('entity_conversation');
    expect(turn.externalAgentNodeId).toBeNull();
    expect(turn.triggerMessageId).toBeNull();
    expect(turn.phase).toBe('created');
  });
});

describe('Turn platform MCP proxy ownership', () => {
  it('closes the scoped platform MCP proxy during end', async () => {
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({ additionalTools: ['get_context'] }),
      activeHandlerPromptType: 'entity_conversation',
    });
    const close = vi.spyOn(proxy, 'close');
    const { turn } = build({
      args: {
        platformMcpProxy: proxy,
      },
    });

    await turn.end();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('Turn proposal identities', () => {
  it('keeps creation order, deduplicates, freezes completion, and clears after Message creation', () => {
    const { turn } = build();
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';

    turn.recordCreatedProposal(first);
    turn.recordCreatedProposal(second);
    turn.recordCreatedProposal(first);

    expect(turn.readCreatedProposalIds()).toEqual([first, second]);
    const initial = turn.snapshotCompletionArtifactIds(['report-1', 'report-2']);
    turn.recordCreatedProposal('33333333-3333-4333-8333-333333333333');
    const retry = turn.snapshotCompletionArtifactIds(['different-report']);

    expect(initial).toEqual({
      proposalIds: [first, second],
      reportIds: ['report-1', 'report-2'],
    });
    expect(retry).toEqual(initial);

    turn.recordCompletedAssistantMessage('message-1');
    expect(turn.readCreatedProposalIds()).toEqual([]);
  });

  it('reconciles removed group drafts before freezing and collects a recreated proposal', () => {
    const { turn } = build();
    const surviving = '11111111-1111-4111-8111-111111111111';
    const removed = '22222222-2222-4222-8222-222222222222';
    const recreated = '33333333-3333-4333-8333-333333333333';

    turn.recordCreatedProposal(surviving);
    turn.recordCreatedProposal(removed);
    turn.recordRemovedProposal(removed);
    turn.recordCreatedProposal(recreated);

    expect(turn.snapshotCompletionArtifactIds([]).proposalIds).toEqual([surviving, recreated]);
    turn.recordRemovedProposal(surviving);
    expect(turn.snapshotCompletionArtifactIds([]).proposalIds).toEqual([surviving, recreated]);
  });

  it('merges existing Proposal identities in first-seen order and rejects post-snapshot inclusion', () => {
    const { turn } = build();
    const created = '11111111-1111-4111-8111-111111111111';
    const existing = '22222222-2222-4222-8222-222222222222';

    turn.recordCreatedProposal(created);
    turn.includeExistingProposals([existing, created]);
    expect(turn.snapshotCompletionArtifactIds([]).proposalIds).toEqual([created, existing]);
    expect(() => turn.includeExistingProposals([existing])).toThrow('completion snapshot');
  });
});

describe('Turn.begin()', () => {
  it('transitions created → began', async () => {
    const { turn } = build();
    await turn.begin();
    expect(turn.phase).toBe('began');
  });

  it('throws if called twice', async () => {
    const { turn } = build();
    await turn.begin();
    await expect(turn.begin()).rejects.toThrow(/phase "began"/);
  });

  it('throws if called after end()', async () => {
    const { turn } = build();
    await turn.begin();
    await turn.end();
    await expect(turn.begin()).rejects.toThrow(/phase "ended"/);
  });
});

describe('Turn.run()', () => {
  it('throws if called before begin()', async () => {
    const { turn } = build();
    await expect(turn.run()).rejects.toThrow(/phase "created"/);
  });

  it('invokes runner.run with the abort signal and transitions through running → ended', async () => {
    let phaseDuringRunner: string | null = null;
    const { turn, runnerRun } = build({
      runnerImpl: async () => {
        phaseDuringRunner = turn.phase;
      },
    });

    await turn.begin();
    await turn.run();

    expect(phaseDuringRunner).toBe('running');
    expect(turn.phase).toBe('ended');
    expect(runnerRun).toHaveBeenCalledTimes(1);
    expect(runnerRun).toHaveBeenCalledWith(turn.abortSignal);
  });

  it('throws if called twice', async () => {
    const { turn } = build();
    await turn.begin();
    await turn.run();
    await expect(turn.run()).rejects.toThrow(/phase "ended"/);
  });
});

describe('Turn.run() error + abort semantics', () => {
  it('calls end() in finally when the runner throws, logs the error, and does not re-throw', async () => {
    const failure = new Error('runner boom');
    const { turn, onEnd, onRunnerFailed, logger } = build({
      runnerImpl: async () => {
        throw failure;
      },
    });

    await turn.begin();
    await expect(turn.run()).resolves.toBeUndefined();

    expect(turn.phase).toBe('ended');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onRunnerFailed).toHaveBeenCalledWith(turn, failure);
    expect(logger.error).toHaveBeenCalledWith(
      'runtime.turn.run_failed',
      expect.objectContaining({ runId: 'run-1', error: failure }),
    );
  });

  it('logs ASCII guidance at info level when a durable event append lock already exists', async () => {
    const failure = Object.assign(new Error('EEXIST'), {
      code: 'EEXIST',
      path: '/runs/run-1/member/events.data.append-lock',
      syscall: 'mkdir',
    });
    const { turn, logger } = build({
      runnerImpl: async () => {
        throw failure;
      },
    });

    await turn.begin();
    await turn.run();

    expect(logger.info).toHaveBeenCalledWith(
      'runtime.turn.run_failed.append_lock_guidance',
      expect.objectContaining({
        runId: 'run-1',
        appendLockPath: '/runs/run-1/member/events.data.append-lock',
        message: expect.stringContaining('Another session or process may be writing'),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'runtime.turn.run_failed',
      expect.objectContaining({ error: failure }),
    );
  });

  it('aborts during run() by firing turn.abort() — runner sees an aborted signal and end() fires', async () => {
    let signalAtStart: boolean | undefined;
    let signalAtEnd: boolean | undefined;
    const { turn, onEnd, onRunnerFailed, logger } = build({
      runnerImpl: async (signal) => {
        signalAtStart = signal.aborted;
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        signalAtEnd = signal.aborted;
      },
    });

    await turn.begin();
    const running = turn.run();
    await Promise.resolve();
    turn.abort();
    await running;

    expect(signalAtStart).toBe(false);
    expect(signalAtEnd).toBe(true);
    expect(turn.phase).toBe('ended');
    expect(turn.terminalOutcome).toBe('ABORTED');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onRunnerFailed).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalledWith('runtime.turn.run_failed', expect.anything());
  });
});

describe('Turn.end()', () => {
  it('fires onEnd with the Turn instance', async () => {
    const { turn, onEnd } = build();
    await turn.end();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(turn);
    expect(turn.phase).toBe('ended');
  });

  it('is idempotent — second call returns the same promise and onEnd fires exactly once', async () => {
    const { turn, onEnd } = build();

    const first = turn.end();
    const second = turn.end();

    expect(first).toBe(second);

    await first;
    await second;

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('phase still advances to ended even if onEnd throws, and the error is logged', async () => {
    const boom = new Error('onEnd boom');
    const { turn, logger } = build({
      onEndImpl: async () => {
        throw boom;
      },
    });

    await expect(turn.end()).resolves.toBeUndefined();
    expect(turn.phase).toBe('ended');
    expect(logger.error).toHaveBeenCalledWith(
      'runtime.turn.end_onEnd_failed',
      expect.objectContaining({ runId: 'run-1', error: boom }),
    );
  });
});

describe('Turn.abort()', () => {
  it('fires the abort controller', () => {
    const { turn } = build();
    expect(turn.abortSignal.aborted).toBe(false);
    turn.abort();
    expect(turn.abortSignal.aborted).toBe(true);
  });
});
