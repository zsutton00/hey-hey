import React from "react";
import { splitContentByMentions } from "../../utils/mentionFormatting";
import { MentionBadgeInner, type MentionMode } from "./MentionBadge";
import { MentionCopyBoundary } from "../shared/MentionCopyBoundary";

export function renderInlineMentions(
  content: string | null | undefined,
  mentionMode: MentionMode = "minimal",
  options?: { disableLinks?: boolean }
): React.ReactNode {
  if (!content) return content ?? null;

  const segments = splitContentByMentions(content);
  if (segments.length === 1 && segments[0].type === "text") {
    return content;
  }

  return (
    <MentionCopyBoundary component="span">
      {segments.map((segment, index) =>
        segment.type === "mention" ? (
          options?.disableLinks ? (
            <React.Fragment key={index}>
              {segment.mention.entityName}
            </React.Fragment>
          ) : (
            <MentionBadgeInner
              key={index}
              mention={segment.mention}
              mode={mentionMode}
            />
          )
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        )
      )}
    </MentionCopyBoundary>
  );
}
