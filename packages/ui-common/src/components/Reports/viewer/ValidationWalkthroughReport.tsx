import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Box, Button, Stack, Typography } from "@mui/material";
import React, { useCallback, useState } from "react";
import {
  ValidationActionTypeEnum,
  type ValidationAction,
  type ValidationStep,
  type ValidationWalkthroughReportPayload,
} from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { ReportItemCard, ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const ValidationWalkthroughReport: ReportRenderer<
  ValidationWalkthroughReportPayload
> = ({ payload, reportTestId }) => {
  const validationSteps = payload.validationSteps;

  if (!Array.isArray(validationSteps) || validationSteps.length === 0) {
    return (
      <Typography
        color="text.secondary"
        data-testid={`${reportTestId}-empty`}
        variant="body2"
      >
        {validationSteps && validationSteps.length === 0
          ? "No validation steps to display."
          : "Validation walkthrough payload is unavailable."}
      </Typography>
    );
  }

  return (
    <Stack
      component="ol"
      data-testid={`${reportTestId}-steps`}
      spacing={2}
      sx={{ m: 0, p: 0, listStyle: "none" }}
    >
      {validationSteps.map((step, index) => (
        <ValidationStepItem
          index={index}
          key={`step-${index}`}
          step={step}
          testIdPrefix={reportTestId}
        />
      ))}
    </Stack>
  );
};

interface ValidationStepItemProps {
  index: number;
  step: ValidationStep;
  testIdPrefix: string;
}

const ValidationStepItem: React.FC<ValidationStepItemProps> = ({
  index,
  step,
  testIdPrefix,
}) => {
  const stepTestId = `${testIdPrefix}-step-${index}`;
  return (
    <Box component="li" data-testid={stepTestId} sx={{ m: 0, p: 0 }}>
      <ReportItemCard
        testId={`${stepTestId}-card`}
        title={
          <Typography data-testid={`${stepTestId}-title`} variant="subtitle1">
            {renderInlineMentions(`${index + 1}. ${step.title}`, "minimal")}
          </Typography>
        }
      >
        <ReportLabeledText
          label="Description"
          testId={`${stepTestId}-description-block`}
          value={
            <Typography
              color="text.secondary"
              component="span"
              data-testid={`${stepTestId}-description`}
              variant="body2"
            >
              {renderInlineMentions(step.description, "minimal")}
            </Typography>
          }
        />
        {step.actions.length > 0 ? (
          <Stack
            data-testid={`${stepTestId}-actions`}
            spacing={1}
            sx={{ pl: 1 }}
          >
            {step.actions.map((action, actionIndex) => (
              <ValidationActionView
                action={action}
                key={`action-${actionIndex}`}
                testIdPrefix={`${stepTestId}-action-${actionIndex}`}
              />
            ))}
          </Stack>
        ) : null}
      </ReportItemCard>
    </Box>
  );
};

interface ValidationActionViewProps {
  action: ValidationAction;
  testIdPrefix: string;
}

const ValidationActionView: React.FC<ValidationActionViewProps> = ({
  action,
  testIdPrefix,
}) => {
  if (action.type === ValidationActionTypeEnum.CommandLine) {
    return <CommandLineAction action={action} testIdPrefix={testIdPrefix} />;
  }

  return (
    <Typography
      color="text.secondary"
      data-testid={`${testIdPrefix}-unknown`}
      variant="body2"
    >
      Unsupported action type: {action.type}
    </Typography>
  );
};

interface CommandLineActionProps {
  action: ValidationAction;
  testIdPrefix: string;
}

const CommandLineAction: React.FC<CommandLineActionProps> = ({
  action,
  testIdPrefix,
}) => {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const command = action.command ?? "";

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }, [command]);

  return (
    <Stack data-testid={`${testIdPrefix}-command-line`} spacing={0.5}>
      {action.workingDirectory ? (
        <Typography
          color="text.secondary"
          data-testid={`${testIdPrefix}-working-directory`}
          variant="caption"
        >
          Working directory: {action.workingDirectory}
        </Typography>
      ) : null}
      <Stack alignItems="flex-start" direction="row" spacing={1}>
        <Box
          component="pre"
          data-testid={`${testIdPrefix}-command`}
          sx={{
            backgroundColor: "action.hover",
            borderRadius: 1,
            flex: 1,
            fontFamily: "monospace",
            fontSize: "0.8125rem",
            m: 0,
            overflowX: "auto",
            px: 1,
            py: 0.75,
            whiteSpace: "pre-wrap",
          }}
        >
          {command}
        </Box>
        <Button
          color={copyState === "copied" ? "success" : "primary"}
          data-testid={`${testIdPrefix}-copy`}
          onClick={handleCopy}
          size="small"
          startIcon={<ContentCopyIcon fontSize="small" />}
          variant="outlined"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
            ? "Retry"
            : "Copy"}
        </Button>
      </Stack>
    </Stack>
  );
};
