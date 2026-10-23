import type { ServiceDto } from "@hey-hey/ui-common/api";
import type { UseServiceLifecycleReturn } from "@hey-hey/ui-common/data";
import { KEYS } from "@hey-hey/ui-common/i18n";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

type ServiceLifecycleAction = "archive" | "delete";

function errorMessage(error: unknown): string {
  const apiMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof apiMessage === "string" && apiMessage) return apiMessage;
  return error instanceof Error ? error.message : String(error);
}

interface ServiceLifecycleConfirmDialogProps {
  open: boolean;
  action: ServiceLifecycleAction;
  serviceName: string;
  isPending: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/** Closes only on success; a failed mutation stays visible inline. */
const ServiceLifecycleConfirmDialog: React.FC<
  ServiceLifecycleConfirmDialogProps
> = ({ open, action, serviceName, isPending, onConfirm, onClose }) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const keys = KEYS.services.lifecycle;
  const isDelete = action === "delete";

  const handleClose = () => {
    if (isPending) return;
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught) {
      setError(t(keys.error, { message: errorMessage(caught) }));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      onClick={(event) => event.stopPropagation()}
      aria-labelledby="service-lifecycle-dialog-title"
      data-testid={`service-lifecycle-dialog-${action}`}
    >
      <DialogTitle id="service-lifecycle-dialog-title">
        {t(isDelete ? keys.deleteConfirmTitle : keys.archiveConfirmTitle, {
          name: serviceName,
        })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText data-testid="service-lifecycle-dialog-body">
          {t(isDelete ? keys.deleteConfirmBody : keys.archiveConfirmBody, {
            name: serviceName,
          })}
        </DialogContentText>
        {error && (
          <Alert
            severity="error"
            sx={{ mt: 2 }}
            data-testid="service-lifecycle-dialog-error"
          >
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleClose}
          disabled={isPending}
          autoFocus
          data-testid="service-lifecycle-dialog-cancel"
        >
          {t(keys.cancel)}
        </Button>
        <Button
          color={isDelete ? "error" : "primary"}
          variant="contained"
          onClick={handleConfirm}
          disabled={isPending}
          data-testid="service-lifecycle-dialog-confirm"
        >
          {t(isDelete ? keys.deleteConfirm : keys.archiveConfirm)}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export interface ServiceLifecycleControlProps {
  service: ServiceDto;
  lifecycle: UseServiceLifecycleReturn;
  /** Called after a successful delete (e.g. to leave a detail page). */
  onDeleted?: () => void;
}

/**
 * Archive for an active Service, Delete for an archived one. Renders nothing
 * for roles outside Role Permissions; the server still enforces eligibility.
 */
export const ServiceLifecycleControl: React.FC<
  ServiceLifecycleControlProps
> = ({ service, lifecycle, onDeleted }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const keys = KEYS.services.lifecycle;

  const action: ServiceLifecycleAction | null =
    service.status === "ACTIVE"
      ? "archive"
      : service.status === "ARCHIVED"
        ? "delete"
        : null;
  if (!lifecycle.canManageLifecycle || !action) return null;

  const mutation = action === "archive" ? lifecycle.archive : lifecycle.remove;

  const handleOpen = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setOpen(true);
  };

  const handleConfirm = async () => {
    await mutation.mutate(service.id);
    if (action === "delete") onDeleted?.();
  };

  return (
    <>
      <Button
        size="small"
        color={action === "delete" ? "error" : "inherit"}
        startIcon={
          action === "delete" ? <DeleteOutlineIcon /> : <ArchiveOutlinedIcon />
        }
        onClick={handleOpen}
        aria-label={t(
          action === "delete" ? keys.deleteAria : keys.archiveAria,
          {
            name: service.name,
          },
        )}
        data-testid={`service-${action}-${service.id}`}
      >
        {t(action === "delete" ? keys.delete : keys.archive)}
      </Button>
      <ServiceLifecycleConfirmDialog
        open={open}
        action={action}
        serviceName={service.name}
        isPending={mutation.isPending}
        onConfirm={handleConfirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
};
