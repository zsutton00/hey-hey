import MarkdownIcon from "@mui/icons-material/Article";
import { Box, Button, Typography } from "@mui/material";
import React, { useCallback } from "react";
import type { MaterializedDesignDocSection } from "../../api";
import { useActionsCapsule } from "../ActionsCapsule";

export interface DesignDocExportPanelProps {
  title: string;
  summary?: string;
  sections: MaterializedDesignDocSection[];
  headerText: string;
  descriptionText: string;
  buttonText: string;
  sectionTitles?: Record<string, string>;
  fallbackFilename?: string;
  showSectionHeadings?: boolean;
}

/**
 * Panel for exporting design doc content
 * Automatically closes the capsule action after export
 */
export const DesignDocExportPanel: React.FC<DesignDocExportPanelProps> = ({
  title,
  summary,
  sections,
  headerText,
  descriptionText,
  buttonText,
  sectionTitles = {},
  fallbackFilename = "design-doc",
  showSectionHeadings = true,
}) => {
  const { collapseAction } = useActionsCapsule();

  const handleExportMarkdown = useCallback(() => {
    const parts: string[] = [];

    parts.push(`# ${title || "Untitled Document"}\n`);

    if (summary) {
      parts.push(`## Summary\n\n${summary}\n`);
    }

    sections.forEach((section) => {
      const sectionTitle = sectionTitles[section.key] || section.key;
      if (showSectionHeadings) {
        parts.push(
          `## ${sectionTitle}\n\n${section.materializedMarkdown || ""}\n`
        );
        return;
      }

      parts.push(`${section.materializedMarkdown || ""}\n`);
    });

    const markdownContent = parts.join("\n");

    const blob = new Blob([markdownContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title || fallbackFilename}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setTimeout(() => {
      collapseAction();
    }, 300);
  }, [
    title,
    summary,
    sections,
    sectionTitles,
    fallbackFilename,
    showSectionHeadings,
    collapseAction,
  ]);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        {headerText}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {descriptionText}
      </Typography>
      <Button
        variant="contained"
        startIcon={<MarkdownIcon />}
        onClick={handleExportMarkdown}
        fullWidth
      >
        {buttonText}
      </Button>
    </Box>
  );
};
