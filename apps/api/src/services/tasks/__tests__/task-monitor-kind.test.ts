import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { TaskMonitorExecutionDefinition } from '@hey-hey/contracts/api/models';
import { shippedTaskMonitorKind } from '../../../../test/setup/shipped-task-monitor-kind';
import { workItemTypeCapabilitiesSchema } from '../work-item-type-capabilities.schema';
import { assertTaskMonitorMatchesKind } from '../task-monitor-kind';
const openapiRoot = execFileSync(
  process.execPath,
  ['scripts/openapi-root.js'],
  { encoding: 'utf8' },
).trim();
const populatedMonitor = JSON.parse(
  readFileSync(
    join(openapiRoot, 'specs/fixtures/task-monitor-contract.json'),
    'utf8',
  ),
).notStarted as TaskMonitorExecutionDefinition;

type ExecutionNode = TaskMonitorExecutionDefinition['executionPlan'][number];
const [firstNode, secondNode] = populatedMonitor.executionPlan as [
  ExecutionNode,
  ExecutionNode,
];

/** The kind the shipped migrations publish on the canonical TASK_MONITOR template. */
function shippedCanonicalKind() {
  const { monitorKind } = workItemTypeCapabilitiesSchema.parse({
    monitorKind: shippedTaskMonitorKind(),
  });
  if (monitorKind === undefined) {
    throw new Error('migrations publish no monitor kind');
  }
  return monitorKind;
}

const TASK_KIND = shippedCanonicalKind();

function dbWithNodeTypes(typeOf: (taskId: string) => string | undefined) {
  return {
    task: {
      findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.flatMap((id) => {
          const type = typeOf(id);
          return type === undefined ? [] : [{ id, type }];
        }),
      ),
    },
  };
}

function check(
  definition: unknown,
  typeOf: (taskId: string) => string | undefined,
) {
  return assertTaskMonitorMatchesKind({
    db: dbWithNodeTypes(typeOf),
    organizationId: 'org',
    projectId: 'project',
    kind: TASK_KIND,
    executionDefinitionContent: JSON.stringify(definition),
  });
}

