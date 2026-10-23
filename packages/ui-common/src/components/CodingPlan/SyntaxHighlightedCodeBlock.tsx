import { styled } from "@mui/material/styles";
import React from "react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";

Prism.manual = true;

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  css: "css",
};

const CodeBlock = styled("pre")(({ theme }) => ({
  backgroundColor:
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.05)"
      : "rgba(0, 0, 0, 0.05)",
  borderRadius: 6,
  color: theme.palette.text.primary,
  fontFamily: "monospace",
  fontSize: "1em",
  lineHeight: 1.45,
  margin: 0,
  maxWidth: "100%",
  overflow: "auto",
  padding: "1em",
  overflowWrap: "normal",
  tabSize: 2,
  whiteSpace: "pre",
  wordBreak: "normal",
  "& code": {
    tabSize: "inherit",
    whiteSpace: "inherit",
  },
  "& .token.comment, & .token.prolog, & .token.doctype": {
    color: theme.palette.text.secondary,
  },
  "& .token.keyword, & .token.important": {
    color: theme.palette.primary.main,
  },
  "& .token.string, & .token.char, & .token.regex": {
    color: theme.palette.success.main,
  },
  "& .token.number, & .token.boolean, & .token.constant": {
    color: theme.palette.warning.main,
  },
  "& .token.function, & .token.class-name": {
    color: theme.palette.info.main,
  },
  "& .token.operator, & .token.punctuation": {
    color: theme.palette.text.secondary,
  },
}));

export interface SyntaxHighlightedCodeBlockProps {
  code: string;
  language: string;
  testId?: string;
}

const resolveLanguage = (language: string): string | null => {
  const normalized = language.trim().toLowerCase();
  const languageId = LANGUAGE_ALIASES[normalized] ?? normalized;
  return Prism.languages[languageId] ? languageId : null;
};

export const SyntaxHighlightedCodeBlock: React.FC<
  SyntaxHighlightedCodeBlockProps
> = ({ code, language, testId }) => {
  const languageId = resolveLanguage(language);
  const highlightedCode = languageId
    ? Prism.highlight(code, Prism.languages[languageId], languageId)
    : null;

  return (
    <CodeBlock
      data-testid={testId}
      role="region"
      aria-label={`${language} code`}
    >
      <code
        dangerouslySetInnerHTML={
          highlightedCode === null ? undefined : { __html: highlightedCode }
        }
      >
        {highlightedCode === null ? code : undefined}
      </code>
    </CodeBlock>
  );
};
