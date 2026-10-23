import { createMutableContextHandle } from '../../../utils/mutable-context';
import type {
  FlowUserMessage,
  WorkTrackerImportFlowContext,
} from '../../../types/flow-internal.types';
import { WORK_TRACKER_IMPORT_NODES } from '../../constants/node-ids';
import { workTrackerImportFlow } from '../../templates/work-tracker-import.flow';
import {
  WorkTrackerImportConnectNode,
  WorkTrackerImportImportNode,
} from './work-tracker-import-agent.nodes';
import {
  WorkTrackerImportConfigurationNode,
  WorkTrackerImportConnectConfirmNode,
  WorkTrackerImportStartNode,
} from './work-tracker-import-setup.nodes';
import {
  buildWorkTrackerRequest,
  mapWorkTrackerSuccessToFeatureGeneration,
  mergeWorkTrackerImportAdditionalContext,
  WORK_TRACKER_FIELDS,
} from './work-tracker-import.contract';

const machineId = '44444444-4444-4444-8444-444444444444';
const configuration = {
  source: 'linear' as const,
  machineId,
  provider: 'codex' as const,
  resolvedFrontierModel: 'selected-model',
  reasoningEffort: 'high' as const,
};
const success = {
  outcome: 'success' as const,
  source: 'linear' as const,
  narrative: 'Existing account capabilities.',
  hierarchy: {
    topLevels: [
      {
        id: 'accounts',
        name: 'Accounts',
        description: 'Manage accounts',
        tag: 'product' as const,
        children: [
          {
            id: 'account-access',
            name: 'Account Access',
            description: 'Access accounts',
            tag: 'backend' as const,
          },
        ],
      },
    ],
  },
  evidence: [{ reference: 'LIN-1', summary: 'Account project' }],
};

function makeContext(
  overrides: Partial<WorkTrackerImportFlowContext> = {},
): WorkTrackerImportFlowContext {
  return {
    core: {
      workflowId: '33333333-3333-4333-8333-333333333333',
      projectId: '11111111-1111-4111-8111-111111111111',
      organizationId: '55555555-5555-4555-8555-555555555555',
      conversationId: '22222222-2222-4222-8222-222222222222',
      workflowAboutId: '11111111-1111-4111-8111-111111111111',
      workflowAboutType: 'project',
      user: { id: '66666666-6666-4666-8666-666666666666', role: 'member' },
      session: { startTime: new Date(), interactionCount: 0 },
    },
    flowId: 'work-tracker-import',
    flowPath: { pathTaken: [] },
    ...overrides,
  } as unknown as WorkTrackerImportFlowContext;
}

const message = (data: Record<string, unknown>) =>
  ({ data }) as unknown as FlowUserMessage;

