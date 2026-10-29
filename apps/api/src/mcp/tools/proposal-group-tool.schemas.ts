import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import {
  ProposalValidationLayer,
  type ProposalValidationIssue,
} from 'src/generated';

export const proposalValidationIssueSchema: z.ZodType<ProposalValidationIssue> =
  z
    .object({
      field: z.string(),
      code: z.string(),
      reason: z.string(),
      layer: z.nativeEnum(ProposalValidationLayer),
      suggestion: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

export const invalidProposalChangeSetOutputSchema = z.object({
  status: z.literal('invalid_change_set'),
  workItemType: z.string().optional(),
  issues: z.array(proposalValidationIssueSchema),
});

export function invalidProposalChangeSetFromError(
  error: unknown,
  workItemType?: string,
): z.infer<typeof invalidProposalChangeSetOutputSchema> | null {
  if (!(error instanceof BadRequestException)) return null;
  const response = error.getResponse();
  if (response === null || typeof response !== 'object') return null;
  const parsed = z
    .array(proposalValidationIssueSchema)
    .safeParse((response as { errors?: unknown }).errors);
  if (!parsed.success) return null;
  return {
    status: 'invalid_change_set',
    ...(workItemType ? { workItemType } : {}),
    issues: parsed.data,
  };
}

export const proposalGroupContextSchema = z
  .object({
    groupId: z
      .string()
      .uuid()
      .describe('Stable identity returned by start_proposal_group.'),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .describe(
        'Mutation precondition. Copy the latest persisted authoring snapshot currentRevision into this expectedRevision field; do not send currentRevision as a groupContext key.',
      ),
  })
  .strict()
  .describe(
    'Explicit proposal-group mutation context: { groupId, expectedRevision }. Set expectedRevision to the currentRevision returned by start_proposal_group, a grouped mutation, or get_proposal_group_authoring_snapshot. Never infer either value from request headers, conversation state, call order, or prior tool results.',
  );

export type ProposalGroupContext = z.infer<typeof proposalGroupContextSchema>;

const createProposalSchema = z.object({
  type: z.string(),
  action: z.string(),
  targetEntityId: z.string(),
  targetEntityType: z.string(),
  title: z.string().nullable().optional(),
  eli5: z.string().max(150).optional(),
  updates: z.unknown(),
  requestorContext: z.unknown().optional(),
  influences: z.array(z.unknown()).optional(),
  generatedWithVersion: z.string().optional(),
  validationSessionId: z.string().optional(),
  conversationId: z.string().optional(),
  edges: z.array(z.unknown()).optional(),
});

export const proposalGroupAuthoringMemberSchema = z.object({
  memberId: z.string().uuid(),
  memberOrder: z.number().int().min(0),
  proposal: createProposalSchema,
  reservedEntityId: z.string().uuid().nullable().optional(),
  prerequisiteMemberIds: z.union([
    z.array(z.string().uuid()),
    z.set(z.string().uuid()),
  ]),
});

export const proposalGroupAuthoringSnapshotSchema = z.object({
  groupId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  lifecycle: z.literal('BUILDING'),
  currentRevision: z
    .number()
    .int()
    .min(0)
    .describe(
      'Persisted snapshot revision. Copy this value to groupContext.expectedRevision for the next grouped mutation.',
    ),
  originatingConversationId: z.string().uuid().optional(),
  originatingMessageId: z.string().uuid().optional(),
  members: z.array(proposalGroupAuthoringMemberSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const groupedAuthoringResultSchema = z.object({
  groupId: z.string().uuid(),
  currentRevision: z
    .number()
    .int()
    .min(0)
    .describe(
      'Persisted revision after this mutation. Copy this value to groupContext.expectedRevision for the next grouped mutation.',
    ),
  member: proposalGroupAuthoringMemberSchema,
  authoringSnapshot: proposalGroupAuthoringSnapshotSchema,
});
