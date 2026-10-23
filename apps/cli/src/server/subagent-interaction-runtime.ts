import {
  AgentSessionsApi,
  SubagentCapability,
  type SubagentDispatch,
  type SubagentDispatchClaimResponse,
  type SubagentSettledAttempt,
} from '../shared/api/generated/api';
import { Configuration } from '../shared/api/generated/configuration';
import type { KeyPairStore } from '../credentials/keypair';
import type { ChildAgentLauncher } from '../run/child-agent-launcher';
import type { LocalResearchPromptPayload } from '../shared/agent-bridge-contract/index';
import type { RunStore } from '../run-store/run-store';
import type { RunRegistry } from '../run/run-registry';
import type { ServerLogger } from './logger';
import type { AgenticSession } from '../session/types';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalizeJson } from '../shared/canonical-json';
import type { HostActionAdmission } from './controller-authorization/host-action-admission';
import type { ControllerRegistryReader } from './controller-authorization/types';

const admittedChildServiceScope = z.object({
  serviceIds: z.array(z.string()),
  launchServiceId: z.string().optional(),
});

/** Reads the child Service scope the API fixed at admission from `dispatch.childScope`. */
export const parseAdmittedChildServiceScope = (dispatch: Pick<SubagentDispatch, 'childScope'>) => {
  const result = admittedChildServiceScope.safeParse(dispatch.childScope);
  if (!result.success) {
    throw new Error(
      dispatch.childScope === undefined
        ? 'Dispatch has no admitted childScope; it was admitted before child Service scope was carried.'
        : `Dispatch childScope is invalid: ${result.error.message}`,
    );
  }
  return result.data;
};

/**
 * Canonical child payload the API bound to the attempt at admission, recomputed
 * from the claim so a dispatch cannot carry authority for different child work.
 */
export const subagentChildPayloadHash = (
  dispatch: Pick<
    SubagentDispatch,
    | 'interactionId'
    | 'attemptId'
    | 'sourceSessionId'
    | 'sourceRunId'
    | 'mode'
    | 'capability'
    | 'objective'
  >,
  serviceIds: string[],
): string =>
  createHash('sha256')
    .update(
      canonicalizeJson({
        version: 1,
        kind: 'subagent',
        interactionId: dispatch.interactionId,
        attemptId: dispatch.attemptId,
        sourceSessionId: dispatch.sourceSessionId,
        sourceRunId: dispatch.sourceRunId,
        mode: dispatch.mode,
        capability: dispatch.capability,
        objective: dispatch.objective,
        serviceIds,
      }),
    )
    .digest('hex');

interface DispatchScope {
  organizationId: string;
  projectId: string;
}

/** One poll's claim responses, made with `api`; heartbeats and settlement reuse that client. */
export interface SubagentDispatchClaims {
  api: AgentSessionsApi;
  /** The machine whose credential made every claim. */
  machineId: string;
  claims: Array<{ scope: DispatchScope; response: SubagentDispatchClaimResponse }>;
  /** A claim threw; `claims` holds the ones made before it, which already hold server leases. */
  failure?: { error: unknown };
}

/**
 * Claims once in every scope the API lists plus every scope still holding an
 * observed foreground wait, so a wait in a scope the API stopped listing is released.
 */
export async function pollSubagentDispatchClaims(
  deps: { keyPairStore: KeyPairStore; apiBaseUrl: string },
  foregroundWaitScopes: Iterable<DispatchScope>,
): Promise<SubagentDispatchClaims | null> {
  const machineId = await deps.keyPairStore.loadCurrentMachineId();
  if (!machineId) return null;
  const credential = await deps.keyPairStore.loadMachineCredential(machineId);
  if (!credential) return null;
  const api = new AgentSessionsApi(
    new Configuration({
      accessToken: credential,
      basePath: deps.apiBaseUrl,
    }),
  );
  const scopes = new Map<string, DispatchScope>();
  const scopeResponse = await api.listSubagentDispatchScopes();
  const discovered = (
    scopeResponse.data as unknown as {
      data: { scopes: DispatchScope[] };
    }
  ).data;
  for (const { organizationId, projectId } of [...discovered.scopes, ...foregroundWaitScopes]) {
    const scopeKey = `${organizationId}:${projectId}`;
    if (!scopes.has(scopeKey)) scopes.set(scopeKey, { organizationId, projectId });
  }
  const claims: SubagentDispatchClaims['claims'] = [];
  for (const scope of scopes.values()) {
    try {
      const response = await api.claimSubagentDispatch(scope);
      claims.push({
        scope,
        response: (response.data as unknown as { data: typeof response.data }).data,
      });
    } catch (error) {
      return { api, machineId, claims, failure: { error } };
    }
  }
  return { api, machineId, claims };
}

