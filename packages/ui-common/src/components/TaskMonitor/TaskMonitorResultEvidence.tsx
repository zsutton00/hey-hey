import { Alert, Link, Stack, Typography } from "@mui/material";
import { useReports } from "../../data/hooks/useReports";
import { usePathService } from "../../contexts";
import { formatStatus, getStatusLabel } from "../../utils/statusUtils";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

const LINKED_SESSION_TEXT = {
  none: "No linked session",
  loading: "Loading linked session…",
  failed: "Linked session could not be read",
  missing: "Linked session unavailable",
} as const;

export function TaskMonitorResultEvidence({
  organizationId,
  projectId,
  node,
}: {
  organizationId: string;
  projectId: string;
  node: TaskMonitorProjectedNode;
}) {
  const session = node.session.kind === "loaded" ? node.session.session : null;
  const reports = useReports(organizationId, {
    projectId,
    entityType: "AGENT_SESSION",
    entityId: session?.id,
    enabled: Boolean(session),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
  const paths = usePathService();
  return (
    <Stack
      spacing={0.5}
      data-testid="task-monitor-result-evidence"
      sx={{ px: 2, pb: 1 }}
    >
      <Typography variant="body2">
        Task:{" "}
        {node.task.kind === "loaded"
          ? getStatusLabel(node.task.task.status)
          : "Unavailable"}
      </Typography>
      {node.session.kind === "loaded" ? (
        <Link
          href={paths.agentSession({
            projectId,
            agentSessionId: node.session.session.id,
          })}
          data-testid="task-monitor-result-session"
        >
          Session · {formatStatus(node.session.session.status)}
        </Link>
      ) : (
        <Typography variant="body2">
          {LINKED_SESSION_TEXT[node.session.kind]}
        </Typography>
      )}
      {reports.error ? (
        <Alert severity="error">Reports could not be loaded.</Alert>
      ) : reports.isLoading ? (
        <Typography variant="body2">Loading reports…</Typography>
      ) : reports.reports.length ? (
        reports.reports.map((report) => (
          <Link
            key={report.id}
            href={paths.report({ projectId, reportId: report.id })}
            data-testid="task-monitor-result-report"
          >
            Report · {report.title}
          </Link>
        ))
      ) : (
        <Typography variant="body2">No report available</Typography>
      )}
    </Stack>
  );
}
