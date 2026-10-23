import { Button, Stack } from "@mui/material";
import React from "react";
import {
  CodingPromptStartupPlanPayloadResponseTypeEnum,
  WorkflowReviewAction,
  type CodingPromptStartupPlanPayload,
  type PlanReportPayload,
  type UIElement,
} from "../../../api";
import {
  StartupPlanStructuredField,
  isStartupPlanStructuredResponseValue,
  type StartupPlanStructuredResponseValue,
} from "../../LlmForms/Registry/StartupPlanStructuredField";
import { projectStartupPlanSubmission } from "../../LlmForms/Registry/startupPlanApprovalMarkdown";
import type { CodingPlanUserAction } from "../../LlmForms/Registry/startupPlanApprovalMarkdown";
import type {
  FieldComponentContext,
  FieldValidity,
} from "../../LlmForms/Registry/types";
import type { FormValue } from "../../LlmForms/types";
import type { ReportRendererProps } from "./rendererContract";
import { ReportLabeledText } from "./reportPrimitives";

export interface PlanReportInteractionContext {
  sourceUiElement: UIElement;
  parentMessageId: string;
  fieldContext: FieldComponentContext;
  disabled: boolean;
  submit: (values: Record<string, FormValue>, parentMessageId: string) => void;
}

export const toStartupPlanResponse = (
  payload: PlanReportPayload
): CodingPromptStartupPlanPayload => {
  const { reportType: _reportType, summary: _summary, ...plan } = payload;

  return {
    responseType: CodingPromptStartupPlanPayloadResponseTypeEnum.StartupPlanV1,
    ...plan,
  };
};

export const projectInteractivePlanSubmission = (input: {
  context: PlanReportInteractionContext;
  value: StartupPlanStructuredResponseValue;
  action: CodingPlanUserAction;
}): void => {
  const projection = projectStartupPlanSubmission(input.value, input.action);
  input.context.submit(
    {
      [input.context.sourceUiElement.id]: projection.value,
      ...(projection.comment ? { comment: projection.comment } : {}),
    },
    input.context.parentMessageId
  );
};

export interface InteractivePlanReportProps
  extends ReportRendererProps<PlanReportPayload> {
  interaction: PlanReportInteractionContext;
}

export const InteractivePlanReport: React.FC<InteractivePlanReportProps> = ({
  payload,
  reportTestId,
  interaction,
}) => {
  const initialValue = React.useMemo(
    () => toStartupPlanResponse(payload),
    [payload]
  );
  const [value, setValue] =
    React.useState<StartupPlanStructuredResponseValue>(initialValue);
  const [validity, setValidity] = React.useState<FieldValidity>("loading");

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const submit = (action: CodingPlanUserAction) => {
    if (interaction.disabled) {
      return;
    }
    projectInteractivePlanSubmission({ context: interaction, value, action });
  };

  return (
    <Stack data-testid={`${reportTestId}-plan-interactive`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-plan-summary`}
        value={payload.summary}
      />
      <StartupPlanStructuredField
        config={{
          field: interaction.sourceUiElement.id,
          description: interaction.sourceUiElement.label,
          type: "coding_prompt_startup_plan",
          required: interaction.sourceUiElement.required ?? false,
          payload: interaction.sourceUiElement.payload,
        }}
        context={interaction.fieldContext}
        disabled={interaction.disabled}
        isSubmitted={false}
        onChange={(nextValue) => {
          if (isStartupPlanStructuredResponseValue(nextValue)) {
            setValue(nextValue);
          }
        }}
        onValidityChange={setValidity}
        value={value}
      />
      <Stack direction="row" spacing={2}>
        <Button
          data-testid="interactive-plan-continue-refining-button"
          disabled={interaction.disabled || validity !== "valid"}
          onClick={() => submit(WorkflowReviewAction.Refine)}
          variant="outlined"
        >
          Continue Refining
        </Button>
        <Button
          data-testid="interactive-plan-approve-button"
          disabled={interaction.disabled || validity !== "valid"}
          onClick={() => submit(WorkflowReviewAction.Approved)}
          variant="contained"
        >
          Approve
        </Button>
      </Stack>
    </Stack>
  );
};
