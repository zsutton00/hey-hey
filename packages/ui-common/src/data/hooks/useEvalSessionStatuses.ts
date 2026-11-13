import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOptionalWebSocketContext } from "../../contexts/WebSocketContext";
import { evalSessionStatusesQueryOptions } from "../collections/evalRuns";

/** Transient report-backed status, independent of session activity and stored rows. */
export function useEvalSessionStatuses(
  organizationId: string,
  projectId: string,
  agentSessionIds: readonly string[],
) {
  const websocket = useOptionalWebSocketContext();
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible",
  );
  useEffect(() => {
    const updateVisibility = () =>
      setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
  const enabled =
    visible && Boolean(organizationId && projectId && agentSessionIds.length);
  const query = useQuery({
    ...evalSessionStatusesQueryOptions(
      organizationId,
      projectId,
      agentSessionIds,
    ),
    enabled,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const { refetch } = query;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void refetch();
      }
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    const subscription = websocket?.service.subscribe({
      projectIds: [projectId],
    });
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      if (subscription) {
        websocket?.service.unsubscribe(subscription);
      }
    };
  }, [
    enabled,
    projectId,
    refetch,
    websocket?.service,
    websocket?.isAuthenticated,
  ]);
  return useMemo(
    () =>
      Object.fromEntries(
        (query.data ?? []).map((status) => [status.agentSessionId, status]),
      ),
    [query.data],
  );
}
