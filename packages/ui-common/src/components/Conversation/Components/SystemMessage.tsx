import { ProposalSuggestionReview } from "../../ProposalReconciliation/ProposalSuggestionReview";
import { useModalState } from "../../Modals/useModalState";
import { ModalWorkOwner } from "../../Modals/ModalWorkOwner";
import type { AnimationConfig } from "../../../animations/config";
import {
  Box,
  Stack,
  Typography,
  useTheme,
  type SxProps,
  type Theme,
} from "@mui/material";
import React, { Suspense, useMemo } from "react";
import type { Components } from "react-markdown";
import { FadeIn } from "../../../animations";
import {
  SystemMessageDataTypeEnum,
  type SystemMessageData,
} from "../../../api";
import type { ReportDto } from "../../../api";
import type { MessageRetryState } from "../../../types/conversation";
import { ReportViewer } from "../../Reports";
import { ReportOpenQuestions } from "../../Reports/ReportViewer";
import { unframedReportStyles } from "../../Reports/viewer/ReportViewerFrame";
import {
  ReportProposedUpdates,
  type ProposedUpdateCardContext,
} from "./ReportProposedUpdates";
import { SystemMessageError } from "../../SystemMessageError";
import { ThinkingIndicator } from "../../ThinkingIndicator";
import { ThinkingText } from "./ThinkingText";
import { useAnimateTyping } from "./useAnimateTyping";
import { ExternalEditorPreferenceDialog } from "../../EditorPreference/ExternalEditorPreferenceDialog";
import {
  buildExternalEditorUrl,
  parseSourceReference,
  readExternalEditorPreference,
  type ExternalEditorPreference,
  type SourceReference,
} from "../../EditorPreference/editorPreference";
import {
  MarkdownRenderer,
  renderWithMentions,
} from "../../shared/MarkdownRenderer";

import {
  SYSTEM_MESSAGE_CODE_BLOCK_BG_VAR,
  SYSTEM_MESSAGE_INLINE_CODE_BG_VAR,
  SYSTEM_MESSAGE_LINK_COLOR_VAR,
} from "./systemMessageStyleVars";
import { SYSTEM_MESSAGE_MAX_WIDTH } from "./messageMaxWidth";
import { getNoticeSeverity } from "./MessageAuthorCaption";

const MermaidCodeBlock = React.lazy(() =>
  import("../../shared/MermaidCodeBlock").then((mod) => ({
    default: mod.MermaidCodeBlock,
  })),
);

interface SystemMessageProps {
  animationType: "fun" | "minimal";
  /** The full message text to display (legacy) */
  text?: string;
  /** Whether the system is thinking/processing */
  isThinking?: boolean;
  /** Whether this message is completed (affects opacity) */
  isCompleted?: boolean;
  /** Whether this message is awaiting a response (makes it more prominent) */
  awaitingResponse?: boolean;
  /** Whether this message has failed and should show error state */
  isFailed?: boolean;
  /** Custom thinking message (default: "Thinking...") */
  thinkingMessage?: string;
  /** Animation duration for typing effect in ms (default: 300) */
  typingDuration?: number;
  /** Whether response text should animate as it types in */
  enableTypingAnimation?: boolean;
  /** Additional styling */
  sx?: React.ComponentProps<typeof Box>["sx"];
  /** System message data for new conversational flow structure */
  messageData?: SystemMessageData;
  /** Retry state for failed messages */
  retryState?: MessageRetryState;
  /** Generic error message to display for failed messages */
  errorMessage?: string;
  /** If true, show games instead of the standard loading */
  showLoadingGames?: boolean;
  /** The type of system message data */
  type: string;
  /** Whether to keep showing the streaming skeleton even after text appears */
  showStreamingSkeleton?: boolean;
  /** Whether a timestamp should be rendered for the message, affects bottom margin */
  renderTimestamp?: boolean;
  /** Thinking narration, which stays plain text instead of a final reply. */
  isNarration?: boolean;
  /** Inline reports to render inside the SystemMessage */
  inlineReports?: ReportDto[];
  /**
   * Conversation-only. When present, a report's proposed updates render as
   * cards after the message instead of inside the report body.
   */
  proposedUpdateCards?: ProposedUpdateCardContext;
}

