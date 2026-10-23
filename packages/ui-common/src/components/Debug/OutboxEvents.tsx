import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ScheduleIcon from "@mui/icons-material/Schedule";
import React from "react";
import {
  DebugOutboxEventDtoStatusEnum,
  type DebugOutboxEventDto,
} from "../../api";
import { useOutboxEvents } from "../../data";

export interface OutboxEventsProps {
  entityId: string;
  entityType: string;
}

const getStatusColor = (
  status: DebugOutboxEventDto["status"]
): "default" | "error" | "info" | "success" | "warning" => {
  switch (status) {
    case DebugOutboxEventDtoStatusEnum.Published:
      return "success";
    case DebugOutboxEventDtoStatusEnum.Failed:
      return "error";
    case DebugOutboxEventDtoStatusEnum.Processing:
      return "info";
    case DebugOutboxEventDtoStatusEnum.Pending:
    case DebugOutboxEventDtoStatusEnum.Scheduled:
      return "warning";
    case DebugOutboxEventDtoStatusEnum.Cancelled:
    default:
      return "default";
  }
};

const formatTimestamp = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString();
};

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Unable to render JSON payload";
  }
};

const EventMetadataRow: React.FC<{
  label: string;
  value: string | number | null | undefined;
}> = ({ label, value }) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return (
    <Stack direction="row" spacing={1}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography sx={{ wordBreak: "break-word" }} variant="body2">
        {String(value)}
      </Typography>
    </Stack>
  );
};

export const OutboxEvents: React.FC<OutboxEventsProps> = ({
  entityId,
  entityType,
}) => {
  const { data, events, error, isLoading } = useOutboxEvents(
    entityType,
    entityId
  );

  if (isLoading) {
    return (
      <Paper
        data-testid="outbox-events-loading"
        sx={{ p: 3, display: "flex", justifyContent: "center" }}
      >
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper data-testid="outbox-events-error" sx={{ p: 2 }}>
        <Alert severity="error">{error.message}</Alert>
      </Paper>
    );
  }

  if (!data || events.length === 0) {
    return (
      <Paper data-testid="outbox-events-empty" sx={{ p: 2.5 }}>
        <Stack spacing={1}>
          <Typography variant="h6">Outbox events</Typography>
          <Typography color="text.secondary" variant="body2">
            No outbox events found for this entity.
          </Typography>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack data-testid="outbox-events" spacing={1.5}>
      <Paper sx={{ p: 2 }}>
        <Stack
          alignItems={{ sm: "center", xs: "flex-start" }}
          data-testid="outbox-events-summary"
          direction={{ sm: "row", xs: "column" }}
          justifyContent="space-between"
          spacing={1}
        >
          <Stack spacing={0.5}>
            <Typography variant="h6">Outbox events</Typography>
            <Typography color="text.secondary" variant="body2">
              {data.entityType} {data.entityId}
            </Typography>
          </Stack>
          <Chip
            color="info"
            icon={<ScheduleIcon />}
            label={`${data.count} event${data.count === 1 ? "" : "s"}`}
            size="small"
            variant="outlined"
          />
        </Stack>
      </Paper>

      {events.map((event) => (
        <Accordion
          data-testid={`outbox-event-${event.id}`}
          disableGutters
          key={event.id}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack spacing={1} sx={{ width: "100%" }}>
              <Stack
                alignItems={{ sm: "center", xs: "flex-start" }}
                direction={{ sm: "row", xs: "column" }}
                justifyContent="space-between"
                spacing={1}
              >
                <Typography
                  sx={{ wordBreak: "break-word" }}
                  variant="subtitle2"
                >
                  {event.eventType}
                </Typography>
                <Chip
                  color={getStatusColor(event.status)}
                  label={event.status}
                  size="small"
                />
              </Stack>
              <Stack
                alignItems={{ sm: "center", xs: "flex-start" }}
                direction={{ sm: "row", xs: "column" }}
                spacing={1}
              >
                <Typography color="text.secondary" variant="caption">
                  Sequence {event.sequenceNumber}
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  Created {formatTimestamp(event.createdAt)}
                </Typography>
                {event.lastError ? (
                  <Chip
                    color="error"
                    icon={<ErrorOutlineIcon />}
                    label="Last attempt failed"
                    size="small"
                    variant="outlined"
                  />
                ) : null}
              </Stack>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Stack divider={<Divider flexItem />} spacing={2}>
              <Stack spacing={0.75}>
                <EventMetadataRow label="Event ID" value={event.id} />
                <EventMetadataRow
                  label="Correlation ID"
                  value={event.correlationId}
                />
                <EventMetadataRow
                  label="Causation ID"
                  value={event.causationId}
                />
                <EventMetadataRow label="Saga ID" value={event.sagaId} />
                <EventMetadataRow
                  label="Aggregate"
                  value={`${event.aggregateType}:${event.aggregateId}`}
                />
                <EventMetadataRow label="Version" value={event.eventVersion} />
                <EventMetadataRow
                  label="Retry count"
                  value={`${event.retryCount}/${event.maxRetries}`}
                />
                <EventMetadataRow
                  label="Error count"
                  value={event.errorCount}
                />
                <EventMetadataRow
                  label="Created at"
                  value={formatTimestamp(event.createdAt)}
                />
                <EventMetadataRow
                  label="Processed at"
                  value={formatTimestamp(event.processedAt)}
                />
                <EventMetadataRow
                  label="Next retry"
                  value={formatTimestamp(event.nextRetryAt)}
                />
                <EventMetadataRow
                  label="Scheduled for"
                  value={formatTimestamp(event.scheduledFor)}
                />
                <EventMetadataRow
                  label="Partition key"
                  value={event.partitionKey}
                />
                <EventMetadataRow
                  label="Source"
                  value={`${event.sourceService}.${event.sourceMethod}`}
                />
                <EventMetadataRow
                  label="Source version"
                  value={event.sourceVersion}
                />
                <EventMetadataRow label="User ID" value={event.userId} />
                <EventMetadataRow
                  label="Organization ID"
                  value={event.organizationId}
                />
                <EventMetadataRow label="Project ID" value={event.projectId} />
                <EventMetadataRow
                  label="Conversation ID"
                  value={event.conversationId}
                />
                <EventMetadataRow
                  label="Workflow ID"
                  value={event.workflowId}
                />
                <EventMetadataRow label="Last error" value={event.lastError} />
              </Stack>

              <Stack spacing={1}>
                <Typography variant="subtitle2">Headers</Typography>
                <Paper sx={{ overflowX: "auto", p: 1.5 }} variant="outlined">
                  <Typography
                    component="pre"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      m: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                    variant="body2"
                  >
                    {formatJson(event.headers)}
                  </Typography>
                </Paper>
              </Stack>

              <Stack spacing={1}>
                <Typography variant="subtitle2">Payload</Typography>
                <Paper sx={{ overflowX: "auto", p: 1.5 }} variant="outlined">
                  <Typography
                    component="pre"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      m: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                    variant="body2"
                  >
                    {formatJson(event.payload)}
                  </Typography>
                </Paper>
              </Stack>
            </Stack>
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  );
};
