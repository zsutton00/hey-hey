/**
 * Workflow Data Hooks
 *
 * React Query hooks for workflow management operations
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workflowService } from "../services/workflowService";
import type {
  WorkflowTemplateId,
  WorkflowTemplateSummary,
  WorkflowTemplate,
  WorkflowTemplateStructure,
  WorkflowMetrics,
  WorkflowAnalytics,
  WorkflowValidationResult,
  WorkflowSimulationRequest,
  WorkflowSimulationResult,
  WorkflowExecution,
  WorkflowTemplateQuery,
  WorkflowNodeId,
  WorkflowNodeDetailResponse,
  WorkflowNodeTestRequest,
  WorkflowNodeTestResponse,
  // Admin UI types
  WorkflowHealthMetrics,
  WorkflowAlert,
  WorkflowMonitoringResponse,
  ContextVersion,
  ContextVersionResponse,
  ContextRollbackRequest,
  CoordinationEvent,
  AgentCoordinationResponse,
} from "../types/workflow";

/**
 * Query key factory for workflow operations
 */
export const workflowKeys = {
  all: ["workflow"] as const,
  templates: () => [...workflowKeys.all, "templates"] as const,
  template: (id: WorkflowTemplateId) =>
    [...workflowKeys.templates(), id] as const,
  templateList: (query?: WorkflowTemplateQuery) =>
    [...workflowKeys.templates(), "list", { query }] as const,
  templateStructure: (id: WorkflowTemplateId) =>
    [...workflowKeys.template(id), "structure"] as const,
  templateMetrics: (id: WorkflowTemplateId) =>
    [...workflowKeys.template(id), "metrics"] as const,
  analytics: () => [...workflowKeys.all, "analytics"] as const,
  executions: (templateId?: WorkflowTemplateId) =>
    templateId
      ? ([...workflowKeys.template(templateId), "executions"] as const)
      : ([...workflowKeys.all, "executions"] as const),
  validation: (id: WorkflowTemplateId) =>
    [...workflowKeys.template(id), "validation"] as const,
  simulation: (id: WorkflowTemplateId) =>
    [...workflowKeys.template(id), "simulation"] as const,
  // New keys for enhanced functionality
  nodeDetail: (templateId: WorkflowTemplateId, nodeId: WorkflowNodeId) =>
    [...workflowKeys.template(templateId), "nodes", nodeId] as const,
  nodeTest: (templateId: WorkflowTemplateId, nodeId: WorkflowNodeId) =>
    [...workflowKeys.nodeDetail(templateId, nodeId), "test"] as const,
  // Admin UI keys
  monitoring: (workflowId: string) =>
    [...workflowKeys.all, "monitoring", workflowId] as const,
  health: (workflowId: string) =>
    [...workflowKeys.all, "health", workflowId] as const,
  alerts: (workflowId: string) =>
    [...workflowKeys.all, "alerts", workflowId] as const,
  contextVersions: (workflowId: string) =>
    [...workflowKeys.all, "context", "versions", workflowId] as const,
  agentCoordination: (workflowId: string) =>
    [...workflowKeys.all, "agents", "coordination", workflowId] as const,
  coordinationEvents: (workflowId: string) =>
    [...workflowKeys.all, "agents", "events", workflowId] as const,
};

/**
 * Hook to fetch workflow templates list
 */
