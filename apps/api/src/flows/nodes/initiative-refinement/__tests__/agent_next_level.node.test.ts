import { TestingModule } from '@nestjs/testing';
import { createServiceTestingModule } from 'src/../test/setup/testing-module.factory';
import { InitiativeSectionUpdateSource, WorkStatus } from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import {
  InitiativeRefinementFlowContext,
  NodeType,
} from 'src/types/flow-internal.types';
import * as TestUtils from 'src/utils/testUtils';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import { InitiativeRefinementAgentNextLevelNode } from '../agent_next_level.node';

describe('InitiativeRefinementAgentNextLevelNode', () => {
  let module: TestingModule;
  let node: InitiativeRefinementAgentNextLevelNode;
  let initiativeService: ReturnType<
    typeof TestUtils.createMockInitiativeService
  >;
  let artifactService: ReturnType<typeof TestUtils.createMockArtifactService>;
  const baseContext = TestUtils.createMockFlowContext();
  const context: InitiativeRefinementFlowContext = {
    ...baseContext,
    core: {
      ...baseContext.core,
      workflowAboutType: 'initiative',
      workflowAboutId: TestUtils.testIds.initiative,
    },
    initiativeId: TestUtils.testIds.initiative,
  };

  beforeEach(async () => {
    initiativeService = TestUtils.createMockInitiativeService();
    artifactService = TestUtils.createMockArtifactService();

    const setup = await createServiceTestingModule({
      providers: [InitiativeRefinementAgentNextLevelNode],
      overrides: [
        [InitiativeService, initiativeService],
        [ArtifactService, artifactService],
      ],
    });

    module = setup.module;
    node = module.get(InitiativeRefinementAgentNextLevelNode);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('exposes metadata and schema', () => {
    expect(node.id).toBe('initiative-refinement-agent-next-level');
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
          target: 'details',
          text: 'Generated details content',
        },
      ],
      response: 'Here is the generated content',
      sectionCompleteConfidence: 0.9,
      relatedEntities: [],
    };

    const result = node.responseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it('response schema supports operations with influences', () => {
    const responseWithInfluences = {
      ops: [
        {
          type: 'replace',
          target: 'acceptanceCriteria',
          text: 'Generated acceptance criteria',
        },
      ],
      response: 'Content generated based on context',
      sectionCompleteConfidence: 0.85,
      relatedEntities: [],
      influences: [
        {
          entityId: 'artifact-123',
          entityType: 'ARTIFACT',
          reasoning: 'Referenced for context',
          reasonType: 'explicit_mention',
          confidence: 0.9,
        },
      ],
    };

    const result = node.responseSchema.safeParse(responseWithInfluences);
    expect(result.success).toBe(true);
  });

  it('response schema requires valid operation types', () => {
    const invalidResponse = {
      ops: [
        {
          type: 'invalid_type',
          target: 'details',
          text: 'Test content',
        },
      ],
      sectionCompleteConfidence: 0.7,
      relatedEntities: [],
    };

    const result = node.responseSchema.safeParse(invalidResponse);
    expect(result.success).toBe(false);
  });

  describe('processAgentResponse', () => {
    it('with REFINING_DESCRIPTION status should progress to REFINING_DETAILS and update details field', async () => {
      const initiative = TestUtils.createMockInitiative({
        status: 'REFINING_DESCRIPTION' as any,
      });
      initiativeService.findOne = jest.fn().mockResolvedValue(initiative);
      initiativeService.updateForAdapter = jest
        .fn()
        .mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'details',
                text: 'Generated details content',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(initiativeService.updateForAdapter).toHaveBeenCalledWith(
        initiative.id,
        {
          status: 'REFINING_DETAILS',
          sections: [
            {
              key: 'details',
              content: 'Generated details content',
              order: 1,
            },
          ],
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
        },
        initiative.organizationId,
      );
      expect(result.nextNodeId).toBe('initiative-refinement-agent-editor');
    });

    it('with GENERATING_DESCRIPTION status should transition to REFINING_DESCRIPTION and update description field', async () => {
      const initiative = TestUtils.createMockInitiative({
        status: 'GENERATING_DESCRIPTION' as any,
      });
      initiativeService.findOne = jest.fn().mockResolvedValue(initiative);
      initiativeService.updateForAdapter = jest
        .fn()
        .mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'description',
                text: 'Generated description content',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(initiativeService.updateForAdapter).toHaveBeenCalledWith(
        initiative.id,
        {
          status: 'REFINING_DESCRIPTION',
          sections: [
            {
              key: 'description',
              content: 'Generated description content',
              order: 0,
            },
          ],
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
        },
        initiative.organizationId,
      );
      expect(result.nextNodeId).toBe('initiative-refinement-agent-editor');
    });

    it('with GENERATING_DETAILS status should transition to REFINING_DETAILS and update details field', async () => {
      const initiative = TestUtils.createMockInitiative({
        status: 'GENERATING_DETAILS' as any,
      });
      initiativeService.findOne = jest.fn().mockResolvedValue(initiative);
      initiativeService.updateForAdapter = jest
        .fn()
        .mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'details',
                text: 'Generated details content',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.85,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(initiativeService.updateForAdapter).toHaveBeenCalledWith(
        initiative.id,
        {
          status: 'REFINING_DETAILS',
          sections: [
            {
              key: 'details',
              content: 'Generated details content',
              order: 1,
            },
          ],
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
        },
        initiative.organizationId,
      );
      expect(result.nextNodeId).toBe('initiative-refinement-agent-editor');
    });

    it('with REFINING_DETAILS status should progress to REFINING_ACCEPTANCE_CRITERIA and update acceptanceCriteria field', async () => {
      const initiative = TestUtils.createMockInitiative({
        status: 'REFINING_DETAILS' as any,
      });
      initiativeService.findOne = jest.fn().mockResolvedValue(initiative);
      initiativeService.updateForAdapter = jest
        .fn()
        .mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated acceptance criteria',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(initiativeService.updateForAdapter).toHaveBeenCalledWith(
        initiative.id,
        {
          status: 'REFINING_ACCEPTANCE_CRITERIA',
          sections: [
            {
              key: 'acceptanceCriteria',
              content: 'Generated acceptance criteria',
              order: 2,
            },
          ],
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
        },
        initiative.organizationId,
      );
      expect(result.nextNodeId).toBe('initiative-refinement-agent-editor');
    });

    it('with GENERATING_ACCEPTANCE_CRITERIA status should transition to REFINING_ACCEPTANCE_CRITERIA and update acceptanceCriteria field', async () => {
      const initiative = TestUtils.createMockInitiative({
        status: 'GENERATING_ACCEPTANCE_CRITERIA' as any,
      });
      initiativeService.findOne = jest.fn().mockResolvedValue(initiative);
      initiativeService.updateForAdapter = jest
        .fn()
        .mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated acceptance criteria',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.88,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(initiativeService.updateForAdapter).toHaveBeenCalledWith(
        initiative.id,
        {
          status: 'REFINING_ACCEPTANCE_CRITERIA',
          sections: [
            {
              key: 'acceptanceCriteria',
              content: 'Generated acceptance criteria',
              order: 2,
            },
          ],
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
        },
        initiative.organizationId,
      );
      expect(result.nextNodeId).toBe('initiative-refinement-agent-editor');
    });

    it('should handle missing initiative gracefully', async () => {
      initiativeService.findOne = jest.fn().mockResolvedValue(null);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'details',
                text: 'Generated content',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(result.nextNodeId).toBe('initiative-refinement-agent-next-level');
      if (!('errorMsg' in result)) {
        throw new Error('Expected error result');
      }
      expect(result.errorMsg).toBeDefined();
    });

    it('should return error when agent response has no result', async () => {
      const agentResponse = {
        result: null,
        executionId: 'test-exec-id',
        status: 'failed',
        error: 'Agent failed',
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(result.nextNodeId).toBe('initiative-refinement-agent-next-level');
      if (!('errorMsg' in result)) {
        throw new Error('Expected error result');
      }
      expect(result.errorMsg).toContain('missing result field');
    });

    it('should return error when response validation fails', async () => {
      const initiative = TestUtils.createMockInitiative({
        status: 'REFINING_DESCRIPTION' as any,
      });
      initiativeService.findOne = jest.fn().mockResolvedValue(initiative);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'invalid_operation_type',
                target: 'details',
                text: 'Invalid content',
              },
            ],
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
        executionId: 'test-exec-id',
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(result.nextNodeId).toBe('initiative-refinement-agent-next-level');
      if (!('errorMsg' in result)) {
        throw new Error('Expected error result');
      }
      expect(result.errorMsg).toContain('validation failed');
    });

    it('should build valid UI element with influences', async () => {
      const initiative = TestUtils.createMockInitiative({
        status: 'REFINING_DESCRIPTION' as any,
      });
      initiativeService.findOne = jest.fn().mockResolvedValue(initiative);
      initiativeService.updateForAdapter = jest
        .fn()
        .mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated content',
              },
            ],
            response: 'Here is the generated content',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
            influences: [
              {
                entityId: 'artifact-123',
                entityType: 'ARTIFACT',
                reasoning: 'Referenced for context',
                reasonType: 'explicit_mention',
                confidence: 0.9,
              },
            ],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(result.nextNodeId).toBe('initiative-refinement-agent-editor');
      if (
        !('systemMessageData' in result) ||
        !result.systemMessageData ||
        result.systemMessageData.type !== 'QUESTIONS'
      ) {
        throw new Error('Expected QUESTIONS system message');
      }
      expect(result.systemMessageData.uiElements).toHaveLength(1);
      expect(result.systemMessageData.uiElements?.[0]?.influences).toHaveLength(
        1,
      );
    });

    it('should apply multiple ops for current and future levels, advancing only to next section', async () => {
      const initiative = TestUtils.createMockInitiative({
        status: 'REFINING_DESCRIPTION' as any,
      });
      initiativeService.findOne = jest.fn().mockResolvedValue(initiative);
      initiativeService.updateForAdapter = jest
        .fn()
        .mockResolvedValue(undefined);

      const agentResponse = {
        result: {
          data: {
            ops: [
              {
                type: 'replace',
                target: 'details',
                text: 'Generated details content',
              },
              {
                type: 'replace',
                target: 'acceptanceCriteria',
                text: 'Generated acceptance criteria content',
              },
            ],
            response: 'Generated content for multiple levels',
            sectionCompleteConfidence: 0.9,
            relatedEntities: [],
          },
        },
      } as any;

      const tracker = createMutableContextHandle(context);
      const result = await node.processAgentResponse(agentResponse, tracker);

      expect(initiativeService.updateForAdapter).toHaveBeenCalledWith(
        initiative.id,
        {
          status: 'REFINING_DETAILS',
          sections: [
            {
              key: 'details',
              content: 'Generated details content',
              order: 1,
            },
            {
              key: 'acceptanceCriteria',
              content: 'Generated acceptance criteria content',
              order: 2,
            },
          ],
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
        },
        initiative.organizationId,
      );
      expect(result.nextNodeId).toBe('initiative-refinement-agent-editor');
    });
  });
});
