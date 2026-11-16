import { isDeepStrictEqual } from 'node:util';
import { BadRequestException, Logger } from '@nestjs/common';
import type {
  TaskMonitorExecutionDefinition,
  WorkItemTypeMonitorKind,
} from '@hey-hey/contracts/api/models';
import { validateTaskMonitorExecutionDefinitionContent } from './task-monitor-execution-definition.validator';
import { DONE_POLICY_FOR_SUPERVISION } from './work-item-type-capabilities.schema';

const logger = new Logger('TaskMonitorKind');

const MONITOR_KIND_POLICY_FIELDS = ['start', 'done', 'supervision'] as const;

/**
 * The effective kind of a TASK_MONITOR definition. A definition that declares
 * no kind, or a kind that omits a policy, takes it from the canonical
 * TASK_MONITOR definition, the one source of Task behavior. Explicitly declared
 * restrictions and policies are kept exactly as declared.
 */
export function resolveMonitorKindCompatibility(
  declared: WorkItemTypeMonitorKind | undefined,
  canonical: WorkItemTypeMonitorKind | undefined,
): WorkItemTypeMonitorKind | undefined {
  if (declared === undefined || canonical === undefined) {
    return declared ?? canonical;
  }

  const resolved: WorkItemTypeMonitorKind = { ...declared };
  for (const field of MONITOR_KIND_POLICY_FIELDS) {
    if (resolved[field] === undefined && canonical[field] !== undefined) {
      Object.assign(resolved, { [field]: canonical[field] });
    }
  }
  return resolved;
}

/**
 * Why an effective kind cannot run, each naming the kind, the field and its
 * value. Coordinator supervision confirms acceptance from item status, and
 * direct acceptance from the normalized result, so each needs its done rule.
 */
export function monitorKindPolicyIssues(
  kind: WorkItemTypeMonitorKind | undefined,
): string[] {
  if (kind === undefined) {
    return [
      'the monitor type declares no kind and the canonical TASK_MONITOR definition publishes none',
    ];
  }

  const { start, done, supervision } = kind;
  if (start === undefined || done === undefined || supervision === undefined) {
    return MONITOR_KIND_POLICY_FIELDS.filter(
      (field) => kind[field] === undefined,
    ).map(
      (field) =>
        `"${kind.key}" monitor kind has no ${field} policy, and none is published on the canonical TASK_MONITOR definition`,
    );
  }

  const requiredDone = DONE_POLICY_FOR_SUPERVISION[supervision.type];
  if (done.type !== requiredDone) {
    return [
      `"${kind.key}" monitor kind combines supervision "${supervision.type}" with done "${done.type}"; supervision "${supervision.type}" requires done "${requiredDone}"`,
    ];
  }
  return [];
}

/** Rejects a kind that cannot run, with every cause in the message. */
export function assertMonitorKindRunnable(
  kind: WorkItemTypeMonitorKind | undefined,
  context: { projectId: string; monitorId?: string },
): asserts kind is WorkItemTypeMonitorKind {
  const issues = monitorKindPolicyIssues(kind);
  if (issues.length === 0) {
    return;
  }

  const message = `Task monitor kind configuration is not supported: ${issues.join('; ')}`;
  logger.warn(message, {
    ...context,
    kind: kind?.key ?? null,
    issueCount: issues.length,
  });
  throw new BadRequestException(message);
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
  kind: WorkItemTypeMonitorKind | undefined;
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

  const { kind } = params;
  assertMonitorKindRunnable(kind, {
    projectId: params.projectId,
    ...(params.monitorId === undefined ? {} : { monitorId: params.monitorId }),
  });

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

  const issues = taskMonitorKindIssues(parsed.value, kind, nodeTypesByTaskId);
  if (issues.length === 0) {
    return;
  }

  const message = `Task monitor does not match its "${kind.key}" kind: ${issues.join('; ')}`;
  logger.warn(message, {
    monitorId: params.monitorId,
    projectId: params.projectId,
    kind: kind.key,
    issueCount: issues.length,
  });
  throw new BadRequestException(message);
}
