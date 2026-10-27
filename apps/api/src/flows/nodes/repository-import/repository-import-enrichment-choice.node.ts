import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { RepositoryFeatureEnrichmentChoice } from '../../../generated';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  QuestionsNodeBase,
  RepositoryImportFlowContext,
} from '../../../types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import { getRepositoryGroundingAnswers } from '../onboarding/repository-grounding.contract';

export const ENRICHMENT_CHOICE_FIELD = 'repository_feature_enrichment_choice';
const choiceSchema = z.nativeEnum(RepositoryFeatureEnrichmentChoice);

@Injectable()
export class RepositoryImportEnrichmentChoiceNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.ENRICHMENT_CHOICE;
  private readonly logger = new Logger(
    RepositoryImportEnrichmentChoiceNode.name,
  );

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    if (!tracker.getContext().repositoryImportMaterializedFeatureIds?.length)
      throw new Error(
        'The enrichment choice requires approved, created Features.',
      );
    return {
      type: NodeType.QUESTIONS,
      message:
        'Your Features have been created. Are you done, or would you like to explore their intent and requirements?',
      uiElements: [
        {
          id: ENRICHMENT_CHOICE_FIELD,
          type: 'select',
          label: 'Continue exploring your Features?',
          required: true,
          influences: [],
          submitText: 'Continue',
          options: [
            {
              value: RepositoryFeatureEnrichmentChoice.Enrich,
              label: 'Ask more questions',
            },
            {
              value: RepositoryFeatureEnrichmentChoice.Skip,
              label: 'Done',
            },
          ],
        },
      ],
      data: {
        detectedIntent: 'repository_feature_enrichment_choice',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    message: FlowUserMessage,
  ): Promise<void> {
    const choice = choiceSchema.parse(
      getRepositoryGroundingAnswers(message)[ENRICHMENT_CHOICE_FIELD],
    );
    tracker.mutate((draft) => {
      draft.repositoryFeatureEnrichmentChoice = choice;
    });
    this.logger.debug('Repository enrichment choice saved', {
      conversationId: tracker.getContext().core.conversationId,
      choice,
    });
  }

  async determineRoutingFromUserMessage(
    context: Readonly<RepositoryImportFlowContext>,
  ): Promise<string> {
    switch (context.repositoryFeatureEnrichmentChoice) {
      case RepositoryFeatureEnrichmentChoice.Enrich:
        return REPOSITORY_IMPORT_NODES.ENRICHMENT;
      case RepositoryFeatureEnrichmentChoice.Skip:
        return REPOSITORY_IMPORT_NODES.END;
      default:
        return this.id;
    }
  }
}
