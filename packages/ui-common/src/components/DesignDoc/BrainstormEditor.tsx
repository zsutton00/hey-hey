import React from "react";
import { useTranslation } from "react-i18next";
import type { MaterializedDesignDocSection } from "../../api";
import { DesignDocSingleSectionEditor } from "./DesignDocSingleSectionEditor";

export interface BrainstormEditorProps {
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

export const BrainstormEditor: React.FC<BrainstormEditorProps> = ({
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
      templateLabel={t("Brainstorm")}
      titlePlaceholder={t("Enter Brainstorm title...")}
      summaryPlaceholder={t("Enter a brief summary of this brainstorm...")}
      contentPlaceholder={t(
        "Capture ideas, options, and open questions for this brainstorm..."
      )}
      exportHeaderText={t("Export Brainstorm")}
      exportDescriptionText={t("Download this Brainstorm as a markdown file")}
      exportButtonText={t("Download as Markdown")}
      exportFallbackFilename="brainstorm"
    />
  );
};
