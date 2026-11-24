import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  TaskMonitorExecutionDefinition,
  TaskMonitorExecutionNodeLaunchConfiguration,
} from '@hey-hey/contracts/api/models';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { OrganizationId, ProjectId, TaskId, UserId } from '../../../types';
import { shippedTaskMonitorKinds } from '../../../../test/setup/shipped-task-monitor-kind';
import { workItemTypeCapabilitiesSchema } from '../work-item-type-capabilities.schema';
import { assertTaskMonitorMatchesKind } from '../task-monitor-kind';
import { canonicalizeTaskMonitorExecutionDefinitionContent } from '../task-monitor-execution-definition.validator';
import type { TaskService } from '../task.service';
import { TaskMonitorUnstartedLaunchConfigurationService } from '../task-monitor-unstarted-launch-configuration.service';

const openapiRoot = execFileSync(
  process.execPath,
  ['scripts/openapi-root.js'],
  { encoding: 'utf8' },
).trim();
/** The shipped contract fixture: one task already has a session, one does not. */
const shippedNotStarted = JSON.parse(
  readFileSync(
    join(openapiRoot, 'specs/fixtures/task-monitor-contract.json'),
    'utf8',
  ),
).notStarted as TaskMonitorExecutionDefinition;

const ids = {
  organizationId: '10000000-0000-4000-8000-000000000001' as OrganizationId,
  projectId: '20000000-0000-4000-8000-000000000002' as ProjectId,
  monitorId: '30000000-0000-4000-8000-000000000003' as TaskId,
  userId: '40000000-0000-4000-8000-000000000004' as UserId,
  customizedTaskId: '99999999-9999-4999-8999-999999999999',
};

const [startedNode, unstartedNode] = shippedNotStarted.executionPlan;
if (
  !startedNode?.agentSessionId ||
  !unstartedNode ||
  unstartedNode.agentSessionId
) {
  throw new Error('fixture no longer mixes a started and an unstarted task');
}

/** Three tasks: started, unstarted, and unstarted with its own customized setup. */
const storedDefinition: TaskMonitorExecutionDefinition = {
  ...shippedNotStarted,
  executionPlan: [
    ...shippedNotStarted.executionPlan,
    {
      taskId: ids.customizedTaskId,
      dependsOnTaskIds: [unstartedNode.taskId],
      agentSessionId: null,
      launchConfiguration: {
        method: 'open',
        provider: 'claude',
        model: 'claude-opus-5-5',
        reasoningEffort: 'low',
      },
    },
  ],
};

const applied: TaskMonitorExecutionNodeLaunchConfiguration = {
  method: 'quick',
  provider: 'claude',
  model: 'claude-sonnet-5-5',
  reasoningEffort: 'medium',
  fastMode: true,
};

const [TASK_KIND] =
  workItemTypeCapabilitiesSchema.parse({
    monitorKinds: shippedTaskMonitorKinds(),
  }).monitorKinds ?? [];

function setup({
  status = 'BACKLOG',
  archivedAt = null,
  definition = storedDefinition,
  type = 'TASK_MONITOR',
}: {
  status?: string;
  archivedAt?: Date | null;
  definition?: TaskMonitorExecutionDefinition | null;
  type?: string;
} = {}) {
  const writes: TaskMonitorExecutionDefinition[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: ids.monitorId }]),
    task: {
      findFirst: jest.fn(async () => ({
        id: ids.monitorId,
        type,
        status,
        archivedAt,
        initiativeId: null,
      })),
      // Every selected node is a Standard Task, which the shipped kind allows.
      findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.map((id) => ({ id, type: 'STANDARD' })),
      ),
    },
    taskSection: {
      findFirst: jest.fn(async () =>
        definition === null
          ? null
          : { materializedMarkdown: JSON.stringify(definition) },
      ),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  };
  // The section write validates exactly as the shared update path does: the
  // contract schema, then the shipped monitor kind against the stored value.
  const taskService = {
    updateInTransaction: jest.fn(
      async (
        client: typeof tx,
        _organizationId: string,
        _initiativeId: string | null,
        _taskId: string,
        dto: { sections: Array<{ content: unknown }> },
      ) => {
        const content = dto.sections[0]?.content;
        canonicalizeTaskMonitorExecutionDefinitionContent(content);
        await assertTaskMonitorMatchesKind({
          db: client,
          organizationId: ids.organizationId,
          projectId: ids.projectId,
          monitorId: ids.monitorId,
          kinds: TASK_KIND ? [TASK_KIND] : [],
          executionDefinitionContent: content,
          storedExecutionDefinitionContent: JSON.stringify(definition),
        });
        writes.push(content as TaskMonitorExecutionDefinition);
        return { task: {}, postCommit: {} };
      },
    ),
    runUpdatePostCommit: jest.fn(async () => undefined),
  };
  const service = new TaskMonitorUnstartedLaunchConfigurationService(
    prisma as unknown as PrismaService,
    taskService as unknown as TaskService,
  );
  const apply = (launchConfiguration = applied) =>
    service.apply({
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      monitorId: ids.monitorId,
      userId: ids.userId,
      launchConfiguration,
    });
  return { apply, tx, writes, taskService };
}

