import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Alert,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  Stack,
  Typography,
} from "@mui/material";
import type { ReportDto } from "../../api";
import type { UseProjectReportsReturn } from "../../data/hooks/useProjectReports";
import { readProjectReportMetadata } from "./projectReportMetadata";

interface ProjectReportHistoryPickerProps {
  organizationId: string;
  projectId: string;
  open: boolean;
  page: number;
  pageSize: number;
  history: UseProjectReportsReturn;
  onPage: (page: number) => void;
  onClose: () => void;
  onOpenReport: (report: ReportDto) => void;
}

export const ProjectReportHistoryPicker = ({
  organizationId,
  projectId,
  open,
  page,
  pageSize,
  history,
  onPage,
  onClose,
  onOpenReport,
}: ProjectReportHistoryPickerProps) => (
  <Dialog
    open={open}
    onClose={onClose}
    fullWidth
    maxWidth="sm"
    data-testid="project-report-history-picker"
  >
    <DialogTitle>Report history</DialogTitle>
    <DialogContent>
      {history.error ? (
        <Alert
          severity="error"
          action={<Button onClick={() => void history.refetch()}>Retry</Button>}
        >
          Could not load report history.
        </Alert>
      ) : !history.isFetched || history.isLoading ? (
        <CircularProgress size={24} aria-label="Loading report history" />
      ) : history.reports.length === 0 ? (
        <Typography>No reports in this page.</Typography>
      ) : (
        <List>
          {history.reports.slice(0, pageSize).map((report) => {
            const metadata = readProjectReportMetadata(
              report,
              organizationId,
              projectId,
            );
            return metadata ? (
              <ListItemButton
                key={report.id}
                data-testid="project-report-history-entry"
                data-report-id={report.id}
                onClick={() => onOpenReport(report)}
              >
                <Stack>
                  <Typography>{metadata.title}</Typography>
                  <Typography variant="caption">{metadata.period}</Typography>
                </Stack>
              </ListItemButton>
            ) : (
              <Alert key={report.id} severity="error">
                Report metadata is unavailable.
              </Alert>
            );
          })}
        </List>
      )}
    </DialogContent>
    <DialogActions>
      <Button
        disabled={page === 0 || history.isFetching}
        onClick={() => onPage(page - 1)}
      >
        Newer
      </Button>
      <Button
        disabled={
          !history.isFetched ||
          !!history.error ||
          history.isFetching ||
          history.reports.length <= pageSize
        }
        onClick={() => onPage(page + 1)}
      >
        Older
      </Button>
      <Button onClick={onClose}>Close</Button>
    </DialogActions>
  </Dialog>
);
