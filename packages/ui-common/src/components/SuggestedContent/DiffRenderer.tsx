import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  ButtonGroup,
  IconButton,
  type Theme,
  Typography,
  useTheme,
} from "@mui/material";
import { type Change, diffLines } from "diff";
import React, { useCallback, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import {
  type InlineNode,
  parseInlineMarkdown,
} from "../../utils/inlineMarkdown";
import { diffWordsWithSpaceInlineAware } from "../../utils/inlineTokenDiff";
import { calculateWordDiff } from "../../utils/textDiff";
import type { DiffOperation } from "../../utils/textDiff";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { renderMentionNode } from "../shared/WorkflowMentionInlineRenderer";

export type DiffOperationDecision = "accepted" | "rejected";
export type DiffViewMode = "inline" | "split" | "split-code";

interface DiffRendererBaseProps {
  /** Original/current content */
  oldContent: string;
  /** New/suggested content */
  newContent: string;
  /** Optional custom markdown components */
  markdownComponents?: Components;
  /** Enable per-operation accept/reject controls */
  enableInteractiveReview?: boolean;
  /** Decisions for diff operation indices */
  operationDecisions?: Record<number, DiffOperationDecision>;
  /** Callback when a decision is updated */
  onOperationDecisionChange?: (
    operationIndex: number,
    decision: DiffOperationDecision,
  ) => void;
  /** Optional test id prefix for operation controls */
  operationTestIdPrefix?: string;
  /** Optional language hint for split-code mode */
  codeLanguage?: string;
  /** Whether to render the internal inline/split mode toggle */
  showViewModeToggle?: boolean;
  /** Structured content that must retain its domain-specific presentation. */
  contentRenderers?: {
    inline: React.ReactNode;
    split: {
      old: React.ReactNode;
      new: React.ReactNode;
    };
  };
}

interface ControlledDiffViewModeProps {
  viewMode: DiffViewMode;
  onViewModeChange?: (mode: DiffViewMode) => void;
  defaultViewMode?: never;
}

interface UncontrolledDiffViewModeProps {
  viewMode?: undefined;
  onViewModeChange?: (mode: DiffViewMode) => void;
  defaultViewMode?: DiffViewMode;
}

type DiffRendererViewModeProps =
  ControlledDiffViewModeProps | UncontrolledDiffViewModeProps;

export type DiffRendererProps = DiffRendererBaseProps &
  DiffRendererViewModeProps;

type DiffPane = "old" | "new";
type MentionDiffTone = "equal" | "insert" | "delete";

const DEFAULT_VIEW_MODE: DiffViewMode = "inline";
const VIEW_MODE_TOGGLE_TEST_ID = "diff-renderer-view-mode-toggle";
const VIEW_MODE_INLINE_BUTTON_TEST_ID = "diff-renderer-view-mode-inline";
const VIEW_MODE_SPLIT_BUTTON_TEST_ID = "diff-renderer-view-mode-split";
const INLINE_VIEW_TEST_ID = "diff-renderer-inline-view";
const SPLIT_VIEW_TEST_ID = "diff-renderer-split-view";
const SPLIT_OLD_PANE_TEST_ID = "diff-renderer-split-pane-old";
const SPLIT_NEW_PANE_TEST_ID = "diff-renderer-split-pane-new";
const SPLIT_CODE_VIEW_TEST_ID = "diff-renderer-split-code-view";
const SPLIT_CODE_OLD_PANE_TEST_ID = "diff-renderer-split-code-pane-old";
const SPLIT_CODE_NEW_PANE_TEST_ID = "diff-renderer-split-code-pane-new";

const FENCED_CODE_BLOCK_PATTERN = /^```([A-Za-z0-9_+-]*)\n([\s\S]*?)\n?```$/;
const CODE_FONT_FAMILY =
  '"Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * Text colors that signal insertions and deletions. Since diffs no longer
 * use a background fill, this color is the only signal that text changed —
 * every diff render path must apply it.
 */
const DIFF_TEXT_COLORS = {
  insert: { light: "#2e7d32", dark: "#a5d6a7" },
  delete: { light: "#c62828", dark: "#e57373" },
} as const;

const getDiffTextColor = (
  kind: "insert" | "delete",
  paletteMode: "light" | "dark",
): string => DIFF_TEXT_COLORS[kind][paletteMode];

const getMentionDiffBackground = (
  tone: Exclude<MentionDiffTone, "equal">,
  theme: Theme,
): string =>
  tone === "insert" ? theme.palette.success.main : theme.palette.error.light;

type CodeDiffLineType = "equal" | "insert" | "delete" | "replace";

interface ParsedCodeContent {
  code: string;
  language: string | null;
}

interface CodeDiffRow {
  type: CodeDiffLineType;
  oldLine: string | null;
  newLine: string | null;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

interface InlineDiffToken {
  text: string;
  type: "equal" | "insert" | "delete";
}

type MarkdownDiffSegment =
  | { type: "equal"; text: string }
  | { type: "block-changed"; text: string }
  | { type: "inline-changed"; tokens: InlineDiffToken[] };

const buildWordDiffTokens = (
  oldText: string,
  newText: string,
  pane: DiffPane,
): InlineDiffToken[] => {
  const wordChanges = diffWordsWithSpaceInlineAware(oldText, newText);
  const tokens: InlineDiffToken[] = [];

  for (const change of wordChanges) {
    if (!change.added && !change.removed) {
      tokens.push({ text: change.value, type: "equal" });
      continue;
    }
    if (change.added && pane === "new") {
      tokens.push({ text: change.value, type: "insert" });
      continue;
    }
    if (change.removed && pane === "old") {
      tokens.push({ text: change.value, type: "delete" });
    }
  }

  return tokens;
};

const buildSplitPaneSegments = (
  changes: Change[],
  pane: DiffPane,
): MarkdownDiffSegment[] => {
  const segments: MarkdownDiffSegment[] = [];

  for (let i = 0; i < changes.length; i += 1) {
    const change = changes[i];
    const next = changes[i + 1];

    if (!change.added && !change.removed) {
      segments.push({ type: "equal", text: change.value });
      continue;
    }

    const isPair =
      (change.removed && next?.added) || (change.added && next?.removed);

    if (isPair && next) {
      const oldValue = change.removed ? change.value : next.value;
      const newValue = change.added ? change.value : next.value;
      segments.push({
        type: "inline-changed",
        tokens: buildWordDiffTokens(oldValue, newValue, pane),
      });
      i += 1;
      continue;
    }

    if (change.added && pane === "new") {
      segments.push({ type: "block-changed", text: change.value });
      continue;
    }

    if (change.removed && pane === "old") {
      segments.push({ type: "block-changed", text: change.value });
    }
  }

  return segments;
};

const normalizeLineEndings = (value: string): string => {
  return value.replace(/\r\n/g, "\n");
};

const parseCodeContent = (content: string): ParsedCodeContent => {
  const normalizedContent = normalizeLineEndings(content);
  const fencedBlockMatch = normalizedContent.match(FENCED_CODE_BLOCK_PATTERN);

  if (!fencedBlockMatch) {
    return {
      code: normalizedContent,
      language: null,
    };
  }

  const [, rawLanguage, fencedCode] = fencedBlockMatch;
  const normalizedLanguage =
    rawLanguage.trim().length > 0 ? rawLanguage.trim().toLowerCase() : null;

  return {
    code: fencedCode,
    language: normalizedLanguage,
  };
};

const splitDiffChunkIntoLines = (value: string): string[] => {
  const lines = normalizeLineEndings(value).split("\n");
  const lastLine = lines[lines.length - 1];
  if (lastLine === "") {
    lines.pop();
  }

  return lines;
};

const appendEqualRows = (
  rows: CodeDiffRow[],
  lines: string[],
  oldLineNumberRef: { current: number },
  newLineNumberRef: { current: number },
): void => {
  lines.forEach((line) => {
    rows.push({
      type: "equal",
      oldLine: line,
      newLine: line,
      oldLineNumber: oldLineNumberRef.current,
      newLineNumber: newLineNumberRef.current,
    });
    oldLineNumberRef.current += 1;
    newLineNumberRef.current += 1;
  });
};

const appendDeleteRows = (
  rows: CodeDiffRow[],
  lines: string[],
  oldLineNumberRef: { current: number },
): void => {
  lines.forEach((line) => {
    rows.push({
      type: "delete",
      oldLine: line,
      newLine: null,
      oldLineNumber: oldLineNumberRef.current,
      newLineNumber: null,
    });
    oldLineNumberRef.current += 1;
  });
};

const appendInsertRows = (
  rows: CodeDiffRow[],
  lines: string[],
  newLineNumberRef: { current: number },
): void => {
  lines.forEach((line) => {
    rows.push({
      type: "insert",
      oldLine: null,
      newLine: line,
      oldLineNumber: null,
      newLineNumber: newLineNumberRef.current,
    });
    newLineNumberRef.current += 1;
  });
};

const appendReplaceRows = (
  rows: CodeDiffRow[],
  removedLines: string[],
  addedLines: string[],
  oldLineNumberRef: { current: number },
  newLineNumberRef: { current: number },
): void => {
  const pairedLineCount = Math.max(removedLines.length, addedLines.length);

  for (let lineIndex = 0; lineIndex < pairedLineCount; lineIndex += 1) {
    const removedLine = removedLines[lineIndex];
    const addedLine = addedLines[lineIndex];

    if (removedLine !== undefined && addedLine !== undefined) {
      rows.push({
        type: "replace",
        oldLine: removedLine,
        newLine: addedLine,
        oldLineNumber: oldLineNumberRef.current,
        newLineNumber: newLineNumberRef.current,
      });
      oldLineNumberRef.current += 1;
      newLineNumberRef.current += 1;
      continue;
    }

    if (removedLine !== undefined) {
      rows.push({
        type: "delete",
        oldLine: removedLine,
        newLine: null,
        oldLineNumber: oldLineNumberRef.current,
        newLineNumber: null,
      });
      oldLineNumberRef.current += 1;
      continue;
    }

    if (addedLine !== undefined) {
      rows.push({
        type: "insert",
        oldLine: null,
        newLine: addedLine,
        oldLineNumber: null,
        newLineNumber: newLineNumberRef.current,
      });
      newLineNumberRef.current += 1;
    }
  }
};

const buildCodeDiffRows = (oldCode: string, newCode: string): CodeDiffRow[] => {
  const rows: CodeDiffRow[] = [];
  const oldLineNumberRef = { current: 1 };
  const newLineNumberRef = { current: 1 };
  const lineChanges = diffLines(oldCode, newCode);

  for (
    let changeIndex = 0;
    changeIndex < lineChanges.length;
    changeIndex += 1
  ) {
    const currentChange = lineChanges[changeIndex];
    const currentLines = splitDiffChunkIntoLines(currentChange.value);

    if (!currentChange.added && !currentChange.removed) {
      appendEqualRows(rows, currentLines, oldLineNumberRef, newLineNumberRef);
      continue;
    }

    const nextChange = lineChanges[changeIndex + 1];
    if (currentChange.removed && nextChange?.added) {
      const nextLines = splitDiffChunkIntoLines(nextChange.value);
      appendReplaceRows(
        rows,
        currentLines,
        nextLines,
        oldLineNumberRef,
        newLineNumberRef,
      );
      changeIndex += 1;
      continue;
    }

    if (currentChange.removed) {
      appendDeleteRows(rows, currentLines, oldLineNumberRef);
      continue;
    }

    if (currentChange.added) {
      appendInsertRows(rows, currentLines, newLineNumberRef);
    }
  }

  return rows;
};

const resolveCodeLanguage = (
  explicitLanguage: string | undefined,
  oldLanguage: string | null,
  newLanguage: string | null,
): string | null => {
  if (explicitLanguage && explicitLanguage.trim().length > 0) {
    return explicitLanguage.trim().toLowerCase();
  }

  return newLanguage ?? oldLanguage;
};

const getLanguageSuffix = (language: string | null): string => {
  return language ? ` (${language})` : "";
};

const resolveCodeLineColors = (
  pane: DiffPane,
  rowType: CodeDiffLineType,
  paletteMode: "light" | "dark",
): { color: string } => {
  if (pane === "old" && (rowType === "delete" || rowType === "replace")) {
    return {
      color: paletteMode === "dark" ? "#e57373" : "#7f1d1d",
    };
  }

  if (pane === "new" && (rowType === "insert" || rowType === "replace")) {
    return {
      color: paletteMode === "dark" ? "#a5d6a7" : "#14532d",
    };
  }

  return {
    color: "text.primary",
  };
};

const getOperationTestId = (
  operationTestIdPrefix: string | undefined,
  operationIndex: number,
): string => {
  return `${operationTestIdPrefix ?? "diff-operation"}-${operationIndex}`;
};

const inlineCodeSx = (theme: Theme) => ({
  backgroundColor:
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.1)"
      : "rgba(0, 0, 0, 0.1)",
  padding: "1px 4px",
  borderRadius: "3px",
  fontSize: "0.9em",
  fontFamily: "monospace",
});

const renderInlineNodes = (
  nodes: InlineNode[],
  keyPrefix: string,
  tone: MentionDiffTone,
): React.ReactNode =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return <React.Fragment key={key}>{node.value}</React.Fragment>;
      case "code":
        return (
          <Box key={key} component="code" sx={inlineCodeSx}>
            {node.value}
          </Box>
        );
      case "mention":
        return (
          <Box
            key={key}
            component="span"
            data-testid="diff-renderer-mention"
            data-diff-tone={tone}
            sx={
              tone === "equal"
                ? undefined
                : (theme) => ({
                    "& [data-mention-token]": {
                      backgroundColor: `${getMentionDiffBackground(tone, theme)} !important`,
                    },
                  })
            }
          >
            {renderMentionNode(node.mention, "full")}
          </Box>
        );
      case "strong":
        return (
          <Box key={key} component="strong" sx={{ fontWeight: 600 }}>
            {renderInlineNodes(node.children, key, tone)}
          </Box>
        );
      case "emphasis":
        return (
          <Box key={key} component="em" sx={{ fontStyle: "italic" }}>
            {renderInlineNodes(node.children, key, tone)}
          </Box>
        );
      case "strikethrough":
        return (
          <Box key={key} component="del">
            {renderInlineNodes(node.children, key, tone)}
          </Box>
        );
      default:
        return null;
    }
  });

