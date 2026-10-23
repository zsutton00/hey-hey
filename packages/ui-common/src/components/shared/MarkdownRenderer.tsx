import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { styled } from "@mui/material/styles";
import React, { useMemo } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  formatMention,
  splitContentByMentions,
  type MentionParseOptions,
} from "../../utils/mentionFormatting";
import {
  MentionBadgeInner,
  type MentionMode,
} from "../SmarterTextAreaCard/MentionBadge";
import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";
import { FileReferenceLink } from "../SmarterTextAreaCard/fileReferences/FileReferenceLink";
import { parseFileReferenceMarkdownParts } from "../SmarterTextAreaCard/fileReferences/fileReferenceMarkdown";
import { renderMentionNode } from "./WorkflowMentionInlineRenderer";
import { MentionCopyBoundary } from "./MentionCopyBoundary";

export interface MarkdownRendererMentionConfig {
  organizationId: string;
  projectId: string;
  navigate?: (url: string) => void;
}

export type MarkdownRendererProps = React.ComponentProps<
  typeof ReactMarkdown
> & {
  sx?: SxProps<Theme>;
  mentionConfig?: MarkdownRendererMentionConfig;
  mentionMode?: MentionMode;
  disableMentionLinks?: boolean;
  /**
   * Tolerate agent-emitted escaped mention tokens (`@\[...\|...]` and further
   * escaped variants). Off by default so user-authored surfaces stay strict;
   * turn on only for system-authored surfaces where the user can't fix
   * upstream content.
   */
  allowMentionEscapes?: boolean;
  /**
   * Render every mention as its text badge, skipping inline visual surfaces
   * such as diagrams, mockups, workflows and reports.
   */
  badgeMentions?: boolean;
};

type MarkdownAnchorComponent = Exclude<
  NonNullable<Components["a"]>,
  keyof React.JSX.IntrinsicElements
>;
type MarkdownAnchorProps = React.ComponentProps<MarkdownAnchorComponent>;

const SUPPORTED_FILE_REFERENCE_DESTINATION_PREFIX = "heyhey-file:v1:";

const markdownChildrenToText = (
  children: React.ReactNode
): string | null => {
  const textChildren = React.Children.toArray(children);
  if (
    textChildren.some(
      (child) => typeof child !== "string" && typeof child !== "number"
    )
  ) {
    return null;
  }

  return textChildren.map(String).join("");
};

const createFileReferenceAwareAnchor = (
  anchorComponent: Components["a"] | undefined
): NonNullable<Components["a"]> => {
  const FileReferenceAwareAnchor = ({
    children,
    href,
    ...props
  }: MarkdownAnchorProps) => {
    const value = parseFileReferenceMarkdownParts(
      markdownChildrenToText(children) ?? "",
      href ?? ""
    );

    if (value) {
      return <FileReferenceLink value={value} />;
    }

    const anchorProps = { ...props, href, children };
    const Anchor = anchorComponent ?? "a";
    if (typeof Anchor === "string") {
      const { node: _node, ...intrinsicAnchorProps } = anchorProps;
      return React.createElement(Anchor, intrinsicAnchorProps);
    }

    return React.createElement(Anchor, anchorProps);
  };

  FileReferenceAwareAnchor.displayName = "FileReferenceAwareAnchor";
  return FileReferenceAwareAnchor;
};

const createFileReferenceAwareUrlTransform = (
  urlTransform: MarkdownRendererProps["urlTransform"]
): UrlTransform => {
  const delegate = urlTransform ?? defaultUrlTransform;

  return (url, key, node) => {
    if (
      key === "href" &&
      url.startsWith(SUPPORTED_FILE_REFERENCE_DESTINATION_PREFIX)
    ) {
      return url;
    }

    return delegate(url, key, node);
  };
};

