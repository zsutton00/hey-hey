import type {
  ImplementReportEdit,
  ProjectChangeRecord,
} from "@hey-hey/ui-common/api";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

export function ChangeRecordRow({
  record,
  onSelect,
}: {
  record: ProjectChangeRecord;
  onSelect: (edit: ImplementReportEdit) => void;
}) {
  const { t } = useTranslation();
  const { report, commits } = record;
  const payload = report.payload;
  if (payload.reportType !== "IMPLEMENT") {
    return null;
  }
  const ranges = (values: ImplementReportEdit["beforeRanges"]) =>
    values
      .map((value) =>
        value.startLine === value.endLine
          ? `${value.startLine}`
          : `${value.startLine}–${value.endLine}`,
      )
      .join(", ");
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      data-testid="change-record"
      data-report-id={report.id}
    >
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        {report.entities
          .filter((entity) =>
            ["AGENT_SESSION", "TASK", "SERVICE"].includes(entity.entityType),
          )
          .map((entity) => (
            <Typography
              key={`${entity.entityType}:${entity.entityId}`}
              variant="body2"
            >
              {entity.displayName ?? t("changes.contextUnavailable")}
            </Typography>
          ))}
        <Typography
          component="time"
          dateTime={report.createdAt}
          variant="caption"
        >
          {new Date(report.createdAt).toLocaleString()}
        </Typography>
        <Chip
          size="small"
          label={
            commits.length ? t("changes.committed") : t("changes.uncommitted")
          }
        />
        {commits.map((commit) => (
          <Typography
            key={`${commit.reportId}:${commit.service}:${commit.hash}`}
            component="code"
            variant="caption"
          >
            {commit.hash}
          </Typography>
        ))}
      </Stack>
      {!payload.edits?.length &&
        payload.filesChanged.map((path) => (
          <Typography key={path} variant="body2">
            {path} · {t("changes.unavailable")}
          </Typography>
        ))}
      {(payload.edits ?? []).map((edit, index) => (
        <Box key={`${edit.turnId}:${edit.path}:${index}`} sx={{ mt: 1 }}>
          <Button
            data-testid="change-edit"
            data-edit-index={index}
            onClick={() => onSelect(edit)}
            sx={{ textTransform: "none", overflowWrap: "anywhere" }}
          >
            {edit.path}
          </Button>
          {edit.approximate && (
            <Chip size="small" label={t("changes.approximate")} />
          )}
          {!edit.versionsRecorded && (
            <Chip size="small" label={t("changes.unavailable")} />
          )}
          <Typography variant="caption" display="block">
            {t("changes.ranges", {
              before: ranges(edit.beforeRanges) || "—",
              after: ranges(edit.afterRanges) || "—",
            })}
            {" · "}
            {new Date(edit.occurredAt).toLocaleString()}
          </Typography>
        </Box>
      ))}
    </Paper>
  );
}
