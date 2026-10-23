import { Box, Stack, Typography } from "@mui/material";
import type {
  DesignDocParentEntityType,
  FutureRevisionContent,
} from "../../api";
import { FutureReferenceValue } from "./FutureReferenceValue";

export function FutureContentMetadata({
  content,
}: {
  content: FutureRevisionContent;
}) {
  const references: Array<{
    label: string;
    entityId: string | null | undefined;
    entityType:
      DesignDocParentEntityType | "USER" | "INITIATIVE" | null | undefined;
  }> =
    "type" in content
      ? [
          {
            label: "Parent",
            entityId: content.parentTaskId,
            entityType: "TASK",
          },
          {
            label: "Assignee",
            entityId: content.assigneeId,
            entityType: "USER",
          },
          {
            label: "Initiative",
            entityId: content.initiativeId,
            entityType: "INITIATIVE",
          },
        ]
      : [
          {
            label: "Parent",
            entityId: content.parentEntityId,
            entityType: content.parentEntityType,
          },
        ];
  return (
    <Stack spacing={1}>
      <Typography>Status: {content.status}</Typography>
      {"type" in content ? (
        <>
          <Typography>Type: {content.type}</Typography>
          <Typography>Source: {content.source}</Typography>
          <Typography>Priority: {content.priority ?? "Not set"}</Typography>
          <Typography>Tag: {content.tag ?? "Not set"}</Typography>
          <Typography>Due date: {content.dueDate ?? "Not set"}</Typography>
          {content.config && (
            <Box component="details">
              <Box component="summary">Launch configuration</Box>
              <Box
                component="pre"
                sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              >
                {JSON.stringify(content.config, null, 2)}
              </Box>
            </Box>
          )}
        </>
      ) : (
        <>
          <Typography>Template: {content.template}</Typography>
          <Typography>
            Tags: {content.tags.length ? content.tags.join(", ") : "None"}
          </Typography>
          <Typography>Summary: {content.summary ?? "Not set"}</Typography>
        </>
      )}
      {references.map((reference) => (
        <Stack key={reference.label} direction="row" spacing={1}>
          <Typography>{reference.label}:</Typography>
          {reference.entityId && reference.entityType ? (
            <FutureReferenceValue
              entityId={reference.entityId}
              entityType={reference.entityType}
              organizationId={content.organizationId}
              projectId={content.projectId}
            />
          ) : (
            <Typography>Not set</Typography>
          )}
        </Stack>
      ))}
    </Stack>
  );
}
