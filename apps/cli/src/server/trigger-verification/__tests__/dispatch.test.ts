import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiRuntime } from '../../../../../../packages/ui-common/src/clients/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  toCreateRunRequest,
  toRunPromptRequest,
  TriggerFrameRouter,
  type ConversationRunBinding,
} from '../dispatch';
import type { LocalAgentService } from '../../local-agent-service';
import { createTestLocalAgentService } from '../../local-agent-service.test-support';
import type {
  AgentOperationDispatchAcknowledgement,
  MonitorCommandAcknowledgement,
  MonitorCommandBody1 as MonitorCommandBody,
} from '../../../shared/agent-bridge-contract/generated/api';
import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated/api';
import type { PermissionDecisionOwner, RunRegistry } from '../../../run/run-registry';
import { createTestMessagePoster, createTestRunStore } from '../../../run/run.test-support';
import type { KeyPairStore } from '../../../credentials';
import { createTestKeyPairStore } from '../../../credentials/keypair.test-support';
import type { StartRunTriggerPayload } from '../../conversation-dispatch/trigger-payload-schemas';
import type { ReconcileOutcome } from '../reconcile-machine-identity';
import type { MessagePoster } from '../../../run/message-poster';
import { TriggerVerifier, type VerifiedTriggerFrame, type VerifyResult } from '../verify';
import { NOOP_LOGGER, type ServerLogger } from '../../logger';
import type { PlatformWebSocketEvent } from '../../platform-ws';
import { MonitorProjectContext } from '../../monitors/project-context';
import {
  createTestPlatformAuthContext,
  createTestPlatformWebSocketManager,
} from '../../monitors/test-owners.test-support';
import { createTestTaskMonitorStateMachineInputAdapter } from '../../state-machine-input-adapter.test-support';
import type { TaskMonitorStateMachineInputAdapter } from '../../state-machine-input-adapter';
import { createTestRunRegistryWiring } from '../../__tests__/helpers/test-run-registry';
import { TriggerDropRecoverySurface } from '../trigger-drop-recovery-surface';
import { InputAdmissionLifecycle } from '../../input-admission/admission-lifecycle';
import type {
  InputIdentity,
  ReadableInputRecord,
  StoredInput,
} from '../../input-admission/input-admission-codec';
import { InputAdmissionIdentityError } from '../../input-admission/input-admission-identity-error';
import { InputAdmissionOwner } from '../../input-admission/input-admission-owner';
import { RunReadRestoreCoordinator } from '../../restore-persisted-runs';
import type { HostActionAdmission } from '../../controller-authorization/host-action-admission';
import {
  AdmittedHostAction,
  type ExecutableEnvelopeAuthorization,
} from '../../controller-authorization/types';
import type { MachineControllerAuthority } from '../../../auth/machine-controller-authority';
import { PromptTypeRegistry } from '../../../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../../agents/prompt-type-registry.test-support';

const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

const noopSubmitPermissionDecision = () =>
  vi.fn().mockResolvedValue({ outcome: 'delivered', callbackType: 'claude_control_response' });

class TestAdmittedHostAction extends AdmittedHostAction {
  public constructor(actionType: AdmittedHostAction['actionType'] = 'CONVERSATION_TRIGGER') {
    super(actionType, 'test-authorization', 'test-nonce');
  }
}

const TEST_ADMITTED_HOST_ACTION = new TestAdmittedHostAction();
const TEST_EXECUTABLE_AUTHORIZATION = {
  kind: 'bounded_grant',
  grantId: '90000000-0000-4000-8000-000000000009',
} satisfies ExecutableEnvelopeAuthorization;
const TEST_ADMITTED_SERVICE_SCOPE = {
  serviceIds: ['10000000-0000-4000-8000-000000000001'],
  launchServiceId: '10000000-0000-4000-8000-000000000001',
};

interface TestDropSurfacingDependencies {
  poster: MessagePoster;
  machinesApi: ApiRuntime['clients']['machines'];
  keyPairStore: KeyPairStore;
  initialMachineId: string;
  signatureInvalidThreshold?: number;
}

interface TestRouterDependencies {
  verifier: TriggerVerifier;
  resolveConversationRun(conversationId: string): ConversationRunBinding | null;
  sendMessage: LocalAgentService['sendSystemMessage'];
  createRun: LocalAgentService['createRun'];
  stopRun: LocalAgentService['stopRun'];
  compactRun: (runId: string) => Promise<void>;
  submitPermissionDecision: RunRegistry['submitPermissionDecision'];
  submitQuestionAnswer?: RunRegistry['submitQuestionAnswer'];
  permissionDecisionOwner?: PermissionDecisionOwner;
  runRestoreCoordinator?: RunReadRestoreCoordinator;
  permissionDecisionAuditFilePath?: string;
  dispatchMonitorCommand?: (body: MonitorCommandBody) => Promise<MonitorCommandAcknowledgement>;
  admitTaskMonitorPermissionDecision?: TaskMonitorStateMachineInputAdapter['admitPermissionDecision'];
  resolveTaskMonitorConversationBinding?: TaskMonitorStateMachineInputAdapter['resolveConversationBinding'];
  admitVerifiedTaskMonitorInput?: TaskMonitorStateMachineInputAdapter['admitVerified'];
  readUserMessage?: LocalAgentService['readUserMessage'];
  restoreRun?: RunReadRestoreCoordinator['restore'];
  taskMonitorId?: string;
  hostActionAdmission?: HostActionAdmission;
  machineControllerAuthority?: Pick<MachineControllerAuthority, 'applyVerifiedAuthorityReduction'>;
  dropSurfacing?: TestDropSurfacingDependencies;
  /** The real admission lifecycle, for cases whose disposition depends on its decision. */
  inputAdmission?: InputAdmissionLifecycle;
  logger: ServerLogger;
}

const createTestRouter = (dependencies: TestRouterDependencies): TriggerFrameRouter => {
  const { dropSurfacing } = dependencies;
  const runStore = createTestRunStore();
  vi.spyOn(runStore, 'lookupByConversationId').mockImplementation(
    (conversationId) => dependencies.resolveConversationRun(conversationId)?.runId ?? null,
  );
  vi.spyOn(runStore, 'lookupByAgentSessionId').mockImplementation(
    () =>
      dependencies.resolveConversationRun('c0000000-0000-4000-8000-000000000001')?.runId ?? null,
  );
  vi.spyOn(runStore, 'getRunMetadata').mockImplementation(async (runId) => {
    const binding = dependencies.resolveConversationRun('c0000000-0000-4000-8000-000000000001');
    if (!binding || binding.runId !== runId) return null;
    return {
      agentic_session_id: runId,
      contextMetadata: {
        agentSessionId: runId,
        ...(dependencies.taskMonitorId ? { taskMonitorId: dependencies.taskMonitorId } : {}),
      },
    } as never;
  });
  vi.spyOn(runStore, 'getRun').mockImplementation((runId) => runStore.getRunMetadata(runId));
  const runRegistry = createTestRunRegistryWiring({ runStore }).runRegistry;
  const runRestoreCoordinator =
    dependencies.runRestoreCoordinator ??
    new RunReadRestoreCoordinator({
      runStore,
      runRegistry,
      logger: dependencies.logger,
    });
  if (dependencies.taskMonitorId) {
    vi.spyOn(runRegistry, 'get').mockReturnValue({
      taskMonitorId: dependencies.taskMonitorId,
    } as never);
  }
  const agentService = createTestLocalAgentService({ runStore });
  // This router suite substitutes an immediately-ready scheduler at the admission boundary.
  // The real disk-backed owner and restart/race behavior are covered by input-admission tests.
  const admitted = new Map<
    string,
    InputIdentity & StoredInput & { admissionDisposition: 'immediate' }
  >();
  const pending: string[] = [];
  // Delivers from the stored frame exactly as the real lifecycle does: no wire validation.
  const advance = async () => {
    for (const key of pending.splice(0)) {
      const record = admitted.get(key)!;
      if (record.kind !== 'trigger_frame') continue;
      const { event, conversationId } = record.payload;
      if (event.promptType === 'start_run') {
        await dependencies.createRun(toCreateRunRequest(event.payload, conversationId!));
      } else {
        await dependencies.sendMessage(
          record.runId,
          toRunPromptRequest(event),
          event.promptType === 'user_message'
            ? {
                sourceUserMessageId: event.sourceUserMessageId,
                ...(event.admittedServiceScope
                  ? { admittedServiceScope: event.admittedServiceScope }
                  : {}),
              }
            : undefined,
        );
      }
    }
  };
  Object.defineProperty(agentService, 'inputAdmission', {
    value: dependencies.inputAdmission ?? {
      owner: {
        session: async (agentSessionId: string) =>
          [...admitted.values()].filter((record) => record.agentSessionId === agentSessionId),
        failedStartSettlement: async () => null,
      },
      admitInput: async (identity: InputIdentity, stored: StoredInput) => {
        const replayed = admitted.has(identity.key);
        if (!replayed) {
          admitted.set(identity.key, { ...identity, ...stored, admissionDisposition: 'immediate' });
          pending.push(identity.key);
        }
        void advance();
        return { record: admitted.get(identity.key)!, replayed };
      },
      advance,
    },
  });

  vi.spyOn(agentService, 'sendMessage').mockImplementation((_capability, runId, input, options) =>
    options === undefined
      ? dependencies.sendMessage(runId, input)
      : dependencies.sendMessage(runId, input, options),
  );
  vi.spyOn(agentService, 'createRunFromTrigger').mockImplementation((_capability, input) =>
    dependencies.createRun(input),
  );
  vi.spyOn(agentService, 'stopRun').mockImplementation(dependencies.stopRun);
  vi.spyOn(agentService, 'compactRun').mockImplementation((_capability, runId) =>
    dependencies.compactRun(runId),
  );
  if (dependencies.readUserMessage) {
    vi.spyOn(agentService, 'readUserMessage').mockImplementation(dependencies.readUserMessage);
  }
  vi.spyOn(runRegistry, 'submitPermissionDecision').mockImplementation(
    dependencies.submitPermissionDecision,
  );
  if (dependencies.submitQuestionAnswer) {
    vi.spyOn(runRegistry, 'submitQuestionAnswer').mockImplementation(
      dependencies.submitQuestionAnswer,
    );
  }
  vi.spyOn(runRegistry, 'classifyPermissionDecisionOwner').mockImplementation(
    async (_runId, _requestId, _idempotencyToken, taskMonitorId) =>
      dependencies.permissionDecisionOwner ??
      (taskMonitorId
        ? { kind: 'task_monitor_intervention', taskMonitorId }
        : { kind: 'provider_permission' }),
  );
  const taskMonitorStateMachineInputAdapter = createTestTaskMonitorStateMachineInputAdapter(
    dependencies.logger,
  );
  vi.spyOn(runRestoreCoordinator, 'restore').mockImplementation(
    dependencies.restoreRun ??
      (async () =>
        ({
          taskMonitorId: dependencies.taskMonitorId ?? null,
        }) as never),
  );
  vi.spyOn(taskMonitorStateMachineInputAdapter, 'admit').mockImplementation(
    dependencies.dispatchMonitorCommand ??
      (async () => ({
        status: 'REJECTED',
        stage: 'ADMISSION',
        reason: 'ROUTE_REJECTED',
        message: 'Task Monitor command admission is not configured.',
      })),
  );
  if (dependencies.admitTaskMonitorPermissionDecision) {
    vi.spyOn(taskMonitorStateMachineInputAdapter, 'admitPermissionDecision').mockImplementation(
      dependencies.admitTaskMonitorPermissionDecision,
    );
  }
  if (dependencies.resolveTaskMonitorConversationBinding) {
    vi.spyOn(taskMonitorStateMachineInputAdapter, 'resolveConversationBinding').mockImplementation(
      dependencies.resolveTaskMonitorConversationBinding,
    );
  }
  if (dependencies.admitVerifiedTaskMonitorInput) {
    vi.spyOn(taskMonitorStateMachineInputAdapter, 'admitVerified').mockImplementation(
      dependencies.admitVerifiedTaskMonitorInput,
    );
  }
  const projectContext = new MonitorProjectContext({
    runStore,
    platformWebSocketManager: createTestPlatformWebSocketManager(),
    logger: dependencies.logger,
  });
  if (dropSurfacing) projectContext.learn('proj-1');
  return new TriggerFrameRouter({
    verifier: dependencies.verifier,
    machinesApi:
      dropSurfacing?.machinesApi ??
      ({
        listMachines: vi.fn().mockResolvedValue({ data: { data: { machines: [] } } }),
      } as unknown as ApiRuntime['clients']['machines']),
    keyPairStore: dropSurfacing?.keyPairStore ?? createTestKeyPairStore(),
    runStore,
    agentService,
    promptTypeRegistry,
    runRegistry,
    runRestoreCoordinator,
    permissionDecisionAuditFilePath:
      dependencies.permissionDecisionAuditFilePath ??
      path.join(tmpdir(), `hey-hey-permission-audit-${randomUUID()}.jsonl`),
    taskMonitorStateMachineInputAdapter,
    hostActionAdmission:
      dependencies.hostActionAdmission ??
      ({
        admit: vi.fn().mockResolvedValue({
          admitted: true,
          authorizationId: 'test-authorization',
          capability: TEST_ADMITTED_HOST_ACTION,
        }),
        admitReduction: vi.fn().mockResolvedValue({
          admitted: true,
          authorizationId: 'test-authorization',
          capability: TEST_ADMITTED_HOST_ACTION,
        }),
      } as unknown as HostActionAdmission),
    ...(dependencies.machineControllerAuthority
      ? { machineControllerAuthority: dependencies.machineControllerAuthority }
      : {}),
    dropSurfacing: dropSurfacing
      ? {
          poster: dropSurfacing.poster,
          projectContext,
          initialMachineId: dropSurfacing.initialMachineId,
          ...(dropSurfacing.signatureInvalidThreshold === undefined
            ? {}
            : { signatureInvalidThreshold: dropSurfacing.signatureInvalidThreshold }),
        }
      : {
          poster: createTestMessagePoster({
            createOutOfBand: vi.fn().mockResolvedValue('noop'),
          }),
          projectContext,
          initialMachineId: 'test-machine',
        },
    logger: dependencies.logger,
  });
};

interface TriggerFrameRouterTestOwners {
  dropRecoverySurface: TriggerDropRecoverySurface;
}

const dropRecoverySurfaceOf = (router: TriggerFrameRouter): TriggerDropRecoverySurface =>
  (router as unknown as TriggerFrameRouterTestOwners).dropRecoverySurface;

