import { CodingPlanEmissionInputToolSchema } from '../../generated/coding-plan.tool-schemas';
import { CodingPlanEmissionInputSchema } from '../../generated/coding-plan.schemas';
import { ExtendedUIFieldType } from '@hey-hey/contracts/api/models';
import type { PassThroughSubmissionToolDeclaration } from '../submission-tools/types';

export const codingPlanConversationTools: readonly PassThroughSubmissionToolDeclaration[] = [
  {
    kind: 'pass_through',
    name: 'emit_coding_plan',
    description:
      'Persist one complete plan version for review: the free-form Markdown plan, its required Services and its complete discrepancy list (empty when there are none). Does not approve or complete a workflow.',
    inputSchema: CodingPlanEmissionInputToolSchema,
    async execute({ args, run }) {
      if (!run) throw new Error('A planning Run is required.');
      const input = CodingPlanEmissionInputSchema.parse(args);
      const payload = {
        responseType: 'coding_plan_version_v1',
        markdown: input.markdown,
        requiredServiceIds: input.requiredServiceIds,
        discrepancies: input.discrepancies.map(
          ({
            sourceRef,
            sourceField,
            sourceExcerpt,
            reasoning,
            discrepancyText,
            severity,
            suspectedImpact,
            findingId,
            category,
            userDirection,
            disposition,
            implementationFollowThrough,
            withdrawalEvidence,
          }) => ({
            sourceRef,
            sourceField,
            sourceExcerpt,
            reasoning,
            discrepancyText,
            severity,
            ...(suspectedImpact === undefined ? {} : { suspectedImpact }),
            ...(findingId === undefined ? {} : { findingId }),
            ...(category === undefined ? {} : { category }),
            ...(userDirection === undefined ? {} : { userDirection }),
            ...(disposition === undefined ? {} : { disposition }),
            ...(implementationFollowThrough === undefined ? {} : { implementationFollowThrough }),
            ...(withdrawalEvidence === undefined ? {} : { withdrawalEvidence }),
          }),
        ),
      } satisfies import('@hey-hey/contracts/api').CodingPlanVersion;
      const messageId = await run.persistCodingPlanElement(
        ExtendedUIFieldType.CodingPlanVersion,
        payload,
      );
      return { content: [{ type: 'text', text: JSON.stringify({ messageId }) }] };
    },
  },
];