const MERMAID_LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-mermaid(?:\s|$)/;

interface SystemMessageCodeProps extends React.ComponentProps<"code"> {
  node?: unknown;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const isMermaidCodeFence = (
  inline: boolean | undefined,
  className: string | undefined,
): boolean =>
  !inline &&
  typeof className === "string" &&
  MERMAID_LANGUAGE_CLASS_PATTERN.test(className);

const codeChildrenToString = (children: React.ReactNode): string =>
  React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }

      return "";
    })
    .join("");

interface SystemMessageAnchorProps extends React.ComponentProps<"a"> {
  node?: unknown;
}

const MACHINE_PATHNAME_PATTERN = /^\/(?:Users|home|private|tmp)\//;

const parseSystemMessageSourceReference = (
  href: string | undefined,
): SourceReference | null => {
  const directReference = parseSourceReference(href);
  if (directReference || !href || typeof window === "undefined") {
    return directReference;
  }

  try {
    const resolvedUrl = new URL(href, window.location.href);
    if (
      resolvedUrl.origin !== window.location.origin ||
      !MACHINE_PATHNAME_PATTERN.test(resolvedUrl.pathname)
    ) {
      return null;
    }

    return parseSourceReference(resolvedUrl.pathname);
  } catch {
    return null;
  }
};

const openSourceReference = (
  preference: ExternalEditorPreference,
  sourceReference: SourceReference,
) => {
  window.open(
    buildExternalEditorUrl(preference, sourceReference),
    "_self",
    "noopener,noreferrer",
  );
};

const SystemMessageAnchor = ({
  node: _node,
  href,
  onClick,
  style,
  ...props
}: SystemMessageAnchorProps) => {
  const theme = useTheme();
  const sourceReference = parseSystemMessageSourceReference(href);
  const [isSetupOpen, setIsSetupOpen, isSetupOpenOwnerKey] =
    useModalState(false);

  if (!sourceReference) {
    return (
      <a
        {...props}
        href={href}
        onClick={onClick}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: `var(${SYSTEM_MESSAGE_LINK_COLOR_VAR}, ${theme.palette.primary.main})`,
          textDecoration: "underline",
          textUnderlineOffset: "2px",
          ...style,
        }}
      />
    );
  }

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;

    event.preventDefault();
    const preference = readExternalEditorPreference();
    if (preference) {
      openSourceReference(preference, sourceReference);
      return;
    }

    setIsSetupOpen(true);
  };

  const handleSaved = (preference: ExternalEditorPreference) => {
    setIsSetupOpen(false);
    openSourceReference(preference, sourceReference);
  };

  return (
    <>
      <a
        {...props}
        href="#"
        onClick={handleClick}
        data-testid="system-message-source-link"
        data-source-path={sourceReference.path}
        style={{
          color: `var(${SYSTEM_MESSAGE_LINK_COLOR_VAR}, ${theme.palette.primary.main})`,
          textDecoration: "underline",
          textUnderlineOffset: "2px",
          ...style,
        }}
      />
      <ModalWorkOwner.Provider value={isSetupOpenOwnerKey}>
        <ExternalEditorPreferenceDialog
          open={isSetupOpen}
          onCancel={() => setIsSetupOpen(false)}
          onSaved={handleSaved}
        />
      </ModalWorkOwner.Provider>
    </>
  );
};

/**
 * The Markdown renderer sets its own text color and size, so narration's muted
 * style has to be handed to it.
 */
const NARRATION_MARKDOWN_SX = {
  color: "inherit",
  fontSize: "inherit",
  lineHeight: "inherit",
} as const;

const FLUSH_REPORT_SX = {
  ...unframedReportStyles,
  // Dark mode paints Paper with an overlay image that would show as a panel.
  backgroundImage: "none",
} as const;

/** Automated notices and monitor messages are not the agent's final reply. */
const hasOwnTreatment = (messageData: SystemMessageData | undefined) =>
  getNoticeSeverity(messageData) !== null ||
  messageData?.type === SystemMessageDataTypeEnum.SessionMonitor;

