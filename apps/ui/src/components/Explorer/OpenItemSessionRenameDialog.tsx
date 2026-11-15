import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAuth } from "@hey-hey/ui-common/context";
import { useOpenItemSessionRename } from "@hey-hey/ui-common/data";

export function OpenItemSessionRenameDialog({
  organizationId,
  projectId,
  sessionId,
  conversationId,
  onClose,
}: {
  organizationId: string;
  projectId: string;
  sessionId: string;
  conversationId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const editor = useOpenItemSessionRename(
    { organizationId, projectId, userId: user?.id ?? "" },
    sessionId,
    conversationId,
    onClose,
  );
  const invalid = !editor.isValid;
  const handleSave = () => {
    void editor.save();
  };
  const handleReview = () => {
    void editor.reviewLatest();
  };
  const handleLoad = () => {
    void editor.load();
  };
  return (
    <Dialog
      open
      onClose={editor.busy ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      data-testid="open-item-session-rename-dialog"
    >
      <DialogTitle>{t("openItems.rename.heading")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            label={t("openItems.rename.title")}
            value={editor.draft}
            onChange={(event) => editor.setDraft(event.target.value)}
            disabled={editor.busy || !editor.loaded || editor.titleSaved}
            error={editor.loaded && invalid}
            helperText={t("openItems.rename.help")}
            slotProps={{ htmlInput: { "data-testid": "session-rename-title" } }}
          />
          {editor.error && (
            <Alert
              severity={editor.error === "refresh" ? "warning" : "error"}
              data-testid="session-rename-error"
            >
              {t(
                `openItems.rename.${editor.error === "save" ? "failed" : editor.error}`,
              )}
            </Alert>
          )}
          {editor.error === "conflict" && editor.latestTitle !== undefined && (
            <Typography data-testid="session-rename-latest">
              {t("openItems.rename.latest", { title: editor.latestTitle })}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={editor.busy}
          data-testid="session-rename-cancel"
        >
          {t("openItems.rename.cancel")}
        </Button>
        {editor.error === "read" ? (
          <Button
            onClick={handleLoad}
            disabled={editor.busy}
            data-testid="session-rename-retry-read"
          >
            {t("openItems.rename.retry")}
          </Button>
        ) : editor.error === "conflict" ? (
          <Button
            onClick={handleReview}
            disabled={editor.busy}
            data-testid="session-rename-review"
          >
            {t("openItems.rename.review")}
          </Button>
        ) : (
          <Button
            onClick={handleSave}
            disabled={
              editor.busy || !editor.loaded || (!editor.titleSaved && invalid)
            }
            data-testid="session-rename-save"
          >
            {t(
              editor.error === "refresh"
                ? "openItems.rename.retry"
                : "openItems.rename.save",
            )}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
