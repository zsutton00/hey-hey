import { useState } from "react";
import { useParams } from "react-router-dom";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useTranslation } from "react-i18next";
import { useOrganization } from "@hey-hey/ui-common/context";
import {
  useAgentSession,
  useAgentSessions,
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
  Autocomplete,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ChangeRecordRow } from "./ChangeRecordRow";
import { RecordedEditModal } from "./RecordedEditModal";

export function ChangesPage() {
  const { t } = useTranslation();
  const { projectId = "" } = useParams<{ projectId: string }>();
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id ?? "";
  const [filters, setFilters] = useQueryStates({
    agentSessionId: parseAsString,
    serviceId: parseAsString,
    taskId: parseAsString,
    featureId: parseAsString,
    committed: parseAsString,
    offset: parseAsInteger.withDefault(0),
  });
  const [selection, setSelection] = useState<{
    record: ProjectChangeRecord;
    edit: ImplementReportEdit;
  } | null>(null);
  const { agentSessions } = useAgentSessions(organizationId, projectId);
  const { agentSession: selectedSession } = useAgentSession(
    organizationId,
    projectId,
    filters.agentSessionId ?? "",
    { enabled: !!filters.agentSessionId },
  );
  const sessions =
    selectedSession &&
    !agentSessions.some((session) => session.id === selectedSession.id)
      ? [selectedSession, ...agentSessions]
      : agentSessions;
  const state = useProjectChanges({
    organizationId,
    projectId,
    limit: 50,
    offset: Math.max(0, filters.offset),
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
  });
  const handleFilter = (
    key: "agentSessionId" | "serviceId" | "taskId" | "featureId" | "committed",
    value: string | null,
  ) => {
    void setFilters({ [key]: value, offset: 0 });
  };
  return (
    <Stack spacing={2} data-testid="changes-page">
      <Typography variant="h4">{t("changes.title")}</Typography>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Autocomplete
          sx={{ minWidth: 200, flex: 1 }}
          options={sessions}
          getOptionLabel={(session) => session.title}
          value={
            sessions.find((session) => session.id === filters.agentSessionId) ??
            null
          }
          onChange={(_, session) =>
            handleFilter("agentSessionId", session?.id ?? null)
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label={t("changes.session")}
              data-testid="changes-session-filter"
            />
          )}
        />
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
          label={t("changes.commitStatus")}
          value={filters.committed ?? ""}
          sx={{ minWidth: 160 }}
          data-testid="changes-commit-filter"
          onChange={(event) =>
            handleFilter("committed", event.target.value || null)
          }
        >
          <MenuItem value="">{t("changes.all")}</MenuItem>
          <MenuItem value="true">{t("changes.committed")}</MenuItem>
          <MenuItem value="false">{t("changes.uncommitted")}</MenuItem>
        </TextField>
      </Stack>
      {state.isLoading && <Alert severity="info">{t("changes.loading")}</Alert>}
      {state.error && <Alert severity="error">{t("changes.loadFailed")}</Alert>}
      {state.page?.records.length === 0 && (
        <Typography>{t("changes.empty")}</Typography>
      )}
      {state.page?.records.map((record) => (
        <ChangeRecordRow
          key={record.report.id}
          record={record}
          onSelect={(edit) => setSelection({ record, edit })}
        />
      ))}
      <Stack direction="row" spacing={1}>
        <Button
          disabled={filters.offset <= 0}
          onClick={() =>
            void setFilters({ offset: Math.max(0, filters.offset - 50) })
          }
          data-testid="changes-previous"
        >
          {t("changes.previous")}
        </Button>
        <Button
          disabled={!state.page?.hasMore}
          onClick={() => void setFilters({ offset: filters.offset + 50 })}
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
