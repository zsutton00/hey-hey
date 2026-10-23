import { Box, Paper, useTheme } from "@mui/material";
import React from "react";
import { MarkdownLexicalEditor } from "../LexicalEditor/MarkdownLexicalEditor";
import type {
  MarkdownLexicalEditorEntitySlashConfig,
  MarkdownLexicalEditorMentionConfig,
} from "../LexicalEditor/MarkdownLexicalEditor";

export interface DesignDocSingleSectionEditorContentProps {
  content: string;
  onContentChange: (content: string) => void;
  disabled?: boolean;
  placeholder: string;
  isLoading?: boolean;
  mentionConfig?: MarkdownLexicalEditorMentionConfig;
  entitySlashConfig?: MarkdownLexicalEditorEntitySlashConfig;
}

export const DesignDocSingleSectionEditorContent: React.FC<
  DesignDocSingleSectionEditorContentProps
> = ({
  content,
  onContentChange,
  disabled = false,
  placeholder,
  isLoading = false,
  mentionConfig,
  entitySlashConfig,
}) => {
  const theme = useTheme();

  return (
    <Box
      data-testid="design-doc-single-section-editor-content"
      sx={{
        flex: "0 0 60%",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        gap: 2,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          backgroundColor: theme.palette.background.paper,
          overflow: "hidden",
        }}
      >
        <Box className="section-editor" data-section-id="content">
          <Box
            sx={{
              "& .MuiPaper-root": {
                border: "none !important",
                borderRadius: "0 !important",
                boxShadow: "none !important",
                backgroundColor: `${theme.palette.background.paper} !important`,
                minHeight: "60px",
              },
              "& [data-lexical-editor]": {
                padding: "0 14px 16px 14px !important",
                minHeight: "60px",
                fontSize: "14px",
                lineHeight: "1.4375em",
                outline: "none !important",
              },
              "& .lexical-placeholder": {
                padding: "0 14px !important",
                color: theme.palette.text.secondary,
                fontSize: "14px",
              },
            }}
          >
            <MarkdownLexicalEditor
              value={content}
              onTextChange={onContentChange}
              disabled={disabled}
              placeholder={placeholder}
              isLoading={isLoading}
              mentionConfig={mentionConfig}
              entitySlashConfig={entitySlashConfig}
            />
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};
