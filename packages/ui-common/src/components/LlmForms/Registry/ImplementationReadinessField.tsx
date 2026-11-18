import FactCheckOutlined from "@mui/icons-material/FactCheckOutlined";
import HelpOutline from "@mui/icons-material/HelpOutline";
import { Box, Chip, Typography } from "@mui/material";
import React from "react";
import type { ImplementationReadinessFinding } from "../../../api";
import {
  ConversationCard,
  ConversationCardRelatedRows,
  ConversationCardSection,
} from "../../Conversation/Card";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import type { FieldComponentProps } from "./types";
import {
  buildLegacyFindingMarkdown,
  fixStepStateMarker,
  isExplainedFinding,
  isImplementationReadinessPayload,
  itemReferenceToMention,
} from "./implementationReadinessUtils";

const ReadinessAskBlock: React.FC<{ userRequest: string }> = ({
  userRequest,
}) => (
  <Box
    data-testid="implementation-readiness-ask"
    sx={(theme) => {
      const role = theme.palette.conversationCard.roles.needsAnswer;

      return {
        border: `2px solid ${role.main}`,
        backgroundColor: role.soft,
        borderRadius: "8px",
        p: 1.5,
      };
    }}
  >
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
      <HelpOutline
        fontSize="small"
        sx={(theme) => ({
          color: theme.palette.conversationCard.roles.needsAnswer.main,
        })}
      />
      <Typography
        component="div"
        data-testid="implementation-readiness-ask-label"
        sx={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "text.secondary",
        }}
      >
        What I need from you
      </Typography>
    </Box>
    <Typography variant="body2">{userRequest}</Typography>
  </Box>
);

const ExplainedFindingBody: React.FC<{
  finding: ImplementationReadinessFinding;
}> = ({ finding }) => (
  <>
    <ConversationCardSection label="What you asked for">
      <Typography variant="body2">{finding.requestedOutcome}</Typography>
    </ConversationCardSection>
    <ConversationCardSection label="How the agent got here">
      <ConversationCardRelatedRows
        numbered
        rows={finding.reasoningTrail.map((entry, index) => ({
          key: `trail-${index}`,
          mention: itemReferenceToMention(entry.source),
          reason: entry.explanation,
        }))}
      />
    </ConversationCardSection>
    <ConversationCardSection label="What could go wrong">
      <Box
        component="ol"
        data-testid="implementation-readiness-failure-scenario"
        sx={{ m: 0, pl: 2.5 }}
      >
        {finding.failureScenario.map((step, index) => (
          <Typography component="li" variant="body2" key={index}>
            {step}
          </Typography>
        ))}
      </Box>
    </ConversationCardSection>
    <ConversationCardSection label="Steps to fix">
      <ConversationCardRelatedRows
        numbered
        rows={finding.fixSteps.map((step, index) => ({
          key: `fix-${index}`,
          mention: itemReferenceToMention(step.owner),
          reason: step.action,
          state: fixStepStateMarker(step.state),
        }))}
      />
    </ConversationCardSection>
    <ReadinessAskBlock userRequest={finding.userRequest} />
  </>
);

export const ImplementationReadinessField: React.FC<FieldComponentProps> = ({
  config,
}) => {
  const readinessPayload = isImplementationReadinessPayload(config.payload)
    ? config.payload
    : null;
  const finding = readinessPayload?.disposition.finding ?? null;
  const explained = finding && isExplainedFinding(finding) ? finding : null;

  const renderBody = () => {
    if (explained) {
      return <ExplainedFindingBody finding={explained} />;
    }

    if (finding && !isExplainedFinding(finding)) {
      return (
        <Box data-testid="implementation-readiness-finding">
          <MarkdownRenderer>
            {buildLegacyFindingMarkdown(finding)}
          </MarkdownRenderer>
        </Box>
      );
    }

    return (
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="implementation-readiness-finding-missing"
      >
        The readiness finding is unavailable.
      </Typography>
    );
  };

  return (
    <Box data-field={config.field}>
      <ConversationCard
        data-testid="implementation-readiness-field"
        tone={{ role: "informational" }}
        icon={<FactCheckOutlined fontSize="small" />}
        kindLabel="Readiness review"
        chips={<Chip size="small" variant="outlined" label="Blocks planning" />}
        lead={explained?.problem}
      >
        {renderBody()}
      </ConversationCard>
    </Box>
  );
};
