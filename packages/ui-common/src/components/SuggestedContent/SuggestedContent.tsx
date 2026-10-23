import LightbulbIcon from "@mui/icons-material/Lightbulb";
import type { SxProps, Theme } from "@mui/material";
import { Box, Button, ButtonGroup, Typography, useTheme } from "@mui/material";
import { useLocalStorage } from "@uidotdev/usehooks";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import type {
  AdrContentApplyPayload,
  AdrContentApplyPayloadAllOfSections,
  InitiativeContentApplyPayload,
  InitiativeContentApplyPayloadAllOfFields,
  SecondaryActionConfig,
  SecondaryActionPayload,
  TaskContentApplyPayload,
  TaskContentApplyPayloadAllOfFields,
} from "../../api";
import { isTaskContentApplyPayload } from "../../types/secondaryActions";
import {
  applyDiffOperations,
  calculateWordDiff,
  type DiffOperation,
} from "../../utils/textDiff";
import { DiffRenderer, type DiffOperationDecision } from "./DiffRenderer";
import type { SuggestionDecisionStatus } from "../Conversation/hooks/useSuggestionDecisions";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import type { SecondaryActionConfigWithHandler } from "../LlmForms";

/**
 * Union type for content items - supports both ADR sections and Initiative fields
 * Extended with optional oldValue for diff rendering
 */
export type ContentItem =
  | (AdrContentApplyPayloadAllOfSections & { oldValue?: string })
  | (InitiativeContentApplyPayloadAllOfFields & { oldValue?: string })
  | (TaskContentApplyPayloadAllOfFields & { oldValue?: string })
  | { key: string; content: string; oldValue?: string };

export interface SuggestedContentProps {
  /** Secondary action configuration containing sections/fields to display */
  secondaryAction?: SecondaryActionConfig | SecondaryActionConfigWithHandler;
  /** Optional header text (e.g., "Suggested Context") */
  title?: string;
  /** Optional icon to display in the header */
  icon?: React.ReactNode;
  /** Callback when user accepts the suggestion */
  onAccept?: (items: ContentItem[]) => void | Promise<boolean | void>;
  /** Callback when user rejects the suggestion */
  onReject?: () => void;
  /** Callback when user makes a decision (accept/reject) */
  onDecision?: (accepted: boolean) => void;
  /** Message ID to scope rejection state per message */
  messageId?: string;
  /** Optional function to get current content for diff rendering */
  getCurrentContent?: (key: string) => string;
  /** Whether to enable diff rendering (default: true) */
  enableDiff?: boolean;
  /** Default diff mode state (default: false) */
  defaultShowDiff?: boolean;
  /** Enable per-diff interactive accept/reject review mode */
  enableInteractiveDiffReview?: boolean;
  /** Current section being edited - hides updates for future sections */
  currentSection?: string;
  /** Decision state for this suggestion (accept/reject) */
  suggestionDecision?: SuggestionDecisionStatus;
  /** Additional styling */
  sx?: SxProps<Theme>;
}

/**
 * Section ordering for filtering updates
 * Maps section/field keys to their order, allowing us to hide updates for future sections
 */
const SECTION_ORDER: Record<string, number> = {
  // ADR sections
  context: 0,
  decision: 1,
  consequences: 2,
  // Task/Initiative fields
  description: 0,
  details: 1,
  acceptanceCriteria: 2,
};

type ItemOperationDecisions = Record<number, DiffOperationDecision>;
type DiffReviewDecisionMap = Record<string, ItemOperationDecisions>;

const isDiffReviewDecisionMap = (
  value: unknown
): value is DiffReviewDecisionMap => {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).every((itemDecisions) => {
    if (!itemDecisions || typeof itemDecisions !== "object") {
      return false;
    }

    return Object.values(itemDecisions).every(
      (decision) => decision === "accepted" || decision === "rejected"
    );
  });
};

/**
 * Type guard to check if payload is AdrContentApplyPayload
 */
const isAdrContentPayload = (
  payload: unknown
): payload is AdrContentApplyPayload => {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    "handlerType" in payload &&
    (payload as { handlerType: unknown }).handlerType === "adr_content_apply"
  );
};

/**
 * Type guard to check if payload is InitiativeContentApplyPayload
 */
const isInitiativeContentPayload = (
  payload: unknown
): payload is InitiativeContentApplyPayload => {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    "handlerType" in payload &&
    (payload as { handlerType: unknown }).handlerType ===
      "initiative_content_apply"
  );
};