/**
 * Render the inline markdown that survives word-level diffing — inline code,
 * mentions, bold, italic, strikethrough — as styled nodes. Block markdown
 * (lists, headings, fenced blocks) is intentionally left as literal text: these
 * spots render individual word-diff fragments, which cannot carry block
 * structure (and those constructs render fully in the non-interactive views).
 */
const renderInlineRichText = (
  text: string,
  tone: MentionDiffTone = "equal",
): React.ReactNode =>
  renderInlineNodes(parseInlineMarkdown(text), "inline", tone);

const renderEqualSegment = (key: string, text: string): React.ReactElement => {
  return (
    <Box key={key} component="span" sx={{ whiteSpace: "pre-wrap" }}>
      {renderInlineRichText(text, "equal")}
    </Box>
  );
};

export interface WordDiffTextProps {
  oldContent: string;
  newContent: string;
  pane: DiffPane;
}

/**
 * Renders one text fragment using the same word-level and mention-aware
 * semantics as DiffRenderer's inline and split views.
 */
export const WordDiffText: React.FC<WordDiffTextProps> = ({
  oldContent,
  newContent,
  pane,
}) => {
  const theme = useTheme();
  const operations = useMemo(
    () => calculateWordDiff(oldContent, newContent).operations,
    [newContent, oldContent],
  );

  return (
    <Box component="span" sx={{ whiteSpace: "pre-wrap" }}>
      {operations.map((operation, index) => {
        const key = `word-diff-${pane}-${index}`;

        if (operation.type === "equal") {
          return (
            <React.Fragment key={key}>
              {renderInlineRichText(operation.originalText, "equal")}
            </React.Fragment>
          );
        }

        const renderChangedText = (
          changedKey: string,
          text: string,
          tone: "insert" | "delete",
        ): React.ReactElement => (
          <Box
            key={changedKey}
            component={tone === "insert" ? "ins" : "del"}
            sx={{
              color: getDiffTextColor(tone, theme.palette.mode),
              textDecoration: tone === "delete" ? "line-through" : "none",
            }}
          >
            {renderInlineRichText(text, tone)}
          </Box>
        );

        if (operation.type === "insert") {
          return pane === "new"
            ? renderChangedText(key, operation.newText, "insert")
            : null;
        }

        if (operation.type === "delete") {
          return pane === "old"
            ? renderChangedText(key, operation.originalText, "delete")
            : null;
        }

        return pane === "old"
          ? renderChangedText(key, operation.originalText, "delete")
          : renderChangedText(key, operation.newText, "insert");
      })}
    </Box>
  );
};

