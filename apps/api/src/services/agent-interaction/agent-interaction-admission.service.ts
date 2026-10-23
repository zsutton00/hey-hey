import { createHash, randomUUID } from 'node:crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type AgentInteractionAttempt,
  type AgentSessionTurnAdmission,
} from '@prisma/client';
import {
  AgentSessionOutputAttentionState,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from '../../generated';
import type {
  ExecutableEnvelopeAuthorization,
  AgentInteractionAdmissionRequest,
  AgentInteractionAdmissionResponse,
  AgentInteractionSettledTurn,
  TurnAdmissionSettledTurn,
  TurnAdmission,
  AgentInteraction as AgentInteractionDto,
  AgentInteractionAuthority,
  AgentInteractionResult,
  AgentInteractionState,
  AgentInteractionAttemptState,
  SubagentInteractionAdmissionRequest,
  SubagentChildScope,
  SubagentDispatch,
  SubagentSettledAttempt,
  SessionMessageInteractionAdmissionRequest,
  SessionMessageInput,
} from '../../generated';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedMachine } from '../machine-pairing/machine-pairing.service';
import type {
  AgentSessionId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import { AgentSessionOutputAttentionProjection } from '../agent-session-output-attention-projection.service';
import { ExecutionGrantService } from '../controller-authorization/execution-grant.service';

type TurnSource = 'USER' | 'WORKFLOW' | 'SUBAGENT' | 'AGENT_INTERACTION';
type TurnAuthor = 'HUMAN' | 'SYSTEM' | 'AGENT';
type Tx = Prisma.TransactionClient;

// Persisted values match the existing agent_interaction_effects.state constraint.
enum AgentInteractionEffectState {
  Blocked = 'BLOCKED',
  Pending = 'PENDING',
  Claimed = 'CLAIMED',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
  Cancelled = 'CANCELLED',
}

const SUBAGENT_EFFECT_OUTCOMES = {
  SUCCEEDED: AgentInteractionEffectState.Succeeded,
  FAILED: AgentInteractionEffectState.Failed,
  CANCELLED: AgentInteractionEffectState.Cancelled,
  // Expiry fails the dispatch; the attempt/result retains EXPIRED and its reason.
  EXPIRED: AgentInteractionEffectState.Failed,
} satisfies Record<
  SubagentSettledAttempt['outcome'],
  AgentInteractionEffectState
>;

const SESSION_MENTION =
  /@\[agent_session:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|([^\]]+)\]/g;

export function parseSessionMessageCommand(commandText: string): {
  targetSessionId: string;
  objective?: string;
  answerReference?: string;
} {
  const first =
    /^\s*\/message-agent\s+(@\[agent_session:[^\]]+\])\s+([\s\S]+)$/.exec(
      commandText,
    );
  const mentions = [...commandText.matchAll(SESSION_MENTION)];
  const mention = mentions[0];
  if (
    !first ||
    !mention ||
    mentions.length !== 1 ||
    first[1] !== mention[0] ||
    !mention[1]
  ) {
    throw new BadRequestException(
      'A session message requires exactly one canonical Agent Session mention after the command.',
    );
  }
  const body = first[2]?.trim();
  if (!body)
    throw new BadRequestException(
      'A session message requires an objective or answer reference.',
    );
  const answer =
    /^answer\s+@\[message:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|[^\]]+\]$/.exec(
      body,
    );
  if (/^answer(?:\s|$)/.test(body) && !answer) {
    throw new BadRequestException(
      'An answer requires one canonical Message reference.',
    );
  }
  return answer && answer[1]
    ? { targetSessionId: mention[1], answerReference: answer[1] }
    : { targetSessionId: mention[1], objective: body };
}

/**
 * Canonical child payload bound to browser-requested child work at admission.
 * The CLI recomputes the same RFC 8785 hash from the claimed dispatch before launch.
 */
export function subagentChildPayloadHash(payload: {
  interactionId: string;
  attemptId: string;
  sourceSessionId: string;
  sourceRunId: string;
  mode: SubagentDispatch['mode'];
  capability: SubagentDispatch['capability'];
  objective: string;
  serviceIds: string[];
}): string {
  return createHash('sha256')
    .update(canonicalizeJcs({ version: 1, kind: 'subagent', ...payload }))
    .digest('hex');
}

/** Controller evidence admitted for one child request and retained on its attempt. */
interface RetainedSubagentAuthorization {
  authorizationId: string;
  envelopeAuthorization: ExecutableEnvelopeAuthorization;
  actionPayloadHash: string;
}

function sameSettledTurn(
  a: AgentInteractionSettledTurn,
  b: AgentInteractionSettledTurn,
): boolean {
  return (
    a.attemptId === b.attemptId &&
    a.interactionId === b.interactionId &&
    a.generation === b.generation &&
    a.targetSessionId === b.targetSessionId &&
    a.targetTurnId === b.targetTurnId &&
    a.terminalOutcome === b.terminalOutcome &&
    a.settledAt === b.settledAt &&
    a.completedAssistantMessageId === b.completedAssistantMessageId &&
    Array.isArray(a.reports) &&
    a.reports.length === b.reports.length &&
    a.reports.every((report, index) => report === b.reports[index])
  );
}

function referencedMessageText(data: Prisma.JsonValue): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return undefined;
  const text =
    typeof data.response === 'string'
      ? data.response
      : typeof data.comment === 'string'
        ? data.comment
        : data.agentInput &&
            typeof data.agentInput === 'object' &&
            !Array.isArray(data.agentInput) &&
            typeof data.agentInput.userMessage === 'string'
          ? data.agentInput.userMessage
          : undefined;
  const trimmed = text?.trim();
  return trimmed && trimmed.length <= 16000 ? trimmed : undefined;
}

/** Retains interaction attempts and execution correlation; the CLI admission owner selects pickup. */
@Injectable()
export class AgentInteractionAdmissionService {
  private readonly logger = new Logger(AgentInteractionAdmissionService.name);
  public constructor(
    private readonly prisma: PrismaService,
    private readonly outputAttention: AgentSessionOutputAttentionProjection,
    private readonly executionGrants: ExecutionGrantService,
  ) {}

