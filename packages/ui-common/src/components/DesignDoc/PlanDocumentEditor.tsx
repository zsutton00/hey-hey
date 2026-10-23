import React from "react";
import { useTranslation } from "react-i18next";
import type { MaterializedDesignDocSection } from "../../api";
import { DesignDocSingleSectionEditor } from "./DesignDocSingleSectionEditor";

export interface PlanDocumentEditorProps {
  designDocId: string;
  organizationId: string;
  projectId: string;
  title?: string;
  summary?: string;
  sections: MaterializedDesignDocSection[];
  disabled?: boolean;
  status?: string;
  onDone?: (designDocId: string) => void;
}

export const PlanDocumentEditor: React.FC<PlanDocumentEditorProps> = ({
  designDocId,
  organizationId,
  projectId,
  title,
  summary,
  sections,
  disabled = false,
  status,
  onDone,
}) => {
  const { t } = useTranslation();

  return (
    <DesignDocSingleSectionEditor
      designDocId={designDocId}
      organizationId={organizationId}
      projectId={projectId}
      title={title}
      summary={summary}
      sections={sections}
      disabled={disabled}
      status={status}
      onDone={onDone}
      templateLabel={t("Plan Document")}
      titlePlaceholder={t("Enter Plan Document title...")}
      summaryPlaceholder={t("Enter a brief summary of this plan document...")}
      contentPlaceholder={t(
        "Capture the implementation plan details, sequencing, and rationale..."
      )}
      exportHeaderText={t("Export Plan Document")}
      exportDescriptionText={t(
        "Download this Plan Document as a markdown file"
      )}
      exportButtonText={t("Download as Markdown")}
      exportFallbackFilename="plan-document"
    />
  );
};
