import { useState, useEffect, useCallback, useRef } from "react";
import { unifiedApiClient } from "../clients/serviceClients";

interface WorkflowLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  source?: string;
  data?: Record<string, unknown>;
}

interface WorkflowStatusData {
  workflowId: string;
  status: "running" | "completed" | "failed" | "pending" | "paused";
  currentStep?: string;
  progress?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  logs?: WorkflowLogEntry[];
  stepDetails?: {
    step: string;
    phase: string;
    currentNodeId: string;
    pathTaken: string[];
    isComplete: boolean;
    iterations: number;
    hasOpener: boolean;
    lastActivity: string;
  };
}

interface UseWorkflowStatusMonitoringOptions {
  /** Workflow ID to monitor */
  workflowId?: string;
  /** Polling interval in milliseconds (default: 1000) */
  pollingInterval?: number;
  /** Whether to enable polling (default: true) */
  enabled?: boolean;
  /** Whether to include logs in the response (default: false) */
  includeLogs?: boolean;
}

interface UseWorkflowStatusMonitoringReturn {
  /** Current workflow status */
  status: WorkflowStatusData | null;
  /** Whether a request is in progress */
  isLoading: boolean;
  /** Last error that occurred */
  error: string | null;
  /** Last update timestamp */
  lastUpdate: Date | null;
  /** Manually refresh the status */
  refresh: () => Promise<void>;
  /** Fetch logs for the workflow */
  fetchLogs: () => Promise<WorkflowLogEntry[]>;
  /** Start polling */
  startPolling: () => void;
  /** Stop polling */
  stopPolling: () => void;
  /** Whether polling is active */
  isPolling: boolean;
}

/**
 * Hook to monitor workflow status with automatic polling
 */
