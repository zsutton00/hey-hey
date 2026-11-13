import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { TaskMonitorExecutionDefinition } from '@hey-hey/contracts/api/models';
import { workItemTypeCapabilitiesSchema } from '../work-item-type-capabilities.schema';
import {
  assertTaskMonitorMatchesKind,
  resolveTaskMonitorKind,
  TASK_MONITOR_TASK_KIND,
} from '../task-monitor-kind';

const migrationSql = readFileSync(
  resolve(
    __dirname,
    '../../../../db/flyway/V2026.11.13.064226__publish_task_monitor_task_kind.sql',
  ),
  'utf8',
);
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

/** The kind the migration publishes on the canonical TASK_MONITOR template. */
function shippedCanonicalKind() {
  const literal = /\$kind\$([\s\S]*?)\$kind\$/.exec(migrationSql)?.[1];
  if (literal === undefined) {
    throw new Error('migration does not publish a monitor kind');
  }
  const { monitorKind } = workItemTypeCapabilitiesSchema.parse({
    monitorKind: JSON.parse(literal),
  });
  return monitorKind;
}

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
    kind: shippedCanonicalKind()!,
    executionDefinitionContent: JSON.stringify(definition),
  });
}

describe('task monitor kind', () => {
  it('publishes exactly the Task kind on the canonical type, and monitors without a kind resolve to it', () => {
    expect(shippedCanonicalKind()).toEqual(TASK_MONITOR_TASK_KIND);
    expect(resolveTaskMonitorKind(undefined)).toBe(TASK_MONITOR_TASK_KIND);
    expect(TASK_MONITOR_TASK_KIND.allowedNodeTypes).toEqual(['STANDARD']);
    expect(TASK_MONITOR_TASK_KIND.allowedLaunchMethods).toEqual([
      'plan',
      'open',
      'quick',
    ]);
  });

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
      ...TASK_MONITOR_TASK_KIND,
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
        kind: TASK_MONITOR_TASK_KIND,
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
