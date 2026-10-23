import {
  PreviewHostProvider,
  isProjectCollectionPreviewRequest,
  type PreviewRequest,
} from "@hey-hey/ui-common/context";
import { EntityType } from "@hey-hey/ui-common/api";
import {
  entityNameKey,
  useEntityNames,
  useWorkItem,
} from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";
import React, { type ReactNode, useMemo, useState } from "react";
import { CanonicalEntityPreview } from "./CanonicalEntityPreview";
import { CanonicalCollectionPreview } from "./CanonicalCollectionPreview";
import { PreviewModal } from "./PreviewModal";
import { PreviewPresentationProvider } from "../contexts/PreviewPresentationContext";

const previewOpenHref = (
  request: PreviewRequest | null,
  projectId: string | null,
): string | undefined => {
  if (request === null || projectId === null) {
    return undefined;
  }
  if (isProjectCollectionPreviewRequest(request)) {
    return undefined;
  }

  const { entityId } = request;
  switch (request.entityType) {
    case "initiative":
      return WebPathService.initiativeDetail({
        projectId,
        initiativeId: entityId,
      });
    case "task":
      return WebPathService.task({ projectId, taskId: entityId });
    case "goal":
      return WebPathService.goal({ projectId, taskId: entityId });
    case "conversation":
      return WebPathService.conversation({
        projectId,
        conversationId: entityId,
      });
    case "design_doc":
      return WebPathService.designDoc({ projectId, designDocId: entityId });
    case "agent_session":
      return WebPathService.agentSession({
        projectId,
        agentSessionId: entityId,
      });
    case "plan":
      return WebPathService.plan({ projectId, planId: entityId });
    case "proposal":
      return WebPathService.proposal({ projectId, proposalId: entityId });
  }
};

/** Tasks and goals take their title from the work item; plans have no title lookup, so their header link falls back to "Open". */
const previewNameLookupType = (
  request: PreviewRequest | null,
): EntityType | undefined => {
  if (request === null || isProjectCollectionPreviewRequest(request)) {
    return undefined;
  }
  switch (request.entityType) {
    case "initiative":
      return EntityType.Initiative;
    case "conversation":
      return EntityType.Conversation;
    case "design_doc":
      return EntityType.DesignDoc;
    case "agent_session":
      return EntityType.AgentSession;
    case "proposal":
      return EntityType.Proposal;
    case "task":
    case "goal":
    case "plan":
      return undefined;
  }
};

export const OpenItemsPreviewHost: React.FC<{
  children: ReactNode;
  organizationId: string;
  projectId: string | null;
}> = ({ children, organizationId, projectId }) => {
  const [previewTarget, setPreviewTarget] = useState<PreviewRequest | null>(
    null,
  );
  const host = useMemo(() => ({ openPreview: setPreviewTarget }), []);
  const closePreview = () => setPreviewTarget(null);

  const nameLookupType = previewNameLookupType(previewTarget);
  const nameLookups = useMemo(
    () =>
      previewTarget !== null &&
      !isProjectCollectionPreviewRequest(previewTarget) &&
      nameLookupType !== undefined
        ? [{ entityId: previewTarget.entityId, entityType: nameLookupType }]
        : [],
    [previewTarget, nameLookupType],
  );
  const { names } = useEntityNames({ organizationId, entities: nameLookups });
  const workItemId =
    previewTarget !== null &&
    !isProjectCollectionPreviewRequest(previewTarget) &&
    (previewTarget.entityType === "task" || previewTarget.entityType === "goal")
      ? previewTarget.entityId
      : "";
  const { workItem } = useWorkItem(organizationId, "task", workItemId, {
    projectId: projectId ?? undefined,
    enabled: workItemId !== "" && projectId !== null,
  });
  const openTitle =
    (nameLookups[0]
      ? names.get(
          entityNameKey(nameLookups[0].entityId, nameLookups[0].entityType),
        )
      : undefined) ?? (workItemId !== "" ? workItem?.name : undefined);

  return (
    <PreviewHostProvider host={host}>
      {children}
      <PreviewModal
        open={previewTarget !== null}
        onClose={closePreview}
        openHref={previewOpenHref(previewTarget, projectId)}
        openTitle={openTitle}
      >
        {previewTarget && projectId ? (
          <PreviewPresentationProvider>
            {isProjectCollectionPreviewRequest(previewTarget) ? (
              <CanonicalCollectionPreview
                collection={previewTarget.collection}
                organizationId={organizationId}
                projectId={projectId}
              />
            ) : (
              <CanonicalEntityPreview
                entity={previewTarget}
                organizationId={organizationId}
                projectId={projectId}
                onRequestClose={closePreview}
              />
            )}
          </PreviewPresentationProvider>
        ) : null}
      </PreviewModal>
    </PreviewHostProvider>
  );
};
