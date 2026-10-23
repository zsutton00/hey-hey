import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import { PlanShapingFeatureSyncAnalyzePromptPayload } from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FlowUserMessage,
  PlanFromDesignDocFlowContext,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PlanFromDesignDocSeedService } from 'src/services/plan/plan-from-design-doc-seed.service';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import { FEATURE_SYNC_ACTIONS } from '../feature-sync/schemas';
import {
  assignDiscrepancyIds,
  parseDiscrepancyPayload,
} from '../shared/feature-sync-discrepancy';
import { planShapingFeatureSyncAnalyzeActions } from './schemas';

/**
 * `feature-sync-analyze` EXTERNAL_AGENT node — the head of the
 * plan-from-design-doc graph. Runs before any stages are proposed and
 * emits exactly one of:
 *
 * - `NO_DISCREPANCY` — flow advances to `proposed-stages`.
 * - `DISCREPANCY { discrepancies: [...] }` — flow routes to the one-shot
 *   `feature-sync-review` QUESTIONS gate. `waitForUser` is false so routing
 *   fires on the same turn the agent presents the flagged items.
 *
 * The plan id and design-doc id the trigger needs are resolved per
 * execution via {@link PlanFromDesignDocSeedService}. On DISCREPANCY the
 * flagged items are saved on `featureSyncDiscrepancies` with stable ids
 * (`fs-1`…) so every iterate trigger can re-send them.
 */
@Injectable()
export class PlanShapingFeatureSyncAnalyzeNode extends ExternalAgentNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.FEATURE_SYNC_ANALYZE;
  readonly title = 'Plan Shaping — Feature Sync Analyze';

  readonly promptType = LocalPromptType.plan_shaping_feature_sync_analyze;

  readonly actions: ExternalAgentActionSchemas =
    planShapingFeatureSyncAnalyzeActions;

  private readonly logger = new Logger(PlanShapingFeatureSyncAnalyzeNode.name);

  constructor(private readonly seedService: PlanFromDesignDocSeedService) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    // planId/designDocId are resolved from the persisted conversation/plan
    // at execution time, NOT read off the flow context — the context never
    // carries them (see PlanFromDesignDocFlowContext docstring).
    const seed = await this.seedService.resolve(context.core.conversationId);

    this.logger.debug('Plan-shaping feature-sync analyze node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      planId: seed.planId,
      designDocId: seed.designDocId,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Plan Shaping — Feature Sync Analyze',
        required: false,
        influences: [],
      },
    ];

    // Analyze is the graph's start node and is never re-entered, so it carries
    // no pending user reply to fold into the trigger — the plan/design-doc ids
    // are the whole payload.
    const triggerPayload: PlanShapingFeatureSyncAnalyzePromptPayload = {
      planId: seed.planId,
      designDocId: seed.designDocId,
    };

    this.logger.debug(
      'Plan-shaping feature-sync analyze trigger payload built',
      {
        conversationId: context.core.conversationId,
        fields: Object.keys(triggerPayload),
      },
    );

    return {
      response: 'Checking your plan against its design doc…',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload: triggerPayload,
      },
      data: {
        detectedIntent: 'plan_shaping_feature_sync_analyze_started',
        intentConfidence: 1,
        reasoning:
          'External agent comparing the plan structure against its design doc for drift before stages are proposed.',
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    // Runs before the engine validator, so only a parseable DISCREPANCY
    // payload mutates context.
    const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;
    if (data.action !== FEATURE_SYNC_ACTIONS.DISCREPANCY) {
      return;
    }
    const discrepancies = parseDiscrepancyPayload(data.payload);
    if (!discrepancies) {
      return;
    }
    const flagged = assignDiscrepancyIds(discrepancies);
    tracker.mutate((draft) => {
      draft.featureSyncDiscrepancies = flagged;
      delete draft.featureSyncPendingDecisions;
    });
    this.logger.debug('Plan-shaping feature-sync analyze saved flagged items', {
      conversationId: tracker.getContext().core.conversationId,
      itemIds: flagged.map((item) => item.id),
    });
  }
}
