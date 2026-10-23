import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';
import type { RepositoryImportFlowContext } from '../../../../types/flow-internal.types';
import type { OnboardingNextStepsService } from '../../../../services/onboarding-next-steps.service';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { OnboardingFinalizeNode } from '../onboarding-finalize.node';

describe('OnboardingFinalizeNode', () => {
  const context: RepositoryImportFlowContext = {
    core: {
      workflowId: '11111111-1111-4111-8111-111111111111' as WorkflowId,
      projectId: '22222222-2222-4222-8222-222222222222' as ProjectId,
      organizationId: '33333333-3333-4333-8333-333333333333' as OrganizationId,
      conversationId: '44444444-4444-4444-8444-444444444444' as ConversationId,
      workflowAboutId: '22222222-2222-4222-8222-222222222222',
      workflowAboutType: 'project',
      user: {
        id: '55555555-5555-4555-8555-555555555555' as UserId,
        role: 'admin',
      },
      session: { startTime: new Date(), interactionCount: 1 },
    },
    flowId: 'onboarding',
    flowPath: { pathTaken: [] },
    repositoryImportMaterializedFeatureIds: [
      '66666666-6666-4666-8666-666666666666',
    ],
  };

  const createNode = () => {
    const nextStepsService = {
      generateAndRecord: jest.fn().mockResolvedValue(undefined),
    };
    return {
      node: new OnboardingFinalizeNode(
        nextStepsService as unknown as OnboardingNextStepsService,
      ),
      nextStepsService,
    };
  };

  it('preserves onboarding completion without repository-import behavior', async () => {
    const { node } = createNode();
    const result = await node.execute(createMutableContextHandle(context));

    expect(result.data).toEqual({
      detectedIntent: 'flow_complete',
      intentConfidence: 1,
    });
    expect(result.message).toContain('project is all set up');
    expect(result.message).not.toContain('import');
  });

  it('records next-step suggestions for the approved Features before completion', async () => {
    const { node, nextStepsService } = createNode();
    await node.execute(createMutableContextHandle(context));

    expect(nextStepsService.generateAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: context.core.organizationId,
        projectId: context.core.projectId,
        conversationId: context.core.conversationId,
        materializedFeatureIds: context.repositoryImportMaterializedFeatureIds,
      }),
    );
  });
});