/**
 * Type guard to check if payload is a content apply payload (ADR or Initiative)
 */
const isContentApplyPayload = (
  payload: unknown
): payload is
  | AdrContentApplyPayload
  | InitiativeContentApplyPayload
  | TaskContentApplyPayload => {
  return (
    isAdrContentPayload(payload as SecondaryActionPayload | null | undefined) ||
    isInitiativeContentPayload(
      payload as SecondaryActionPayload | null | undefined
    ) ||
    isTaskContentApplyPayload(payload)
  );
};

/**
 * SuggestedContent component displays AI-suggested content with markdown support.
 * Styled to differentiate from system messages with distinct background, border, and typography.
 * Supports both ADR sections and Initiative fields.
 * Supports inline Accept/Reject buttons when presentation mode is INLINE.
 * Supports optional diff rendering to highlight changes from current content.
 */
export const SuggestedContent: React.FC<SuggestedContentProps> = ({
  secondaryAction,
  title,
  icon,
  onAccept,
  onReject,
  onDecision,
  messageId,
  getCurrentContent,
  enableDiff = true,
  defaultShowDiff = false,
  enableInteractiveDiffReview = false,
  currentSection,
  suggestionDecision,
  sx = {},
}) => {
  const theme = useTheme();
  const [isDismissed, setIsDismissed] = useState(false);
  const [showDiff, setShowDiff] = useLocalStorage(
    "suggested-content-show-diff",
    defaultShowDiff
  );
  const [diffReviewDecisions, setDiffReviewDecisions] =
    useState<DiffReviewDecisionMap>({});

  // Create rejection key scoped by message ID and action ID
  const getRejectionKey = useCallback(() => {
    if (!secondaryAction?.id) return null;
    return messageId
      ? `suggested-content-rejected-${messageId}-${secondaryAction.id}`
      : `suggested-content-rejected-${secondaryAction.id}`;
  }, [messageId, secondaryAction?.id]);

  const getDiffReviewStorageKey = useCallback(() => {
    if (!secondaryAction?.id) {
      return null;
    }

    return `suggested-content-diff-review-${messageId ?? "no-message"}-${
      secondaryAction.id
    }`;
  }, [messageId, secondaryAction?.id]);

  // Check localStorage for rejection state on mount
  useEffect(() => {
    const rejectionKey = getRejectionKey();
    if (rejectionKey) {
      const wasRejected = localStorage.getItem(rejectionKey);
      if (wasRejected === "true") {
        // setIsDismissed(true);
      }
    }
  }, [getRejectionKey]);

  useEffect(() => {
    if (!enableInteractiveDiffReview) {
      setDiffReviewDecisions({});
      return;
    }

    const diffReviewStorageKey = getDiffReviewStorageKey();
    if (!diffReviewStorageKey) {
      setDiffReviewDecisions({});
      return;
    }

    const rawDecisions = localStorage.getItem(diffReviewStorageKey);
    if (!rawDecisions) {
      setDiffReviewDecisions({});
      return;
    }

    try {
      const parsed = JSON.parse(rawDecisions) as unknown;
      if (isDiffReviewDecisionMap(parsed)) {
        setDiffReviewDecisions(parsed);
        return;
      }
    } catch {
      // Fall through to clearing invalid storage below.
    }

    localStorage.removeItem(diffReviewStorageKey);
    setDiffReviewDecisions({});
  }, [enableInteractiveDiffReview, getDiffReviewStorageKey]);

  useEffect(() => {
    if (!enableInteractiveDiffReview) {
      return;
    }

    const diffReviewStorageKey = getDiffReviewStorageKey();
    if (!diffReviewStorageKey) {
      return;
    }

    if (Object.keys(diffReviewDecisions).length === 0) {
      localStorage.removeItem(diffReviewStorageKey);
      return;
    }

    localStorage.setItem(
      diffReviewStorageKey,
      JSON.stringify(diffReviewDecisions)
    );
  }, [
    diffReviewDecisions,
    enableInteractiveDiffReview,
    getDiffReviewStorageKey,
  ]);

  const markdownComponents = useMemo<Components>(
    () => ({
      a: ({
        node: _node,
        ...props
      }: { node?: unknown } & React.ComponentProps<"a">) => (
        <a
          {...props}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: theme.palette.primary.main,
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        />
      ),
      li: ({
        node: _node,
        children,
        ...props
      }: {
        node?: unknown;
        children?: React.ReactNode;
      } & React.ComponentProps<"li">) => {
        // For ordered lists, extract text content from any wrapping <p> tags
        const processedChildren = React.Children.map(children, (child) => {
          if (
            React.isValidElement(child) &&
            child.type === "p" &&
            typeof child.props === "object" &&
            child.props !== null &&
            "children" in child.props
          ) {
            return child.props.children;
          }
          return child;
        }) as React.ReactNode;
        return <li {...props}>{processedChildren}</li>;
      },
    }),
    [theme.palette.primary.main]
  );

  // Extract content items from payload - moved here to avoid conditional hook usage
  const payload = secondaryAction?.payload;
  const baseItems: ContentItem[] = useMemo(() => {
    if (!payload || !isContentApplyPayload(payload)) {
      return [];
    }

    if (isAdrContentPayload(payload)) {
      return payload.sections;
    }

    return payload.fields;
  }, [payload]);

  // Enhance items with oldValue if getCurrentContent is provided
  const items: ContentItem[] = useMemo(() => {
    if (!getCurrentContent) {
      return baseItems;
    }

    return baseItems.map((item) => ({
      ...item,
      oldValue: getCurrentContent(item.key),
    }));
  }, [baseItems, getCurrentContent]);

  // Filter items to hide updates for future sections
  const visibleItems: ContentItem[] = useMemo(() => {
    if (!currentSection) {
      // No filtering if currentSection not provided
      return items;
    }

    const currentOrder = SECTION_ORDER[currentSection];
    if (currentOrder === undefined) {
      // Unknown section, show all items
      return items;
    }

    return items.filter((item) => {
      const itemOrder = SECTION_ORDER[item.key];
      if (itemOrder === undefined) {
        // Unknown item, include it
        return true;
      }
      // Only show items at or before current section
      return itemOrder <= currentOrder;
    });
  }, [items, currentSection]);

  const getItemDecisionKey = useCallback(
    (item: ContentItem, itemIndex: number): string =>
      `${item.key}:${itemIndex}`,
    []
  );

  const getAcceptedOperationIndices = useCallback(
    (
      operations: DiffOperation[],
      itemDecisions: ItemOperationDecisions | undefined
    ): Set<number> => {
      const acceptedIndices = new Set<number>();

      operations.forEach((operation, operationIndex) => {
        if (operation.type === "equal") {
          return;
        }

        const decision = itemDecisions?.[operationIndex];
        if (decision !== "rejected") {
          acceptedIndices.add(operationIndex);
        }
      });

      return acceptedIndices;
    },
    []
  );

  const resolveReviewedItem = useCallback(
    (item: ContentItem, itemIndex: number): ContentItem => {
      if (!("oldValue" in item) || !item.oldValue) {
        return item;
      }

      const diffResult = calculateWordDiff(item.oldValue, item.content);
      if (!diffResult.hasChanges) {
        return item;
      }

      const itemDecisions =
        diffReviewDecisions[getItemDecisionKey(item, itemIndex)];
      const acceptedOperationIndices = getAcceptedOperationIndices(
        diffResult.operations,
        itemDecisions
      );

      return {
        ...item,
        content: applyDiffOperations(
          diffResult.operations,
          acceptedOperationIndices
        ),
      };
    },
    [diffReviewDecisions, getAcceptedOperationIndices, getItemDecisionKey]
  );

  const updateOperationDecision = useCallback(
    (
      item: ContentItem,
      itemIndex: number,
      operationIndex: number,
      decision: DiffOperationDecision
    ): void => {
      const itemDecisionKey = getItemDecisionKey(item, itemIndex);
      setDiffReviewDecisions((currentDecisions) => ({
        ...currentDecisions,
        [itemDecisionKey]: {
          ...(currentDecisions[itemDecisionKey] ?? {}),
          [operationIndex]: decision,
        },
      }));
    },
    [getItemDecisionKey]
  );

  const isAccepted = suggestionDecision?.accepted === true;
  const isRejected = suggestionDecision?.accepted === false;
  const hasDecision = isAccepted || isRejected;

  // Check if any items have oldValue for diff rendering
  const hasOldValues = visibleItems.some(
    (item) => "oldValue" in item && !!item.oldValue
  );
  const canShowDiff = enableDiff && hasOldValues && !hasDecision;
  const isInteractiveDiffReviewEnabled =
    enableInteractiveDiffReview && canShowDiff;
  const isDiffVisible =
    canShowDiff && (isInteractiveDiffReviewEnabled || showDiff);

  const defaultIcon = <LightbulbIcon sx={{ fontSize: "1.2rem" }} />;

  // Don't render if dismissed
  if (isDismissed) {
    return null;
  }

  // Don't render if no secondary action provided
  if (!secondaryAction) {
    return null;
  }

  // Don't render if payload is invalid
  if (!isContentApplyPayload(payload)) {
    console.warn(
      "SuggestedContent: payload is not a content apply payload",
      payload
    );
    return null;
  }

  const isInlinePresentation = secondaryAction.presentation === "INLINE";

  const handleAccept = async (): Promise<void> => {
    let appliedSuccessfully = true;
    const itemsToApply = isInteractiveDiffReviewEnabled
      ? visibleItems.map(resolveReviewedItem)
      : items;

    if (onAccept) {
      try {
        const result = await onAccept(itemsToApply);
        if (result === false) {
          appliedSuccessfully = false;
        }
      } catch (error) {
        console.error("SuggestedContent: failed to apply suggestion", error);
        appliedSuccessfully = false;
      }
    }

    if (!appliedSuccessfully) {
      return;
    }

    onDecision?.(true);
    // Dismiss after accepting
    if (!onDecision) {
      setIsDismissed(true);
    }
    const rejectionKey = getRejectionKey();
    if (rejectionKey) {
      localStorage.setItem(rejectionKey, "true");
    }
  };

  const handleReject = () => {
    onDecision?.(false);
    if (onReject) {
      onReject();
    }
    // Persist rejection to localStorage
    const rejectionKey = getRejectionKey();
    if (rejectionKey) {
      localStorage.setItem(rejectionKey, "true");
    }
    if (!onDecision) {
      setIsDismissed(true);
    }
  };

  return (
    <Box
      sx={{
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(99, 102, 241, 0.15)" // indigo with low opacity for dark mode
            : "rgba(238, 242, 255, 1)", // indigo.50 for light mode
        borderLeft: `4px solid ${theme.palette.secondary.main}`,
        borderRadius: 2,
        p: 2,
        boxShadow:
          theme.palette.mode === "dark"
            ? "0 2px 8px rgba(0, 0, 0, 0.3)"
            : "0 2px 8px rgba(0, 0, 0, 0.08)",
        ...sx,
      }}
      data-testid="suggested-content"
    >
      {/* Optional Title/Header */}
      {title && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1.5,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Box
              sx={{
                color: theme.palette.secondary.main,
                display: "flex",
                alignItems: "center",
              }}
            >
              {icon || defaultIcon}
            </Box>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                color: theme.palette.secondary.main,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                fontSize: "0.75rem",
              }}
            >
              {title}
            </Typography>
          </Box>

          {/* Diff Toggle Button */}
          {canShowDiff && !isInteractiveDiffReviewEnabled && (
            <Button
              size="small"
              onClick={() => setShowDiff(!showDiff)}
              sx={{
                color: showDiff
                  ? theme.palette.secondary.main
                  : theme.palette.text.secondary,
                textTransform: "none",
                fontSize: "0.75rem",
                minWidth: "auto",
                padding: "4px 8px",
                "&:hover": {
                  backgroundColor:
                    theme.palette.mode === "dark"
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(0, 0, 0, 0.04)",
                },
              }}
              data-testid="suggested-content-diff-toggle"
            >
              {showDiff ? "Hide changes" : "Show changes"}
            </Button>
          )}
        </Box>
      )}

      {/* Content Items (Sections for ADR, Fields for Initiative) */}
      {visibleItems.map((item: ContentItem, index: number) => {
        return (
          <Box
            key={`${item.key}-${index}`}
            sx={{ mb: index < visibleItems.length - 1 ? 2 : 0 }}
          >
            {/* Item Key as Heading */}
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 600,
                color: theme.palette.text.primary,
                mb: 1,
                textTransform: "capitalize",
              }}
            >
              {item.key}
            </Typography>

            {/* Item Content - Diff or Markdown */}
            {isDiffVisible && "oldValue" in item && item.oldValue ? (
              // Render diff view
              <DiffRenderer
                oldContent={item.oldValue}
                newContent={item.content}
                markdownComponents={markdownComponents}
                enableInteractiveReview={isInteractiveDiffReviewEnabled}
                showViewModeToggle={isInteractiveDiffReviewEnabled}
                operationDecisions={
                  diffReviewDecisions[getItemDecisionKey(item, index)]
                }
                onOperationDecisionChange={(operationIndex, decision) => {
                  updateOperationDecision(
                    item,
                    index,
                    operationIndex,
                    decision
                  );
                }}
                operationTestIdPrefix={`suggested-content-diff-operation-item-${index}`}
              />
            ) : (
              // Render normal markdown view
              <Typography
                component="div"
                className="suggested-content-markdown"
                sx={{
                  color: theme.palette.text.primary,
                  "& .suggested-content-markdown": {
                    width: "100%",
                    fontFamily: theme.typography.fontFamily,
                    fontSize: "0.95rem",
                    lineHeight: 1.6,
                    fontWeight: 400,
                    wordBreak: "break-word",
                    whiteSpace: "normal",
                    "& p": {
                      margin: "8px 0",
                      "&:first-of-type": {
                        marginTop: 0,
                      },
                      "&:last-of-type": {
                        marginBottom: 0,
                      },
                    },
                    "& ul, & ol": {
                      paddingLeft: 3,
                      marginTop: 0.5,
                      marginBottom: 0.5,
                    },
                    "& li": {
                      marginBottom: 0.5,
                    },
                    "& pre": {
                      backgroundColor:
                        theme.palette.mode === "dark"
                          ? theme.palette.grey[900]
                          : theme.palette.grey[100],
                      borderRadius: 1,
                      padding: 1,
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                    },
                    "& code": {
                      backgroundColor:
                        theme.palette.mode === "dark"
                          ? "rgba(255, 255, 255, 0.06)"
                          : "rgba(0, 0, 0, 0.06)",
                      borderRadius: "4px",
                      padding: "2px 6px",
                      fontSize: "0.9em",
                      fontFamily: "monospace",
                    },
                    "& blockquote": {
                      borderLeft: `3px solid ${theme.palette.secondary.main}`,
                      paddingLeft: 2,
                      my: 1,
                      color: theme.palette.text.secondary,
                    },
                    "& h1, & h2, & h3, & h4, & h5, & h6": {
                      fontWeight: 600,
                      marginTop: 1.5,
                      marginBottom: 1,
                    },
                  },
                }}
              >
                <MarkdownRenderer components={markdownComponents}>
                  {item.content}
                </MarkdownRenderer>
              </Typography>
            )}
          </Box>
        );
      })}

      {/* Bottom Diff Toggle Button */}
      {canShowDiff && !isInteractiveDiffReviewEnabled && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            mt: 2,
          }}
        >
          <Button
            size="small"
            onClick={() => setShowDiff(!showDiff)}
            sx={{
              color: showDiff
                ? theme.palette.secondary.main
                : theme.palette.text.secondary,
              textTransform: "none",
              fontSize: "0.75rem",
              minWidth: "auto",
              padding: "4px 8px",
              "&:hover": {
                backgroundColor:
                  theme.palette.mode === "dark"
                    ? "rgba(255, 255, 255, 0.08)"
                    : "rgba(0, 0, 0, 0.04)",
              },
            }}
            data-testid="suggested-content-diff-toggle-bottom"
          >
            {showDiff ? "Hide changes" : "Show changes"}
          </Button>
        </Box>
      )}

      {/* Inline Accept/Reject Buttons */}
      {isInlinePresentation && (
        <Box sx={{ mt: 2 }}>
          {hasDecision ? (
            <Typography
              variant="caption"
              sx={{
                color: isAccepted
                  ? theme.palette.success.main
                  : theme.palette.text.secondary,
                fontWeight: 600,
                letterSpacing: "0.4px",
                textTransform: "uppercase",
              }}
              data-testid="suggested-content-decision"
            >
              {isAccepted ? "Accepted" : "Rejected"}
            </Typography>
          ) : (
            <ButtonGroup fullWidth variant="outlined" size="medium">
              <Button
                onClick={handleAccept}
                sx={{
                  backgroundColor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  "&:hover": {
                    backgroundColor: theme.palette.primary.dark,
                  },
                }}
                data-testid="suggested-content-accept-button"
              >
                Accept
              </Button>
              <Button
                onClick={handleReject}
                variant="outlined"
                sx={{
                  color: theme.palette.text.primary,
                  borderColor: theme.palette.divider,
                  "&:hover": {
                    backgroundColor:
                      theme.palette.mode === "dark" ? "grey.800" : "grey.100",
                  },
                }}
                data-testid="suggested-content-reject-button"
              >
                Reject
              </Button>
            </ButtonGroup>
          )}
        </Box>
      )}
    </Box>
  );
};
