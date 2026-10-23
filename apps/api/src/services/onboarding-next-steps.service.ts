import { Injectable, Logger } from '@nestjs/common';
import { ArtifactType } from '@prisma/client';
import { z } from 'zod';
import {
  ConversationId,
  MockLlmSessionId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import {
  ProjectExistingWorkIntent,
  ProjectFeatureNextStep,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import { ArtifactService } from './artifacts/artifact.service';
import { LLMClientService } from './llm/llm-client.service';
import { ClaudeModel, LLMProviderName } from './llm/llm-shared';
import { StandardPlaceholderRegistry } from './llm/placeholders/registries/standard-placeholders.registry';
import { normalizeProjectConfig, ProjectService } from './project.service';

const MIN_SUGGESTIONS = 3;
const MAX_SUGGESTIONS = 4;
const FEATURE_DESCRIPTION_LIMIT = 1200;

export const featureNextStepsResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        featureId: z.string().uuid(),
        kind: z.enum(['TASKS', 'MOCKUPS', 'DIAGRAM']),
        rationale: z.string().trim().min(1),
        starterPrompt: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(MAX_SUGGESTIONS),
});

interface TopLevelFeature {
  id: string;
  name: string;
  tag: string | null;
  description: string;
}

export interface OnboardingNextStepsSource {
  organizationId: OrganizationId;
  projectId: ProjectId;
  conversationId?: ConversationId;
  workflowId?: WorkflowId;
  userId?: UserId;
  mockLlmSessionId?: MockLlmSessionId;
  nodeId: string;
  /** Feature ids created by onboarding's feature-list approval. */
  materializedFeatureIds: string[];
}

/**
 * Picks where a user should start after feature-discovery onboarding: a few
 * of the generated top-level Features, each with one suggested first artifact.
 * Suggestions are optional guidance, so generation never fails onboarding —
 * any problem is logged and nothing is saved, which leaves Help without the
 * Where to start step.
 */
@Injectable()
export class OnboardingNextStepsService {
  private readonly logger = new Logger(OnboardingNextStepsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly artifactService: ArtifactService,
    private readonly llmClientService: LLMClientService,
    private readonly projectService: ProjectService,
  ) {}

