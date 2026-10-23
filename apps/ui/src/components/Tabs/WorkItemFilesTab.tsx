import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import React, { useMemo, useState } from "react";
import {
  FileTouchHistoryPanel,
  type FileTouchHistoryPanelProps,
} from "@hey-hey/ui-common/components";
import {
  useWorkItemFileHistory,
  type FeatureFileSection,
  type FileHistoryFile,
  type SupportedFilesTabType,
  type WorkItemFileHistory,
} from "@hey-hey/ui-common/data";
import { FileReferenceLink } from "@hey-hey/ui-common/components/SmarterTextAreaCard/fileReferences/FileReferenceLink";
import type { FileReferenceValueV1 } from "@hey-hey/ui-common/components/SmarterTextAreaCard/fileReferences/types";

export interface WorkItemFilesTabProps {
  organizationId: string;
  projectId: string;
  entityId: string;
  typeKey: string;
}

export const isFilesTabSupported = (selection: {
  status: string;
  typeKey?: string;
}): selection is { status: "resolved"; typeKey: SupportedFilesTabType } =>
  selection.status === "resolved" &&
  (selection.typeKey === "FEATURE" ||
    selection.typeKey === "STANDARD" ||
    selection.typeKey === "BUG");

const toFileReferenceValue = (
  file: FileHistoryFile
): FileReferenceValueV1 => ({
  version: 1,
  serviceId: file.serviceId,
  serviceName: file.serviceName,
  normalizedPath: file.normalizedPath,
});

export const WorkItemFilesTab: React.FC<WorkItemFilesTabProps> = ({
  organizationId,
  projectId,
  entityId,
  typeKey,
}) => {
  const supported = isFilesTabSupported({ status: "resolved", typeKey });
  const scope = useMemo(
    () =>
      typeKey === "FEATURE"
        ? { kind: "feature" as const, featureId: entityId }
        : { kind: "task" as const, taskId: entityId },
    [entityId, typeKey]
  );
  const state = useWorkItemFileHistory({
    organizationId,
    projectId,
    scope,
    active: supported,
  });
  const [historyFile, setHistoryFile] = useState<FileHistoryFile | null>(null);

  const historyPanelProps: FileTouchHistoryPanelProps | null = historyFile
    ? {
        open: true,
        onClose: () => setHistoryFile(null),
        organizationId,
        projectId,
        serviceId: historyFile.serviceId,
        normalizedPath: historyFile.normalizedPath,
      }
    : null;

  const renderFile = (file: FileHistoryFile): React.ReactNode => (
    <Box
      key={`${file.serviceId}:${file.normalizedPath}`}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        py: 1,
      }}
    >
      <FileReferenceLink value={toFileReferenceValue(file)} />
      <Button
        size="small"
        startIcon={<HistoryIcon />}
        onClick={() => setHistoryFile(file)}
        aria-label={`Show task history for ${file.normalizedPath}`}
      >
        History
      </Button>
    </Box>
  );

  const renderTaskHistory = (history: WorkItemFileHistory): React.ReactNode => {
    if (history.kind !== "task") return null;
    if (history.files.length === 0) {
      return <Alert severity="info">No historical files found for this work item.</Alert>;
    }
    return <Stack divider={<Divider />}>{history.files.map(renderFile)}</Stack>;
  };

  const renderFeatureHistory = (
    sections: readonly FeatureFileSection[]
  ): React.ReactNode => {
    if (sections.length === 0) {
      return <Alert severity="info">No historical files found for this feature.</Alert>;
    }
    return (
      <Stack spacing={2} divider={<Divider />}>
        {sections.map((section) => (
          <Box key={section.featureId}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {section.featureName}
            </Typography>
            {section.featurePath && (
              <Typography variant="caption" color="text.secondary">
                {section.featurePath}
              </Typography>
            )}
            {section.files.length > 0 ? (
              <Box>{section.files.map(renderFile)}</Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No historical files in this section.
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
    );
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Files
      </Typography>
      {state.status === "loading" && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
          <CircularProgress aria-label="Loading files" size={28} />
        </Box>
      )}
      {state.status === "error" && (
        <Alert severity="error">Couldn’t load historical files: {state.error.message}</Alert>
      )}
      {state.status === "empty" && (
        <Alert severity="info">No historical files found for this work item.</Alert>
      )}
      {(state.status === "ready" || state.status === "updating") && (
        <>
          {state.status === "updating" && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Updating historical files…
            </Alert>
          )}
          {state.history.kind === "task"
            ? renderTaskHistory(state.history)
            : renderFeatureHistory(state.history.sections)}
        </>
      )}

      {historyPanelProps && <FileTouchHistoryPanel {...historyPanelProps} />}
    </Box>
  );
};
