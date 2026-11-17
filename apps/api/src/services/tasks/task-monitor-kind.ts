import { isDeepStrictEqual } from 'node:util';
import { BadRequestException, Logger } from '@nestjs/common';
import type {
  TaskMonitorExecutionDefinition,
  WorkItemTypeMonitorKind,
} from '@hey-hey/contracts/api/models';
import { validateTaskMonitorExecutionDefinitionContent } from './task-monitor-execution-definition.validator';
import { monitorOperationPolicyIssues } from '@hey-hey/contracts/monitor-kind-policy';

const logger = new Logger('TaskMonitorKind');

const MONITOR_KIND_POLICY_FIELDS = [
  'start',
  'done',
  'supervision',
  'acceptance',
] as const;

/**
 * The canonical kind whose policies fill a policy any declared kind omits:
 * the shipped Task kind, the one source of Task defaults.
 */
const CANONICAL_POLICY_SOURCE_KIND_KEY = 'task';

/** The declared kind a monitor selects by its recorded key. */
export function monitorKindByKey(
  kinds: readonly WorkItemTypeMonitorKind[] | undefined,
  key: string,
): WorkItemTypeMonitorKind | undefined {
  return kinds?.find((kind) => kind.key === key);
}

/**
 * The effective kinds of a TASK_MONITOR definition. A definition that declares
 * no kinds takes the canonical TASK_MONITOR kinds. Each declared kind that
 * omits a policy takes it from the canonical `task` kind. Explicitly declared
 * kinds, restrictions and policies are kept exactly as declared.
 */
export function resolveMonitorKindsCompatibility(
  declared: readonly WorkItemTypeMonitorKind[] | undefined,
  canonical: readonly WorkItemTypeMonitorKind[] | undefined,
): WorkItemTypeMonitorKind[] | undefined {
  if (declared === undefined) {
    return canonical === undefined ? undefined : [...canonical];
  }

  const policySource = monitorKindByKey(
    canonical,
    CANONICAL_POLICY_SOURCE_KIND_KEY,
  );
  if (policySource === undefined) {
    return [...declared];
  }

  return declared.map((kind) => {
    const resolved: WorkItemTypeMonitorKind = { ...kind };
    // Legacy normalized operations retain their no-lifecycle semantics centrally.
    if (
      resolved.acceptance === undefined &&
      resolved.done?.type === 'NORMALIZED_RESULT'
    ) {
      resolved.acceptance = { type: 'NO_STATUS_CHANGE' };
    }
    for (const field of MONITOR_KIND_POLICY_FIELDS) {
      if (resolved[field] === undefined && policySource[field] !== undefined) {
        Object.assign(resolved, { [field]: policySource[field] });
      }
    }
    return resolved;
  });
}

/**
 * Why an effective kind cannot run, each naming the kind, the field and its
 * value. Satisfaction and lifecycle effects are validated independently of
 * whether supervision uses a coordinator or the direct result.
 */
export function monitorKindPolicyIssues(
  kind: WorkItemTypeMonitorKind,
): string[] {
  const { start, done, supervision, acceptance } = kind;
  if (
    start === undefined ||
    done === undefined ||
    supervision === undefined ||
    acceptance === undefined
  ) {
    return MONITOR_KIND_POLICY_FIELDS.filter(
      (field) => kind[field] === undefined,
    ).map(
      (field) =>
        `"${kind.key}" monitor kind has no ${field} policy, and none is published on the canonical "${CANONICAL_POLICY_SOURCE_KIND_KEY}" kind`,
    );
  }

  return monitorOperationPolicyIssues(kind);
}

/** Rejects a kind that cannot run, with every cause in the message. */
function assertMonitorKindRunnable(
  kind: WorkItemTypeMonitorKind,
  context: MonitorRejectionContext,
): void {
  const issues = monitorKindPolicyIssues(kind);
  if (issues.length === 0) {
    return;
  }

  rejectMonitor(
    `Task monitor kind configuration is not supported: ${issues.join('; ')}`,
    { ...context, kind: kind.key, issueCount: issues.length },
  );
}

interface MonitorRejectionContext {
  projectId: string;
  monitorId?: string;
}

/** Logs the specific cause of a rejected monitor, then rejects the write. */
function rejectMonitor(
  message: string,
  context: MonitorRejectionContext & Record<string, unknown>,
): never {
  logger.warn(message, context);
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
 * What a kind constrains: which kind the monitor runs, which work item each
 * node is and how it launches. Runtime state (cursor, linked sessions,
 * dependencies) is not constrained, so recording it never re-gates a monitor
 * that is already running.
 */
function kindConstrainedNodes(definition: TaskMonitorExecutionDefinition) {
  return {
    kind: definition.kind,
    nodes: definition.executionPlan.map((node) => ({
      taskId: node.taskId,
      launchConfiguration: node.launchConfiguration,
    })),
  };
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
 * Rejects a monitor execution definition that names no declared kind, changes
 * the kind it was created with, or has nodes its kind does not allow.
 * Structural problems are the section validator's to report, so a definition
 * that does not parse is left to it. When the stored definition is given, an
 * edit that leaves the kind and every node and launch setting unchanged is not
 * re-checked against the kind's restrictions.
 */
export async function assertTaskMonitorMatchesKind(params: {
  db: TaskNodeTypeReader;
  organizationId: string;
  projectId: string;
  monitorId?: string;
  kinds: readonly WorkItemTypeMonitorKind[] | undefined;
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
  const context: MonitorRejectionContext = {
    projectId: params.projectId,
    ...(params.monitorId === undefined ? {} : { monitorId: params.monitorId }),
  };
  const requestedKey = parsed.value.kind;

  if (stored?.success && stored.value.kind !== requestedKey) {
    rejectMonitor(
      `Task monitor ${params.monitorId ?? '(new)'} runs the "${stored.value.kind}" kind, and a monitor's kind cannot change (requested "${requestedKey}")`,
      { ...context, kind: stored.value.kind, requestedKind: requestedKey },
    );
  }

  const kind = monitorKindByKey(params.kinds, requestedKey);
  if (kind === undefined) {
    const declaredKeys = (params.kinds ?? []).map((declared) => declared.key);
    rejectMonitor(
      `Task monitor ${params.monitorId ?? '(new)'} selects the "${requestedKey}" kind, which the project's TASK_MONITOR type does not declare (declared: ${declaredKeys.length === 0 ? 'none' : declaredKeys.join(', ')})`,
      { ...context, kind: requestedKey, declaredKinds: declaredKeys },
    );
  }

  if (
    stored?.success &&
    isDeepStrictEqual(
      kindConstrainedNodes(stored.value),
      kindConstrainedNodes(parsed.value),
    )
  ) {
    return;
  }

  assertMonitorKindRunnable(kind, context);

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

  rejectMonitor(
    `Task monitor does not match its "${kind.key}" kind: ${issues.join('; ')}`,
    { ...context, kind: kind.key, issueCount: issues.length },
  );
}
