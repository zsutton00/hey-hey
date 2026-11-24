import { useCallback, useState } from "react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useTranslation } from "react-i18next";
import {
  useProjectChangePlaces,
  useProjectChanges,
} from "@hey-hey/ui-common/data";
import {
  ServiceSelector,
  TaskSelector,
  FeatureSelector,
} from "@hey-hey/ui-common/components";
import type {
  ImplementReportEdit,
  ProjectChangeRecord,
} from "@hey-hey/ui-common/api";
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ChangeRecordRow } from "./ChangeRecordRow";
import { RecordedEditModal } from "./RecordedEditModal";
import { groupByPlace, placeLabel } from "./changePlaces";

const PAGE_SIZE = 50;

export function ChangesView({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useQueryStates({
    agentSessionId: parseAsString,
    serviceId: parseAsString,
    taskId: parseAsString,
    featureId: parseAsString,
    committed: parseAsString,
    placeKey: parseAsString,
    groupBy: parseAsString,
    offset: parseAsInteger.withDefault(0),
  });
  const [selection, setSelection] = useState<{
    record: ProjectChangeRecord;
    edit: ImplementReportEdit;
  } | null>(null);
  const scope = {
    organizationId,
    projectId,
    agentSessionId: filters.agentSessionId ?? undefined,
    serviceId: filters.serviceId ?? undefined,
    taskId: filters.taskId ?? undefined,
    featureId: filters.featureId ?? undefined,
    committed:
      filters.committed === "true"
        ? true
        : filters.committed === "false"
          ? false
          : undefined,
  };
  const state = useProjectChanges({
    ...scope,
    limit: PAGE_SIZE,
    offset: Math.max(0, filters.offset),
    placeKey: filters.placeKey ?? undefined,
  });
  const { places } = useProjectChangePlaces(scope);
  const groups =
    filters.groupBy === "place" && state.page
      ? groupByPlace(state.page.records, (record) =>
          record.report.payload.reportType === "IMPLEMENT"
            ? (record.report.payload.edits ?? [])
            : [],
        )
      : null;
  const renderRow = (record: ProjectChangeRecord) => (
    <ChangeRecordRow
      key={record.report.id}
      projectId={projectId}
      record={record}
      onSelect={handleSelect}
    />
  );
  const handleSelect = useCallback(
    (record: ProjectChangeRecord, edit: ImplementReportEdit) =>
      setSelection({ record, edit }),
    [],
  );
  const handleFilter = (
    key:
      | "agentSessionId"
      | "serviceId"
      | "taskId"
      | "featureId"
      | "committed"
      | "placeKey",
    value: string | null,
  ) => {
    void setFilters({ [key]: value, offset: 0 });
  };
  return (
    <Stack spacing={2} data-testid="changes-view">
      <Stack spacing={0.5}>
        <Typography variant="h5" component="h1">
          {t("changes.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("changes.subtitle")}
        </Typography>
      </Stack>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <ServiceSelector
          organizationId={organizationId}
          projectId={projectId}
          value={filters.serviceId}
          onChange={(value) => handleFilter("serviceId", value)}
          label={t("changes.service")}
        />
        <TaskSelector
          organizationId={organizationId}
          projectId={projectId}
          value={filters.taskId}
          onChange={(value) => handleFilter("taskId", value)}
          label={t("changes.task")}
        />
        <FeatureSelector
          organizationId={organizationId}
          projectId={projectId}
          value={filters.featureId}
          onChange={(value) => handleFilter("featureId", value)}
          label={t("changes.feature")}
        />
        <TextField
          select
          size="small"
          label={t("changes.commitStatus")}
          value={filters.committed ?? ""}
          sx={{ minWidth: 160 }}
          slotProps={{
            inputLabel: { shrink: true },
            select: { displayEmpty: true },
          }}
          data-testid="changes-commit-filter"
          onChange={(event) =>
            handleFilter("committed", event.target.value || null)
          }
        >
          <MenuItem value="">{t("changes.all")}</MenuItem>
          <MenuItem value="true">{t("changes.committed")}</MenuItem>
          <MenuItem value="false">{t("changes.uncommitted")}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label={t("changes.place")}
          value={filters.placeKey ?? ""}
          sx={{ minWidth: 200 }}
          slotProps={{
            inputLabel: { shrink: true },
            select: { displayEmpty: true },
          }}
          data-testid="changes-place-filter"
          onChange={(event) =>
            handleFilter("placeKey", event.target.value || null)
          }
        >
          <MenuItem value="">{t("changes.all")}</MenuItem>
          {places.map((place) => (
            <MenuItem key={place.key} value={place.key}>
              {place.notRecorded
                ? t("changes.placeGroupNotRecorded")
                : placeLabel(
                    {
                      kind: place.kind!,
                      branch: place.branch ?? null,
                      worktreePath: place.worktreePath,
                    },
                    t("changes.placeDetached"),
                  )}
              {` (${place.recordCount})`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t("changes.groupBy")}
          value={filters.groupBy ?? ""}
          sx={{ minWidth: 180 }}
          slotProps={{
            inputLabel: { shrink: true },
            select: { displayEmpty: true },
          }}
          data-testid="changes-group-by"
          onChange={(event) =>
            void setFilters({ groupBy: event.target.value || null })
          }
        >
          <MenuItem value="">{t("changes.groupByNone")}</MenuItem>
          <MenuItem value="place">{t("changes.groupByPlace")}</MenuItem>
        </TextField>
      </Stack>
      {state.isLoading && <Alert severity="info">{t("changes.loading")}</Alert>}
      {state.error && <Alert severity="error">{t("changes.loadFailed")}</Alert>}
      {state.page?.records.length === 0 && (
        <Typography>{t("changes.empty")}</Typography>
      )}
      {groups
        ? groups.map((group) => (
            <Stack
              key={group.place ? JSON.stringify(group.place) : "not-recorded"}
              spacing={1}
              data-testid="change-group"
            >
              <Typography
                variant="subtitle2"
                data-testid="change-group-heading"
              >
                {group.place
                  ? placeLabel(group.place, t("changes.placeDetached"))
                  : t("changes.placeGroupNotRecorded")}
                {" · "}
                {t("changes.groupRecordCount", { count: group.items.length })}
              </Typography>
              {group.items.map(renderRow)}
            </Stack>
          ))
        : state.page?.records.map(renderRow)}
      <Stack direction="row" spacing={1}>
        <Button
          disabled={filters.offset <= 0}
          onClick={() =>
            void setFilters({ offset: Math.max(0, filters.offset - PAGE_SIZE) })
          }
          data-testid="changes-previous"
        >
          {t("changes.previous")}
        </Button>
        <Typography variant="body2" sx={{ alignSelf: "center" }}>
          {t("changes.pageRange", {
            from: filters.offset + 1,
            to: filters.offset + (state.page?.records.length ?? 0),
          })}
        </Typography>
        <Button
          disabled={!state.page?.hasMore}
          onClick={() =>
            void setFilters({ offset: filters.offset + PAGE_SIZE })
          }
          data-testid="changes-next"
        >
          {t("changes.next")}
        </Button>
      </Stack>
      {selection && (
        <RecordedEditModal
          organizationId={organizationId}
          projectId={projectId}
          selection={selection}
          onClose={() => setSelection(null)}
        />
      )}
    </Stack>
  );
}