interface InteractiveDiffOperationProps {
  tag: "ins" | "del";
  text: string;
  operationIndex: number;
  decision?: DiffOperationDecision;
  showControls: boolean;
  onOperationDecisionChange?: (
    operationIndex: number,
    decision: DiffOperationDecision,
  ) => void;
  operationTestIdPrefix?: string;
}

const InteractiveDiffOperation: React.FC<InteractiveDiffOperationProps> = ({
  tag,
  text,
  operationIndex,
  decision,
  showControls,
  onOperationDecisionChange,
  operationTestIdPrefix,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const baseTestId = getOperationTestId(operationTestIdPrefix, operationIndex);

  return (
    <Box
      component={tag}
      data-testid={`${baseTestId}-${tag}`}
      data-diff-decision={decision ?? "undecided"}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      sx={{
        position: "relative",
        whiteSpace: "pre-wrap",
        color: (theme) =>
          getDiffTextColor(
            tag === "ins" ? "insert" : "delete",
            theme.palette.mode,
          ),
        textDecoration:
          tag === "del" && decision !== "rejected"
            ? "line-through"
            : decision === "rejected" && tag === "ins"
              ? "line-through"
              : "none",
        opacity: decision === "rejected" ? 0.55 : 1,
        boxShadow:
          decision === "accepted"
            ? (theme) => `inset 0 0 0 1px ${theme.palette.success.main}`
            : "none",
      }}
    >
      {renderInlineRichText(text, tag === "ins" ? "insert" : "delete")}
      {isHovered && showControls && onOperationDecisionChange ? (
        <Box
          component="span"
          sx={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translate(-50%, calc(-100% - 4px))",
            zIndex: 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 0.25,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "999px",
            backgroundColor: "background.paper",
            boxShadow: 2,
            p: 0.25,
          }}
        >
          <IconButton
            size="small"
            onClick={() =>
              onOperationDecisionChange(operationIndex, "accepted")
            }
            data-testid={`${baseTestId}-accept`}
            sx={{ color: "success.main", p: 0.25 }}
          >
            <CheckIcon sx={{ fontSize: 14 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() =>
              onOperationDecisionChange(operationIndex, "rejected")
            }
            data-testid={`${baseTestId}-reject`}
            sx={{ color: "error.main", p: 0.25 }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      ) : null}
    </Box>
  );
};

interface InlineInteractiveOperationsProps {
  operations: DiffOperation[];
  operationDecisions?: Record<number, DiffOperationDecision>;
  onOperationDecisionChange?: (
    operationIndex: number,
    decision: DiffOperationDecision,
  ) => void;
  operationTestIdPrefix?: string;
}

const renderInlineInteractiveOperations = ({
  operations,
  operationDecisions,
  onOperationDecisionChange,
  operationTestIdPrefix,
}: InlineInteractiveOperationsProps): React.ReactNode[] => {
  return operations.map((operation, operationIndex) => {
    if (operation.type === "equal") {
      return renderEqualSegment(
        `diff-operation-${operationIndex}`,
        operation.originalText,
      );
    }

    if (operation.type === "insert") {
      return (
        <InteractiveDiffOperation
          key={`diff-operation-${operationIndex}-insert`}
          tag="ins"
          text={operation.newText}
          operationIndex={operationIndex}
          decision={operationDecisions?.[operationIndex]}
          showControls
          onOperationDecisionChange={onOperationDecisionChange}
          operationTestIdPrefix={operationTestIdPrefix}
        />
      );
    }

    if (operation.type === "delete") {
      return (
        <InteractiveDiffOperation
          key={`diff-operation-${operationIndex}-delete`}
          tag="del"
          text={operation.originalText}
          operationIndex={operationIndex}
          decision={operationDecisions?.[operationIndex]}
          showControls
          onOperationDecisionChange={onOperationDecisionChange}
          operationTestIdPrefix={operationTestIdPrefix}
        />
      );
    }

    return (
      <React.Fragment key={`diff-operation-${operationIndex}-replace`}>
        <InteractiveDiffOperation
          tag="del"
          text={operation.originalText}
          operationIndex={operationIndex}
          decision={operationDecisions?.[operationIndex]}
          showControls={false}
          onOperationDecisionChange={onOperationDecisionChange}
          operationTestIdPrefix={operationTestIdPrefix}
        />
        <InteractiveDiffOperation
          tag="ins"
          text={operation.newText}
          operationIndex={operationIndex}
          decision={operationDecisions?.[operationIndex]}
          showControls
          onOperationDecisionChange={onOperationDecisionChange}
          operationTestIdPrefix={operationTestIdPrefix}
        />
      </React.Fragment>
    );
  });
};

interface SplitInteractiveOperationsProps extends InlineInteractiveOperationsProps {
  pane: DiffPane;
}

const renderSplitInteractiveOperations = ({
  pane,
  operations,
  operationDecisions,
  onOperationDecisionChange,
  operationTestIdPrefix,
}: SplitInteractiveOperationsProps): React.ReactNode[] => {
  return operations.map((operation, operationIndex) => {
    const equalText =
      pane === "old" ? operation.originalText : operation.newText;

    switch (operation.type) {
      case "equal":
        return renderEqualSegment(
          `diff-operation-${pane}-${operationIndex}`,
          equalText,
        );
      case "insert":
        return pane === "new" ? (
          <InteractiveDiffOperation
            key={`diff-operation-${pane}-${operationIndex}-insert`}
            tag="ins"
            text={operation.newText}
            operationIndex={operationIndex}
            decision={operationDecisions?.[operationIndex]}
            showControls
            onOperationDecisionChange={onOperationDecisionChange}
            operationTestIdPrefix={operationTestIdPrefix}
          />
        ) : null;
      case "delete":
        return pane === "old" ? (
          <InteractiveDiffOperation
            key={`diff-operation-${pane}-${operationIndex}-delete`}
            tag="del"
            text={operation.originalText}
            operationIndex={operationIndex}
            decision={operationDecisions?.[operationIndex]}
            showControls
            onOperationDecisionChange={onOperationDecisionChange}
            operationTestIdPrefix={operationTestIdPrefix}
          />
        ) : null;
      case "replace":
        return pane === "old" ? (
          <InteractiveDiffOperation
            key={`diff-operation-${pane}-${operationIndex}-replace-old`}
            tag="del"
            text={operation.originalText}
            operationIndex={operationIndex}
            decision={operationDecisions?.[operationIndex]}
            showControls={false}
            onOperationDecisionChange={onOperationDecisionChange}
            operationTestIdPrefix={operationTestIdPrefix}
          />
        ) : (
          <InteractiveDiffOperation
            key={`diff-operation-${pane}-${operationIndex}-replace-new`}
            tag="ins"
            text={operation.newText}
            operationIndex={operationIndex}
            decision={operationDecisions?.[operationIndex]}
            showControls
            onOperationDecisionChange={onOperationDecisionChange}
            operationTestIdPrefix={operationTestIdPrefix}
          />
        );
      default:
        return null;
    }
  });
};

interface DiffSplitPaneProps {
  title: string;
  testId: string;
  children: React.ReactNode;
}

const DiffSplitPane: React.FC<DiffSplitPaneProps> = ({
  title,
  testId,
  children,
}) => {
  return (
    <Box
      data-testid={testId}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        p: 1.25,
        minWidth: 0,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: "block",
          mb: 0.75,
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          color: "text.secondary",
          fontWeight: 600,
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
};

interface MarkdownDiffSegmentsProps {
  segments: MarkdownDiffSegment[];
  markdownComponents?: Components;
  pane: DiffPane;
}

const MarkdownDiffSegments: React.FC<MarkdownDiffSegmentsProps> = ({
  segments,
  markdownComponents,
  pane,
}) => {
  const theme = useTheme();

  return (
    <>
      {segments.map((segment, index) => {
        const key = `${pane}-seg-${String(index)}`;

        if (segment.type === "equal") {
          return (
            <MarkdownRenderer key={key} components={markdownComponents}>
              {segment.text}
            </MarkdownRenderer>
          );
        }

        if (segment.type === "block-changed") {
          const isOld = pane === "old";
          return (
            <Box
              key={key}
              sx={{
                "& *": {
                  color: getDiffTextColor(
                    isOld ? "delete" : "insert",
                    theme.palette.mode,
                  ),
                  ...(isOld ? { textDecoration: "line-through" } : {}),
                },
                "& [data-mention-token]": {
                  backgroundColor: `${getMentionDiffBackground(
                    isOld ? "delete" : "insert",
                    theme,
                  )} !important`,
                  borderRadius: "3px",
                },
              }}
            >
              <MarkdownRenderer components={markdownComponents}>
                {segment.text}
              </MarkdownRenderer>
            </Box>
          );
        }

        return (
          <Box
            key={key}
            sx={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              mb: 1,
              "&:last-child": { mb: 0 },
            }}
          >
            {segment.tokens.map((token, tokenIndex) => {
              if (token.type === "equal") {
                return (
                  <React.Fragment key={tokenIndex}>
                    {renderInlineRichText(token.text, "equal")}
                  </React.Fragment>
                );
              }

              const isInsert = token.type === "insert";
              return (
                <Box
                  key={tokenIndex}
                  component={isInsert ? "ins" : "del"}
                  sx={{
                    color: getDiffTextColor(
                      isInsert ? "insert" : "delete",
                      theme.palette.mode,
                    ),
                    textDecoration: isInsert ? "none" : "line-through",
                  }}
                >
                  {renderInlineRichText(
                    token.text,
                    isInsert ? "insert" : "delete",
                  )}
                </Box>
              );
            })}
          </Box>
        );
      })}
    </>
  );
};

interface InlineMarkdownDiffOperationsProps {
  operations: DiffOperation[];
  markdownComponents?: Components;
}

const InlineMarkdownDiffOperations: React.FC<
  InlineMarkdownDiffOperationsProps
> = ({ operations, markdownComponents }) => {
  const theme = useTheme();
  // Fragments belong to the same paragraph. Only authored paragraph breaks
  // introduce vertical space; a word-level operation is never a block boundary.
  const renderFragment = (key: string, text: string, tone: MentionDiffTone) => (
    <Box
      key={key}
      data-diff-tone={tone}
      sx={{
        display: "contents",
        ...(tone === "equal"
          ? {}
          : {
              "& *": {
                color: getDiffTextColor(tone, theme.palette.mode),
                ...(tone === "delete"
                  ? { textDecoration: "line-through" }
                  : {}),
              },
              "& [data-mention-token]": {
                backgroundColor: `${getMentionDiffBackground(tone, theme)} !important`,
              },
            }),
      }}
    >
      {text.split(/(\n\s*\n)/).map((part, index) =>
        /^\n\s*\n$/.test(part) ? (
          <React.Fragment key={index}>
            <br />
            <br />
          </React.Fragment>
        ) : (
          <React.Fragment key={index}>
            {part.match(/^[ \t]+/)?.[0]}
            <MarkdownRenderer
              components={markdownComponents}
              sx={{ display: "contents", "& p": { display: "inline", m: 0 } }}
            >
              {part.replace(/^[ \t]+|[ \t]+$/g, "")}
            </MarkdownRenderer>
            {part.trim() ? part.match(/[ \t]+$/)?.[0] : null}
          </React.Fragment>
        ),
      )}
    </Box>
  );
  return (
    <>
      {operations.map((operation, index) => {
        const key = `inline-op-${index}`;
        if (operation.type === "equal")
          return renderFragment(key, operation.originalText, "equal");
        if (operation.type === "insert")
          return renderFragment(key, operation.newText, "insert");
        if (operation.type === "delete")
          return renderFragment(key, operation.originalText, "delete");
        return (
          <React.Fragment key={key}>
            {renderFragment(`${key}-del`, operation.originalText, "delete")}
            {renderFragment(`${key}-ins`, operation.newText, "insert")}
          </React.Fragment>
        );
      })}
    </>
  );
};

interface SplitCodeDiffPaneProps {
  pane: DiffPane;
  rows: CodeDiffRow[];
  language: string | null;
  testId: string;
}

const SplitCodeDiffPane: React.FC<SplitCodeDiffPaneProps> = ({
  pane,
  rows,
  language,
  testId,
}) => {
  const theme = useTheme();
  const titlePrefix = pane === "old" ? "Current" : "Suggested";
  const title = `${titlePrefix}${getLanguageSuffix(language)}`;

  return (
    <DiffSplitPane title={title} testId={testId}>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 0,
          borderRadius: 1,
          fontFamily: CODE_FONT_FAMILY,
          fontSize: "0.8125rem",
          lineHeight: 1.6,
          backgroundColor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(255, 255, 255, 0.02)"
              : "rgba(0, 0, 0, 0.02)",
        }}
      >
        {rows.map((row, rowIndex) => {
          const line = pane === "old" ? row.oldLine : row.newLine;
          const lineNumber =
            pane === "old" ? row.oldLineNumber : row.newLineNumber;
          const colors = resolveCodeLineColors(
            pane,
            row.type,
            theme.palette.mode,
          );

          return (
            <Box
              key={`${pane}-${String(rowIndex)}`}
              component="code"
              sx={{
                display: "grid",
                gridTemplateColumns: "3.5rem 1fr",
                alignItems: "stretch",
                minHeight: "1.6em",
                color: colors.color,
              }}
            >
              <Box
                component="span"
                sx={{
                  userSelect: "none",
                  textAlign: "right",
                  pr: 1,
                  borderRight: "1px solid",
                  borderColor: "divider",
                  color: "text.secondary",
                  backgroundColor: "action.hover",
                }}
              >
                {lineNumber ?? ""}
              </Box>
              <Box
                component="span"
                sx={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  px: 1.25,
                  minWidth: 0,
                }}
              >
                {line ?? " "}
              </Box>
            </Box>
          );
        })}
      </Box>
    </DiffSplitPane>
  );
};