const noopLogger = (): ServerLogger & {
  debugCalls: Array<[string, Record<string, unknown>]>;
  warnCalls: Array<[string, Record<string, unknown>]>;
  infoCalls: Array<[string, Record<string, unknown>]>;
} => {
  const debugCalls: Array<[string, Record<string, unknown>]> = [];
  const warnCalls: Array<[string, Record<string, unknown>]> = [];
  const infoCalls: Array<[string, Record<string, unknown>]> = [];
  const logger: ServerLogger = {
    trace: () => {},
    debug: (event, fields) => {
      debugCalls.push([event, fields ?? {}]);
    },
    info: (event, fields) => {
      infoCalls.push([event, fields ?? {}]);
    },
    warn: (event, fields) => {
      warnCalls.push([event, fields ?? {}]);
    },
    error: () => {},
    child: () => logger,
  };
  return Object.assign(logger, { debugCalls, warnCalls, infoCalls });
};

const buildVerifiedConversation = (
  overrides: { triggerMessageId?: string; nonce?: string } = {},
): VerifiedTriggerFrame => {
  const triggerMessageId = overrides.triggerMessageId ?? 'trigger-msg-1';
  const nonce = overrides.nonce ?? 'n-1';
  return {
    kind: 'trigger.conversation',
    frame: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    },
    envelope: {
      machineId: 'm-1',
      userId: 'u-1',
      nonce,
      timestampMs: 0,
      signature: 'sig',
      event: {
        promptType: 'implement',
        nodeId: 'node-1',
        triggerMessageId,
      } as unknown as never,
    },
    body: { promptType: 'implement', nodeId: 'node-1', triggerMessageId } as never,
  };
};

const buildVerifiedMonitorCommand = (
  authorization?: ExecutableEnvelopeAuthorization,
): VerifiedTriggerFrame => {
  const body = {
    version: 1,
    kind: 'task_monitor_command',
    commandId: '10000000-0000-4000-8000-000000000001',
    createdAt: '2026-07-19T00:00:00.000Z',
    expiresAt: '2026-07-19T00:15:00.000Z',
    organizationId: '20000000-0000-4000-8000-000000000002',
    projectId: '30000000-0000-4000-8000-000000000003',
    target: {
      workItemType: 'TASK_MONITOR',
      workItemId: '40000000-0000-4000-8000-000000000004',
    },
    command: {
      cause: 'START',
      launchConfig: {
        taskId: '70000000-0000-4000-8000-000000000007',
        method: 'quick',
        provider: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      },
    },
  };
  return {
    kind: 'trigger.monitor_command',
    frame: {
      organizationId: body.organizationId,
      projectId: body.projectId,
      userId: 'user-1',
    },
    envelope: {
      ...(authorization
        ? {
            protocolVersion: 2 as const,
            authorization,
          }
        : {}),
      machineId: 'machine-1',
      userId: 'user-1',
      nonce: '50000000-0000-4000-8000-000000000005',
      timestampMs: 0,
      signature: 'sig',
      event: body,
    } as never,
    body: body as never,
  };
};

const secureVerifyResult = (result: VerifyResult): VerifyResult =>
  result.ok &&
  result.verified.kind !== 'trigger.authority_reduction' &&
  result.verified.envelope.protocolVersion !== 2
    ? ({
        ok: true,
        verified: {
          ...result.verified,
          envelope: {
            ...result.verified.envelope,
            protocolVersion: 2,
            ...(result.verified.kind === 'trigger.control' &&
            result.verified.body.kind === 'stop_run'
              ? {}
              : { authorization: TEST_EXECUTABLE_AUTHORIZATION }),
          },
        },
      } as VerifyResult)
    : result;

const buildVerifier = (result: VerifyResult): TriggerVerifier => {
  const verifier = new TriggerVerifier({
    serverSigningPublicKey: Buffer.alloc(32, 1),
    expectedMachineId: 'machine-1',
    expectedUserId: 'user-1',
    logger: noopLogger(),
  });
  const securedResult = secureVerifyResult(result);
  vi.spyOn(verifier, 'verifyTriggerFrame').mockReturnValue(securedResult);
  vi.spyOn(verifier, 'reload').mockImplementation(() => undefined);
  return verifier;
};

const conversationFrameEvent: PlatformWebSocketEvent = {
  type: 'trigger.conversation',
  timestamp: '2026-01-01T00:00:00Z',
  organizationId: 'org-1',
  conversationId: 'c0000000-0000-4000-8000-000000000001',
  envelope: {},
};

const monitorCommandFrameEvent: PlatformWebSocketEvent = {
  type: 'trigger.monitor_command',
  timestamp: '2026-07-19T00:00:00.000Z',
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  envelope: {},
};

const authorityReductionFrameEvent: PlatformWebSocketEvent = {
  type: 'trigger.authority_reduction',
  timestamp: '2026-07-19T00:00:00.000Z',
  organizationId: '20000000-0000-4000-8000-000000000002',
  userId: 'user-1',
  envelope: {},
};

const buildVerifiedControllerReduction = (): VerifiedTriggerFrame => {
  const body = {
    version: 2 as const,
    kind: 'controller_revocation_reduction' as const,
    action: 'CONTROLLER_REVOKE' as const,
    machineId: '10000000-0000-4000-8000-000000000001',
    controllerCredentialId: 'controller-1',
    revokedAt: '2026-07-19T00:00:00.000Z',
    enrollmentState: 'CONTROLLER_ENROLLMENT_REQUIRED' as const,
    executionReadiness: 'CONTROLLER_REVOKED' as const,
  };
  return {
    kind: 'trigger.authority_reduction',
    frame: {
      organizationId: '20000000-0000-4000-8000-000000000002',
      userId: 'user-1',
    },
    envelope: {
      protocolVersion: 2,
      machineId: body.machineId,
      userId: 'user-1',
      controllerCredentialId: body.controllerCredentialId,
      nonce: '30000000-0000-4000-8000-000000000003',
      timestampMs: 1_700_000_000_000,
      signature: 'sig',
      event: body,
    },
    body,
  };
};

