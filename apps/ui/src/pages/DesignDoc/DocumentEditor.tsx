import type { DesignDocResponseDto, AdrStatus } from "@hey-hey/ui-common/api";
import {
  AdrStatus as AdrStatusValues,
  DesignDocTemplate,
} from "@hey-hey/ui-common/api";
import {
  AdrEditor,
  BrainstormEditor,
  DecisionEditor,
  PlanDocumentEditor,
} from "@hey-hey/ui-common/components";
import React from "react";

const VALID_ADR_STATUSES = new Set<string>(Object.values(AdrStatusValues));

function isAdrStatus(value: string): value is AdrStatus {
  return VALID_ADR_STATUSES.has(value);
}

function toAdrStatus(value: string, fallback: AdrStatus): AdrStatus {
  return isAdrStatus(value) ? value : fallback;
}

export const DocumentEditor: React.FC<{
  documentData: DesignDocResponseDto;
  currentOrgId: string;
  projectId: string;
  planId?: string;
  status?: AdrStatus | string;
  onDone?: (designDocId: string) => void;
}> = ({ documentData, currentOrgId, projectId, status, onDone }) => {
  const sections = documentData.sections ?? [];

  if (documentData.template === DesignDocTemplate.Adr) {
    const resolvedStatus = status ?? documentData.status;
    return (
      <AdrEditor
        adrId={documentData.id}
        organizationId={currentOrgId}
        projectId={projectId}
        title={documentData.name || "Untitled ADR"}
        status={toAdrStatus(resolvedStatus, AdrStatusValues.AdrContext)}
        summary={documentData.summary}
        sections={sections}
        onDone={onDone}
      />
    );
  }

  if (documentData.template === DesignDocTemplate.Brainstorm) {
    return (
      <BrainstormEditor
        designDocId={documentData.id}
        organizationId={currentOrgId}
        projectId={projectId}
        title={documentData.name || "Untitled"}
        summary={documentData.summary}
        sections={sections}
        status={status}
        onDone={onDone}
      />
    );
  }

  if (documentData.template === DesignDocTemplate.Decision) {
    return (
      <DecisionEditor
        designDocId={documentData.id}
        organizationId={currentOrgId}
        projectId={projectId}
        title={documentData.name || "Untitled"}
        summary={documentData.summary}
        sections={sections}
        status={status}
        onDone={onDone}
      />
    );
  }

  if (documentData.template === DesignDocTemplate.PlanDocument) {
    return (
      <PlanDocumentEditor
        designDocId={documentData.id}
        organizationId={currentOrgId}
        projectId={projectId}
        title={documentData.name || "Untitled"}
        summary={documentData.summary}
        sections={sections}
        status={status}
        onDone={onDone}
      />
    );
  }

  return <></>;
};
