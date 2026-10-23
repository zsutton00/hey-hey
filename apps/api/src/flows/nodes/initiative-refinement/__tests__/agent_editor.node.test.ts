import { TestingModule } from '@nestjs/testing';
import { createServiceTestingModule } from 'src/../test/setup/testing-module.factory';
import { WorkStatus } from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import {
  InitiativeRefinementFlowContext,
  NodeType,
} from 'src/types/flow-internal.types';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import * as TestUtils from 'src/utils/testUtils';
import { InitiativeRefinementAgentEditorNode } from '../agent_editor.node';

describe('InitiativeRefinementAgentEditorNode', () => {
  let module: TestingModule;
  let node: InitiativeRefinementAgentEditorNode;
  let initiativeService: ReturnType<
    typeof TestUtils.createMockInitiativeService
  >;
  let artifactService: ReturnType<typeof TestUtils.createMockArtifactService>;

  beforeEach(async () => {
    initiativeService = TestUtils.createMockInitiativeService();
    artifactService = TestUtils.createMockArtifactService();

    const setup = await createServiceTestingModule({
      providers: [InitiativeRefinementAgentEditorNode],
      overrides: [
        [InitiativeService, initiativeService],
        [ArtifactService, artifactService],
      ],
    });

    module = setup.module;
    node = module.get(InitiativeRefinementAgentEditorNode);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('exposes metadata and schema', () => {
    expect(node.id).toBe('initiative-refinement-agent-editor');
    expect(node.type).toBe(NodeType.AGENT);
    expect(node.responseSchema).toBeDefined();
  });

  it('uses initiative-refiner agent', () => {
    expect(node.agentId).toBe('initiative-refiner');
  });

  it('response schema validates operations pattern', () => {
    const validResponse = {
      ops: [
        {
          type: 'replace',
          target: 'description',
          text: 'Updated description',
        },
      ],
      response: 'Here are my suggestions',
      sectionCompleteConfidence: 0.85,
      relatedEntities: [],
    };

    const result = node.responseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it('response schema requires valid operations structure', () => {
    const invalidResponse = {
      ops: [
        {
          type: 'invalid_operation',
          target: 'description',
          text: 'Test',
        },
      ],
      sectionCompleteConfidence: 0.5,
      relatedEntities: [],
    };

    const result = node.responseSchema.safeParse(invalidResponse);
    expect(result.success).toBe(false);
  });

  it('builds agent input with empty optional fields', async () => {
    const initiativeId = 'initiative-1' as InitiativeId;

    initiativeService.findOneForAdapter.mockResolvedValue(
      TestUtils.createMockInitiative({
        id: initiativeId,
        name: 'Self-created initiative',
        status: WorkStatus.RefiningDescription,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: '',
          details: '',
          acceptanceCriteria: '',
        }),
      }),
    );

    artifactService.findMany.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });

    const context: InitiativeRefinementFlowContext = {
      core: {
        workflowId: 'workflow-initiative' as WorkflowId,
        projectId: 'project-initiative' as ProjectId,
        organizationId: 'org-initiative' as OrganizationId,
        conversationId: 'conversation-initiative' as ConversationId,
        workflowAboutId: initiativeId,
        workflowAboutType: 'initiative',
        user: {
          id: 'user-1' as UserId,
          role: 'pm',
        },
        session: {
          startTime: new Date('2024-01-02T09:00:00Z'),
          interactionCount: 1,
        },
      },
      flowId: 'initiative_flow',
      initiativeId,
      flowPath: {
        pathTaken: [],
      },
    };

    const agentInput = await node.agentInput(
      createMutableContextHandle(context),
    );

    expect(agentInput?.initiative.details).toBe('');
    expect(agentInput?.initiative.acceptanceCriteria).toBe('');
  });
});
