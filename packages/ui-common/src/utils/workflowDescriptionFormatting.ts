import {
  formatMention,
  splitContentByMentions,
  type MentionContentSegment,
} from "./mentionFormatting";

export const WORKFLOW_COMPACT_DESCRIPTION_MAX_LENGTH = 180;
const WORKFLOW_DESCRIPTION_ELLIPSIS = "...";

const segmentDisplayText = (segment: MentionContentSegment): string =>
  segment.type === "mention" ? segment.mention.entityName : segment.text;

const segmentMarkdown = (segment: MentionContentSegment): string =>
  segment.type === "mention" ? formatMention(segment.mention) : segment.text;

const getDisplayLength = (segments: MentionContentSegment[]): number =>
  segments.reduce(
    (length, segment) => length + segmentDisplayText(segment).length,
    0
  );

const renderSegmentsAsMarkdown = (segments: MentionContentSegment[]): string =>
  segments.map(segmentMarkdown).join("");

export const formatWorkflowCompactDescription = (content: string): string => {
  const segments = splitContentByMentions(content.trim(), {
    allowMentionEscapes: true,
  });
  const displayLength = getDisplayLength(segments);
  if (displayLength === 0) {
    return "";
  }

  if (displayLength <= WORKFLOW_COMPACT_DESCRIPTION_MAX_LENGTH) {
    return renderSegmentsAsMarkdown(segments).trim();
  }

  const truncatedSegments: string[] = [];
  let remaining =
    WORKFLOW_COMPACT_DESCRIPTION_MAX_LENGTH -
    WORKFLOW_DESCRIPTION_ELLIPSIS.length;

  for (const segment of segments) {
    if (remaining <= 0) {
      break;
    }

    const displayText = segmentDisplayText(segment);
    if (displayText.length <= remaining) {
      truncatedSegments.push(segmentMarkdown(segment));
      remaining -= displayText.length;
      continue;
    }

    truncatedSegments.push(displayText.slice(0, remaining));
    break;
  }

  return `${truncatedSegments
    .join("")
    .trimEnd()}${WORKFLOW_DESCRIPTION_ELLIPSIS}`;
};

export const formatWorkflowMentionDescription = (content: string): string =>
  renderSegmentsAsMarkdown(
    splitContentByMentions(content.trim(), {
      allowMentionEscapes: true,
    })
  ).trim();
