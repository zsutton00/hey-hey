import type { ConversationId, OrganizationId, ProjectId } from '../../types';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ArtifactService } from '../artifacts/artifact.service';
import type { LLMClientService } from '../llm/llm-client.service';
import { ClaudeModel } from '../llm/llm-shared';
import type { ProjectService } from '../project.service';
import { OnboardingNextStepsService } from '../onboarding-next-steps.service';

const featureIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];

const source = {
  organizationId: 'org-1' as OrganizationId,
  projectId: 'project-1' as ProjectId,
  conversationId: 'conversation-1' as ConversationId,
  nodeId: 'onboarding_finalize',
  materializedFeatureIds: [...featureIds, 'child-feature'],
};

const suggestion = (index: number, kind = 'TASKS') => ({
  featureId: featureIds[index],
  kind,
  rationale: `Reason ${index}.`,
  starterPrompt: `Let's flesh out Feature ${index}, then create the ${kind}.`,
});

describe('OnboardingNextStepsService', () => {
  const setup = (options: {
    config?: unknown;
    topLevelCount?: number;
    llmContent?: unknown;
    llmError?: Error;
  }) => {
    const prisma = {
      db: {
        project: {
          findFirst: jest.fn().mockResolvedValue({
            config: options.config ?? {
              version: 1,
              existingWorkIntent: 'declined',
            },
          }),
        },
        task: {
          findMany: jest.fn().mockResolvedValue(
            featureIds.slice(0, options.topLevelCount ?? 4).map((id, i) => ({
              id,
              name: `Feature ${i}`,
              tag: 'product',
              sections: [{ materializedMarkdown: `Description ${i}` }],
            })),
          ),
        },
      },
    };
    const artifactService = {
      findMany: jest.fn().mockResolvedValue({ data: [] }),
    };
    const llmClientService = {
      callStructured: options.llmError
        ? jest.fn().mockRejectedValue(options.llmError)
        : jest.fn().mockResolvedValue({ content: options.llmContent }),
    };
    const projectService = {
      recordOnboardingFeatureNextSteps: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OnboardingNextStepsService(
      prisma as unknown as PrismaService,
      artifactService as unknown as ArtifactService,
      llmClientService as unknown as LLMClientService,
      projectService as unknown as ProjectService,
    );
    return { service, prisma, llmClientService, projectService };
  };

  it('records validated suggestions for materialized top-level Features on Haiku 5.5 without a temperature', async () => {
    const steps = [
      suggestion(0),
      suggestion(1, 'MOCKUPS'),
      suggestion(2, 'DIAGRAM'),
    ];
    const { service, prisma, llmClientService, projectService } = setup({
      llmContent: { suggestions: steps },
    });

    await service.generateAndRecord(source);

    expect(prisma.db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: source.materializedFeatureIds },
          type: 'FEATURE',
          parentTaskId: null,
        }),
      }),
    );
    const options = llmClientService.callStructured.mock.calls[0][1];
    expect(options.modelCriteria.model).toBe(ClaudeModel.CLAUDE_5_HAIKU_5);
    expect(options).not.toHaveProperty('temperature');
    expect(
      projectService.recordOnboardingFeatureNextSteps,
    ).toHaveBeenCalledWith({
      projectId: source.projectId,
      organizationId: source.organizationId,
      featureNextSteps: steps,
    });
    const prompt = llmClientService.callStructured.mock.calls[0][0];
    expect(prompt).toContain('starterPrompt');
  });

  it('saves a distinct starter prompt for each kind', async () => {
    const steps = [
      suggestion(0),
      suggestion(1, 'MOCKUPS'),
      suggestion(2, 'DIAGRAM'),
    ];
    const { service, projectService } = setup({
      llmContent: { suggestions: steps },
    });

    await service.generateAndRecord(source);

    const saved: Array<{ kind: string; starterPrompt: string }> =
      projectService.recordOnboardingFeatureNextSteps.mock.calls[0][0]
        .featureNextSteps;
    expect(saved.map((step) => [step.kind, step.starterPrompt])).toEqual(
      steps.map((step) => [step.kind, step.starterPrompt]),
    );
    expect(new Set(saved.map((step) => step.starterPrompt)).size).toBe(3);
  });

  it('saves nothing when a suggestion has no starter prompt', async () => {
    const { starterPrompt: _omitted, ...withoutPrompt } = suggestion(2);
    const { service, projectService } = setup({
      llmContent: {
        suggestions: [suggestion(0), suggestion(1, 'MOCKUPS'), withoutPrompt],
      },
    });

    await expect(service.generateAndRecord(source)).resolves.toBeUndefined();
    expect(
      projectService.recordOnboardingFeatureNextSteps,
    ).not.toHaveBeenCalled();
  });

  it('drops unknown and duplicate Features and saves nothing when fewer than three remain', async () => {
    const { service, projectService } = setup({
      llmContent: {
        suggestions: [
          suggestion(0),
          suggestion(0, 'DIAGRAM'),
          {
            ...suggestion(1),
            featureId: '99999999-9999-4999-8999-999999999999',
          },
        ],
      },
    });

    await service.generateAndRecord(source);

    expect(
      projectService.recordOnboardingFeatureNextSteps,
    ).not.toHaveBeenCalled();
  });

  it('accepts every Feature when fewer than three exist', async () => {
    const steps = [suggestion(0), suggestion(1, 'DIAGRAM')];
    const { service, projectService } = setup({
      topLevelCount: 2,
      llmContent: { suggestions: steps },
    });

    await service.generateAndRecord(source);

    expect(
      projectService.recordOnboardingFeatureNextSteps,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ featureNextSteps: steps }),
    );
  });

  it('skips the import route', async () => {
    const { service, llmClientService, projectService } = setup({
      config: { version: 1, existingWorkIntent: 'selected' },
    });

    await service.generateAndRecord(source);

    expect(llmClientService.callStructured).not.toHaveBeenCalled();
    expect(
      projectService.recordOnboardingFeatureNextSteps,
    ).not.toHaveBeenCalled();
  });

  it('keeps suggestions already saved by an earlier attempt', async () => {
    const { service, llmClientService } = setup({
      config: {
        version: 1,
        existingWorkIntent: 'unanswered',
        featureNextSteps: [suggestion(0)],
      },
    });

    await service.generateAndRecord(source);

    expect(llmClientService.callStructured).not.toHaveBeenCalled();
  });

  it('logs and saves nothing when generation fails', async () => {
    const { service, projectService } = setup({
      llmError: new Error('provider unavailable'),
    });

    await expect(service.generateAndRecord(source)).resolves.toBeUndefined();
    expect(
      projectService.recordOnboardingFeatureNextSteps,
    ).not.toHaveBeenCalled();
  });
});
