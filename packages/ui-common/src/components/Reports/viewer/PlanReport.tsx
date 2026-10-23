import { Box, Stack, Typography } from "@mui/material";
import React from "react";
import type {
  PlanReportClarificationQuestion,
  PlanReportDiscrepancy,
  PlanReportExecutionStep,
  PlanReportExecutionStepReference,
  PlanReportPayload,
} from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { PrimaryImplementationList } from "../../CodingPlan/PrimaryImplementationList";
import {
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const PlanReport: ReportRenderer<PlanReportPayload> = ({
  payload,
  reportTestId,
}) => {
  const primaryImplementations = payload.primaryImplementations ?? [];
  const executionPlan = payload.executionPlan;
  const discrepancies = payload.discrepancies;
  const clarificationQuestions = payload.clarificationQuestions;

  return (
    <Stack data-testid={`${reportTestId}-plan`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-plan-summary`}
        value={payload.summary}
      />
      <ReportLabeledText
        label="Session title"
        renderMentions
        testId={`${reportTestId}-plan-session-title`}
        value={payload.sessionTitle}
      />
      <ReportPanel
        isEmpty={primaryImplementations.length === 0}
        emptyMessage="No primary implementations were proposed."
        testId={`${reportTestId}-plan-primary-implementations`}
        title="Primary implementations"
      >
        <PrimaryImplementationList
          implementations={primaryImplementations}
          testId={`${reportTestId}-plan-primary-implementation-list`}
        />
      </ReportPanel>
      <ReportPanel
        emptyMessage="No execution steps were planned."
        isEmpty={executionPlan.length === 0}
        testId={`${reportTestId}-plan-execution-plan`}
        title="Execution plan"
      >
        <Stack
          data-testid={`${reportTestId}-plan-execution-plan-list`}
          spacing={1.5}
        >
          {executionPlan.map((step, index) => (
            <PlanExecutionStepCard
              index={index}
              key={`step-${index}`}
              step={step}
              testIdPrefix={`${reportTestId}-plan-execution-step-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
      <ReportPanel
        emptyMessage="No discrepancies were flagged."
        isEmpty={discrepancies.length === 0}
        testId={`${reportTestId}-plan-discrepancies`}
        title="Discrepancies"
      >
        <Stack
          data-testid={`${reportTestId}-plan-discrepancies-list`}
          spacing={1}
        >
          {discrepancies.map((discrepancy, index) => (
            <PlanDiscrepancyCard
              discrepancy={discrepancy}
              index={index}
              key={`discrepancy-${index}`}
              testIdPrefix={`${reportTestId}-plan-discrepancy-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
      <ReportPanel
        emptyMessage="No clarification questions were raised."
        isEmpty={clarificationQuestions.length === 0}
        testId={`${reportTestId}-plan-clarification-questions`}
        title="Clarification questions"
      >
        <Stack
          data-testid={`${reportTestId}-plan-clarification-questions-list`}
          spacing={1}
        >
          {clarificationQuestions.map((question, index) => (
            <PlanClarificationQuestionCard
              index={index}
              key={`question-${index}`}
              question={question}
              testIdPrefix={`${reportTestId}-plan-clarification-question-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
    </Stack>
  );
};

interface PlanExecutionStepCardProps {
  index: number;
  step: PlanReportExecutionStep;
  testIdPrefix: string;
}

const PlanExecutionStepCard: React.FC<PlanExecutionStepCardProps> = ({
  index,
  step,
  testIdPrefix,
}) => {
  const targetFiles = step.targetFiles ?? [];
  return (
    <ReportItemCard
      testId={`${testIdPrefix}-card`}
      title={
        <Typography data-testid={`${testIdPrefix}-title`} variant="subtitle2">
          {renderInlineMentions(`${index + 1}. ${step.title}`, "minimal")}
        </Typography>
      }
    >
      <ReportLabeledText
        label="Step ID"
        testId={`${testIdPrefix}-step-id-block`}
        value={
          <Typography
            component="span"
            data-testid={`${testIdPrefix}-step-id`}
            sx={{ fontFamily: "monospace" }}
            variant="body2"
          >
            {step.stepId}
          </Typography>
        }
      />
      <ReportLabeledText
        label="Description"
        renderMentions
        testId={`${testIdPrefix}-description-block`}
        value={step.description}
      />
      {targetFiles.length > 0 ? (
        <ReportLabeledText
          label="Target files"
          testId={`${testIdPrefix}-target-files-block`}
          value={
            <Stack
              component="ul"
              data-testid={`${testIdPrefix}-target-files-list`}
              spacing={0.25}
              sx={{ listStyle: "disc", m: 0, pl: 3 }}
            >
              {targetFiles.map((path, fileIndex) => (
                <Box
                  component="li"
                  data-testid={`${testIdPrefix}-target-files-item-${fileIndex}`}
                  key={`file-${fileIndex}`}
                >
                  <Typography sx={{ fontFamily: "monospace" }} variant="body2">
                    {path}
                  </Typography>
                </Box>
              ))}
            </Stack>
          }
        />
      ) : null}
      {step.references.length > 0 ? (
        <ReportLabeledText
          label="References"
          testId={`${testIdPrefix}-references-block`}
          value={
            <Stack
              data-testid={`${testIdPrefix}-references-list`}
              spacing={0.5}
            >
              {step.references.map((reference, refIndex) => (
                <PlanReferenceRow
                  key={`reference-${refIndex}`}
                  reference={reference}
                  testIdPrefix={`${testIdPrefix}-reference-${refIndex}`}
                />
              ))}
            </Stack>
          }
        />
      ) : null}
    </ReportItemCard>
  );
};

interface PlanReferenceRowProps {
  reference: PlanReportExecutionStepReference;
  testIdPrefix: string;
}

const PlanReferenceRow: React.FC<PlanReferenceRowProps> = ({
  reference,
  testIdPrefix,
}) => (
  <Stack data-testid={testIdPrefix} spacing={0.25}>
    <Typography
      data-testid={`${testIdPrefix}-source`}
      sx={{ fontFamily: "monospace" }}
      variant="caption"
    >
      {`${reference.sourceType}:${reference.sourceId}`}
    </Typography>
    <Typography
      color="text.secondary"
      data-testid={`${testIdPrefix}-rationale`}
      variant="body2"
    >
      {renderInlineMentions(reference.rationale, "minimal")}
    </Typography>
  </Stack>
);

interface PlanDiscrepancyCardProps {
  discrepancy: PlanReportDiscrepancy;
  index: number;
  testIdPrefix: string;
}

const PlanDiscrepancyCard: React.FC<PlanDiscrepancyCardProps> = ({
  discrepancy,
  index,
  testIdPrefix,
}) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={
      <Typography data-testid={`${testIdPrefix}-title`} variant="subtitle2">
        {renderInlineMentions(
          `${index + 1}. ${discrepancy.discrepancyText}`,
          "minimal"
        )}
      </Typography>
    }
    trailing={
      <Typography
        color="text.secondary"
        data-testid={`${testIdPrefix}-severity`}
        sx={{ textTransform: "uppercase" }}
        variant="caption"
      >
        {discrepancy.severity}
      </Typography>
    }
  >
    <ReportLabeledText
      label="Source"
      testId={`${testIdPrefix}-source-block`}
      value={
        <Typography
          component="span"
          data-testid={`${testIdPrefix}-source`}
          sx={{ fontFamily: "monospace" }}
          variant="body2"
        >
          {discrepancy.sourceField
            ? `${discrepancy.sourceRef.sourceType}:${discrepancy.sourceRef.sourceId} (${discrepancy.sourceField})`
            : `${discrepancy.sourceRef.sourceType}:${discrepancy.sourceRef.sourceId}`}
        </Typography>
      }
    />
    <ReportLabeledText
      label="Source excerpt"
      testId={`${testIdPrefix}-source-excerpt-block`}
      value={
        <Typography
          component="span"
          data-testid={`${testIdPrefix}-source-excerpt`}
          variant="body2"
        >
          {renderInlineMentions(discrepancy.sourceExcerpt, "minimal")}
        </Typography>
      }
    />
    <ReportLabeledText
      label="Reasoning"
      renderMentions
      testId={`${testIdPrefix}-reasoning-block`}
      value={discrepancy.reasoning}
    />
  </ReportItemCard>
);

interface PlanClarificationQuestionCardProps {
  index: number;
  question: PlanReportClarificationQuestion;
  testIdPrefix: string;
}

const PlanClarificationQuestionCard: React.FC<
  PlanClarificationQuestionCardProps
> = ({ index, question, testIdPrefix }) => {
  const relatedSourceRefs = question.relatedSourceRefs ?? [];
  return (
    <ReportItemCard
      testId={`${testIdPrefix}-card`}
      title={
        <Typography data-testid={`${testIdPrefix}-title`} variant="subtitle2">
          {renderInlineMentions(
            `${index + 1}. ${question.question}`,
            "minimal"
          )}
        </Typography>
      }
    >
      {question.reason ? (
        <ReportLabeledText
          label="Reason"
          renderMentions
          testId={`${testIdPrefix}-reason-block`}
          value={question.reason}
        />
      ) : null}
      {relatedSourceRefs.length > 0 ? (
        <ReportLabeledText
          label="Related sources"
          testId={`${testIdPrefix}-related-sources-block`}
          value={
            <Stack
              data-testid={`${testIdPrefix}-related-sources-list`}
              spacing={0.25}
            >
              {relatedSourceRefs.map((ref, refIndex) => (
                <Typography
                  data-testid={`${testIdPrefix}-related-source-${refIndex}`}
                  key={`related-${refIndex}`}
                  sx={{ fontFamily: "monospace" }}
                  variant="caption"
                >
                  {`${ref.sourceType}:${ref.sourceId}`}
                </Typography>
              ))}
            </Stack>
          }
        />
      ) : null}
    </ReportItemCard>
  );
};
