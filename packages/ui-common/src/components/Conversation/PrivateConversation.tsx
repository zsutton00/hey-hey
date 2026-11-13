import { Alert, Stack, Typography } from "@mui/material";
import type { ConversationResponseDto } from "../../api";
import { useAgentSessions } from "../../data/hooks/useAgentSessions";
import { useReports } from "../../data/hooks/useReports";
import { ReportViewer } from "../Reports/ReportViewer";
import { DataStateBoundary } from "../shared/DataStateBoundary";

/** A denied Message read leaves metadata and independently readable reports available. */
export function PrivateConversation({
  conversation,
  agentSessionId,
}: {
  conversation: ConversationResponseDto;
  agentSessionId: string | undefined;
}) {
  const sessions = useAgentSessions(
    conversation.organizationId,
    conversation.projectId,
    {
      conversationId: conversation.id,
      enabled: !agentSessionId,
    },
  );
  const sessionId = agentSessionId ?? sessions.agentSessions[0]?.id;
  const reports = useReports(conversation.organizationId, {
    projectId: conversation.projectId,
    entityType: "AGENT_SESSION",
    entityId: sessionId,
    enabled: !!sessionId,
  });
  const error = (!agentSessionId && sessions.error) || reports.error;
  const pending =
    (!agentSessionId && !sessions.isFetched) ||
    (!!sessionId && !reports.isFetched);

  return (
    <Stack
      spacing={2}
      data-testid="private-conversation"
      data-restricted={conversation.restricted}
    >
      <Alert severity="info">
        This conversation is private. Its transcript is only available to its
        creator. You can still view its details and reports.
      </Alert>
      {conversation.title && (
        <Typography variant="h6">{conversation.title}</Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        Created {new Date(conversation.createdAt).toLocaleString()}
      </Typography>
      {error ? (
        <Alert severity="error">
          Unable to load conversation reports: {error.message}
        </Alert>
      ) : (
        <DataStateBoundary loading={pending} fetched={!pending}>
          {reports.reports.length ? (
            reports.reports.map((report) => (
              <ReportViewer key={report.id} report={report} />
            ))
          ) : (
            <Typography color="text.secondary">
              No reports available.
            </Typography>
          )}
        </DataStateBoundary>
      )}
    </Stack>
  );
}
