import crypto from 'node:crypto';

import type { ServerLogger } from '../../server/logger';
import type { AgenticSession } from '../../session/types';
import type { ChildAgentLauncher } from '../../run/child-agent-launcher';
import type { ProjectAssistantChildChecks } from '../prompts/project-assistant';
import {
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
} from '../../state-machine';
import {
  createSubagentFanoutDefinition,
  SUBAGENT_FANOUT_MACHINE_TYPE,
  subagentFanoutStartIngressId,
  subagentFanoutStateStoreCodec,
  type SubagentChildOutcome,
  type SubagentFanoutContext,
  type SubagentFanoutEffect,
  type SubagentFanoutEvent,
  type SubagentFanoutMachineLogic,
  type SubagentFanoutMachineRegistry,
  type SubagentFanoutMachineRuntime,
  type SubagentFanoutOutcome,
  type SubagentFanoutState,
  type SubagentFanoutStateStore,
  type VerifiedSubagentFanoutStart,
} from './machine';
import {
  createRunChildEffectHandler,
  type SubagentFanoutLiveCall,
} from './run-child-effect-handler';

/** Children run at once across every fan-out in this CLI process. */
const DEFAULT_MAX_CONCURRENT_CHILDREN = 10;

export interface SubagentFanoutRequest {
  readonly parentSession: AgenticSession;
  readonly parentRunId: string;
  readonly parentTurnId?: string;
  readonly objectives: readonly string[];
  /** The parent's resolved research-check gates; kept in-process only, since interrupted children never restart. */
  readonly projectAssistantChecks: ProjectAssistantChildChecks;
  readonly signal: AbortSignal;
}

export interface SubagentChildResult {
  readonly objective: string;
  readonly outcome: SubagentChildOutcome;
  readonly outputText?: string;
  readonly reason?: string;
}

/** What a caller needs to run one fan-out and receive its ordered results. */
export interface SubagentFanout {
  run(request: SubagentFanoutRequest): Promise<readonly SubagentChildResult[]>;
}

/** The fan-out machine has not been restored in this process. */
export class SubagentFanoutUnavailableError extends Error {
  public constructor() {
    super('Subagent fan-out is unavailable because its machine has not been restored.');
    this.name = 'SubagentFanoutUnavailableError';
  }
}

export interface SubagentFanoutRuntimeDependencies {
  readonly storePath: string;
  readonly childAgentLauncher: Pick<ChildAgentLauncher, 'launchRegistered'>;
  readonly logger: ServerLogger;
  readonly randomId?: () => string;
  readonly maxConcurrentChildren?: number;
}

/**
 * Owns the durable fan-out machine stack. One instance per run_subagents call
 * commits one run_child effect per objective; the call waits in-process for
 * the instance to settle and reads the ordered results from its snapshot.
 */
export class SubagentFanoutRuntime implements SubagentFanout {
  private readonly store: SubagentFanoutStateStore;
  private readonly runtime: SubagentFanoutMachineRuntime;
  private readonly registry: SubagentFanoutMachineRegistry;
  private readonly effectRunner: EffectRunner<
    typeof SUBAGENT_FANOUT_MACHINE_TYPE,
    SubagentFanoutState,
    SubagentFanoutEvent,
    SubagentFanoutContext,
    SubagentFanoutMachineLogic,
    SubagentFanoutEffect,
    SubagentFanoutOutcome,
    VerifiedSubagentFanoutStart
  >;
  private readonly recovery: MachineRecovery<
    typeof SUBAGENT_FANOUT_MACHINE_TYPE,
    SubagentFanoutState,
    SubagentFanoutEvent,
    SubagentFanoutContext,
    SubagentFanoutMachineLogic,
    SubagentFanoutEffect,
    SubagentFanoutOutcome,
    VerifiedSubagentFanoutStart
  >;
  private readonly liveCalls = new Map<string, SubagentFanoutLiveCall>();
  private readonly randomId: () => string;
  private readonly logger: ServerLogger;
  private available = false;

  public constructor(deps: SubagentFanoutRuntimeDependencies) {
    this.logger = deps.logger;
    this.randomId = deps.randomId ?? (() => crypto.randomUUID());
    this.store = new MachineStateStore(deps.storePath, subagentFanoutStateStoreCodec);
    this.runtime = new MachineRuntime(this.store, deps.logger.child({ component: 'runtime' }));
    this.registry = new MachineRegistry(this.runtime, deps.logger.child({ component: 'registry' }));
    this.registry.register(createSubagentFanoutDefinition());
    this.effectRunner = new EffectRunner(
      this.store,
      this.runtime,
      this.registry,
      {
        run_child: createRunChildEffectHandler({
          launcher: deps.childAgentLauncher,
          findLiveCall: (instanceId) => this.liveCalls.get(instanceId),
          logger: deps.logger,
        }),
      },
      deps.logger.child({ component: 'effects' }),
      { maxConcurrentEffects: deps.maxConcurrentChildren ?? DEFAULT_MAX_CONCURRENT_CHILDREN },
    );
    this.recovery = new MachineRecovery(
      this.store,
      this.registry,
      this.effectRunner,
      deps.logger.child({ component: 'recovery' }),
    );
  }

  public restore(): Promise<{ readonly snapshots: readonly unknown[] }> {
    return this.recovery.restore();
  }

  public startLiveProcessing(): void {
    this.effectRunner.startLiveProcessing();
    this.available = true;
  }

  public stopClaiming(): void {
    this.available = false;
    this.effectRunner.stopClaiming();
  }

  public async run(request: SubagentFanoutRequest): Promise<readonly SubagentChildResult[]> {
    if (!this.available) throw new SubagentFanoutUnavailableError();
    const instanceId = this.randomId();
    const identity = { machineType: SUBAGENT_FANOUT_MACHINE_TYPE, instanceId } as const;
    this.liveCalls.set(instanceId, {
      parentSession: request.parentSession,
      projectAssistantChecks: request.projectAssistantChecks,
      signal: request.signal,
    });
    let stopWatching = (): void => undefined;
    try {
      const settled = new Promise<SubagentFanoutContext>((resolve) => {
        stopWatching = this.runtime.onTransitionCommitted(instanceId, (snapshot) => {
          if (snapshot.state === 'settled') resolve(snapshot.context);
        });
      });
      this.logger.debug('subagent_fanout.started', {
        instanceId,
        parentRunId: request.parentRunId,
        childCount: request.objectives.length,
      });
      const admission = await this.registry.admit(
        identity,
        subagentFanoutStartIngressId(instanceId),
        {
          instanceId,
          parentRunId: request.parentRunId,
          parentTurnId: request.parentTurnId ?? null,
          objectives: request.objectives,
        },
      );
      if (admission.status === 'rejected') {
        throw new Error(`Subagent fan-out was not started: ${admission.reason}`);
      }
      const context = await settled;
      this.logger.debug('subagent_fanout.settled', {
        instanceId,
        outcomes: context.children.map((child) => child.outcome),
      });
      return [...context.children]
        .sort((left, right) => left.index - right.index)
        .map((child) => ({
          objective: child.objective,
          // The machine settles only once every child carries an outcome.
          outcome: child.outcome ?? 'interrupted',
          ...(child.outputText !== undefined ? { outputText: child.outputText } : {}),
          ...(child.reason !== undefined ? { reason: child.reason } : {}),
        }));
    } finally {
      stopWatching();
      this.liveCalls.delete(instanceId);
    }
  }
}
