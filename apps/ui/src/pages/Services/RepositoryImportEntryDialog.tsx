import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import type { RepositoryImportEntry } from "./useRepositoryImportEntry";

export function RepositoryImportEntryDialog({
  entry,
}: {
  entry: RepositoryImportEntry;
}) {
  const pending =
    entry.action.status === "pending" || entry.action.status === "loading";
  return (
    <Dialog
      open={entry.showImportChoice}
      onClose={entry.close}
      data-testid="repository-import-choice"
    >
      <DialogTitle>Unfinished repository import</DialogTitle>
      <DialogContent>
        <Typography>
          Resume the existing import, or start a separate new import.
        </Typography>
        {entry.action.error && (
          <Alert
            severity="error"
            action={
              <Button disabled={pending} onClick={entry.action.retry}>
                Retry
              </Button>
            }
          >
            {entry.action.error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={pending} onClick={entry.close}>
          Cancel
        </Button>
        <Button
          data-testid="repository-import-resume"
          disabled={pending}
          onClick={entry.resume}
        >
          Resume existing
        </Button>
        <Button
          data-testid="repository-import-new"
          disabled={pending}
          variant="contained"
          onClick={entry.createNew}
        >
          {pending ? "Opening import…" : "Start new import"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