// The first test below is the CLI-side leg of task 673385fe AC #1
// ("end-to-end verify the node-decision → host-turn chain"). It pins the
// contract that a verified `trigger.conversation` frame results in exactly
// one `localAgentService.sendMessage` call carrying the envelope's
// `triggerMessageId`. The API-side leg (exactly one signed frame addressed
// to the host machine) lives in
// `api/src/core/processing/__tests__/message-processor-trigger.integration.test.ts`.
describe('createTestRouter', () => {
  it('acknowledges an authority reduction only after its durable owner resolves', async () => {
    const verified = buildVerifiedControllerReduction();
    const verifier = buildVerifier({ ok: true, verified });
    let finishPersistence: (() => void) | undefined;
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const applyVerifiedAuthorityReduction = vi.fn().mockReturnValue(persistence);
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      machineControllerAuthority: { applyVerifiedAuthorityReduction },
      logger: noopLogger(),
    });

    let settled = false;
    const acknowledgement = router
      .handleAuthorityReduction(authorityReductionFrameEvent)
      .then((result) => {
        settled = true;
        return result;
      });
    await Promise.resolve();

    expect(applyVerifiedAuthorityReduction).toHaveBeenCalledWith(verified.envelope);
    expect(settled).toBe(false);

    finishPersistence?.();
    await expect(acknowledgement).resolves.toEqual({
      status: 'APPLIED',
      nonce: verified.envelope.nonce,
    });
  });

  it('applies authority reductions even when executable-trigger admission is rate limited', async () => {
    const verified = buildVerifiedControllerReduction();
    const applyVerifiedAuthorityReduction = vi.fn().mockResolvedValue(undefined);
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified }),
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      machineControllerAuthority: { applyVerifiedAuthorityReduction },
      logger: noopLogger(),
    });

    for (let attempt = 0; attempt < 25; attempt += 1) {
      await router.handleMonitorCommand(monitorCommandFrameEvent);
    }

    await expect(router.handleAuthorityReduction(authorityReductionFrameEvent)).resolves.toEqual({
      status: 'APPLIED',
      nonce: verified.envelope.nonce,
    });
    expect(applyVerifiedAuthorityReduction).toHaveBeenCalledOnce();
  });

  it('rejects replayed authority reductions without invoking the durable owner', async () => {
    const applyVerifiedAuthorityReduction = vi.fn();
    const router = createTestRouter({
      verifier: buildVerifier({ ok: false, reason: 'nonce_replay', details: {} }),
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      machineControllerAuthority: { applyVerifiedAuthorityReduction },
      logger: noopLogger(),
    });

    await expect(router.handleAuthorityReduction(authorityReductionFrameEvent)).resolves.toEqual({
      status: 'REJECTED',
      reason: 'NONCE_REPLAY',
    });
    expect(applyVerifiedAuthorityReduction).not.toHaveBeenCalled();
  });

  it('rejects a failed durable authority mutation instead of acknowledging success', async () => {
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified: buildVerifiedControllerReduction() }),
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      machineControllerAuthority: {
        applyVerifiedAuthorityReduction: vi.fn().mockRejectedValue(new Error('disk failed')),
      },
      logger: noopLogger(),
    });

    await expect(router.handleAuthorityReduction(authorityReductionFrameEvent)).resolves.toEqual({
      status: 'REJECTED',
      reason: 'PERSISTENCE_FAILED',
    });
  });

  it('delegates verification drops and verified resets to its owned recovery surface', () => {
    const drop = {
      ok: false,
      reason: 'signature_invalid',
      details: {},
    } satisfies VerifyResult;
    const verified = { ok: true, verified: buildVerifiedConversation() } satisfies VerifyResult;
    const verifier = buildVerifier(drop);
    vi.mocked(verifier.verifyTriggerFrame).mockReturnValueOnce(drop).mockReturnValueOnce(verified);
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });
    const dropRecoverySurface = dropRecoverySurfaceOf(router);
    const handleDrop = vi.spyOn(dropRecoverySurface, 'handleDrop').mockImplementation(() => {});
    const reset = vi.spyOn(dropRecoverySurface, 'reset');

    router.handlePlatformEvent(conversationFrameEvent);

    expect(handleDrop).toHaveBeenCalledWith(conversationFrameEvent, 'signature_invalid');
    expect(reset).not.toHaveBeenCalled();

    router.handlePlatformEvent(conversationFrameEvent);

    expect(reset).toHaveBeenCalledWith('c0000000-0000-4000-8000-000000000001');
  });

  it('hands a verified monitor command to targeted admission and returns its outcome', async () => {
    const authorization: ExecutableEnvelopeAuthorization = {
      kind: 'bounded_grant',
      grantId: '90000000-0000-4000-8000-000000000009',
    };
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedMonitorCommand(authorization),
    });
    const dispatchMonitorCommand = vi.fn().mockResolvedValue({
      status: 'ADMITTED',
      commandId: '10000000-0000-4000-8000-000000000001',
      replayed: false,
    });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      dispatchMonitorCommand,
      hostActionAdmission: {
        admit: vi.fn().mockResolvedValue({
          admitted: true,
          authorizationId: '80000000-0000-4000-8000-000000000008',
          grantId: authorization.grantId,
          capability: TEST_ADMITTED_HOST_ACTION,
        }),
      } as unknown as HostActionAdmission,
      logger: noopLogger(),
    });

    const outcome = await router.handleMonitorCommand(monitorCommandFrameEvent);

    expect(outcome).toEqual({
      status: 'ADMITTED',
      commandId: '10000000-0000-4000-8000-000000000001',
      replayed: false,
    });
    expect(dispatchMonitorCommand).toHaveBeenCalledTimes(1);
    expect(dispatchMonitorCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: '10000000-0000-4000-8000-000000000001',
        target: {
          workItemType: 'TASK_MONITOR',
          workItemId: '40000000-0000-4000-8000-000000000004',
        },
      }),
    );
  });

  it('hands a Task Monitor human decision only to targeted durable admission', async () => {
    const verified = buildVerifiedMonitorCommand();
    const body = {
      ...verified.body,
      commandId: '60000000-0000-4000-8000-000000000006',
      command: {
        cause: 'HUMAN_DECISION',
        interventionId: '70000000-0000-4000-8000-000000000007',
        providerActionId: 'provider-action-1',
        runId: '80000000-0000-4000-8000-000000000008',
        agentSessionId: '90000000-0000-4000-8000-000000000009',
        fingerprint: 'sha256:exact-action',
        resolution: 'APPROVE',
        human: {
          userId: 'a0000000-0000-4000-8000-00000000000a',
          authenticatedAt: '2026-07-19T00:01:00.000Z',
        },
      },
    } as MonitorCommandBody;
    const verifier = buildVerifier({
      ok: true,
      verified: {
        ...verified,
        body,
        envelope: { ...verified.envelope, event: body },
      } as never,
    });
    const dispatchMonitorCommand = vi.fn().mockResolvedValue({
      status: 'ADMITTED',
      commandId: body.commandId,
      replayed: false,
    });
    const submitPermissionDecision = vi.fn();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision,
      dispatchMonitorCommand,
      logger: noopLogger(),
    });

    await expect(router.handleMonitorCommand(monitorCommandFrameEvent)).resolves.toMatchObject({
      status: 'ADMITTED',
      commandId: body.commandId,
    });
    expect(dispatchMonitorCommand).toHaveBeenCalledWith(body);
    expect(submitPermissionDecision).not.toHaveBeenCalled();
  });

  it('returns a typed verification rejection without calling admission', async () => {
    const verifier = buildVerifier({
      ok: false,
      reason: 'signature_invalid',
      details: {},
    });
    const dispatchMonitorCommand = vi.fn();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      dispatchMonitorCommand,
      logger: noopLogger(),
    });

    const outcome = await router.handleMonitorCommand(monitorCommandFrameEvent);

    expect(outcome).toEqual({
      status: 'REJECTED',
      stage: 'VERIFICATION',
      reason: 'SIGNATURE_INVALID',
    });
    expect(dispatchMonitorCommand).not.toHaveBeenCalled();
  });

  it('rejects a verified legacy monitor command before targeted admission', async () => {
    const verified = buildVerifiedMonitorCommand();
    const verifier = buildVerifier({ ok: true, verified });
    vi.mocked(verifier.verifyTriggerFrame).mockReturnValue({ ok: true, verified });
    const admit = vi.fn();
    const dispatchMonitorCommand = vi.fn();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      dispatchMonitorCommand,
      hostActionAdmission: { admit, admitReduction: vi.fn() } as unknown as HostActionAdmission,
      logger: noopLogger(),
    });

    await expect(router.handleMonitorCommand(monitorCommandFrameEvent)).resolves.toMatchObject({
      status: 'REJECTED',
      stage: 'ADMISSION',
      reason: 'ROUTE_REJECTED',
    });
    expect(admit).not.toHaveBeenCalled();
    expect(dispatchMonitorCommand).not.toHaveBeenCalled();
  });

  it('routes a verified trigger.conversation into sendMessage carrying the envelope triggerContext pair', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedConversation({ triggerMessageId: 'trigger-msg-A' }),
    });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [runId, request] = sendMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(runId).toBe('run-1');
    expect(request['promptType']).toBe('implement');
    expect(request['triggerContext']).toEqual({
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-msg-A',
    });
  });

  it('denies a protocol-2 conversation with absent proof before the effect owner', async () => {
    const verified = buildVerifiedConversation();
    verified.envelope = { ...verified.envelope, protocolVersion: 2 } as never;
    const verifier = buildVerifier({ ok: true, verified });
    const sendMessage = vi.fn();
    const admit = vi.fn();
    const admitReduction = vi.fn();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      hostActionAdmission: { admit, admitReduction } as unknown as HostActionAdmission,
      logger: noopLogger(),
    });

    await expect(router.handlePlatformEvent(conversationFrameEvent)).resolves.toMatchObject({
      status: 'REJECTED',
      stage: 'ADMISSION',
    });
    expect(admit).not.toHaveBeenCalled();
    expect(admitReduction).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('correlates each delivery of one key to a distinct admission attempt without the nonce', async () => {
    const verified = buildVerifiedConversation({
      triggerMessageId: 'trigger-repeat',
      nonce: 'secret-nonce',
    });
    verified.envelope = {
      ...verified.envelope,
      protocolVersion: 2,
      authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
    } as never;
    const verifier = buildVerifier({ ok: true, verified });
    vi.mocked(verifier.verifyTriggerFrame).mockReturnValue({ ok: true, verified });
    const entries: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const recording = (bindings: Record<string, unknown>): ServerLogger => ({
      trace: () => {},
      debug: (event, fields) => entries.push({ event, fields: { ...bindings, ...fields } }),
      info: (event, fields) => entries.push({ event, fields: { ...bindings, ...fields } }),
      warn: (event, fields) => entries.push({ event, fields: { ...bindings, ...fields } }),
      error: (event, fields) => entries.push({ event, fields: { ...bindings, ...fields } }),
      child: (more) => recording({ ...bindings, ...more }),
    });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      hostActionAdmission: {
        admit: vi.fn(),
        admitReduction: vi.fn(),
      } as unknown as HostActionAdmission,
      logger: recording({}),
    });

    await Promise.allSettled([
      router.handlePlatformEvent(conversationFrameEvent),
      router.handlePlatformEvent(conversationFrameEvent),
    ]);

    const lookups = entries.filter(
      (entry) => entry.event === 'trigger-admission.run_lookup.started',
    );
    expect(lookups).toHaveLength(2);
    expect(lookups.map((entry) => entry.fields)).toEqual([
      expect.objectContaining({
        key: 'trigger-repeat',
        keyKind: 'trigger_message',
        admissionAttempt: 1,
      }),
      expect.objectContaining({
        key: 'trigger-repeat',
        keyKind: 'trigger_message',
        admissionAttempt: 2,
      }),
    ]);
    expect(JSON.stringify(lookups)).not.toContain('secret-nonce');
  });

  it('rejects a verified legacy conversation before admission or the effect owner', async () => {
    const verified = buildVerifiedConversation();
    const verifier = buildVerifier({ ok: true, verified });
    vi.mocked(verifier.verifyTriggerFrame).mockReturnValue({ ok: true, verified });
    const sendMessage = vi.fn();
    const admit = vi.fn();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      hostActionAdmission: { admit, admitReduction: vi.fn() } as unknown as HostActionAdmission,
      logger: noopLogger(),
    });

    await expect(router.handlePlatformEvent(conversationFrameEvent)).resolves.toMatchObject({
      status: 'REJECTED',
      stage: 'ADMISSION',
    });
    expect(admit).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('routes a verified user_message sentinel trigger into sendMessage carrying the payload handlerPromptType and userMessage', async () => {
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-user-msg',
        timestampMs: 0,
        signature: 'sig',
        event: {
          promptType: 'user_message',
          operationId: 'd0000000-0000-4000-8000-000000000001',
          operationFingerprint: 'f'.repeat(64),
          triggerMessageId: 'trigger-msg-user',
          sourceUserMessageId: 'src-user-msg',
          admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
          payload: {
            handlerPromptType: 'coding_freeform',
            userMessage: 'hi',
            attachments: [],
            skillSelection: { provider: 'codex', name: 'release-check', catalogScope: 'repo' },
          },
        } as unknown as never,
      },
      body: {
        promptType: 'user_message',
        operationId: 'd0000000-0000-4000-8000-000000000001',
        operationFingerprint: 'f'.repeat(64),
        triggerMessageId: 'trigger-msg-user',
        sourceUserMessageId: 'src-user-msg',
        admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
        payload: {
          handlerPromptType: 'coding_freeform',
          userMessage: 'hi',
          attachments: [],
          skillSelection: { provider: 'codex', name: 'release-check', catalogScope: 'repo' },
        },
      } as never,
    };
    const verifier = buildVerifier({ ok: true, verified });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [runId, request, options] = sendMessage.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { sourceUserMessageId: string },
    ];
    expect(runId).toBe('run-1');
    expect(request['promptType']).toBe('coding_freeform');
    expect(request['payload']).toEqual({ promptType: 'coding_freeform', userMessage: 'hi' });
    expect(request['skillSelection']).toEqual({
      provider: 'codex',
      name: 'release-check',
      catalogScope: 'repo',
    });
    expect(request).not.toHaveProperty('skillSelection.path');
    expect(options).toEqual({
      sourceUserMessageId: 'src-user-msg',
      admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
    });
    // User-reply follow-ups must not emit a triggerContext — doing so would
    // splice a fresh triggerMessageId under the Run's existing nodeId.
    expect(request['triggerContext']).toBeUndefined();

    expect(logger.infoCalls).toContainEqual([
      'input_admission.accepted',
      expect.objectContaining({ replayed: false }),
    ]);
  });

  it('drops a legacy user_message frame that omits the required source Message identity', async () => {
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-user-msg-missing-source',
        timestampMs: 0,
        signature: 'sig',
        event: {
          promptType: 'user_message',
          operationId: 'd0000000-0000-4000-8000-000000000001',
          operationFingerprint: 'f'.repeat(64),
          triggerMessageId: 'trigger-msg-user-missing-source',
          payload: { handlerPromptType: 'coding_freeform', userMessage: 'hi', attachments: [] },
        } as unknown as never,
      },
      body: {
        promptType: 'user_message',
        operationId: 'd0000000-0000-4000-8000-000000000001',
        operationFingerprint: 'f'.repeat(64),
        triggerMessageId: 'trigger-msg-user-missing-source',
        payload: { handlerPromptType: 'coding_freeform', userMessage: 'hi', attachments: [] },
      } as never,
    };
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const logger = noopLogger();
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified }),
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'payload_validation_failed',
        promptType: 'user_message',
      }),
    ]);
  });

  it('routes a legacy user_message frame without admitted scope and does not synthesize one', async () => {
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-user-msg-legacy-scope',
        timestampMs: 0,
        signature: 'sig',
        event: {
          promptType: 'user_message',
          operationId: 'd0000000-0000-4000-8000-000000000001',
          operationFingerprint: 'f'.repeat(64),
          triggerMessageId: 'trigger-msg-user-legacy-scope',
          sourceUserMessageId: 'src-user-msg-legacy-scope',
          payload: { handlerPromptType: 'coding_freeform', userMessage: 'hi', attachments: [] },
        } as unknown as never,
      },
      body: {
        promptType: 'user_message',
        operationId: 'd0000000-0000-4000-8000-000000000001',
        operationFingerprint: 'f'.repeat(64),
        triggerMessageId: 'trigger-msg-user-legacy-scope',
        sourceUserMessageId: 'src-user-msg-legacy-scope',
        payload: { handlerPromptType: 'coding_freeform', userMessage: 'hi', attachments: [] },
      } as never,
    };
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const logger = noopLogger();
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified }),
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[2]).toEqual({
      sourceUserMessageId: 'src-user-msg-legacy-scope',
    });
    expect(logger.infoCalls).toContainEqual([
      'input_admission.accepted',
      expect.objectContaining({ replayed: false }),
    ]);
  });

  it('routes an agent_search user_message follow-up with its handler payload intact', async () => {
    const body = {
      promptType: 'user_message',
      operationId: 'd0000000-0000-4000-8000-000000000001',
      operationFingerprint: 'f'.repeat(64),
      triggerMessageId: 'trigger-msg-agent-search',
      sourceUserMessageId: 'src-agent-search',
      admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
      payload: {
        handlerPromptType: 'agent_search',
        userMessage: 'find the Search Agent task',
        attachments: [],
      },
    };
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-agent-search',
        timestampMs: 0,
        signature: 'sig',
        event: body as unknown as never,
      },
      body: body as never,
    };
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified }),
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledWith(
      'run-1',
      {
        attachments: [],
        promptType: 'agent_search',
        payload: { promptType: 'agent_search', userMessage: 'find the Search Agent task' },
        references: { resolved: [], unresolved: [] },
      },
      {
        sourceUserMessageId: 'src-agent-search',
        admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
      },
    );
  });

  it('routes plan-shaping feature-sync follow-ups with the saved discrepancies and decisions', async () => {
    const body = {
      promptType: 'user_message',
      operationId: 'd0000000-0000-4000-8000-000000000001',
      operationFingerprint: 'f'.repeat(64),
      triggerMessageId: 'trigger-msg-feature-sync',
      sourceUserMessageId: 'src-feature-sync',
      admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
      payload: {
        handlerPromptType: 'plan_shaping_feature_sync_iterate',
        userMessage: 'Keep refining item 2.',
        attachments: [],
        featureSyncContext: {
          discrepancies: [
            { id: 'fs-1', summary: 'first', rationale: 'one' },
            { id: 'fs-2', summary: 'second', rationale: 'two' },
          ],
          decisions: [{ itemId: 'fs-2', choice: 'amend', note: 'Narrow scope' }],
        },
      },
    };
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-feature-sync',
        timestampMs: 0,
        signature: 'sig',
        event: body as unknown as never,
      },
      body: body as never,
    };
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified }),
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledWith(
      'run-1',
      {
        attachments: [],
        promptType: 'plan_shaping_feature_sync_iterate',
        payload: {
          discrepancies: body.payload.featureSyncContext.discrepancies,
          decisions: body.payload.featureSyncContext.decisions,
          userMessage: body.payload.userMessage,
        },
        references: { resolved: [], unresolved: [] },
      },
      {
        sourceUserMessageId: 'src-feature-sync',
        admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
      },
    );
  });

  it('routes a user Review through the shared session-scoped request shape', async () => {
    const operationId = '77777777-7777-4777-8777-777777777777';
    const operationFingerprint = '7'.repeat(64);
    const body = {
      operationId,
      operationFingerprint,
      promptType: 'user_message',
      triggerMessageId: 'trigger-review',
      sourceUserMessageId: 'source-review',
      admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
      payload: { handlerPromptType: 'code_review', userMessage: '', attachments: [] },
    };
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-review',
        timestampMs: 0,
        signature: 'sig',
        event: body as unknown as never,
      },
      body: body as never,
    };
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified }),
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    const first = await router.handlePlatformEvent(conversationFrameEvent);
    const replay = await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      'run-1',
      {
        attachments: [],
        promptType: 'code_review',
        payload: { userMessage: '' },
        references: { resolved: [], unresolved: [] },
      },
      {
        sourceUserMessageId: 'source-review',
        admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
      },
    );
    expect(first).toEqual({
      status: 'ACCEPTED',
      operationId,
      operationFingerprint,
      replayed: false,
      inputDisposition: 'IMMEDIATE',
    });
    // A replay returns the recorded disposition, not a fresh decision.
    expect(replay).toEqual({
      status: 'ACCEPTED',
      operationId,
      operationFingerprint,
      replayed: true,
      inputDisposition: 'IMMEDIATE',
    });
  });

  describe('runtime selection on a user_message follow-up', () => {
    const runtime = {
      provider: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'low',
      fastMode: true,
    } as const;

    const dispatchFollowUp = async (payload: Record<string, unknown>) => {
      const body = {
        operationId: '88888888-8888-4888-8888-888888888888',
        operationFingerprint: '8'.repeat(64),
        promptType: 'user_message',
        triggerMessageId: 'trigger-runtime',
        sourceUserMessageId: 'source-runtime',
        admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
        payload,
      };
      const verified: VerifiedTriggerFrame = {
        kind: 'trigger.conversation',
        frame: {
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'c0000000-0000-4000-8000-000000000001',
        },
        envelope: {
          machineId: 'm-1',
          userId: 'u-1',
          nonce: 'n-runtime',
          timestampMs: 0,
          signature: 'sig',
          event: body as unknown as never,
        },
        body: body as never,
      };
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const logger = noopLogger();
      const router = createTestRouter({
        verifier: buildVerifier({ ok: true, verified }),
        resolveConversationRun: () => ({
          runId: 'run-1',
          conversationId: 'c0000000-0000-4000-8000-000000000001',
        }),
        sendMessage,
        createRun: vi.fn(),
        stopRun: vi.fn().mockResolvedValue(undefined),
        compactRun: vi.fn().mockResolvedValue(undefined),
        submitPermissionDecision: noopSubmitPermissionDecision(),
        logger,
      });
      await router.handlePlatformEvent(conversationFrameEvent);
      return { sendMessage, logger };
    };

    it.each(['code_review', 'commit'])(
      'carries a %s follow-up selection onto the Turn request',
      async (handlerPromptType) => {
        const { sendMessage } = await dispatchFollowUp({
          handlerPromptType,
          userMessage: 'focus',
          attachments: [],
          runtime,
        });

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({
          promptType: handlerPromptType,
          turnRuntime: runtime,
        });
      },
    );

    it.each(['code_review', 'commit'])(
      'leaves a %s follow-up without a selection on the Run settings',
      async (handlerPromptType) => {
        const { sendMessage } = await dispatchFollowUp({
          handlerPromptType,
          userMessage: 'focus',
          attachments: [],
        });

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage.mock.calls[0]?.[1]).not.toHaveProperty('turnRuntime');
      },
    );

    it('drops a selection on a handler that does not take one', async () => {
      const { sendMessage, logger } = await dispatchFollowUp({
        handlerPromptType: 'coding_freeform',
        userMessage: 'hi',
        attachments: [],
        runtime,
      });

      expect(sendMessage).not.toHaveBeenCalled();
      expect(logger.warnCalls).toContainEqual([
        'trigger-verification.frame.dropped',
        expect.objectContaining({ reason: 'payload_validation_failed' }),
      ]);
    });

    it('drops a selection without a model', async () => {
      const { sendMessage } = await dispatchFollowUp({
        handlerPromptType: 'code_review',
        userMessage: '',
        attachments: [],
        runtime: { provider: 'claude' },
      });

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  it('routes a verified Task Monitor follow-up through closed machine admission', async () => {
    const taskMonitorPayload = {
      monitorId: '11111111-1111-4111-8111-111111111111',
      cause: 'STOP',
      correlationId: '22222222-2222-4222-8222-222222222222',
    };
    const body = {
      promptType: 'user_message',
      operationId: 'd0000000-0000-4000-8000-000000000001',
      operationFingerprint: 'f'.repeat(64),
      triggerMessageId: 'trigger-task-monitor',
      sourceUserMessageId: 'trigger-task-monitor',
      admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
      payload: {
        handlerPromptType: 'task_monitor',
        userMessage: '',
        attachments: [],
        taskMonitorPayload,
      },
    };
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-task-monitor',
        timestampMs: 0,
        signature: 'sig',
        event: body as unknown as never,
      },
      body: body as never,
    };
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const admitVerifiedTaskMonitorInput = vi.fn().mockResolvedValue({
      status: 'accepted',
      ingressId: 'conversation-message:trigger-task-monitor',
      snapshot: { revision: 2 },
      effects: [],
    });
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified }),
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      resolveTaskMonitorConversationBinding: vi.fn().mockResolvedValue({
        organizationId: 'org-1',
        projectId: 'proj-1',
      }),
      readUserMessage: vi.fn().mockResolvedValue({
        messageId: 'trigger-task-monitor',
        content: 'What is the progress?',
      }),
      admitVerifiedTaskMonitorInput,
      taskMonitorId: taskMonitorPayload.monitorId,
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(admitVerifiedTaskMonitorInput).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'CONVERSATION_MESSAGE',
        taskMonitorId: taskMonitorPayload.monitorId,
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        messageId: 'trigger-task-monitor',
      }),
    );
  });

  it('routes a quick user_message follow-up through coding_freeform with its typed payload', async () => {
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-quick-user-msg',
        timestampMs: 0,
        signature: 'sig',
        event: {
          promptType: 'user_message',
          operationId: 'd0000000-0000-4000-8000-000000000001',
          operationFingerprint: 'f'.repeat(64),
          triggerMessageId: 'trigger-msg-quick-user',
          sourceUserMessageId: 'src-quick-user-msg',
          admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
          payload: { handlerPromptType: 'quick', userMessage: 'what changed?', attachments: [] },
        } as unknown as never,
      },
      body: {
        promptType: 'user_message',
        operationId: 'd0000000-0000-4000-8000-000000000001',
        operationFingerprint: 'f'.repeat(64),
        triggerMessageId: 'trigger-msg-quick-user',
        sourceUserMessageId: 'src-quick-user-msg',
        admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
        payload: { handlerPromptType: 'quick', userMessage: 'what changed?', attachments: [] },
      } as never,
    };
    const verifier = buildVerifier({ ok: true, verified });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [runId, request] = sendMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(runId).toBe('run-1');
    expect(request['promptType']).toBe('coding_freeform');
    expect(request['payload']).toEqual({
      promptType: 'coding_freeform',
      userMessage: 'what changed?',
    });
    expect(request).not.toHaveProperty('prompt');
    expect(request['triggerContext']).toBeUndefined();
    expect(sendMessage.mock.calls[0]?.[2]).toEqual({
      sourceUserMessageId: 'src-quick-user-msg',
      admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
    });
  });

  it('maps a non-sentinel envelope promptType straight through to the request promptType', async () => {
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-feature-tree',
        timestampMs: 0,
        signature: 'sig',
        event: {
          promptType: 'feature_tree_conversation',
          nodeId: 'node-1',
          triggerMessageId: 'trigger-msg-ft',
          payload: { projectId: '11111111-1111-4111-8111-111111111111' },
        } as unknown as never,
      },
      body: {
        promptType: 'feature_tree_conversation',
        nodeId: 'node-1',
        triggerMessageId: 'trigger-msg-ft',
        payload: { projectId: '11111111-1111-4111-8111-111111111111' },
      } as never,
    };
    const verifier = buildVerifier({ ok: true, verified });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, request] = sendMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(request['promptType']).toBe('feature_tree_conversation');
    expect(request['triggerContext']).toEqual({
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-msg-ft',
    });

    expect(logger.infoCalls).toContainEqual([
      'input_admission.accepted',
      expect.objectContaining({ replayed: false }),
    ]);
  });

  it('threads each envelope triggerMessageId independently when the same Run is re-entered', async () => {
    const first = buildVerifiedConversation({
      triggerMessageId: 'trigger-msg-first',
      nonce: 'n-first',
    });
    const second = buildVerifiedConversation({
      triggerMessageId: 'trigger-msg-second',
      nonce: 'n-second',
    });
    const verifier = buildQueueVerifier([
      { ok: true, verified: first },
      { ok: true, verified: second },
    ]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const [, firstRequest] = sendMessage.mock.calls[0] as [string, Record<string, unknown>];
    const [, secondRequest] = sendMessage.mock.calls[1] as [string, Record<string, unknown>];
    expect((firstRequest['triggerContext'] as Record<string, unknown>)['triggerMessageId']).toBe(
      'trigger-msg-first',
    );
    expect((secondRequest['triggerContext'] as Record<string, unknown>)['triggerMessageId']).toBe(
      'trigger-msg-second',
    );
  });

  // The platform re-fans a pending trigger on every CLI authenticate, re-signed
  // with a fresh nonce but the same triggerMessageId. Nonce-replay can't catch
  // it; the dedupe store must collapse the burst to a single sendMessage.
  it('collapses re-fanned conversation triggers sharing a triggerMessageId to one sendMessage', async () => {
    const refanned = (nonce: string): VerifiedTriggerFrame =>
      buildVerifiedConversation({ triggerMessageId: 'trigger-msg-refan', nonce });
    const verifier = buildQueueVerifier([
      { ok: true, verified: refanned('n-refan-1') },
      { ok: true, verified: refanned('n-refan-2') },
      { ok: true, verified: refanned('n-refan-3') },
    ]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await router.handlePlatformEvent(conversationFrameEvent);
    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(logger.infoCalls).toContainEqual([
      'input_admission.accepted',
      expect.objectContaining({ replayed: true }),
    ]);
  });

  // A re-fan that arrives before the run is bound is dropped as no_active_run
  // and must NOT be recorded — otherwise the re-fan that lands once the run
  // binds would be wrongly suppressed and the workflow would stall.
  it('does not record a triggerMessageId dropped as no_active_run, so a later bound delivery dispatches', async () => {
    const sameTrigger = (nonce: string): VerifiedTriggerFrame =>
      buildVerifiedConversation({ triggerMessageId: 'trigger-msg-race', nonce });
    const verifier = buildQueueVerifier([
      { ok: true, verified: sameTrigger('n-race-1') },
      { ok: true, verified: sameTrigger('n-race-2') },
    ]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    // First delivery: no run bound yet. Second: the run has bound.
    let runBound = false;
    const resolveConversationRun = vi.fn(() => (runBound ? binding : null));
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    runBound = true;
    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, request] = sendMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect((request['triggerContext'] as Record<string, unknown>)['triggerMessageId']).toBe(
      'trigger-msg-race',
    );
  });

  it('drops the frame with reason "schema" when the envelope event lacks triggerMessageId', () => {
    // The schema rejects frames whose envelope.event is missing the required
    // triggerMessageId; the router must propagate that drop and never invoke
    // sendMessage. (The actual zod schema is exercised in verify.test.ts; here
    // we only assert the router's handling of the verifier's signal.)
    const verifier = buildVerifier({
      ok: false,
      reason: 'schema',
      details: { issues: [{ path: 'envelope.event.triggerMessageId', message: 'Required' }] },
    });
    const sendMessage = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'schema',
        frameType: 'trigger.conversation',
      }),
    ]);
  });

  it('logs a dropped frame and does not dispatch when verification fails', () => {
    const verifier = buildVerifier({
      ok: false,
      reason: 'signature_invalid',
      details: { nonce: 'n-3' },
    });
    const sendMessage = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    router.handlePlatformEvent(conversationFrameEvent);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'signature_invalid',
        frameType: 'trigger.conversation',
      }),
    ]);
  });

  it('defers a conversation trigger while its active run binding is unavailable', async () => {
    const verifier = buildVerifier({ ok: true, verified: buildVerifiedConversation() });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.authority.denied',
      expect.objectContaining({ reason: 'conversation_binding_not_available', retryable: true }),
    ]);
  });

  it('ignores non-trigger event types', () => {
    const verifier = buildVerifier({
      ok: false,
      reason: 'unknown_frame_type',
      details: {},
    });
    const sendMessage = vi.fn();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    router.handlePlatformEvent({
      type: 'conversation.updated',
      timestamp: '2026-01-01T00:00:00Z',
      organizationId: 'org-1',
    });
    expect(verifier.verifyTriggerFrame).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('drops excess frames before verification when its owned rate limiter is exhausted', () => {
    const verifier = buildVerifier({ ok: true, verified: buildVerifiedConversation() });
    const sendMessage = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    for (let attempt = 0; attempt < 200; attempt += 1) {
      router.handlePlatformEvent(conversationFrameEvent);
    }

    expect(verifier.verifyTriggerFrame).toHaveBeenCalled();
    expect(verifier.verifyTriggerFrame).not.toHaveBeenCalledTimes(200);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'rate_limit',
        frameType: 'trigger.conversation',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
    ]);
  });

  // -----------------------------------------------------------------
  // start_run sentinel branch
  //
  // The `start_run` envelope is the only conversation-trigger variant that
  // materializes a new local Run instead of routing into an already-bound
  // run. The dispatcher must:
  //   (a) translate the StartRunPromptPayload into a LocalCreateRunRequest
  //       and call the injected createRun once with the envelope payload
  //       fields plus the frame conversationId.
  //   (b) re-issue createRun for a duplicate-envelope retry, letting the
  //       underlying run.service short-circuit on agentSessionId.
  //   (c) leave non-start_run promptTypes on the sendMessage flow.
  //   (d) drop the frame with a payload_validation_failed audit log when
  //       a verified start_run is missing a load-bearing field.
  // -----------------------------------------------------------------
  const VALID_START_RUN_CONTEXT_METADATA = {
    capturedAt: '2026-01-01T00:00:00Z',
    organizationId: 'org-1',
    projectId: '22222222-2222-4222-8222-222222222222',
    agentSessionId: 'sess-abc',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  };
  // The start_run envelope's `payload` carries the shared `RunCreatePayload`
  // type (no runtime shape re-validation); `daily_session` is used here as a
  // representative valid member. The outer `.refine()` on startRunPayloadSchema
  // asserts `handlerPromptType` matches `payload.promptType`, so both must be
  // `daily_session` here.
  const VALID_START_RUN_PAYLOAD = {
    attachments: [],
    handlerPromptType: 'daily_session',
    payload: { promptType: 'daily_session', payloadVersion: 1, userMessage: 'do the thing' },
    model: 'claude-opus-4-7',
    reasoningEffort: 'high',
    provider: 'claude',
    contextMetadata: VALID_START_RUN_CONTEXT_METADATA,
    serviceIds: ['svc-1'],
    launchServiceId: 'svc-1',
    worktree: { enabled: true, branch: 'feature/worktree-run' },
    agentSessionId: 'sess-abc',
  };
  const PATHLESS_CODEX_SKILL_SELECTION = {
    provider: 'codex' as const,
    name: 'release-check',
    catalogScope: 'repo' as const,
  };

  const buildVerifiedStartRun = (
    overrides: { payload?: unknown; nonce?: string; triggerMessageId?: string } = {},
  ): VerifiedTriggerFrame => {
    const payload = overrides.payload ?? VALID_START_RUN_PAYLOAD;
    const triggerMessageId = overrides.triggerMessageId ?? 'trigger-msg-start';
    const nonce = overrides.nonce ?? 'n-start-run';
    return {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce,
        timestampMs: 0,
        signature: 'sig',
        event: {
          operationId: '55555555-5555-4555-8555-555555555555',
          operationFingerprint: '0'.repeat(64),
          promptType: 'start_run',
          triggerMessageId,
          payload,
        } as unknown as never,
      },
      body: {
        operationId: '55555555-5555-4555-8555-555555555555',
        operationFingerprint: '0'.repeat(64),
        promptType: 'start_run',
        triggerMessageId,
        payload,
      } as never,
    };
  };

  it('accepts omitted launch attachments, defaults the executable input, and preserves signed data', async () => {
    const { attachments: _references, ...payload } = VALID_START_RUN_PAYLOAD;
    const verified = buildVerifiedStartRun({ payload });
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-new' } });
    const router = createTestRouter({
      verifier: buildVerifier({ ok: true, verified }),
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    const acknowledgement = await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(acknowledgement).toEqual(expect.objectContaining({ status: 'ACCEPTED' }));
    expect(createRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ attachments: [], payload: payload.payload }),
    );
    expect(verified.envelope.event).toHaveProperty('payload', payload);
    expect(payload).not.toHaveProperty('attachments');
  });

  it('translates a verified start_run envelope into a LocalCreateRunRequest and invokes createRun once', async () => {
    const verifier = buildVerifier({ ok: true, verified: buildVerifiedStartRun() });
    const sendMessage = vi.fn();
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-new' } });
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      // The conversation has no bound run yet — start_run is the trigger
      // that materializes it. The dispatcher must NOT call into
      // resolveConversationRun for this branch.
      resolveConversationRun: vi.fn(),
      sendMessage,
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    const acknowledgement = await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(acknowledgement).toEqual({
      status: 'ACCEPTED',
      operationId: '55555555-5555-4555-8555-555555555555',
      operationFingerprint: '0'.repeat(64),
      replayed: false,
      inputDisposition: 'IMMEDIATE',
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledTimes(1);
    const [request] = createRun.mock.calls[0] as [Record<string, unknown>];
    expect(request['conversationId']).toBe('c0000000-0000-4000-8000-000000000001');
    expect(request['payload']).toEqual({
      promptType: 'daily_session',
      payloadVersion: 1,
      userMessage: 'do the thing',
    });
    expect(request['model']).toBe('claude-opus-4-7');
    expect(request['reasoningEffort']).toBe('high');
    expect(request['worktree']).toEqual({ enabled: true, branch: 'feature/worktree-run' });
    expect(request['contextMetadata']).toEqual(VALID_START_RUN_CONTEXT_METADATA);
    // The envelope's service set rides into the run context as `serviceIds[]` +
    // `launchServiceId` (the contract `parsePendingRunContext` reads). A scalar
    // `serviceId` here would be a dead key nothing downstream reads → empty
    // `services` → diff 422.
    expect(request['context']).toEqual({
      projectId: VALID_START_RUN_CONTEXT_METADATA.projectId,
      serviceIds: ['svc-1'],
      launchServiceId: 'svc-1',
      provider: 'claude',
    });

    expect(logger.infoCalls).toContainEqual([
      'input_admission.accepted',
      expect.objectContaining({ replayed: false }),
    ]);
  });

  it.each(['codex', 'claude'] as const)(
    'preserves explicit false Fast mode intent when dispatching a %s start_run',
    async (provider) => {
      const verifier = buildVerifier({
        ok: true,
        verified: buildVerifiedStartRun({
          payload: { ...VALID_START_RUN_PAYLOAD, provider, fastMode: false },
        }),
      });
      const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-fast' } });
      const logger = noopLogger();
      const router = createTestRouter({
        verifier,
        resolveConversationRun: vi.fn(),
        sendMessage: vi.fn(),
        createRun,
        stopRun: vi.fn().mockResolvedValue(undefined),
        compactRun: vi.fn().mockResolvedValue(undefined),
        submitPermissionDecision: noopSubmitPermissionDecision(),
        logger,
      });

      await router.handlePlatformEvent(conversationFrameEvent);
      await Promise.resolve();

      expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ fastMode: false }));
      expect(logger.infoCalls).toContainEqual([
        'input_admission.accepted',
        expect.objectContaining({ replayed: false }),
      ]);
    },
  );

  it('forwards only the pathless Skill selection through a Codex start_run', async () => {
    const payload = {
      ...VALID_START_RUN_PAYLOAD,
      provider: 'codex',
      skillSelection: PATHLESS_CODEX_SKILL_SELECTION,
    };
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload }),
    });
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-skill' } });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({ skillSelection: PATHLESS_CODEX_SKILL_SELECTION }),
    );
    const request = createRun.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request).not.toHaveProperty('skillSelection.path');
  });

  it('drops an OpenCode start_run carrying Fast mode before createRun', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({
        payload: { ...VALID_START_RUN_PAYLOAD, provider: 'opencode', fastMode: true },
      }),
    });
    const createRun = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(createRun).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'payload_validation_failed',
        promptType: 'start_run',
      }),
    ]);
  });

  // Pins the daily_session start_run path explicitly. The shared
  // VALID_START_RUN_PAYLOAD happens to use daily_session as its representative
  // member, but this test constructs its own daily_session envelope so the
  // wiring — a daily_session RunCreatePayloadDailySession payload flowing
  // verbatim into createRun's LocalCreateRunRequest, with handlerPromptType
  // carried as the routing key — stays pinned even if the shared fixture's
  // promptType is later changed. daily_session has no per-variant schema in the
  // triggerPayloadSchemas registry by design, so this is the regression guard
  // that the start-run envelope still carries it end to end.
  it('translates a daily_session start_run envelope into createRun carrying the daily_session payload', async () => {
    const dailySessionPayload = {
      attachments: [],
      handlerPromptType: 'daily_session',
      payload: { promptType: 'daily_session', payloadVersion: 1, userMessage: 'run the daily' },
      model: 'claude-opus-4-8',
      reasoningEffort: 'high',
      provider: 'claude',
      contextMetadata: VALID_START_RUN_CONTEXT_METADATA,
      serviceIds: ['svc-daily'],
      launchServiceId: 'svc-daily',
      agentSessionId: 'sess-daily',
    };
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: dailySessionPayload }),
    });
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-daily' } });
    const sendMessage = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage,
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledTimes(1);
    const [request] = createRun.mock.calls[0] as [Record<string, unknown>];
    expect(request['conversationId']).toBe('c0000000-0000-4000-8000-000000000001');
    expect(request['payload']).toEqual({
      promptType: 'daily_session',
      payloadVersion: 1,
      userMessage: 'run the daily',
    });
    expect(logger.infoCalls).toContainEqual([
      'input_admission.accepted',
      expect.objectContaining({ replayed: false }),
    ]);
  });

  it('dispatches a start_run with no services (non-coding session) and omits them from the run context', async () => {
    const {
      serviceIds: _omittedServiceIds,
      launchServiceId: _omittedLaunchServiceId,
      ...payloadNoServiceId
    } = VALID_START_RUN_PAYLOAD;
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: payloadNoServiceId }),
    });
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-new' } });
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(createRun).toHaveBeenCalledTimes(1);
    const [request] = createRun.mock.calls[0] as [Record<string, unknown>];
    expect(request['context']).toEqual({
      projectId: VALID_START_RUN_CONTEXT_METADATA.projectId,
      provider: 'claude',
    });
    expect(request['context']).not.toHaveProperty('serviceId');
    expect(request['context']).not.toHaveProperty('serviceIds');
    expect(request['context']).not.toHaveProperty('launchServiceId');
  });

  it('dispatches a start_run with no reasoningEffort (providers like OpenCode do not support it) and omits it from the request', async () => {
    const { reasoningEffort: _omittedReasoningEffort, ...payloadNoReasoningEffort } =
      VALID_START_RUN_PAYLOAD;
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: payloadNoReasoningEffort }),
    });
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-no-re' } });
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn().mockResolvedValue({ run: { id: 'run-1' } }),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    const [request] = createRun.mock.calls[0] as [Record<string, unknown>];
    expect(request['model']).toBe('claude-opus-4-7');
    expect(request).not.toHaveProperty('reasoningEffort');
  });

  it('dispatches start_run AgentSession config into the local create-run request', async () => {
    const config = {
      type: 'CODING_SESSION',
      version: 'v2',
      model: 'claude-opus-4-7',
      projectAssistant: {
        enabled: false,
        allowEdgeUpdates: true,
        notifyDiscrepancies: true,
        allowUpdateProposals: false,
      },
    };
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: { ...VALID_START_RUN_PAYLOAD, config } }),
    });
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-config' } });
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    const [request] = createRun.mock.calls[0] as [Record<string, unknown>];
    expect(request['config']).toEqual(config);
  });

  // The materialize-only (workflow) arm of start_run. Carries `workflowName`,
  // no `handlerPromptType`, and an optional `workflow_kickoff` payload. The
  // dispatcher must call createRun once, preserving the payload when present
  // for identity capture, while never firing a first Turn. The Temporal
  // workflow's own SYSTEM triggers drive every Turn.
  // This is the CLI-side leg of the plan-from-design-doc bind; the API-side
  // leg (the controller authoring this envelope) lives in
  // api/src/controllers/__tests__/conversation.controller.test.ts.
  const VALID_WORKFLOW_ARM_PAYLOAD = {
    workflowName: 'plan-from-design-doc',
    payload: {
      promptType: 'workflow_kickoff',
      entity: {
        entityType: 'TASK',
        entityId: '11111111-1111-4111-8111-111111111111',
      },
      userMessage: 'Plan this task',
    },
    model: 'claude-opus-4-7',
    reasoningEffort: 'high',
    provider: 'claude',
    contextMetadata: VALID_START_RUN_CONTEXT_METADATA,
    serviceIds: ['svc-1'],
    launchServiceId: 'svc-1',
    agentSessionId: 'sess-abc',
  };

  it('materializes the Agent Session Run and ignores a distinct trigger runId', async () => {
    const agentSessionId = VALID_WORKFLOW_ARM_PAYLOAD.agentSessionId;
    const payload = {
      ...VALID_WORKFLOW_ARM_PAYLOAD,
      runId: '60000000-0000-4000-8000-000000000006',
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
      fastMode: false,
    };
    const verifier = buildVerifier({ ok: true, verified: buildVerifiedStartRun({ payload }) });
    let bound = false;
    const sendMessage = vi.fn();
    const createRun = vi.fn().mockImplementation(async () => {
      bound = true;
      return { status: 'started', run: { agentic_session_id: agentSessionId } };
    });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () =>
        bound
          ? ({
              runId: agentSessionId,
              conversationId: 'c0000000-0000-4000-8000-000000000001',
            } as never)
          : null,
      sendMessage,
      createRun,
      stopRun: vi.fn(),
      compactRun: vi.fn(),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });
    const acknowledgement = await router.handlePlatformEvent(conversationFrameEvent);
    expect(acknowledgement?.status).toBe('ACCEPTED');
    const request = createRun.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request).not.toHaveProperty('runId');
    expect(request).toMatchObject({
      fastMode: false,
      contextMetadata: VALID_START_RUN_CONTEXT_METADATA,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a materialize-only start with the unbound Services when no folder is bound', async () => {
    const serviceId = '60000000-0000-4000-8000-000000000007';
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: VALID_WORKFLOW_ARM_PAYLOAD }),
    });
    const createRun = vi.fn().mockResolvedValue({
      status: 'repo-required',
      serviceIds: [serviceId],
      launchServiceId: serviceId,
    });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn(),
      compactRun: vi.fn(),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    expect(await router.handlePlatformEvent(conversationFrameEvent)).toEqual({
      status: 'REJECTED',
      stage: 'EXECUTION',
      reason: 'SERVICE_FOLDER_NOT_BOUND',
      unboundServiceIds: [serviceId],
    });
  });

  it('binds a Run on the materialize-only workflow arm with its focal payload and never calls sendMessage', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: VALID_WORKFLOW_ARM_PAYLOAD }),
    });
    const sendMessage = vi.fn();
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-wf' } });
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      // No bound run yet — this envelope is what materializes it.
      resolveConversationRun: vi.fn(),
      sendMessage,
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    // No first turn fires on this arm.
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledTimes(1);
    const [request] = createRun.mock.calls[0] as [Record<string, unknown>];
    expect(request['conversationId']).toBe('c0000000-0000-4000-8000-000000000001');
    expect(request['payload']).toEqual({
      promptType: 'workflow_kickoff',
      entity: {
        entityType: 'TASK',
        entityId: '11111111-1111-4111-8111-111111111111',
      },
      userMessage: 'Plan this task',
    });
    // Materialization context still rides so the Run can be created and post.
    expect(request['model']).toBe('claude-opus-4-7');
    expect(request['reasoningEffort']).toBe('high');
    expect(request['contextMetadata']).toEqual(VALID_START_RUN_CONTEXT_METADATA);
    // Service set rides into the run context as `serviceIds[]` + `launchServiceId`
    // (see the turn-firing-arm test above for why a scalar key would be dropped).
    expect(request['context']).toEqual({
      projectId: VALID_START_RUN_CONTEXT_METADATA.projectId,
      serviceIds: ['svc-1'],
      launchServiceId: 'svc-1',
      provider: 'claude',
    });
  });

  it('binds a Run on the payload-free workflow arm and never calls sendMessage', async () => {
    const { payload: _omitted, ...bindOnlyWorkflowArm } = VALID_WORKFLOW_ARM_PAYLOAD;
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: bindOnlyWorkflowArm }),
    });
    const sendMessage = vi.fn();
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-wf' } });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage,
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledTimes(1);
    const [request] = createRun.mock.calls[0] as [Record<string, unknown>];
    expect(request).not.toHaveProperty('payload');
    expect(request['conversationId']).toBe('c0000000-0000-4000-8000-000000000001');
    expect(request['contextMetadata']).toEqual(VALID_START_RUN_CONTEXT_METADATA);
  });

  it('preserves an explicitly unscoped workflow kickoff without inventing entity context', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({
        payload: {
          ...VALID_WORKFLOW_ARM_PAYLOAD,
          payload: { promptType: 'workflow_kickoff', userMessage: 'Plan without a focal entity' },
        },
      }),
    });
    const createRun = vi.fn().mockResolvedValue({ status: 'started', run: { id: 'run-wf' } });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { promptType: 'workflow_kickoff', userMessage: 'Plan without a focal entity' },
      }),
    );
  });

  it('drops a workflow kickoff with malformed focal identity before createRun', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({
        payload: {
          ...VALID_WORKFLOW_ARM_PAYLOAD,
          payload: {
            promptType: 'workflow_kickoff',
            entity: { entityType: 'TASK', entityId: 'not-a-uuid' },
            userMessage: 'Plan this task',
          },
        },
      }),
    });
    const createRun = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(createRun).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({ reason: 'payload_validation_failed', promptType: 'start_run' }),
    ]);
  });

  it('suppresses a duplicate start_run operation before createRun', async () => {
    const first = buildVerifiedStartRun({ nonce: 'n-first' });
    const second = buildVerifiedStartRun({ nonce: 'n-second' });
    const verifier = buildQueueVerifier([
      { ok: true, verified: first },
      { ok: true, verified: second },
    ]);
    // The first call materializes the run; the second call exercises the
    // service-level short-circuit. Both return the same persisted run.
    const persistedRun = { status: 'started' as const, run: { id: 'run-existing' } };
    const createRun = vi.fn().mockResolvedValue(persistedRun);
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);
    await router.handlePlatformEvent(conversationFrameEvent);
    await Promise.resolve();

    expect(createRun).toHaveBeenCalledTimes(1);
    const calls = createRun.mock.calls as Array<[Record<string, unknown>]>;
    const firstRequest = calls[0]?.[0];
    expect((firstRequest?.['contextMetadata'] as { agentSessionId?: string }).agentSessionId).toBe(
      'sess-abc',
    );
  });

  it('routes non-start_run conversation triggers through sendMessage, not createRun', async () => {
    const verifier = buildVerifier({ ok: true, verified: buildVerifiedConversation() });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const createRun = vi.fn();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'run-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage,
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger: noopLogger(),
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(createRun).not.toHaveBeenCalled();
  });

  it('routes a user_message envelope carrying a formerly start-run-only handlerPromptType (free_form) into sendMessage', async () => {
    // A follow-up turn re-enters whatever handler the run is paused on, so a
    // user_message handlerPromptType is no longer narrowed to the
    // follow-up-only union. free_form now routes into sendMessage with
    // promptType free_form and the degenerate {promptType, userMessage}
    // payload — never dropped at the wire edge.
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.conversation',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-cross-user-msg',
        timestampMs: 0,
        signature: 'sig',
        event: {
          promptType: 'user_message',
          operationId: 'd0000000-0000-4000-8000-000000000001',
          operationFingerprint: 'f'.repeat(64),
          triggerMessageId: 'trigger-msg-cross',
          sourceUserMessageId: 'source-message-cross',
          admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
          payload: { handlerPromptType: 'free_form', userMessage: 'hi', attachments: [] },
        } as unknown as never,
      },
      body: {
        promptType: 'user_message',
        operationId: 'd0000000-0000-4000-8000-000000000001',
        operationFingerprint: 'f'.repeat(64),
        triggerMessageId: 'trigger-msg-cross',
        sourceUserMessageId: 'source-message-cross',
        admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
        payload: { handlerPromptType: 'free_form', userMessage: 'hi', attachments: [] },
      } as never,
    };
    const verifier = buildVerifier({ ok: true, verified });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage,
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [runId, request] = sendMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(runId).toBe('run-1');
    expect(request['promptType']).toBe('free_form');
    expect(request['payload']).toEqual({ promptType: 'free_form', userMessage: 'hi' });
    expect(request['triggerContext']).toBeUndefined();
  });

  it('drops a start_run envelope whose handlerPromptType disagrees with payload.promptType', async () => {
    // Payload shape is no longer re-validated at the wire edge (the shared
    // `RunCreatePayload` type is the single source of truth for both producer
    // and consumer). The surviving cross-field guard is the `.refine()` that
    // the envelope's routing key match the payload's own discriminator — a
    // mismatch must drop with payload_validation_failed and never reach
    // createRun.
    const mismatchedPayload = {
      attachments: [],
      handlerPromptType: 'free_form',
      payload: { promptType: 'coding_freeform', userMessage: 'hi' },
      model: 'claude-opus-4-7',
      reasoningEffort: 'high',
      provider: 'claude',
      contextMetadata: VALID_START_RUN_CONTEXT_METADATA,
      serviceIds: ['svc-1'],
      launchServiceId: 'svc-1',
      agentSessionId: 'sess-abc',
    };
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: mismatchedPayload }),
    });
    const createRun = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(createRun).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'payload_validation_failed',
        frameType: 'trigger.conversation',
        promptType: 'start_run',
      }),
    ]);
  });

  it('drops a start_run envelope and skips createRun when a load-bearing payload field is missing', async () => {
    const { model: _omittedModel, ...payloadMissingModel } = VALID_START_RUN_PAYLOAD;
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStartRun({ payload: payloadMissingModel }),
    });
    const createRun = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: vi.fn(),
      sendMessage: vi.fn(),
      createRun,
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(createRun).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'payload_validation_failed',
        frameType: 'trigger.conversation',
        promptType: 'start_run',
      }),
    ]);
  });

  // -----------------------------------------------------------------
  // trigger.control branch — stop_run
  //
  // A verified `trigger.control` frame must:
  //   (a) resolve the conversation to its active Run binding and invoke the
  //       injected stopRun dep with that binding's runId.
  //   (b) be a clean no-op (warn log, no error surfaced) when no active run
  //       owns the conversation.
  // -----------------------------------------------------------------
  const controlFrameEvent: PlatformWebSocketEvent = {
    type: 'trigger.control',
    timestamp: '2026-01-01T00:00:00Z',
    organizationId: 'org-1',
    conversationId: 'c0000000-0000-4000-8000-000000000001',
    envelope: {},
  };

  const buildVerifiedStopRunControl = (
    overrides: { runId?: string; nonce?: string } = {},
  ): VerifiedTriggerFrame => {
    const runId = overrides.runId ?? 'run-42';
    const nonce = overrides.nonce ?? 'n-control';
    return {
      kind: 'trigger.control',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce,
        timestampMs: 0,
        signature: 'sig',
        event: { kind: 'stop_run', conversationId: 'c0000000-0000-4000-8000-000000000001', runId },
      } as never,
      body: {
        kind: 'stop_run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        runId,
      } as never,
    };
  };

  const buildVerifiedCompactRunControl = (
    overrides: { runId?: string; nonce?: string } = {},
  ): VerifiedTriggerFrame => {
    const runId = overrides.runId ?? 'run-42';
    const nonce = overrides.nonce ?? 'n-control';
    return {
      kind: 'trigger.control',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce,
        timestampMs: 0,
        signature: 'sig',
        event: {
          kind: 'compact_run',
          conversationId: 'c0000000-0000-4000-8000-000000000001',
          runId,
        },
      } as never,
      body: {
        kind: 'compact_run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        runId,
      } as never,
    };
  };

  it('routes a verified trigger.control stop_run into the injected stopRun with the active binding runId', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStopRunControl({ runId: 'envelope-run' }),
    });
    const stopRun = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'binding-run',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun,
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(controlFrameEvent);

    expect(stopRun).toHaveBeenCalledTimes(1);
    expect(stopRun).toHaveBeenCalledWith('binding-run');
    expect(logger.infoCalls).toContainEqual([
      'trigger-verification.control.dispatch',
      expect.objectContaining({
        kind: 'stop_run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        runId: 'binding-run',
        envelopeRunId: 'envelope-run',
        nonce: 'n-control',
      }),
    ]);
  });

  it('routes a verified trigger.control compact_run into the injected compactRun when the signed run matches the active binding', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedCompactRunControl({ runId: 'binding-run' }),
    });
    const stopRun = vi.fn().mockResolvedValue(undefined);
    const compactRun = vi.fn().mockResolvedValue(undefined);
    const binding: ConversationRunBinding = {
      runId: 'binding-run',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun,
      compactRun,
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(controlFrameEvent);

    expect(compactRun).toHaveBeenCalledTimes(1);
    expect(compactRun).toHaveBeenCalledWith('binding-run');
    expect(stopRun).not.toHaveBeenCalled();
    expect(logger.infoCalls).toContainEqual([
      'trigger-verification.control.dispatch',
      expect.objectContaining({
        kind: 'compact_run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        runId: 'binding-run',
        envelopeRunId: 'binding-run',
        nonce: 'n-control',
      }),
    ]);
  });

  it('rejects compact_run when the signed run does not match the active conversation binding', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedCompactRunControl({ runId: 'envelope-run' }),
    });
    const stopRun = vi.fn().mockResolvedValue(undefined);
    const compactRun = vi.fn().mockResolvedValue(undefined);
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'binding-run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun,
      compactRun,
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(controlFrameEvent);

    expect(compactRun).not.toHaveBeenCalled();
    expect(stopRun).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'run_binding_mismatch',
        kind: 'compact_run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        runId: 'binding-run',
        envelopeRunId: 'envelope-run',
        nonce: 'n-control',
      }),
    ]);
  });

  it('drops a verified trigger.control stop_run as a clean no-op when no active run owns the conversation', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedStopRunControl(),
    });
    const stopRun = vi.fn().mockResolvedValue(undefined);
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun,
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    await router.handlePlatformEvent(controlFrameEvent);

    expect(stopRun).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.control.no_active_run',
      expect.objectContaining({
        kind: 'stop_run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        runId: 'run-42',
        nonce: 'n-control',
      }),
    ]);
  });

  it('drops a control frame with reason "allowlist" when the verifier rejects an unknown kind', () => {
    const verifier = buildVerifier({
      ok: false,
      reason: 'allowlist',
      details: { frameType: 'trigger.control', bodyKind: 'unknown_kind', nonce: 'n-x' },
    });
    const stopRun = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun,
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
    });

    router.handlePlatformEvent(controlFrameEvent);

    expect(stopRun).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.frame.dropped',
      expect.objectContaining({
        reason: 'allowlist',
        frameType: 'trigger.control',
        bodyKind: 'unknown_kind',
      }),
    ]);
  });

  // trigger.control branch — permission_decision
  //
  // The permission-decision body carries no conversationId/runId of its own;
  // the Run is resolved from the outer frame's conversationId. A verified frame
  // must route the translated decision into the injected
  // submitPermissionDecision dep and persist every outcome to the audit sink,
  // never throwing.
  // -----------------------------------------------------------------
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const readPermissionDecisionAudit = async (
    filePath: string,
  ): Promise<Array<Record<string, unknown>>> => {
    const contents = await readFile(filePath, 'utf8');
    return contents
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  };

  const buildVerifiedPermissionDecisionControl = (
    overrides: { decision?: string; nonce?: string } = {},
  ): VerifiedTriggerFrame => {
    const decision = overrides.decision ?? 'approve';
    const nonce = overrides.nonce ?? 'n-perm';
    const event = {
      kind: 'permission_decision',
      decision,
      requestId: 'req-1',
      sessionId: 'sess-1',
      agentType: 'claude',
      reason: null,
      idempotencyToken: 'idem-1',
    };
    return {
      kind: 'trigger.control',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce,
        timestampMs: 0,
        signature: 'sig',
        event,
      } as never,
      body: event as never,
    };
  };

  it.each(['review_file_scope', 'service_scope'] as const)(
    'routes a Task Monitor-owned %s decision through its Run owner',
    async (kind) => {
      const verifier = buildVerifier({
        ok: true,
        verified: buildVerifiedPermissionDecisionControl(),
      });
      const submitPermissionDecision = vi
        .fn()
        .mockResolvedValue({ outcome: 'delivered', callbackType: `${kind}_decision` });
      const admitTaskMonitorPermissionDecision = vi.fn();
      const router = createTestRouter({
        verifier,
        resolveConversationRun: () => ({
          runId: 'binding-run',
          conversationId: 'c0000000-0000-4000-8000-000000000001',
        }),
        sendMessage: vi.fn(),
        createRun: vi.fn(),
        stopRun: vi.fn().mockResolvedValue(undefined),
        compactRun: vi.fn().mockResolvedValue(undefined),
        submitPermissionDecision,
        permissionDecisionOwner: { kind },
        taskMonitorId: '10000000-0000-4000-8000-000000000001',
        admitTaskMonitorPermissionDecision,
        logger: noopLogger(),
      });

      router.handlePlatformEvent(controlFrameEvent);
      await settle();

      expect(submitPermissionDecision).toHaveBeenCalledWith(
        'binding-run',
        expect.objectContaining({ requestId: 'req-1', idempotencyToken: 'idem-1' }),
      );
      expect(admitTaskMonitorPermissionDecision).not.toHaveBeenCalled();
    },
  );

  it('preserves specialized request idempotency input on replay', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedPermissionDecisionControl(),
    });
    const submitPermissionDecision = vi
      .fn()
      .mockResolvedValue({ outcome: 'dropped', reason: 'legacy_review_file_scope_reconciled' });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'binding-run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision,
      permissionDecisionOwner: { kind: 'review_file_scope' },
      taskMonitorId: '10000000-0000-4000-8000-000000000001',
      logger: noopLogger(),
    });

    router.handlePlatformEvent(controlFrameEvent);
    router.handlePlatformEvent(controlFrameEvent);
    await settle();

    expect(submitPermissionDecision).toHaveBeenCalledTimes(2);
    expect(submitPermissionDecision.mock.calls.map((call) => call[1].idempotencyToken)).toEqual([
      'idem-1',
      'idem-1',
    ]);
  });

  it('rejects a settled specialized request without Run or Task Monitor work', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedPermissionDecisionControl(),
    });
    const submitPermissionDecision = vi.fn();
    const admitTaskMonitorPermissionDecision = vi.fn();
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'binding-run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision,
      permissionDecisionOwner: { kind: 'settled_specialized_request' },
      taskMonitorId: '10000000-0000-4000-8000-000000000001',
      admitTaskMonitorPermissionDecision,
      logger,
    });

    router.handlePlatformEvent(controlFrameEvent);
    await settle();

    expect(submitPermissionDecision).not.toHaveBeenCalled();
    expect(admitTaskMonitorPermissionDecision).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.control.permission_decision.specialized_request_settled',
      expect.objectContaining({ runId: 'binding-run', requestId: 'req-1' }),
    ]);
  });

  it('routes a Task Monitor-owned permission decision only through durable admission', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedPermissionDecisionControl(),
    });
    const submitPermissionDecision = vi.fn();
    const admitTaskMonitorPermissionDecision = vi.fn().mockResolvedValue({
      status: 'accepted',
      ingressId: 'permission-decision:idem-1',
      snapshot: { revision: 2 },
      effects: [],
    });
    const auditFilePath = path.join(tmpdir(), `hey-hey-permission-audit-${randomUUID()}.jsonl`);
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'binding-run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision,
      permissionDecisionAuditFilePath: auditFilePath,
      taskMonitorId: '10000000-0000-4000-8000-000000000001',
      admitTaskMonitorPermissionDecision,
      logger,
    });

    router.handlePlatformEvent(controlFrameEvent);
    await settle();

    expect(submitPermissionDecision).not.toHaveBeenCalled();
    expect(admitTaskMonitorPermissionDecision).toHaveBeenCalledTimes(1);
    expect(admitTaskMonitorPermissionDecision).toHaveBeenCalledWith({
      taskMonitorId: '10000000-0000-4000-8000-000000000001',
      runId: 'binding-run',
      providerActionId: 'req-1',
      providerSessionId: 'sess-1',
      decision: 'approve',
      decidedAt: '1970-01-01T00:00:00.000Z',
      userId: 'u-1',
      authenticatedAt: '1970-01-01T00:00:00.000Z',
      ingressId: 'permission-decision:idem-1',
    });
    await expect(readFile(auditFilePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(logger.infoCalls).toContainEqual([
      'trigger-verification.control.permission_decision.task_monitor_admission',
      expect.objectContaining({
        runId: 'binding-run',
        taskMonitorId: '10000000-0000-4000-8000-000000000001',
        requestId: 'req-1',
      }),
    ]);
  });

  it('restores ownership before routing a persisted Task Monitor decision to durable admission', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedPermissionDecisionControl(),
    });
    const submitPermissionDecision = vi.fn();
    const restoreRun = vi.fn().mockResolvedValue({
      taskMonitorId: '10000000-0000-4000-8000-000000000001',
    });
    const admitTaskMonitorPermissionDecision = vi.fn().mockResolvedValue({
      status: 'accepted',
      ingressId: 'permission-decision:idem-1',
      snapshot: { revision: 2 },
      effects: [],
    });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'binding-run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision,
      restoreRun,
      admitTaskMonitorPermissionDecision,
      logger: noopLogger(),
    });

    router.handlePlatformEvent(controlFrameEvent);
    await settle();

    expect(restoreRun).toHaveBeenCalledWith('binding-run');
    expect(admitTaskMonitorPermissionDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        taskMonitorId: '10000000-0000-4000-8000-000000000001',
        runId: 'binding-run',
        providerActionId: 'req-1',
      }),
    );
    expect(submitPermissionDecision).not.toHaveBeenCalled();
  });

  it('routes a verified permission_decision into submitPermissionDecision with the binding runId and records the delivered outcome', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedPermissionDecisionControl(),
    });
    const submitPermissionDecision = vi
      .fn()
      .mockResolvedValue({ outcome: 'delivered', callbackType: 'claude_control_response' });
    const auditFilePath = path.join(tmpdir(), `hey-hey-permission-audit-${randomUUID()}.jsonl`);
    const binding: ConversationRunBinding = {
      runId: 'binding-run',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    };
    const restoreRun = vi.fn().mockResolvedValue({ taskMonitorId: null });
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => binding,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision,
      restoreRun,
      permissionDecisionAuditFilePath: auditFilePath,
      logger,
    });

    router.handlePlatformEvent(controlFrameEvent);
    await settle();

    expect(submitPermissionDecision).toHaveBeenCalledTimes(1);
    expect(restoreRun).toHaveBeenCalledWith('binding-run');
    const [runId, input] = submitPermissionDecision.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(runId).toBe('binding-run');
    expect(input).toEqual({
      runId: 'binding-run',
      sessionId: 'sess-1',
      requestId: 'req-1',
      agentType: 'claude',
      decision: 'approve',
      reason: null,
      idempotencyToken: 'idem-1',
      deciderUserId: expect.any(String),
    });
    await vi.waitFor(async () => {
      await expect(readPermissionDecisionAudit(auditFilePath)).resolves.toContainEqual(
        expect.objectContaining({
          requestId: 'req-1',
          runId: 'binding-run',
          decision: 'approve',
          outcome: 'delivered',
        }),
      );
    });
    await unlink(auditFilePath);
  });

  it('restores the durable Run before submitting a permission decision', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedPermissionDecisionControl(),
    });
    const restore = vi.fn().mockResolvedValue(undefined);
    const submitPermissionDecision = vi
      .fn()
      .mockResolvedValue({ outcome: 'dropped', reason: 'stale_permission_recovered' });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: 'persisted-run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision,
      runRestoreCoordinator: { restore } as unknown as RunReadRestoreCoordinator,
      logger: noopLogger(),
    });

    router.handlePlatformEvent(controlFrameEvent);
    await settle();

    expect(restore).toHaveBeenCalledWith('persisted-run');
    expect(submitPermissionDecision).toHaveBeenCalledWith(
      'persisted-run',
      expect.objectContaining({ requestId: 'req-1' }),
    );
    expect(restore.mock.invocationCallOrder[0]).toBeLessThan(
      submitPermissionDecision.mock.invocationCallOrder[0]!,
    );
  });

  it('drops a verified permission_decision as a clean no-op when no active run owns the conversation', async () => {
    const verifier = buildVerifier({
      ok: true,
      verified: buildVerifiedPermissionDecisionControl(),
    });
    const submitPermissionDecision = vi.fn();
    const auditFilePath = path.join(tmpdir(), `hey-hey-permission-audit-${randomUUID()}.jsonl`);
    const logger = noopLogger();
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => null,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision,
      permissionDecisionAuditFilePath: auditFilePath,
      logger,
    });

    router.handlePlatformEvent(controlFrameEvent);
    await settle();

    expect(submitPermissionDecision).not.toHaveBeenCalled();
    await expect(readFile(auditFilePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.control.no_active_run',
      expect.objectContaining({
        kind: 'permission_decision',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        requestId: 'req-1',
      }),
    ]);
  });

  it.each(['dropped', 'failed'] as const)(
    'records a %s outcome to the audit sink, warns, and never throws',
    async (outcome) => {
      const verifier = buildVerifier({
        ok: true,
        verified: buildVerifiedPermissionDecisionControl(),
      });
      const submitPermissionDecision = vi
        .fn()
        .mockResolvedValue({ outcome, reason: 'no_runner_bound' });
      const auditFilePath = path.join(tmpdir(), `hey-hey-permission-audit-${randomUUID()}.jsonl`);
      const binding: ConversationRunBinding = {
        runId: 'binding-run',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      };
      const logger = noopLogger();
      const router = createTestRouter({
        verifier,
        resolveConversationRun: () => binding,
        sendMessage: vi.fn(),
        createRun: vi.fn(),
        stopRun: vi.fn().mockResolvedValue(undefined),
        compactRun: vi.fn().mockResolvedValue(undefined),
        submitPermissionDecision,
        permissionDecisionAuditFilePath: auditFilePath,
        logger,
      });

      expect(() => router.handlePlatformEvent(controlFrameEvent)).not.toThrow();
      await settle();

      await vi.waitFor(async () => {
        await expect(readPermissionDecisionAudit(auditFilePath)).resolves.toContainEqual(
          expect.objectContaining({
            requestId: 'req-1',
            runId: 'binding-run',
            decision: 'approve',
            outcome,
          }),
        );
      });
      await unlink(auditFilePath);
      expect(logger.warnCalls).toContainEqual([
        'trigger-verification.control.permission_decision.not_delivered',
        expect.objectContaining({ runId: 'binding-run', requestId: 'req-1', outcome }),
      ]);
    },
  );
});