export interface SubagentInteractionRuntimeDependencies {
  runStore: RunStore;
  runRegistry: RunRegistry;
  childAgentLauncher: ChildAgentLauncher;
  logger: ServerLogger;
  /** Sole local owner that admits controller authority before a child launches. */
  hostActionAdmission: HostActionAdmission;
  /** Local controller registry; names the account that owns this machine. */
  controllerRegistry: ControllerRegistryReader;
}

class SubagentAuthorizationDenied extends Error {
  public constructor(public readonly reason: string) {
    super(`Child authorization denied: ${reason}`);
  }
}

/** Executes claimed platform effects, running only the capability declared by the effect. */
export class SubagentInteractionRuntime {
  private holdsRestored = false;
  public get readyForInputPickup(): boolean {
    return this.holdsRestored;
  }
  /** Pickup refused while holds were unrestored is offered again here, not by a timer. */
  private readyListener: () => void = () => undefined;
  public onReadyForInputPickup(listener: () => void): void {
    this.readyListener = listener;
  }
  private readonly active = new Map<string, AbortController>();
  private readonly observedForegroundWaits = new Map<string, Map<string, string>>();

  public constructor(private readonly deps: SubagentInteractionRuntimeDependencies) {}

  /** Scopes whose foreground waits this runtime mirrors onto Run holds. */
  public get foregroundWaitScopes(): DispatchScope[] {
    const scopes: DispatchScope[] = [];
    for (const scopeKey of this.observedForegroundWaits.keys()) {
      const [organizationId, projectId] = scopeKey.split(':');
      if (organizationId && projectId) scopes.push({ organizationId, projectId });
    }
    return scopes;
  }

  public dispose(): void {
    for (const controller of this.active.values()) controller.abort();
  }

  /**
   * Mirrors each scope's foreground waits onto Run holds and executes any claimed dispatch.
   * A failed or partial delivery still executes what was claimed, then rethrows and pauses
   * input pickup until a later delivery succeeds.
   */
  public async receive({ api, machineId, claims, failure }: SubagentDispatchClaims): Promise<void> {
    try {
      for (const { scope, response: claimed } of claims) {
        const scopeKey = `${scope.organizationId}:${scope.projectId}`;
        const currentWaits = new Map<string, string>();
        for (const wait of claimed.foregroundWaits) {
          const source = await this.deps.runStore.getRun(wait.sourceRunId);
          if (
            source?.contextMetadata.agentSessionId === wait.sourceSessionId &&
            source.contextMetadata.organizationId === scope.organizationId &&
            source.contextMetadata.projectId === scope.projectId
          ) {
            currentWaits.set(wait.interactionId, wait.sourceRunId);
          }
        }
        for (const [interactionId, runId] of this.observedForegroundWaits.get(scopeKey) ?? []) {
          if (!currentWaits.has(interactionId)) {
            this.deps.runRegistry.releaseSubagentHold(runId, interactionId);
          }
        }
        for (const [interactionId, runId] of currentWaits) {
          this.deps.runRegistry.holdForSubagent(runId, interactionId);
        }
        this.observedForegroundWaits.set(scopeKey, currentWaits);
        if (!claimed.claimed || !claimed.dispatch) continue;
        if (this.active.has(claimed.dispatch.effectId)) continue;
        void this.execute(api, machineId, scope, claimed.dispatch);
      }
      if (failure) throw failure.error;
    } catch (error) {
      this.holdsRestored = false;
      throw error;
    }
    const becameReady = !this.holdsRestored;
    this.holdsRestored = true;
    if (becameReady) this.readyListener();
  }

