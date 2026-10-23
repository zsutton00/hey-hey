import EditIcon from "@mui/icons-material/Edit";
import type { Theme } from "@mui/material";
import { Box, Button, Stack, Typography, useTheme } from "@mui/material";
import React from "react";
import type { Components } from "react-markdown";
import { shouldShowDesignDocSection } from "../../utils/adrUtils";
import type { AlignmentCheckContentProps } from "../ActionsCapsule/Common/AlignmentCheckContent";
import {
  MarkdownRenderer,
  type MarkdownRendererProps,
} from "./MarkdownRenderer";
import { useReadViewMarkdownComponents } from "./readViewMarkdownComponents";

export interface DesignDocSection {
  key?: string;
  materializedMarkdown?: string;
}

export interface AdrReadViewProps {
  title?: string;
  summary?: string;
  sections?: DesignDocSection[];
  number?: number;
  status?: string;
  onEdit?: () => void;
  mentionConfig?: MarkdownRendererProps["mentionConfig"];
  alignmentCheck?: Omit<AlignmentCheckContentProps, "designDocIds"> & {
    designDocIds?: string[];
    designDocId?: string;
  };
}

const renderTextSection = (
  label: string,
  value: string | null | undefined,
  emptyLabel: string,
  MarkdownRenderer: React.ComponentType<MarkdownRendererProps>,
  markdownComponents: Components,
  theme: Theme,
  mentionConfig?: MarkdownRendererProps["mentionConfig"]
) => (
  <Box>
    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
      {label}
    </Typography>
    {value ? (
      <Typography
        component="div"
        sx={{
          color: theme.palette.text.primary,
          wordBreak: "break-word",
          whiteSpace: "normal",
        }}
      >
        <MarkdownRenderer
          components={markdownComponents}
          mentionConfig={mentionConfig}
        >
          {value}
        </MarkdownRenderer>
      </Typography>
    ) : (
      <Typography variant="body2" color="text.secondary" fontStyle="italic">
        {emptyLabel}
      </Typography>
    )}
  </Box>
);

export const DesignDocReadView: React.FC<AdrReadViewProps> = ({
  title,
  summary,
  sections,
  number,
  status,
  onEdit,
  mentionConfig,
}) => {
  const theme = useTheme();
  const markdownComponents = useReadViewMarkdownComponents();

  return (
    <Box sx={{ position: "relative" }} data-testid="design-doc-read-view">
      {onEdit && (
        <Button
          startIcon={<EditIcon />}
          onClick={onEdit}
          variant="outlined"
          size="small"
          sx={{
            position: "absolute",
            top: -20,
            right: 0,
          }}
        >
          Edit
        </Button>
      )}
      <Stack spacing={3}>
        {number && (
          <Box>
            <Typography variant="overline" color="text.secondary">
              ADR-{number.toString().padStart(3, "0")}
            </Typography>
          </Box>
        )}

        {renderTextSection(
          "Title",
          title,
          "Not provided",
          MarkdownRenderer,
          markdownComponents,
          theme,
          mentionConfig
        )}

        {renderTextSection(
          "Summary",
          summary,
          "Not provided",
          MarkdownRenderer,
          markdownComponents,
          theme,
          mentionConfig
        )}

        {sections && sections.length > 0 ? (
          <>
            {sections
              .filter(
                (s) =>
                  !status || shouldShowDesignDocSection(s.key ?? "", status)
              )
              .map((section, index) => (
                <Box key={section.key || index}>
                  {sections.length > 1 && (
                    <Typography
                      variant="subtitle1"
                      fontWeight={600}
                      gutterBottom
                    >
                      {section.key || `Section ${index + 1}`}
                    </Typography>
                  )}
                  {section.materializedMarkdown ? (
                    <Typography
                      component="div"
                      sx={{
                        color: theme.palette.text.primary,
                        wordBreak: "break-word",
                        whiteSpace: "normal",
                      }}
                    >
                      <MarkdownRenderer
                        components={markdownComponents}
                        mentionConfig={mentionConfig}
                      >
                        {section.materializedMarkdown}
                      </MarkdownRenderer>
                    </Typography>
                  ) : (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      fontStyle="italic"
                    >
                      Not provided
                    </Typography>
                  )}
                </Box>
              ))}
          </>
        ) : (
          <Box>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Sections
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              fontStyle="italic"
            >
              No sections added yet.
            </Typography>
          </Box>
        )}
      </Stack>
    </Box>
  );
};