export function useWorkflowTemplates(query?: WorkflowTemplateQuery) {
  return useQuery<WorkflowTemplateSummary[], Error>({
    queryKey: workflowKeys.templateList(query),
    queryFn: () => workflowService.getWorkflowTemplates(query),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}

/**
 * Hook to fetch a specific workflow template
 */
export function useWorkflowTemplate(
  templateId: WorkflowTemplateId | undefined
) {
  return useQuery<WorkflowTemplate | null, Error>({
    queryKey: templateId
      ? workflowKeys.template(templateId)
      : ["workflow", "template", "none"],
    queryFn: () =>
      templateId
        ? workflowService.getWorkflowTemplate(templateId)
        : Promise.resolve(null),
    enabled: !!templateId,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
    retry: 3,
  });
}

/**
 * Hook to fetch workflow template structure for visualization
 */
export function useWorkflowTemplateStructure(
  templateId: WorkflowTemplateId | undefined
) {
  return useQuery<WorkflowTemplateStructure | null, Error>({
    queryKey: templateId
      ? workflowKeys.templateStructure(templateId)
      : ["workflow", "structure", "none"],
    queryFn: () =>
      templateId
        ? workflowService.getWorkflowTemplateStructure(templateId)
        : Promise.resolve(null),
    enabled: !!templateId,
    staleTime: 15 * 60 * 1000, // 15 minutes (structure doesn't change often)
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 3,
  });
}

/**
 * Hook to fetch workflow template metrics
 */
export function useWorkflowTemplateMetrics(
  templateId: WorkflowTemplateId | undefined
) {
  return useQuery<WorkflowMetrics | null, Error>({
    queryKey: templateId
      ? workflowKeys.templateMetrics(templateId)
      : ["workflow", "metrics", "none"],
    queryFn: () =>
      templateId
        ? workflowService.getWorkflowTemplateMetrics(templateId)
        : Promise.resolve(null),
    enabled: !!templateId,
    staleTime: 2 * 60 * 1000, // 2 minutes (metrics change more frequently)
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

/**
 * Hook to fetch workflow metrics with optional time period
 */
export function useWorkflowMetrics(
  templateId: WorkflowTemplateId | undefined,
  timePeriod?: string
) {
  return useQuery<WorkflowMetrics | null, Error>({
    queryKey: templateId
      ? [...workflowKeys.templateMetrics(templateId), { timePeriod }]
      : ["workflow", "metrics", "none"],
    queryFn: () =>
      templateId
        ? workflowService.getWorkflowTemplateMetrics(templateId)
        : Promise.resolve(null),
    enabled: !!templateId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
  });
}

/**
 * Hook to fetch workflow analytics with optional time period
 */
export function useWorkflowAnalytics(
  templateId?: WorkflowTemplateId,
  timePeriod?: string
) {
  return useQuery<WorkflowAnalytics | null, Error>({
    queryKey: templateId
      ? [...workflowKeys.template(templateId), "analytics", { timePeriod }]
      : [...workflowKeys.analytics(), { timePeriod }],
    queryFn: () => workflowService.getWorkflowAnalytics(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 3,
  });
}

/**
 * Hook to fetch workflow executions with query parameters
 */
export function useWorkflowExecutions(query?: {
  templateId?: WorkflowTemplateId;
  status?: string;
  searchTerm?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery<WorkflowExecution[], Error>({
    queryKey: [...workflowKeys.executions(query?.templateId), { query }],
    queryFn: () => workflowService.getWorkflowExecutions(query?.templateId),
    staleTime: 1 * 60 * 1000, // 1 minute (executions change frequently)
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
  });
}

/**
 * Hook to validate a workflow template
 */
export function useValidateWorkflowTemplate() {
  const queryClient = useQueryClient();

  return useMutation<WorkflowValidationResult, Error, WorkflowTemplateId>({
    mutationFn: (templateId) =>
      workflowService.validateWorkflowTemplate(templateId),
    onSuccess: (data, templateId) => {
      // Cache the validation result
      queryClient.setQueryData(workflowKeys.validation(templateId), data);
    },
    onError: (error) => {
      console.error("Workflow validation failed:", error);
    },
  });
}

/**
 * Hook to simulate a workflow
 */
export function useSimulateWorkflow() {
  const queryClient = useQueryClient();

  return useMutation<
    WorkflowSimulationResult,
    Error,
    WorkflowSimulationRequest
  >({
    mutationFn: (request) => workflowService.simulateWorkflow(request),
    onSuccess: (data, variables) => {
      // Cache the simulation result
      queryClient.setQueryData(
        workflowKeys.simulation(variables.templateId),
        data
      );
    },
    onError: (error) => {
      console.error("Workflow simulation failed:", error);
    },
  });
}

/**
 * Hook to execute a workflow
 */
export function useExecuteWorkflow() {
  const queryClient = useQueryClient();

  return useMutation<WorkflowExecution, Error, WorkflowSimulationRequest>({
    mutationFn: (request) => workflowService.executeWorkflow(request),
    onSuccess: (_data, variables) => {
      // Invalidate executions queries to refresh the list
      queryClient.invalidateQueries({ queryKey: workflowKeys.executions() });
      queryClient.invalidateQueries({
        queryKey: workflowKeys.executions(variables.templateId),
      });

      // Invalidate metrics to update execution counts
      queryClient.invalidateQueries({
        queryKey: workflowKeys.templateMetrics(variables.templateId),
      });
      queryClient.invalidateQueries({ queryKey: workflowKeys.analytics() });

      // Invalidate the template list to update execution counts
      queryClient.invalidateQueries({ queryKey: workflowKeys.templates() });
    },
    onError: (error) => {
      console.error("Workflow execution failed:", error);
    },
  });
}

/**
 * Hook to debug a workflow
 */
export function useDebugWorkflow() {
  return useMutation<
    WorkflowSimulationResult,
    Error,
    WorkflowSimulationRequest
  >({
    mutationFn: (request) => workflowService.debugWorkflow(request),
    onError: (error) => {
      console.error("Workflow debugging failed:", error);
    },
  });
}

/**
 * Hook to prefetch workflow data
 */
export function usePrefetchWorkflow() {
  const queryClient = useQueryClient();

  const prefetchTemplate = (templateId: WorkflowTemplateId) => {
    queryClient.prefetchQuery({
      queryKey: workflowKeys.template(templateId),
      queryFn: () => workflowService.getWorkflowTemplate(templateId),
      staleTime: 10 * 60 * 1000,
    });
  };

  const prefetchTemplateStructure = (templateId: WorkflowTemplateId) => {
    queryClient.prefetchQuery({
      queryKey: workflowKeys.templateStructure(templateId),
      queryFn: () => workflowService.getWorkflowTemplateStructure(templateId),
      staleTime: 15 * 60 * 1000,
    });
  };

  const prefetchTemplateMetrics = (templateId: WorkflowTemplateId) => {
    queryClient.prefetchQuery({
      queryKey: workflowKeys.templateMetrics(templateId),
      queryFn: () => workflowService.getWorkflowTemplateMetrics(templateId),
      staleTime: 2 * 60 * 1000,
    });
  };

  const prefetchAll = (templateId: WorkflowTemplateId) => {
    prefetchTemplate(templateId);
    prefetchTemplateStructure(templateId);
    prefetchTemplateMetrics(templateId);
  };

  return {
    prefetchTemplate,
    prefetchTemplateStructure,
    prefetchTemplateMetrics,
    prefetchAll,
  };
}

/**
 * Hook to manage workflow cache
 */
export function useWorkflowCache() {
  const queryClient = useQueryClient();

  const invalidateTemplates = () => {
    queryClient.invalidateQueries({ queryKey: workflowKeys.templates() });
  };

  const invalidateTemplate = (templateId: WorkflowTemplateId) => {
    queryClient.invalidateQueries({
      queryKey: workflowKeys.template(templateId),
    });
  };

  const invalidateMetrics = (templateId?: WorkflowTemplateId) => {
    if (templateId) {
      queryClient.invalidateQueries({
        queryKey: workflowKeys.templateMetrics(templateId),
      });
    }
    queryClient.invalidateQueries({ queryKey: workflowKeys.analytics() });
  };

  const invalidateExecutions = (templateId?: WorkflowTemplateId) => {
    queryClient.invalidateQueries({
      queryKey: workflowKeys.executions(templateId),
    });
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: workflowKeys.all });
  };

  const clearWorkflowCache = () => {
    queryClient.removeQueries({ queryKey: workflowKeys.all });
  };

  return {
    invalidateTemplates,
    invalidateTemplate,
    invalidateMetrics,
    invalidateExecutions,
    invalidateAll,
    clearWorkflowCache,
  };
}

/**
 * Hook to fetch detailed node information
 */
export function useWorkflowNodeDetail(
  templateId: WorkflowTemplateId,
  nodeId: WorkflowNodeId,
  enabled = true
) {
  return useQuery<WorkflowNodeDetailResponse, Error>({
    queryKey: workflowKeys.nodeDetail(templateId, nodeId),
    queryFn: () => workflowService.getWorkflowNodeDetail(templateId, nodeId),
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
  });
}

/**
 * Hook to test a workflow node
 */
export function useTestWorkflowNode() {
  const queryClient = useQueryClient();

  return useMutation<
    WorkflowNodeTestResponse,
    Error,
    {
      templateId: WorkflowTemplateId;
      nodeId: WorkflowNodeId;
      testRequest: WorkflowNodeTestRequest;
    }
  >({
    mutationFn: ({ templateId, nodeId, testRequest }) =>
      workflowService.testWorkflowNode(templateId, nodeId, testRequest),
    onSuccess: (data, variables) => {
      // Cache the test result
      queryClient.setQueryData(
        workflowKeys.nodeTest(variables.templateId, variables.nodeId),
        data
      );
    },
    onError: (error) => {
      console.error("Node test failed:", error);
    },
  });
}

// Admin UI Hooks

/**
 * Hook to fetch workflow monitoring data with real-time polling
 */
export function useWorkflowMonitoring(workflowId: string) {
  return useQuery<WorkflowMonitoringResponse, Error>({
    queryKey: workflowKeys.monitoring(workflowId),
    queryFn: () => workflowService.getWorkflowMonitoring(workflowId),
    enabled: !!workflowId,
    staleTime: 1000, // 1 second - real-time data
    gcTime: 2 * 60 * 1000, // 2 minutes
    retry: 2,
    refetchInterval: 2000, // Poll every 2 seconds
    refetchIntervalInBackground: true,
  });
}

/**
 * Hook to fetch workflow health metrics
 */
export function useWorkflowHealth(workflowId: string) {
  return useQuery<WorkflowHealthMetrics, Error>({
    queryKey: workflowKeys.health(workflowId),
    queryFn: () => workflowService.getWorkflowHealth(workflowId),
    enabled: !!workflowId,
    staleTime: 5000, // 5 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    refetchInterval: 5000, // Poll every 5 seconds
  });
}

/**
 * Hook to fetch workflow alerts
 */
export function useWorkflowAlerts(workflowId: string) {
  return useQuery<WorkflowAlert[], Error>({
    queryKey: workflowKeys.alerts(workflowId),
    queryFn: () => workflowService.getWorkflowAlerts(workflowId),
    enabled: !!workflowId,
    staleTime: 3000, // 3 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    refetchInterval: 3000, // Poll every 3 seconds
  });
}

/**
 * Hook to fetch context versions for a workflow
 */
export function useContextVersions(workflowId: string) {
  return useQuery<ContextVersionResponse, Error>({
    queryKey: workflowKeys.contextVersions(workflowId),
    queryFn: () => workflowService.getContextVersions(workflowId),
    enabled: !!workflowId,
    staleTime: 10 * 1000, // 10 seconds
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 3,
  });
}

/**
 * Hook to create context snapshots
 */
export function useCreateContextSnapshot() {
  const queryClient = useQueryClient();

  return useMutation<
    ContextVersion,
    Error,
    {
      workflowId: string;
      metadata: {
        reason: string;
        createdBy: string;
        tags: string[];
      };
    }
  >({
    mutationFn: ({ workflowId, metadata }) =>
      workflowService.createContextSnapshot(workflowId, metadata),
    onSuccess: (_data, variables) => {
      // Invalidate context versions to refresh the list
      queryClient.invalidateQueries({
        queryKey: workflowKeys.contextVersions(variables.workflowId),
      });
    },
    onError: (error) => {
      console.error("Failed to create context snapshot:", error);
    },
  });
}

/**
 * Hook to rollback to a context version
 */
export function useRollbackContextVersion() {
  const queryClient = useQueryClient();

  return useMutation<
    ContextVersion,
    Error,
    {
      workflowId: string;
      rollbackRequest: ContextRollbackRequest;
    }
  >({
    mutationFn: ({ workflowId, rollbackRequest }) =>
      workflowService.rollbackToContextVersion(workflowId, rollbackRequest),
    onSuccess: (_data, variables) => {
      // Invalidate context versions and monitoring data
      queryClient.invalidateQueries({
        queryKey: workflowKeys.contextVersions(variables.workflowId),
      });
      queryClient.invalidateQueries({
        queryKey: workflowKeys.monitoring(variables.workflowId),
      });
    },
    onError: (error) => {
      console.error("Failed to rollback context version:", error);
    },
  });
}

/**
 * Hook to fetch agent coordination data
 */
export function useAgentCoordination(workflowId: string) {
  return useQuery<AgentCoordinationResponse, Error>({
    queryKey: workflowKeys.agentCoordination(workflowId),
    queryFn: () => workflowService.getAgentCoordination(workflowId),
    enabled: !!workflowId,
    staleTime: 2000, // 2 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    refetchInterval: 2500, // Poll every 2.5 seconds
  });
}

/**
 * Hook to fetch coordination events
 */
export function useCoordinationEvents(workflowId: string) {
  return useQuery<CoordinationEvent[], Error>({
    queryKey: workflowKeys.coordinationEvents(workflowId),
    queryFn: () => workflowService.getCoordinationEvents(workflowId),
    enabled: !!workflowId,
    staleTime: 1500, // 1.5 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    refetchInterval: 2000, // Poll every 2 seconds
    refetchIntervalInBackground: true,
  });
}
