import * as TestUtils from '../../../../utils/testUtils';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { ONBOARDING_NODES, SHARED_NODES } from '../../../constants';
import { onboardingFlow } from '../../../templates/onboarding.flow';
import {
  ClaudeModel,
  LLMProviderName,
} from '../../../../services/llm/llm-shared';
import {
  discoveryResponseSchema,
  OnboardingAnalyzeProjectConceptNode,
} from '../onboarding-analyze-project-concept.node';

const createResponse = (
  detectedIntent: string,
  projectContext?: {
    whatUserWantsToDo: string;
    whatUserWantsToBuild: string | null;
  },
) => ({
  category: 'process' as const,
  summary: 'Coordinate a community launch and keep the work organized.',
  selectedExistingSubfacetNames: [],
  proposedNewSubfacetName: null,
  proposedNewSubfacetConfidence: null,
  proposedNewSubfacetRationale: null,
  subfacets: [],
  type: 'QUESTIONS' as const,
  response: 'I have enough context to summarize the project.',
  detectedIntent,
  intentConfidence: 0.9,
  reasoning: 'The goal and the relevant Hey Hey capabilities are clear.',
  uiElements: [],
  projectContext: projectContext
    ? {
        ...projectContext,
        nativeCapabilities: [
          {
            capability: 'goals' as const,
            rationale: 'Goals keep the intended outcome visible.',
          },
          {
            capability: 'plans' as const,
            rationale: 'Plans organize the work into a reviewable sequence.',
          },
          {
            capability: 'tasks' as const,
            rationale:
              'Tasks capture the concrete work needed to move forward.',
          },
        ],
      }
    : undefined,
});

describe('OnboardingAnalyzeProjectConceptNode', () => {
  it('defines a bounded initial-feature discovery contract', () => {
    const node = new OnboardingAnalyzeProjectConceptNode();
    const prompt = node.promptConfig.systemPromptTemplate as string;

    expect(node.promptConfig).toEqual(
      expect.objectContaining({
        modelCriteria: {
          model: ClaudeModel.CLAUDE_5_HAIKU_5,
          provider: LLMProviderName.CLAUDE,
        },
        responseSchema: discoveryResponseSchema,
        useToolCallSchema: true,
        toolName: 'onboarding_analyze_project_concept',
      }),
    );
    expect(prompt).toContain(
      "gather the information needed to distinguish and describe the project's initial user-facing feature structure",
    );
    expect(prompt).toContain('Who are the intended users');
    expect(prompt).toContain(
      'What core capabilities or user workflows should the initial feature structure distinguish',
    );
    expect(prompt).toContain("What is the project's maturity");
    expect(prompt).toContain(
      'What material constraints would change the scope',
    );
    expect(prompt).toContain(
      "Infer the appropriate Hey Hey structure internally from the user's answers",
    );
    expect(prompt).toContain(
      'Do not ask about roadmap dates, milestones, phases',
    );
    expect(prompt).toContain(
      'Do not ask the user to choose among Goals, Plans, Features, Tasks',
    );
    expect(prompt).not.toContain('You are a senior product manager');
    expect(prompt).not.toContain(
      'Which parts of the work would be useful to track as goals, features, plans',
    );
    expect(prompt).toContain(
      'Do not invent custom work-item types, definitions, or lifecycle fields',
    );
    expect(prompt).not.toContain('workStructures');
    expect(prompt).not.toContain('allowedStatuses');
  });

  it('summarizes a Hey Hey-managed project as work to do, without inventing a build goal', async () => {
    const node = new OnboardingAnalyzeProjectConceptNode();
    const tracker = createMutableContextHandle(
      TestUtils.createMockFlowContext({ flowId: 'onboarding' }),
    );
    const response = createResponse('ready_to_proceed', {
      whatUserWantsToDo:
        'Coordinate a community launch and measure its outcome.',
      whatUserWantsToBuild: null,
    });

    const result = await node.processLlmResponse(
      response,
      TestUtils.createMockFlowUserMessage(),
      tracker,
    );

    expect(result.modifiedResult.response).toContain('What you want to do');
    expect(result.modifiedResult.response).toContain(
      'Coordinate a community launch and measure its outcome.',
    );
    expect(result.modifiedResult.response).toContain('How Hey Hey can help');
    expect(result.modifiedResult.response).not.toContain(
      'What you want to build',
    );
    expect(
      discoveryResponseSchema.parse(response).projectContext
        ?.whatUserWantsToBuild,
    ).toBeNull();
  });

  it('keeps the existing analyze-project route graph', () => {
    const analyzeNode = onboardingFlow.nodes[
      ONBOARDING_NODES.ANALYZE_PROJECT_CONCEPT
    ] as any;
    const transitions = analyzeNode.transitions;

    expect(transitions.implementation_assessment.nextNodeId).toBe(
      SHARED_NODES.ASSESS_IMPLEMENTATION,
    );
    expect(transitions.technical_project.nextNodeId).toBe(
      SHARED_NODES.GENERATE_ARTIFACTS,
    );
    expect(transitions.not_applicable.nextNodeId).toBe(
      SHARED_NODES.POLITE_REDIRECT,
    );
    expect(transitions.default.nextNodeId).toBe(
      SHARED_NODES.GENERATE_ARTIFACTS,
    );
    expect(ONBOARDING_NODES).not.toHaveProperty('PROPOSE_WORK_ITEM_TYPES');
  });

  it('leaves the first follow-up response paused for the user', async () => {
    const node = new OnboardingAnalyzeProjectConceptNode();
    const tracker = createMutableContextHandle(
      TestUtils.createMockFlowContext({ flowId: 'onboarding' }),
    );

    const result = await node.processLlmResponse(
      createResponse('needs_more_information'),
      undefined,
      tracker,
    );

    expect(result.modifiedResult.detectedIntent).toBe('needs_more_information');
  });
});
