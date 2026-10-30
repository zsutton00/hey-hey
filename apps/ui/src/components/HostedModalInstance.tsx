import { HostedDiscussOwner } from "@hey-hey/ui-common/components/InteractionComponent";
import {
  ProjectContext,
  OrganizationScope,
  createProjectCollectionPreviewRequest,
  type PersistentModalRequest,
  useAuth,
} from "@hey-hey/ui-common/context";
import { createOpenItemEntity } from "@hey-hey/ui-common/context";
import { OpenItemsPreviewHost } from "./OpenItemsPreviewHost";
import { OpenItemsProvider } from "../contexts/OpenItemsContext";
import { useNavigate } from "react-router-dom";
import { OpenItemsTriageReview } from "./Explorer/HostedTriageOwner";
import { OpenItemsPreviewInstance } from "./OpenItemsPreviewInstance";

export function HostedModalInstance({
  request,
  instanceId,
  onClose,
}: {
  request: PersistentModalRequest;
  instanceId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organizationId, projectId } = request;
  return (
    <OrganizationScope organizationId={organizationId}>
      <ProjectContext.Provider value={{ organizationId, projectId, navigate }}>
        <OpenItemsProvider
          organizationId={organizationId}
          projectId={projectId}
          userId={user?.id ?? null}
        >
          <OpenItemsPreviewHost
            organizationId={organizationId}
            projectId={projectId}
          >
            {request.type === "discuss" ? (
              <HostedDiscussOwner request={request} onClose={onClose} />
            ) : request.type === "triage" ? (
              <OpenItemsTriageReview
                organizationId={organizationId}
                projectId={projectId}
                open
                onClosed={onClose}
                ownerKey={instanceId}
              />
            ) : (
              <OpenItemsPreviewInstance
                organizationId={organizationId}
                projectId={projectId}
                previewTarget={
                  "kind" in request.target
                    ? createProjectCollectionPreviewRequest(
                        request.target.collection,
                      )
                    : createOpenItemEntity(
                        request.target.entityType,
                        request.target.entityId,
                      )
                }
                ownerKey={instanceId}
                closePreview={onClose}
              />
            )}
          </OpenItemsPreviewHost>
        </OpenItemsProvider>
      </ProjectContext.Provider>
    </OrganizationScope>
  );
}
