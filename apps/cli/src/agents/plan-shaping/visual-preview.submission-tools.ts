import { SubmissionToolCorrectableError } from '../submission-tools/types';
import type {
  ActionSubmissionToolDeclaration,
  SubmissionToolDeclaration,
  SubmissionToolInputSchema,
} from '../submission-tools/types';
import {
  asVisualPreviewCompletionPayload,
  type VisualPreviewCompletionPayload,
  visualPreviewCompletionPayloadSchema,
} from './visual-preview.schemas';
import { IncludeExistingProposalsInCurrentMessageTool } from '../submission-tools/include-existing-proposals-in-current-message-tool';

const inputSchema: SubmissionToolInputSchema = {
  type: 'object',
  required: ['refinementRound', 'entries'],
  additionalProperties: false,
  properties: {
    refinementRound: { type: 'integer', minimum: 0 },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['proposalId', 'artifactFamily', 'presentationOrder'],
        additionalProperties: false,
        properties: {
          proposalId: { type: 'string', format: 'uuid' },
          artifactFamily: { type: 'string', enum: ['mockup', 'diagram'] },
          presentationOrder: { type: 'integer', minimum: 0 },
          relationship: {
            type: 'object',
            required: ['kind', 'proposalId'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['depends_on', 'refines'] },
              proposalId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
  },
};

export const submitVisualPreviewReadyTool: ActionSubmissionToolDeclaration = {
  name: 'submit_visual_preview_ready',
  description:
    'Call this only after the narrative is complete and every visual proposal for this round has been authored or carried forward. Submit the complete ordered Mockup and Diagram set; do not use a proposal group.',
  inputSchema,
  execute: ({ args }) => {
    const parsed = visualPreviewCompletionPayloadSchema.safeParse(args);
    if (!parsed.success) {
      throw new SubmissionToolCorrectableError({
        reason: 'submit_visual_preview_ready received an invalid visual preview.',
        findings: parsed.error.issues.map((issue) => ({
          field: `/${issue.path.map(String).join('/')}`,
          code: issue.code,
          reason: issue.message,
          correction: 'Correct this field and retry the same submission tool.',
        })),
      });
    }

    const payload = asVisualPreviewCompletionPayload(parsed.data);
    return {
      action: 'READY',
      payload: {
        refinementRound: payload.refinementRound,
        entries: payload.entries,
      },
    };
  },
  hidden: true,
};

export const visualPreviewSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  new IncludeExistingProposalsInCurrentMessageTool(),
  submitVisualPreviewReadyTool,
];
