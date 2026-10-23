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

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message:
        'Your Feature outline is ready. You can deepen its details now or continue to placement and final approval. You can also edit the imported Features later.',
      uiElements: [
        {
          id: ENRICHMENT_CHOICE_FIELD,
          type: 'select',
          label: 'Add more detail before importing?',
          required: true,
          influences: [],
          submitText: 'Continue',
          options: [
            {
              value: RepositoryFeatureEnrichmentChoice.Enrich,
              label:
                'Enrich details with repository research and useful questions',
            },
            {
              value: RepositoryFeatureEnrichmentChoice.Skip,
              label: 'Continue with this outline',
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
        return REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY;
      default:
        return this.id;
    }
  }
}
