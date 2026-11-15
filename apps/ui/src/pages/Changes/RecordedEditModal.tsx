import type {
  ImplementReportEdit,
  ProjectChangeRecord,
} from "@hey-hey/ui-common/api";
import { useRecordedEdit } from "@hey-hey/ui-common/data";
import { CollatedFileDiffModal } from "@hey-hey/ui-common/components/AgentSession/CollatedFileDiffModal/CollatedFileDiffModal";
import { selectLocatedDecisions } from "@hey-hey/ui-common/components/AgentSession/CollatedFileDiffModal/locatedDecisions";
import {
  Alert,
  AlertTitle,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { recordedEditUnavailableReason } from "./recordedEditUnavailableReason";

export function RecordedEditModal({
  organizationId,
  projectId,
  selection,
  onClose,
}: {
  organizationId: string;
  projectId: string;
  selection: { record: ProjectChangeRecord; edit: ImplementReportEdit };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { report } = selection.record;
  const session = report.entities.find(
    (entity) => entity.entityType === "AGENT_SESSION",
  );
  const service = report.entities.find(
    (entity) => entity.entityType === "SERVICE",
  );
  const state = useRecordedEdit({
    organizationId,
    projectId,
    agentSessionId: session?.entityId ?? "",
    runId: session?.entityId ?? null,
    serviceId: service?.entityId ?? null,
    edit: selection.edit,
    open: selection.edit.versionsRecorded,
  });
  if (!state.file) {
    const isLoading = state.status !== "unavailable";
    return (
      <Dialog open onClose={onClose} fullWidth>
        <DialogTitle>{selection.edit.path}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("changes.dialogContext", {
              service: service?.displayName ?? t("changes.contextUnavailable"),
              time: new Date(selection.edit.occurredAt).toLocaleString(),
            })}
          </Typography>
          <Alert
            severity={isLoading ? "info" : "warning"}
            data-testid="recorded-edit-state"
          >
            {state.status === "unavailable" ? (
              <>
                <AlertTitle>{t("changes.dialogHeading")}</AlertTitle>
                {t(recordedEditUnavailableReason(state.cause))}
              </>
            ) : (
              t("changes.loading")
            )}
          </Alert>
        </DialogContent>
        <DialogActions>
          {!isLoading && (
            <Button
              variant="contained"
              onClick={state.retry}
              data-testid="recorded-edit-retry"
            >
              {t("changes.retry")}
            </Button>
          )}
          <Button onClick={onClose} data-testid="recorded-edit-close">
            {t("changes.close")}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
  const file = state.file;
  const identity = `${file.serviceId}\u0000${file.repoPath}\u0000${file.filePath}`;
  return (
    <CollatedFileDiffModal
      open
      onClose={onClose}
      entries={[file]}
      selectedIdentity={identity}
      onSelect={() => {}}
      detail={file}
      detailState={{ status: "ready" }}
      readState={{ status: "ready" }}
      onRetry={state.retry}
      onRetryDetail={state.retry}
      serviceNamesState={
        service?.displayName
          ? {
              status: "ready",
              serviceNamesById: new Map([
                [service.entityId, service.displayName],
              ]),
            }
          : { status: "error" }
      }
      recordedRanges={selection.edit}
      decisions={selectLocatedDecisions([report])}
    />
  );
}
