import { useTheme } from "@mui/material";
import React, { Suspense, useMemo } from "react";
import type { Components } from "react-markdown";
import { renderWithMentions } from "./MarkdownRenderer";

const MARKDOWN_RENDERER_MENTION_PARSE_OPTIONS = {
  allowMentionEscapes: true,
} as const;

const MermaidCodeBlock = React.lazy(() =>
  import("./MermaidCodeBlock").then((mod) => ({
    default: mod.MermaidCodeBlock,
  }))
);

const MERMAID_LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-mermaid(?:\s|$)/;

interface ReadViewAnchorProps extends React.ComponentProps<"a"> {
  node?: unknown;
}

interface ReadViewListItemProps extends React.ComponentProps<"li"> {
  node?: unknown;
  children?: React.ReactNode;
}

interface ReadViewCodeProps extends React.ComponentProps<"code"> {
  node?: unknown;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const flattenListItemChildren = (children: React.ReactNode): React.ReactNode =>
  React.Children.map(children, (child) => {
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

const isMermaidCodeFence = (
  inline: boolean | undefined,
  className: string | undefined
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

export const useReadViewMarkdownComponents = (): Components => {
  const theme = useTheme();

  return useMemo<Components>(
    () => ({
      a: ({ node: _node, ...props }: ReadViewAnchorProps) => (
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
      li: ({ node: _node, children, ...props }: ReadViewListItemProps) => (
        <li {...props}>
          {renderWithMentions(
            flattenListItemChildren(children),
            undefined,
            MARKDOWN_RENDERER_MENTION_PARSE_OPTIONS
          )}
        </li>
      ),
      code: ({
        node: _node,
        inline,
        className,
        children,
        ...props
      }: ReadViewCodeProps) => {
        if (isMermaidCodeFence(inline, className)) {
          return (
            <Suspense
              fallback={
                <code {...props}>
                  {renderWithMentions(
                    children,
                    undefined,
                    MARKDOWN_RENDERER_MENTION_PARSE_OPTIONS
                  )}
                </code>
              }
            >
              <MermaidCodeBlock code={codeChildrenToString(children)} />
            </Suspense>
          );
        }

        return (
          <code {...props} className={className}>
            {renderWithMentions(
              children,
              undefined,
              MARKDOWN_RENDERER_MENTION_PARSE_OPTIONS
            )}
          </code>
        );
      },
    }),
    [theme.palette.primary.main]
  );
};
