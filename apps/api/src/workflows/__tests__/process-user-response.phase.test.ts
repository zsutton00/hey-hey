import { patched } from '@temporalio/workflow';
import * as TestUtils from '../../utils/testUtils';
import { WorkflowStep } from '../conversation-workflow-state';
import { loadNodeConfiguration } from '../phases/initialization';
import { handleUserResponseProcessing } from '../phases/process-user-response';
import { processNodeResponse, saveFlowState } from '../phases/shared';

// Mock Temporal workflow primitives and shared helpers to keep tests fast.
jest.mock('@temporalio/workflow', () => ({
  patched: jest.fn(() => false),
  proxyActivities: () => new Proxy({}, { get: () => jest.fn() }),
  defineSignal: (name: string) => name,
  defineQuery: (name: string) => name,
  setHandler: jest.fn(),
  workflowInfo: () => ({ workflowId: 'wf-test' }),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../phases/initialization', () => ({
  loadNodeConfiguration: jest.fn(),
}));

jest.mock('../phases/shared', () => ({
  processNodeResponse: jest.fn(),
  saveFlowState: jest.fn(),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('handleUserResponseProcessing — parkOnUserResponse', () => {
  const mockedPatched = patched as jest.Mock;
  const mockedProcessNodeResponse = processNodeResponse as unknown as jest.Mock;
  const NODE_ID = 'feature-sync-coding-plan';
  const EXEC_ID = 'exec-1';

  const buildState = () =>
    TestUtils.createMockWorkflowState({
      currentNodeId: NODE_ID,
      currentNodeExecutionId: EXEC_ID,
      nodeConfig: TestUtils.createMockNodeConfiguration({
        id: NODE_ID,
        supportsPhases: true,
      }),
      userMessagesByExecution: {
        [EXEC_ID]: TestUtils.createMockFlowUserMessage(),
      },
      context: TestUtils.createMockFlowContext({
        flowPath: { pathTaken: [NODE_ID] },
      }),
    });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parks on the current node without regenerating when the completion is parkOnUserResponse (patched)', async () => {
    mockedPatched.mockReturnValue(true);
    const state = buildState();
    mockedProcessNodeResponse.mockResolvedValue({
      // Self-loop: the agent-authored REVISED completion routes back to the
      // same node, but the transition is marked parkOnUserResponse.
      nextNodeId: NODE_ID,
      updatedContext: state.context,
      parkOnUserResponse: true,
    });

    const result = await handleUserResponseProcessing(state as any);

    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
    // No transition / regeneration: node config is not reloaded and the
    // consumed completion is dropped so UserWait does not immediately re-wake.
    expect(loadNodeConfiguration).not.toHaveBeenCalled();
    expect(state.currentNodeId).toBe(NODE_ID);
    expect(state.userMessagesByExecution?.[EXEC_ID]).toBeUndefined();
    expect(saveFlowState).toHaveBeenCalled();
  });

  it('falls back to transition + regeneration when the park patch is off (legacy replay)', async () => {
    mockedPatched.mockReturnValue(false);
    const state = buildState();
    mockedProcessNodeResponse.mockResolvedValue({
      nextNodeId: NODE_ID,
      updatedContext: state.context,
      parkOnUserResponse: true,
    });

    const result = await handleUserResponseProcessing(state as any);

    // Legacy path: re-enter the node (self-loop transition) and regenerate.
    expect(loadNodeConfiguration).toHaveBeenCalled();
    expect(result.nextStep).toBe(WorkflowStep.GENERATING_QUESTIONS);
  });

  it('transitions normally when the completion is not parkOnUserResponse', async () => {
    mockedPatched.mockReturnValue(true);
    const state = buildState();
    mockedProcessNodeResponse.mockResolvedValue({
      nextNodeId: 'feature-sync-implement',
      updatedContext: state.context,
      parkOnUserResponse: false,
    });

    const result = await handleUserResponseProcessing(state as any);

    expect(loadNodeConfiguration).toHaveBeenCalled();
    expect(state.currentNodeId).toBe('feature-sync-implement');
    expect(result.nextStep).not.toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
  });

  it('re-enters the coding-plan node for a non-parked REFINE self-loop', async () => {
    mockedPatched.mockReturnValue(true);
    const state = buildState();
    mockedProcessNodeResponse.mockResolvedValue({
      nextNodeId: NODE_ID,
      updatedContext: state.context,
      parkOnUserResponse: false,
    });

    const result = await handleUserResponseProcessing(state as any);

    expect(loadNodeConfiguration).toHaveBeenCalled();
    expect(state.currentNodeId).toBe(NODE_ID);
    expect(result.nextStep).toBe(WorkflowStep.GENERATING_QUESTIONS);
  });
});
