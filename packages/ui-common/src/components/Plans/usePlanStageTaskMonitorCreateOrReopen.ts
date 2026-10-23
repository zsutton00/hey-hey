import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  type TaskMonitorExecutionDefinition,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import {
  buildPlanStageTaskMonitorCreateDto,
  type PlanStageTaskMonitorSourceContext,
} from "./PlanStageTaskMonitorCreateOrReopen.utils";
import { writeTaskMonitorStartMessage } from "../TaskMonitor/taskMonitorStartMessage";

export type PlanStageTaskMonitorCreateOrReopenState =
  | { status: "blocked"; message: string }
  | { status: "idle" }
  | { status: "creating" }
  | { status: "linking" }
  | { status: "created"; monitorId: string }
  | { status: "error"; message: string };

export interface UsePlanStageTaskMonitorCreateOrReopenOptions
  extends PlanStageTaskMonitorSourceContext {
  definition: TaskMonitorExecutionDefinition | null;
  userMessage?: string;
  enabled?: boolean;
}

export interface UsePlanStageTaskMonitorCreateOrReopenResult {
  state: PlanStageTaskMonitorCreateOrReopenState;
}

const missingContextMessage =
  "Organization, project, plan, Plan feature parent, and stage context are required before a Task Monitor can be opened.";

const hasSourceContext = (
  context: PlanStageTaskMonitorSourceContext
): boolean =>
  [
    context.organizationId,
    context.projectId,
    context.planId,
    context.planParentTaskId,
    context.stageId,
    context.planLabel,
    context.stageLabel,
  ].every((value) => value.trim().length > 0);

const errorMessageFor = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Unable to create or relate the Task Monitor.";

const createRelationship = async ({
  context,
  monitorId,
  targetNodeId,
  targetEntityType,
  reasoning,
}: {
  context: PlanStageTaskMonitorSourceContext;
  monitorId: string;
  targetNodeId: string;
  targetEntityType: AgentEdgeEndpointEntityType;
  reasoning: string;
}): Promise<void> => {
  await unifiedApiClient.createAgentEdge({
    organizationId: context.organizationId,
    projectId: context.projectId,
    request: {
      sourceNodeId: monitorId,
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetNodeId,
      targetEntityType,
      type: AgentEdgeType.RelatedTo,
      reasoning,
      createdBySessionId: context.createdBySessionId ?? null,
    },
  });
};

const linkNewMonitor = async (
  context: PlanStageTaskMonitorSourceContext,
  monitorId: string,
  definition: TaskMonitorExecutionDefinition
): Promise<void> => {
  await Promise.all([
    createRelationship({
      context,
      monitorId,
      targetNodeId: context.stageId,
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      reasoning:
        "The Task Monitor executes the fixed task plan prepared for this Plan Stage.",
    }),
    createRelationship({
      context,
      monitorId,
      targetNodeId: context.planId,
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      reasoning:
        "The Task Monitor remains discoverable from the Plan Automation tab.",
    }),
    ...definition.executionPlan.map((entry) =>
      createRelationship({
        context,
        monitorId,
        targetNodeId: entry.taskId,
        targetEntityType: AgentEdgeEndpointEntityType.Task,
        reasoning:
          "The Task Monitor selected-work plan contains this Task and must remain discoverable from its context.",
      })
    ),
  ]);
};

export const usePlanStageTaskMonitorCreateOrReopen = ({
  organizationId,
  projectId,
  planId,
  planParentTaskId,
  stageId,
  planLabel,
  stageLabel,
  createdBySessionId,
  definition,
  userMessage = "",
  enabled = true,
}: UsePlanStageTaskMonitorCreateOrReopenOptions): UsePlanStageTaskMonitorCreateOrReopenResult => {
  const sourceContext = useMemo(
    () => ({
      organizationId,
      projectId,
      planId,
      planParentTaskId,
      stageId,
      planLabel,
      stageLabel,
      createdBySessionId,
    }),
    [
      createdBySessionId,
      organizationId,
      planId,
      planParentTaskId,
      planLabel,
      projectId,
      stageId,
      stageLabel,
    ]
  );
  const hasContext = hasSourceContext(sourceContext);
  const { createTask } = useWorkItems(
    sourceContext.organizationId,
    "task",
    sourceContext.projectId,
    undefined,
    {
      enabled: false,
    }
  );
  const [state, setState] = useState<PlanStageTaskMonitorCreateOrReopenState>(
    hasContext
      ? { status: "idle" }
      : { status: "blocked", message: missingContextMessage }
  );
  const processedOperation = useRef<string | null>(null);
  const operationKey = useMemo(
    () =>
      definition
        ? JSON.stringify({
            organizationId: sourceContext.organizationId,
            projectId: sourceContext.projectId,
            planId: sourceContext.planId,
            planParentTaskId: sourceContext.planParentTaskId,
            stageId: sourceContext.stageId,
            definition,
            userMessage,
          })
        : null,
    [definition, sourceContext, userMessage]
  );

  const createMonitor = useCallback(() => {
    if (!definition) return;

    setState({ status: "creating" });
    void createTask(
      buildPlanStageTaskMonitorCreateDto(sourceContext, definition)
    )
      .then(async (monitor) => {
        setState({ status: "linking" });
        await linkNewMonitor(sourceContext, monitor.id, definition);
        writeTaskMonitorStartMessage(
          sourceContext.organizationId,
          sourceContext.projectId,
          monitor.id,
          userMessage
        );
        setState({ status: "created", monitorId: monitor.id });
      })
      .catch((creationError: unknown) => {
        setState({ status: "error", message: errorMessageFor(creationError) });
      });
  }, [createTask, definition, sourceContext, userMessage]);

  useEffect(() => {
    if (!hasContext) {
      setState({ status: "blocked", message: missingContextMessage });
      return;
    }
    if (!enabled || !definition || !operationKey) {
      setState({ status: "idle" });
      return;
    }
    if (processedOperation.current === operationKey) return;

    processedOperation.current = operationKey;
    createMonitor();
  }, [definition, enabled, hasContext, operationKey, createMonitor]);

  return { state };
};
