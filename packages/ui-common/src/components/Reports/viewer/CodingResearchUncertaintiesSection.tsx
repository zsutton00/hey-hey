import { Chip, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type { CodingResearchUncertainty } from "../../../api";
import {
  ReportEntityMention,
  ReportItemCard,
  ReportPanel,
} from "./reportPrimitives";

export interface CodingResearchUncertaintiesSectionProps {
  uncertainties: CodingResearchUncertainty[];
  reportTestId: string;
}

const CATEGORY_LABELS: Record<CodingResearchUncertainty["category"], string> = {
  lack_of_evidence: "Lack of evidence",
  conflict: "Conflict",
  ambiguity: "Ambiguity",
  not_implemented: "Not implemented",
};

export const CodingResearchUncertaintiesSection: React.FC<
  CodingResearchUncertaintiesSectionProps
> = ({ uncertainties, reportTestId }) => {
  if (uncertainties.length === 0) {
    return null;
  }

  const categories = [
    ...new Set(uncertainties.map(({ category }) => category)),
  ];
  return (
    <Paper
      data-testid={`${reportTestId}-coding-research-uncertainties`}
      sx={{ p: 1.5, backgroundColor: "action.hover" }}
      variant="outlined"
    >
      <Stack spacing={1.25}>
        <Typography variant="subtitle2">Uncertainties</Typography>
        {categories.map((category) => (
          <ReportPanel
            key={category}
            testId={`${reportTestId}-coding-research-uncertainties-${category}`}
            title={CATEGORY_LABELS[category]}
          >
            <Stack spacing={1}>
              {uncertainties
                .filter((uncertainty) => uncertainty.category === category)
                .map((uncertainty, index) => (
                  <ReportItemCard
                    key={`${category}-${index}`}
                    testId={`${reportTestId}-coding-research-uncertainty-${category}-${index}`}
                    title={uncertainty.statement}
                    secondaries={uncertainty.references.map((reference) => (
                      <ReportEntityMention
                        key={`${reference.entityType}-${reference.entityId}`}
                        entityId={reference.entityId}
                        entityName={reference.title}
                        entityType={reference.entityType}
                      />
                    ))}
                    trailing={
                      <Chip label={uncertainty.severity} size="small" />
                    }
                  />
                ))}
            </Stack>
          </ReportPanel>
        ))}
      </Stack>
    </Paper>
  );
};
