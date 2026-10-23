import React, { useEffect, useMemo, useState } from "react";
import {
  ReportType,
  type CliReadChangedFileInventoryEntry,
} from "../../../api";
import { useReports } from "../../../data/hooks/useReports";
import { useServices } from "../../../data/hooks/useServices";
import { CollatedFileDiffModal } from "./CollatedFileDiffModal";
import { selectLocatedDecisions } from "./locatedDecisions";
import { useRemoteChangedFileDetail } from "../runtime/hooks/useRemoteChangedFileDetail";

export interface CollatedFileDiffModalContainerProps {
  open: boolean;
  onClose: () => void;
  entries: CliReadChangedFileInventoryEntry[];
  readState:
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready" };
  onRetry: () => void;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string | null;
}

/**
 * Data wrapper around {@link CollatedFileDiffModal}.
 *
 * IMPLEMENT reports are authored continuously over the life of a coding
 * session, so fetching them is gated on `open`: the reports query stays
 * disabled until the user opens the diff modal and never runs while the
 * modal is closed. The presentational modal stays free of any data concern.
 */
export const CollatedFileDiffModalContainer: React.FC<
  CollatedFileDiffModalContainerProps
> = ({
  open,
  onClose,
  entries,
  readState,
  onRetry,
  organizationId,
  projectId,
  agentSessionId,
  runId,
}) => {
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const identity = (entry: CliReadChangedFileInventoryEntry) =>
    `${entry.serviceId}\u0000${entry.repoPath}\u0000${entry.filePath}`;
  const selectedEntry =
    entries.find((entry) => identity(entry) === selectedIdentity) ??
    entries[0] ??
    null;
  useEffect(() => {
    if (!open) setSelectedIdentity(null);
  }, [open]);
  const detail = useRemoteChangedFileDetail({
    organizationId,
    projectId,
    agentSessionId,
    runId,
    file: selectedEntry,
    open,
  });
  const { reports } = useReports(organizationId, {
    reportType: ReportType.Implement,
    sourceExecutionId: agentSessionId,
    enabled: open && Boolean(organizationId && agentSessionId),
  });
  const servicesQuery = useServices(organizationId, {
    projectId,
    enabled: open && Boolean(organizationId && projectId),
  });

  const decisions = useMemo(() => selectLocatedDecisions(reports), [reports]);
  const serviceNamesById = useMemo(
    () =>
      new Map(
        servicesQuery.services.map((service) => [service.id, service.name])
      ),
    [servicesQuery.services]
  );
  const missingService = entries.some(
    (entry) => !serviceNamesById.has(entry.serviceId)
  );
  const serviceNamesState = servicesQuery.error
    ? ({ status: "error" } as const)
    : !servicesQuery.isFetched || servicesQuery.isLoading
    ? ({ status: "loading" } as const)
    : missingService
    ? ({ status: "error" } as const)
    : ({ status: "ready", serviceNamesById } as const);

  return (
    <CollatedFileDiffModal
      open={open}
      onClose={onClose}
      entries={entries}
      selectedIdentity={selectedEntry ? identity(selectedEntry) : null}
      onSelect={setSelectedIdentity}
      detail={detail.file}
      detailState={
        detail.status === "success"
          ? { status: "ready" }
          : detail.status === "unavailable"
          ? { status: "error", message: detail.error }
          : { status: "loading" }
      }
      onRetryDetail={detail.retry}
      readState={readState}
      onRetry={onRetry}
      serviceNamesState={serviceNamesState}
      decisions={decisions}
    />
  );
};