const getInitialViewMode = (
  defaultViewMode: DiffViewMode | undefined,
): DiffViewMode => {
  return defaultViewMode ?? DEFAULT_VIEW_MODE;
};

interface ResolvedDiffViewMode {
  viewMode: DiffViewMode;
  setViewMode: (mode: DiffViewMode) => void;
}

const useResolvedDiffViewMode = ({
  viewMode,
  defaultViewMode,
  onViewModeChange,
}: Pick<
  DiffRendererProps,
  "viewMode" | "defaultViewMode" | "onViewModeChange"
>): ResolvedDiffViewMode => {
  const [uncontrolledViewMode, setUncontrolledViewMode] =
    useState<DiffViewMode>(() => getInitialViewMode(defaultViewMode));
  const resolvedViewMode = viewMode ?? uncontrolledViewMode;

  const setViewMode = useCallback(
    (nextViewMode: DiffViewMode) => {
      if (viewMode === undefined) {
        setUncontrolledViewMode(nextViewMode);
      }

      onViewModeChange?.(nextViewMode);
    },
    [onViewModeChange, viewMode],
  );

  return {
    viewMode: resolvedViewMode,
    setViewMode,
  };
};

interface DiffViewModeToggleProps {
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
}

const DiffViewModeToggle: React.FC<DiffViewModeToggleProps> = ({
  viewMode,
  onViewModeChange,
}) => {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "flex-end",
        mb: 1,
      }}
    >
      <ButtonGroup
        size="small"
        variant="outlined"
        data-testid={VIEW_MODE_TOGGLE_TEST_ID}
      >
        <Button
          variant={viewMode === "inline" ? "contained" : "outlined"}
          onClick={() => onViewModeChange("inline")}
          data-testid={VIEW_MODE_INLINE_BUTTON_TEST_ID}
        >
          Inline
        </Button>
        <Button
          variant={viewMode === "split" ? "contained" : "outlined"}
          onClick={() => onViewModeChange("split")}
          data-testid={VIEW_MODE_SPLIT_BUTTON_TEST_ID}
        >
          Split
        </Button>
      </ButtonGroup>
    </Box>
  );
};

