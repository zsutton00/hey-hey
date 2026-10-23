import React, { useCallback, useState } from "react";
import { Box } from "@mui/material";
import type { CreateFeatureDto, CreateTaskDto, FeatureTag } from "../../api";
import { NewTaskModal } from "../Tasks/NewTaskModal";
import type { NewTaskModalProps } from "../Tasks/NewTaskModal";
import { FeatureTagSelector } from "../Selectors/FeatureTagSelector";

export interface NewFeatureModalProps
  extends Omit<
    NewTaskModalProps,
    "onSubmit" | "extraFields" | "submitDisabled"
  > {
  onSubmit: (formData: CreateFeatureDto) => void;
}

export const NewFeatureModal: React.FC<NewFeatureModalProps> = ({
  onSubmit,
  onClose,
  ...props
}) => {
  const [tag, setTag] = useState<FeatureTag | null>(null);

  const handleSubmit = useCallback(
    (formData: CreateTaskDto) => {
      if (tag === null) return;
      const feature: CreateFeatureDto = {
        name: formData.name,
        tag,
        ...(formData.sections ? { sections: formData.sections } : {}),
        ...(formData.initiativeId
          ? { initiativeId: formData.initiativeId }
          : {}),
        ...(formData.status ? { status: formData.status } : {}),
        ...(formData.source ? { source: formData.source } : {}),
        ...(formData.priority ? { priority: formData.priority } : {}),
        ...(formData.dueDate ? { dueDate: formData.dueDate } : {}),
        ...(formData.assigneeId ? { assigneeId: formData.assigneeId } : {}),
        ...(formData.parentTaskId
          ? { parentTaskId: formData.parentTaskId }
          : {}),
      };
      onSubmit(feature);
    },
    [onSubmit, tag]
  );

  const handleClose = useCallback(() => {
    setTag(null);
    onClose();
  }, [onClose]);

  return (
    <NewTaskModal
      {...props}
      onClose={handleClose}
      onSubmit={handleSubmit}
      submitDisabled={tag === null}
      extraFields={
        <Box sx={{ mt: 2 }}>
          <FeatureTagSelector value={tag} onChange={setTag} fullWidth />
        </Box>
      }
    />
  );
};
