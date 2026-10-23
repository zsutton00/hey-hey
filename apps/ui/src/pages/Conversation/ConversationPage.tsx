import React from "react";
import { useParams } from "react-router-dom";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { createCanonicalPageDescriptor } from "@hey-hey/ui-common/context";
import { ConversationView } from "./ConversationView";

export const ConversationPage: React.FC = () => {
  const { projectId, conversationId } = useParams<{
    projectId: string;
    conversationId: string;
  }>();
  const organizationId = useUserIdentity()?.currentOrgId;

  return (
    <ConversationView
      organizationId={organizationId}
      projectId={projectId}
      conversationId={conversationId}
      canonicalPageComposition={
        conversationId
          ? {
              kind: "canonical",
              descriptor: createCanonicalPageDescriptor(
                "conversation",
                conversationId,
                null,
              ),
            }
          : { kind: "observational" }
      }
    />
  );
};