/**
 * DiffRenderer displays differences between old and new content as a
 * flowing sequence of per-operation markdown fragments. Each fragment is rendered
 * in its own MarkdownRenderer to avoid embedding raw HTML diff markers
 * (which leak as literal text when adjacent markdown delimiters — like
 * backticks — turn the surrounding region into a code span).
 *
 * Diff highlighting:
 * - Insertions: Green text
 * - Deletions: Red text with strikethrough
 * - Replacements: Shown as deletion + insertion
 * - Equal: Normal text
 */
export const DiffRenderer: React.FC<DiffRendererProps> = ({
  oldContent,
  newContent,
  markdownComponents,
  enableInteractiveReview = false,
  operationDecisions,
  onOperationDecisionChange,
  operationTestIdPrefix,
  codeLanguage,
  showViewModeToggle = false,
  viewMode,
  defaultViewMode,
  onViewModeChange,
  contentRenderers,
}) => {
  const operations = useMemo(() => {
    return calculateWordDiff(oldContent, newContent).operations;
  }, [oldContent, newContent]);

  const lineChanges = useMemo(() => {
    return diffLines(oldContent, newContent);
  }, [oldContent, newContent]);

  const oldPaneSegments = useMemo(() => {
    return buildSplitPaneSegments(lineChanges, "old");
  }, [lineChanges]);

  const newPaneSegments = useMemo(() => {
    return buildSplitPaneSegments(lineChanges, "new");
  }, [lineChanges]);

  const parsedOldCodeContent = useMemo(() => {
    return parseCodeContent(oldContent);
  }, [oldContent]);

  const parsedNewCodeContent = useMemo(() => {
    return parseCodeContent(newContent);
  }, [newContent]);

  const resolvedCodeLanguage = useMemo(() => {
    return resolveCodeLanguage(
      codeLanguage,
      parsedOldCodeContent.language,
      parsedNewCodeContent.language,
    );
  }, [
    codeLanguage,
    parsedNewCodeContent.language,
    parsedOldCodeContent.language,
  ]);

  const codeDiffRows = useMemo(() => {
    return buildCodeDiffRows(
      parsedOldCodeContent.code,
      parsedNewCodeContent.code,
    );
  }, [parsedNewCodeContent.code, parsedOldCodeContent.code]);

  const { viewMode: resolvedViewMode, setViewMode } = useResolvedDiffViewMode({
    viewMode,
    defaultViewMode,
    onViewModeChange,
  });

  const inlineInteractiveOperations = useMemo(() => {
    if (!enableInteractiveReview) {
      return [];
    }

    return renderInlineInteractiveOperations({
      operations,
      operationDecisions,
      onOperationDecisionChange,
      operationTestIdPrefix,
    });
  }, [
    enableInteractiveReview,
    onOperationDecisionChange,
    operationDecisions,
    operationTestIdPrefix,
    operations,
  ]);

  const splitOldInteractiveOperations = useMemo(() => {
    if (!enableInteractiveReview) {
      return [];
    }

    return renderSplitInteractiveOperations({
      pane: "old",
      operations,
      operationDecisions,
      onOperationDecisionChange,
      operationTestIdPrefix,
    });
  }, [
    enableInteractiveReview,
    onOperationDecisionChange,
    operationDecisions,
    operationTestIdPrefix,
    operations,
  ]);

  const splitNewInteractiveOperations = useMemo(() => {
    if (!enableInteractiveReview) {
      return [];
    }

    return renderSplitInteractiveOperations({
      pane: "new",
      operations,
      operationDecisions,
      onOperationDecisionChange,
      operationTestIdPrefix,
    });
  }, [
    enableInteractiveReview,
    onOperationDecisionChange,
    operationDecisions,
    operationTestIdPrefix,
    operations,
  ]);

  return (
    <Box
      sx={{
        maxWidth: "100%",
        overflowWrap: "break-word",
        wordBreak: "break-word",
      }}
    >
      {showViewModeToggle ? (
        <DiffViewModeToggle
          viewMode={resolvedViewMode}
          onViewModeChange={setViewMode}
        />
      ) : null}

      {resolvedViewMode === "split-code" ? (
        <Box
          data-testid={SPLIT_CODE_VIEW_TEST_ID}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: 1.5,
          }}
        >
          {enableInteractiveReview ? (
            <>
              <DiffSplitPane
                title={`Current${getLanguageSuffix(resolvedCodeLanguage)}`}
                testId={SPLIT_CODE_OLD_PANE_TEST_ID}
              >
                <Box
                  component="span"
                  sx={{ whiteSpace: "pre-wrap", fontFamily: CODE_FONT_FAMILY }}
                >
                  {splitOldInteractiveOperations}
                </Box>
              </DiffSplitPane>
              <DiffSplitPane
                title={`Suggested${getLanguageSuffix(resolvedCodeLanguage)}`}
                testId={SPLIT_CODE_NEW_PANE_TEST_ID}
              >
                <Box
                  component="span"
                  sx={{ whiteSpace: "pre-wrap", fontFamily: CODE_FONT_FAMILY }}
                >
                  {splitNewInteractiveOperations}
                </Box>
              </DiffSplitPane>
            </>
          ) : (
            <>
              <SplitCodeDiffPane
                pane="old"
                rows={codeDiffRows}
                language={resolvedCodeLanguage}
                testId={SPLIT_CODE_OLD_PANE_TEST_ID}
              />
              <SplitCodeDiffPane
                pane="new"
                rows={codeDiffRows}
                language={resolvedCodeLanguage}
                testId={SPLIT_CODE_NEW_PANE_TEST_ID}
              />
            </>
          )}
        </Box>
      ) : resolvedViewMode === "split" ? (
        <Box
          data-testid={SPLIT_VIEW_TEST_ID}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: 1.5,
          }}
        >
          <DiffSplitPane title="Current" testId={SPLIT_OLD_PANE_TEST_ID}>
            {contentRenderers ? (
              contentRenderers.split.old
            ) : enableInteractiveReview ? (
              <Box component="span" sx={{ whiteSpace: "pre-wrap" }}>
                {splitOldInteractiveOperations}
              </Box>
            ) : (
              <MarkdownDiffSegments
                segments={oldPaneSegments}
                markdownComponents={markdownComponents}
                pane="old"
              />
            )}
          </DiffSplitPane>
          <DiffSplitPane title="Suggested" testId={SPLIT_NEW_PANE_TEST_ID}>
            {contentRenderers ? (
              contentRenderers.split.new
            ) : enableInteractiveReview ? (
              <Box component="span" sx={{ whiteSpace: "pre-wrap" }}>
                {splitNewInteractiveOperations}
              </Box>
            ) : (
              <MarkdownDiffSegments
                segments={newPaneSegments}
                markdownComponents={markdownComponents}
                pane="new"
              />
            )}
          </DiffSplitPane>
        </Box>
      ) : contentRenderers ? (
        <Box data-testid={INLINE_VIEW_TEST_ID}>{contentRenderers.inline}</Box>
      ) : enableInteractiveReview ? (
        <Box
          data-testid={INLINE_VIEW_TEST_ID}
          component="span"
          sx={{ whiteSpace: "pre-wrap" }}
        >
          {inlineInteractiveOperations}
        </Box>
      ) : (
        <Box data-testid={INLINE_VIEW_TEST_ID}>
          <InlineMarkdownDiffOperations
            operations={operations}
            markdownComponents={markdownComponents}
          />
        </Box>
      )}
    </Box>
  );
};