  /**
   * Independently admits the controller evidence retained on the attempt before any
   * child effect. Attempts without retained evidence are never executed.
   */
  private async admit(
    machineId: string,
    scope: DispatchScope,
    dispatch: SubagentDispatch,
    serviceIds: string[],
  ): Promise<void> {
    const authorization = dispatch.authorization;
    if (!authorization || !dispatch.actionPayloadHash) {
      throw new SubagentAuthorizationDenied('EVIDENCE_MISSING');
    }
    if (subagentChildPayloadHash(dispatch, serviceIds) !== dispatch.actionPayloadHash) {
      throw new SubagentAuthorizationDenied('PAYLOAD_HASH_MISMATCH');
    }
    const registry = await this.deps.controllerRegistry.read();
    const controller = registry?.controllers.find(
      (entry) => entry.machineId === machineId && entry.organizationId === scope.organizationId,
    );
    if (!controller) throw new SubagentAuthorizationDenied('CONTROLLER_NOT_ACTIVE');
    const assertion = authorization.kind === 'controller_assertion' ? authorization : null;
    const result = await this.deps.hostActionAdmission.admit({
      ...(assertion ? { controllerInstallationId: assertion.intent.controllerInstallationId } : {}),
      machineId,
      userId: controller.accountId,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      actionCategory: 'CONVERSATION',
      actionType: 'CONVERSATION_TRIGGER',
      actionPayloadHash: assertion?.intent.actionPayloadHash ?? '',
      target: {
        kind: 'AGENT_SESSION',
        id: dispatch.sourceSessionId,
        revision: assertion?.intent.target.revision ?? null,
      },
      agentSessionId: dispatch.sourceSessionId,
      taskMonitorId: null,
      // One admission per attempt generation; a repeated claim is a replay.
      envelopeNonce: `subagent:${dispatch.attemptId}:${String(dispatch.generation)}`,
      authorization,
    });
    if (!result.admitted) throw new SubagentAuthorizationDenied(result.reason);
  }