const MarkdownRendererContainer = styled(Box)(({ theme }) => ({
  color: theme.palette.text.primary,
  fontFamily: "inherit",
  fontSize: "1.125rem",
  lineHeight: 1.6,
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  "& p": {
    margin: 0,
    marginBottom: "8px",
    position: "relative",
    "&:last-child": {
      marginBottom: 0,
    },
  },
  "& h1, & h2, & h3, & h4, & h5, & h6": {
    fontWeight: "600",
    marginTop: "1em",
    marginBottom: "0.5em",
    color: theme.palette.text.primary,
  },
  "& h1, & h2, & h3": {
    margin: "24px 0 16px 0",
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    fontWeight: "500",
    lineHeight: 1.2,
    color: theme.palette.text.primary,
    borderBottom: `1px solid ${theme.palette.divider}`,
    paddingBottom: "8px",
  },
  "& h1": {
    fontSize: "2rem",
    marginTop: "32px",
  },
  "& h2": {
    fontSize: "1.5rem",
    marginTop: "24px",
  },
  "& h3": {
    fontSize: "1.25rem",
    marginTop: "20px",
  },
  "& h4": { fontSize: "1.25em" },
  "& h5": { fontSize: "1.1em" },
  "& h6": { fontSize: "1em" },
  "& ul, & ol": {
    paddingLeft: "1.5em",
    marginTop: "0.5em",
    marginBottom: "0.5em",
  },
  "& li": {
    marginBottom: "0.25em",
  },
  "& blockquote": {
    borderLeft: `4px solid ${theme.palette.primary.main}`,
    paddingLeft: "1em",
    marginLeft: 0,
    marginRight: 0,
    fontStyle: "italic",
    color: theme.palette.text.secondary,
  },
  "& code": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.1)"
        : "rgba(0, 0, 0, 0.1)",
    padding: "2px 4px",
    borderRadius: "3px",
    fontSize: "0.9em",
    fontFamily: "monospace",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  "& pre": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.05)"
        : "rgba(0, 0, 0, 0.05)",
    padding: "1em",
    borderRadius: "6px",
    overflow: "auto",
    lineHeight: 1.45,
    maxWidth: "100%",
    whiteSpace: "pre-wrap",
    "& code": {
      backgroundColor: "transparent",
      padding: 0,
      lineHeight: "inherit",
    },
  },
  "& table": {
    borderCollapse: "collapse",
    display: "block",
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
    marginTop: "0.5em",
    marginBottom: "0.5em",
  },
  "& th, & td": {
    border: `1px solid ${theme.palette.divider}`,
    padding: "8px 12px",
    textAlign: "left",
  },
  "& th": {
    fontWeight: 600,
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.05)"
        : "rgba(0, 0, 0, 0.04)",
  },
  "& tr:nth-of-type(even)": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.02)"
        : "rgba(0, 0, 0, 0.02)",
  },
  "& a": {
    color: theme.palette.primary.main,
    textDecoration: "underline",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    "&:hover": {
      color: theme.palette.primary.dark,
    },
  },
  "& img": {
    maxWidth: "100%",
    height: "auto",
  },
  "& ins": {
    color: theme.palette.mode === "dark" ? "#81c784" : "#2e7d32",
    textDecoration: "none",
    fontWeight: 500,
  },
  "& del": {
    color: theme.palette.mode === "dark" ? "#e57373" : "#c62828",
    opacity: 0.8,
  },
  "& .diff-text": {
    borderRadius: "3px",
    padding: "1px 2px",
    margin: "0 1px",
    position: "relative",
  },
  "& .diff-text--addition": {
    backgroundColor: theme.palette.success.light,
    color: theme.palette.success.contrastText,
    "&.diff-text--system": {
      backgroundColor: theme.palette.success.main,
      opacity: 0.8,
    },
    "&.diff-text--user": {
      backgroundColor: theme.palette.success.light,
      opacity: 0.9,
    },
  },
  "& .diff-text--deletion": {
    backgroundColor: theme.palette.error.light,
    color: theme.palette.error.contrastText,
    textDecoration: "line-through",
    "&.diff-text--system": {
      backgroundColor: theme.palette.error.main,
      opacity: 0.8,
    },
    "&.diff-text--user": {
      backgroundColor: theme.palette.error.light,
      opacity: 0.9,
    },
  },
  "& .diff-text--replacement": {
    backgroundColor: theme.palette.warning.light,
    color: theme.palette.warning.contrastText,
    "&.diff-text--system": {
      backgroundColor: theme.palette.warning.main,
      opacity: 0.8,
    },
    "&.diff-text--user": {
      backgroundColor: theme.palette.warning.light,
      opacity: 0.9,
    },
  },
  "& .diff-text--equal": {
    backgroundColor: "transparent",
  },
}));

