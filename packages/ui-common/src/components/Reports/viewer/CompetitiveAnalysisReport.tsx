import { Stack, Typography } from "@mui/material";
import type { CompetitiveAnalysisReportPayload } from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const CompetitiveAnalysisReport: ReportRenderer<
  CompetitiveAnalysisReportPayload
> = ({ payload, reportTestId }) => {
  const competitors = payload.competitors ?? [];

  return (
    <Stack data-testid={`${reportTestId}-competitive-analysis`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-competitive-analysis-summary`}
        value={payload.summary}
      />
      {payload.title ? (
        <ReportLabeledText
          label="Title"
          renderMentions
          testId={`${reportTestId}-competitive-analysis-title`}
          value={payload.title}
        />
      ) : null}
      <ReportLabeledText
        label="Analysis"
        renderMentions
        testId={`${reportTestId}-competitive-analysis-text`}
        value={payload.text}
      />
      {competitors.length > 0 ? (
        <ReportLabeledText
          label="Competitors"
          testId={`${reportTestId}-competitive-analysis-competitors-block`}
          value={
            <Stack
              data-testid={`${reportTestId}-competitive-analysis-competitors-list`}
              spacing={0.25}
            >
              {competitors.map((competitor, index) => (
                <Typography
                  data-testid={`${reportTestId}-competitive-analysis-competitor-${index}`}
                  key={`competitor-${index}`}
                  variant="body2"
                >
                  {renderInlineMentions(competitor, "minimal")}
                </Typography>
              ))}
            </Stack>
          }
        />
      ) : null}
    </Stack>
  );
};
