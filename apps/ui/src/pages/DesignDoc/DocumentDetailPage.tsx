import React from "react";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { useParams } from "react-router-dom";
import { DocumentPage } from "./DocumentPage";

export const DocumentDetailPage: React.FC = () => {
  const { projectId = "", documentId = "" } = useParams<{
    projectId: string;
    documentId: string;
  }>();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  return (
    <DocumentPage
      organizationId={organizationId}
      projectId={projectId}
      documentId={documentId}
    />
  );
};
