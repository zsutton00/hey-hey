import { Stack, Typography } from "@mui/material";
import React from "react";
import type {
  FeatureSyncReportDiscrepancy,
  FeatureSyncReportPayload,
  FeatureSyncReportReconciliationOption,
} from "../../../api";
import { MentionBadgeInner } from "../../SmarterTextAreaCard/MentionBadge";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import type { EntityMention } from "../../SmarterTextAreaCard/types";
import {
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const FeatureSyncReport: ReportRenderer<FeatureSyncReportPayload> = ({
  payload,
  reportTestId,
}) => {
  const discrepancies = payload.discrepancies;
  const reconciliationOptions = payload.reconciliationOptions;

  return (
    <Stack data-testid={`${reportTestId}-feature-sync`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-feature-sync-summary`}
        value={payload.summary}
      />
      <ReportPanel
        emptyMessage="No discrepancies were flagged."
        isEmpty={discrepancies.length === 0}
        testId={`${reportTestId}-feature-sync-discrepancies`}
        title="Discrepancies"
      >
        <Stack
          data-testid={`${reportTestId}-feature-sync-discrepancies-list`}
          spacing={1}
        >
          {discrepancies.map((discrepancy, index) => (
            <FeatureSyncDiscrepancyCard
              discrepancy={discrepancy}
              index={index}
              key={`discrepancy-${index}`}
              testIdPrefix={`${reportTestId}-feature-sync-discrepancy-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
      <ReportPanel
        emptyMessage="No reconciliation options were offered."
        isEmpty={reconciliationOptions.length === 0}
        testId={`${reportTestId}-feature-sync-reconciliation-options`}
        title="Reconciliation options"
      >
        <Stack
          data-testid={`${reportTestId}-feature-sync-reconciliation-options-list`}
          spacing={1}
        >
          {reconciliationOptions.map((option, index) => (
            <FeatureSyncReconciliationOptionCard
              discrepancies={discrepancies}
              index={index}
              key={`option-${index}`}
              option={option}
              testIdPrefix={`${reportTestId}-feature-sync-reconciliation-option-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
    </Stack>
  );
};

interface FeatureSyncDiscrepancyCardProps {
  discrepancy: FeatureSyncReportDiscrepancy;
  index: number;
  testIdPrefix: string;
}

const FeatureSyncDiscrepancyCard: React.FC<FeatureSyncDiscrepancyCardProps> = ({
  discrepancy,
  index,
  testIdPrefix,
}) => {
  const mention: EntityMention = {
    entityType: discrepancy.source.entityType,
    entityId: discrepancy.source.entityId,
    entityName: discrepancy.source.title,
  };

  return (
    <ReportItemCard
      testId={`${testIdPrefix}-card`}
      title={
        <Typography data-testid={`${testIdPrefix}-title`} variant="subtitle2">
          {renderInlineMentions(
            `${index + 1}. ${discrepancy.source.title}`,
            "minimal"
          )}
        </Typography>
      }
    >
      <ReportLabeledText
        label="Source"
        testId={`${testIdPrefix}-source-block`}
        value={
          <Stack
            data-testid={`${testIdPrefix}-source`}
            direction="row"
            spacing={0.5}
          >
            <MentionBadgeInner mention={mention} mode="minimal" />
          </Stack>
        }
      />
      <ReportLabeledText
        label="Description"
        renderMentions
        testId={`${testIdPrefix}-description-block`}
        value={discrepancy.description}
      />
    </ReportItemCard>
  );
};

interface FeatureSyncReconciliationOptionCardProps {
  discrepancies: FeatureSyncReportDiscrepancy[];
  index: number;
  option: FeatureSyncReportReconciliationOption;
  testIdPrefix: string;
}

const FeatureSyncReconciliationOptionCard: React.FC<
  FeatureSyncReconciliationOptionCardProps
> = ({ discrepancies, index, option, testIdPrefix }) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={
      <Typography data-testid={`${testIdPrefix}-title`} variant="subtitle2">
        {renderInlineMentions(`${index + 1}. ${option.description}`, "minimal")}
      </Typography>
    }
  >
    <ReportLabeledText
      label="Resolves discrepancies"
      testId={`${testIdPrefix}-resolves-block`}
      value={
        <Stack data-testid={`${testIdPrefix}-resolves-list`} spacing={0.25}>
          {option.discrepancyIndices.map((discrepancyIndex, refIndex) => {
            const discrepancy = discrepancies[discrepancyIndex];
            const title = discrepancy
              ? discrepancy.source.title
              : "Unknown discrepancy";
            return (
              <Typography
                data-testid={`${testIdPrefix}-resolves-item-${refIndex}`}
                key={`resolves-${refIndex}`}
                variant="body2"
              >
                {`${discrepancyIndex + 1}. ${title}`}
              </Typography>
            );
          })}
        </Stack>
      }
    />
  </ReportItemCard>
);
