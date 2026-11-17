import type {
  ImplementReportEdit,
  ProjectChangeRecord,
} from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common/services";
import {
  Box,
  Button,
  Chip,
  Link,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";

const SHORT_HASH_LENGTH = 8;

const formatRanges = (values: ImplementReportEdit["beforeRanges"]): string =>
  values
    .map((value) =>
      value.startLine === value.endLine
        ? `${value.startLine}`
        : `${value.startLine}–${value.endLine}`,
    )
    .join(", ");

export function ChangeRecordRow({
  projectId,
  record,
  onSelect,
}: {
  projectId: string;
  record: ProjectChangeRecord;
  onSelect: (edit: ImplementReportEdit) => void;
}) {
  const { t } = useTranslation();
  const { report, commits } = record;
  const payload = report.payload;
  if (payload.reportType !== "IMPLEMENT") {
    return null;
  }

  const entityOf = (entityType: string) =>
    report.entities.find((entity) => entity.entityType === entityType);
  const hrefFor = (entityType: string, entityId: string): string => {
    switch (entityType) {
      case "AGENT_SESSION":
        return WebPathService.agentSession({
          projectId,
          agentSessionId: entityId,
        });
      case "TASK":
        return WebPathService.task({ projectId, taskId: entityId });
      default:
        return WebPathService.service({ projectId, serviceId: entityId });
    }
  };
  const context = [
    { type: "AGENT_SESSION", label: t("changes.sessionLabel") },
    { type: "TASK", label: t("changes.taskLabel") },
    { type: "SERVICE", label: t("changes.serviceLabel") },
  ].flatMap(({ type, label }) => {
    const entity = entityOf(type);
    return entity ? [{ type, label, entity }] : [];
  });

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      data-testid="change-record"
      data-report-id={report.id}
    >
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
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
            title={commit.hash}
          >
            {commit.hash.slice(0, SHORT_HASH_LENGTH)}
          </Typography>
        ))}
      </Stack>
      <Box
        component="dl"
        sx={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          columnGap: 2,
          rowGap: 0.5,
          my: 1,
        }}
      >
        {context.map(({ type, label, entity }) => (
          <Box key={type} sx={{ display: "contents" }}>
            <Typography component="dt" variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>
              {entity.displayName ? (
                <Link
                  component={RouterLink}
                  to={hrefFor(type, entity.entityId)}
                >
                  {entity.displayName}
                </Link>
              ) : (
                t("changes.contextUnavailable")
              )}
            </Typography>
          </Box>
        ))}
      </Box>
      {!payload.edits?.length &&
        payload.filesChanged.map((path) => (
          <Typography key={path} variant="body2">
            {path} · {t("changes.versionsNotRecorded")}
          </Typography>
        ))}
      {(payload.edits ?? []).map((edit, index) => {
        const isNewFile = edit.versionsRecorded && edit.beforeObjectId === null;
        return (
          <Box
            key={`${edit.turnId}:${edit.path}:${index}`}
            sx={{ mt: 1 }}
            data-testid="change-edit-row"
          >
            <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
              {edit.versionsRecorded ? (
                <Button
                  data-testid="change-edit"
                  data-edit-index={index}
                  onClick={() => onSelect(edit)}
                  sx={{ textTransform: "none", overflowWrap: "anywhere" }}
                >
                  {edit.path}
                </Button>
              ) : (
                <Typography
                  variant="body2"
                  data-testid="change-edit-unrecorded"
                  sx={{ overflowWrap: "anywhere" }}
                >
                  {edit.path}
                </Typography>
              )}
              {edit.approximate ? (
                <Tooltip title={t("changes.approximateHint")}>
                  <Chip size="small" label={t("changes.approximate")} />
                </Tooltip>
              ) : (
                <Chip size="small" label={t("changes.exact")} />
              )}
              {!edit.versionsRecorded && (
                <Typography variant="caption" color="text.secondary">
                  {t("changes.versionsNotRecorded")}
                </Typography>
              )}
            </Stack>
            <Typography variant="caption" display="block">
              {t("changes.ranges", {
                before: formatRanges(edit.beforeRanges) || "—",
                after: formatRanges(edit.afterRanges) || "—",
              })}
              {isNewFile ? ` ${t("changes.newFile")}` : ""}
              {" · "}
              {new Date(edit.occurredAt).toLocaleString()}
            </Typography>
          </Box>
        );
      })}
    </Paper>
  );
}
