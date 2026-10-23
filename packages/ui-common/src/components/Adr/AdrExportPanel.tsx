/**
 * AdrExportPanel - Handles exporting ADR content to various formats
 */

import React from "react";
import { useTranslation } from "react-i18next";
import type { MaterializedDesignDocSection } from "../../api";
import { DesignDocExportPanel } from "../DesignDoc/DesignDocExportPanel";

export interface AdrExportPanelProps {
  /** ADR title */
  title: string;
  /** ADR summary */
  summary?: string;
  /** ADR sections */
  sections: MaterializedDesignDocSection[];
}

/**
 * Panel for exporting ADR content
 * Automatically closes the capsule action after export
 */
export const AdrExportPanel: React.FC<AdrExportPanelProps> = ({
  title,
  summary,
  sections,
}) => {
  const { t } = useTranslation();

  return (
    <DesignDocExportPanel
      title={title}
      summary={summary}
      sections={sections}
      headerText={t("Export ADR")}
      descriptionText={t("Download this ADR as a markdown file")}
      buttonText={t("Download as Markdown")}
      sectionTitles={{
        context: "Context",
        decision: "Decision",
        consequences: "Consequences",
      }}
      fallbackFilename="adr"
    />
  );
};