describe('TriggerFrameRouter trigger.control question_answer', () => {
  const controlFrameEvent: PlatformWebSocketEvent = {
    type: 'trigger.control',
    timestamp: '2026-01-01T00:00:00Z',
    organizationId: 'org-1',
    conversationId: 'c0000000-0000-4000-8000-000000000001',
    envelope: {},
  };

  const settleQuestion = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const buildVerifiedQuestionAnswerControl = (): VerifiedTriggerFrame => {
    const event = {
      kind: 'question_answer',
      requestId: 'claude_question_1',
      sessionId: 'sess-1',
      agentType: 'claude',
      answers: { 'Which colour?': 'Teal' },
      idempotencyToken: 'idem-q-1',
    };
    return {
      kind: 'trigger.control',
      frame: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      envelope: {
        machineId: 'm-1',
        userId: 'u-1',
        nonce: 'n-question',
        timestampMs: 0,
        signature: 'sig',
        event,
      } as never,
      body: event as never,
    };
  };

  const buildRouter = (overrides: {
    submitQuestionAnswer: RunRegistry['submitQuestionAnswer'];
    resolveConversationRun?: () => ConversationRunBinding | null;
    restore?: RunReadRestoreCoordinator['restore'];
    logger: ServerLogger;
  }): TriggerFrameRouter =>
    createTestRouter({
      verifier: buildVerifier({ ok: true, verified: buildVerifiedQuestionAnswerControl() }),
      resolveConversationRun:
        overrides.resolveConversationRun ??
        (() => ({
          runId: 'binding-run',
          conversationId: 'c0000000-0000-4000-8000-000000000001',
        })),
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      submitQuestionAnswer: overrides.submitQuestionAnswer,
      runRestoreCoordinator: {
        restore: overrides.restore ?? vi.fn().mockResolvedValue({ taskMonitorId: null }),
      } as unknown as RunReadRestoreCoordinator,
      logger: overrides.logger,
    });

  it('routes a verified question_answer to the Run holding the waiting question', async () => {
    const submitQuestionAnswer = vi.fn().mockReturnValue({ outcome: 'delivered' });
    const router = buildRouter({ submitQuestionAnswer, logger: noopLogger() });

    router.handlePlatformEvent(controlFrameEvent);
    await settleQuestion();

    expect(submitQuestionAnswer).toHaveBeenCalledOnce();
    expect(submitQuestionAnswer).toHaveBeenCalledWith('binding-run', {
      requestId: 'claude_question_1',
      idempotencyToken: 'idem-q-1',
      answers: { 'Which colour?': 'Teal' },
    });
  });

  it('restores the durable Run before submitting the answer', async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    const submitQuestionAnswer = vi.fn().mockReturnValue({ outcome: 'delivered' });
    const router = buildRouter({ submitQuestionAnswer, restore, logger: noopLogger() });

    router.handlePlatformEvent(controlFrameEvent);
    await settleQuestion();

    expect(restore).toHaveBeenCalledWith('binding-run');
    expect(restore.mock.invocationCallOrder[0]).toBeLessThan(
      submitQuestionAnswer.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    [{ outcome: 'duplicate' }, 'duplicate'],
    [{ outcome: 'stale', reason: 'request_not_found' }, 'stale'],
  ] as const)('logs and drops a %j answer without throwing', async (result, outcome) => {
    const logger = noopLogger();
    const router = buildRouter({
      submitQuestionAnswer: vi.fn().mockReturnValue(result),
      logger,
    });

    expect(() => router.handlePlatformEvent(controlFrameEvent)).not.toThrow();
    await settleQuestion();

    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.control.question_answer.not_delivered',
      expect.objectContaining({
        runId: 'binding-run',
        requestId: 'claude_question_1',
        outcome,
      }),
    ]);
  });

  it('drops the answer as a clean no-op when no run owns the conversation', async () => {
    const submitQuestionAnswer = vi.fn();
    const logger = noopLogger();
    const router = buildRouter({
      submitQuestionAnswer,
      resolveConversationRun: () => null,
      logger,
    });

    router.handlePlatformEvent(controlFrameEvent);
    await settleQuestion();

    expect(submitQuestionAnswer).not.toHaveBeenCalled();
    expect(logger.warnCalls).toContainEqual([
      'trigger-verification.control.no_active_run',
      expect.objectContaining({ kind: 'question_answer', requestId: 'claude_question_1' }),
    ]);
  });
});

