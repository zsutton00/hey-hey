import {
  Alert,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useRef, useState } from "react";
import type { CodingPlanDiscrepancy } from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import type { FieldComponentProps } from "./types";
import { StartupSourceReferenceInline } from "./StartupPlanStructuredField";
import { useCodingPlanConversation } from "./useCodingPlanConversation";

export function CodingPlanDiscrepancyField({
  config,
  context,
  disabled,
}: FieldComponentProps) {
  const issue = config.payload as CodingPlanDiscrepancy;
  const conversation = useCodingPlanConversation(context);
  const [reply, setReply] = useState("");
  const inFlight = useRef(false);
  const send = async () => {
    if (inFlight.current || !reply.trim()) return;
    inFlight.current = true;
    try {
      if (await conversation.submit({ reply: reply.trim() })) setReply("");
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <Stack spacing={1}>
      <Chip size="small" label={issue.severity} />
      <Typography>{renderInlineMentions(issue.discrepancyText)}</Typography>
      <Typography variant="body2">{issue.sourceExcerpt}</Typography>
      <StartupSourceReferenceInline
        sourceRef={issue.sourceRef}
        organizationId={context.organizationId}
        projectId={context.projectId}
      />
      <Typography variant="caption">
        Source field: {issue.sourceField}
      </Typography>
      <Typography variant="body2">{issue.reasoning}</Typography>
      <TextField
        label="Reply to this issue"
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        disabled={disabled || conversation.sending}
        multiline
      />
      <Button
        onClick={() => void send()}
        disabled={disabled || conversation.sending || !reply.trim()}
      >
        Reply
      </Button>
      {conversation.error && (
        <Alert severity="error">{conversation.error}</Alert>
      )}
    </Stack>
  );
}