  private async execute(
    api: AgentSessionsApi,
    machineId: string,
    scope: DispatchScope,
    dispatch: SubagentDispatch,
  ): Promise<void> {
    const controller = new AbortController();
    this.active.set(dispatch.effectId, controller);
    let heartbeatPending = false;
    const heartbeat = setInterval(() => {
      if (heartbeatPending) return;
      heartbeatPending = true;
      void api
        .heartbeatSubagentDispatch({
          ...scope,
          effectId: dispatch.effectId,
          subagentDispatchHeartbeatRequest: { leaseToken: dispatch.leaseToken },
        })
        .then((response) => {
          if (!(response.data as unknown as { data: { accepted: boolean } }).data.accepted)
            controller.abort();
        })
        .catch((error: unknown) => {
          this.deps.logger.warn('subagent.interaction.heartbeat_failed', {
            effectId: dispatch.effectId,
            error: error instanceof Error ? error.message : String(error),
          });
          controller.abort();
        })
        .finally(() => {
          heartbeatPending = false;
        });
    }, 5_000);
    heartbeat.unref();

    let outcome: SubagentSettledAttempt['outcome'] = 'FAILED';
    let outputText: string | undefined;
    let failureCode: string | undefined;
    this.deps.logger.debug('subagent.interaction.dispatch_claimed', {
      effectId: dispatch.effectId,
      interactionId: dispatch.interactionId,
      attemptId: dispatch.attemptId,
      sourceSessionId: dispatch.sourceSessionId,
      sourceRunId: dispatch.sourceRunId,
      mode: dispatch.mode,
      capability: dispatch.capability,
      generation: dispatch.generation,
      hasChildScope: dispatch.childScope !== undefined,
      childScope: dispatch.childScope ?? null,
      sourceServiceIds: dispatch.sourceExecutionContext.serviceIds,
      sourceLaunchServiceId: dispatch.sourceExecutionContext.launchServiceId ?? null,
      authorizationKind: dispatch.authorization?.kind ?? null,
    });
    let stage = 'validate_capability';
    try {
      // The wire value is checked even though the generated type admits only RESEARCH.
      if ((dispatch.capability as string) !== SubagentCapability.Research) {
        throw new Error(`Unsupported admitted child capability: ${dispatch.capability}`);
      }
      stage = 'resolve_source_run';
      const retainedSource = await this.deps.runStore.getRun(dispatch.sourceRunId);
      if (
        retainedSource &&
        (retainedSource.contextMetadata.agentSessionId !== dispatch.sourceSessionId ||
          retainedSource.contextMetadata.organizationId !== scope.organizationId ||
          retainedSource.contextMetadata.projectId !== scope.projectId)
      ) {
        throw new Error('The retained source Run belongs to another Agent Session.');
      }
      this.deps.logger.debug('subagent.interaction.source_run_resolved', {
        effectId: dispatch.effectId,
        retained: retainedSource !== null,
      });
      const context = dispatch.sourceExecutionContext;
      stage = 'parse_child_scope';
      const childScope = parseAdmittedChildServiceScope(dispatch);
      this.deps.logger.debug('subagent.interaction.child_scope_admitted', {
        effectId: dispatch.effectId,
        serviceIds: childScope.serviceIds,
        launchServiceId: childScope.launchServiceId ?? null,
      });
      stage = 'admit_authorization';
      if (
        childScope.launchServiceId !== undefined &&
        !childScope.serviceIds.includes(childScope.launchServiceId)
      ) {
        throw new SubagentAuthorizationDenied('GRANT_SCOPE_MISMATCH');
      }
      await this.admit(machineId, scope, dispatch, childScope.serviceIds);
      this.deps.logger.info('subagent.interaction.authorization_admitted', {
        effectId: dispatch.effectId,
        authorizationKind: dispatch.authorization?.kind ?? null,
      });
      const session: AgenticSession = retainedSource ?? {
        agentic_session_id: dispatch.sourceSessionId,
        entity: null,
        services: context.serviceIds.map((id) => ({ id, path: '' })),
        ...(context.launchServiceId ? { launchServiceId: context.launchServiceId } : {}),
        provider: context.provider,
        provider_session_id: '',
        provider_conversation_id: null,
        status: 'idle',
        conversationId: context.conversationId,
        createdAt: context.createdAt,
        updatedAt: context.createdAt,
        contextMetadata: {
          capturedAt: context.createdAt,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          agentSessionId: dispatch.sourceSessionId,
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
        events: [],
      };
      if (dispatch.mode === 'FOREGROUND') {
        this.deps.runRegistry.holdForSubagent(dispatch.sourceRunId, dispatch.interactionId);
      }
      stage = 'launch_child';
      this.deps.logger.debug('subagent.interaction.child_launch_started', {
        effectId: dispatch.effectId,
        retainedSource: retainedSource !== null,
        serviceIds: childScope.serviceIds,
        launchServiceId: childScope.launchServiceId ?? null,
      });
      const result = await this.deps.childAgentLauncher.launchRegistered('research', {
        parentSession: session,
        serviceIds: childScope.serviceIds,
        ...(childScope.launchServiceId ? { launchServiceId: childScope.launchServiceId } : {}),
        payload: { userMessage: dispatch.objective } satisfies LocalResearchPromptPayload,
        signal: controller.signal,
        ...(session.model ? { model: session.model } : {}),
        ...(session.reasoningEffort ? { reasoningEffort: session.reasoningEffort } : {}),
      });
      outcome = result.assistantCompleted ? 'SUCCEEDED' : 'FAILED';
      outputText = result.outputText;
      if (!result.assistantCompleted) failureCode = 'CHILD_INCOMPLETE';
      this.deps.logger.debug('subagent.interaction.child_launch_completed', {
        effectId: dispatch.effectId,
        assistantCompleted: result.assistantCompleted,
        outputLength: result.outputText?.length ?? 0,
      });
    } catch (error) {
      outcome = controller.signal.aborted ? 'CANCELLED' : 'FAILED';
      failureCode = controller.signal.aborted
        ? 'LEASE_LOST'
        : error instanceof SubagentAuthorizationDenied
          ? `AUTHORIZATION_${error.reason}`
          : 'CHILD_EXECUTION_FAILED';
      this.deps.logger.error('subagent.interaction.execution_failed', {
        effectId: dispatch.effectId,
        stage,
        aborted: controller.signal.aborted,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearInterval(heartbeat);
      this.active.delete(dispatch.effectId);
    }

    try {
      const response = await api.settleSubagentDispatch({
        ...scope,
        effectId: dispatch.effectId,
        subagentSettledAttempt: {
          leaseToken: dispatch.leaseToken,
          generation: dispatch.generation,
          targetTurnId: dispatch.targetTurnId,
          outcome,
          settledAt: new Date().toISOString(),
          ...(outputText !== undefined ? { outputText } : {}),
          ...(failureCode !== undefined ? { failureCode } : {}),
        } satisfies SubagentSettledAttempt,
      });
      this.deps.logger.info('subagent.interaction.settlement_recorded', {
        effectId: dispatch.effectId,
        accepted: (response.data as unknown as { data: { accepted: boolean } }).data.accepted,
        outcome,
      });
    } catch (error) {
      this.deps.logger.error('subagent.interaction.settlement_failed', {
        effectId: dispatch.effectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