// --- Drop surfacing + machine-identity reconciliation ----------------------

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const dropResult = (reason: string): VerifyResult =>
  ({ ok: false, reason, details: {} }) as unknown as VerifyResult;

const buildQueueVerifier = (results: VerifyResult[]): TriggerVerifier => {
  const securedResults = results.map(secureVerifyResult);
  let i = 0;
  const verifier = buildVerifier(securedResults[0]!);
  vi.mocked(verifier.verifyTriggerFrame).mockImplementation(
    () => securedResults[i++] ?? securedResults[securedResults.length - 1]!,
  );
  return verifier;
};

const buildPoster = (): MessagePoster =>
  createTestMessagePoster({ createOutOfBand: vi.fn().mockResolvedValue('msg-1') });

interface SurfacingHarness {
  poster: MessagePoster;
  listMachines: ReturnType<typeof vi.fn>;
  surfacing: TestDropSurfacingDependencies;
}

const buildSurfacing = (
  outcome: ReconcileOutcome = {
    kind: 'needs_repair',
    reason: 'no_candidate',
    candidateCount: 0,
  },
  overrides: { signatureInvalidThreshold?: number } = {},
): SurfacingHarness => {
  const poster = buildPoster();
  const machines =
    outcome.kind === 'reloaded'
      ? [
          {
            machineId: 'machine-stale',
            name: 'machine-stale',
            pairedAt: '2026-01-01T00:00:00Z',
            active: false,
          },
          {
            machineId: outcome.machineId,
            name: outcome.machineId,
            pairedAt: '2026-01-01T00:00:00Z',
            active: false,
          },
        ]
      : [];
  const listMachines = vi.fn().mockResolvedValue({ data: { data: { machines } } });
  const keyPairStore = createTestKeyPairStore();
  vi.spyOn(keyPairStore, 'loadPrivateKey').mockImplementation((machineId) =>
    Promise.resolve(
      outcome.kind === 'reloaded' && machineId === outcome.machineId ? 'private-key' : null,
    ),
  );
  vi.spyOn(keyPairStore, 'loadServerSigningPublicKey').mockImplementation((machineId) =>
    Promise.resolve(
      outcome.kind === 'reloaded' && machineId === outcome.machineId
        ? outcome.serverSigningPublicKeyB64
        : null,
    ),
  );
  vi.spyOn(keyPairStore, 'setCurrentMachineId').mockResolvedValue(undefined);
  const surfacing: TestDropSurfacingDependencies = {
    poster,
    machinesApi: { listMachines } as unknown as ApiRuntime['clients']['machines'],
    keyPairStore,
    initialMachineId: 'machine-stale',
    ...overrides,
  };
  return { poster, listMachines, surfacing };
};

