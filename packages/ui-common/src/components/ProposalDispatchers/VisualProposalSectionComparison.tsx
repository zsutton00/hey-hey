import {
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import type { WorkItemTypeSectionDefinition } from "../../api";
import type { MockupPageSource } from "../../utils/mockupPageUrl";
import { HtmlCssSectionRenderer } from "../shared/HtmlCssSectionRenderer";
import { StructuredMockupSectionRenderer } from "../shared/StructuredMockupSectionRenderer";

type VisualSectionKind = "html/css" | "structured-mockup";
type ComparisonState = "before" | "after";

interface VisualProposalSectionComparisonProps {
  kind: VisualSectionKind;
  label: string;
  definition: WorkItemTypeSectionDefinition;
  before: unknown;
  after: unknown;
  organizationId?: string;
  projectId?: string;
  materializedProposalId?: string;
  /** Where the pencil reads the proposed ("after") mockup from; "before" has no pencil. */
  proposedMockupSource?: MockupPageSource;
}

const comparisonStates = ["before", "after"] as const;

export const VisualProposalSectionComparison: React.FC<
  VisualProposalSectionComparisonProps
> = ({
  kind,
  label,
  definition,
  before,
  after,
  organizationId,
  projectId,
  materializedProposalId,
  proposedMockupSource,
}) => {
  const [comparisonState, setComparisonState] =
    useState<ComparisonState>("after");
  const selectedContent = comparisonState === "before" ? before : after;

  return (
    <Stack
      spacing={1}
      data-testid="visual-proposal-section-comparison"
      data-section-kind={kind}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="flex-start"
      >
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={comparisonState}
          onChange={(_event, nextState: ComparisonState | null) => {
            if (nextState) setComparisonState(nextState);
          }}
          aria-label={`${label} comparison`}
          data-testid="visual-proposal-comparison-controls"
        >
          {comparisonStates.map((state) => (
            <ToggleButton
              key={state}
              value={state}
              aria-label={`Show ${state} ${label}`}
              data-testid={
                state === "before"
                  ? "visual-proposal-comparison-before"
                  : "visual-proposal-comparison-after"
              }
            >
              {state === "before" ? "Before" : "After"}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      <Stack
        sx={{ width: "100%" }}
        data-testid="visual-proposal-comparison-preview"
        data-comparison-state={comparisonState}
      >
        {kind === "html/css" ? (
          <HtmlCssSectionRenderer
            content={selectedContent}
            definition={definition}
            context="inline"
            title={`${label} ${comparisonState} preview`}
            organizationId={organizationId}
            projectId={projectId}
            materializedProposalId={materializedProposalId}
            mockupSource={
              comparisonState === "after" ? proposedMockupSource : undefined
            }
          />
        ) : (
          <StructuredMockupSectionRenderer
            content={selectedContent}
            definition={definition}
            context="inline"
          />
        )}
      </Stack>
    </Stack>
  );
};
