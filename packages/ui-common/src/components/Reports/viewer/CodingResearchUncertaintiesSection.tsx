import { Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type { CodingResearchUncertainty } from "../../../api";
import {
  UNCERTAINTY_CATEGORY_LABELS,
  UncertaintyItem,
} from "../../Uncertainties";
import { ReportEntityMention, ReportPanel } from "./reportPrimitives";

export interface CodingResearchUncertaintiesSectionProps {
  uncertainties: CodingResearchUncertainty[];
  reportTestId: string;
}

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
        <Typography variant="subtitle2">Open questions</Typography>
        {categories.map((category) => (
          <ReportPanel
            key={category}
            testId={`${reportTestId}-coding-research-uncertainties-${category}`}
            title={UNCERTAINTY_CATEGORY_LABELS[category]}
          >
            <Stack spacing={1}>
              {uncertainties
                .filter((uncertainty) => uncertainty.category === category)
                .map((uncertainty, index) => (
                  <UncertaintyItem
                    key={`${category}-${index}`}
                    testId={`${reportTestId}-coding-research-uncertainty-${category}-${index}`}
                    severity={uncertainty.severity}
                    category={uncertainty.category}
                    statement={uncertainty.statement}
                  >
                    <Stack spacing={0.5}>
                      {uncertainty.references.map((reference) => (
                        <ReportEntityMention
                          key={`${reference.entityType}-${reference.entityId}`}
                          entityId={reference.entityId}
                          entityName={reference.title}
                          entityType={reference.entityType}
                        />
                      ))}
                    </Stack>
                  </UncertaintyItem>
                ))}
            </Stack>
          </ReportPanel>
        ))}
      </Stack>
    </Paper>
  );
};
