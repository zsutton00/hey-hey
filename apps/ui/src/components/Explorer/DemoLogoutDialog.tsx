import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useTranslation } from "react-i18next";

interface DemoLogoutDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Warns a demo visitor that logging out ends their demo for good. */
export const DemoLogoutDialog = ({
  open,
  onConfirm,
  onCancel,
}: DemoLogoutDialogProps) => {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="demo-logout-title"
      aria-describedby="demo-logout-body"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="demo-logout-title">{t("demo.logout.title")}</DialogTitle>
      <DialogContent>
        <DialogContentText id="demo-logout-body">
          {t("demo.logout.body")}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} data-testid="demo-logout-cancel">
          {t("demo.logout.cancel")}
        </Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          data-testid="demo-logout-confirm"
        >
          {t("demo.logout.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
