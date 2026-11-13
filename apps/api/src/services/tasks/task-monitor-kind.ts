import { isDeepStrictEqual } from 'node:util';
import { BadRequestException, Logger } from '@nestjs/common';
import {
  TaskMonitorLaunchMethod,
  TaskMonitorLaunchProvider,
  TaskMonitorReasoningEffort,
  type TaskMonitorExecutionDefinition,
  type WorkItemTypeMonitorKind,
} from '@hey-hey/contracts/api/models';
import { validateTaskMonitorExecutionDefinitionContent } from './task-monitor-execution-definition.validator';

const logger = new Logger('TaskMonitorKind');

/**
 * The kind every monitor resolves to when its type declares none. It allows
 * exactly what Task Monitor allowed before kinds existed: Task nodes launched
 * with Plan, Open or Quick on any provider and reasoning effort.
 */
export const TASK_MONITOR_TASK_KIND: WorkItemTypeMonitorKind = {
  key: 'task',
  allowedNodeTypes: ['STANDARD'],
  allowedLaunchMethods: Object.values(TaskMonitorLaunchMethod),
  allowedRuntimeProviders: Object.values(TaskMonitorLaunchProvider),
  allowedReasoningEfforts: Object.values(TaskMonitorReasoningEffort),
};

export function resolveTaskMonitorKind(
  declared: WorkItemTypeMonitorKind | undefined,
): WorkItemTypeMonitorKind {
  return declared ?? TASK_MONITOR_TASK_KIND;
}

/**
 * Every way the definition's nodes fall outside what the kind allows. Each
 * issue names the node, the offending value and the kind.
 */
export function taskMonitorKindIssues(
  definition: TaskMonitorExecutionDefinition,
  kind: WorkItemTypeMonitorKind,
  nodeTypesByTaskId: ReadonlyMap<string, string>,
): string[] {
  const issues: string[] = [];

  definition.executionPlan.forEach((node, index) => {
    const nodeLabel = `executionPlan[${index}] node ${node.taskId}`;
    const nodeType = nodeTypesByTaskId.get(node.taskId);

    if (nodeType === undefined) {
      issues.push(
        `${nodeLabel} does not identify a work item in this project, so its type cannot be checked against the "${kind.key}" monitor kind`,
      );
    } else if (!kind.allowedNodeTypes.includes(nodeType)) {
      issues.push(
        `${nodeLabel} has work-item type "${nodeType}", which the "${kind.key}" monitor kind does not allow (allowed: ${kind.allowedNodeTypes.join(', ')})`,
      );
    }

    const launch = node.launchConfiguration;
    const launchChecks = [
      ['launch method', launch.method, kind.allowedLaunchMethods],
      ['runtime provider', launch.provider, kind.allowedRuntimeProviders],
      [
        'reasoning effort',
        launch.reasoningEffort,
        kind.allowedReasoningEfforts,
      ],
    ] as const;
    for (const [what, value, allowed] of launchChecks) {
      if (!(allowed as readonly string[]).includes(value)) {
        issues.push(
          `${nodeLabel} uses ${what} "${value}", which the "${kind.key}" monitor kind does not allow (allowed: ${allowed.join(', ')})`,
        );
      }
    }
  });

  return issues;
}

/**
 * What a kind constrains: which work item each node is and how it launches.
 * Runtime state (cursor, linked sessions, dependencies) is not constrained, so
 * recording it never re-gates a monitor that is already running.
 */
function kindConstrainedNodes(definition: TaskMonitorExecutionDefinition) {
  return definition.executionPlan.map((node) => ({
    taskId: node.taskId,
    launchConfiguration: node.launchConfiguration,
  }));
}

interface TaskNodeTypeReader {
  task: {
    findMany(args: {
      where: {
        id: { in: string[] };
        organizationId: string;
        projectId: string;
      };
      select: { id: true; type: true };
    }): PromiseLike<Array<{ id: string; type: string }>>;
  };
}

/**
 * Rejects a monitor execution definition whose nodes its kind does not allow.
 * Structural problems are the section validator's to report, so a definition
 * that does not parse is left to it. When the stored definition is given, an
 * edit that leaves every node and launch setting unchanged is not re-checked.
 */
export async function assertTaskMonitorMatchesKind(params: {
  db: TaskNodeTypeReader;
  organizationId: string;
  projectId: string;
  monitorId?: string;
  kind: WorkItemTypeMonitorKind;
  executionDefinitionContent: unknown;
  storedExecutionDefinitionContent?: unknown;
}): Promise<void> {
  if (
    params.executionDefinitionContent === null ||
    params.executionDefinitionContent === undefined
  ) {
    return;
  }

  const parsed = validateTaskMonitorExecutionDefinitionContent(
    params.executionDefinitionContent,
  );
  if (!parsed.success) {
    return;
  }

  const stored =
    params.storedExecutionDefinitionContent === null ||
    params.storedExecutionDefinitionContent === undefined
      ? undefined
      : validateTaskMonitorExecutionDefinitionContent(
          params.storedExecutionDefinitionContent,
        );
  if (
    stored?.success &&
    isDeepStrictEqual(
      kindConstrainedNodes(stored.value),
      kindConstrainedNodes(parsed.value),
    )
  ) {
    return;
  }

  const taskIds = parsed.value.executionPlan.map((node) => node.taskId);
  const nodes = await params.db.task.findMany({
    where: {
      id: { in: taskIds },
      organizationId: params.organizationId,
      projectId: params.projectId,
    },
    select: { id: true, type: true },
  });
  const nodeTypesByTaskId = new Map(nodes.map((node) => [node.id, node.type]));

  const issues = taskMonitorKindIssues(
    parsed.value,
    params.kind,
    nodeTypesByTaskId,
  );
  if (issues.length === 0) {
    return;
  }

  const message = `Task monitor does not match its "${params.kind.key}" kind: ${issues.join('; ')}`;
  logger.warn(message, {
    monitorId: params.monitorId,
    projectId: params.projectId,
    kind: params.kind.key,
    issueCount: issues.length,
  });
  throw new BadRequestException(message);
}
