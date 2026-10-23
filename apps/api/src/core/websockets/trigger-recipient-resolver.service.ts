import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AgentSessionId,
  ConversationId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';

/**
 * The owner + machine binding a signed trigger envelope is addressed to. The
 * `machineId` lands in the envelope (the CLI checks it against its own paired
 * identity); the `userId` selects the `user:${userId}` Socket.IO room the
 * frame is delivered through.
 */
export interface TriggerRecipient {
  machineId: MachineId;
  userId: UserId;
  agentSessionId?: string;
  projectId?: ProjectId;
  organizationId?: OrganizationId;
}

export type ExactTriggerRecipientFailureReason =
  | 'agent_session_missing'
  | 'machine_binding_missing'
  | 'exact_machine_missing'
  | 'exact_machine_revoked'
  | 'exact_machine_foreign'
  | 'exact_machine_protocol_invalid'
  | 'exact_machine_not_ready'
  | 'exact_machine_credential_unavailable';

export type ExactTriggerRecipientResolution =
  | { resolved: true; recipient: TriggerRecipient }
  | { resolved: false; reason: ExactTriggerRecipientFailureReason };

/**
 * Resolves which user + machine a trigger frame should be addressed to.
 *
 * Conversation triggers join through the conversation's `AgentSession` — the
 * agent session is the only entity that records *which user* a CLI-driven
 * conversation belongs to. Platform-event triggers are not conversation
 * scoped, so the caller supplies the user directly and only the machine
 * binding is resolved here.
 *
 * Every path returns `null` rather than throwing when no recipient can be
 * resolved (no agent session yet, no paired machine): trigger emission is a
 * best-effort side channel and must never break the `conversation.updated`
 * broadcast.
 */
@Injectable()
export class TriggerRecipientResolver {
  private readonly logger = new Logger(TriggerRecipientResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the recipient for a conversation trigger. A persisted
   * `AgentSession.machineId` is authoritative; only sessions that have not
   * been bound to a machine may fall back to the user's latest active pair.
   */
  async resolveConversationRecipient(
    conversationId: ConversationId,
  ): Promise<TriggerRecipient | null> {
    // `AgentSession.conversationId` is indexed. A conversation can in
    // principle accumulate more than one agent session over its life; the
    // most recently created one owns the live CLI pairing.
    const agentSession = await this.prisma.db.agentSession.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        machineId: true,
        projectId: true,
        organizationId: true,
      },
    });

    if (!agentSession) {
      // Lazy session creation: the agent session may not exist yet when the
      // first trigger message lands. Skip rather than error — the
      // conversation.updated broadcast still reaches the UI.
      this.logger.warn(
        `No agent session resolves conversation ${conversationId} to a user — skipping trigger emission`,
      );
      return null;
    }

    const userId = agentSession.userId as UserId;
    if (!agentSession.machineId) {
      const fallback = await this.resolveMachineForUser(userId);
      return fallback
        ? {
            ...fallback,
            agentSessionId: agentSession.id,
            projectId: agentSession.projectId as ProjectId,
            organizationId: agentSession.organizationId as OrganizationId,
          }
        : null;
    }

    const resolution = await this.resolveExactConversationRecipient(
      conversationId,
      agentSession.machineId as MachineId,
      undefined,
      agentSession,
    );
    if (!resolution.resolved) {
      this.logger.warn(
        `Agent session for conversation ${conversationId} is bound to unavailable machine ${agentSession.machineId} (${resolution.reason}) — skipping trigger emission`,
      );
      return null;
    }
    return resolution.recipient;
  }

  /**
   * Resolve and classify the persisted exact-machine binding used by durable
   * operation dispatch. Unlike the nullable best-effort wrapper, this keeps
   * the reason a recipient is unavailable so the queue can distinguish a
   * durable contradiction from a recoverable readiness condition.
   */
  async resolveExactConversationRecipient(
    conversationId: ConversationId,
    expectedMachineId: MachineId,
    expectedAgentSessionId?: AgentSessionId,
    knownSession?: {
      id: string;
      userId: string;
      machineId: string | null;
      projectId: string;
      organizationId: string;
    },
  ): Promise<ExactTriggerRecipientResolution> {
    const sessionSelect = {
      id: true,
      userId: true,
      machineId: true,
      projectId: true,
      organizationId: true,
    } as const;
    const agentSession =
      knownSession ??
      (expectedAgentSessionId
        ? await this.prisma.db.agentSession.findFirst({
            where: { id: expectedAgentSessionId, conversationId },
            select: sessionSelect,
          })
        : await this.prisma.db.agentSession.findFirst({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
            select: sessionSelect,
          }));
    if (!agentSession) {
      return { resolved: false, reason: 'agent_session_missing' };
    }
    if (
      !agentSession.machineId ||
      agentSession.machineId !== expectedMachineId
    ) {
      return { resolved: false, reason: 'machine_binding_missing' };
    }

    const machine = await this.prisma.db.machine.findUnique({
      where: { id: expectedMachineId },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        revokedAt: true,
        authorizationProtocolVersion: true,
        authorizationState: true,
        controllerCredentials: {
          where: { revokedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!machine) {
      return { resolved: false, reason: 'exact_machine_missing' };
    }
    if (machine.revokedAt) {
      return { resolved: false, reason: 'exact_machine_revoked' };
    }
    if (
      machine.userId !== agentSession.userId ||
      machine.organizationId !== agentSession.organizationId
    ) {
      return { resolved: false, reason: 'exact_machine_foreign' };
    }
    if (machine.authorizationProtocolVersion !== 2) {
      return { resolved: false, reason: 'exact_machine_protocol_invalid' };
    }
    if (machine.authorizationState !== 'READY') {
      return { resolved: false, reason: 'exact_machine_not_ready' };
    }
    if (machine.controllerCredentials.length === 0) {
      return {
        resolved: false,
        reason: 'exact_machine_credential_unavailable',
      };
    }

    return {
      resolved: true,
      recipient: {
        machineId: expectedMachineId,
        userId: agentSession.userId as UserId,
        agentSessionId: agentSession.id,
        projectId: agentSession.projectId as ProjectId,
        organizationId: agentSession.organizationId as OrganizationId,
      },
    };
  }

  /**
   * Resolve the machine binding for a user known to be the trigger
   * recipient. Used directly for platform-event triggers, and as the second
   * hop of `resolveConversationRecipient`.
   */
  async resolveMachineForUser(
    userId: UserId,
  ): Promise<TriggerRecipient | null> {
    // A user may have several paired machines; bind the most recently
    // paired active (non-revoked) one. Machine-scoped addressing is refined
    // by the sibling machine-auth task.
    const machine = await this.prisma.db.machine.findFirst({
      where: {
        userId,
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        controllerCredentials: { some: { revokedAt: null } },
      },
      orderBy: { pairedAt: 'desc' },
      select: { id: true },
    });

    if (!machine) {
      this.logger.warn(
        `User ${userId} has no active paired machine — skipping trigger emission`,
      );
      return null;
    }

    return { machineId: machine.id as MachineId, userId };
  }
}
