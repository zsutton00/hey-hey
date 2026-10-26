import { Alert, Stack, Typography } from "@mui/material";
import type { AgentSessionDto, ReportDto } from "../../api";
import { ReportType } from "../../api";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { AgentConversationView } from "./AgentConversationView";
import { readableEvalOutput, retainedEvalOutput } from "./retainedEvalOutput";

export function RetainedEvalSession({
  organizationId,
  projectId,
  agentSession,
  attempt,
  scrollable,
}: {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  attempt: ReportDto;
  scrollable: boolean;
}) {
  if (attempt.payload.reportType !== ReportType.EvalAttempt) return null;
  const payload = attempt.payload;
  const output = retainedEvalOutput(payload);
  return (
    <Stack spacing={2} data-testid="retained-eval-session">
      <Alert severity="info">
        Evaluation evidence · Read only. This attempt is executed by the eval
        runner and cannot be started or continued here.
      </Alert>
      <Typography variant="body2">
        Attempt: {payload.status}
        {payload.completedAt
          ? ` · Finished ${new Date(payload.completedAt).toLocaleString()}`
          : ""}
      </Typography>
      {output ? (
        <div data-testid="retained-eval-answer">
          <MarkdownRenderer>{readableEvalOutput(output)}</MarkdownRenderer>
        </div>
      ) : (
        <Typography>No answer has been retained for this attempt.</Typography>
      )}
      {output && (
        <details>
          <summary>Exact saved output</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {output}
          </pre>
        </details>
      )}
      {agentSession.conversationId && (
        <AgentConversationView
          organizationId={organizationId}
          projectId={projectId}
          agentSessionId={agentSession.id}
          conversationId={agentSession.conversationId}
          readOnly
          sessionResumability="legacy_non_resumable"
          scrollable={scrollable}
        />
      )}
    </Stack>
  );
}
