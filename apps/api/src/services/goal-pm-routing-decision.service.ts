import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Prisma, SuggestionDecision } from '@prisma/client';
import type {
  GoalPmRoutingDecisionResponseDto,
  GoalPmRoutingPayload,
  GoalPmRoutingSelectionPayload,
} from '../generated';
import {
  GoalPmRoutingDecisionResponseDtoSchema,
  GoalPmRoutingPayloadSchema,
  GoalPmRoutingSelectionPayloadSchema,
} from '../generated/goal-pm-decision.schema';
import { PrismaService } from '../prisma/prisma.service';
import type { ConversationId, OrganizationId, UserId } from '../types';

export const GOAL_PM_ROUTING_DECISION_TYPE = 'goal_pm_routing_decision';
function jsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
    return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object') return jsonObject(value);
  throw new Error('Routing decision contains non-JSON data');
}
export function jsonObject(value: object): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]),
  );
}
// Branded formats are codegen annotations; their schema patterns enforce the wire identity.
const ajv = new Ajv({
  strict: false,
  allErrors: true,
  formats: {
    'branded-ConversationId': true,
    'branded-MessageId': true,
    'branded-UserId': true,
  },
});
addFormats(ajv);
const validInput = ajv.compile<GoalPmRoutingSelectionPayload>(
  GoalPmRoutingSelectionPayloadSchema,
);
const validPayload = ajv.compile<GoalPmRoutingPayload>(
  GoalPmRoutingPayloadSchema,
);
const validDecision = ajv.compile<GoalPmRoutingDecisionResponseDto>(
  GoalPmRoutingDecisionResponseDtoSchema,
);

export function mapGoalPmRoutingDecision(
  record: SuggestionDecision,
): GoalPmRoutingDecisionResponseDto {
  if (!validDecision(record.metadata))
    throw new Error('Invalid stored routing decision');
  return record.metadata;
}

export function routingField(data: unknown, fieldId: string): GoalPmRoutingPayload {
  if (
    !data ||
    typeof data !== 'object' ||
    !('uiElements' in data) ||
    !Array.isArray(data.uiElements)
  ) {
    throw new BadRequestException('Source message has no routing fields');
  }
  const fields: unknown[] = data.uiElements;
  const matching = fields.filter(
    (field) =>
      !!field &&
      typeof field === 'object' &&
      'id' in field &&
      field.id === fieldId,
  );
  const field = matching[0];
  if (
    matching.length !== 1 ||
    !field ||
    typeof field !== 'object' ||
    !('type' in field) ||
    field.type !== 'goal_pm_action' ||
    !('payload' in field) ||
    !validPayload(field.payload)
  ) {
    throw new BadRequestException('Source field is not a valid routing choice');
  }
  return field.payload;
}

@Injectable()
export class GoalPmRoutingDecisionService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    userId: UserId,
    input: GoalPmRoutingSelectionPayload,
  ): Promise<GoalPmRoutingDecisionResponseDto> {
    if (!validInput(input))
      throw new BadRequestException('Invalid routing selection');
    return this.prisma.db.$transaction(async (tx) => {
      const message = await tx.message.findFirst({
        where: {
          id: input.sourceMessageId,
          conversationId,
          type: 'SYSTEM',
          conversation: { organizationId },
        },
      });
      if (!message) throw new NotFoundException('Routing message not found');
      const payload = routingField(message.data, input.uiElementId);
      const options = payload.options.filter(
        (option) => option.optionId === input.selectedOptionId,
      );
      const selectedOption = options[0];
      if (options.length !== 1 || !selectedOption)
        throw new BadRequestException(
          'Option is not uniquely offered by the source field',
        );
      const decision: GoalPmRoutingDecisionResponseDto = {
        sourceConversationId: conversationId,
        sourceMessageId: message.id,
        uiElementId: input.uiElementId,
        selectedOption,
        decidedBy: userId,
        createdAt: new Date().toISOString(),
      };
      const outcome = await persistDecision(tx, organizationId, decision);
      if (outcome.selectedOption.optionId !== input.selectedOptionId)
        throw new ConflictException(
          'Routing field already resolved with a different option',
        );
      return outcome;
    });
  }
}

async function persistDecision(
  tx: Pick<PrismaService['db'], 'suggestionDecision'>,
  organizationId: OrganizationId,
  decision: GoalPmRoutingDecisionResponseDto,
): Promise<GoalPmRoutingDecisionResponseDto> {
  const suggestionId = `${decision.sourceMessageId}:${decision.uiElementId}`;
  // The existing composite primary key arbitrates concurrent choices. A losing insert never replaces history.
  await tx.suggestionDecision.createMany({
    data: [
      {
        organizationId,
        type: GOAL_PM_ROUTING_DECISION_TYPE,
        suggestionId,
        sourceConversationId: decision.sourceConversationId,
        sourceMessageId: decision.sourceMessageId,
        accepted: true,
        decidedBy: decision.decidedBy,
        metadata: jsonObject(decision),
      },
    ],
    skipDuplicates: true,
  });
  const stored = await tx.suggestionDecision.findUniqueOrThrow({
    where: {
      organizationId_type_suggestionId: {
        organizationId,
        type: GOAL_PM_ROUTING_DECISION_TYPE,
        suggestionId,
      },
    },
  });
  return mapGoalPmRoutingDecision(stored);
}
