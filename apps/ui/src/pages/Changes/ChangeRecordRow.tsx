import type {
  ImplementReportEdit,
  ProjectChangeRecord,
} from "@hey-hey/ui-common/api";
import { EntityIcon } from "@hey-hey/ui-common/components";
import { WebPathService } from "@hey-hey/ui-common/services";
import {
  Box,
  Button,
  Chip,
  ButtonBase,
  Link,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { memo, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";

const SHORT_HASH_LENGTH = 8;
const FILE_LIST_MAX_HEIGHT = 360;
const NON_FOCAL_ENTITY_TYPES = new Set(["AGENT_SESSION", "SERVICE"]);

export const ChangeRecordRow = memo(function ChangeRecordRow({
  projectId,
  record,
  onSelect,
}: {
  projectId: string;
  record: ProjectChangeRecord;
  onSelect: (record: ProjectChangeRecord, edit: ImplementReportEdit) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const filesId = useId();
  const { report, commits } = record;
  const payload = report.payload;
  if (payload.reportType !== "IMPLEMENT") {
    return null;
  }

  const session = report.entities.find(
    (entity) => entity.entityType === "AGENT_SESSION",
  );
  const service = report.entities.find(
    (entity) => entity.entityType === "SERVICE",
  );
  const focal =
    report.entities.find((entity) => entity.entityType === "TASK") ??
    report.entities.find(
      (entity) => !NON_FOCAL_ENTITY_TYPES.has(entity.entityType),
    );
  const focalHref = (): string => {
    if (focal?.entityType === "TASK") {
      return WebPathService.task({ projectId, taskId: focal.entityId });
    }
    return WebPathService.feature({
      projectId,
      featureId: focal?.entityId ?? "",
    });
  };

  const edits = payload.edits ?? [];
  const fileCount = edits.length
    ? new Set(edits.map((edit) => edit.path)).size
    : payload.filesChanged.length;
  const filesLabel = t("changes.fileCount", { count: fileCount });
  const summaryLabel = edits.length
    ? t("changes.fileEditSummary", {
        files: filesLabel,
        edits: t("changes.editCount", { count: edits.length }),
      })
    : filesLabel;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      data-testid="change-record"
      data-report-id={report.id}
    >
      <Stack direction="row" gap={1} justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          {focal && (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
              data-testid="change-focal"
            >
              <EntityIcon entityType={focal.entityType} size={20} />
              <Link
                component={RouterLink}
                to={focalHref()}
                variant="subtitle1"
                fontWeight={600}
                sx={{ overflowWrap: "anywhere" }}
              >
                {focal.displayName ?? t("changes.contextUnavailable")}
              </Link>
            </Box>
          )}
          <Stack
            direction="row"
            gap={1}
            alignItems="center"
            flexWrap="wrap"
            sx={{ mt: focal ? 0.5 : 0 }}
          >
            {service && (
              <Chip
                size="small"
                variant="outlined"
                label={service.displayName ?? t("changes.contextUnavailable")}
                data-testid="change-service"
              />
            )}
            {commits.map((commit) => (
              <Tooltip
                key={`${commit.reportId}:${commit.service}:${commit.hash}`}
                title={t("changes.commitHashTooltip", { hash: commit.hash })}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={commit.hash.slice(0, SHORT_HASH_LENGTH)}
                  data-testid="change-commit-hash"
                  sx={{ fontFamily: "monospace" }}
                />
              </Tooltip>
            ))}
            {session && (
              <Button
                size="small"
                component={RouterLink}
                to={WebPathService.agentSession({
                  projectId,
                  agentSessionId: session.entityId,
                })}
                sx={{ textTransform: "none" }}
              >
                {t("changes.viewSession")}
              </Button>
            )}
          </Stack>
        </Box>
        <Stack
          direction="row"
          gap={1}
          flexWrap="wrap"
          alignItems="center"
          justifyContent="flex-end"
          sx={{ flexShrink: 0 }}
        >
          <Typography
            component="time"
            dateTime={report.createdAt}
            variant="caption"
          >
            {new Date(report.createdAt).toLocaleString()}
          </Typography>
          <Chip
            size="small"
            color={commits.length ? "success" : "warning"}
            label={
              commits.length ? t("changes.committed") : t("changes.uncommitted")
            }
          />
        </Stack>
      </Stack>
      <ButtonBase
        data-testid="change-files-toggle"
        aria-expanded={expanded}
        aria-controls={filesId}
        onClick={() => setExpanded((open) => !open)}
        sx={{ mt: 1, typography: "body2", gap: 0.5 }}
      >
        <span aria-hidden>{expanded ? "▾" : "▸"}</span>
        {summaryLabel}
      </ButtonBase>
      <Box
        id={filesId}
        hidden={!expanded}
        sx={{ maxHeight: FILE_LIST_MAX_HEIGHT, overflowY: "auto" }}
      >
        {expanded &&
          !edits.length &&
          payload.filesChanged.map((path) => (
            <Typography
              key={path}
              variant="body2"
              sx={{ overflowWrap: "anywhere" }}
            >
              {path} · {t("changes.versionsNotRecorded")}
            </Typography>
          ))}
        {expanded &&
          edits.map((edit, index) => (
            <Stack
              key={`${edit.turnId}:${edit.path}:${index}`}
              direction="row"
              gap={1}
              flexWrap="wrap"
              alignItems="center"
              sx={{ mt: 0.5 }}
              data-testid="change-edit-row"
            >
              {edit.versionsRecorded ? (
                <Button
                  data-testid="change-edit"
                  data-edit-index={index}
                  onClick={() => onSelect(record, edit)}
                  sx={{
                    textTransform: "none",
                    overflowWrap: "anywhere",
                    textAlign: "left",
                  }}
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
              <Typography variant="caption" color="text.secondary">
                {new Date(edit.occurredAt).toLocaleString()}
              </Typography>
            </Stack>
          ))}
      </Box>
    </Paper>
  );
});
