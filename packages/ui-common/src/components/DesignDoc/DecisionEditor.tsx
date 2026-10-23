import React from "react";
import { useTranslation } from "react-i18next";
import type { MaterializedDesignDocSection } from "../../api";
import { DesignDocSingleSectionEditor } from "./DesignDocSingleSectionEditor";

export interface DecisionEditorProps {
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

export const DecisionEditor: React.FC<DecisionEditorProps> = ({
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
      templateLabel={t("Decision")}
      titlePlaceholder={t("Enter Decision title...")}
      summaryPlaceholder={t("Enter a brief summary of this decision...")}
      contentPlaceholder={t(
        "Document the decision, rationale, and next steps..."
      )}
      exportHeaderText={t("Export Decision")}
      exportDescriptionText={t("Download this Decision as a markdown file")}
      exportButtonText={t("Download as Markdown")}
      exportFallbackFilename="decision"
    />
  );
};