describe('applying one launch configuration to unstarted Task Monitor tasks', () => {
  it('replaces all five values on every task without a session, including customized ones, and leaves started tasks unchanged', async () => {
    const { apply, tx, writes } = setup();

    const result = await apply();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      updatedTaskIds: [unstartedNode.taskId, ids.customizedTaskId],
      skippedTaskIds: [startedNode.taskId],
    });
    expect(writes).toHaveLength(1);
    const [written] = writes;
    expect(written?.executionPlan[0]).toEqual(startedNode);
    expect(written?.executionPlan[1]?.launchConfiguration).toEqual(applied);
    expect(written?.executionPlan[2]?.launchConfiguration).toEqual(applied);
    // Only launch configuration changes: cursor, policy, dependencies and
    // session references stay as stored.
    expect({
      ...written,
      executionPlan: written?.executionPlan.map(
        ({ launchConfiguration: _changed, ...rest }) => rest,
      ),
    }).toEqual({
      ...storedDefinition,
      executionPlan: storedDefinition.executionPlan.map(
        ({ launchConfiguration: _changed, ...rest }) => rest,
      ),
    });
  });

  it('works while the monitor is paused, skipping the task whose session exists', async () => {
    const { apply, writes } = setup({ status: 'ACTIVE' });

    const result = await apply();

    expect(result.skippedTaskIds).toEqual([startedNode.taskId]);
    expect(writes).toHaveLength(1);
  });

  it('skips a task linked to a session before the write, reading the set under the row lock', async () => {
    const linkedMeanwhile: TaskMonitorExecutionDefinition = {
      ...storedDefinition,
      executionPlan: storedDefinition.executionPlan.map((node) =>
        node.taskId === unstartedNode.taskId
          ? { ...node, agentSessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }
          : node,
      ),
    };
    const { apply, writes } = setup({ definition: linkedMeanwhile });

    const result = await apply();

    expect(result).toEqual({
      updatedTaskIds: [ids.customizedTaskId],
      skippedTaskIds: [startedNode.taskId, unstartedNode.taskId],
    });
    expect(writes[0]?.executionPlan[1]).toEqual(
      linkedMeanwhile.executionPlan[1],
    );
  });

  it('rejects a launch method the monitor does not allow and changes nothing', async () => {
    const { apply, writes, taskService } = setup();

    await expect(
      apply({ ...applied, method: 'review' as 'plan' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toHaveLength(0);
    expect(taskService.runUpdatePostCommit).not.toHaveBeenCalled();
  });

  it('rejects a configuration with fields outside the contract and changes nothing', async () => {
    const { apply, writes } = setup();

    await expect(
      apply({
        ...applied,
        agentSessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      } as TaskMonitorExecutionNodeLaunchConfiguration),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toHaveLength(0);
  });

  it.each([
    ['completed', { status: 'COMPLETED' }],
    ['archived', { archivedAt: new Date('2026-11-01T00:00:00Z') }],
  ])('refuses the %s monitor', async (_label, state) => {
    const { apply, writes } = setup(state);

    await expect(apply()).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toHaveLength(0);
  });

  it('refuses when every task already has a session', async () => {
    const { apply, writes } = setup({
      definition: {
        ...storedDefinition,
        executionPlan: storedDefinition.executionPlan.map((node, index) => ({
          ...node,
          agentSessionId:
            node.agentSessionId ??
            `ffffffff-ffff-4fff-8fff-00000000000${index}`,
        })),
      },
    });

    await expect(apply()).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toHaveLength(0);
  });

  it('returns not found for a work item that is not a Task Monitor', async () => {
    const { apply } = setup({ type: 'STANDARD' });

    await expect(apply()).rejects.toBeInstanceOf(NotFoundException);
  });
});
