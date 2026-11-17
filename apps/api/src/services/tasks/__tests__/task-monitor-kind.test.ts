import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  TaskMonitorExecutionDefinition,
  WorkItemTypeMonitorKind,
} from '@hey-hey/contracts/api/models';
import {
  shippedTaskMonitorKind,
  shippedTaskMonitorKinds,
} from '../../../../test/setup/shipped-task-monitor-kind';
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

/** The `task` kind the shipped migrations publish on the canonical TASK_MONITOR template. */
function shippedCanonicalKind() {
  const [taskKind] =
    workItemTypeCapabilitiesSchema.parse({
      monitorKinds: shippedTaskMonitorKinds(),
    }).monitorKinds ?? [];
  if (taskKind === undefined) {
    throw new Error('migrations publish no monitor kind');
  }
  return taskKind;
}

const TASK_KIND = shippedCanonicalKind();

/** A test-only direct-acceptance kind declared beside `task` on the same type. */
const DIRECT_KIND: WorkItemTypeMonitorKind = {
  ...TASK_KIND,
  key: 'requirement-check',
  acceptance: { type: 'NO_STATUS_CHANGE' },
  allowedNodeTypes: ['BUG'],
  start: { type: 'NO_STATUS_CHANGE' },
  done: { type: 'NORMALIZED_RESULT' },
  supervision: { type: 'DIRECT_ACCEPTANCE' },
};

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
    kinds: [TASK_KIND],
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
        monitorKinds: [{ ...shippedTaskMonitorKind(), ...change }],
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toContainEqual([
        'monitorKinds',
        0,
        ...path,
      ]);
    },
  );

  it('rejects weakened Task completion across kind keys and types, and leaves allowed node types to each kind', () => {
    const reusable = {
      ...DIRECT_KIND,
      supervision: { type: 'COORDINATOR_REVIEW' },
    };
    expect(
      workItemTypeCapabilitiesSchema.safeParse({ monitorKinds: [reusable] })
        .success,
    ).toBe(true);
    for (const key of ['task', 'renamed-execution']) {
      for (const allowedNodeTypes of [
        ['STANDARD'],
        ['BUG'],
        ['STANDARD', 'BUG'],
      ]) {
        const kind = {
          ...TASK_KIND,
          key,
          allowedNodeTypes,
          done: { type: 'ITEM_STATUS', status: 'VERIFYING' },
        };
        expect(
          workItemTypeCapabilitiesSchema.safeParse({ monitorKinds: [kind] })
            .success,
        ).toBe(false);
      }
    }
    expect(
      workItemTypeCapabilitiesSchema.safeParse({
        monitorKinds: [{ ...reusable, allowedNodeTypes: ['STANDARD'] }],
      }).success,
    ).toBe(true);
    expect(
      workItemTypeCapabilitiesSchema.safeParse({
        monitorKinds: [{ ...TASK_KIND, allowedNodeTypes: ['STANDARD', 'BUG'] }],
      }).success,
    ).toBe(true);
  });

  it.each([
    { ...DIRECT_KIND, acceptance: { type: 'COMPLETE_ITEM' } },
    { ...DIRECT_KIND, done: { type: 'ITEM_STATUS', status: 'COMPLETED' } },
    { ...DIRECT_KIND, start: { type: 'STATUS_TRANSITION', status: 'ACTIVE' } },
  ])(
    'rejects incompatible reusable operation effects before execution ($acceptance.type, $done.type, $start.type)',
    (kind) => {
      expect(
        workItemTypeCapabilitiesSchema.safeParse({ monitorKinds: [kind] })
          .success,
      ).toBe(false);
    },
  );

  it('accepts a type declaring the Task kind beside a complete non-Task kind', () => {
    const parsed = workItemTypeCapabilitiesSchema.safeParse({
      monitorKinds: [shippedTaskMonitorKind(), DIRECT_KIND],
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects a type declaring the same kind key twice, naming the key', () => {
    const parsed = workItemTypeCapabilitiesSchema.safeParse({
      monitorKinds: [
        shippedTaskMonitorKind(),
        DIRECT_KIND,
        { ...DIRECT_KIND, allowedNodeTypes: ['STANDARD'] },
      ],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['monitorKinds', 2, 'key'],
        message:
          'monitor kind key "requirement-check" is declared more than once',
      }),
    );
  });

  it.each([
    [
      'selects a kind the type does not declare',
      [DIRECT_KIND],
      /selects the "task" kind, which the project's TASK_MONITOR type does not declare \(declared: requirement-check\)/,
    ],
    [
      'runs a kind with an unsupported pairing',
      [
        {
          ...TASK_KIND,
          supervision: { type: 'DIRECT_ACCEPTANCE' as const },
        },
      ],
      /DIRECT_ACCEPTANCE requires NORMALIZED_RESULT/,
    ],
  ])(
    'rejects a monitor that %s before reading its nodes',
    async (_case, kinds, message) => {
      const db = dbWithNodeTypes(() => 'STANDARD');

      await expect(
        assertTaskMonitorMatchesKind({
          db,
          organizationId: 'org',
          projectId: 'project',
          monitorId: 'monitor-1',
          kinds,
          executionDefinitionContent: JSON.stringify(populatedMonitor),
        }),
      ).rejects.toThrow(message);
      expect(db.task.findMany).not.toHaveBeenCalled();
    },
  );

  describe('a project declaring the Task kind and a direct-acceptance kind', () => {
    const kinds = [TASK_KIND, DIRECT_KIND];

    function checkAs(kindKey: string, nodeType: string) {
      return assertTaskMonitorMatchesKind({
        db: dbWithNodeTypes(() => nodeType),
        organizationId: 'org',
        projectId: 'project',
        kinds,
        executionDefinitionContent: JSON.stringify({
          ...populatedMonitor,
          kind: kindKey,
        }),
      });
    }

    it('checks each monitor against the kind it selects', async () => {
      await expect(checkAs('task', 'STANDARD')).resolves.toBeUndefined();
      await expect(
        checkAs('requirement-check', 'BUG'),
      ).resolves.toBeUndefined();
    });

    it("rejects a node only its monitor's own kind disallows", async () => {
      await expect(checkAs('task', 'BUG')).rejects.toThrow(
        /"BUG", which the "task" monitor kind does not allow/,
      );
      await expect(checkAs('requirement-check', 'STANDARD')).rejects.toThrow(
        /"STANDARD", which the "requirement-check" monitor kind does not allow/,
      );
    });
  });

  it.each(['DIRECT_ACCEPTANCE', 'COORDINATOR_REVIEW'] as const)(
    'validates populated reusable monitors through the execution boundary under %s',
    async (type) => {
      const kind: WorkItemTypeMonitorKind = {
        ...DIRECT_KIND,
        supervision: { type },
      };
      const db = dbWithNodeTypes(() => 'BUG');
      await expect(
        assertTaskMonitorMatchesKind({
          db,
          organizationId: 'org',
          projectId: 'project',
          kinds: [kind],
          executionDefinitionContent: JSON.stringify({
            ...populatedMonitor,
            kind: kind.key,
          }),
        }),
      ).resolves.toBeUndefined();
      expect(db.task.findMany).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects an intermediate-status Task execution at the execution boundary before reading selected items', async () => {
    const kind: WorkItemTypeMonitorKind = {
      ...TASK_KIND,
      key: 'renamed-execution',
      done: { type: 'ITEM_STATUS', status: 'VERIFYING' },
    };
    const db = dbWithNodeTypes(() => 'STANDARD');
    await expect(
      assertTaskMonitorMatchesKind({
        db,
        organizationId: 'org',
        projectId: 'project',
        kinds: [kind],
        executionDefinitionContent: JSON.stringify({
          ...populatedMonitor,
          kind: kind.key,
        }),
      }),
    ).rejects.toThrow(/canonical COMPLETED/);
    expect(db.task.findMany).not.toHaveBeenCalled();
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
      kinds: [narrowedKind],
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
      kinds: WorkItemTypeMonitorKind[] = [TASK_KIND, DIRECT_KIND],
    ) {
      const db = dbWithNodeTypes(typeOf);
      const result = assertTaskMonitorMatchesKind({
        db,
        organizationId: 'org',
        projectId: 'project',
        monitorId: 'monitor-1',
        kinds,
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

    it("does not re-check unchanged nodes after the kind's restrictions are narrowed", async () => {
      const advanced = structuredClone(populatedMonitor);
      advanced.cursor = 1;
      const narrowedTaskKind = {
        ...TASK_KIND,
        allowedLaunchMethods: ['quick' as const],
      };

      const { db, result } = edit(advanced, () => 'STANDARD', [
        narrowedTaskKind,
      ]);

      await expect(result).resolves.toBeUndefined();
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    it('rejects changing the kind of an existing monitor, naming both keys', async () => {
      const switched = {
        ...structuredClone(populatedMonitor),
        kind: 'requirement-check',
      };

      const { db, result } = edit(switched, () => 'BUG');

      await expect(result).rejects.toThrow(
        /monitor-1 runs the "task" kind, and a monitor's kind cannot change \(requested "requirement-check"\)/,
      );
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    it('rejects an unchanged monitor whose kind is no longer declared', async () => {
      const advanced = structuredClone(populatedMonitor);
      advanced.cursor = 1;

      const { result } = edit(advanced, () => 'STANDARD', [DIRECT_KIND]);

      await expect(result).rejects.toThrow(
        /monitor-1 selects the "task" kind, which the project's TASK_MONITOR type does not declare/,
      );
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
