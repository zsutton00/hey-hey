import { TaskGenerationGenerateStubsNode } from '../generate-stubs.node';
import * as TestUtils from '../../../../utils/testUtils';
import {
  FlowUserMessage,
  TaskGenerationFlowContext,
} from '../../../../types/flow-internal.types';
import { v4 as uuidv4 } from 'uuid';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

describe('TaskGenerationGenerateStubsNode', () => {
  const uuidMock = uuidv4 as jest.Mock;

  const createContext = (): TaskGenerationFlowContext => ({
    ...(TestUtils.createMockFlowContext() as TaskGenerationFlowContext),
    initiativeId: TestUtils.testIds.initiative,
    stubSession: {
      round: 2,
      latestSourceSummary: 'Lean scope for docs auth',
      stubs: [
        {
          id: 'existing-stub-1',
          title: 'Existing approved stub',
          shortDescription: 'Stub from first round',
          sourceType: 'initiative',
          round: 1,
          status: 'suggested',
          influences: [],
        },
        {
          id: 'existing-stub-2',
          title: 'Maybe remove stub',
          shortDescription: 'Stub to reconsider',
          sourceType: 'initiative',
          round: 1,
          status: 'suggested',
          influences: [],
        },
      ],
    },
  });

  const createUserMessage = (): FlowUserMessage =>
    TestUtils.createMockFlowUserMessage({
      data: {
        stubFeedback: {
          type: 'TASK_STUBS',
          response: 'Stub feedback',
          actions: [],
          round: 2,
          stubs: createContext().stubSession?.stubs ?? [],
          stubReviews: [
            { stubId: 'existing-stub-1', action: 'accept' },
            { stubId: 'existing-stub-2', action: 'reject' },
          ],
          manuallyAdded: [
            {
              title: 'Draft auth spike',
              shortDescription: 'Quick spike on auth approach',
            },
          ],
          nextAction: 'GENERATE_STUBS',
        },
      },
    });

  beforeEach(() => {
    uuidMock.mockReset();
    const ids = [
      'manual-stub-id',
      'llm-stub-id-1',
      'llm-stub-id-2',
      'ui-element-id',
    ];
    uuidMock.mockImplementation(() => ids.shift() || 'exhausted-uuid');
  });

  it('builds a stub system message snapshot', async () => {
    const context = createContext();
    const tracker =
      createMutableContextHandle<TaskGenerationFlowContext>(context);
    const userMessage = createUserMessage();
    const node = new TaskGenerationGenerateStubsNode();

    await node.beforeGeneration(tracker, userMessage);

    const { modifiedResult } = await node.processLlmResponse(
      {
        stubs: [
          {
            title: 'Add monitoring baseline',
            shortDescription: 'Sketch instrumentation plan',
            sourceType: 'parent_task',
            reasoning: 'Need visibility into early flows',
            influences: [
              {
                entityId: 'conversation-1',
                reasoning: 'Pulled from earlier chat about launch readiness',
                reasonType: 'previous_conversation',
                confidence: 0.72,
              },
            ],
          },
          {
            title: 'Create onboarding tasks',
            shortDescription: 'Sequence early contributor flow',
            sourceType: 'initiative',
            influences: [],
          },
        ],
        response: 'Here are some fresh stubs based on the feedback.',
      } as any,
      userMessage,
      tracker,
    );

    expect(modifiedResult).toMatchSnapshot();
    expect(context.stubSession?.round).toBe(3);
  });
});