  /** Stable IDs make each projection retryable after settlement has committed. */
  @Cron(CronExpression.EVERY_MINUTE)
  public async projectSettledSubagents(): Promise<void> {
    const pending = await this.prisma.agentInteraction.findMany({
      where: {
        kind: { in: ['SUBAGENT', 'SESSION_MESSAGE'] },
        state: 'RESULT_READY',
      },
      orderBy: { createdAt: 'asc' },
      take: 25,
      select: { id: true },
    });
    for (const { id } of pending) {
      try {
        await this.projectSettledInteraction(id);
      } catch (error) {
        this.logger.warn(
          `Interaction projection ${id} will retry: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async projectSettledInteraction(id: string): Promise<void> {
    const destination = await this.prisma.$transaction(
      async (tx) => {
        const interaction = await tx.agentInteraction.findUnique({
          where: { id },
          include: {
            attempts: { orderBy: { ordinal: 'desc' }, take: 1 },
          },
        });
        if (!interaction || interaction.state !== 'RESULT_READY') return null;
        const attempt = interaction.attempts[0];
        const rawResult = attempt?.result;
        const result =
          interaction.kind === 'SUBAGENT'
            ? (rawResult as AgentInteractionResult | null)
            : rawResult
              ? this.toSessionMessageResult(
                  attempt.id,
                  attempt.ordinal,
                  rawResult as unknown as AgentInteractionSettledTurn,
                )
              : null;
        const destination = await tx.agentSession.findUnique({
          where: { id: interaction.destinationSessionId },
          select: { conversationId: true, userId: true, title: true },
        });
        if (!attempt || !result || !destination?.conversationId) {
          throw new Error(
            'Settled interaction has no result or delivery Conversation.',
          );
        }
        const completed = result.completedAssistantMessageId
          ? await tx.message.findUnique({
              where: { id: result.completedAssistantMessageId },
            })
          : null;
        const completedData = completed?.data;
        const completedText =
          completedData &&
          typeof completedData === 'object' &&
          !Array.isArray(completedData) &&
          'response' in completedData &&
          typeof completedData.response === 'string'
            ? completedData.response
            : undefined;
        const response =
          result.outcome === 'SUCCEEDED'
            ? (result.outputText ??
              completedText ??
              'The agent completed without a written result.')
            : `Agent interaction ${result.outcome.toLowerCase()}: ${result.failureCode ?? 'No further details were provided.'}`;
        await tx.message.upsert({
          where: { id: interaction.projectionId },
          create: {
            id: interaction.projectionId,
            conversationId: destination.conversationId,
            projectId: interaction.projectId,
            type: 'SYSTEM',
            status: 'completed',
            userId: 'system',
            data: {
              type: 'AGENT',
              response,
              detectedIntent: 'agent_interaction_result',
              intentConfidence: 1,
              agentInteractionId: interaction.id,
              attemptId: attempt.id,
              outcome: result.outcome,
              deliveryMode: interaction.mode,
              result,
            },
          },
          update: {},
        });
        if (interaction.mode === 'BACKGROUND') {
          await tx.notification.upsert({
            where: { id: interaction.projectionId },
            create: {
              id: interaction.projectionId,
              organizationId: interaction.organizationId,
              userId: destination.userId,
              eventType: 'system_message',
              entityId: interaction.destinationSessionId,
              entityType: 'AGENT_SESSION',
              entityTitle: destination.title,
              affectedEntities: [],
              payload: {
                messageId: interaction.projectionId,
                conversationId: destination.conversationId,
                title:
                  interaction.kind === 'SUBAGENT'
                    ? 'Subagent result'
                    : 'Agent Session reply',
                snippet:
                  result.outcome === 'SUCCEEDED'
                    ? 'Research completed'
                    : `Research ${result.outcome.toLowerCase()}`,
              },
              createdAt: new Date(result.settledAt),
              projectId: interaction.projectId,
              conversationId: destination.conversationId,
              correlationId: interaction.id,
            },
            update: {},
          });
        }
        return interaction.mode === 'BACKGROUND'
          ? {
              agentSessionId: interaction.destinationSessionId,
              organizationId: interaction.organizationId,
              projectId: interaction.projectId,
              userId: destination.userId,
            }
          : null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (destination) {
      const attention = await this.outputAttention.transition({
        ...destination,
        state: AgentSessionOutputAttentionState.MessageReady,
      });
      if (attention.outcome === 'schema_mismatch') {
        throw new Error(
          'Subagent output attention projection could not be applied.',
        );
      }
    }
    await this.prisma.agentInteraction.updateMany({
      where: { id, state: 'RESULT_READY' },
      data: { state: 'DELIVERED', revision: { increment: 1 } },
    });
  }

  private toSessionMessageResult(
    attemptId: string,
    ordinal: number,
    settled: AgentInteractionSettledTurn,
  ): AgentInteractionResult {
    return {
      attemptId,
      ordinal,
      outcome:
        settled.terminalOutcome === 'COMPLETED'
          ? 'SUCCEEDED'
          : settled.terminalOutcome === 'ABORTED'
            ? 'CANCELLED'
            : 'FAILED',
      settledAt: settled.settledAt,
      targetSessionId: settled.targetSessionId,
      targetTurnId: settled.targetTurnId,
      completedAssistantMessageId: settled.completedAssistantMessageId,
      reports: settled.reports,
    };
  }

  public async requestSubagent(input: {
    organizationId: string;
    projectId: string;
    sessionId: string;
    userId: UserId;
    controllerBindingSecret: string | undefined;
    request: SubagentInteractionAdmissionRequest;
  }): Promise<AgentInteractionAdmissionResponse> {
    const { organizationId, projectId, sessionId, userId, request } = input;
    if (request.sourceSessionId !== sessionId) {
      throw new BadRequestException(
        'The source session does not match the request path.',
      );
    }
    const session = await this.prisma.agentSession.findUnique({
      where: { id: sessionId },
    });
    if (
      !session ||
      session.organizationId !== organizationId ||
      session.projectId !== projectId
    ) {
      throw new NotFoundException('Agent session not found.');
    }
    if (session.userId !== userId || !session.machineId) {
      throw new ForbiddenException(
        'The user cannot request a child for this Agent Session.',
      );
    }
    if (!session.conversationId) {
      throw new ConflictException(
        'The source Agent Session has no provider or Conversation.',
      );
    }
    // MACHINE_SESSION records which machine owns the child; it is provenance,
    // not execution authority. Controller evidence below is the authority.
    const admissionRequest = {
      id: request.id,
      attemptId: request.attemptId,
      kind: 'SUBAGENT',
      mode: request.mode,
      sourceSessionId: sessionId,
      sourceRunId: request.sourceRunId,
      targetSessionId: sessionId,
      destinationSessionId: sessionId,
      expectedRevision: request.expectedRevision,
      generation: 1,
      idempotencyKey: request.idempotencyKey,
      objective: request.objective,
      authority: {
        kind: 'MACHINE_SESSION',
        machineId: session.machineId,
        sourceSessionId: sessionId,
        targetSessionId: sessionId,
        subagentCapability: request.capability,
      },
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    } satisfies AgentInteractionAdmissionRequest;
    // A retry of an admitted request joins it before any authority is
    // resolved, so retry and reconnect never consume or mint new authority.
    const existing = await this.prisma.agentInteraction.findFirst({
      where: {
        sourceSessionId: sessionId,
        idempotencyKey: request.idempotencyKey,
      },
    });
    if (existing) {
      if (
        existing.id !== request.id ||
        existing.requestFingerprint !==
          this.requestFingerprint(admissionRequest, request.serviceIds)
      ) {
        throw new ConflictException(
          'The idempotency identity is already used by a different interaction.',
        );
      }
      return {
        interaction: await this.readInteraction(existing.id),
        replayed: true,
      };
    }
    const actionPayloadHash = subagentChildPayloadHash({
      interactionId: request.id,
      attemptId: request.attemptId,
      sourceSessionId: sessionId,
      sourceRunId: request.sourceRunId,
      mode: request.mode,
      capability: request.capability,
      objective: request.objective,
      serviceIds: request.serviceIds,
    });
    const admitted = await this.executionGrants.assertAgentSessionAuthorized({
      authorization: request.authorization,
      organizationId: organizationId as OrganizationId,
      projectId: projectId as ProjectId,
      userId,
      actionCategory: HostActionCategory.Conversation,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: HostActionTargetKind.AgentSession,
      agentSessionId: sessionId as AgentSessionId,
      conversationId: session.conversationId,
      machineId: session.machineId as MachineId,
      controllerBindingSecret: input.controllerBindingSecret,
    });
    return this.admitInteraction({
      organizationId,
      projectId,
      machine: { machineId: session.machineId as MachineId, userId },
      request: admissionRequest,
      retainedAuthorization: {
        authorizationId: admitted.authorizationId,
        envelopeAuthorization: admitted.envelopeAuthorization,
        actionPayloadHash,
      },
      childServiceIds: request.serviceIds,
    });
  }

  private requestFingerprint(
    request: AgentInteractionAdmissionRequest,
    childServiceIds: string[] | undefined,
  ): string {
    return createHash('sha256')
      .update(
        canonicalizeJcs(
          childServiceIds ? { request, childServiceIds } : request,
        ),
      )
      .digest('hex');
  }

  /** Reads retained evidence by its persisted kind; legacy attempts carry none. */
  private retainedSubagentEvidence(
    attempt: AgentInteractionAttempt,
  ): Pick<SubagentDispatch, 'authorization' | 'actionPayloadHash'> {
    if (attempt.authorizationKind === null) {
      return { authorization: null, actionPayloadHash: null };
    }
    const envelope =
      attempt.envelopeAuthorization as unknown as ExecutableEnvelopeAuthorization | null;
    const consistent = (() => {
      if (!envelope || !attempt.authorizationId || !attempt.actionPayloadHash)
        return false;
      switch (attempt.authorizationKind) {
        case 'controller_assertion':
          return (
            envelope.kind === 'controller_assertion' &&
            envelope.intent.authorizationId === attempt.authorizationId
          );
        case 'bounded_grant':
          return envelope.kind === 'bounded_grant';
        default:
          return false;
      }
    })();
    if (!consistent) {
      throw new ConflictException(
        'The child attempt retained inconsistent controller evidence.',
      );
    }
    return {
      authorization: envelope,
      actionPayloadHash: attempt.actionPayloadHash,
    };
  }

  public async requestSessionMessage(input: {
    organizationId: string;
    projectId: string;
    sessionId: string;
    userId: UserId;
    request: SessionMessageInteractionAdmissionRequest;
  }): Promise<AgentInteractionAdmissionResponse> {
    const { organizationId, projectId, sessionId, userId, request } = input;
    if (request.sourceSessionId !== sessionId) {
      throw new BadRequestException(
        'The source session does not match the request path.',
      );
    }
    const command = parseSessionMessageCommand(request.commandText);
    if (command.targetSessionId !== request.targetSessionId) {
      throw new BadRequestException(
        'The target session does not match the canonical mention.',
      );
    }
    const sessions = await this.prisma.agentSession.findMany({
      where: { id: { in: [sessionId, request.targetSessionId] } },
    });
    if (
      sessions.length !== new Set([sessionId, request.targetSessionId]).size
    ) {
      throw new NotFoundException('An interaction session was not found.');
    }
    const target = sessions.find(
      (session) => session.id === request.targetSessionId,
    );
    if (
      !target ||
      !target.machineId ||
      sessions.some(
        (session) =>
          session.organizationId !== organizationId ||
          session.projectId !== projectId ||
          session.userId !== userId,
      )
    ) {
      throw new ForbiddenException(
        'The user cannot address these Agent Sessions.',
      );
    }
    const activeRegistry = await this.prisma.entityRegistry.count({
      where: {
        organizationId,
        entityType: 'AGENT_SESSION',
        entityId: { in: [sessionId, request.targetSessionId] },
        deletedAt: null,
      },
    });
    if (activeRegistry !== new Set([sessionId, request.targetSessionId]).size) {
      throw new NotFoundException(
        'An Agent Session is archived or unavailable.',
      );
    }
    let verifiedAnswerText: string | undefined;
    if (command.answerReference) {
      const answer = await this.prisma.message.findUnique({
        where: { id: command.answerReference },
      });
      if (
        !answer ||
        answer.projectId !== projectId ||
        !sessions.some(
          (session) => session.conversationId === answer.conversationId,
        )
      ) {
        throw new BadRequestException(
          'The answer reference is outside the interaction sessions.',
        );
      }
      verifiedAnswerText = referencedMessageText(answer.data);
      if (!verifiedAnswerText) {
        throw new BadRequestException(
          'The answer reference has no bounded readable text.',
        );
      }
    }
    return this.admitInteraction({
      organizationId,
      projectId,
      machine: { machineId: target.machineId as MachineId, userId },
      userAuthorizedSessionMessage: true,
      verifiedAnswerText,
      request: {
        id: request.id,
        attemptId: request.attemptId,
        kind: 'SESSION_MESSAGE',
        mode: 'FOREGROUND',
        sourceSessionId: sessionId,
        destinationSessionId: sessionId,
        expectedRevision: request.expectedRevision,
        generation: 1,
        idempotencyKey: request.idempotencyKey,
        authority: {
          kind: 'MACHINE_SESSION',
          machineId: target.machineId,
          sourceSessionId: sessionId,
          targetSessionId: request.targetSessionId,
          subagentCapability: 'RESEARCH',
        },
        ...command,
      } satisfies AgentInteractionAdmissionRequest,
    });
  }

  public async getOwnedInteraction(input: {
    organizationId: string;
    projectId: string;
    interactionId: string;
    userId: UserId;
  }): Promise<AgentInteractionDto> {
    const row = await this.prisma.agentInteraction.findUnique({
      where: { id: input.interactionId },
      include: { sourceSession: { select: { userId: true } } },
    });
    if (
      !row ||
      row.organizationId !== input.organizationId ||
      row.projectId !== input.projectId ||
      row.sourceSession.userId !== input.userId
    ) {
      throw new NotFoundException('Agent interaction not found.');
    }
    return this.readInteraction(row.id);
  }

  public async cancelOwnedSubagent(input: {
    organizationId: string;
    projectId: string;
    interactionId: string;
    userId: UserId;
    expectedRevision: number;
  }): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.agentInteraction.findUnique({
          where: { id: input.interactionId },
          include: {
            sourceSession: { select: { userId: true } },
            attempts: {
              orderBy: { ordinal: 'desc' },
              take: 1,
              include: { effects: true },
            },
          },
        });
        if (
          !row ||
          row.organizationId !== input.organizationId ||
          row.projectId !== input.projectId ||
          row.sourceSession.userId !== input.userId
        ) {
          throw new NotFoundException('Agent interaction not found.');
        }
        if (row.kind !== 'SUBAGENT')
          throw new BadRequestException(
            'Only child interactions can be cancelled here.',
          );
        if (row.state !== 'DISPATCHING' && row.state !== 'WAITING')
          return false;
        if (row.revision !== input.expectedRevision)
          throw new ConflictException('The interaction revision changed.');
        const attempt = row.attempts[0];
        const effect = attempt?.effects.find(
          (candidate) => candidate.kind === 'SPAWN_SUBAGENT',
        );
        if (!attempt || !effect || !attempt.targetTurnId) {
          throw new ConflictException(
            'The admitted child attempt is incomplete.',
          );
        }
        const now = new Date();
        const result = {
          attemptId: attempt.id,
          ordinal: attempt.ordinal,
          outcome: 'CANCELLED',
          settledAt: now.toISOString(),
          targetSessionId: attempt.targetSessionId,
          targetTurnId: attempt.targetTurnId,
          completedAssistantMessageId: null,
          reports: [],
          failureCode: 'USER_CANCELLED',
        } satisfies AgentInteractionResult;
        const advanced = await tx.agentInteraction.updateMany({
          where: {
            id: row.id,
            revision: input.expectedRevision,
            state: row.state,
          },
          data: {
            state: 'RESULT_READY',
            revision: { increment: 1 },
            cancelledAt: now,
          },
        });
        if (advanced.count !== 1)
          throw new ConflictException(
            'The interaction changed during cancellation.',
          );
        await tx.agentInteractionAttempt.update({
          where: { id: attempt.id },
          data: {
            state: 'CANCELLED',
            result: result as unknown as Prisma.InputJsonValue,
            settledAt: now,
          },
        });
        await tx.agentInteractionEffect.update({
          where: { id: effect.id },
          data: {
            state: AgentInteractionEffectState.Cancelled,
            outcome: result as unknown as Prisma.InputJsonValue,
            claimExpiresAt: null,
          },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async claimSubagentDispatch(input: {
    organizationId: string;
    projectId: string;
    machine: AuthenticatedMachine;
  }): Promise<SubagentDispatch | null> {
    const { organizationId, projectId, machine } = input;
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const expired = await tx.agentInteractionEffect.findFirst({
              where: {
                kind: 'SPAWN_SUBAGENT',
                state: AgentInteractionEffectState.Claimed,
                claimExpiresAt: { lte: new Date() },
                interaction: {
                  organizationId,
                  projectId,
                  admittingMachineId: machine.machineId,
                  state: 'WAITING',
                },
              },
              include: { interaction: true, attempt: true },
              orderBy: { claimExpiresAt: 'asc' },
            });
            if (expired && expired.attempt.targetTurnId) {
              const now = new Date();
              const result = {
                attemptId: expired.attemptId,
                ordinal: expired.attempt.ordinal,
                outcome: 'EXPIRED',
                settledAt: now.toISOString(),
                targetSessionId: expired.attempt.targetSessionId,
                targetTurnId: expired.attempt.targetTurnId,
                completedAssistantMessageId: null,
                reports: [],
                failureCode: 'DISPATCH_LEASE_EXPIRED',
              } satisfies AgentInteractionResult;
              const updated = await tx.agentInteractionEffect.updateMany({
                where: {
                  id: expired.id,
                  state: AgentInteractionEffectState.Claimed,
                  claimExpiresAt: { lte: now },
                },
                data: {
                  state: AgentInteractionEffectState.Failed,
                  outcome: result as unknown as Prisma.InputJsonValue,
                },
              });
              if (updated.count !== 1)
                throw new ConflictException(
                  'The child lease changed during expiry.',
                );
              await tx.agentInteractionAttempt.update({
                where: { id: expired.attemptId },
                data: {
                  state: 'EXPIRED',
                  result: result as unknown as Prisma.InputJsonValue,
                  settledAt: now,
                },
              });
              await tx.agentInteraction.update({
                where: { id: expired.interactionId },
                data: { state: 'RESULT_READY', revision: { increment: 1 } },
              });
              return null;
            }
            const effect = await tx.agentInteractionEffect.findFirst({
              where: {
                kind: 'SPAWN_SUBAGENT',
                state: AgentInteractionEffectState.Pending,
                interaction: {
                  organizationId,
                  projectId,
                  admittingMachineId: machine.machineId,
                  state: 'DISPATCHING',
                },
              },
              include: { interaction: true, attempt: true },
              orderBy: { createdAt: 'asc' },
            });
            if (!effect) return null;
            const leaseToken = randomUUID();
            const claimed = await tx.agentInteractionEffect.updateMany({
              where: {
                id: effect.id,
                state: AgentInteractionEffectState.Pending,
              },
              data: {
                state: AgentInteractionEffectState.Claimed,
                claimOwner: leaseToken,
                claimExpiresAt: new Date(Date.now() + 60_000),
                attemptCount: { increment: 1 },
              },
            });
            if (claimed.count !== 1)
              throw new ConflictException(
                'The child dispatch was claimed concurrently.',
              );
            const accepted = await tx.agentInteractionAttempt.updateMany({
              where: {
                id: effect.attemptId,
                interactionId: effect.interactionId,
                generation: effect.generation,
                state: 'PENDING',
              },
              data: { state: 'ACCEPTED' },
            });
            if (accepted.count !== 1)
              throw new ConflictException(
                'The child attempt is no longer pending.',
              );
            const advanced = await tx.agentInteraction.updateMany({
              where: {
                id: effect.interactionId,
                generation: effect.generation,
                revision: effect.interaction.revision,
                state: 'DISPATCHING',
              },
              data: { state: 'WAITING', revision: { increment: 1 } },
            });
            if (advanced.count !== 1)
              throw new ConflictException(
                'The child interaction changed before acceptance.',
              );
            const authority = effect.attempt
              .authority as unknown as AgentInteractionAuthority;
            const sourceExecutionContext = (
              effect.attempt.authority as Record<string, unknown>
            )['sourceExecutionContext'] as
              | SubagentDispatch['sourceExecutionContext']
              | undefined;
            const childScope = (
              effect.attempt.authority as Record<string, unknown>
            )['childScope'] as SubagentChildScope | undefined;
            if (
              !authority.subagentCapability ||
              !effect.attempt.targetTurnId ||
              !effect.interaction.sourceRunId ||
              !effect.attempt.objective ||
              !sourceExecutionContext
            ) {
              throw new ConflictException(
                'The child dispatch is missing its admitted capability or source execution context.',
              );
            }
            return {
              interactionId: effect.interactionId,
              attemptId: effect.attemptId,
              effectId: effect.id,
              leaseToken,
              sourceSessionId: effect.interaction.sourceSessionId,
              sourceRunId: effect.interaction.sourceRunId,
              sourceExecutionContext,
              ...(childScope ? { childScope } : {}),
              targetTurnId: effect.attempt.targetTurnId,
              mode: effect.interaction.mode as SubagentDispatch['mode'],
              capability: authority.subagentCapability,
              objective: effect.attempt.objective,
              generation: effect.generation,
              ...this.retainedSubagentEvidence(effect.attempt),
            } satisfies SubagentDispatch;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          retry === 2 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034'
        )
          throw error;
      }
    }
    throw new ConflictException('The child dispatch could not be claimed.');
  }

  public async listMachineDispatchScopes(
    machine: AuthenticatedMachine,
  ): Promise<
    Array<{
      organizationId: string;
      projectId: string;
    }>
  > {
    const interactions = await this.prisma.agentInteraction.findMany({
      where: {
        admittingMachineId: machine.machineId,
        kind: 'SUBAGENT',
        state: { in: ['DISPATCHING', 'WAITING', 'RESULT_READY', 'DELIVERING'] },
      },
      distinct: ['organizationId', 'projectId'],
      select: { organizationId: true, projectId: true },
    });
    return interactions;
  }

  public async listSessionMessageTargets(
    machine: AuthenticatedMachine,
  ): Promise<
    Array<{
      organizationId: string;
      userId: string;
      projectId: string;
      targetSessionId: string;
      admissionId: string;
      turnId?: string;
      admission: TurnAdmission;
    }>
  > {
    const pending = await this.prisma.agentSessionTurnAdmission.findMany({
      where: {
        source: 'AGENT_INTERACTION',
        state: { in: ['QUEUED', 'OCCUPIED'] },
        interactionAttempt: {
          interaction: {
            kind: 'SESSION_MESSAGE',
            admittingMachineId: machine.machineId,
          },
        },
      },
      include: {
        agentSession: {
          select: {
            organizationId: true,
            projectId: true,
            userId: true,
            machineId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const targets = [];
    for (const admission of pending) {
      if (
        admission.agentSession.machineId !== machine.machineId ||
        admission.agentSession.userId !== machine.userId
      )
        continue;
      targets.push({
        userId: admission.agentSession.userId,
        organizationId: admission.agentSession.organizationId,
        projectId: admission.agentSession.projectId,
        targetSessionId: admission.agentSessionId,
        admissionId: admission.id,
        admission: {
          id: admission.id,
          agentSessionId: admission.agentSessionId,
          source: 'AGENT_INTERACTION',
          state: admission.state === 'QUEUED' ? 'QUEUED' : 'OCCUPIED',
          ordinal: admission.ordinal,
          generation: admission.generation,
          idempotencyKey: admission.idempotencyKey,
          authorKind: admission.authorKind as TurnAdmission['authorKind'],
          ...(admission.authorUserId
            ? { authorUserId: admission.authorUserId }
            : {}),
          ...(admission.inputMessageId
            ? { inputMessageId: admission.inputMessageId }
            : {}),
          ...(admission.interactionAttemptId
            ? { interactionAttemptId: admission.interactionAttemptId }
            : {}),
          ...(admission.sessionMessageInput
            ? {
                sessionMessageInput:
                  admission.sessionMessageInput as unknown as SessionMessageInput,
              }
            : {}),
          ...(admission.turnId ? { turnId: admission.turnId } : {}),
          createdAt: admission.createdAt.toISOString(),
        } satisfies TurnAdmission,
        ...(admission.turnId ? { turnId: admission.turnId } : {}),
      });
    }
    return targets;
  }

  public async listMachineForegroundWaits(input: {
    organizationId: string;
    projectId: string;
    machine: AuthenticatedMachine;
  }): Promise<
    Array<{
      interactionId: string;
      sourceSessionId: string;
      sourceRunId: string;
    }>
  > {
    const rows = await this.prisma.agentInteraction.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        admittingMachineId: input.machine.machineId,
        kind: 'SUBAGENT',
        mode: 'FOREGROUND',
        state: { in: ['WAITING', 'RESULT_READY', 'DELIVERING'] },
        sourceRunId: { not: null },
      },
      select: { id: true, sourceSessionId: true, sourceRunId: true },
    });
    return rows.flatMap((row) =>
      row.sourceRunId
        ? [
            {
              interactionId: row.id,
              sourceSessionId: row.sourceSessionId,
              sourceRunId: row.sourceRunId,
            },
          ]
        : [],
    );
  }

  public async heartbeatSubagentDispatch(input: {
    organizationId: string;
    projectId: string;
    effectId: string;
    leaseToken: string;
    machine: AuthenticatedMachine;
  }): Promise<boolean> {
    const updated = await this.prisma.agentInteractionEffect.updateMany({
      where: {
        id: input.effectId,
        kind: 'SPAWN_SUBAGENT',
        state: AgentInteractionEffectState.Claimed,
        claimOwner: input.leaseToken,
        claimExpiresAt: { gt: new Date() },
        interaction: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          admittingMachineId: input.machine.machineId,
          state: 'WAITING',
        },
      },
      data: { claimExpiresAt: new Date(Date.now() + 60_000) },
    });
    return updated.count === 1;
  }

  public async settleSubagentDispatch(input: {
    organizationId: string;
    projectId: string;
    effectId: string;
    machine: AuthenticatedMachine;
    evidence: SubagentSettledAttempt;
  }): Promise<boolean> {
    const { organizationId, projectId, effectId, machine, evidence } = input;
    const settledInteractionId = await this.prisma.$transaction(
      async (tx) => {
        const effect = await tx.agentInteractionEffect.findUnique({
          where: { id: effectId },
          include: { interaction: true, attempt: true },
        });
        if (
          !effect ||
          effect.kind !== 'SPAWN_SUBAGENT' ||
          effect.state !== (AgentInteractionEffectState.Claimed as string) ||
          effect.claimOwner !== evidence.leaseToken ||
          !effect.claimExpiresAt ||
          effect.claimExpiresAt <= new Date() ||
          effect.generation !== evidence.generation ||
          effect.attempt.targetTurnId !== evidence.targetTurnId ||
          effect.attempt.state !== 'ACCEPTED' ||
          effect.interaction.state !== 'WAITING' ||
          effect.interaction.generation !== evidence.generation ||
          effect.interaction.organizationId !== organizationId ||
          effect.interaction.projectId !== projectId ||
          effect.interaction.admittingMachineId !== machine.machineId
        )
          return false;
        const result = {
          attemptId: effect.attemptId,
          ordinal: effect.attempt.ordinal,
          outcome: evidence.outcome,
          settledAt: evidence.settledAt,
          targetSessionId: effect.attempt.targetSessionId,
          targetTurnId: evidence.targetTurnId,
          completedAssistantMessageId: null,
          reports: [],
          ...(evidence.outputText !== undefined
            ? { outputText: evidence.outputText }
            : {}),
          ...(evidence.failureCode !== undefined
            ? { failureCode: evidence.failureCode }
            : {}),
        } satisfies AgentInteractionResult;
        await tx.agentInteractionAttempt.update({
          where: { id: effect.attemptId },
          data: {
            state: evidence.outcome,
            result: result as unknown as Prisma.InputJsonValue,
            settledAt: new Date(evidence.settledAt),
          },
        });
        await tx.agentInteractionEffect.update({
          where: { id: effect.id },
          data: {
            state: SUBAGENT_EFFECT_OUTCOMES[evidence.outcome],
            outcome: result as unknown as Prisma.InputJsonValue,
            claimExpiresAt: null,
          },
        });
        await tx.agentInteraction.update({
          where: { id: effect.interactionId },
          data: { state: 'RESULT_READY', revision: { increment: 1 } },
        });
        return effect.interaction.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!settledInteractionId) return false;
    try {
      await this.projectSettledInteraction(settledInteractionId);
    } catch (error) {
      this.logger.warn(
        `Interaction projection ${settledInteractionId} will retry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return true;
  }

  public async admitInteraction(input: {
    organizationId: string;
    projectId: string;
    machine: AuthenticatedMachine;
    request: AgentInteractionAdmissionRequest;
    /** Controller evidence admitted for a browser `/subagent` request. */
    retainedAuthorization?: RetainedSubagentAuthorization;
    userAuthorizedSessionMessage?: boolean;
    verifiedAnswerText?: string;
    /** Child Service set submitted with a user `/subagent` request. */
    childServiceIds?: string[];
  }): Promise<AgentInteractionAdmissionResponse> {
    const { organizationId, projectId, machine, request, childServiceIds } =
      input;
    if (request.kind === 'SUPERVISION') {
      throw new ForbiddenException(
        'Ongoing supervision is not admitted in this release.',
      );
    }
    if (
      request.kind === 'SESSION_MESSAGE' &&
      !input.userAuthorizedSessionMessage
    ) {
      throw new ForbiddenException(
        'Session-message admission requires the verified command boundary.',
      );
    }
    if (
      request.kind === 'SESSION_MESSAGE' &&
      request.authority.subagentCapability !== 'RESEARCH'
    ) {
      throw new ForbiddenException(
        'Session-message authority admits only bounded research.',
      );
    }
    if (
      request.kind === 'SESSION_MESSAGE' &&
      request.answerReference &&
      !input.verifiedAnswerText
    ) {
      throw new BadRequestException(
        'The referenced Message text must be verified before admission.',
      );
    }
    if (
      (request.objective === undefined) ===
      (request.answerReference === undefined)
    ) {
      throw new BadRequestException(
        'Exactly one objective or answer reference is required.',
      );
    }
    if (
      request.kind === 'SUBAGENT' &&
      (!input.retainedAuthorization ||
        request.authority.subagentCapability !== 'RESEARCH' ||
        !request.sourceRunId)
    ) {
      throw new ForbiddenException(
        'Subagent admission requires admitted controller authorization and a supported child capability.',
      );
    }
    if (request.kind !== 'SUBAGENT' && input.retainedAuthorization) {
      throw new BadRequestException(
        'Retained controller evidence is only accepted by subagent admission.',
      );
    }
    if ((request.kind === 'SUBAGENT') !== (childServiceIds !== undefined)) {
      throw new BadRequestException(
        'A child Service set is required for, and only accepted by, subagent admission.',
      );
    }
    if (request.expectedRevision !== 0 || request.generation !== 1) {
      throw new ConflictException(
        'The first interaction attempt requires revision 0 and generation 1.',
      );
    }
    if (
      request.authority.sourceSessionId !== request.sourceSessionId ||
      request.authority.targetSessionId !== request.targetSessionId ||
      request.authority.machineId !== machine.machineId
    ) {
      throw new BadRequestException(
        'The authority envelope does not match the interaction source and target.',
      );
    }
    if (
      request.expiresAt &&
      new Date(request.expiresAt).getTime() <= Date.now()
    ) {
      throw new BadRequestException('The interaction has expired.');
    }
    if (
      request.authority.expiresAt &&
      new Date(request.authority.expiresAt).getTime() <= Date.now()
    ) {
      throw new ForbiddenException(
        'The machine-bound interaction authority has expired.',
      );
    }
    const fingerprint = this.requestFingerprint(request, childServiceIds);
    const retained = input.retainedAuthorization;
    const admit = async () =>
      this.prisma.$transaction(
        async (tx) => {
          const sessions = await tx.agentSession.findMany({
            where: {
              id: {
                in: [
                  request.sourceSessionId,
                  request.targetSessionId,
                  request.destinationSessionId,
                ],
              },
            },
          });
          if (
            sessions.length !==
            new Set([
              request.sourceSessionId,
              request.targetSessionId,
              request.destinationSessionId,
            ]).size
          ) {
            throw new NotFoundException(
              'An interaction session was not found.',
            );
          }
          if (
            sessions.some(
              (session) =>
                session.organizationId !== organizationId ||
                session.projectId !== projectId ||
                session.userId !== machine.userId ||
                (session.machineId !== machine.machineId &&
                  !(
                    input.userAuthorizedSessionMessage &&
                    session.id === request.sourceSessionId
                  )),
            )
          ) {
            throw new ForbiddenException(
              'The machine cannot admit work for these sessions.',
            );
          }
          if (request.kind === 'SESSION_MESSAGE') {
            const activeRegistry = await tx.entityRegistry.count({
              where: {
                organizationId,
                entityType: 'AGENT_SESSION',
                entityId: {
                  in: [request.sourceSessionId, request.targetSessionId],
                },
                deletedAt: null,
              },
            });
            if (
              activeRegistry !==
              new Set([request.sourceSessionId, request.targetSessionId]).size
            ) {
              throw new NotFoundException(
                'An Agent Session is archived or unavailable.',
              );
            }
          }
          if (request.authority.kind !== 'MACHINE_SESSION') {
            throw new ForbiddenException(
              'Only machine-bound session authority is supported for interaction admission.',
            );
          }
          const source = sessions.find(
            (session) => session.id === request.sourceSessionId,
          );
          if (!source)
            throw new NotFoundException(
              'The source Agent Session was not found.',
            );
          let sourceExecutionContext:
            | SubagentDispatch['sourceExecutionContext']
            | undefined;
          let childScope: SubagentChildScope | undefined;
          if (request.kind === 'SUBAGENT' && childServiceIds) {
            if (childServiceIds.length > 0) {
              const services = await tx.service.count({
                where: {
                  id: { in: childServiceIds },
                  organizationId,
                  projectId,
                  archivedAt: null,
                },
              });
              if (services !== childServiceIds.length) {
                throw new BadRequestException(
                  'Every child Service must belong to this project.',
                );
              }
            }
            const launchServiceId =
              source.serviceId && childServiceIds.includes(source.serviceId)
                ? source.serviceId
                : childServiceIds[0];
            childScope = {
              serviceIds: childServiceIds,
              ...(launchServiceId ? { launchServiceId } : {}),
            };
          }
          if (request.kind === 'SUBAGENT') {
            if (!source.provider || !source.conversationId) {
              throw new ConflictException(
                'The source Agent Session has no provider or Conversation.',
              );
            }
            const serviceRelations = await tx.serviceAgentSession.findMany({
              where: { agentSessionId: source.id },
              select: { serviceId: true },
            });
            sourceExecutionContext = {
              provider: source.provider,
              conversationId: source.conversationId,
              createdAt: source.createdAt.toISOString(),
              ...(source.serviceId
                ? { launchServiceId: source.serviceId }
                : {}),
              serviceIds: [
                ...new Set([
                  ...(source.serviceId ? [source.serviceId] : []),
                  ...serviceRelations.map((relation) => relation.serviceId),
                ]),
              ],
              ...(source.entityType && source.entityId
                ? { entityType: source.entityType, entityId: source.entityId }
                : {}),
            };
          }
          const existing = await tx.agentInteraction.findFirst({
            where: {
              sourceSessionId: request.sourceSessionId,
              idempotencyKey: request.idempotencyKey,
            },
          });
          if (existing) {
            if (
              existing.id !== request.id ||
              existing.requestFingerprint !== fingerprint
            ) {
              throw new ConflictException(
                'The idempotency identity is already used by a different interaction.',
              );
            }
            return { interaction: existing, replayed: true };
          }
          const interaction = await tx.agentInteraction.create({
            data: {
              id: request.id,
              organizationId,
              projectId,
              sourceSessionId: request.sourceSessionId,
              targetSessionId: request.targetSessionId,
              destinationSessionId: request.destinationSessionId,
              sourceRunId: request.sourceRunId,
              sourceTurnId: request.sourceTurnId,
              kind: request.kind,
              mode: request.mode,
              state: 'DISPATCHING',
              revision: 1,
              generation: 1,
              idempotencyKey: request.idempotencyKey,
              requestFingerprint: fingerprint,
              admittingMachineId: machine.machineId,
              projectionId: randomUUID(),
              expiresAt: request.expiresAt ? new Date(request.expiresAt) : null,
            },
          });
          await tx.agentInteractionAttempt.create({
            data: {
              id: request.attemptId,
              interactionId: interaction.id,
              ordinal: 1,
              targetSessionId: request.targetSessionId,
              ...(request.kind === 'SUBAGENT'
                ? { targetTurnId: randomUUID() }
                : {}),
              generation: 1,
              state: 'PENDING',
              authority: {
                ...request.authority,
                ...(sourceExecutionContext ? { sourceExecutionContext } : {}),
                ...(childScope ? { childScope } : {}),
              } as unknown as Prisma.InputJsonValue,
              objective: request.objective,
              answerReference: request.answerReference,
              ...(retained
                ? {
                    authorizationKind: retained.envelopeAuthorization.kind,
                    authorizationId: retained.authorizationId,
                    envelopeAuthorization:
                      retained.envelopeAuthorization as unknown as Prisma.InputJsonValue,
                    actionPayloadHash: retained.actionPayloadHash,
                  }
                : {}),
            },
          });
          if (request.kind !== 'SUBAGENT') {
            const sessionMessageInput = {
              sourceSessionId: request.sourceSessionId,
              interactionId: request.id,
              attemptId: request.attemptId,
              authorKind: 'AGENT',
              authority: request.authority,
              ...(request.objective ? { objective: request.objective } : {}),
              ...(request.answerReference
                ? { answerReference: request.answerReference }
                : {}),
              ...(input.verifiedAnswerText
                ? { answerText: input.verifiedAnswerText }
                : {}),
            } satisfies SessionMessageInput;
            await this.enqueue(tx, {
              id: randomUUID(),
              sessionId: request.targetSessionId,
              source: 'AGENT_INTERACTION',
              authorKind: 'AGENT',
              attemptId: request.attemptId,
              sessionMessageInput,
              idempotencyKey: `interaction:${request.attemptId}`,
            });
          }
          await tx.agentInteractionEffect.create({
            data: {
              id: randomUUID(),
              interactionId: interaction.id,
              attemptId: request.attemptId,
              generation: 1,
              kind:
                request.kind === 'SUBAGENT'
                  ? 'SPAWN_SUBAGENT'
                  : 'DISPATCH_ADMITTED_HEAD',
              // Dispatch must be claimable before the target claims its Turn.
              state: AgentInteractionEffectState.Pending,
            },
          });
          return { interaction, replayed: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        const result = await admit();
        return {
          interaction: await this.readInteraction(result.interaction.id),
          replayed: result.replayed,
        };
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          (error.code !== 'P2002' && error.code !== 'P2034')
        )
          throw error;
        const existing = await this.prisma.agentInteraction.findFirst({
          where: {
            sourceSessionId: request.sourceSessionId,
            idempotencyKey: request.idempotencyKey,
          },
        });
        if (
          existing?.id === request.id &&
          existing.requestFingerprint === fingerprint
        ) {
          return {
            interaction: await this.readInteraction(existing.id),
            replayed: true,
          };
        }
        if (existing || retry === 2) {
          throw new ConflictException(
            'Concurrent admission changed this interaction or session order.',
          );
        }
      }
    }
    throw new ConflictException(
      'Interaction admission could not establish a stable session order.',
    );
  }

  private async readInteraction(id: string): Promise<AgentInteractionDto> {
    const row = await this.prisma.agentInteraction.findUniqueOrThrow({
      where: { id },
      include: {
        attempts: { orderBy: { ordinal: 'asc' }, include: { effects: true } },
      },
    });
    return {
      id: row.id,
      projectId: row.projectId,
      kind: row.kind as AgentInteractionDto['kind'],
      mode: row.mode as AgentInteractionDto['mode'],
      sourceSessionId: row.sourceSessionId,
      ...(row.sourceRunId ? { sourceRunId: row.sourceRunId } : {}),
      ...(row.sourceTurnId ? { sourceTurnId: row.sourceTurnId } : {}),
      targetSessionId: row.targetSessionId,
      destinationSessionId: row.destinationSessionId,
      state: row.state as AgentInteractionState,
      revision: row.revision,
      generation: row.generation,
      idempotencyKey: row.idempotencyKey,
      projectionId: row.projectionId,
      ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
      ...(row.cancelledAt
        ? { cancelledAt: row.cancelledAt.toISOString() }
        : {}),
      createdAt: row.createdAt.toISOString(),
      attempts: row.attempts.map((attempt) => {
        const settled =
          attempt.result as unknown as AgentInteractionSettledTurn | null;
        const result: AgentInteractionResult | undefined =
          row.kind === 'SUBAGENT'
            ? (attempt.result as unknown as AgentInteractionResult | undefined)
            : settled
              ? {
                  attemptId: attempt.id,
                  ordinal: attempt.ordinal,
                  outcome:
                    settled.terminalOutcome === 'COMPLETED'
                      ? 'SUCCEEDED'
                      : settled.terminalOutcome === 'ABORTED'
                        ? 'CANCELLED'
                        : 'FAILED',
                  settledAt: settled.settledAt,
                  targetSessionId: settled.targetSessionId,
                  targetTurnId: settled.targetTurnId,
                  completedAssistantMessageId:
                    settled.completedAssistantMessageId,
                  reports: settled.reports,
                }
              : undefined;
        const dispatch = attempt.effects.find((effect) =>
          row.kind === 'SUBAGENT'
            ? effect.kind === 'SPAWN_SUBAGENT'
            : effect.kind === 'DISPATCH_ADMITTED_HEAD',
        );
        if (!dispatch)
          throw new Error('Admitted attempt is missing its dispatch effect.');
        return {
          id: attempt.id,
          interactionId: attempt.interactionId,
          ordinal: attempt.ordinal,
          targetSessionId: attempt.targetSessionId,
          ...(attempt.targetTurnId
            ? { targetTurnId: attempt.targetTurnId }
            : {}),
          state: attempt.state as AgentInteractionAttemptState,
          generation: attempt.generation,
          authority: attempt.authority as unknown as AgentInteractionAuthority,
          dispatchEffectId: dispatch.id,
          ...(result ? { result } : {}),
        };
      }),
    } satisfies AgentInteractionDto;
  }

  private async enqueue(
    tx: Tx,
    input: {
      id: string;
      sessionId: string;
      source: TurnSource;
      authorKind: TurnAuthor;
      idempotencyKey: string;
      authorUserId?: string;
      attemptId?: string;
      sessionMessageInput?: SessionMessageInput;
      inputMessageId?: string;
    },
  ): Promise<AgentSessionTurnAdmission> {
    await tx.agentSessionTurnSlot.upsert({
      where: { agentSessionId: input.sessionId },
      create: { agentSessionId: input.sessionId },
      update: {},
    });
    await tx.$queryRaw`SELECT agent_session_id FROM agent_session_turn_slots WHERE agent_session_id = ${input.sessionId} FOR UPDATE`;
    const existing = await tx.agentSessionTurnAdmission.findUnique({
      where: {
        agentSessionId_idempotencyKey: {
          agentSessionId: input.sessionId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.id !== input.id ||
        existing.source !== input.source ||
        existing.authorKind !== input.authorKind ||
        existing.authorUserId !== (input.authorUserId ?? null) ||
        existing.interactionAttemptId !== (input.attemptId ?? null) ||
        existing.inputMessageId !== (input.inputMessageId ?? null)
      ) {
        throw new ConflictException(
          'The Turn admission identity has conflicting provenance.',
        );
      }
      return existing;
    }
    const slot = await tx.agentSessionTurnSlot.findUniqueOrThrow({
      where: { agentSessionId: input.sessionId },
    });
    const admission = await tx.agentSessionTurnAdmission.create({
      data: {
        id: input.id,
        agentSessionId: input.sessionId,
        source: input.source,
        state: 'QUEUED',
        ordinal: slot.nextOrdinal,
        generation: 1,
        idempotencyKey: input.idempotencyKey,
        authorKind: input.authorKind,
        authorUserId: input.authorUserId,
        interactionAttemptId: input.attemptId,
        sessionMessageInput: input.sessionMessageInput as
          | Prisma.InputJsonValue
          | undefined,
        inputMessageId: input.inputMessageId,
      },
    });
    await tx.agentSessionTurnSlot.update({
      where: { agentSessionId: input.sessionId },
      data: { nextOrdinal: { increment: 1 }, revision: { increment: 1 } },
    });
    return admission;
  }

  public async occupyHead(input: {
    organizationId: string;
    projectId: string;
    sessionId: string;
    turnId: string;
    admissionId?: string;
    machine: AuthenticatedMachine;
  }): Promise<AgentSessionTurnAdmission | null> {
    const { organizationId, projectId, sessionId, turnId, machine } = input;
    return this.prisma.$transaction(
      async (tx) => {
        const session = await tx.agentSession.findUnique({
          where: { id: sessionId },
        });
        if (
          !session ||
          session.organizationId !== organizationId ||
          session.projectId !== projectId ||
          session.userId !== machine.userId ||
          session.machineId !== machine.machineId
        ) {
          throw new ForbiddenException(
            'The machine does not own the Agent Session Turn slot.',
          );
        }
        await tx.$queryRaw`SELECT agent_session_id FROM agent_session_turn_slots WHERE agent_session_id = ${sessionId} FOR UPDATE`;
        const slot = await tx.agentSessionTurnSlot.findUnique({
          where: { agentSessionId: sessionId },
        });
        if (!slot) return null;
        if (slot.occupiedAdmissionId) {
          return tx.agentSessionTurnAdmission.findUnique({
            where: { id: slot.occupiedAdmissionId },
          });
        }
        // The durable interaction is the foreground wait. Queued admissions
        // retain their ordinal and become claimable after terminal settlement.
        const foregroundWait = await tx.agentInteraction.findFirst({
          where: {
            sourceSessionId: sessionId,
            kind: 'SUBAGENT',
            mode: 'FOREGROUND',
            state: {
              in: ['DISPATCHING', 'WAITING', 'RESULT_READY', 'DELIVERING'],
            },
          },
          select: { id: true },
        });
        if (foregroundWait) return null;
        const head = await tx.agentSessionTurnAdmission.findFirst({
          where: {
            agentSessionId: sessionId,
            state: 'QUEUED',
            ...(input.admissionId ? { id: input.admissionId } : {}),
          },
          orderBy: { ordinal: 'asc' },
        });
        if (!head) return null;
        const occupied = await tx.agentSessionTurnAdmission.update({
          where: { id: head.id },
          data: { state: 'OCCUPIED', turnId },
        });
        await tx.agentSessionTurnSlot.update({
          where: { agentSessionId: sessionId },
          data: { occupiedAdmissionId: head.id, revision: { increment: 1 } },
        });
        if (head.interactionAttemptId) {
          await tx.agentInteractionAttempt.update({
            where: { id: head.interactionAttemptId },
            data: { targetTurnId: turnId, state: 'RUNNING' },
          });
          const attempt = await tx.agentInteractionAttempt.findUniqueOrThrow({
            where: { id: head.interactionAttemptId },
          });
          const advanced = await tx.agentInteraction.updateMany({
            where: {
              id: attempt.interactionId,
              generation: head.generation,
              state: 'DISPATCHING',
              revision: 1,
            },
            data: { state: 'WAITING', revision: { increment: 1 } },
          });
          if (advanced.count !== 1)
            throw new ConflictException(
              'The interaction generation or revision changed before dispatch.',
            );
        }
        return occupied;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async settleTurn(input: {
    organizationId: string;
    projectId: string;
    machine: AuthenticatedMachine;
    evidence: AgentInteractionSettledTurn;
  }): Promise<boolean> {
    const { organizationId, projectId, machine, evidence } = input;
    // A null assistant Message is valid for a failed Turn; omission is not.
    if (
      !Array.isArray(evidence.reports) ||
      !evidence.settledAt ||
      evidence.completedAssistantMessageId === undefined ||
      !evidence.targetTurnId ||
      !evidence.targetSessionId ||
      !evidence.attemptId ||
      !evidence.interactionId
    ) {
      throw new BadRequestException(
        'Complete settled-Turn evidence is required.',
      );
    }
    if (!Number.isFinite(new Date(evidence.settledAt).getTime())) {
      throw new BadRequestException('The settled-Turn timestamp is invalid.');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const target = await tx.agentSession.findUnique({
          where: { id: evidence.targetSessionId },
        });
        if (
          !target ||
          target.organizationId !== organizationId ||
          target.projectId !== projectId ||
          target.userId !== machine.userId ||
          target.machineId !== machine.machineId
        ) {
          throw new ForbiddenException(
            'The machine does not own the settled target session.',
          );
        }
        if (evidence.completedAssistantMessageId !== null) {
          const assistantMessage = await tx.message.findUnique({
            where: { id: evidence.completedAssistantMessageId },
          });
          if (
            !assistantMessage ||
            assistantMessage.conversationId !== target.conversationId ||
            assistantMessage.projectId !== projectId ||
            assistantMessage.type !== 'SYSTEM'
          ) {
            throw new BadRequestException(
              'The completed assistant Message does not belong to the target session.',
            );
          }
        }
        if (new Set(evidence.reports).size !== evidence.reports.length) {
          throw new BadRequestException(
            'Settled-Turn Report references must be unique.',
          );
        }
        if (evidence.reports.length > 0) {
          const reports = await tx.report.findMany({
            where: { id: { in: evidence.reports } },
            select: { id: true, organizationId: true, projectId: true },
          });
          if (
            reports.length !== evidence.reports.length ||
            reports.some(
              (report) =>
                report.organizationId !== organizationId ||
                report.projectId !== projectId,
            )
          ) {
            throw new BadRequestException(
              'A settled-Turn Report is outside the target project.',
            );
          }
        }
        await tx.$queryRaw`SELECT agent_session_id FROM agent_session_turn_slots WHERE agent_session_id = ${evidence.targetSessionId} FOR UPDATE`;
        const slot = await tx.agentSessionTurnSlot.findUnique({
          where: { agentSessionId: evidence.targetSessionId },
        });
        if (!slot?.occupiedAdmissionId) {
          const previous = await tx.agentInteractionAttempt.findUnique({
            where: { id: evidence.attemptId },
          });
          return previous?.result
            ? sameSettledTurn(
                previous.result as unknown as AgentInteractionSettledTurn,
                evidence,
              )
            : false;
        }
        const admission = await tx.agentSessionTurnAdmission.findUnique({
          where: { id: slot.occupiedAdmissionId },
        });
        if (
          !admission ||
          admission.turnId !== evidence.targetTurnId ||
          admission.interactionAttemptId !== evidence.attemptId ||
          admission.generation !== evidence.generation
        )
          return false;
        const attempt = await tx.agentInteractionAttempt.findUnique({
          where: { id: evidence.attemptId },
        });
        if (
          !attempt ||
          attempt.interactionId !== evidence.interactionId ||
          attempt.targetSessionId !== evidence.targetSessionId ||
          attempt.targetTurnId !== evidence.targetTurnId ||
          attempt.generation !== evidence.generation ||
          attempt.settledAt
        )
          return false;
        const interaction = await tx.agentInteraction.findUnique({
          where: { id: evidence.interactionId },
        });
        if (
          !interaction ||
          interaction.projectId !== projectId ||
          interaction.organizationId !== organizationId ||
          interaction.generation !== evidence.generation ||
          !['DISPATCHING', 'WAITING'].includes(interaction.state)
        )
          return false;
        await tx.agentInteractionAttempt.update({
          where: { id: attempt.id },
          data: {
            state:
              evidence.terminalOutcome === 'COMPLETED'
                ? 'SUCCEEDED'
                : evidence.terminalOutcome === 'ABORTED'
                  ? 'CANCELLED'
                  : 'FAILED',
            settledAt: new Date(evidence.settledAt),
            result: evidence as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.agentSessionTurnAdmission.update({
          where: { id: admission.id },
          data: {
            state: 'SETTLED',
            settledEvidence: evidence as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.agentSessionTurnSlot.update({
          where: { agentSessionId: evidence.targetSessionId },
          data: { occupiedAdmissionId: null, revision: { increment: 1 } },
        });
        const advanced = await tx.agentInteraction.updateMany({
          where: {
            id: evidence.interactionId,
            generation: evidence.generation,
            revision: interaction.revision,
            state: interaction.state,
          },
          data: { state: 'RESULT_READY', revision: { increment: 1 } },
        });
        if (advanced.count !== 1)
          throw new ConflictException(
            'The interaction revision changed during settlement.',
          );
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async settleOrdinaryTurn(input: {
    organizationId: string;
    projectId: string;
    machine: AuthenticatedMachine;
    evidence: TurnAdmissionSettledTurn;
  }): Promise<boolean> {
    const { organizationId, projectId, machine, evidence } = input;
    return this.prisma.$transaction(
      async (tx) => {
        const session = await tx.agentSession.findUnique({
          where: { id: evidence.agentSessionId },
        });
        if (
          !session ||
          session.organizationId !== organizationId ||
          session.projectId !== projectId ||
          session.userId !== machine.userId ||
          session.machineId !== machine.machineId
        ) {
          throw new ForbiddenException(
            'The machine does not own the settled Agent Session.',
          );
        }
        await tx.$queryRaw`SELECT agent_session_id FROM agent_session_turn_slots WHERE agent_session_id = ${evidence.agentSessionId} FOR UPDATE`;
        const slot = await tx.agentSessionTurnSlot.findUnique({
          where: { agentSessionId: evidence.agentSessionId },
        });
        if (slot?.occupiedAdmissionId !== evidence.admissionId) return false;
        const admission = await tx.agentSessionTurnAdmission.findUnique({
          where: { id: evidence.admissionId },
        });
        if (
          !admission ||
          !['USER', 'WORKFLOW'].includes(admission.source) ||
          admission.state !== 'OCCUPIED' ||
          admission.turnId !== evidence.turnId ||
          admission.generation !== evidence.generation
        )
          return false;
        if (evidence.completedAssistantMessageId !== null) {
          const message = await tx.message.findUnique({
            where: { id: evidence.completedAssistantMessageId },
          });
          if (
            !message ||
            message.type !== 'SYSTEM' ||
            message.conversationId !== session.conversationId ||
            message.projectId !== projectId
          ) {
            throw new BadRequestException(
              'The completed assistant Message is outside the Agent Session.',
            );
          }
        }
        if (new Set(evidence.reports).size !== evidence.reports.length) {
          throw new BadRequestException(
            'Settled-Turn Report references must be unique.',
          );
        }
        if (evidence.reports.length > 0) {
          const reports = await tx.report.findMany({
            where: { id: { in: evidence.reports } },
            select: { id: true, organizationId: true, projectId: true },
          });
          if (
            reports.length !== evidence.reports.length ||
            reports.some(
              (report) =>
                report.organizationId !== organizationId ||
                report.projectId !== projectId,
            )
          ) {
            throw new BadRequestException(
              'A settled-Turn Report is outside the target project.',
            );
          }
        }
        await tx.agentSessionTurnAdmission.update({
          where: { id: admission.id },
          data: {
            state: 'SETTLED',
            settledEvidence: evidence as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.agentSessionTurnSlot.update({
          where: { agentSessionId: evidence.agentSessionId },
          data: { occupiedAdmissionId: null, revision: { increment: 1 } },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
