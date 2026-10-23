import { Stack, Typography } from "@mui/material";
import type { DecisionNeededReportPayload } from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import {
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const DecisionNeededReport: ReportRenderer<
  DecisionNeededReportPayload
> = ({ payload, reportTestId }) => {
  const testIdPrefix = `${reportTestId}-decision-needed`;

  return (
    <Stack data-testid={testIdPrefix} spacing={1.5}>
      <ReportLabeledText
        label="Question"
        renderMentions
        testId={`${testIdPrefix}-question`}
        value={payload.question}
      />
      <ReportPanel testId={`${testIdPrefix}-options`} title="Options">
        <Stack data-testid={`${testIdPrefix}-options-list`} spacing={1}>
          {payload.options.map((option, index) => (
            <ReportItemCard
              key={`option-${index}`}
              testId={`${testIdPrefix}-option-card`}
              title={
                <Typography
                  data-option-number={index + 1}
                  data-testid={`${testIdPrefix}-option-description`}
                  variant="body2"
                >
                  {renderInlineMentions(
                    `${index + 1}. ${option.description}`,
                    "minimal"
                  )}
                </Typography>
              }
            />
          ))}
        </Stack>
      </ReportPanel>
    </Stack>
  );
};