const BLOCK_MENTION_ENTITY_TYPES = new Set(["workflow", "report"]);

/**
 * Escape markdown syntax inside mention tokens so remark doesn't interpret
 * backticks, brackets, asterisks, pipes, etc. as formatting and split the
 * token across multiple elements.
 *
 * The pipe matters specifically for GFM tables: an unescaped `|` inside a
 * mention token that lands in a table cell is read by remark-gfm as a column
 * delimiter, adding spurious cells and shifting content. Escaping it as `\|`
 * makes remark-gfm treat it as literal cell content; outside a table `\|` is
 * ordinary CommonMark punctuation escaping. In both cases remark consumes the
 * backslash during parsing, so the post-parse text node still carries a clean
 * `@[type:id|title]` token that MENTION_TOKEN_REGEX matches unchanged.
 *
 * When `allowMentionEscapes` is on, agent-emitted tokens that already carry
 * backslashes before `[` and/or `|` are first normalized back to the canonical
 * `@[type:id|title]` form via the captured groups, then re-escaped through the
 * same path — so we never double-escape an already-escaped token.
 *
 * Exported for unit testing.
 */
export function escapeMentionTokens(
  content: string,
  opts?: MentionParseOptions
): string {
  return splitContentByMentions(content, opts)
    .map((segment) => {
      if (segment.type === "text") return segment.text;

      return formatMention(segment.mention)
        .replace(/([`*~\\|])/g, "\\$1")
        .replace(/@\[/g, "@\\[");
    })
    .join("");
}

/** Replace mention tokens in React children with MentionBadge components */
export function renderWithMentions(
  children: React.ReactNode,
  mentionMode?: MentionMode,
  opts?: MentionParseOptions & { disableMentionLinks?: boolean; badgeMentions?: boolean }
): React.ReactNode {
  // Merge adjacent string children so mention tokens that the markdown
  // parser splits across text nodes (e.g. "@" + "[task:id|name]") are
  // reassembled before regex matching.
  const raw = React.Children.toArray(children);
  const merged: React.ReactNode[] = [];
  for (const child of raw) {
    if (
      typeof child === "string" &&
      merged.length > 0 &&
      typeof merged[merged.length - 1] === "string"
    ) {
      merged[merged.length - 1] = (merged[merged.length - 1] as string) + child;
    } else {
      merged.push(child);
    }
  }

  return merged.map((child, idx) => {
    if (typeof child !== "string") return child;
    const segments = splitContentByMentions(child, opts);
    if (segments.length === 1 && segments[0].type === "text") return child;
    return (
      <React.Fragment key={idx}>
        {segments.map((seg, i) =>
          seg.type === "mention" ? (
            <React.Fragment key={i}>
              {opts?.disableMentionLinks
                ? seg.mention.entityName
                : opts?.badgeMentions
                ? <MentionBadgeInner mention={seg.mention} mode={mentionMode} />
                : renderMentionNode(seg.mention, mentionMode)}
            </React.Fragment>
          ) : (
            <React.Fragment key={i}>{seg.text}</React.Fragment>
          )
        )}
      </React.Fragment>
    );
  });
}

const childrenContainBlockMention = (
  children: React.ReactNode,
  opts?: MentionParseOptions
): boolean => {
  const raw = React.Children.toArray(children);
  const merged: React.ReactNode[] = [];
  for (const child of raw) {
    if (
      typeof child === "string" &&
      merged.length > 0 &&
      typeof merged[merged.length - 1] === "string"
    ) {
      merged[merged.length - 1] = (merged[merged.length - 1] as string) + child;
    } else {
      merged.push(child);
    }
  }

  return merged.some((child) => {
    if (typeof child !== "string") {
      return false;
    }

    return splitContentByMentions(child, opts).some(
      (segment) =>
        segment.type === "mention" &&
        BLOCK_MENTION_ENTITY_TYPES.has(segment.mention.entityType)
    );
  });
};

/** Wrap an HTML tag so mention tokens in its children render as badges */
function withMentions(
  Tag: keyof React.JSX.IntrinsicElements,
  mentionMode?: MentionMode,
  opts?: MentionParseOptions & { disableMentionLinks?: boolean; badgeMentions?: boolean }
): React.FC<React.HTMLAttributes<HTMLElement> & { node?: unknown }> {
  const Component = ({
    node: _node,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement> & { node?: unknown }) => {
    const resolvedTag =
      Tag === "p" && childrenContainBlockMention(children, opts) ? "div" : Tag;

    return React.createElement(
      resolvedTag,
      props,
      renderWithMentions(children, mentionMode, opts)
    );
  };
  Component.displayName = `WithMentions(${Tag})`;
  return Component;
}

function buildMentionComponents(
  mentionMode?: MentionMode,
  opts?: MentionParseOptions & { disableMentionLinks?: boolean; badgeMentions?: boolean }
): Components {
  return {
    p: withMentions("p", mentionMode, opts),
    li: withMentions("li", mentionMode, opts),
    h1: withMentions("h1", mentionMode, opts),
    h2: withMentions("h2", mentionMode, opts),
    h3: withMentions("h3", mentionMode, opts),
    h4: withMentions("h4", mentionMode, opts),
    h5: withMentions("h5", mentionMode, opts),
    h6: withMentions("h6", mentionMode, opts),
    td: withMentions("td", mentionMode, opts),
    th: withMentions("th", mentionMode, opts),
    em: withMentions("em", mentionMode, opts),
    strong: withMentions("strong", mentionMode, opts),
    blockquote: withMentions("blockquote", mentionMode, opts),
    code: withMentions("code", mentionMode, opts),
  };
}

// MarkdownRenderer escapes canonical mention tokens before handing content to
// remark. Some parse paths preserve those backslashes in text nodes, so the
// renderer's component pass accepts that safe escaped form.
const MENTION_COMPONENTS = buildMentionComponents(undefined, {
  allowMentionEscapes: true,
});

const MarkdownRendererBase: React.FC<MarkdownRendererProps> = ({
  sx,
  mentionConfig,
  mentionMode,
  disableMentionLinks,
  allowMentionEscapes,
  badgeMentions,
  ...markdownProps
}) => {
  // MentionBadgeInner now reads from ProjectContext directly.
  // mentionConfig is kept as an optional override that wraps content
  // in a MentionEditorContext for callers that need explicit control.
  const mentionContextValue = useMemo(() => {
    if (!mentionConfig?.navigate) return null;
    return {
      organizationId: mentionConfig.organizationId,
      projectId: mentionConfig.projectId,
      navigate: mentionConfig.navigate,
    };
  }, [
    mentionConfig?.organizationId,
    mentionConfig?.projectId,
    mentionConfig?.navigate,
  ]);

  const mentionComponents = useMemo(
    () =>
      mentionMode || allowMentionEscapes || disableMentionLinks || badgeMentions
        ? buildMentionComponents(mentionMode, {
            allowMentionEscapes: true,
            disableMentionLinks,
            badgeMentions,
          })
        : MENTION_COMPONENTS,
    [mentionMode, allowMentionEscapes, disableMentionLinks, badgeMentions]
  );

  const components = useMemo(() => {
    return {
      ...mentionComponents,
      ...markdownProps.components,
      a: createFileReferenceAwareAnchor(markdownProps.components?.a),
    };
  }, [mentionComponents, markdownProps.components]);

  const urlTransform = useMemo(
    () => createFileReferenceAwareUrlTransform(markdownProps.urlTransform),
    [markdownProps.urlTransform]
  );

  const processedChildren = useMemo(() => {
    if (typeof markdownProps.children !== "string") {
      return markdownProps.children;
    }
    return escapeMentionTokens(markdownProps.children, { allowMentionEscapes });
  }, [markdownProps.children, allowMentionEscapes]);

  const content = (
    <MentionCopyBoundary>
      <MarkdownRendererContainer sx={sx}>
        <ReactMarkdown
          {...markdownProps}
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={components}
          urlTransform={urlTransform}
          children={processedChildren}
        />
      </MarkdownRendererContainer>
    </MentionCopyBoundary>
  );

  if (mentionContextValue) {
    return (
      <MentionEditorContext.Provider value={mentionContextValue}>
        {content}
      </MentionEditorContext.Provider>
    );
  }

  return content;
};

export const MarkdownRenderer: React.NamedExoticComponent<MarkdownRendererProps> =
  React.memo(MarkdownRendererBase);
