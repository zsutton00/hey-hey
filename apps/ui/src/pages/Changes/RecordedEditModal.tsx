import type {
  ImplementReportEdit,
  ProjectChangeRecord,
} from "@hey-hey/ui-common/api";
import { useRecordedEdit } from "@hey-hey/ui-common/data";
import { CollatedFileDiffModal } from "@hey-hey/ui-common/components/AgentSession/CollatedFileDiffModal/CollatedFileDiffModal";
import { selectLocatedDecisions } from "@hey-hey/ui-common/components/AgentSession/CollatedFileDiffModal/locatedDecisions";
import {
  Alert,
  Dialog,
  DialogContent,
  DialogTitle,
  Button,
} from "@mui/material";
import { useTranslation } from "react-i18next";

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
    return (
      <Dialog open onClose={onClose} fullWidth>
        <DialogTitle>{selection.edit.path}</DialogTitle>
        <DialogContent>
          <Alert
            severity={state.status === "loading" ? "info" : "warning"}
            data-testid="recorded-edit-state"
          >
            {state.status === "loading"
              ? t("changes.loading")
              : t("changes.unavailable")}
          </Alert>
          <Button onClick={onClose}>{t("changes.close")}</Button>
        </DialogContent>
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