describe('task monitor kind', () => {
  it('publishes the Task kind with ACTIVE start, COMPLETED done and coordinator Review', () => {
    expect(TASK_KIND).toMatchObject({
      key: 'task',
      allowedNodeTypes: ['STANDARD'],
      allowedLaunchMethods: ['plan', 'open', 'quick'],
      start: { type: 'STATUS_TRANSITION', status: 'ACTIVE' },
      done: { type: 'ITEM_STATUS', status: 'COMPLETED' },
      supervision: { type: 'COORDINATOR_REVIEW' },
    });
  });

  it.each([
    ['explicit null start', { start: null }, ['start']],
    [
      'an unknown start type',
      { start: { type: 'RESTART' } },
      ['start', 'type'],
    ],
    [
      'a status transition without its status',
      { start: { type: 'STATUS_TRANSITION' } },
      ['start', 'status'],
    ],
    [
      'an unknown done status',
      { done: { type: 'ITEM_STATUS', status: 'DONE' } },
      ['done', 'status'],
    ],
    [
      'an unknown policy field',
      { supervision: { type: 'DIRECT_ACCEPTANCE', script: 'x' } },
      ['supervision'],
    ],
    [
      'coordinator Review with normalized-result done',
      { done: { type: 'NORMALIZED_RESULT' } },
      ['done', 'type'],
    ],
    [
      'direct acceptance with item-status done',
      { supervision: { type: 'DIRECT_ACCEPTANCE' } },
      ['done', 'type'],
    ],
  ])(
    'rejects a kind declaring %s, naming the offending field',
    (_case, change, path) => {
      const parsed = workItemTypeCapabilitiesSchema.safeParse({
        monitorKind: { ...shippedTaskMonitorKind(), ...change },
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toContainEqual([
        'monitorKind',
        ...path,
      ]);
    },
  );

  it('accepts a complete non-Task configuration', () => {
    const parsed = workItemTypeCapabilitiesSchema.safeParse({
      monitorKind: {
        ...shippedTaskMonitorKind(),
        key: 'requirement-check',
        start: { type: 'NO_STATUS_CHANGE' },
        done: { type: 'NORMALIZED_RESULT' },
        supervision: { type: 'DIRECT_ACCEPTANCE' },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['no kind at all', undefined, /declares no kind/],
    [
      'an unsupported pairing',
      {
        ...shippedTaskMonitorKind(),
        supervision: { type: 'DIRECT_ACCEPTANCE' as const },
      },
      /"task" monitor kind combines supervision "DIRECT_ACCEPTANCE" with done "ITEM_STATUS"/,
    ],
  ])(
    'rejects a monitor whose effective kind has %s before reading its nodes',
    async (_case, kind, message) => {
      const db = dbWithNodeTypes(() => 'STANDARD');

      await expect(
        assertTaskMonitorMatchesKind({
          db,
          organizationId: 'org',
          projectId: 'project',
          kind: kind as never,
          executionDefinitionContent: JSON.stringify(populatedMonitor),
        }),
      ).rejects.toThrow(message);
      expect(db.task.findMany).not.toHaveBeenCalled();
    },
  );

  it('accepts a populated monitor whose nodes are all Tasks', async () => {
    expect(populatedMonitor.executionPlan.length).toBeGreaterThan(1);

    await expect(check(populatedMonitor, () => 'STANDARD')).resolves.toBe(
      undefined,
    );
  });

  it('rejects a node whose work-item type the kind does not allow, naming node, type and kind', async () => {
    await expect(
      check(populatedMonitor, (id) =>
        id === secondNode.taskId ? 'BUG' : 'STANDARD',
      ),
    ).rejects.toThrow(
      new RegExp(`${secondNode.taskId}.*"BUG".*"task" monitor kind`),
    );
  });

  it('rejects a node that is not a work item in the project', async () => {
    await expect(
      check(populatedMonitor, (id) =>
        id === firstNode.taskId ? undefined : 'STANDARD',
      ),
    ).rejects.toThrow(new RegExp(`${firstNode.taskId}.*does not identify`));
  });

  it('rejects a launch mode, provider and effort the kind does not allow, naming node and kind', async () => {
    const node = firstNode;
    const narrowedKind = {
      ...TASK_KIND,
      allowedLaunchMethods: ['quick' as const],
      allowedRuntimeProviders: ['codex' as const],
      allowedReasoningEfforts: ['low' as const],
    };
    const definition = structuredClone(populatedMonitor);
    definition.executionPlan[0]!.launchConfiguration = {
      ...node.launchConfiguration,
      method: 'plan',
      provider: 'claude',
      reasoningEffort: 'high',
    };

    const rejection = assertTaskMonitorMatchesKind({
      db: dbWithNodeTypes(() => 'STANDARD'),
      organizationId: 'org',
      projectId: 'project',
      kind: narrowedKind,
      executionDefinitionContent: JSON.stringify(definition),
    });

    await expect(rejection).rejects.toThrow(
      new RegExp(`${node.taskId}.*launch method "plan".*"task" monitor kind`),
    );
    await expect(rejection).rejects.toThrow(/runtime provider "claude"/);
    await expect(rejection).rejects.toThrow(/reasoning effort "high"/);
  });

  describe('editing a monitor that is already running', () => {
    function edit(
      next: TaskMonitorExecutionDefinition,
      typeOf: (taskId: string) => string | undefined,
    ) {
      const db = dbWithNodeTypes(typeOf);
      const result = assertTaskMonitorMatchesKind({
        db,
        organizationId: 'org',
        projectId: 'project',
        kind: TASK_KIND,
        executionDefinitionContent: JSON.stringify(next),
        storedExecutionDefinitionContent: JSON.stringify(populatedMonitor),
      });
      return { db, result };
    }

    it('does not re-check nodes when only the cursor and linked sessions change', async () => {
      const advanced = structuredClone(populatedMonitor);
      advanced.cursor = 1;
      advanced.executionPlan[0]!.agentSessionId =
        '55555555-5555-4555-8555-555555555555';

      // A node retyped since the monitor was created must not stop it advancing.
      const { db, result } = edit(advanced, () => 'BUG');

      await expect(result).resolves.toBeUndefined();
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    it('re-checks the nodes when a launch setting changes', async () => {
      const changed = structuredClone(populatedMonitor);
      changed.executionPlan[0]!.launchConfiguration.model = 'another-model';

      const { db, result } = edit(changed, () => 'BUG');

      await expect(result).rejects.toThrow(/has work-item type "BUG"/);
      expect(db.task.findMany).toHaveBeenCalled();
    });
  });
});
