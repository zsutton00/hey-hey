import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import type {
  AgentEdgeResponseDto,
  MaterializedWorkItemSection,
  TaskResponseDto,
  WorkItemGraphAggregateResponseDto,
  WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import { AgentEdgeType } from "@hey-hey/ui-common/api";
import type { WorkflowGraphSurfaceData } from "@hey-hey/ui-common/components/shared/WorkflowMentionInlineRenderer";

const WORKFLOW_TYPE = WORK_ITEM_TYPE_KEYS.Diagram;
const WORKFLOW_STEP_TYPE = WORK_ITEM_TYPE_KEYS.DiagramElement;

const WORKFLOW_FLOW_EDGE_TYPES = [
  AgentEdgeType.Standard,
  AgentEdgeType.Conditional,
  AgentEdgeType.Loop,
] as const;

const WORKFLOW_FULFILLED_BY_EDGE_TYPE = AgentEdgeType.FulfilledBy;

const WORKFLOW_EDGE_TYPES = [
  ...WORKFLOW_FLOW_EDGE_TYPES,
  WORKFLOW_FULFILLED_BY_EDGE_TYPE,
  AgentEdgeType.DependsOn,
] as const;

type WorkflowFlowEdgeType = (typeof WORKFLOW_FLOW_EDGE_TYPES)[number];
type WorkflowFulfilledByEdgeType = typeof WORKFLOW_FULFILLED_BY_EDGE_TYPE;
type WorkflowStepEdgeType = WorkflowFlowEdgeType | WorkflowFulfilledByEdgeType;

export type WorkflowWorkItem = Omit<TaskResponseDto, "sections"> & {
  sections?: MaterializedWorkItemSection[];
};

type RawWorkflowStepEdge = Omit<AgentEdgeResponseDto, "type"> & {
  type: string;
  direction?: string | null;
  predicate?: unknown;
  sourceNodeName?: string | null;
  targetNodeName?: string | null;
  sourceEntityName?: string | null;
  targetEntityName?: string | null;
  sourceTaskName?: string | null;
  targetTaskName?: string | null;
};

export interface NormalizedWorkflowStepEdge {
  id: string;
  type: WorkflowStepEdgeType;
  sourceNodeId: string;
  targetNodeId: string;
  connectedNodeId: string;
  connectedNodeName?: string;
  directionFromStep: "inbound" | "outbound" | "self";
  predicate?: unknown;
  reasoning?: string;
}

export interface WorkflowStepEdgeGroups {
  flowLinks: NormalizedWorkflowStepEdge[];
  fulfillmentLinks: NormalizedWorkflowStepEdge[];
}

const workflowEdgeTypeSet = new Set<string>(WORKFLOW_EDGE_TYPES);
const workflowStepDetailEdgeTypeSet = new Set<string>([
  ...WORKFLOW_FLOW_EDGE_TYPES,
  WORKFLOW_FULFILLED_BY_EDGE_TYPE,
]);
const flowEdgeTypeSet = new Set<string>(WORKFLOW_FLOW_EDGE_TYPES);

export const isWorkflowStepType = (
  task: Pick<WorkflowWorkItem, "type"> | null | undefined,
): boolean =>
  task?.type === WORKFLOW_STEP_TYPE ||
  task?.type === WORK_ITEM_TYPE_KEYS.WorkflowStep;

export const isWorkflowType = (
  task: Pick<WorkflowWorkItem, "type"> | null | undefined,
): boolean =>
  task?.type === WORKFLOW_TYPE || task?.type === WORK_ITEM_TYPE_KEYS.Workflow;

export const isWorkflowTask = (
  task: WorkflowWorkItem | null | undefined,
): task is WorkflowWorkItem & {
  type:
    typeof WORK_ITEM_TYPE_KEYS.Diagram | typeof WORK_ITEM_TYPE_KEYS.Workflow;
} => isWorkflowType(task);

export const isWorkflowStepTask = <T extends Pick<WorkflowWorkItem, "type">>(
  task: T | null | undefined,
): task is T & {
  type:
    | typeof WORK_ITEM_TYPE_KEYS.DiagramElement
    | typeof WORK_ITEM_TYPE_KEYS.WorkflowStep;
} => isWorkflowStepType(task);

export const dedupeWorkflowEdges = (
  edgeLists: Array<AgentEdgeResponseDto[] | undefined>,
): AgentEdgeResponseDto[] => {
  const edgesById = new Map<string, AgentEdgeResponseDto>();

  edgeLists
    .flatMap((edges) => edges ?? [])
    .filter((edge) => workflowEdgeTypeSet.has(String(edge.type)))
    .forEach((edge) => {
      edgesById.set(edge.id, edge);
    });

  return Array.from(edgesById.values());
};

export const buildWorkflowGraphData = (
  workflow: WorkflowWorkItem | null | undefined,
  steps: WorkflowWorkItem[],
): WorkflowGraphSurfaceData | null => {
  if (!isWorkflowTask(workflow)) {
    return null;
  }

  const workflowSteps = steps.filter(isWorkflowStepTask);

  return {
    workflow,
    steps: workflowSteps,
    edges: dedupeWorkflowEdges([
      workflow.edges,
      ...workflowSteps.map((step) => step.edges),
    ]),
    participation: null,
  };
};

export const buildWorkflowGraphDataFromAggregate = (
  aggregate: WorkItemGraphAggregateResponseDto | null | undefined,
  workflowTypeDefinition: WorkItemTypeDefinitionDto | undefined,
): WorkflowGraphSurfaceData | null => {
  if (!aggregate || !isWorkflowTask(aggregate.root)) {
    return null;
  }

  return {
    workflow: aggregate.root,
    steps: aggregate.children.filter(isWorkflowStepTask),
    edges: aggregate.relationships,
    participation: aggregate.participation,
    workflowTypeDefinition,
    layout: aggregate.layout,
  };
};

const taskNameById = (tasks: WorkflowWorkItem[]): Map<string, string> =>
  new Map(tasks.map((task) => [task.id, task.name]));

const connectedNameForEdge = (
  edge: RawWorkflowStepEdge,
  stepId: string,
  namesById: Map<string, string>,
): string | undefined => {
  const isOutbound = edge.sourceNodeId === stepId;
  const explicitName = isOutbound
    ? (edge.targetNodeName ?? edge.targetEntityName ?? edge.targetTaskName)
    : (edge.sourceNodeName ?? edge.sourceEntityName ?? edge.sourceTaskName);

  if (explicitName) {
    return explicitName;
  }

  const connectedNodeId =
    edge.sourceNodeId === stepId ? edge.targetNodeId : edge.sourceNodeId;
  return namesById.get(connectedNodeId);
};

export const normalizeWorkflowStepEdges = (
  stepId: string,
  edges: AgentEdgeResponseDto[] | undefined,
  siblingSteps: WorkflowWorkItem[] = [],
): WorkflowStepEdgeGroups => {
  const namesById = taskNameById(siblingSteps);
  const normalized: NormalizedWorkflowStepEdge[] = (edges ?? [])
    .filter(
      (edge) => edge.sourceNodeId === stepId || edge.targetNodeId === stepId,
    )
    .filter((edge) => workflowStepDetailEdgeTypeSet.has(String(edge.type)))
    .map((edge) => {
      const rawEdge = edge as RawWorkflowStepEdge;
      const connectedNodeId =
        rawEdge.sourceNodeId === stepId
          ? rawEdge.targetNodeId
          : rawEdge.sourceNodeId;
      const directionFromStep =
        rawEdge.sourceNodeId === stepId && rawEdge.targetNodeId === stepId
          ? "self"
          : rawEdge.sourceNodeId === stepId
            ? "outbound"
            : "inbound";

      return {
        id: rawEdge.id,
        type: rawEdge.type as WorkflowStepEdgeType,
        sourceNodeId: rawEdge.sourceNodeId,
        targetNodeId: rawEdge.targetNodeId,
        connectedNodeId,
        connectedNodeName: connectedNameForEdge(rawEdge, stepId, namesById),
        directionFromStep,
        predicate: rawEdge.predicate,
        reasoning: rawEdge.reasoning,
      };
    });

  return {
    flowLinks: normalized.filter((edge) => flowEdgeTypeSet.has(edge.type)),
    fulfillmentLinks: normalized.filter(
      (edge) => edge.type === WORKFLOW_FULFILLED_BY_EDGE_TYPE,
    ),
  };
};
