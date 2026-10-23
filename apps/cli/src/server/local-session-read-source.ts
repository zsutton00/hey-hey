/**
 * LocalSessionReadSource — read-only, ordered view of the Runs this process
 * has started a Turn for.
 *
 * A Run is listed once it has an `activeSince` and stays listed, idle or
 * waiting, until the registry drops it. A Run loaded from disk only to answer
 * a read is registered but not listed; it joins when it later starts a Turn.
 * The persisted session index never decides membership. Each Run object receives a process-unique instance id so a replacement
 * Run under the same runId is distinguishable from the one it replaced.
 *
 * The source subscribes to lifecycle events at construction, before anyone can
 * read a snapshot, and `observe()` returns the current snapshot together with
 * the subscription in one synchronous step, so no update between the two is
 * lost. Every change bumps a monotonic revision carried by snapshots and
 * updates. Observers are isolated: one throwing never stops delivery to the
 * others or reaches the Run that raised the change.
 */

import type { RunEntityReference } from '../shared/agent-bridge-contract/generated/api';
import type { AgentSessionCurrentState } from '../shared/api/generated/api';
import type { LoadedEntityPromptContext } from '../agents/entity-context/types';
import type { Run, RunEntityContextLoadStatus } from '../run/run';
import type { RunRegistry } from '../run/run-registry';
import type { RunLifecycleEvents } from './run-lifecycle-events';
import type { ServerLogger } from './logger';

interface LocalSessionEffectiveState {
  readonly state: AgentSessionCurrentState;
  readonly observedAt: string;
}

export interface LocalSessionSnapshot {
  readonly runId: string;
  /** Distinguishes a replacement Run from the Run it replaced under the same runId. */
  readonly runInstanceId: number;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly provider: string;
  /** Null until the provider confirms its own session id. */
  readonly providerSessionId: string | null;
  readonly providerConversationId: string | null;
  readonly entity: RunEntityReference | null;
  /** Null until the Run publishes its first effective state. */
  readonly effectiveState: LocalSessionEffectiveState | null;
  /** Work idle reaping would interrupt; independent of list membership. */
  readonly hasActiveWork: boolean;
  readonly createdAt: string;
  /** When this process first started a Turn for the Run. */
  readonly activeSince: string;
  /** Typed focal entity and Context the Run loaded, or null before loading. */
  readonly loadedEntityContext: LoadedEntityPromptContext | null;
  /** The Run's own focal Context load status; null without a focal entity. */
  readonly entityContextLoadStatus: RunEntityContextLoadStatus | null;
}

export interface LocalSessionsSnapshot {
  readonly revision: number;
  readonly sessions: readonly LocalSessionSnapshot[];
}

export type LocalSessionUpdate =
  | {
      readonly revision: number;
      readonly kind: 'registered';
      readonly session: LocalSessionSnapshot;
    }
  | { readonly revision: number; readonly kind: 'updated'; readonly session: LocalSessionSnapshot }
  | {
      readonly revision: number;
      readonly kind: 'removed';
      readonly runId: string;
      readonly runInstanceId: number;
    };

export type LocalSessionObserver = (update: LocalSessionUpdate) => void;

export interface LocalSessionObservation {
  readonly snapshot: LocalSessionsSnapshot;
  readonly unsubscribe: () => void;
}

export interface LocalSessionReadSourceDependencies {
  runRegistry: Pick<RunRegistry, 'get' | 'list'>;
  runLifecycleEvents: Pick<RunLifecycleEvents, 'onRunRegistered' | 'onRunRemoved' | 'onRunUpdated'>;
  logger: ServerLogger;
}

const PENDING_PROVIDER_SESSION_PREFIX = 'pending_';

export class LocalSessionReadSource {
  private readonly instanceIds = new WeakMap<Run, number>();
  private nextInstanceId = 1;
  /** Last delivered membership, so removal reports the instance that left. */
  private readonly listed = new Map<string, LocalSessionSnapshot>();
  private readonly observers = new Set<LocalSessionObserver>();
  private readonly lifecycleSubscriptions: Array<() => void>;
  private revision = 0;
  private disposed = false;

  public constructor(private readonly dependencies: LocalSessionReadSourceDependencies) {
    const events = dependencies.runLifecycleEvents;
    this.lifecycleSubscriptions = [
      events.onRunRegistered((runId) => this.reconcile(runId)),
      events.onRunUpdated((runId) => this.reconcile(runId)),
      events.onRunRemoved((runId) => this.reconcile(runId)),
    ];
    for (const run of dependencies.runRegistry.list()) this.reconcile(run.runId);
  }

