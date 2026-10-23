/**
 * ADR Linked Document Form Component
 *
 * Renders inside LinkedDocumentCapsule when "Create Linked Document" action is expanded.
 * Allows creating a new document linked to the current ADR.
 */

import React from "react";
import { CreateDocumentForm } from "../DesignDoc/CreateDocumentForm";

export interface AdrLinkedDocumentFormProps {
  /** ADR ID for linking */
  adrId: string;
  /** Project ID */
  projectId: string;
  /** Organization ID */
  organizationId: string;
}

/**
 * Form component for creating documents linked to an ADR.
 * Used as the renderContent in LinkedDocumentCapsule CapsuleAction.
 */
export const AdrLinkedDocumentForm: React.FC<AdrLinkedDocumentFormProps> = ({
  adrId,
  projectId,
  organizationId,
}) => {
  const linkedDesignDoc = {
    type: "design-doc" as const,
    id: adrId,
  };

  return (
    <CreateDocumentForm
      projectId={projectId}
      organizationId={organizationId}
      linkedItemMode="design-doc"
      linkedItemValue={linkedDesignDoc}
      linkedItemReadOnly={true}
    />
  );
};
