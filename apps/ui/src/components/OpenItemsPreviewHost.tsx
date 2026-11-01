import React, { type ReactNode, useMemo } from "react";
import {
  PreviewHostProvider,
  useModal,
  type PreviewHost,
} from "@hey-hey/ui-common/context";

/** Adapts the typed Preview handoff to the same application-owned modal host. */
export const OpenItemsPreviewHost: React.FC<{
  children: ReactNode;
  organizationId: string;
  projectId: string | null;
}> = ({ children, organizationId, projectId }) => {
  const modal = useModal();
  const host = useMemo<PreviewHost>(
    () => ({
      openPreview: (target) => {
        if (!organizationId || !projectId) return;
        modal?.openModal({
          type: "preview",
          organizationId,
          projectId,
          target,
        });
      },
    }),
    [modal?.openModal, organizationId, projectId],
  );
  return <PreviewHostProvider host={host}>{children}</PreviewHostProvider>;
};
