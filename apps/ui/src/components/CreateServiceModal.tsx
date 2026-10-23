import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import type { ServiceDto } from "@hey-hey/ui-common/api";
import { CreateServiceForm } from "@hey-hey/ui-common/components/Services";

export interface CreateServiceModalProps {
  open: boolean;
  organizationId: string;
  projectId: string;
  onClose: () => void;
  onSuccess?: (service: ServiceDto) => void;
}

export const CreateServiceModal: React.FC<CreateServiceModalProps> = ({
  open,
  organizationId,
  projectId,
  onClose,
  onSuccess,
}) => {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create Service</DialogTitle>
      <DialogContent>
        <CreateServiceForm
          organizationId={organizationId}
          projectId={projectId}
          onCancel={onClose}
          onSuccess={(service) => {
            onSuccess?.(service);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