  async generateAndRecord(source: OnboardingNextStepsSource): Promise<void> {
    const logContext = {
      projectId: source.projectId,
      conversationId: source.conversationId,
      nodeId: source.nodeId,
    };

    try {
      const project = await this.prisma.db.project.findFirst({
        where: { id: source.projectId, organizationId: source.organizationId },
        select: { config: true },
      });
      const config = normalizeProjectConfig(project?.config);
      if (
        config?.existingWorkIntent === ProjectExistingWorkIntent.Selected ||
        config?.featureNextSteps
      ) {
        // The import route has its own first-task stage, and a retried node
        // keeps the suggestions it already saved.
        this.logger.debug('Skipping next-step suggestions', {
          ...logContext,
          existingWorkIntent: config?.existingWorkIntent,
          alreadyRecorded: !!config?.featureNextSteps,
        });
        return;
      }

      const features = await this.loadTopLevelFeatures(source);
      if (features.length === 0) {
        this.logger.warn(
          'No materialized top-level Features for next-step suggestions',
          logContext,
        );
        return;
      }

      const suggestions = await this.generate(source, features);
      const featureNextSteps = this.validate(suggestions, features);
      if (!featureNextSteps) {
        this.logger.warn('Discarding invalid next-step suggestions', {
          ...logContext,
          featureCount: features.length,
          suggestions,
        });
        return;
      }

      await this.projectService.recordOnboardingFeatureNextSteps({
        projectId: source.projectId,
        organizationId: source.organizationId,
        featureNextSteps,
      });
      this.logger.log('Recorded onboarding next-step suggestions', {
        ...logContext,
        featureIds: featureNextSteps.map((step) => step.featureId),
        kinds: featureNextSteps.map((step) => step.kind),
      });
    } catch (error) {
      this.logger.error('Failed to generate onboarding next-step suggestions', {
        ...logContext,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadTopLevelFeatures(
    source: OnboardingNextStepsSource,
  ): Promise<TopLevelFeature[]> {
    if (source.materializedFeatureIds.length === 0) {
      return [];
    }
    const features = await this.prisma.db.task.findMany({
      where: {
        id: { in: source.materializedFeatureIds },
        organizationId: source.organizationId,
        projectId: source.projectId,
        type: 'FEATURE',
        parentTaskId: null,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        tag: true,
        sections: {
          where: { key: 'description' },
          select: { materializedMarkdown: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      tag: feature.tag,
      description: (feature.sections[0]?.materializedMarkdown ?? '').slice(
        0,
        FEATURE_DESCRIPTION_LIMIT,
      ),
    }));
  }

  private async generate(
    source: OnboardingNextStepsSource,
    features: TopLevelFeature[],
  ): Promise<z.infer<typeof featureNextStepsResponseSchema>> {
    const history = source.conversationId
      ? await this.loadConversationHistory(source)
      : '';
    const response = await this.llmClientService.callStructured<
      z.infer<typeof featureNextStepsResponseSchema>
    >(
      this.buildPrompt(features, history),
      {
        modelCriteria: {
          model: ClaudeModel.CLAUDE_5_HAIKU_5,
          provider: LLMProviderName.CLAUDE,
        },
        responseSchema: featureNextStepsResponseSchema,
        maxTokens: 4000,
        timeout: 60000,
        stream: false,
      },
      {
        organizationId: source.organizationId,
        projectId: source.projectId,
        conversationId: source.conversationId,
        workflowId: source.workflowId,
        userId: source.userId,
        nodeId: source.nodeId,
        mockLlmSessionId: source.mockLlmSessionId,
      },
    );
    return featureNextStepsResponseSchema.parse(response.content);
  }

  private async loadConversationHistory(
    source: OnboardingNextStepsSource,
  ): Promise<string> {
    const artifacts = await this.artifactService.findMany(
      {
        projectId: source.projectId,
        sourceId: String(source.conversationId),
        status: 'ACTIVE',
        limit: 20,
        type: ArtifactType.QA_PAIR,
      },
      source.organizationId,
    );
    return StandardPlaceholderRegistry.formatConversationHistoryBlock(
      artifacts.data ?? [],
    );
  }

  /**
   * Keeps only suggestions for distinct materialized top-levels, and requires
   * three of them (or every top-level when there are fewer).
   */
  private validate(
    response: z.infer<typeof featureNextStepsResponseSchema>,
    features: TopLevelFeature[],
  ): ProjectFeatureNextStep[] | undefined {
    const featureIds = new Set(features.map((feature) => feature.id));
    const seen = new Set<string>();
    const steps = response.suggestions.filter((suggestion) => {
      if (
        !featureIds.has(suggestion.featureId) ||
        seen.has(suggestion.featureId)
      ) {
        return false;
      }
      seen.add(suggestion.featureId);
      return true;
    });
    return steps.length >= Math.min(MIN_SUGGESTIONS, features.length)
      ? steps
      : undefined;
  }

  private buildPrompt(features: TopLevelFeature[], history: string): string {
    const targetCount =
      features.length < MIN_SUGGESTIONS
        ? `all ${features.length}`
        : `${MIN_SUGGESTIONS} or ${MAX_SUGGESTIONS}`;
    const featureList = features
      .map((feature) =>
        JSON.stringify({
          featureId: feature.id,
          name: feature.name,
          tag: feature.tag,
          description: feature.description,
        }),
      )
      .join('\n');

    return `You are helping someone who just finished setting up a new project decide where to start.

During onboarding they described the project, and these top-level Features were created from that conversation:
${featureList}

${history ? `Their onboarding conversation:\n${history}\n` : ''}
Pick ${targetCount} of these Features as good places to start. For each, choose exactly one first step. Every step begins with fleshing out the Feature in conversation, then creating one of:
- TASKS: concrete implementation tasks. Best when the Feature is well understood and ready to build.
- MOCKUPS: interface mockups. Best when the Feature is user-facing and its screens or interactions are still open questions.
- DIAGRAM: a diagram. Best when the Feature involves a process, a system structure, or interactions between parts that are clearer drawn than written.

Prefer the Features the user emphasized or that unblock the others, and vary the kinds when that fits the project. For each pick, write a one-sentence rationale addressed to the user ("you") explaining why it is a good place to start, grounded in what they said. Do not repeat the Feature name at the start of the rationale.

Also write a starter prompt the user can send to an AI agent to begin that work. Write it in the user's voice ("I", "we"), addressed to the agent. It must:
- Name the Feature and ask the agent to flesh it out first.
- Carry over the specific details, constraints, users and open questions from the onboarding conversation that bear on this Feature, so the agent does not have to rediscover them.
- Then ask for the step's output: for TASKS, concrete implementation tasks; for MOCKUPS, interface mockups of the key screens or interactions; for DIAGRAM, a diagram of the relevant process, structure or interactions.
The starter prompt is a request for work, not an explanation of why to start here: do not restate the rationale. Keep it to two to five sentences.

Use only featureId values from the list above, at most once each.

Respond with JSON: {"suggestions": [{"featureId": "<uuid>", "kind": "TASKS" | "MOCKUPS" | "DIAGRAM", "rationale": "<one sentence>", "starterPrompt": "<two to five sentences>"}]}`;
  }
}
