import { Box, Link, Typography } from "@mui/material";
import React from "react";

import type { HelpTopicListItem } from "./helpContentSource";

/** Stable DOM anchor for a rendered help topic, keyed by its unique slug path. */
export const getHelpTopicAnchorId = (
  topic: Pick<HelpTopicListItem, "slugPath">
): string => `help-topic-${topic.slugPath.replace(/\//g, "--")}`;

export interface HelpTableOfContentsProps {
  topics: readonly HelpTopicListItem[];
}

export const HelpTableOfContents: React.FC<HelpTableOfContentsProps> = ({
  topics,
}) => {
  const scrollToTopic = (
    event: React.MouseEvent<HTMLAnchorElement>,
    anchorId: string
  ): void => {
    event.preventDefault();
    document
      .getElementById(anchorId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Box
      component="nav"
      aria-label="Table of contents"
      data-testid="help-table-of-contents"
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: "block", mb: 1 }}
      >
        Contents
      </Typography>
      <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {topics.map((topic) => {
          const anchorId = getHelpTopicAnchorId(topic);
          return (
            <Box
              component="li"
              key={topic.id}
              data-testid="help-table-of-contents-entry"
              data-depth={topic.depth}
              sx={{ pl: topic.depth * 2, py: 0.5 }}
            >
              <Link
                href={`#${anchorId}`}
                underline="hover"
                color={topic.depth === 0 ? "text.primary" : "text.secondary"}
                variant="body2"
                onClick={(event) => scrollToTopic(event, anchorId)}
              >
                {topic.title}
              </Link>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
