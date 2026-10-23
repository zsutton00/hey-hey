import type { ReactNode } from "react";
import type { AgentProvider } from "../AgentSessions/types.js";
import { TrackingProvider } from "../../contexts/TrackingContext.js";
import type { NavigationLineage } from "../../types/userTracking.js";

export interface AgentBridgeTrackingProviderProps {
  children: ReactNode;
  agentSessionId: string;
  /**
   * Canonical route lineage. Omit only for observational compositions such as
   * Preview; pass null for a canonical session route with no parent lineage.
   */
  lineage?: NavigationLineage | null;
  taskId?: string;
  pagePath: string;
  pageSection?: string;
  agentSessionName?: string;
  taskName?: string;
  taskStatus?: string;
  taskPriority?: string;
  projectId?: string;
  projectName?: string;
  serviceId?: string;
  provider?: AgentProvider;
  enabled?: boolean;
}

export const AgentBridgeTrackingProvider = ({
  children,
  agentSessionId,
  lineage,
  taskId,
  pagePath,
  pageSection,
  agentSessionName,
  taskName,
  taskStatus,
  taskPriority,
  projectId,
  projectName,
  serviceId,
  provider,
  enabled = true,
}: AgentBridgeTrackingProviderProps) => (
  <TrackingProvider
    enabled={enabled}
    context={{
      page: {
        name: "agent-bridge",
        path: pagePath,
        ...(pageSection ? { section: pageSection } : {}),
      },
      ...(lineage !== undefined
        ? {
            attentionEntity: {
              type: "agent_session" as const,
              id: agentSessionId,
              lineage,
            },
          }
        : {}),
      ...(taskId
        ? {
            task: {
              id: taskId,
              name: taskName?.trim().length ? taskName : taskId,
              status: taskStatus?.trim().length ? taskStatus : "unknown",
              priority: taskPriority?.trim().length ? taskPriority : "unknown",
            },
          }
        : {}),
      agentSession: {
        id: agentSessionId,
        name: agentSessionName?.trim().length
          ? agentSessionName
          : `agent-session-${agentSessionId}`,
        ...(projectId ? { projectId } : {}),
      },
      ...(projectId
        ? {
            project: {
              id: projectId,
              name: projectName?.trim().length ? projectName : projectId,
            },
          }
        : {}),
      component: {
        name: "AgentBridge",
        props: {
          ...(serviceId ? { serviceId } : {}),
          ...(provider ? { provider } : {}),
        },
      },
    }}
  >
    {children}
  </TrackingProvider>
);
