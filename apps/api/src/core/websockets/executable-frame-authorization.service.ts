import { Injectable, Logger } from '@nestjs/common';
import {
  ControllerAssertionEvidence,
  ExecutableControllerAssertionEvidence,
  HostActionTarget,
  HostActionTargetKind,
  HostAffectingActionType,
  BoundedGrantReference,
  CurrentAgentOperation,
  ExecutableEnvelopeAuthorization,
} from '../../generated';
import {
  ExecutionGrantScope as PrismaExecutionGrantScope,
  HostActionTargetKind as PrismaHostActionTargetKind,
  HostAffectingActionType as PrismaHostAffectingActionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { canonicalizeJcs } from './trigger-canonicalization';
import { isRemovedControllerAuthorizationCadence } from '../../services/controller-authorization/controller-authorization-cadence';
import {
  AgentSessionId,
  MachineId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';

const CURRENT_AGENT_OPERATIONS = Object.values(CurrentAgentOperation);

function isCurrentAgentOperation(
  actionType: HostAffectingActionType,
): actionType is CurrentAgentOperation {
  return CURRENT_AGENT_OPERATIONS.includes(actionType as CurrentAgentOperation);
}

export interface ExecutableFrameAuthorizationRequest {
  machineId: MachineId;
  userId: UserId;
  organizationId: OrganizationId;
  projectId: ProjectId;
  actionType: HostAffectingActionType;
  actionPayloadHash?: string;
  target: HostActionTarget;
  agentSessionId: AgentSessionId | null;
  conversationId?: string | null;
  authorizedTurnId?: string | null;
  taskMonitorId: TaskId | null;
  selectedWorkFingerprint?: string | null;
  policyFingerprint?: string | null;
  grantId?: string;
  authorizationId?: string;
  envelopeAuthorization?: ExecutableEnvelopeAuthorization;
  /**
   * Durable operation delivery has the admitted assertion persisted with the
   * authorization, but the first websocket frame still needs to activate the
   * paired CLI's local grant store. Reconstruct that executable activation
   * from the persisted admission evidence when requested by the dispatcher.
   */
  preferPersistedActivation?: boolean;
}

/**
 * Revalidates the selected post-admission activation or compact grant
 * reference immediately before an executable frame is signed.
 */
@Injectable()
export class ExecutableFrameAuthorizationService {
  private readonly logger = new Logger(
    ExecutableFrameAuthorizationService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  async resolveSelectedAuthorization(
    request: ExecutableFrameAuthorizationRequest,
  ): Promise<ExecutableEnvelopeAuthorization | null> {
    if (
      request.preferPersistedActivation &&
      !request.envelopeAuthorization &&
      request.authorizationId &&
      request.grantId
    ) {
      const persistedActivation =
        await this.resolvePersistedActivation(request);
      if (persistedActivation) {
        return this.resolveSelectedAuthorization({
          ...request,
          envelopeAuthorization: persistedActivation,
          preferPersistedActivation: false,
        });
      }
    }
    const selected = request.envelopeAuthorization;
    if (!selected || selected.kind === 'bounded_grant') {
      return this.resolveBoundedGrant({
        ...request,
        ...(selected ? { grantId: selected.grantId } : {}),
      });
    }
    const authorization =
      await this.prisma.db.executionAuthorization.findUnique({
        where: { id: selected.intent.authorizationId },
        include: {
          grant: {
            include: { agentSession: { select: { conversationId: true } } },
          },
          controllerCredential: {
            select: { credentialId: true, revokedAt: true },
          },
          machine: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              revokedAt: true,
              authorizationProtocolVersion: true,
              authorizationState: true,
            },
          },
        },
      });
    const { grantId: submittedGrantId, ...submittedEvidence } = selected;
    const expectedGrantId = authorization?.grant?.id;
    const exactTargetMatches =
      authorization?.targetKind === request.target.kind &&
      authorization?.targetId === request.target.id;
    const conversationTargetMatches =
      request.actionType === HostAffectingActionType.ConversationTrigger &&
      authorization?.targetKind === PrismaHostActionTargetKind.CONVERSATION &&
      request.target.kind === HostActionTargetKind.AgentSession &&
      ((authorization.grant?.agentSession?.conversationId ===
        authorization.targetId &&
        authorization.grant.targetKind ===
          PrismaHostActionTargetKind.AGENT_SESSION) ||
        (request.conversationId === authorization.targetId &&
          authorization.grant?.targetKind ===
            PrismaHostActionTargetKind.CONVERSATION &&
          authorization.grant.targetId === authorization.targetId));
    const evidenceMatches =
      !!authorization?.assertionEvidence &&
      canonicalizeJcs(submittedEvidence) ===
        canonicalizeJcs(authorization.assertionEvidence);
    const payloadHashMatches =
      request.actionPayloadHash === undefined ||
      authorization?.actionPayloadHash === request.actionPayloadHash;
    const valid =
      !!authorization &&
      !isRemovedControllerAuthorizationCadence(authorization.cadence) &&
      authorization.outcome === 'ADMITTED' &&
      authorization.consumedAt !== null &&
      evidenceMatches &&
      submittedGrantId === expectedGrantId &&
      expectedGrantId !== undefined &&
      selected.credentialId ===
        authorization.controllerCredential.credentialId &&
      authorization.machineId === request.machineId &&
      authorization.userId === request.userId &&
      authorization.organizationId === request.organizationId &&
      authorization.projectId === request.projectId &&
      authorization.actionType === request.actionType &&
      payloadHashMatches &&
      (exactTargetMatches || conversationTargetMatches) &&
      authorization.machine.id === request.machineId &&
      authorization.machine.userId === request.userId &&
      authorization.machine.organizationId === request.organizationId &&
      authorization.machine.revokedAt === null &&
      authorization.machine.authorizationProtocolVersion === 2 &&
      authorization.machine.authorizationState === 'READY' &&
      authorization.controllerCredential.revokedAt === null;
    if (!valid) {
      this.logger.warn('[executable-frame-authz] fresh delivery denied', {
        machineId: request.machineId,
        userId: request.userId,
        organizationId: request.organizationId,
        projectId: request.projectId,
        actionType: request.actionType,
        reason: 'fresh_binding_mismatch',
        evidenceMatches,
        grantIdMatches: submittedGrantId === expectedGrantId,
        exactTargetMatches,
        conversationTargetMatches,
        payloadHashMatches,
        machineMatches: authorization?.machineId === request.machineId,
        projectMatches: authorization?.projectId === request.projectId,
      });
      return null;
    }
    return {
      ...submittedEvidence,
      grantId: expectedGrantId,
    } satisfies ExecutableControllerAssertionEvidence;
  }

  async resolveBoundedGrant(
    request: ExecutableFrameAuthorizationRequest,
  ): Promise<ExecutableEnvelopeAuthorization | null> {
    if (!isCurrentAgentOperation(request.actionType)) {
      return null;
    }
    const now = new Date();
    const actionType =
      request.actionType as unknown as PrismaHostAffectingActionType;
    const targetKind = request.target
      .kind as unknown as PrismaHostActionTargetKind;
    const narrowTarget = request.agentSessionId
      ? { agentSessionId: request.agentSessionId }
      : { targetKind, targetId: request.target.id };
    const grantWhere = {
      ...(request.authorizationId
        ? { authorizationId: request.authorizationId }
        : {}),
      machineId: request.machineId,
      userId: request.userId,
      organizationId: request.organizationId,
      OR: [
        { scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW },
        { projectId: request.projectId, ...narrowTarget },
      ],
      allowedActions: { has: actionType },
      expiresAt: { gt: now },
      suspendedAt: null,
      terminalAt: null,
      revokedAt: null,
    };
    const grant = request.grantId
      ? await this.prisma.db.executionGrant.findUnique({
          where: { id: request.grantId },
          include: {
            authorization: {
              include: {
                controllerCredential: { select: { revokedAt: true } },
                machine: {
                  select: {
                    id: true,
                    userId: true,
                    organizationId: true,
                    revokedAt: true,
                    authorizationProtocolVersion: true,
                    authorizationState: true,
                  },
                },
              },
            },
            controllerCredential: { select: { revokedAt: true } },
            agentSession: { select: { conversationId: true } },
            machine: {
              select: {
                id: true,
                userId: true,
                organizationId: true,
                revokedAt: true,
                authorizationProtocolVersion: true,
                authorizationState: true,
              },
            },
            agentOperations: {
              where: {
                kind: 'WORKFLOW_ANSWER',
                state: { in: ['DISPATCH_PENDING', 'SUCCEEDED'] },
                triggerMessageId:
                  request.authorizedTurnId ?? '__NO_AUTHORIZED_TURN__',
              },
              select: {
                kind: true,
                state: true,
                messageId: true,
                triggerMessageId: true,
              },
            },
          },
        })
      : await this.prisma.db.executionGrant.findFirst({
          where: grantWhere,
          include: {
            authorization: {
              include: {
                controllerCredential: { select: { revokedAt: true } },
                machine: {
                  select: {
                    id: true,
                    userId: true,
                    organizationId: true,
                    revokedAt: true,
                    authorizationProtocolVersion: true,
                    authorizationState: true,
                  },
                },
              },
            },
            controllerCredential: { select: { revokedAt: true } },
            agentSession: { select: { conversationId: true } },
            machine: {
              select: {
                id: true,
                userId: true,
                organizationId: true,
                revokedAt: true,
                authorizationProtocolVersion: true,
                authorizationState: true,
              },
            },
            agentOperations: {
              where: {
                kind: 'WORKFLOW_ANSWER',
                state: { in: ['DISPATCH_PENDING', 'SUCCEEDED'] },
                triggerMessageId:
                  request.authorizedTurnId ?? '__NO_AUTHORIZED_TURN__',
              },
              select: {
                kind: true,
                state: true,
                messageId: true,
                triggerMessageId: true,
              },
            },
          },
        });

    const authorization = grant?.authorization;
    const machine = grant?.machine;
    const isOriginatingAction = authorization?.actionType === actionType;
    const isControllerWindow =
      grant?.scope === PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW;
    const isCorrelatedWorkflowAnswerTrigger =
      request.authorizedTurnId !== undefined &&
      grant?.agentOperations.some(
        (operation) =>
          operation.kind === 'WORKFLOW_ANSWER' &&
          (operation.state === 'DISPATCH_PENDING' ||
            operation.state === 'SUCCEEDED') &&
          operation.messageId === grant.authorizedTurnId &&
          operation.triggerMessageId === request.authorizedTurnId,
      );
    const valid =
      !!grant &&
      !!authorization &&
      !!machine &&
      !isRemovedControllerAuthorizationCadence(authorization.cadence) &&
      !isRemovedControllerAuthorizationCadence(grant.cadence) &&
      grant.expiresAt > now &&
      grant.suspendedAt === null &&
      grant.terminalAt === null &&
      grant.revokedAt === null &&
      authorization.outcome === 'ADMITTED' &&
      authorization.consumedAt !== null &&
      (!request.authorizationId ||
        authorization.id === request.authorizationId) &&
      authorization.machineId === request.machineId &&
      authorization.userId === request.userId &&
      authorization.organizationId === request.organizationId &&
      (isControllerWindow || authorization.projectId === request.projectId) &&
      authorization.controllerCredentialId === grant.controllerCredentialId &&
      grant.controllerCredential.revokedAt === null &&
      authorization.controllerCredential.revokedAt === null &&
      machine.id === request.machineId &&
      machine.userId === request.userId &&
      machine.organizationId === request.organizationId &&
      machine.revokedAt === null &&
      machine.authorizationProtocolVersion === 2 &&
      machine.authorizationState === 'READY' &&
      grant.allowedActions.includes(actionType) &&
      (!isControllerWindow ||
        (grant.allowedActions.length === CURRENT_AGENT_OPERATIONS.length &&
          CURRENT_AGENT_OPERATIONS.every((currentAction) =>
            grant.allowedActions.includes(
              currentAction as unknown as PrismaHostAffectingActionType,
            ),
          ))) &&
      (!isOriginatingAction ||
        isControllerWindow ||
        (this.authorizationTargetMatches(grant, authorization, request) &&
          (request.actionPayloadHash === undefined ||
            authorization.actionPayloadHash === request.actionPayloadHash))) &&
      (isControllerWindow || this.grantTargetMatches(grant, request)) &&
      (isControllerWindow || grant.agentSessionId === request.agentSessionId) &&
      (isControllerWindow ||
        request.authorizedTurnId === undefined ||
        grant.authorizedTurnId === request.authorizedTurnId ||
        isCorrelatedWorkflowAnswerTrigger) &&
      (isControllerWindow || grant.taskMonitorId === request.taskMonitorId) &&
      (isControllerWindow ||
        request.taskMonitorId === null ||
        (request.selectedWorkFingerprint !== undefined &&
          request.policyFingerprint !== undefined)) &&
      (isControllerWindow ||
        request.selectedWorkFingerprint === undefined ||
        grant.selectedWorkFingerprint === request.selectedWorkFingerprint) &&
      (isControllerWindow ||
        request.policyFingerprint === undefined ||
        grant.policyFingerprint === request.policyFingerprint);

    if (!valid) {
      this.logger.warn('[executable-frame-authz] delivery denied', {
        machineId: request.machineId,
        userId: request.userId,
        organizationId: request.organizationId,
        projectId: request.projectId,
        actionType: request.actionType,
        targetKind: request.target.kind,
        targetId: request.target.id,
        reason: this.denialReason(grant, authorization, machine),
      });
      return null;
    }

    if (
      request.authorizedTurnId !== undefined &&
      request.authorizedTurnId === authorization.requestId &&
      authorization.assertionEvidence != null
    ) {
      const evidence =
        authorization.assertionEvidence as unknown as ControllerAssertionEvidence;
      return {
        ...evidence,
        grantId: grant.id,
      } satisfies ExecutableControllerAssertionEvidence;
    }

    return {
      kind: BoundedGrantReference.KindEnum.BoundedGrant,
      grantId: grant.id,
    };
  }

  private async resolvePersistedActivation(
    request: ExecutableFrameAuthorizationRequest,
  ): Promise<ExecutableControllerAssertionEvidence | null> {
    const authorization =
      await this.prisma.db.executionAuthorization.findUnique({
        where: { id: request.authorizationId },
        include: {
          grant: true,
        },
      });
    if (
      !authorization ||
      !authorization.grant ||
      isRemovedControllerAuthorizationCadence(authorization.cadence) ||
      isRemovedControllerAuthorizationCadence(authorization.grant.cadence) ||
      authorization.grant.id !== request.grantId ||
      !authorization.assertionEvidence ||
      typeof authorization.assertionEvidence !== 'object' ||
      Array.isArray(authorization.assertionEvidence) ||
      authorization.assertionEvidence.kind !== 'controller_assertion'
    ) {
      return null;
    }

    const evidence =
      authorization.assertionEvidence as unknown as ControllerAssertionEvidence;
    return {
      ...evidence,
      grantId: authorization.grant.id,
    } satisfies ExecutableControllerAssertionEvidence;
  }

  private denialReason(
    grant: { id: string } | null | undefined,
    authorization: { outcome: string | null } | null | undefined,
    machine: { revokedAt: Date | null } | null | undefined,
  ): string {
    if (!grant) return 'grant_missing_or_inactive';
    if (!authorization) return 'authorization_missing';
    if (authorization.outcome !== 'ADMITTED')
      return 'authorization_not_admitted';
    if (machine?.revokedAt) return 'machine_revoked';
    return 'binding_mismatch';
  }

  private authorizationTargetMatches(
    grant: {
      scope: string;
      targetKind: string;
      targetId: string;
      agentSession: { conversationId: string | null } | null;
    },
    authorization: {
      targetKind: string;
      targetId: string;
    },
    request: ExecutableFrameAuthorizationRequest,
  ): boolean {
    if (
      request.actionType === HostAffectingActionType.ConversationTrigger &&
      request.target.kind === HostActionTargetKind.AgentSession &&
      authorization.targetKind === PrismaHostActionTargetKind.CONVERSATION
    ) {
      if (
        grant.scope === PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW &&
        grant.targetKind === PrismaHostActionTargetKind.CONVERSATION
      ) {
        return (
          request.conversationId === authorization.targetId &&
          grant.targetId === authorization.targetId
        );
      }
      return (
        grant.agentSession?.conversationId === authorization.targetId &&
        grant.targetKind === PrismaHostActionTargetKind.AGENT_SESSION
      );
    }
    return (
      authorization.targetKind === request.target.kind &&
      authorization.targetId === request.target.id
    );
  }

  private grantTargetMatches(
    grant: {
      scope: string;
      targetKind: string;
      targetId: string;
      agentSessionId: string | null;
      taskMonitorId: string | null;
    },
    request: ExecutableFrameAuthorizationRequest,
  ): boolean {
    if (
      request.actionType === HostAffectingActionType.ConversationTrigger &&
      grant.scope === PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW &&
      grant.targetKind === PrismaHostActionTargetKind.CONVERSATION
    ) {
      return grant.targetId === request.conversationId;
    }
    if (grant.agentSessionId !== null) {
      return (
        request.agentSessionId === grant.agentSessionId &&
        grant.targetKind === PrismaHostActionTargetKind.AGENT_SESSION &&
        grant.targetId === grant.agentSessionId
      );
    }
    if (grant.taskMonitorId !== null) {
      return (
        request.taskMonitorId === grant.taskMonitorId &&
        grant.targetKind === PrismaHostActionTargetKind.TASK_MONITOR &&
        grant.targetId === grant.taskMonitorId
      );
    }
    return (
      grant.targetKind === request.target.kind &&
      grant.targetId === request.target.id
    );
  }
}
