import { LOCAL_REPOSITORY_OUTLINE_REFINEMENT_NODE } from '../../flows/constants/node-ids';
import { Injectable } from '@nestjs/common';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge/models';
import type { RepositoryOutlineRefinementRequest } from '@hey-hey/contracts/api/models';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import {
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  MutableContextHandle,
  RepositoryImportFlowContext,
} from '../../types/flow-internal.types';
import { featureGenerationResponseSchema } from '../../flows/utils/shared-schemas';
import { RepositoryImportGenerateFeaturesNode } from '../../flows/nodes/repository-import/repository-import-generate-features.node';
import { PromptBuilderService } from '../llm/prompt-builder.service';

@Injectable()
export class LocalRepositoryOutlineRefinementNode extends ExternalAgentNodeBase<RepositoryImportFlowContext> {
  readonly id = LOCAL_REPOSITORY_OUTLINE_REFINEMENT_NODE;
  readonly title = 'Revise Feature outline';
  readonly promptType = LocalPromptType.repository_outline_refinement;
  readonly actions = {
    success: {
      schema: z.object({ output: z.string().min(1) }).strict(),
      waitForUser: false,
    },
    failure: {
      schema: z
        .object({ code: z.string().min(1), message: z.string().min(1) })
        .strict(),
      waitForUser: false,
    },
  };

  constructor(
    private readonly prompts: PromptBuilderService,
    private readonly generateFeatures: RepositoryImportGenerateFeaturesNode,
  ) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const { core, repositoryGrounding } = tracker.getContext();
    if (!repositoryGrounding) {
      throw new Error(
        'Outline refinement has no accepted repository configuration',
      );
    }
    const { prerequisites, analysisConfiguration } = repositoryGrounding;
    const built = await this.prompts.buildPrompt(
      this.generateFeatures,
      tracker,
    );
    const schema = zodToJsonSchema(featureGenerationResponseSchema);
    const payload = {
      promptType: 'repository_outline_refinement',
      projectId: core.projectId,
      conversationId: core.conversationId,
      workflowId: core.workflowId,
      workflowNodeId: this.id,
      serviceId: prerequisites.serviceId,
      machineId: prerequisites.machineId,
      provider: analysisConfiguration.provider,
      resolvedFrontierModel: analysisConfiguration.resolvedFrontierModel,
      reasoningEffort: analysisConfiguration.reasoningEffort,
      ...(analysisConfiguration.fastMode === undefined
        ? {}
        : { fastMode: analysisConfiguration.fastMode }),
      prompt: `${built.fullPrompt}\n\nReturn only JSON satisfying this schema:\n${JSON.stringify(schema)}`,
    } satisfies RepositoryOutlineRefinementRequest;
    return {
      response: '',
      uiElements: [],
      triggersAgent: { promptType: this.promptType, nodeId: this.id, payload },
    };
  }
}
