import DecisionIcon from "@mui/icons-material/LightbulbOutlined";
import { Box, Typography } from "@mui/material";
import React, { useCallback, useState } from "react";
import type { LocatedDecision } from "./locatedDecisions";

export interface DiffDecisionAnnotationProps {
  decision: LocatedDecision;
  /**
   * When provided, `data-testid` attributes are emitted for the annotation and
   * its parts. Omitted for the hidden alignment spacer rendered in the Before
   * pane, which must carry no test hooks of its own.
   */
  testId?: string;
}

/**
 * A compact, presentational annotation for a single located IMPLEMENT-report
 * decision. Topic and choice are always shown inline; reasoning (when present)
 * is revealed on hover or by clicking to expand. The reasoning panel is
 * absolutely positioned so revealing it never shifts surrounding diff rows.
 */
export const DiffDecisionAnnotation: React.FC<DiffDecisionAnnotationProps> = ({
  decision,
  testId,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const hasReasoning = Boolean(decision.reasoning);
  const showReasoning = hasReasoning && (expanded || hovered);

  const toggleExpanded = useCallback(() => {
    if (!hasReasoning) return;
    setExpanded((prev) => !prev);
  }, [hasReasoning]);

  return (
    <Box
      {...(testId ? { "data-testid": testId } : {})}
      onClick={toggleExpanded}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        position: "relative",
        my: 0.5,
        px: 1,
        py: 0.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        whiteSpace: "normal",
        cursor: hasReasoning ? "pointer" : "default",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <DecisionIcon
          sx={{ fontSize: 14, color: "text.secondary", flexShrink: 0 }}
        />
        <Typography
          {...(testId ? { "data-testid": `${testId}-topic` } : {})}
          variant="caption"
          sx={{ fontWeight: 600, lineHeight: 1.4 }}
        >
          {decision.topic}
        </Typography>
      </Box>
      <Typography
        {...(testId ? { "data-testid": `${testId}-choice` } : {})}
        variant="caption"
        sx={{ display: "block", color: "text.secondary", lineHeight: 1.4 }}
      >
        {decision.choice}
      </Typography>
      {showReasoning && decision.reasoning ? (
        <Box
          {...(testId ? { "data-testid": `${testId}-reasoning` } : {})}
          sx={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 3,
            mt: 0.25,
            px: 1,
            py: 0.5,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "background.paper",
            boxShadow: 3,
          }}
        >
          <Typography
            variant="caption"
            sx={{ display: "block", color: "text.secondary", lineHeight: 1.4 }}
          >
            {decision.reasoning}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
};
