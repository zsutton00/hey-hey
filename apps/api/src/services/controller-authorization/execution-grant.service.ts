import { ControllerAuthorizationService } from './controller-authorization.service';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  ControllerAuthorizationCadence as PrismaControllerAuthorizationCadence,
  ExecutionAuthorization,
  ExecutionGrant,
  ExecutionGrantScope as PrismaExecutionGrantScope,
  HostActionTargetKind as PrismaHostActionTargetKind,
  HostAffectingActionType as PrismaHostAffectingActionType,
  Prisma,
} from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  AdmissionEnvelopeAuthorization,
  RuntimeModelCatalogHostActionPreparation,
  WorkspaceSkillsHostActionPreparation,
  CliReadWorkspaceSkillsListRequest,
  AgentSessionHostActionPreparation,
  ConversationHostActionPreparation,
  ControllerAssertionEvidence,
  ControllerAuthorizationCadence,
  ExecutableControllerAssertionEvidence,
  ExecutableEnvelopeAuthorization,
  HostActionCategory,
  HostActionPreparation,
  ControllerActionInputs,
  HostActionTargetKind,
  HostAffectingActionType,
  MonitorCommandBody,
  TaskMonitorExternalCommand,
} from '../../generated';
import { hashControllerAction } from '../../generated/controller-action-contract';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import {
  AgentSessionId,
  ConversationId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import {
  CONTROLLER_DEVICE_POLICY_REVISION,
  CURRENT_AGENT_OPERATIONS,
  getCurrentAgentOperationCategory,
  getControllerDeviceGrantExpiry,
  isCurrentAgentOperation,
  toControllerAuthorizationCadence,
} from './controller-authorization-operations';
import { isRemovedControllerAuthorizationCadence } from './controller-authorization-cadence';
import { ControllerBrowserBindingService } from './controller-browser-binding.service';

const INTERACTIVE_TURN_ALLOWED_ACTIONS = [
  PrismaHostAffectingActionType.CONVERSATION_TRIGGER,
  PrismaHostAffectingActionType.CLI_READ,
  PrismaHostAffectingActionType.APPLICATION_EFFECT_LAUNCH,
  PrismaHostAffectingActionType.CONVERSATION_CONTROL_COMPACT_RUN,
  PrismaHostAffectingActionType.CONVERSATION_CONTROL_PERMISSION_DECISION,
] as const;

const CONTROLLER_DEVICE_ALLOWED_ACTIONS = CURRENT_AGENT_OPERATIONS.map(
  (action) => PrismaHostAffectingActionType[action],
);

const TASK_MONITOR_ACTION: Record<
  Extract<
    TaskMonitorExternalCommand['cause'],
    'START' | 'RESUME' | 'JUDGMENT_RESOLVED' | 'CONTINUE' | 'COMPLETE'
  >,
  HostAffectingActionType
> = {
  START: HostAffectingActionType.TaskMonitorStart,
  RESUME: HostAffectingActionType.TaskMonitorResume,
  JUDGMENT_RESOLVED: HostAffectingActionType.TaskMonitorJudgmentResolved,
  CONTINUE: HostAffectingActionType.TaskMonitorContinue,
  COMPLETE: HostAffectingActionType.TaskMonitorComplete,
};

type AuthorizationWithAuthorityAndGrant = ExecutionAuthorization & {
  grant: ExecutionGrant | null;
  controllerCredential: {
    credentialId: string;
    revokedAt: Date | null;
  };
  machine: {
    revokedAt: Date | null;
    authorizationProtocolVersion: number | null;
    authorizationState: string;
  };
};

const ADMITTED_HOST_ACTION = Symbol('ADMITTED_HOST_ACTION');

export interface InteractiveGrantAdmission {
  readonly [ADMITTED_HOST_ACTION]: true;
  authorizationId: string;
  requestId: string;
  controllerInstallationId: string;
  machineId: MachineId;
  agentSessionId: AgentSessionId;
  action: HostActionPreparation;
  envelopeAuthorization: AdmissionEnvelopeAuthorization;
  existingGrantId?: string;
}

export class ExecutionGrantAdmissionDeniedException extends ForbiddenException {
  constructor(message = 'Exact controller authorization is required') {
    super(message);
  }
}

@Injectable()
export class ExecutionGrantService {
  private readonly logger = new Logger(ExecutionGrantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly browserBindingService: ControllerBrowserBindingService,
    private readonly controllerAuthorizationService: ControllerAuthorizationService,
  ) {}

  async assertInteractiveAuthorized(params: {
    inputs?: ControllerActionInputs;
    authorization: AdmissionEnvelopeAuthorization;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    actionType: HostAffectingActionType;
    targetKind: HostActionTargetKind;
    targetId: string;
    conversationId?: ConversationId;
    agentSessionId?: AgentSessionId;
    machineId?: MachineId;
    controllerInstallationId?: string;
    controllerBindingSecret: string | undefined;
  }): Promise<InteractiveGrantAdmission> {
    const authorization = await this.loadAuthorizationInput(
      params.authorization,
    );
    const isReuse = params.authorization.kind === 'bounded_grant';
    const requestedAction = this.buildNonRevisionedAction({
      requestId: isReuse ? crypto.randomUUID() : authorization.requestId,
      actionCategory: HostActionCategory.Conversation,
      actionType: params.actionType,
      targetKind: params.targetKind,
      targetId: params.targetId,
      ...(params.inputs ? { inputs: params.inputs } : {}),
    });
    const action = params.inputs
      ? await this.controllerAuthorizationService.resolveDirectInputs({
          organizationId: params.organizationId,
          projectId: params.projectId,
          userId: params.userId,
          machineId: authorization.machineId,
          action: requestedAction,
        })
      : requestedAction;
    const controllerInstallationId =
      await this.resolveCurrentControllerInstallation(params);
    if (isReuse) {
      this.assertReusableInteractiveGrant(
        authorization,
        { ...params, controllerInstallationId },
        action.actionType,
      );
    } else {
      this.assertFreshEvidenceMatches(authorization, params.authorization);
      this.assertAuthorizationMatches(
        authorization,
        { ...params, controllerInstallationId },
        action,
      );
    }

    const agentSessionId = await this.resolveInteractiveAgentSession({
      authorization,
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.userId,
      conversationId: params.conversationId ?? params.targetId,
      requestedAgentSessionId: params.agentSessionId,
    });
    this.assertExistingInteractiveGrant(
      authorization.grant,
      authorization,
      agentSessionId,
      params.actionType,
      undefined,
      controllerInstallationId,
    );

    return {
      [ADMITTED_HOST_ACTION]: true,
      authorizationId: authorization.id,
      requestId: authorization.requestId,
      controllerInstallationId: authorization.controllerInstallationId,
      machineId: authorization.machineId as MachineId,
      agentSessionId,
      action,
      envelopeAuthorization: params.authorization,
      ...(authorization.grant
        ? { existingGrantId: authorization.grant.id }
        : {}),
    };
  }

  async assertAgentSessionAuthorized(params: {
    inputs?: ControllerActionInputs;
    authorization: AdmissionEnvelopeAuthorization;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    actionCategory: HostActionCategory;
    actionType: HostAffectingActionType;
    targetKind: typeof HostActionTargetKind.AgentSession;
    agentSessionId: AgentSessionId;
    conversationId: string;
    machineId: MachineId;
    controllerBindingSecret: string | undefined;
  }): Promise<
    Omit<InteractiveGrantAdmission, 'envelopeAuthorization'> & {
      envelopeAuthorization: ExecutableEnvelopeAuthorization;
    }
  > {
    const authorization = await this.loadAuthorizationInput(
      params.authorization,
    );
    const isReuse = params.authorization.kind === 'bounded_grant';
    const action: AgentSessionHostActionPreparation = {
      requestId: isReuse ? crypto.randomUUID() : authorization.requestId,
      actionCategory: params.actionCategory,
      actionType: params.actionType,
      targetKind: 'AGENT_SESSION',
      targetId: params.agentSessionId,
      ...(params.inputs ? { inputs: params.inputs } : {}),
    };
    const controllerInstallationId =
      await this.resolveCurrentControllerInstallation(params);
    if (isReuse) {
      this.assertReusableAgentSessionGrant(authorization, {
        ...params,
        controllerInstallationId,
      });
    } else {
      this.assertFreshEvidenceMatches(authorization, params.authorization);
      this.assertAuthorizationMatches(
        authorization,
        { ...params, controllerInstallationId },
        action,
      );
    }
    const envelopeAuthorization =
      params.authorization.kind === 'bounded_grant'
        ? params.authorization
        : await this.deriveAgentSessionGrant({
            authorization,
            evidence: params.authorization,
            action,
            agentSessionId: params.agentSessionId,
          });
    return {
      [ADMITTED_HOST_ACTION]: true,
      authorizationId: authorization.id,
      requestId: action.requestId,
      controllerInstallationId: authorization.controllerInstallationId,
      machineId: authorization.machineId as MachineId,
      agentSessionId: params.agentSessionId,
      action,
      envelopeAuthorization,
      ...(authorization.grant
        ? { existingGrantId: authorization.grant.id }
        : {}),
    };
  }

  assertDeliveredInputs(
    admission: InteractiveGrantAdmission,
    inputs: ControllerActionInputs,
  ): void {
    if (admission.envelopeAuthorization.kind === 'bounded_grant') return;
    const action = admission.action;
    if (!('inputs' in action)) this.deny();
    const deliveredAction = {
      ...action,
      inputs,
    } satisfies HostActionPreparation;
    if (
      hashControllerAction(deliveredAction) !==
      admission.envelopeAuthorization.intent.actionPayloadHash
    ) {
      this.deny();
    }
  }

  assertWorkspaceSkillsAuthorized(params: {
    authorization: AdmissionEnvelopeAuthorization;
    request: CliReadWorkspaceSkillsListRequest;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    machineId: MachineId;
    controllerBindingSecret: string | undefined;
  }): Promise<{
    action: WorkspaceSkillsHostActionPreparation;
    authorizationId: string;
    envelopeAuthorization: ExecutableEnvelopeAuthorization;
  }> {
    return this.assertMachineCliReadAuthorized(params, {
      provider: params.request.provider,
      catalogContext: params.request.catalogContext,
    });
  }

  assertRuntimeModelCatalogAuthorized(params: {
    authorization: AdmissionEnvelopeAuthorization;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    machineId: MachineId;
    controllerBindingSecret: string | undefined;
  }): Promise<{
    action: RuntimeModelCatalogHostActionPreparation;
    authorizationId: string;
    envelopeAuthorization: ExecutableEnvelopeAuthorization;
  }> {
    return this.assertMachineCliReadAuthorized(params, {});
  }

  private async assertMachineCliReadAuthorized<
    TRead extends Record<string, unknown>,
  >(
    params: {
      authorization: AdmissionEnvelopeAuthorization;
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
      machineId: MachineId;
      controllerBindingSecret: string | undefined;
    },
    read: TRead,
  ): Promise<{
    action: {
      requestId: string;
      actionCategory: 'CLI_READ';
      actionType: 'CLI_READ';
      targetKind: 'CLI_READ';
      targetId: string;
    } & TRead;
    authorizationId: string;
    envelopeAuthorization: ExecutableEnvelopeAuthorization;
  }> {
    const authorization = await this.loadAuthorizationInput(
      params.authorization,
    );
    const controllerInstallationId =
      await this.resolveCurrentControllerInstallation(params);
    const action = {
      requestId:
        params.authorization.kind === 'bounded_grant'
          ? crypto.randomUUID()
          : authorization.requestId,
      actionCategory: 'CLI_READ' as const,
      actionType: 'CLI_READ' as const,
      targetKind: 'CLI_READ' as const,
      targetId: params.machineId,
      ...read,
    };
    if (params.authorization.kind === 'bounded_grant') {
      const grant = this.assertActiveGrantBindings(authorization, {
        ...params,
        controllerInstallationId,
      });
      this.assertControllerWindowAdmitsAction(grant, 'CLI_READ', 'CLI_READ');
      if (grant.scope !== PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW)
        this.deny();
      return {
        action,
        authorizationId: authorization.id,
        envelopeAuthorization: params.authorization,
      };
    }
    this.assertFreshEvidenceMatches(authorization, params.authorization);
    this.assertAuthorizationMatches(
      authorization,
      { ...params, controllerInstallationId },
      action,
    );
    const envelopeAuthorization = await this.deriveAgentSessionGrant({
      authorization,
      evidence: params.authorization,
      action,
      agentSessionId: null,
    });
    this.logger.debug('Machine CLI read authorized', {
      machineId: params.machineId,
      projectId: params.projectId,
    });
    return { action, authorizationId: authorization.id, envelopeAuthorization };
  }

  async deriveInteractiveGrant(params: {
    admission: InteractiveGrantAdmission;
    authorizedTurnId: MessageId;
  }): Promise<{
    grant: ExecutionGrant;
    envelopeAuthorization: ExecutableEnvelopeAuthorization;
  }> {
    return this.prisma.db.$transaction((tx) =>
      this.deriveInteractiveGrantInTransaction(tx, params),
    );
  }

  async deriveInteractiveGrantInTransaction(
    tx: AnyTransactionClient,
    params: {
      admission: InteractiveGrantAdmission;
      authorizedTurnId: MessageId;
    },
  ): Promise<{
    grant: ExecutionGrant;
    envelopeAuthorization: ExecutableEnvelopeAuthorization;
  }> {
    if (params.admission.envelopeAuthorization.kind === 'bounded_grant') {
      const authorization = await this.loadAuthorizationInput(
        params.admission.envelopeAuthorization,
      );
      this.assertReusableInteractiveGrant(
        authorization,
        {
          organizationId: authorization.organizationId as OrganizationId,
          projectId: authorization.projectId as ProjectId,
          userId: authorization.userId as UserId,
          machineId: params.admission.machineId,
          targetId: authorization.targetId,
          controllerInstallationId: params.admission.controllerInstallationId,
        },
        params.admission.action.actionType,
      );
      return {
        grant: authorization.grant!,
        envelopeAuthorization: params.admission.envelopeAuthorization,
      };
    }
    await this.lockAuthorization(tx, params.admission.authorizationId);
    const authorization = await this.loadAuthorization(
      params.admission.authorizationId,
      tx,
    );
    this.assertAuthorizationMatches(
      authorization,
      {
        organizationId: authorization.organizationId as OrganizationId,
        projectId: authorization.projectId as ProjectId,
        userId: authorization.userId as UserId,
        machineId: params.admission.machineId,
        controllerInstallationId: params.admission.controllerInstallationId,
      },
      params.admission.action,
    );
    if (authorization.grant) {
      this.assertExistingInteractiveGrant(
        authorization.grant,
        authorization,
        params.admission.agentSessionId,
        params.admission.action.actionType,
        params.authorizedTurnId,
        params.admission.controllerInstallationId,
      );
      return {
        grant: authorization.grant,
        envelopeAuthorization: this.buildExecutableActivation(
          params.admission.envelopeAuthorization,
          authorization,
          authorization.grant,
        ),
      };
    }

    const grant = await tx.executionGrant.create({
      data: {
        authorizationId: authorization.id,
        scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
        controllerCredentialId: authorization.controllerCredentialId,
        controllerInstallationId: authorization.controllerInstallationId,
        machineId: authorization.machineId,
        userId: authorization.userId,
        organizationId: authorization.organizationId,
        projectId: authorization.projectId,
        cadence: authorization.cadence,
        policyRevision: authorization.policyRevision,
        grantDescriptorHash: authorization.grantDescriptorHash,
        targetKind: authorization.targetKind,
        targetId: authorization.targetId,
        allowedActions: [...CONTROLLER_DEVICE_ALLOWED_ACTIONS],
        agentSessionId: null,
        authorizedTurnId: null,
        issuedAt: authorization.issuedAt,
        expiresAt: this.requireControllerDeviceGrantExpiry(
          authorization.issuedAt,
          this.requireSupportedCadence(authorization.cadence),
        ),
      },
    });
    return {
      grant,
      envelopeAuthorization: this.buildExecutableActivation(
        params.admission.envelopeAuthorization,
        authorization,
        grant,
      ),
    };
  }

  async admitTaskMonitorCommand(params: {
    authorization: AdmissionEnvelopeAuthorization;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    monitorId: TaskId;
    machineId?: MachineId;
    controllerBindingSecret: string | undefined;
    requestId: string;
    command: TaskMonitorExternalCommand;
  }): Promise<{
    grant: ExecutionGrant;
    machineId: MachineId;
    envelopeAuthorization: ExecutableEnvelopeAuthorization;
  }> {
    if (this.isAuthorityReduction(params.command)) {
      throw new ExecutionGrantAdmissionDeniedException(
        'Authority reductions do not consume controller authorization',
      );
    }
    if (
      params.command.cause === 'GUIDANCE_CHANGED' ||
      params.command.cause === 'HUMAN_DECISION'
    ) {
      throw new ExecutionGrantAdmissionDeniedException(
        'Authority-neutral Task Monitor input does not consume controller authorization',
      );
    }
    const actionType = TASK_MONITOR_ACTION[params.command.cause];

    if (params.authorization.kind === 'bounded_grant') {
      const authorization = await this.loadAuthorizationInput(
        params.authorization,
      );
      const controllerInstallationId =
        await this.resolveCurrentControllerInstallation(params);
      const snapshot = await this.resolveTaskMonitorSnapshot(
        this.prisma.db,
        params.organizationId,
        params.projectId,
        params.monitorId,
      );
      this.assertReusableTaskMonitorGrant(
        authorization,
        { ...params, controllerInstallationId },
        actionType,
        snapshot,
      );
      return {
        grant: authorization.grant!,
        machineId: authorization.machineId as MachineId,
        envelopeAuthorization: params.authorization,
      };
    }

    const freshAuthorization = params.authorization;
    const controllerInstallationId =
      await this.resolveCurrentControllerInstallation(params);
    return this.prisma.db.$transaction(async (tx) => {
      const authorizationId = freshAuthorization.intent.authorizationId;
      await this.lockAuthorization(tx, authorizationId);
      const authorization = await this.loadAuthorization(authorizationId, tx);
      this.assertFreshEvidenceMatches(authorization, freshAuthorization);
      const snapshot = await this.resolveTaskMonitorSnapshot(
        tx,
        params.organizationId,
        params.projectId,
        params.monitorId,
      );
      const action: HostActionPreparation = {
        requestId: params.requestId,
        actionCategory: HostActionCategory.TaskMonitor,
        actionType,
        targetKind: 'TASK_MONITOR',
        targetId: params.monitorId,
        inputs: { kind: 'TASK_MONITOR', command: params.command },
      };
      this.assertAuthorizationMatches(
        authorization,
        { ...params, controllerInstallationId },
        action,
      );

      const allowedActions = [...CONTROLLER_DEVICE_ALLOWED_ACTIONS];
      if (authorization.grant) {
        this.assertExistingTaskMonitorGrant(authorization.grant, {
          monitorId: params.monitorId,
          machineId: authorization.machineId,
          controllerInstallationId: authorization.controllerInstallationId,
          cadence: authorization.cadence,
          policyRevision: authorization.policyRevision,
          grantDescriptorHash: authorization.grantDescriptorHash,
          selectionFingerprint: snapshot.selectionFingerprint,
          policyFingerprint: snapshot.policyFingerprint,
          allowedActions,
          reusableWindow: true,
          authorizationIssuedAt: authorization.issuedAt,
        });
        return {
          grant: authorization.grant,
          machineId: authorization.machineId as MachineId,
          envelopeAuthorization: this.buildExecutableActivation(
            freshAuthorization,
            authorization,
            authorization.grant,
          ),
        };
      }

      const grant = await tx.executionGrant.create({
        data: {
          authorizationId: authorization.id,
          scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
          controllerCredentialId: authorization.controllerCredentialId,
          controllerInstallationId: authorization.controllerInstallationId,
          machineId: authorization.machineId,
          userId: authorization.userId,
          organizationId: authorization.organizationId,
          projectId: authorization.projectId,
          cadence: authorization.cadence,
          policyRevision: authorization.policyRevision,
          grantDescriptorHash: authorization.grantDescriptorHash,
          targetKind: authorization.targetKind,
          targetId: authorization.targetId,
          allowedActions,
          taskMonitorId: null,
          selectedWorkFingerprint: null,
          policyFingerprint: null,
          issuedAt: authorization.issuedAt,
          expiresAt: this.requireControllerDeviceGrantExpiry(
            authorization.issuedAt,
            this.requireSupportedCadence(authorization.cadence),
          ),
        },
      });
      return {
        grant,
        machineId: authorization.machineId as MachineId,
        envelopeAuthorization: this.buildExecutableActivation(
          freshAuthorization,
          authorization,
          grant,
        ),
      };
    });
  }

  async assertTaskMonitorMachineEffectAuthorized(params: {
    commandId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    monitorId: TaskId;
    machineId: MachineId;
    userId: UserId;
    agentSessionId: AgentSessionId;
    conversationId: ConversationId;
  }): Promise<InteractiveGrantAdmission> {
    this.logger.debug(
      'Resolving Task Monitor command authority for machine effect',
      {
        commandId: params.commandId,
        monitorId: params.monitorId,
        machineId: params.machineId,
        agentSessionId: params.agentSessionId,
        conversationId: params.conversationId,
      },
    );
    const command = await this.prisma.db.monitorCommand.findFirst({
      where: {
        id: params.commandId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        monitorId: params.monitorId,
        machineId: params.machineId,
        userId: params.userId,
        authorizationId: { not: null },
        deliveryState: 'RECEIVED',
      },
      select: { authorizationId: true, body: true, outcome: true },
    });
    if (
      !command?.authorizationId ||
      !this.isAdmittedStartCommand(command.body, command.outcome)
    ) {
      this.deny(
        'Task Monitor machine effect is not correlated to an admitted START command',
        'monitor_command_mismatch',
      );
    }

    const authorization = await this.loadAuthorization(command.authorizationId);
    const snapshot = await this.resolveTaskMonitorSnapshot(
      this.prisma.db,
      params.organizationId,
      params.projectId,
      params.monitorId,
    );
    this.assertReusableTaskMonitorGrant(
      authorization,
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.userId,
        machineId: params.machineId,
        monitorId: params.monitorId,
        controllerInstallationId: authorization.controllerInstallationId,
      },
      HostAffectingActionType.TaskMonitorStart,
      snapshot,
    );
    this.assertReusableAgentSessionGrant(authorization, {
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.userId,
      machineId: params.machineId,
      actionCategory: HostActionCategory.Conversation,
      actionType: HostAffectingActionType.ConversationTrigger,
      agentSessionId: params.agentSessionId,
      conversationId: params.conversationId,
      controllerInstallationId: authorization.controllerInstallationId,
    });

    const action = this.buildNonRevisionedAction({
      requestId: crypto.randomUUID(),
      actionCategory: HostActionCategory.Conversation,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: params.agentSessionId,
    });
    this.logger.log(
      'Admitted Task Monitor machine effect against existing grant',
      {
        commandId: params.commandId,
        monitorId: params.monitorId,
        machineId: params.machineId,
        grantId: authorization.grant?.id,
        agentSessionId: params.agentSessionId,
        conversationId: params.conversationId,
      },
    );
    return {
      [ADMITTED_HOST_ACTION]: true,
      authorizationId: authorization.id,
      requestId: action.requestId,
      controllerInstallationId: authorization.controllerInstallationId,
      machineId: params.machineId,
      agentSessionId: params.agentSessionId,
      action,
      envelopeAuthorization: {
        kind: 'bounded_grant',
        grantId: authorization.grant!.id,
      },
      existingGrantId: authorization.grant!.id,
    };
  }

  private isAdmittedStartCommand(
    body: Prisma.JsonValue,
    outcome: Prisma.JsonValue | null,
  ): boolean {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !outcome ||
      typeof outcome !== 'object' ||
      Array.isArray(outcome)
    ) {
      return false;
    }
    const command = body as Partial<MonitorCommandBody>;
    return (
      command.kind === MonitorCommandBody.KindEnum.TaskMonitorCommand &&
      command.command?.cause === 'START' &&
      outcome.status === 'ADMITTED' &&
      outcome.commandId === command.commandId
    );
  }

  async reduceTaskMonitorAuthority(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    monitorId: TaskId;
    command: Extract<
      TaskMonitorExternalCommand,
      { cause: 'PAUSE' | 'STOP' | 'HALT' }
    >;
  }): Promise<void> {
    const now = new Date();
    const data =
      params.command.cause === 'PAUSE'
        ? { suspendedAt: now }
        : { terminalAt: now };
    await this.prisma.db.executionGrant.updateMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.userId,
        taskMonitorId: params.monitorId,
        revokedAt: null,
        terminalAt: null,
        ...(params.command.cause === 'PAUSE' ? { suspendedAt: null } : {}),
      },
      data,
    });
  }

  private async resolveInteractiveAgentSession(params: {
    authorization: AuthorizationWithAuthorityAndGrant;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    conversationId: string;
    requestedAgentSessionId?: AgentSessionId;
  }): Promise<AgentSessionId> {
    const session = await this.prisma.db.agentSession.findFirst({
      where: {
        ...(params.requestedAgentSessionId
          ? { id: params.requestedAgentSessionId }
          : {}),
        conversationId: params.conversationId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.userId,
        OR: [
          { machineId: params.authorization.machineId },
          { machineId: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!session) {
      this.deny('Authorization is not bound to an eligible Agent Session');
    }
    return session.id as AgentSessionId;
  }

  private async resolveCurrentControllerInstallation(params: {
    controllerBindingSecret: string | undefined;
    userId: UserId;
    organizationId: OrganizationId;
  }): Promise<string> {
    const binding = await this.browserBindingService.resolveForAdmission({
      secret: params.controllerBindingSecret,
      userId: params.userId,
      organizationId: params.organizationId,
      required: true,
    });
    if (!binding) this.deny('Controller browser binding is required');
    return binding.controllerInstallationId;
  }

  private async loadAuthorizationInput(
    input: AdmissionEnvelopeAuthorization | undefined,
  ): Promise<AuthorizationWithAuthorityAndGrant> {
    if (!input) {
      this.deny(
        'Exact controller authorization is required',
        'authorization_missing',
      );
    }
    if (input.kind === 'controller_assertion') {
      return this.loadAuthorization(input.intent.authorizationId);
    }
    const grant = await this.prisma.db.executionGrant.findUnique({
      where: { id: input.grantId },
      select: { authorizationId: true },
    });
    if (!grant)
      this.deny('Active controller grant was not found', 'grant_missing');
    const authorization = await this.loadAuthorization(grant.authorizationId);
    if (authorization.grant?.id !== input.grantId) {
      this.deny(
        'Active controller grant binding does not match',
        'grant_substituted',
      );
    }
    return authorization;
  }

  private assertFreshEvidenceMatches(
    authorization: AuthorizationWithAuthorityAndGrant,
    input: AdmissionEnvelopeAuthorization,
  ): void {
    if (
      input.kind !== 'controller_assertion' ||
      input.intent.authorizationId !== authorization.id ||
      input.credentialId !== authorization.controllerCredential.credentialId ||
      authorization.assertionEvidence === null ||
      canonicalizeJcs(input) !==
        canonicalizeJcs(authorization.assertionEvidence)
    ) {
      this.deny(
        'Fresh controller evidence does not match admission',
        'assertion_mismatch',
      );
    }
  }

  private async deriveAgentSessionGrant(params: {
    authorization: AuthorizationWithAuthorityAndGrant;
    evidence: ControllerAssertionEvidence;
    action: HostActionPreparation;
    agentSessionId: AgentSessionId | null;
  }): Promise<ExecutableControllerAssertionEvidence> {
    this.requireSupportedCadence(params.authorization.cadence);
    return this.prisma.db.$transaction(async (tx) => {
      await this.lockAuthorization(tx, params.authorization.id);
      const authorization = await this.loadAuthorization(
        params.authorization.id,
        tx,
      );
      this.assertFreshEvidenceMatches(authorization, params.evidence);
      this.assertAuthorizationMatches(
        authorization,
        {
          organizationId: authorization.organizationId as OrganizationId,
          projectId: authorization.projectId as ProjectId,
          userId: authorization.userId as UserId,
          machineId: authorization.machineId as MachineId,
          controllerInstallationId: authorization.controllerInstallationId,
        },
        params.action,
      );
      if (authorization.grant && params.agentSessionId) {
        this.assertReusableAgentSessionGrant(authorization, {
          organizationId: authorization.organizationId as OrganizationId,
          projectId: authorization.projectId as ProjectId,
          userId: authorization.userId as UserId,
          machineId: authorization.machineId as MachineId,
          actionCategory: params.action.actionCategory,
          actionType: params.action.actionType,
          agentSessionId: params.agentSessionId,
          conversationId: authorization.targetId,
          controllerInstallationId: authorization.controllerInstallationId,
        });
      }
      if (authorization.grant && params.agentSessionId === null) {
        const existing = this.assertActiveGrantBindings(authorization, {
          organizationId: authorization.organizationId as OrganizationId,
          projectId: authorization.projectId as ProjectId,
          userId: authorization.userId as UserId,
          machineId: authorization.machineId as MachineId,
          controllerInstallationId: authorization.controllerInstallationId,
        });
        this.assertControllerWindowAdmitsAction(
          existing,
          params.action.actionType,
          params.action.actionCategory,
        );
      }
      const grant =
        authorization.grant ??
        (await tx.executionGrant.create({
          data: {
            authorizationId: authorization.id,
            scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
            controllerCredentialId: authorization.controllerCredentialId,
            controllerInstallationId: authorization.controllerInstallationId,
            machineId: authorization.machineId,
            userId: authorization.userId,
            organizationId: authorization.organizationId,
            projectId: authorization.projectId,
            cadence: authorization.cadence,
            policyRevision: authorization.policyRevision,
            grantDescriptorHash: authorization.grantDescriptorHash,
            targetKind: authorization.targetKind,
            targetId: authorization.targetId,
            allowedActions: [...CONTROLLER_DEVICE_ALLOWED_ACTIONS],
            // A controller-device window is bound by targetKind/targetId.
            // agentSessionId is reserved for the interactive-turn scope arm.
            agentSessionId: null,
            authorizedTurnId: null,
            issuedAt: authorization.issuedAt,
            expiresAt: this.requireControllerDeviceGrantExpiry(
              authorization.issuedAt,
              this.requireSupportedCadence(authorization.cadence),
            ),
          },
        }));
      return this.buildExecutableActivation(
        params.evidence,
        authorization,
        grant,
      );
    });
  }

  private buildExecutableActivation(
    evidence: AdmissionEnvelopeAuthorization,
    authorization: AuthorizationWithAuthorityAndGrant,
    grant: ExecutionGrant | null,
  ): ExecutableControllerAssertionEvidence {
    if (evidence.kind !== 'controller_assertion') {
      this.deny('Fresh controller evidence is required for activation');
    }
    this.requireSupportedCadence(authorization.cadence);
    if (
      !grant ||
      grant.scope !== PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW
    ) {
      this.deny(
        'Derived grant does not match the controller authorization cadence',
        'activation_grant_mismatch',
      );
    }
    return {
      ...evidence,
      grantId: grant.id,
    } satisfies ExecutableControllerAssertionEvidence;
  }

  private assertActiveGrantBindings(
    authorization: AuthorizationWithAuthorityAndGrant,
    context: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
      machineId?: MachineId;
      controllerInstallationId: string;
    },
  ): ExecutionGrant {
    const grant = authorization.grant;
    const expectedWindowExpiry =
      grant?.scope === PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW
        ? this.requireControllerDeviceGrantExpiry(
            authorization.issuedAt,
            this.requireSupportedCadence(authorization.cadence),
          )
        : null;
    if (
      !grant ||
      grant.expiresAt.getTime() <= Date.now() ||
      grant.suspendedAt !== null ||
      grant.terminalAt !== null ||
      grant.revokedAt !== null ||
      authorization.outcome !== 'ADMITTED' ||
      authorization.consumedAt === null ||
      isRemovedControllerAuthorizationCadence(authorization.cadence) ||
      authorization.organizationId !== context.organizationId ||
      (grant?.scope !== PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW &&
        authorization.projectId !== context.projectId) ||
      authorization.userId !== context.userId ||
      (context.machineId !== undefined &&
        authorization.machineId !== context.machineId) ||
      authorization.controllerInstallationId !==
        context.controllerInstallationId ||
      authorization.machine.revokedAt !== null ||
      authorization.machine.authorizationProtocolVersion !== 2 ||
      authorization.machine.authorizationState !== 'READY' ||
      authorization.controllerCredential.revokedAt !== null ||
      grant.controllerCredentialId !== authorization.controllerCredentialId ||
      grant.controllerInstallationId !==
        authorization.controllerInstallationId ||
      grant.machineId !== authorization.machineId ||
      grant.userId !== authorization.userId ||
      grant.organizationId !== authorization.organizationId ||
      grant.projectId !== authorization.projectId ||
      grant.policyRevision !== CONTROLLER_DEVICE_POLICY_REVISION ||
      grant.policyRevision !== authorization.policyRevision ||
      grant.cadence !== authorization.cadence ||
      grant.grantDescriptorHash !== authorization.grantDescriptorHash ||
      (expectedWindowExpiry !== null &&
        grant.expiresAt.getTime() !== expectedWindowExpiry.getTime())
    ) {
      this.deny(
        'Active controller grant binding is invalid',
        'grant_binding_mismatch',
      );
    }
    return grant;
  }

  private assertReusableInteractiveGrant(
    authorization: AuthorizationWithAuthorityAndGrant,
    context: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
      machineId?: MachineId;
      targetId: string;
      controllerInstallationId: string;
    },
    actionType: HostAffectingActionType,
  ): void {
    const grant = this.assertActiveGrantBindings(authorization, context);
    this.assertControllerWindowAdmitsAction(
      grant,
      actionType,
      HostActionCategory.Conversation,
    );
    if (grant.scope !== PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW) {
      this.deny(
        'Controller grant does not cover this conversation action',
        'action_widening',
      );
    }
  }

  private assertReusableAgentSessionGrant(
    authorization: AuthorizationWithAuthorityAndGrant,
    context: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
      machineId: MachineId;
      actionCategory: HostActionCategory;
      actionType: HostAffectingActionType;
      agentSessionId: AgentSessionId;
      conversationId: string;
      controllerInstallationId: string;
    },
  ): void {
    const grant = this.assertActiveGrantBindings(authorization, context);
    this.assertControllerWindowAdmitsAction(
      grant,
      context.actionType,
      context.actionCategory,
    );
    if (grant.scope !== PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW) {
      this.deny(
        'Controller grant does not cover this Agent Session action',
        'action_widening',
      );
    }
  }

  private assertReusableTaskMonitorGrant(
    authorization: AuthorizationWithAuthorityAndGrant,
    context: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
      machineId?: MachineId;
      monitorId: TaskId;
      controllerInstallationId: string;
    },
    actionType: HostAffectingActionType,
    snapshot: {
      selectionFingerprint: string;
      policyFingerprint: string;
    },
  ): void {
    const grant = this.assertActiveGrantBindings(authorization, context);
    if (grant.scope === PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW) {
      this.assertControllerWindowAdmitsAction(
        grant,
        actionType,
        HostActionCategory.TaskMonitor,
      );
    }
    if (
      isRemovedControllerAuthorizationCadence(authorization.cadence) ||
      (grant.scope !== PrismaExecutionGrantScope.TASK_MONITOR &&
        grant.scope !== PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW) ||
      !grant.allowedActions.includes(
        PrismaHostAffectingActionType[actionType],
      ) ||
      (grant.scope === PrismaExecutionGrantScope.TASK_MONITOR &&
        (grant.targetKind !== PrismaHostActionTargetKind.TASK_MONITOR ||
          grant.targetId !== context.monitorId ||
          grant.taskMonitorId !== context.monitorId ||
          grant.selectedWorkFingerprint !== snapshot.selectionFingerprint ||
          grant.policyFingerprint !== snapshot.policyFingerprint))
    ) {
      this.deny(
        'Controller grant does not cover this Task Monitor action',
        'action_widening',
      );
    }
  }

  private assertControllerWindowAdmitsAction(
    grant: ExecutionGrant,
    actionType: HostAffectingActionType,
    actionCategory: HostActionCategory,
  ): void {
    if (
      !isCurrentAgentOperation(actionType) ||
      getCurrentAgentOperationCategory(actionType) !== actionCategory ||
      grant.allowedActions.length !==
        CONTROLLER_DEVICE_ALLOWED_ACTIONS.length ||
      CONTROLLER_DEVICE_ALLOWED_ACTIONS.some(
        (allowedAction) => !grant.allowedActions.includes(allowedAction),
      ) ||
      !grant.allowedActions.includes(PrismaHostAffectingActionType[actionType])
    ) {
      this.deny(
        'Controller grant does not cover this exact current operation',
        'action_widening',
      );
    }
  }

  private async resolveTaskMonitorSnapshot(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    monitorId: TaskId,
  ): Promise<{
    selectionFingerprint: string;
    policyFingerprint: string;
  }> {
    const monitor = await tx.task.findFirst({
      where: {
        id: monitorId,
        organizationId,
        projectId,
        type: 'TASK_MONITOR',
        archivedAt: null,
      },
      select: {
        sections: {
          where: { key: 'executionDefinition' },
          select: { materializedMarkdown: true },
          take: 1,
        },
      },
    });
    const serialized = monitor?.sections[0]?.materializedMarkdown;
    if (!monitor || !serialized) {
      this.deny('Task Monitor execution definition is unavailable');
    }

    let definition: unknown;
    try {
      definition = JSON.parse(serialized);
    } catch {
      this.deny('Task Monitor execution definition is invalid');
    }
    if (
      !definition ||
      typeof definition !== 'object' ||
      Array.isArray(definition)
    ) {
      this.deny('Task Monitor execution definition is invalid');
    }
    const record = definition as Record<string, unknown>;
    if (!Array.isArray(record.executionPlan) || !record.launchPolicy) {
      this.deny('Task Monitor execution definition is incomplete');
    }

    const selectedWork = record.executionPlan.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        this.deny('Task Monitor selected work is invalid');
      }
      const node = entry as Record<string, unknown>;
      return {
        taskId: node.taskId,
        dependsOnTaskIds: node.dependsOnTaskIds,
      };
    });
    const executionPolicy = {
      launchPolicy: record.launchPolicy,
      nodeLaunchConfigurations: record.executionPlan.map(
        (entry) => (entry as Record<string, unknown>).launchConfiguration,
      ),
    };

    return {
      selectionFingerprint: this.sha256Hex(canonicalizeJcs(selectedWork)),
      policyFingerprint: this.sha256Hex(canonicalizeJcs(executionPolicy)),
    };
  }

  private buildNonRevisionedAction(params: {
    inputs?: ControllerActionInputs;
    requestId: string;
    actionCategory: HostActionCategory;
    actionType: HostAffectingActionType;
    targetKind: HostActionTargetKind;
    targetId: string;
  }): HostActionPreparation {
    switch (params.targetKind) {
      case 'CONVERSATION':
        return {
          requestId: params.requestId,
          actionCategory: params.actionCategory,
          actionType: params.actionType,
          targetKind: 'CONVERSATION',
          targetId: params.targetId,
          ...(params.inputs ? { inputs: params.inputs } : {}),
        } satisfies ConversationHostActionPreparation;
      case 'AGENT_SESSION':
        return {
          requestId: params.requestId,
          actionCategory: params.actionCategory,
          actionType: params.actionType,
          targetKind: 'AGENT_SESSION',
          targetId: params.targetId,
          ...(params.inputs ? { inputs: params.inputs } : {}),
        } satisfies AgentSessionHostActionPreparation;
      default:
        throw new ExecutionGrantAdmissionDeniedException(
          'Interactive authorization target is not non-revisioned',
        );
    }
  }

  private assertAuthorizationMatches(
    authorization: AuthorizationWithAuthorityAndGrant,
    context: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      userId: UserId;
      machineId?: MachineId;
      controllerInstallationId?: string;
    },
    action: HostActionPreparation,
  ): void {
    const now = Date.now();
    if (
      authorization.organizationId !== context.organizationId ||
      authorization.projectId !== context.projectId ||
      authorization.userId !== context.userId ||
      (context.machineId !== undefined &&
        authorization.machineId !== context.machineId) ||
      (context.controllerInstallationId !== undefined &&
        authorization.controllerInstallationId !==
          context.controllerInstallationId) ||
      authorization.outcome !== 'ADMITTED' ||
      !authorization.consumedAt ||
      isRemovedControllerAuthorizationCadence(authorization.cadence) ||
      (!this.isActiveControllerDeviceWindow(authorization) &&
        authorization.expiresAt.getTime() <= now) ||
      authorization.machine.revokedAt ||
      authorization.machine.authorizationProtocolVersion !== 2 ||
      authorization.machine.authorizationState !== 'READY' ||
      authorization.controllerCredential.revokedAt ||
      authorization.actionCategory !== action.actionCategory ||
      authorization.actionType !== action.actionType ||
      authorization.targetKind !== action.targetKind ||
      authorization.targetId !== action.targetId ||
      authorization.actionPayloadHash !== hashControllerAction(action)
    ) {
      this.deny();
    }
  }

  private assertExistingInteractiveGrant(
    grant: ExecutionGrant | null,
    authorization: AuthorizationWithAuthorityAndGrant,
    agentSessionId: AgentSessionId,
    actionType: HostAffectingActionType,
    authorizedTurnId?: MessageId,
    controllerInstallationId?: string,
  ): void {
    if (!grant) return;
    if (grant.scope === PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW) {
      const expectedExpiresAt = this.requireControllerDeviceGrantExpiry(
        authorization.issuedAt,
        this.requireSupportedCadence(authorization.cadence),
      );
      if (
        !this.isActiveControllerDeviceWindow(authorization) ||
        (controllerInstallationId !== undefined &&
          grant.controllerInstallationId !== controllerInstallationId) ||
        grant.controllerInstallationId !==
          authorization.controllerInstallationId ||
        grant.machineId !== authorization.machineId ||
        grant.userId !== authorization.userId ||
        grant.organizationId !== authorization.organizationId ||
        grant.projectId !== authorization.projectId ||
        grant.controllerCredentialId !== authorization.controllerCredentialId ||
        grant.policyRevision !== authorization.policyRevision ||
        grant.cadence !== authorization.cadence ||
        grant.grantDescriptorHash !== authorization.grantDescriptorHash ||
        grant.issuedAt.getTime() !== authorization.issuedAt.getTime() ||
        grant.expiresAt.getTime() !== expectedExpiresAt.getTime() ||
        grant.allowedActions.length !==
          CONTROLLER_DEVICE_ALLOWED_ACTIONS.length ||
        CONTROLLER_DEVICE_ALLOWED_ACTIONS.some(
          (allowedAction) => !grant.allowedActions.includes(allowedAction),
        )
      ) {
        this.deny('Consumed authorization is already bound to another grant');
      }
      return;
    }
    if (
      grant.scope !== PrismaExecutionGrantScope.INTERACTIVE_TURN ||
      grant.expiresAt.getTime() <= Date.now() ||
      grant.suspendedAt !== null ||
      grant.terminalAt !== null ||
      grant.revokedAt !== null ||
      grant.machineId !== authorization.machineId ||
      grant.userId !== authorization.userId ||
      grant.organizationId !== authorization.organizationId ||
      grant.projectId !== authorization.projectId ||
      grant.controllerCredentialId !== authorization.controllerCredentialId ||
      grant.controllerInstallationId !==
        authorization.controllerInstallationId ||
      grant.policyRevision !== authorization.policyRevision ||
      grant.cadence !== authorization.cadence ||
      grant.grantDescriptorHash !== authorization.grantDescriptorHash ||
      grant.targetKind !== PrismaHostActionTargetKind.AGENT_SESSION ||
      grant.targetId !== agentSessionId ||
      grant.agentSessionId !== agentSessionId ||
      (authorizedTurnId !== undefined &&
        grant.authorizedTurnId !== authorizedTurnId) ||
      grant.taskMonitorId !== null ||
      grant.allowedActions.length !== INTERACTIVE_TURN_ALLOWED_ACTIONS.length ||
      !grant.allowedActions.includes(
        PrismaHostAffectingActionType[actionType],
      ) ||
      INTERACTIVE_TURN_ALLOWED_ACTIONS.some(
        (allowedAction) => !grant.allowedActions.includes(allowedAction),
      )
    ) {
      this.deny('Consumed authorization is already bound to another grant');
    }
  }

  private assertExistingTaskMonitorGrant(
    grant: ExecutionGrant,
    expected: {
      monitorId: string;
      machineId: string;
      controllerInstallationId: string;
      cadence: PrismaControllerAuthorizationCadence;
      policyRevision: number;
      grantDescriptorHash: string;
      selectionFingerprint: string;
      policyFingerprint: string;
      allowedActions: PrismaHostAffectingActionType[];
      reusableWindow: boolean;
      authorizationIssuedAt: Date;
    },
  ): void {
    const commonBindingMismatch =
      grant.expiresAt.getTime() <= Date.now() ||
      grant.suspendedAt !== null ||
      grant.terminalAt !== null ||
      grant.revokedAt !== null ||
      grant.machineId !== expected.machineId ||
      grant.controllerInstallationId !== expected.controllerInstallationId ||
      grant.cadence !== expected.cadence ||
      grant.policyRevision !== expected.policyRevision ||
      grant.grantDescriptorHash !== expected.grantDescriptorHash ||
      grant.allowedActions.length !== expected.allowedActions.length ||
      grant.allowedActions.some(
        (action, index) => action !== expected.allowedActions[index],
      );
    const controllerWindowMismatch =
      expected.reusableWindow &&
      (grant.scope !== PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW ||
        grant.expiresAt.getTime() !==
          this.requireControllerDeviceGrantExpiry(
            expected.authorizationIssuedAt,
            this.requireSupportedCadence(expected.cadence),
          ).getTime() ||
        grant.taskMonitorId !== null ||
        grant.selectedWorkFingerprint !== null ||
        grant.policyFingerprint !== null);
    const taskMonitorGrantMismatch =
      !expected.reusableWindow &&
      (grant.scope !== PrismaExecutionGrantScope.TASK_MONITOR ||
        grant.targetKind !== PrismaHostActionTargetKind.TASK_MONITOR ||
        grant.targetId !== expected.monitorId ||
        grant.taskMonitorId !== expected.monitorId ||
        grant.selectedWorkFingerprint !== expected.selectionFingerprint ||
        grant.policyFingerprint !== expected.policyFingerprint);
    if (
      commonBindingMismatch ||
      controllerWindowMismatch ||
      taskMonitorGrantMismatch
    ) {
      this.deny('Consumed authorization is already bound to another grant');
    }
  }

  private isAuthorityReduction(
    command: TaskMonitorExternalCommand,
  ): command is Extract<
    TaskMonitorExternalCommand,
    { cause: 'PAUSE' | 'STOP' | 'HALT' }
  > {
    return (
      command.cause === 'PAUSE' ||
      command.cause === 'STOP' ||
      command.cause === 'HALT'
    );
  }

  private async loadAuthorization(
    authorizationId: string,
    tx: AnyTransactionClient | typeof this.prisma.db = this.prisma.db,
  ): Promise<AuthorizationWithAuthorityAndGrant> {
    const authorization = await tx.executionAuthorization.findUnique({
      where: { id: authorizationId },
      include: {
        grant: true,
        controllerCredential: {
          select: { credentialId: true, revokedAt: true },
        },
        machine: {
          select: {
            revokedAt: true,
            authorizationProtocolVersion: true,
            authorizationState: true,
          },
        },
      },
    });
    if (!authorization) this.deny();
    return authorization as AuthorizationWithAuthorityAndGrant;
  }

  private async lockAuthorization(
    tx: AnyTransactionClient,
    authorizationId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT 1
      FROM execution_authorizations
      WHERE authorization_id = ${authorizationId}
      FOR UPDATE
    `;
  }

  private isActiveControllerDeviceWindow(
    authorization: AuthorizationWithAuthorityAndGrant,
  ): boolean {
    const grant = authorization.grant;
    return Boolean(
      grant &&
        grant.scope === PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW &&
        grant.expiresAt.getTime() > Date.now() &&
        grant.suspendedAt === null &&
        grant.terminalAt === null &&
        grant.revokedAt === null &&
        !authorization.machine.revokedAt &&
        authorization.machine.authorizationProtocolVersion === 2 &&
        authorization.machine.authorizationState === 'READY' &&
        !authorization.controllerCredential.revokedAt,
    );
  }

  private requireControllerDeviceGrantExpiry(
    issuedAt: Date,
    cadence: ControllerAuthorizationCadence,
  ): Date {
    const expiresAt = getControllerDeviceGrantExpiry(issuedAt, cadence);
    return expiresAt;
  }

  private requireSupportedCadence(
    cadence: PrismaControllerAuthorizationCadence,
  ): ControllerAuthorizationCadence {
    const supported = toControllerAuthorizationCadence(cadence);
    if (!supported) {
      this.deny('Removed controller authorization cadence');
    }
    return supported;
  }

  private sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private deny(message?: string, denialCode = 'authorization_denied'): never {
    this.logger.warn('Controller execution admission denied', {
      denialCode,
    });
    throw new ExecutionGrantAdmissionDeniedException(message);
  }
}
