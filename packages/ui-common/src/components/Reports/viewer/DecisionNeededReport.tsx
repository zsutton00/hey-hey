import { Stack, Typography } from "@mui/material";
import type { DecisionNeededReportPayload } from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { NumberedOptionCard, QuestionFrame } from "../../Uncertainties";
import type { ReportRenderer } from "./rendererContract";

export const DecisionNeededReport: ReportRenderer<
  DecisionNeededReportPayload
> = ({ payload, reportTestId }) => {
  const testIdPrefix = `${reportTestId}-decision-needed`;

  return (
    <Stack data-testid={testIdPrefix}>
      <QuestionFrame testId={`${testIdPrefix}-frame`}>
        <Stack spacing={1.5}>
          <Typography
            data-testid={`${testIdPrefix}-question`}
            variant="body1"
            fontWeight={600}
          >
            {renderInlineMentions(payload.question, "minimal")}
          </Typography>
          <Stack data-testid={`${testIdPrefix}-options`} spacing={1}>
            <Stack data-testid={`${testIdPrefix}-options-list`} spacing={1}>
              {payload.options.map((option, index) => (
                <NumberedOptionCard key={`option-${index}`} index={index}>
                  <Typography
                    data-option-number={index + 1}
                    data-testid={`${testIdPrefix}-option-description`}
                    variant="body2"
                  >
                    {renderInlineMentions(option.description, "minimal")}
                  </Typography>
                </NumberedOptionCard>
              ))}
            </Stack>
          </Stack>
        </Stack>
      </QuestionFrame>
    </Stack>
  );
};
