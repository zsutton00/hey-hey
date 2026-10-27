import { NodeExecutionService } from '../node-execution.service';
import { RepositoryFeatureEnrichmentNode } from '../../../flows/nodes/onboarding/repository-feature-enrichment.node';
import { makeRepositoryImportContext } from '../../../flows/nodes/onboarding/__tests__/repository-import-context.fixture';
import { testIds } from '../../../utils/testUtils';

describe('terminal CLI handoff delivery', () => {
  it('puts the signed-trigger body on the initial message without a worker or a workflow reply', async () => {
    const node = new RepositoryFeatureEnrichmentNode();
    const context = makeRepositoryImportContext();
    const messages = {
      appendMessageToConversation: jest
        .fn()
        .mockImplementation(async (_conversationId, message) => message),
    };
    const jobs = { queueFlowNodeExecution: jest.fn() };
    const service = new NodeExecutionService(
      {} as never,
      {} as never,
      messages as never,
      jobs as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.startFlowNode({
      node,
      context,
      conversationId: testIds.conversation,
      workflowId: testIds.workflow,
      projectId: testIds.project,
      organizationId: testIds.organization,
      requestId: testIds.request,
      options: { appendMessage: true },
    });
    expect(jobs.queueFlowNodeExecution).not.toHaveBeenCalled();
    expect(messages.appendMessageToConversation).toHaveBeenCalledTimes(1);
    const created = messages.appendMessageToConversation.mock.calls[0][1];
    expect(created.data.triggersAgent).toMatchObject({
      promptType: 'repository_feature_enrichment',
      triggerMessageId: created.id,
      payload: {
        materializedFeatureIds: context.repositoryImportMaterializedFeatureIds,
      },
    });
    expect(result.job).toBeUndefined();
    expect(result.immediateResponse).toMatchObject({
      requestId: testIds.request,
      responseData: { triggersAgent: created.data.triggersAgent },
    });
  });
});
