import {
  CodingPlanEmissionInputToolSchema,
  CodingPlanDiscrepancyToolSchema,
  CodingPlanQuestionToolSchema,
} from '../../generated/coding-plan.tool-schemas';
import {
  CodingPlanEmissionInputSchema,
  CodingPlanDiscrepancySchema,
  CodingPlanQuestionSchema,
} from '../../generated/coding-plan.schemas';
import { ExtendedUIFieldType } from '../../shared/api/generated/api';
import type { PassThroughSubmissionToolDeclaration } from '../submission-tools/types';

export const codingPlanConversationTools: readonly PassThroughSubmissionToolDeclaration[] = [
  {
    kind: 'pass_through',
    name: 'emit_coding_plan_discrepancy',
    description:
      'Persist one evidence-bearing discrepancy as a replyable conversation item. Does not complete planning or approve implementation.',
    inputSchema: CodingPlanDiscrepancyToolSchema,
    async execute({ args, run }) {
      if (!run) throw new Error('A planning Run is required.');
      const payload = CodingPlanDiscrepancySchema.parse(
        args,
      ) satisfies import('../../shared/api/generated/api').CodingPlanDiscrepancy;
      const messageId = await run.persistCodingPlanElement(
        ExtendedUIFieldType.CodingPlanDiscrepancy,
        payload,
      );
      return { content: [{ type: 'text', text: JSON.stringify({ messageId }) }] };
    },
  },
  {
    kind: 'pass_through',
    name: 'ask_coding_plan_question',
    description:
      'Show one question the user must answer before planning can continue. Their reply starts the next planning turn.',
    inputSchema: CodingPlanQuestionToolSchema,
    async execute({ args, run }) {
      if (!run) throw new Error('A planning Run is required.');
      const { question } = CodingPlanQuestionSchema.parse(args);
      const messageId = await run.persistCodingPlanQuestion(question);
      return { content: [{ type: 'text', text: JSON.stringify({ messageId }) }] };
    },
  },
  {
    kind: 'pass_through',
    name: 'emit_coding_plan',
    description:
      'Persist a complete free-form Markdown plan and separate required Services for review. Does not approve or complete a workflow.',
    inputSchema: CodingPlanEmissionInputToolSchema,
    async execute({ args, run }) {
      if (!run) throw new Error('A planning Run is required.');
      const payload = {
        responseType: 'coding_plan_version_v1',
        ...CodingPlanEmissionInputSchema.parse(args),
      } satisfies import('../../shared/api/generated/api').CodingPlanVersion;
      const messageId = await run.persistCodingPlanElement(
        ExtendedUIFieldType.CodingPlanVersion,
        payload,
      );
      return { content: [{ type: 'text', text: JSON.stringify({ messageId }) }] };
    },
  },
];