export function useWorkflowStatusMonitoring({
  workflowId,
  pollingInterval = 1000,
  enabled = true,
  includeLogs = false,
}: UseWorkflowStatusMonitoringOptions): UseWorkflowStatusMonitoringReturn {
  const [status, setStatus] = useState<WorkflowStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // Helper function to map API status to our normalized status
  const mapApiStatusToNormalized = (
    apiStatusName: string
  ): WorkflowStatusData["status"] => {
    const status = apiStatusName.toLowerCase();
    switch (status) {
      case "running":
      case "open":
        return "running";
      case "completed":
      case "closed":
        return "completed";
      case "failed":
      case "error":
        return "failed";
      case "pending":
      case "waiting":
        return "pending";
      case "paused":
      case "suspended":
        return "paused";
      default:
        return "pending";
    }
  };

  // Real API call to get workflow status
  const fetchWorkflowStatus = useCallback(
    async (withLogs = false): Promise<WorkflowStatusData | null> => {
      if (!workflowId) {
        return null;
      }

      try {
        const response = withLogs
          ? await unifiedApiClient.getWorkflowStatusDebugWithLogs(
              workflowId,
              true
            )
          : await unifiedApiClient.getWorkflowStatusDebug({
              workflowId: workflowId,
            });

        const apiData = response.data.data;

        if (!apiData) {
          throw new Error("No workflow status data received");
        }

        const apiDataRecord = apiData as unknown as Record<string, unknown>;

        // Extract currentStep data
        const currentStepData =
          apiDataRecord.currentStep &&
          typeof apiDataRecord.currentStep === "object"
            ? (apiDataRecord.currentStep as Record<string, unknown>)
            : undefined;

        // Extract logs data
        const logsData = apiDataRecord.logs;
        const mappedLogs: WorkflowLogEntry[] | undefined = Array.isArray(
          logsData
        )
          ? logsData.map((log: unknown) => {
              const logObj = log as Record<string, unknown>;
              return {
                timestamp: String(logObj.timestamp || ""),
                level: (logObj.level as WorkflowLogEntry["level"]) || "info",
                message: String(logObj.message || ""),
                source: logObj.source ? String(logObj.source) : undefined,
                data: logObj.data as Record<string, unknown> | undefined,
              };
            })
          : undefined;

        type ApiStatusInfo =
          | string
          | {
              name?: unknown;
              startTime?: unknown;
              closeTime?: unknown;
              runId?: unknown;
              executionTime?: unknown;
            };

        const statusInfo = apiDataRecord.status as ApiStatusInfo;
        const isStatusObject = (
          value: ApiStatusInfo
        ): value is Exclude<ApiStatusInfo, string> =>
          typeof value === "object" && value !== null;

        const statusName =
          typeof statusInfo === "string"
            ? statusInfo
            : isStatusObject(statusInfo) && typeof statusInfo.name === "string"
            ? statusInfo.name
            : "pending";

        const statusStartTime =
          isStatusObject(statusInfo) && typeof statusInfo.startTime === "string"
            ? statusInfo.startTime
            : undefined;

        const statusCloseTime =
          isStatusObject(statusInfo) && typeof statusInfo.closeTime === "string"
            ? statusInfo.closeTime
            : undefined;

        const statusRunId =
          isStatusObject(statusInfo) && typeof statusInfo.runId === "string"
            ? statusInfo.runId
            : undefined;

        const statusExecutionTime =
          isStatusObject(statusInfo) &&
          typeof statusInfo.executionTime === "string"
            ? statusInfo.executionTime
            : undefined;

        const workflowNameValue =
          typeof apiDataRecord.workflowName === "string"
            ? apiDataRecord.workflowName
            : undefined;
        const taskQueueValue =
          typeof apiDataRecord.taskQueue === "string"
            ? apiDataRecord.taskQueue
            : undefined;
        const errorValue =
          typeof apiDataRecord.error === "string"
            ? apiDataRecord.error
            : undefined;
        const debugInfoValue =
          apiDataRecord.debugInfo && typeof apiDataRecord.debugInfo === "object"
            ? (apiDataRecord.debugInfo as Record<string, unknown>)
            : undefined;

        const conversation =
          apiDataRecord.conversation &&
          typeof apiDataRecord.conversation === "object"
            ? (apiDataRecord.conversation as Record<string, unknown>)
            : undefined;

        const conversationId =
          conversation && typeof conversation["id"] === "string"
            ? (conversation["id"] as string)
            : undefined;
        const conversationProjectId =
          conversation && typeof conversation["projectId"] === "string"
            ? (conversation["projectId"] as string)
            : undefined;

        // Map API response to our interface
        const mappedStatus: WorkflowStatusData = {
          workflowId:
            typeof apiDataRecord.workflowId === "string"
              ? apiDataRecord.workflowId
              : workflowId,
          status: mapApiStatusToNormalized(statusName),
          currentStep: workflowNameValue,
          startedAt: statusStartTime,
          completedAt: statusCloseTime,
          error: errorValue,
          logs: mappedLogs,
          stepDetails: currentStepData
            ? {
                step: String(currentStepData.step || ""),
                phase: String(currentStepData.phase || ""),
                currentNodeId: String(currentStepData.currentNodeId || ""),
                pathTaken: Array.isArray(currentStepData.pathTaken)
                  ? (currentStepData.pathTaken as string[])
                  : [],
                isComplete: Boolean(currentStepData.isComplete),
                iterations: Number(currentStepData.iterations) || 0,
                hasOpener: Boolean(currentStepData.hasOpener),
                lastActivity: String(currentStepData.lastActivity || ""),
              }
            : undefined,
          metadata: {
            runId: statusRunId,
            taskQueue: taskQueueValue,
            workflowName: workflowNameValue,
            executionTime: statusExecutionTime,
            conversationId,
            projectId: conversationProjectId,
            debugInfo: debugInfoValue,
          },
        };

        // Don't calculate fake progress - we'll show real workflow data instead

        return mappedStatus;
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Failed to fetch workflow status"
        );
      }
    },
    [workflowId]
  );

  // Separate function to fetch logs only
  const fetchLogs = useCallback(async (): Promise<WorkflowLogEntry[]> => {
    if (!workflowId) {
      return [];
    }

    try {
      const statusWithLogs = await fetchWorkflowStatus(true);
      return statusWithLogs?.logs || [];
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Failed to fetch workflow logs"
      );
    }
  }, [fetchWorkflowStatus, workflowId]);

  const refresh = useCallback(async () => {
    if (!workflowId || !enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const newStatus = await fetchWorkflowStatus(includeLogs);
      if (mountedRef.current) {
        setStatus(newStatus);
        setLastUpdate(new Date());
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [fetchWorkflowStatus, workflowId, enabled, includeLogs]);

  const startPolling = useCallback(() => {
    if (intervalRef.current || !enabled) return;

    setIsPolling(true);

    // Initial fetch
    refresh();

    // Set up polling
    intervalRef.current = setInterval(() => {
      refresh();
    }, pollingInterval);
  }, [refresh, pollingInterval, enabled]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  // Auto-start polling when conditions are met
  useEffect(() => {
    if (enabled && workflowId) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [enabled, workflowId, startPolling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  return {
    status,
    isLoading,
    error,
    lastUpdate,
    refresh,
    fetchLogs,
    startPolling,
    stopPolling,
    isPolling,
  };
}
