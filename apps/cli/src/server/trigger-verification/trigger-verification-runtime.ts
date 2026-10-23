import type { DiagnosticFeed } from '../diagnostic-feed';
import type { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import path from 'node:path';
import type { ApiRuntime } from '../../../../../packages/ui-common/src/clients/shared';
import type { KeyPairStore } from '../../credentials';
import type { ControllerRegistryStore } from '../../credentials';
import type { MessagePoster } from '../../run/message-poster';
import type { RunRegistry } from '../../run/run-registry';
import type { RunStore } from '../../run-store';
import { resolveBaseDir } from '../../session/paths';
import type { LocalAgentService } from '../local-agent-service';
import type { ServerLogger } from '../logger';
import type { MonitorProjectContext } from '../monitors/project-context';
import type { PlatformDeliveryContext, PlatformWebSocketEvent } from '../platform-ws';
import type { MonitorCommandAcknowledgement } from '../../shared/agent-bridge-contract/generated/api';
import type {
  AgentOperationDispatchAcknowledgement,
  AuthorityReductionAcknowledgement,
} from '../../shared/api/generated/api';
import type { MachineControllerAuthority } from '../../auth/machine-controller-authority';
import { TaskMonitorStateMachineInputAdapter } from '../state-machine-input-adapter';
import { extractUserIdFromToken } from '../../auth';
import type { HostActionAdmission } from '../controller-authorization/host-action-admission';
import type { OperationTimelineRegistry } from '../input-admission/operation-timeline';
import type { RunReadRestoreCoordinator } from '../restore-persisted-runs';
import { TriggerFrameRouter } from './dispatch';
import {
  TriggerVerifier,
  type VerifyCliReadResult,
  type VerifiedCliSettingsFrame,
  type VerificationDropReason,
} from './verify';

export interface TriggerVerificationRuntimeDependencies {
  keyPairStore: KeyPairStore;
  initialAccessToken: string;
  machinesApi: ApiRuntime['clients']['machines'];
  runStore: RunStore;
  agentService: LocalAgentService;
  promptTypeRegistry: PromptTypeRegistry;
  runRegistry: RunRegistry;
  runRestoreCoordinator: RunReadRestoreCoordinator;
  poster: MessagePoster;
  projectContext: MonitorProjectContext;
  taskMonitorStateMachineInputAdapter: TaskMonitorStateMachineInputAdapter;
  logger: ServerLogger;
  /** Activated machine/controller registry used for protocol-2 identity. */
  controllerRegistryStore?: ControllerRegistryStore;
  hostActionAdmission?: HostActionAdmission;
  machineControllerAuthority?: Pick<MachineControllerAuthority, 'applyVerifiedAuthorityReduction'>;
  operationTimeline?: OperationTimelineRegistry;
  diagnosticFeed?: DiagnosticFeed;
}

/** Owns trigger verification state and the enabled/disabled routing decision. */
export class TriggerVerificationRuntime {
  private router: TriggerFrameRouter | null = null;
  private verifier: TriggerVerifier | null = null;
  private initialization: Promise<void> | null = null;

  public constructor(private readonly dependencies: TriggerVerificationRuntimeDependencies) {}

  public initialize(): Promise<void> {
    return (this.initialization ??= this.initializeOnce());
  }

  public handlePlatformEvent(
    event: PlatformWebSocketEvent,
    context?: PlatformDeliveryContext,
  ): Promise<AgentOperationDispatchAcknowledgement | void> {
    return this.router?.handlePlatformEvent(event, context) ?? Promise.resolve();
  }

  public dispose(): void {
    this.router?.dispose();
  }

  public verifyCliReadFrame(rawFrame: unknown): VerifyCliReadResult | null {
    return this.verifier?.verifyCliReadFrame(rawFrame) ?? null;
  }

  public verifyCliSettingsFrame(
    rawFrame: unknown,
  ):
    | { ok: true; verified: VerifiedCliSettingsFrame }
    | { ok: false; reason: VerificationDropReason; details: Record<string, unknown> }
    | null {
    return this.verifier?.verifyCliSettingsFrame(rawFrame) ?? null;
  }

  public async handleMonitorCommand(
    event: PlatformWebSocketEvent,
  ): Promise<MonitorCommandAcknowledgement> {
    if (!this.router) {
      return {
        status: 'REJECTED',
        stage: 'ADMISSION',
        reason: 'ROUTE_REJECTED',
        message: 'Task Monitor command admission is not ready.',
      };
    }
    return this.router.handleMonitorCommand(event);
  }

  public async handleAuthorityReduction(
    event: PlatformWebSocketEvent,
  ): Promise<AuthorityReductionAcknowledgement> {
    if (!this.router) {
      return { status: 'REJECTED', reason: 'HANDLER_UNAVAILABLE' };
    }
    return this.router.handleAuthorityReduction(event);
  }

  private async initializeOnce(): Promise<void> {
    const {
      agentService,
      promptTypeRegistry,
      operationTimeline,
      initialAccessToken,
      keyPairStore,
      logger,
      machinesApi,
      poster,
      projectContext,
      runRegistry,
      runRestoreCoordinator,
      runStore,
      taskMonitorStateMachineInputAdapter,
      controllerRegistryStore,
      hostActionAdmission,
      machineControllerAuthority,
    } = this.dependencies;
    const machineId = await keyPairStore.loadCurrentMachineId();
    const serverSigningPublicKeyB64 = machineId
      ? await keyPairStore.loadServerSigningPublicKey(machineId)
      : null;
    const registry = controllerRegistryStore ? await controllerRegistryStore.read() : null;
    const activatedBinding = registry?.controllers.find((entry) => entry.machineId === machineId);
    const userId = activatedBinding?.accountId ?? extractUserIdFromToken(initialAccessToken);

    if (
      !machineId ||
      !serverSigningPublicKeyB64 ||
      !userId ||
      (controllerRegistryStore && !activatedBinding)
    ) {
      logger.warn('trigger-verification.disabled', {
        hasMachineId: Boolean(machineId),
        hasServerSigningPublicKey: Boolean(serverSigningPublicKeyB64),
        hasUserId: Boolean(userId),
        hasActivatedController: Boolean(activatedBinding),
        machineId,
      });
      return;
    }

    this.verifier = new TriggerVerifier({
      serverSigningPublicKey: Buffer.from(serverSigningPublicKeyB64, 'base64'),
      expectedMachineId: machineId,
      expectedUserId: userId,
      ...(activatedBinding ? { expectedOrganizationId: activatedBinding.organizationId } : {}),
      requireProtocolVersion2: true,
      logger,
    });
    this.router = new TriggerFrameRouter({
      ...(this.dependencies.diagnosticFeed
        ? { diagnosticFeed: this.dependencies.diagnosticFeed }
        : {}),
      verifier: this.verifier,
      machinesApi,
      keyPairStore,
      runStore,
      agentService,
      promptTypeRegistry,
      runRegistry,
      runRestoreCoordinator,
      permissionDecisionAuditFilePath: path.join(
        resolveBaseDir(),
        'runs',
        'permission-decisions.audit.jsonl',
      ),
      operationReceiptStorePath: path.join(
        resolveBaseDir(),
        'runs',
        'agent-operation-receipts.jsonl',
      ),
      taskMonitorStateMachineInputAdapter,
      ...(operationTimeline ? { operationTimeline } : {}),
      ...(hostActionAdmission ? { hostActionAdmission } : {}),
      ...(machineControllerAuthority ? { machineControllerAuthority } : {}),
      dropSurfacing: {
        poster,
        projectContext,
        initialMachineId: machineId,
      },
      logger,
    });
    logger.info('trigger-verification.enabled', {
      machineId,
      userId,
      serverSigningPublicKeyFingerprint: serverSigningPublicKeyB64.slice(0, 12),
      authorizationProtocolVersion: controllerRegistryStore ? 2 : 1,
    });
  }
}
