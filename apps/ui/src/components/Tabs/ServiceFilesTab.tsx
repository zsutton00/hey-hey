import HistoryIcon from "@mui/icons-material/History";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  FileTouchHistoryPanel,
  type FileTouchHistoryPanelProps,
} from "@hey-hey/ui-common/components";
import { FileReferenceLink } from "@hey-hey/ui-common/components/SmarterTextAreaCard/fileReferences/FileReferenceLink";
import type { FileReferenceValueV1 } from "@hey-hey/ui-common/components/SmarterTextAreaCard/fileReferences/types";
import {
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
  useServiceFileHistory,
  type ServiceFileHistoryEntry,
} from "@hey-hey/ui-common/data";
import { usePathService } from "@hey-hey/ui-common/context";
import React, { useState } from "react";
import { Link as RouterLink } from "react-router-dom";

export interface ServiceFilesTabProps {
  organizationId: string;
  projectId: string;
  serviceId: string;
  active: boolean;
}

interface ServiceFilePaginationState {
  serviceId: string;
  cursors: string[];
}

const toFileReferenceValue = (
  file: ServiceFileHistoryEntry
): FileReferenceValueV1 => ({
  version: 1,
  serviceId: file.serviceId,
  serviceName: file.serviceName,
  normalizedPath: file.normalizedPath,
});

export const ServiceFilesTab: React.FC<ServiceFilesTabProps> = ({
  organizationId,
  projectId,
  serviceId,
  active,
}) => {
  const pathService = usePathService();
  const [pathFilter, setPathFilter] = useState("");
  const [sortBy, setSortBy] = useState<FileTouchServiceHistorySortBy>(
    FileTouchServiceHistorySortBy.LastTouchedAt
  );
  const [sortOrder, setSortOrder] = useState<FileTouchServiceHistorySortOrder>(
    FileTouchServiceHistorySortOrder.Desc
  );
  const [pagination, setPagination] = useState<ServiceFilePaginationState>({
    serviceId,
    cursors: [],
  });
  const [historyFile, setHistoryFile] =
    useState<ServiceFileHistoryEntry | null>(null);
  const cursorStack =
    pagination.serviceId === serviceId ? pagination.cursors : [];
  const cursor = cursorStack[cursorStack.length - 1];
  const state = useServiceFileHistory({
    organizationId,
    projectId,
    serviceId,
    pathFilter,
    sortBy,
    sortOrder,
    ...(cursor ? { cursor } : {}),
    active,
  });

  const resetPagination = () =>
    setPagination({ serviceId, cursors: [] });
  const historyPanelProps: FileTouchHistoryPanelProps | null =
    historyFile?.serviceId === serviceId
      ? {
          open: true,
          onClose: () => setHistoryFile(null),
          organizationId,
          projectId,
          serviceId,
          normalizedPath: historyFile.normalizedPath,
        }
      : null;

  return (
    <Box data-testid="service-files-tab" sx={{ p: 3 }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          label="Filter paths"
          value={pathFilter}
          onChange={(event) => {
            setPathFilter(event.target.value);
            resetPagination();
          }}
          size="small"
          fullWidth
          inputProps={{ "data-testid": "service-files-path-filter" }}
        />
        <FormControl size="small" sx={{ minWidth: 190 }}>
          <InputLabel id="service-files-sort-label">Sort by</InputLabel>
          <Select
            labelId="service-files-sort-label"
            label="Sort by"
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value as FileTouchServiceHistorySortBy);
              resetPagination();
            }}
            data-testid="service-files-sort"
          >
            <MenuItem value={FileTouchServiceHistorySortBy.LastTouchedAt}>
              Last touched
            </MenuItem>
            <MenuItem value={FileTouchServiceHistorySortBy.NormalizedPath}>
              Path
            </MenuItem>
            <MenuItem value={FileTouchServiceHistorySortBy.TouchCount}>
              Touch count
            </MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="service-files-order-label">Order</InputLabel>
          <Select
            labelId="service-files-order-label"
            label="Order"
            value={sortOrder}
            onChange={(event) => {
              setSortOrder(
                event.target.value as FileTouchServiceHistorySortOrder
              );
              resetPagination();
            }}
            data-testid="service-files-order"
          >
            <MenuItem value={FileTouchServiceHistorySortOrder.Desc}>
              Descending
            </MenuItem>
            <MenuItem value={FileTouchServiceHistorySortOrder.Asc}>
              Ascending
            </MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {state.status === "loading" && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
          <CircularProgress aria-label="Loading Service files" size={28} />
        </Box>
      )}
      {state.status === "error" && (
        <Alert severity="error">
          Couldn’t load historical files: {state.error.message}
        </Alert>
      )}
      {state.status === "empty" && (
        <Alert severity="info">
          No historical files match this Service and filter.
        </Alert>
      )}
      {(state.status === "ready" || state.status === "updating") && (
        <Stack spacing={1.5}>
          {state.status === "updating" && (
            <Alert severity="info">Updating historical files…</Alert>
          )}
          {state.files.map((file) => (
            <Box
              key={file.normalizedPath}
              data-testid="service-file-row"
              data-file-path={file.normalizedPath}
              sx={{
                display: "flex",
                alignItems: { xs: "flex-start", md: "center" },
                justifyContent: "space-between",
                flexDirection: { xs: "column", md: "row" },
                gap: 2,
                borderBottom: 1,
                borderColor: "divider",
                pb: 1.5,
              }}
            >
              <Stack spacing={0.5}>
                <FileReferenceLink value={toFileReferenceValue(file)} />
                <Typography variant="body2" color="text.secondary">
                  Latest task:{" "}
                  <Link
                    component={RouterLink}
                    to={pathService.task({
                      projectId,
                      taskId: file.latestTaskId,
                    })}
                  >
                    {file.latestTaskName}
                  </Link>{" "}
                  · Session:{" "}
                  <Link
                    component={RouterLink}
                    to={pathService.agentSession({
                      projectId,
                      agentSessionId: file.latestAgentSessionId,
                    })}
                  >
                    {file.latestAgentSessionTitle}
                  </Link>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {file.touchCount}{" "}
                  {file.touchCount === 1 ? "touch" : "touches"} · Last touched{" "}
                  {new Date(file.lastTouchedAt).toLocaleString()}
                </Typography>
              </Stack>
              <Button
                size="small"
                startIcon={<HistoryIcon />}
                onClick={() => setHistoryFile(file)}
                aria-label={`Show task history for ${file.normalizedPath}`}
              >
                History
              </Button>
            </Box>
          ))}
          <Stack direction="row" justifyContent="space-between" sx={{ pt: 1 }}>
            <Button
              variant="outlined"
              disabled={cursorStack.length === 0}
              onClick={() =>
                setPagination((current) => ({
                  serviceId,
                  cursors:
                    current.serviceId === serviceId
                      ? current.cursors.slice(0, -1)
                      : [],
                }))
              }
            >
              Previous
            </Button>
            <Button
              variant="outlined"
              disabled={!state.nextCursor}
              onClick={() => {
                if (state.nextCursor) {
                  setPagination((current) => ({
                    serviceId,
                    cursors: [
                      ...(current.serviceId === serviceId
                        ? current.cursors
                        : []),
                      state.nextCursor!,
                    ],
                  }));
                }
              }}
            >
              Next
            </Button>
          </Stack>
        </Stack>
      )}

      {historyPanelProps && <FileTouchHistoryPanel {...historyPanelProps} />}
    </Box>
  );
};