const dropEvent = (
  conversationId = 'c0000000-0000-4000-8000-000000000001',
): PlatformWebSocketEvent => ({
  type: 'trigger.conversation',
  timestamp: '2026-01-01T00:00:00Z',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId,
  envelope: {},
});

const buildSurfacingRouter = (
  verifier: TriggerVerifier,
  surfacing: TestDropSurfacingDependencies,
): ReturnType<typeof createTestRouter> =>
  createTestRouter({
    verifier,
    resolveConversationRun: () => ({
      runId: 'run-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    createRun: vi.fn(),
    stopRun: vi.fn().mockResolvedValue(undefined),
    compactRun: vi.fn().mockResolvedValue(undefined),
    submitPermissionDecision: noopSubmitPermissionDecision(),
    dropSurfacing: surfacing,
    logger: noopLogger(),
  });

describe('TriggerFrameRouter — owned drop recovery surface', () => {
  it('reconciles on machine_id_mismatch, reloads the verifier, and posts a recovery notice', async () => {
    const verifier = buildQueueVerifier([dropResult('machine_id_mismatch')]);
    const { surfacing, listMachines, poster } = buildSurfacing({
      kind: 'reloaded',
      machineId: 'machine-new',
      serverSigningPublicKeyB64: Buffer.from('srv-new').toString('base64'),
    });
    const router = buildSurfacingRouter(verifier, surfacing);

    router.handlePlatformEvent(dropEvent());
    await flush();

    expect(listMachines).toHaveBeenCalledTimes(1);
    expect(verifier.reload).toHaveBeenCalledTimes(1);
    expect(verifier.reload).toHaveBeenCalledWith(
      expect.objectContaining({ expectedMachineId: 'machine-new' }),
    );
    expect(poster.createOutOfBand as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('posts the actionable re-pair error when reconcile returns needs_repair', async () => {
    const verifier = buildQueueVerifier([dropResult('machine_id_mismatch')]);
    const { surfacing, poster } = buildSurfacing();
    const router = buildSurfacingRouter(verifier, surfacing);

    router.handlePlatformEvent(dropEvent());
    await flush();

    expect(verifier.reload).not.toHaveBeenCalled();
    const createOutOfBand = poster.createOutOfBand as ReturnType<typeof vi.fn>;
    expect(createOutOfBand).toHaveBeenCalledTimes(1);
    const postedData = createOutOfBand.mock.calls[0]![0].dto.data as { title: string };
    expect(postedData.title).toMatch(/re-paired/i);
  });

  it('reconciles after N consecutive signature_invalid drops, whichever conversations they name', async () => {
    const verifier = buildQueueVerifier([
      dropResult('signature_invalid'),
      dropResult('signature_invalid'),
      dropResult('signature_invalid'),
    ]);
    const { surfacing, listMachines } = buildSurfacing();
    const router = buildSurfacingRouter(verifier, surfacing);

    router.handlePlatformEvent(dropEvent('c0000000-0000-4000-8000-000000000001'));
    await flush();
    router.handlePlatformEvent(dropEvent('c0000000-0000-4000-8000-000000000002'));
    await flush();
    expect(listMachines).not.toHaveBeenCalled();

    router.handlePlatformEvent(dropEvent('c0000000-0000-4000-8000-000000000003'));
    await flush();
    expect(listMachines).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'needs_repair',
      { kind: 'needs_repair', reason: 'no_candidate', candidateCount: 0 } as ReconcileOutcome,
    ],
    [
      'reloaded',
      {
        kind: 'reloaded',
        machineId: 'machine-new',
        serverSigningPublicKeyB64: Buffer.from('srv-new').toString('base64'),
      } as ReconcileOutcome,
    ],
  ])(
    'never posts into the conversation an unverified frame names (%s)',
    async (_label, outcome) => {
      const verifier = buildQueueVerifier([
        dropResult('signature_invalid'),
        dropResult('signature_invalid'),
        dropResult('signature_invalid'),
      ]);
      const { surfacing, listMachines, poster } = buildSurfacing(outcome);
      const router = buildSurfacingRouter(verifier, surfacing);

      for (let i = 0; i < 3; i += 1) {
        router.handlePlatformEvent(dropEvent('c0000000-0000-4000-8000-0000000000aa'));
        await flush();
      }

      expect(listMachines).toHaveBeenCalledTimes(1);
      expect(poster.createOutOfBand as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    },
  );

  it('posts exactly one message per conversation per unresolved reason', async () => {
    const verifier = buildQueueVerifier([
      dropResult('machine_id_mismatch'),
      dropResult('machine_id_mismatch'),
    ]);
    const { surfacing, poster } = buildSurfacing();
    const router = buildSurfacingRouter(verifier, surfacing);

    router.handlePlatformEvent(dropEvent());
    await flush();
    router.handlePlatformEvent(dropEvent());
    await flush();

    expect(poster.createOutOfBand as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('resets the signature_invalid counter after a successful dispatch', async () => {
    // threshold 2: one drop, then a success (reset), then one drop → still
    // below threshold, so no reconcile.
    const verifier = buildQueueVerifier([
      dropResult('signature_invalid'),
      { ok: true, verified: buildVerifiedConversation({ triggerMessageId: 't-ok' }) },
      dropResult('signature_invalid'),
    ]);
    const { surfacing, listMachines } = buildSurfacing(undefined, {
      signatureInvalidThreshold: 2,
    });
    const router = buildSurfacingRouter(verifier, surfacing);

    router.handlePlatformEvent(dropEvent());
    await flush();
    router.handlePlatformEvent(dropEvent());
    await flush();
    router.handlePlatformEvent(dropEvent());
    await flush();

    expect(listMachines).not.toHaveBeenCalled();
  });

  it('surfaces timestamp_window directly without attempting reconcile', async () => {
    const verifier = buildQueueVerifier([dropResult('timestamp_window')]);
    const { surfacing, listMachines, poster } = buildSurfacing();
    const router = buildSurfacingRouter(verifier, surfacing);

    router.handlePlatformEvent(dropEvent());
    await flush();

    expect(listMachines).not.toHaveBeenCalled();
    expect(poster.createOutOfBand as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});

// Directly pins the envelope → run-context service mapping. The producer
// (`StartRunPromptPayload`) and the run-context contract (`LocalPendingRunContext`)
// are both multi-service (`serviceIds[]` + `launchServiceId`); `toCreateRunRequest`
// must forward both. The regression this guards: the envelope zod schema had drifted
// to a scalar `serviceId` that zod silently stripped, so the run was created with
// `services: []`, no resolvable repo path, and a 422 from the diff endpoint.
describe('toCreateRunRequest — service field mapping', () => {
  const CONTEXT_METADATA = {
    organizationId: 'org-1',
    projectId: 'proj-1',
    capturedAt: new Date('2026-06-20T00:00:00.000Z').toISOString(),
    agentSessionId: 'sess-abc',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  };

  const basePayload = {
    attachments: [],
    handlerPromptType: 'daily_session',
    payload: { promptType: 'daily_session', payloadVersion: 1, userMessage: 'go' },
    model: 'claude-opus-4-7',
    provider: 'claude',
    contextMetadata: CONTEXT_METADATA,
    agentSessionId: 'sess-abc',
  } as unknown as StartRunTriggerPayload;

  it('forwards envelope serviceIds + launchServiceId into the run context and emits no scalar serviceId', () => {
    const payload = {
      ...basePayload,
      serviceIds: ['svc-1', 'svc-2'],
      launchServiceId: 'svc-2',
    } as StartRunTriggerPayload;

    const request = toCreateRunRequest(payload, 'c0000000-0000-4000-8000-000000000001');

    expect(request.context).toEqual({
      projectId: 'proj-1',
      serviceIds: ['svc-1', 'svc-2'],
      launchServiceId: 'svc-2',
      provider: 'claude',
    });
    expect(request.context).not.toHaveProperty('serviceId');
  });

  it.each([
    LocalPromptType.EntityConversation,
    LocalPromptType.FeatureTreeConversation,
    LocalPromptType.AgentSearch,
  ])(
    'retains project and provider context without Service identity for graph-only %s envelopes',
    (promptType) => {
      const request = toCreateRunRequest(
        {
          attachments: [],
          ...basePayload,
          handlerPromptType: promptType,
          payload: { promptType, userMessage: 'inspect the graph' },
        } as StartRunTriggerPayload,
        'c0000000-0000-4000-8000-000000000001',
      );

      expect(request.context).toEqual({ projectId: 'proj-1', provider: 'claude' });
      expect(request.context).not.toHaveProperty('serviceId');
      expect(request.context).not.toHaveProperty('serviceIds');
      expect(request.context).not.toHaveProperty('launchServiceId');
    },
  );

  it('forwards typed AgentSession config without copying it into run context', () => {
    const config = {
      type: 'CODING_SESSION',
      version: 'v2',
      model: 'claude-opus-4-7',
      projectAssistant: {
        enabled: true,
        allowEdgeUpdates: true,
      },
    };
    const request = toCreateRunRequest(
      { ...basePayload, config } as StartRunTriggerPayload,
      'c0000000-0000-4000-8000-000000000001',
    );

    expect(request.config).toEqual(config);
    expect(request.context).not.toHaveProperty('config');
  });

  it('forwards explicit initial-turn suppression to local run creation', () => {
    const request = toCreateRunRequest(
      { ...basePayload, triggersAgent: false } as StartRunTriggerPayload,
      'c0000000-0000-4000-8000-000000000001',
    );

    expect(request.triggersAgent).toBe(false);
  });
});

describe('admission disposition in the acknowledgement', () => {
  const ids = {
    organizationId: '0a000000-0000-4000-8000-00000000000a',
    projectId: '0b000000-0000-4000-8000-00000000000b',
    runId: '0c000000-0000-4000-8000-00000000000c',
    machineId: '0d000000-0000-4000-8000-00000000000d',
    userId: '0e000000-0000-4000-8000-00000000000e',
    conversationId: '0f000000-0000-4000-8000-00000000000f',
  };
  const followUp = (index: number): VerifiedTriggerFrame => {
    const body = {
      operationId: randomUUID(),
      operationFingerprint: String(index).repeat(64),
      promptType: 'user_message',
      triggerMessageId: randomUUID(),
      sourceUserMessageId: randomUUID(),
      admittedServiceScope: TEST_ADMITTED_SERVICE_SCOPE,
      payload: {
        handlerPromptType: 'coding_freeform',
        userMessage: `message ${index}`,
        attachments: [],
      },
    };
    return {
      kind: 'trigger.conversation',
      frame: {
        organizationId: ids.organizationId,
        projectId: ids.projectId,
        conversationId: ids.conversationId,
      },
      envelope: {
        machineId: ids.machineId,
        userId: ids.userId,
        nonce: randomUUID(),
        timestampMs: 0,
        signature: 'sig',
        event: body as never,
      },
      body: body as never,
    };
  };
  /**
   * Routes frames through the real admission lifecycle and owner. Without a machine credential
   * the lifecycle never delivers, so each acknowledgement reflects only the admission decision.
   */
  const setup = async (runCanAccept: () => boolean) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dispatch-disposition-'));
    const owner = new InputAdmissionOwner(
      {
        directory: path.join(directory, 'inputs'),
        legacyStoreFile: path.join(directory, 'inputs.json'),
      },
      NOOP_LOGGER,
    );
    const lifecycle = new InputAdmissionLifecycle(
      owner,
      { sendSystemMessage: vi.fn() } as never,
      { get: () => null, canAcceptDurableInput: runCanAccept } as never,
      {
        loadCurrentMachineId: async () => ids.machineId,
        loadMachineCredential: async () => null,
      } as never,
      'http://localhost',
      NOOP_LOGGER,
      () => true,
      {} as never,
    );
    await lifecycle.start();
    const frames = [followUp(1)];
    const verifier = buildVerifier({ ok: true, verified: frames[0]! });
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({ runId: ids.runId, conversationId: ids.conversationId }),
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun: vi.fn().mockResolvedValue(undefined),
      compactRun: vi.fn().mockResolvedValue(undefined),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      inputAdmission: lifecycle,
      logger: noopLogger(),
    });
    const deliver = (frame: VerifiedTriggerFrame) => {
      vi.mocked(verifier.verifyTriggerFrame).mockReturnValueOnce(
        secureVerifyResult({ ok: true, verified: frame }),
      );
      return router.handlePlatformEvent(conversationFrameEvent);
    };
    const expected = (
      frame: VerifiedTriggerFrame,
      replayed: boolean,
      inputDisposition: 'IMMEDIATE' | 'QUEUED',
    ): AgentOperationDispatchAcknowledgement => {
      const body = frame.body as { operationId: string; operationFingerprint: string };
      return {
        status: 'ACCEPTED',
        operationId: body.operationId,
        operationFingerprint: body.operationFingerprint,
        replayed,
        inputDisposition,
      };
    };
    const cleanup = async () => {
      lifecycle.dispose();
      await rm(directory, { recursive: true, force: true });
    };
    return { owner, deliver, expected, cleanup };
  };

  it('acknowledges an idle, unblocked Run as immediate and reserves without starting', async () => {
    const { owner, deliver, expected, cleanup } = await setup(() => true);
    try {
      const frame = followUp(1);
      expect(await deliver(frame)).toEqual(expected(frame, false, 'IMMEDIATE'));
      const [record] = await owner.session(ids.runId);
      expect(record).toMatchObject({ state: 'picked', admissionDisposition: 'immediate' });
      expect(record!.turnId).not.toBeNull();
      expect(record!.projectedRevision).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('acknowledges a held Run as queued', async () => {
    const { owner, deliver, expected, cleanup } = await setup(() => false);
    try {
      const frame = followUp(1);
      expect(await deliver(frame)).toEqual(expected(frame, false, 'QUEUED'));
      expect((await owner.session(ids.runId))[0]).toMatchObject({
        state: 'queued',
        admissionDisposition: 'queued',
      });
    } finally {
      await cleanup();
    }
  });

  it('reserves the slot for the first of two rapid submissions and replays recorded dispositions', async () => {
    let runCanAccept = true;
    const { deliver, expected, cleanup } = await setup(() => runCanAccept);
    try {
      const first = followUp(1);
      const second = followUp(2);
      const [firstAck, secondAck] = await Promise.all([deliver(first), deliver(second)]);
      expect(firstAck).toEqual(expected(first, false, 'IMMEDIATE'));
      expect(secondAck).toEqual(expected(second, false, 'QUEUED'));
      // A duplicate delivery returns what admission recorded, even after the Run's state moved.
      runCanAccept = false;
      expect(await deliver(first)).toEqual(expected(first, true, 'IMMEDIATE'));
      runCanAccept = true;
      expect(await deliver(second)).toEqual(expected(second, true, 'QUEUED'));
    } finally {
      await cleanup();
    }
  });
});

describe('verified cancellation telemetry', () => {
  it('verifies and processes an hour of retries, preserving every rejection and distinct control', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    const record: ReadableInputRecord = {
      key: randomUUID(),
      messageId: randomUUID(),
      agentSessionId: randomUUID(),
      runId: randomUUID(),
      admissionId: randomUUID(),
      organizationId: randomUUID(),
      projectId: randomUUID(),
      userId: randomUUID(),
      machineId: randomUUID(),
      fingerprint: 'never-log-this',
      state: 'cancelled',
      admissionDisposition: 'queued',
      revision: 2,
      projectedRevision: 0,
      sequence: 0,
      kind: null,
      keyKind: 'operation',
      payload: null,
      turnId: null,
      settlement: null,
      settlementDelivered: false,
    };
    const body = {
      kind: 'cancel_input' as const,
      conversationId: 'c0000000-0000-4000-8000-000000000001',
      operationId: record.key,
      messageId: record.messageId!,
      agentSessionId: record.agentSessionId,
      operationFingerprint: record.fingerprint,
    };
    const verified: VerifiedTriggerFrame = {
      kind: 'trigger.control',
      frame: {
        organizationId: record.organizationId,
        projectId: record.projectId,
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      },
      body,
      envelope: {
        protocolVersion: 2,
        event: body,
        timestampMs: 0,
        nonce: 'nonce',
        machineId: record.machineId,
        userId: record.userId,
        signature: 'signature',
      } as never,
    };
    const verifier = buildVerifier({ ok: true, verified });
    const owner = new InputAdmissionOwner(
      {
        directory: path.join(tmpdir(), randomUUID()),
        legacyStoreFile: path.join(tmpdir(), randomUUID()),
      },
      NOOP_LOGGER,
    );
    const inputAdmission = new InputAdmissionLifecycle(
      owner,
      {} as never,
      {} as never,
      {} as never,
      'http://localhost',
      NOOP_LOGGER,
      () => false,
      {} as never,
    );
    const cancel = vi.spyOn(owner, 'cancel').mockResolvedValue(record);
    const advance = vi.spyOn(inputAdmission, 'advance').mockResolvedValue(undefined);
    const reductionAdmission = vi
      .fn()
      .mockResolvedValue({ admitted: true, capability: TEST_ADMITTED_HOST_ACTION });
    const logger = noopLogger();
    const stopRun = vi.fn().mockResolvedValue(undefined);
    const router = createTestRouter({
      verifier,
      resolveConversationRun: () => ({
        runId: record.runId,
        conversationId: 'c0000000-0000-4000-8000-000000000001',
      }),
      inputAdmission,
      sendMessage: vi.fn(),
      createRun: vi.fn(),
      stopRun,
      compactRun: vi.fn(),
      submitPermissionDecision: noopSubmitPermissionDecision(),
      logger,
      hostActionAdmission: { admitReduction: reductionAdmission } as unknown as HostActionAdmission,
    });
    const event: PlatformWebSocketEvent = {
      type: 'trigger.control_reduction',
      timestamp: new Date().toISOString(),
      organizationId: record.organizationId,
    };
    try {
      for (let tick = 0; tick < 1_800; tick += 1) {
        vi.advanceTimersByTime(2_000);
        await router.handlePlatformEvent(event, { transportAckAvailable: false });
      }
      router.controlTelemetry.flush('snapshot');
      expect(verifier.verifyTriggerFrame).toHaveBeenCalledTimes(1_800);
      expect(reductionAdmission).toHaveBeenCalledTimes(1_800);
      expect(cancel).toHaveBeenCalledTimes(1_800);
      expect(advance).toHaveBeenCalledTimes(1_800);
      const repeats = logger.infoCalls.filter(([name]) => name === 'control_reduction.repeated');
      expect(repeats.reduce((sum, [, fields]) => sum + Number(fields['repetitionCount']), 0)).toBe(
        1_799,
      );
      expect(
        logger.infoCalls.filter(([name]) => name === 'control_reduction.outcome'),
      ).toHaveLength(1);
      vi.mocked(verifier.verifyTriggerFrame).mockReturnValueOnce({
        ok: false,
        reason: 'signature_invalid',
        details: {},
      });
      await router.handlePlatformEvent(event);
      expect(cancel).toHaveBeenCalledTimes(1_800);
      expect(logger.warnCalls.some(([name]) => name === 'trigger-verification.frame.dropped')).toBe(
        true,
      );
      cancel.mockRejectedValueOnce(new InputAdmissionIdentityError());
      expect(await router.handlePlatformEvent(event)).toMatchObject({
        status: 'REJECTED',
        reason: 'OPERATION_FINGERPRINT_MISMATCH',
      });
      expect(logger.warnCalls.filter(([name]) => name === 'control_reduction.failed')).toHaveLength(
        1,
      );
      const next = { ...record, key: randomUUID(), messageId: randomUUID() };
      cancel.mockResolvedValueOnce(next);
      await router.handlePlatformEvent(event);
      expect(
        logger.infoCalls.filter(([name]) => name === 'control_reduction.outcome'),
      ).toHaveLength(2);
      const stopped = {
        kind: 'stop_run' as const,
        conversationId: 'c0000000-0000-4000-8000-000000000001',
        runId: record.runId,
      };
      vi.mocked(verifier.verifyTriggerFrame).mockReturnValue({
        ok: true,
        verified: {
          ...verified,
          kind: 'trigger.control',
          body: stopped,
          envelope: { ...verified.envelope, event: stopped } as never,
        },
      });
      await router.handlePlatformEvent(event);
      await router.handlePlatformEvent(event);
      expect(stopRun).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(logger.infoCalls)).not.toContain(record.fingerprint);
    } finally {
      router.dispose();
      await inputAdmission.dispose();
      vi.useRealTimers();
    }
  });
});
