import React from "react";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";

/** Prose of a change walkthrough. */
export const WalkthroughMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <MarkdownRenderer mentionMode="minimal" sx={{ fontSize: "0.875rem" }}>
    {text}
  </MarkdownRenderer>
);