/**
 * SystemMessage component that handles both thinking states and message display
 * with smooth typing animation transitions.
 */
export const SystemMessage: React.FC<SystemMessageProps> = (props) => {
  const {
    text = "",
    isThinking = false,
    isCompleted = false,
    awaitingResponse = false,
    isFailed = false,
    thinkingMessage,
    typingDuration,
    enableTypingAnimation = true,
    sx = {},
    renderTimestamp,
    isNarration = false,
    messageData,
    retryState,
    type,
    errorMessage = "Something went wrong. Please try again.",
    inlineReports,
    proposedUpdateCards,
  } = props;
  const theme = useTheme();

  const {
    animationConfig,
    displayText,
    displayedText,
    defaultThinkingMessage,
  } = useAnimateTyping({
    isThinking,
    messageData,
    text,
    thinkingMessage,
    typingDuration,
    enableTypingAnimation,
    type,
  });

  const hasErrorStyle = isFailed || retryState?.retryError;
  const resolvedInlineReports = inlineReports ?? [];
  const hasInlineReports = resolvedInlineReports.length > 0;

  const markdownComponents = useSystemMessageMarkdownComponents();

  const isFinalReply =
    !hasErrorStyle && !isNarration && !hasOwnTreatment(messageData);

  const {
    base,
    inner,
    report: reportCard,
  } = getStyles({
    hasErrorStyle,
    isFinalReply,
    theme,
    isCompleted,
    animationConfig,
    awaitingResponse,
    renderTimestamp,
  });

  if (
    !displayText &&
    !hasInlineReports &&
    !isFailed &&
    !retryState?.retryError
  ) {
    return null;
  }

  if (isFailed) {
    return (
      <FadeIn duration="medium" layout={false}>
        <Box sx={composeSx(base, sx)}>
          {/* Show error state for failed messages */}
          {(isFailed || retryState?.retryError) && (
            <SystemMessageError
              retryState={retryState}
              errorMessage={errorMessage}
            />
          )}
        </Box>
      </FadeIn>
    );
  }

  if (isThinking) {
    const responseText = (() => {
      if (typeof messageData?.response === "string") {
        return messageData.response;
      }

      if (messageData?.response && typeof messageData.response === "object") {
        console.warn("legacy style message response data", messageData);
        const legacyResponse = messageData.response as {
          feedback?: string;
          message?: string;
          text?: string;
        };

        return (
          legacyResponse.feedback ||
          legacyResponse.message ||
          legacyResponse.text ||
          ""
        );
      }

      return text;
    })();

    if (type === "AGENT") {
      return (
        <Box sx={{ minWidth: "300px" }}>
          <ThinkingIndicator
            animationType={props.animationType}
            text={responseText || undefined}
          />
        </Box>
      );
    }

    const thinkingText =
      responseText || thinkingMessage || defaultThinkingMessage;

    return <ThinkingText text={thinkingText} />;
  }

  return (
    <FadeIn duration="medium" layout={false}>
      {messageData?.proposalSuggestion && (
        <ProposalSuggestionReview suggestion={messageData.proposalSuggestion} />
      )}
      {/* Show message content if available and not just an error */}
      {(displayText || hasInlineReports) && (
        <Box sx={composeSx(base, sx)} data-testid={`system-message-${type}`}>
          {displayText ? (
            <Box sx={inner}>
              <Typography
                component="div"
                className="system-message-markdown"
                sx={{ color: "inherit" }}
              >
                <MarkdownRenderer
                  sx={isNarration ? NARRATION_MARKDOWN_SX : undefined}
                  components={markdownComponents}
                  allowMentionEscapes
                >
                  {displayedText || "\u00A0"}
                </MarkdownRenderer>
              </Typography>
            </Box>
          ) : null}

          {hasInlineReports && (
            <Stack spacing={2} sx={{ mt: displayText ? 2 : 0 }}>
              {resolvedInlineReports.map((report) => (
                <Box
                  key={report.id}
                  data-testid="system-message-inline-report"
                  sx={reportCard}
                >
                  <ReportViewer
                    report={report}
                    // A reply's report card is the only frame around it.
                    sx={isFinalReply ? FLUSH_REPORT_SX : undefined}
                    renderHeader={false}
                    renderOpenQuestions={false}
                    renderUpdates={proposedUpdateCards === undefined}
                  />
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      )}
      {proposedUpdateCards
        ? resolvedInlineReports.map((report) => (
            <Box
              key={`updates-${report.id}`}
              sx={{ maxWidth: SYSTEM_MESSAGE_MAX_WIDTH, mt: 1.5 }}
            >
              <ReportProposedUpdates
                context={proposedUpdateCards}
                report={report}
              />
            </Box>
          ))
        : null}
      {resolvedInlineReports.map((report) => (
        <Box
          key={report.id}
          sx={{ width: "fit-content", maxWidth: SYSTEM_MESSAGE_MAX_WIDTH }}
        >
          <ReportOpenQuestions
            report={report}
            testId={`report-viewer-${report.id}`}
          />
        </Box>
      ))}
    </FadeIn>
  );
};

export const useSystemMessageMarkdownComponents = (): Components => {
  return useMemo<Components>(
    () => ({
      a: SystemMessageAnchor,
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
        return (
          <li {...props}>
            {renderWithMentions(processedChildren, undefined, {
              allowMentionEscapes: true,
            })}
          </li>
        );
      },
      code: ({
        node: _node,
        inline,
        className,
        children,
        ...props
      }: SystemMessageCodeProps) => {
        if (isMermaidCodeFence(inline, className)) {
          return (
            <Suspense
              fallback={
                <code {...props}>
                  {renderWithMentions(children, undefined, {
                    allowMentionEscapes: true,
                  })}
                </code>
              }
            >
              <MermaidCodeBlock code={codeChildrenToString(children)} />
            </Suspense>
          );
        }

        return (
          <code {...props} className={className}>
            {renderWithMentions(children, undefined, {
              allowMentionEscapes: true,
            })}
          </code>
        );
      },
    }),
    [],
  );
};

function getStyles({
  hasErrorStyle,
  isFinalReply,
  theme,
  isCompleted,
  animationConfig,
  awaitingResponse,
  renderTimestamp,
}: {
  hasErrorStyle: string | boolean | undefined;
  isFinalReply: boolean;
  theme: Theme;
  isCompleted: boolean;
  animationConfig: AnimationConfig;
  awaitingResponse: boolean;
  renderTimestamp: boolean | undefined;
}) {
  const { reply, replyBorder, inlineCode } = theme.palette.conversationSurface;
  const outline = `1px solid ${replyBorder}`;

  const completedFade = {
    opacity: isCompleted ? 0.7 : 1,
    transition: `opacity ${0.3 / animationConfig.speedMultiplier}s ease`,
  };
  const flatShell = {
    border: "none",
    boxShadow: "none",
    color: theme.palette.text.primary,
  };
  // A completed reply fades its content only, so the gray stays at full
  // strength.
  const replyShell = {
    ...flatShell,
    backgroundColor: reply,
    borderRadius: 1,
    px: { xs: 1.5, sm: 2.5 },
    py: { xs: 1.5, sm: 2 },
    "& > *": completedFade,
  };
  // Notices, monitor messages and narration style this plain shell themselves.
  const plainShell = {
    ...flatShell,
    ...completedFade,
    backgroundColor: "transparent",
  };
  const errorShell = { ...completedFade, ...getErrorShellStyle(theme) };
  const messageShell = isFinalReply ? replyShell : plainShell;

  return {
    base: {
      display: "inline-flex",
      maxWidth: SYSTEM_MESSAGE_MAX_WIDTH,
      boxSizing: "border-box",
      flexDirection: "column",
      mb: renderTimestamp ? 0 : 3,
      ...(hasErrorStyle ? errorShell : messageShell),
    },
    report: {
      bgcolor: reply,
      color: "text.primary",
      borderRadius: isFinalReply ? 1 : 3,
      border: isFinalReply ? outline : "none",
      p: { xs: 1.5, sm: 2 },
    },
    inner: {
      width: "100%",
      minWidth: 0,
      maxWidth: "100%",
      minHeight: "25px",
      display: "flex",
      alignItems: "flex-start",
      "& .system-message-markdown": {
        width: "100%",
        fontFamily: [
          '"Tilt Neon"',
          '"Fira Code"',
          '"Source Code Pro"',
          '"SF Mono"',
          '"Cascadia Code"',
          '"Consolas"',
          "monospace",
        ].join(","),
        fontSize: "1.1rem",
        lineHeight: 1.6,
        fontWeight: awaitingResponse ? 500 : 400,
        color: "inherit",
        minWidth: 0,
        maxWidth: "100%",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        whiteSpace: "normal",
        "& p": {
          margin: "20px 0",
        },
        "& p:first-of-type": {
          marginTop: 0,
        },
        "& p:last-of-type": {
          marginBottom: 0,
        },
        "& ul, & ol": {
          paddingLeft: { xs: 2.5, sm: 3 },
          marginTop: 0.5,
          marginBottom: 0.5,
        },
        "& li": {
          marginBottom: 2,
        },
        "& pre": {
          backgroundColor: `var(${SYSTEM_MESSAGE_CODE_BLOCK_BG_VAR}, ${reply})`,
          border: isFinalReply ? outline : "none",
          borderRadius: 1,
          padding: 1,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
        },
        "& code": {
          backgroundColor: `var(${SYSTEM_MESSAGE_INLINE_CODE_BG_VAR}, ${inlineCode})`,
          borderRadius: "4px",
          padding: "0 4px",
          fontSize: "0.95em",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        },
        ...(isFinalReply ? replyMarkdownStyles : {}),
        "& a": {
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        },
        "& blockquote": {
          borderLeft: `3px solid ${theme.palette.primary.main}`,
          paddingLeft: 2,
          my: 1,
          color:
            theme.palette.mode === "dark"
              ? theme.palette.grey[200]
              : theme.palette.grey[700],
        },
        "& h1, & h2, & h3, & h4, & h5, & h6": {
          fontWeight: 600,
          marginTop: 1,
          marginBottom: 1,
        },
      },
    },
  };
}

const replyMarkdownStyles = {
  // The inline code fill would shade each line of a code block.
  "& pre code": { backgroundColor: "transparent", padding: 0 },
  // Keeps an outlined code block off the text above it.
  "& * + pre": { marginTop: 1.5 },
  // The reply's padding is the only space below its last block.
  "& ul:last-child, & ol:last-child, & pre:last-child": { marginBottom: 0 },
  "& ul:last-child > li:last-child, & ol:last-child > li:last-child": {
    marginBottom: 0,
  },
};

function getErrorShellStyle(theme: Theme) {
  const isDark = theme.palette.mode === "dark";
  return {
    minWidth: "120px",
    p: { xs: 1.25, sm: 2 },
    minHeight: "80px",
    borderRadius: 1,
    backgroundColor: isDark ? "#3D3730" : "#F5F1ED",
    border: isDark ? "2px solid #5D4E42" : "2px solid #D4C4B0",
    boxShadow: isDark
      ? "0 4px 12px rgba(93, 78, 66, 0.4)"
      : "0 4px 12px rgba(212, 196, 176, 0.3)",
    color: isDark ? "#E8DDD4" : "#5D4E42",
  };
}

function composeSx(
  base: SxStyle,
  sx: React.ComponentProps<typeof Box>["sx"],
): SxProps<Theme> {
  if (Array.isArray(sx)) {
    return [base, ...sx];
  }

  if (isSxStyle(sx)) {
    return [base, sx];
  }

  return base;
}

type SxStyle = Exclude<SxProps<Theme>, readonly unknown[] | boolean>;

function isSxStyle(
  value: React.ComponentProps<typeof Box>["sx"],
): value is SxStyle {
  return (
    (typeof value === "function" || typeof value === "object") &&
    value !== null &&
    !Array.isArray(value)
  );
}
