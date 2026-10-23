import { TestingModule } from '@nestjs/testing';
import { createServiceTestingModule } from 'src/../test/setup/testing-module.factory';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import { DesignDocId } from 'src/types/design-doc.types';
import { BrainstormRefinementFlowContext } from 'src/types/flow-internal.types';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import * as TestUtils from 'src/utils/testUtils';
import { BRAINSTORM_REFINEMENT_NODES } from '../../../constants/node-ids';
import { BrainstormRefinementAgentAnalysisNode } from '../agent_refiner.node';

describe('BrainstormRefinementAgentAnalysisNode', () => {
  let module: TestingModule;
  let node: BrainstormRefinementAgentAnalysisNode;
  let designDocService: ReturnType<typeof TestUtils.createMockDesignDocService>;
  let artifactService: ReturnType<typeof TestUtils.createMockArtifactService>;

  const designDocId = 'design-doc-1' as DesignDocId;

  const baseContext: BrainstormRefinementFlowContext = {
    core: {
      workflowId: 'workflow-brainstorm' as WorkflowId,
      projectId: 'project-brainstorm' as ProjectId,
      organizationId: 'org-brainstorm' as OrganizationId,
      conversationId: 'conversation-brainstorm' as ConversationId,
      workflowAboutId: designDocId,
      workflowAboutType: 'design-doc',
      user: {
        id: 'user-1' as UserId,
        role: 'pm',
      },
      session: {
        startTime: new Date('2024-01-02T09:00:00Z'),
        interactionCount: 1,
      },
    },
    flowId: 'brainstorm_refinement',
    designDocId,
    flowPath: {
      pathTaken: [],
    },
  };

  beforeEach(async () => {
    designDocService = TestUtils.createMockDesignDocService();
    artifactService = TestUtils.createMockArtifactService();

    const setup = await createServiceTestingModule({
      providers: [BrainstormRefinementAgentAnalysisNode],
      overrides: [
        [DesignDocService, designDocService],
        [ArtifactService, artifactService],
      ],
    });

    module = setup.module;
    node = module.get(BrainstormRefinementAgentAnalysisNode);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('accepts suspended response in schema', () => {
    const result = node.responseSchema.safeParse({
      status: 'suspended',
      runId: 'run-1',
      clarifyingQuestions: ['Question 1?'],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected schema parse to succeed');
    }
    expect(result.data).toMatchObject({
      status: 'suspended',
      runId: 'run-1',
      clarifyingQuestions: ['Question 1?'],
    });
  });

  it('returns QUESTIONS node when clarification is required', async () => {
    const tracker = createMutableContextHandle(baseContext);

    const agentResponse = {
      result: {
        data: {
          status: 'suspended',
          runId: 'run-123',
          clarifyingQuestions: ['Question 1?', 'Question 2?'],
        },
      },
    } as any;

    const result = await node.processAgentResponse(agentResponse, tracker);

    expect(result.nextNodeId).toBe(BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS);
    expect('systemMessageData' in result).toBe(true);

    if (!('systemMessageData' in result) || !result.systemMessageData) {
      throw new Error('Expected systemMessageData in result');
    }

    expect(result.systemMessageData.type).toBe('QUESTIONS');
    expect(result.systemMessageData.uiElements).toHaveLength(1);
    expect(result.systemMessageData.uiElements?.[0]?.type).toBe(
      'question_group',
    );

    const updatedContext = tracker.getContext();
    expect(updatedContext.clarifyingRunId).toBe('run-123');
    expect(updatedContext.clarifyingQuestions).toEqual([
      'Question 1?',
      'Question 2?',
    ]);
  });

  it('routes to recovery for malformed suspended payload', async () => {
    const tracker = createMutableContextHandle(baseContext);

    const agentResponse = {
      result: {
        data: {
          status: ' check other agent nodes to see how to handle suspended. ',
          runId: 'run-123',
          clarifyingQuestions: ['Question 1?', 'Question 2?'],
        },
      },
    } as any;

    const result = await node.processAgentResponse(agentResponse, tracker);

    expect(result.nextNodeId).toBe(BRAINSTORM_REFINEMENT_NODES.RECOVERY);
    expect('errorMsg' in result).toBe(true);
  });

  it('includes resume payload when clarifying run is pending', async () => {
    designDocService.findOneForAdapter.mockResolvedValue({
      id: designDocId,
      name: 'Brainstorm Title',
      sections: [
        {
          key: 'content',
          materializedMarkdown: 'Existing brainstorm content.',
        },
      ],
    } as any);

    artifactService.findMany.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });

    const tracker = createMutableContextHandle({
      ...baseContext,
      clarifyingRunId: 'run-456',
      clarifyingQuestions: ['Question 1?', 'Question 2?'],
    });

    const latestUserMessage = {
      id: 'msg-1',
      data: {
        questionGroup: {
          clarifyingAnswers: [
            { question: 'Question 1?', answer: 'Yes' },
            { question: 'Question 2?', answer: 'No' },
          ],
        },
      },
      timestamp: new Date().toISOString(),
    } as any;

    const agentInput = await node.agentInput(tracker, latestUserMessage);

    expect(agentInput.resumeRunId).toBe('run-456');
    expect(agentInput.resumeData?.lastUserMessage).toBeDefined();
    expect(agentInput.resumeData?.clarifyingAnswers).toEqual(
      expect.arrayContaining(['Yes', 'No']),
    );
  });
});