describe('work-tracker import workflow', () => {
  it('declares every routed node in the template', () => {
    for (const nodeId of Object.values(WORK_TRACKER_IMPORT_NODES)) {
      expect(workTrackerImportFlow.nodes[nodeId]).toBeDefined();
    }
    expect(workTrackerImportFlow.startNode).toBe(
      WORK_TRACKER_IMPORT_NODES.CONFIGURATION,
    );
  });

  it('accepts runtime choices only for a machine paired to the user', async () => {
    const pairing = {
      listMachines: jest
        .fn()
        .mockResolvedValue([
          { machineId, name: 'laptop', pairedAt: new Date() },
        ]),
    };
    const node = new WorkTrackerImportConfigurationNode(pairing as never);
    const tracker = createMutableContextHandle(makeContext());
    await node.processUserResponse(
      tracker,
      message({
        [WORK_TRACKER_FIELDS.source]: 'linear',
        [WORK_TRACKER_FIELDS.machineId]: machineId,
        [WORK_TRACKER_FIELDS.provider]: 'codex',
        [WORK_TRACKER_FIELDS.model]: 'selected-model',
        [WORK_TRACKER_FIELDS.reasoningEffort]: 'high',
      }),
    );
    expect(tracker.getContext().workTrackerImportConfiguration).toEqual(
      configuration,
    );
    await expect(
      node.determineRoutingFromUserMessage(tracker.getContext()),
    ).resolves.toBe(WORK_TRACKER_IMPORT_NODES.CONNECT);

    pairing.listMachines.mockResolvedValue([]);
    const rejected = createMutableContextHandle(makeContext());
    await node.processUserResponse(
      rejected,
      message({
        [WORK_TRACKER_FIELDS.source]: 'linear',
        [WORK_TRACKER_FIELDS.machineId]: machineId,
        [WORK_TRACKER_FIELDS.provider]: 'codex',
        [WORK_TRACKER_FIELDS.model]: 'selected-model',
        [WORK_TRACKER_FIELDS.reasoningEffort]: 'high',
      }),
    );
    expect(
      rejected.getContext().workTrackerImportConfiguration,
    ).toBeUndefined();
  });

  it('sends connection confirmation only after an explicit user action', async () => {
    const context = makeContext({
      workTrackerImportConfiguration: configuration,
    });
    expect(
      buildWorkTrackerRequest(context, 'work_tracker_connect', 'node'),
    ).not.toHaveProperty('connectionConfirmed');

    const confirm = new WorkTrackerImportConnectConfirmNode();
    const tracker = createMutableContextHandle(context);
    const confirmed = message({
      [WORK_TRACKER_FIELDS.action]: 'CONFIRM_CONNECTION',
    });
    await confirm.processUserResponse(tracker, confirmed);
    await expect(
      confirm.determineRoutingFromUserMessage(tracker.getContext(), confirmed),
    ).resolves.toBe(WORK_TRACKER_IMPORT_NODES.CONNECT);
    expect(
      buildWorkTrackerRequest(
        tracker.getContext(),
        'work_tracker_connect',
        'node',
      ),
    ).toMatchObject({ connectionConfirmed: true, source: 'linear' });
  });

  it('waits at the start gate until the user starts the import', async () => {
    const node = new WorkTrackerImportStartNode();
    const context = makeContext({
      workTrackerImportConfiguration: configuration,
    });
    await expect(
      node.determineRoutingFromUserMessage(
        context,
        message({ [WORK_TRACKER_FIELDS.action]: 'START_IMPORT' }),
      ),
    ).resolves.toBe(WORK_TRACKER_IMPORT_NODES.IMPORT);
    await expect(
      node.determineRoutingFromUserMessage(
        context,
        message({ [WORK_TRACKER_FIELDS.action]: 'FINISH_LATER' }),
      ),
    ).resolves.toBe(WORK_TRACKER_IMPORT_NODES.START);
  });

  it('routes connect outcomes to start or back to the connect step', async () => {
    const node = new WorkTrackerImportConnectNode();
    const context = makeContext({
      workTrackerImportConfiguration: configuration,
    });
    const built = await node.buildTriggerMessage(
      createMutableContextHandle(context),
    );
    expect(built.triggersAgent).toMatchObject({
      promptType: 'work_tracker_connect',
      payload: { source: 'linear', machineId },
    });
    expect(
      (built.triggersAgent as { payload: object }).payload,
    ).not.toHaveProperty('serviceId');
    await expect(
      node.determineRoutingFromAgentCompletion(context, 'connected'),
    ).resolves.toBe(WORK_TRACKER_IMPORT_NODES.START);
    await expect(
      node.determineRoutingFromAgentCompletion(context, 'connection_required'),
    ).resolves.toBe(WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM);
  });

  it('returns to connect when the fresh import session lacks source tools', async () => {
    const node = new WorkTrackerImportImportNode();
    const tracker = createMutableContextHandle(
      makeContext({
        workTrackerImportConfiguration: configuration,
        workTrackerConnectionConfirmed: true,
      }),
    );
    await node.processUserResponse(
      tracker,
      message({
        action: 'connection_required',
        payload: { outcome: 'connection_required', source: 'linear' },
      }),
    );
    expect(tracker.getContext().workTrackerConnectionConfirmed).toBeUndefined();
    await expect(
      node.determineRoutingFromAgentCompletion(
        tracker.getContext(),
        'connection_required',
      ),
    ).resolves.toBe(WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM);
  });

  it('accepts a matching outline and hands it to the shared review', async () => {
    const node = new WorkTrackerImportImportNode();
    const tracker = createMutableContextHandle(
      makeContext({ workTrackerImportConfiguration: configuration }),
    );
    await node.processUserResponse(
      tracker,
      message({ action: 'success', payload: { ...success, source: 'jira' } }),
    );
    expect(tracker.getContext().workTrackerImportAccepted).toBeUndefined();

    await node.processUserResponse(
      tracker,
      message({ action: 'success', payload: success }),
    );
    expect(tracker.getContext().workTrackerImportAccepted).toEqual(success);
    await expect(
      node.determineRoutingFromAgentCompletion(tracker.getContext(), 'success'),
    ).resolves.toBe(WORK_TRACKER_IMPORT_NODES.GENERATE_FEATURES);
    expect(mapWorkTrackerSuccessToFeatureGeneration(success)).toMatchObject({
      narrative: success.narrative,
      topLevels: [
        {
          candidateId: 'accounts',
          children: [{ candidateId: 'account-access' }],
        },
      ],
    });
  });

  it('carries the creation entry into flow state', () => {
    expect(
      mergeWorkTrackerImportAdditionalContext(
        {},
        { entryMode: 'existing_project', source: 'jira' },
      ),
    ).toEqual({
      workTrackerImportEntry: { entryMode: 'existing_project', source: 'jira' },
    });
  });
});
