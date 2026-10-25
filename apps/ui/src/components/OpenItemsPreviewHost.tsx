import React, { type ReactNode, useId, useMemo, useRef, useState } from "react";
import {
  PreviewHostProvider,
  isProjectCollectionPreviewRequest,
  type PreviewRequest,
} from "@hey-hey/ui-common/context";
import { restoreModalWork } from "@hey-hey/ui-common/components/Modals";
import { OpenItemsPreviewInstance } from "./OpenItemsPreviewInstance";

const requestIdentity = (request: PreviewRequest) =>
  isProjectCollectionPreviewRequest(request)
    ? `collection:${request.collection}`
    : `entity:${request.entityType}:${request.entityId}`;

interface PreviewWork {
  id: string;
  request: PreviewRequest;
}

export const OpenItemsPreviewHost: React.FC<{
  children: ReactNode;
  organizationId: string;
  projectId: string | null;
}> = ({ children, organizationId, projectId }) => {
  const ownerId = useId();
  const sequence = useRef(0);
  const [work, setWork] = useState<PreviewWork[]>([]);
  const currentWork = useRef(work);
  currentWork.current = work;
  const host = useMemo(
    () => ({
      openPreview: (request: PreviewRequest) => {
        const existing = currentWork.current.find(
          (item) => requestIdentity(item.request) === requestIdentity(request),
        );
        if (existing) {
          restoreModalWork(existing.id);
          return;
        }
        currentWork.current = [
          ...currentWork.current,
          { id: `${ownerId}-${++sequence.current}`, request },
        ];
        setWork(currentWork.current);
      },
    }),
    [ownerId],
  );
  return (
    <PreviewHostProvider host={host}>
      {children}
      {work.map((item) => (
        <OpenItemsPreviewInstance
          key={item.id}
          organizationId={organizationId}
          projectId={projectId}
          previewTarget={item.request}
          ownerKey={item.id}
          closePreview={() => {
            currentWork.current = currentWork.current.filter(
              (entry) => entry.id !== item.id,
            );
            setWork(currentWork.current);
          }}
        />
      ))}
    </PreviewHostProvider>
  );
};