  public snapshot(): LocalSessionsSnapshot {
    return Object.freeze({
      revision: this.revision,
      sessions: Object.freeze([...this.listed.values()]),
    });
  }

  /** Atomically reads the current snapshot and subscribes to every later update. */
  public observe(observer: LocalSessionObserver): LocalSessionObservation {
    if (!this.disposed) this.observers.add(observer);
    return {
      snapshot: this.snapshot(),
      unsubscribe: () => {
        this.observers.delete(observer);
      },
    };
  }

  /** True when any registered Run holds active work. */
  public hasActiveWork(): boolean {
    return this.dependencies.runRegistry.list().some((run) => run.hasActiveWork);
  }

  /** Registered Runs holding active work: the Runs a shutdown would stop mid-work. */
  public activeWorkCount(): number {
    return this.dependencies.runRegistry.list().filter((run) => run.hasActiveWork).length;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.lifecycleSubscriptions) unsubscribe();
    this.observers.clear();
    this.listed.clear();
  }

  /**
   * Re-derives one runId from the registry. Every lifecycle signal funnels
   * here, so a late or out-of-order signal can never list a Run the registry
   * no longer holds or keep a replaced instance.
   */
  private reconcile(runId: string): void {
    if (this.disposed) return;
    try {
      this.reconcileRun(runId);
    } catch (error) {
      this.dependencies.logger.warn('local_session_read.reconcile_failed', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private reconcileRun(runId: string): void {
    const previous = this.listed.get(runId) ?? null;
    const run = this.dependencies.runRegistry.get(runId);
    const activeSince = run?.activeSince ?? null;
    if (!run || activeSince === null) {
      if (!previous) return;
      this.listed.delete(runId);
      this.deliver({
        revision: ++this.revision,
        kind: 'removed',
        runId,
        runInstanceId: previous.runInstanceId,
      });
      return;
    }

    const next = this.project(run, activeSince);
    if (previous && previous.runInstanceId !== next.runInstanceId) {
      this.listed.delete(runId);
      this.deliver({
        revision: ++this.revision,
        kind: 'removed',
        runId,
        runInstanceId: previous.runInstanceId,
      });
    }
    const replaced = previous !== null && previous.runInstanceId === next.runInstanceId;
    if (replaced && sameSnapshot(previous, next)) return;
    this.listed.set(runId, next);
    this.deliver({
      revision: ++this.revision,
      kind: replaced ? 'updated' : 'registered',
      session: next,
    });
  }

  private deliver(update: LocalSessionUpdate): void {
    for (const observer of [...this.observers]) {
      try {
        observer(update);
      } catch (error) {
        this.dependencies.logger.warn('local_session_read.observer_failed', {
          revision: update.revision,
          kind: update.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** The process-unique instance id this source assigns to a Run object. */
  public runInstanceIdOf(run: Run): number {
    let id = this.instanceIds.get(run);
    if (id === undefined) {
      id = this.nextInstanceId++;
      this.instanceIds.set(run, id);
    }
    return id;
  }

  private project(run: Run, activeSince: string): LocalSessionSnapshot {
    const providerSessionId = run.providerSessionId;
    const effectiveState = run.effectiveState;
    return Object.freeze({
      runId: run.runId,
      runInstanceId: this.runInstanceIdOf(run),
      agentSessionId: run.agentSessionId,
      conversationId: run.conversationId,
      organizationId: run.organizationId,
      projectId: run.projectId,
      provider: run.provider,
      providerSessionId:
        providerSessionId === null || providerSessionId.startsWith(PENDING_PROVIDER_SESSION_PREFIX)
          ? null
          : providerSessionId,
      providerConversationId: run.session.provider_conversation_id ?? null,
      entity: run.entity,
      effectiveState: effectiveState
        ? Object.freeze({
            state: effectiveState.currentState,
            observedAt: effectiveState.observedAt,
          })
        : null,
      hasActiveWork: run.hasActiveWork,
      createdAt: run.createdAt,
      activeSince,
      loadedEntityContext: run.loadedEntityContext,
      entityContextLoadStatus: run.entityContextLoadStatus,
    });
  }
}

const sameSnapshot = (left: LocalSessionSnapshot, right: LocalSessionSnapshot): boolean =>
  left.providerSessionId === right.providerSessionId &&
  left.providerConversationId === right.providerConversationId &&
  left.entity === right.entity &&
  left.effectiveState?.state === right.effectiveState?.state &&
  left.effectiveState?.observedAt === right.effectiveState?.observedAt &&
  left.hasActiveWork === right.hasActiveWork &&
  left.loadedEntityContext === right.loadedEntityContext &&
  left.entityContextLoadStatus === right.entityContextLoadStatus;
