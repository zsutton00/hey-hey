import type { DesignDocResponseDto } from "@hey-hey/ui-common/api";
import { CapsuleAction } from "@hey-hey/ui-common/components";
import { useUpdateDesignDoc } from "@hey-hey/ui-common/data";
import ReadyIcon from "@mui/icons-material/CheckCircleOutline";
import { useCallback } from "react";

interface SetReadyActionCapsuleProps {
  organizationId: string;
  designDocId: string;
  status: DesignDocResponseDto["status"];
  disabled?: boolean;
}

export const SetReadyActionCapsule: React.FC<SetReadyActionCapsuleProps> = ({
  organizationId,
  designDocId,
  status,
  disabled = false,
}) => {
  const { mutate: updateDesignDoc, isPending: isUpdatingDesignDoc } =
    useUpdateDesignDoc();
  const isReady = status === "READY";

  const handleSetReady = useCallback(() => {
    if (isReady) {
      return;
    }

    updateDesignDoc({
      organizationId,
      designDocId,
      updates: { status: "READY" },
    });
  }, [designDocId, isReady, organizationId, updateDesignDoc]);

  if (isReady) {
    return null;
  }

  return (
    <CapsuleAction
      id={`set-design-doc-ready-${designDocId}`}
      behavior="click"
      icon={ReadyIcon}
      label="Set Ready"
      title="Move to Ready"
      actionGroup="page"
      tier="page"
      order={99}
      onClick={handleSetReady}
      disabled={disabled || isUpdatingDesignDoc}
    />
  );
};
