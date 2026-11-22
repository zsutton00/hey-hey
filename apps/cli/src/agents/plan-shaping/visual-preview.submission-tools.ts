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
  required: ['refinementRound', 'entries', 'setComplete'],
  additionalProperties: false,
  properties: {
    refinementRound: { type: 'integer', minimum: 0 },
    setComplete: {
      type: 'boolean',
      description:
        'True only when no further visuals follow the ones in this set. False when another visual should come after this one.',
    },
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
    'Call this only after the narrative is complete and the one visual for this turn has been drafted or redrafted. Submit the ordered Mockup and Diagram set so far and say whether it is complete; do not use a proposal group.',
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
        setComplete: payload.setComplete,
      },
    };
  },
  hidden: true,
};

export const visualPreviewSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  new IncludeExistingProposalsInCurrentMessageTool(),
  submitVisualPreviewReadyTool,
];
