import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Typography,
  useTheme,
} from "@mui/material";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdrReveal } from "../../data/hooks/useAdrReveal";
import type { AdrContent, AdrLevelType, AdrStatus } from "../../types/adr";
import { isProcessingStatus } from "../../utils/adrUtils";
import { MarkdownLexicalEditor } from "../LexicalEditor/MarkdownLexicalEditor";
import { RevealSectionButton } from "../CollaborativeLexicalEditor/RevealSectionButton";
import {
  buildConsequencesSectionConfig,
  buildContextSectionConfig,
  buildDecisionSectionConfig,
  getCurrentLevelFromStatus,
} from "./adrTemplate";

export interface AdrEditorContentEditorProps {
  adrId: string;
  organizationId: string;
  projectId: string;
  disabled?: boolean;
  conversationId?: string;
  status: AdrStatus;
  content: AdrContent;
  onContentChange: (content: AdrContent) => void;
}

const shouldShowSkeleton = (showAsSkeleton?: boolean): boolean =>
  Boolean(showAsSkeleton);

export const AdrEditorContentEditor: React.FC<AdrEditorContentEditorProps> = ({
  adrId,
  organizationId,
  projectId,
  disabled = false,
  conversationId,
  status,
  content,
  onContentChange,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isEditorProcessing = isProcessingStatus(status ?? "");

  const [currentLevel, setCurrentLevel] = useState<AdrLevelType>("context");
  const [contentLoaded, setContentLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    isRevealingDecision,
    isRevealingConsequences,
    handleRevealDecision,
    handleRevealConsequences,
  } = useAdrReveal({
    organizationId,
    projectId,
    adrId,
    conversationId,
    currentLevel,
    onLevelChange: setCurrentLevel,
    onError: setError,
  });

  const revealHandlers = useMemo(
    () => ({
      handleRevealDecision,
      handleRevealConsequences,
      isRevealingDecision,
      isRevealingConsequences,
    }),
    [
      handleRevealConsequences,
      handleRevealDecision,
      isRevealingConsequences,
      isRevealingDecision,
    ]
  );

  useEffect(() => {
    if (status) {
      const levelFromStatus = getCurrentLevelFromStatus(status);
      setCurrentLevel(levelFromStatus);
    }
  }, [status]);

  useEffect(() => {
    setContentLoaded(true);
  }, []);

  const getPlaceholderForSection = useCallback(
    (level: AdrLevelType | "summary" | "title"): string => {
      switch (level) {
        case "title":
          return t("Enter ADR title...");
        case "summary":
          return t("Enter a brief summary of this ADR...");
        case "context":
          return t("Enter the context and background for this decision...");
        case "decision":
          return t("Describe the decision that was made...");
        case "consequences":
          return t(
            "Document the consequences and implications of this decision..."
          );
        default:
          return t("Enter ADR content...");
      }
    },
    [t]
  );

  const contextPlaceholder = useMemo(
    () => getPlaceholderForSection("context"),
    [getPlaceholderForSection]
  );

  const decisionPlaceholder = useMemo(
    () => getPlaceholderForSection("decision"),
    [getPlaceholderForSection]
  );

  const consequencesPlaceholder = useMemo(
    () => getPlaceholderForSection("consequences"),
    [getPlaceholderForSection]
  );

  const contextSectionConfig = useMemo(() => buildContextSectionConfig(), []);

  const decisionSectionConfig = useMemo(
    () =>
      buildDecisionSectionConfig({
        currentLevel,
        revealHandlers,
        status,
      }),
    [currentLevel, revealHandlers, status]
  );

  const consequencesSectionConfig = useMemo(
    () =>
      buildConsequencesSectionConfig({
        currentLevel,
        revealHandlers,
        status,
      }),
    [currentLevel, revealHandlers, status]
  );

  const sectionsToRender = [
    {
      id: "context" as const,
      sectionConfig: contextSectionConfig,
      markdown: content.context || "",
      placeholder: contextPlaceholder,
    },
    {
      id: "decision" as const,
      sectionConfig: decisionSectionConfig,
      markdown: content.decision || "",
      placeholder: decisionPlaceholder,
    },
    {
      id: "consequences" as const,
      sectionConfig: consequencesSectionConfig,
      markdown: content.consequences || "",
      placeholder: consequencesPlaceholder,
    },
  ];

  const handleSectionChange = useCallback(
    (sectionId: "context" | "decision" | "consequences", markdown: string) => {
      if (sectionId === "context") {
        onContentChange({ ...content, context: markdown });
        return;
      }
      if (sectionId === "decision") {
        onContentChange({ ...content, decision: markdown });
        return;
      }
      onContentChange({ ...content, consequences: markdown });
    },
    [content, onContentChange]
  );

  return (
    <Box
      data-testid="adr-editor-content-root"
      sx={{
        flex: "0 0 60%",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        gap: 2,
        opacity: contentLoaded ? 1 : 0,
        transition: "opacity 0.3s ease-in",
      }}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Box sx={{ position: "relative" }}>
        <Paper
          elevation={0}
          sx={{
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            backgroundColor: theme.palette.background.paper,
            overflow: "hidden",
            opacity: isEditorProcessing ? 0.5 : 1,
            pointerEvents: isEditorProcessing ? "none" : "auto",
            transition: "opacity 0.3s ease-in-out",
            "& .section-editor:first-of-type h2": {
              paddingTop: "20px",
            },
            "& .section-editor:last-of-type": {
              paddingBottom: "4px",
            },
          }}
        >
          {sectionsToRender.map((section, index) => {
            const showSectionSkeleton = shouldShowSkeleton(
              section.sectionConfig.content.showAsSkeleton
            );
            const showDivider = index < sectionsToRender.length - 1;

            return (
              <React.Fragment key={section.id}>
                <Box className="section-editor" data-section-id={section.id}>
                  <Typography
                    variant="h6"
                    component="h2"
                    sx={{
                      margin: "0 0 8px 0",
                      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
                      fontWeight: "500",
                      lineHeight: "1.2",
                      color: "inherit",
                      fontSize: "1.5rem",
                      padding: "16px 14px 8px 14px",
                      backgroundColor: theme.palette.background.paper,
                      borderBottom: "none",
                    }}
                  >
                    {section.sectionConfig.header.text}
                  </Typography>

                  {showSectionSkeleton ? (
                    <Box
                      sx={{
                        margin: "0",
                        padding: "0 14px 16px 14px",
                        minHeight: "60px",
                      }}
                    >
                      {Array.from({
                        length:
                          section.sectionConfig.content.skeletonConfig?.lines ||
                          3,
                      }).map((_, skeletonIndex) => (
                        <Box
                          key={`${section.id}-skeleton-${skeletonIndex}`}
                          sx={{
                            width:
                              skeletonIndex ===
                                (section.sectionConfig.content.skeletonConfig
                                  ?.lines || 3) -
                                  1 &&
                              section.sectionConfig.content.skeletonConfig
                                ?.width === "partial"
                                ? "60%"
                                : "100%",
                            height: "16px",
                            backgroundColor: "currentcolor",
                            opacity: 0.1,
                            borderRadius: "8px",
                            marginBottom:
                              skeletonIndex ===
                              (section.sectionConfig.content.skeletonConfig
                                ?.lines || 3) -
                                1
                                ? "0px"
                                : "8px",
                            marginTop: "0px",
                          }}
                        />
                      ))}
                      {section.sectionConfig.content.skeletonConfig
                        ?.buttonText &&
                        section.sectionConfig.content.skeletonConfig
                          ?.onReveal && (
                          <RevealSectionButton
                            buttonText={
                              section.sectionConfig.content.skeletonConfig
                                .buttonText
                            }
                            onReveal={
                              section.sectionConfig.content.skeletonConfig
                                .onReveal
                            }
                            isLoading={
                              section.sectionConfig.content.skeletonConfig
                                .isLoading
                            }
                            disabled={
                              disabled ||
                              !conversationId ||
                              section.sectionConfig.content.skeletonConfig
                                .disabled
                            }
                          />
                        )}
                    </Box>
                  ) : (
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
                        value={section.markdown}
                        onTextChange={(value) =>
                          handleSectionChange(section.id, value)
                        }
                        disabled={disabled || isEditorProcessing}
                        placeholder={section.placeholder}
                        isLoading={!contentLoaded}
                        mentionConfig={{
                          organizationId,
                          projectId,
                        }}
                      />
                    </Box>
                  )}
                </Box>

                {showDivider && (
                  <Box
                    sx={{
                      height: "1px",
                      backgroundColor: theme.palette.divider,
                      opacity: 0.3,
                      margin: "0 14px",
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </Paper>

        {isEditorProcessing && (
          <Box
            sx={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 2,
            }}
          >
            <CircularProgress size={32} />
          </Box>
        )}
      </Box>
    </Box>
  );
};
