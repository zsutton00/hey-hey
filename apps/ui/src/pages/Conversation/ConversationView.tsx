import React, { useCallback, useMemo, useState } from "react";
import { Alert, Box } from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  type CanonicalPageComposition,
  TrackingProvider,
} from "@hey-hey/ui-common/context";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { WebPathService } from "@hey-hey/ui-common/services";
import { ActiveConversation } from "../../components/Conversation/ActiveConversation";
import { DetailPageContainer } from "../../components/Layout";

type TrackingContextOverride = React.ComponentProps<
  typeof TrackingProvider
>["context"];

export interface ConversationViewProps {
  organizationId?: string | null;
  projectId?: string;
  conversationId?: string;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
  container?: (children: React.ReactNode) => React.ReactNode;
  onBack?: () => void;
  disableTracking?: boolean;
  trackingContextOverride?: TrackingContextOverride;
  canonicalPageComposition: CanonicalPageComposition;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  organizationId,
  projectId,
  conversationId,
  breadcrumbs,
  actions,
  container,
  onBack,
  disableTracking = false,
  trackingContextOverride,
  canonicalPageComposition,
}) => {
  const { currentOrgId } = useUserIdentity() || {};
  const navigate = useNavigate();
  const resolvedOrgId = organizationId ?? currentOrgId;
  const [presentationLabel, setPresentationLabel] = useState<string>();

  const resolvedCanonicalPageComposition = useMemo<CanonicalPageComposition>(
    () => {
      if (
        canonicalPageComposition.kind !== "canonical" ||
        canonicalPageComposition.descriptor.entityType !== "conversation" ||
        !presentationLabel
      ) {
        return canonicalPageComposition;
      }
      const { descriptor } = canonicalPageComposition;
      return {
        kind: "canonical",
        descriptor: createCanonicalPageDescriptor(
          "conversation",
          descriptor.entityId,
          descriptor.lineage,
          { kind: "conversation", label: presentationLabel },
        ),
      };
    }, [canonicalPageComposition, presentationLabel],
  );

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    if (projectId) {
      navigate(`/projects/${projectId}?tab=project&view=conversations`);
    } else {
      navigate(-1);
    }
  }, [navigate, onBack, projectId]);

  if (!resolvedOrgId || !projectId || !conversationId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Missing required route parameters. Please check the URL.
        </Alert>
      </Box>
    );
  }

  const content = (
    <ActiveConversation
      organizationId={resolvedOrgId}
      projectId={projectId}
      conversationId={conversationId}
      onBack={handleBack}
      onPresentationLoaded={setPresentationLabel}
    />
  );

  const wrappedContent = (
    <>
      {actions}
      {breadcrumbs}
      {container ? (
        container(content)
      ) : (
        <DetailPageContainer>{content}</DetailPageContainer>
      )}
    </>
  );

  const contentWithCanonicalBoundary = (
    <CanonicalPageBoundary composition={resolvedCanonicalPageComposition}>
      {wrappedContent}
    </CanonicalPageBoundary>
  );

  if (disableTracking) {
    return contentWithCanonicalBoundary;
  }

  return (
    <TrackingProvider
      context={{
        page: {
          name: "conversation",
          path: WebPathService.conversation({
            projectId: projectId!,
            conversationId: conversationId!,
          }),
          section: "conversation",
        },
        attentionEntity: {
          id: conversationId,
          type: "conversation",
          projectId,
        },
        ...trackingContextOverride,
      }}
    >
      {contentWithCanonicalBoundary}
    </TrackingProvider>
  );
};
