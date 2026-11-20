import { CheckCircle, SyncAlt } from "@mui/icons-material";
import {
  Box,
  Chip,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
  type Theme,
} from "@mui/material";
import React from "react";
import type {
  FeatureSyncDecisionChoice,
  FeatureSyncDecisionGroup,
  FeatureSyncDecisionReportPayloadV1,
  FeatureSyncDecisionReportPayloadV2,
  FeatureSyncReportDiscrepancy,
  FeatureSyncReportReconciliationOption,
  ReportDtoFeatureSyncDecisionV1,
  ReportDtoFeatureSyncDecisionV2,
} from "../../../api";
import { MentionBadgeInner } from "../../SmarterTextAreaCard/MentionBadge";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { SmarterTextAreaCard } from "../../SmarterTextAreaCard";
import { ReportUsageBar } from "./ReportUsageBar";
import type { EntityMention } from "../../SmarterTextAreaCard/types";
import {
  ConversationCard,
  ConversationCardRelatedRows,
  ConversationCardSection,
} from "../../Conversation/Card";

export interface FeatureSyncDecisionReportInteractionContext {
  conversationId: string;
  parentMessageId: string;
  disabled: boolean;
  submit: (response: string, parentMessageId: string) => void;
}

type FeatureSyncDecisionReportV1Props = {
  report: ReportDtoFeatureSyncDecisionV1;
  payload: FeatureSyncDecisionReportPayloadV1;
  reportTestId: string;
  interaction?: FeatureSyncDecisionReportInteractionContext;
  recordedResponse?: string;
};

type FeatureSyncDecisionReportV2Props = {
  report: ReportDtoFeatureSyncDecisionV2;
  payload: FeatureSyncDecisionReportPayloadV2;
  reportTestId: string;
  interaction?: FeatureSyncDecisionReportInteractionContext;
  /** The user's persisted reply, used to restore the chosen options. */
  recordedResponse?: string;
};

export type FeatureSyncDecisionReportProps =
  FeatureSyncDecisionReportV1Props | FeatureSyncDecisionReportV2Props;

type FeatureSyncDecisionReportV1RenderProps = {
  payload: FeatureSyncDecisionReportPayloadV1;
  reportTestId: string;
  interaction?: FeatureSyncDecisionReportInteractionContext;
};

type FeatureSyncDecisionReportV2RenderProps = {
  usage: ReportDtoFeatureSyncDecisionV2["usage"];
  payload: FeatureSyncDecisionReportPayloadV2;
  reportTestId: string;
  interaction?: FeatureSyncDecisionReportInteractionContext;
  recordedResponse?: string;
};

export type FeatureSyncDecisionSelectionMap = Readonly<Record<string, string>>;

export const serializeFeatureSyncDecisionResponse = (
  groups: readonly FeatureSyncDecisionGroup[],
  selections: FeatureSyncDecisionSelectionMap,
  notes = "",
): string | null => {
  if (groups.length === 0) return null;

  const selectedChoices: Array<{
    choice: FeatureSyncDecisionChoice;
    group: FeatureSyncDecisionGroup;
  }> = [];

  for (const group of groups) {
    const choiceId = selections[group.id];
    const choice = group.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return null;
    selectedChoices.push({ choice, group });
  }

  const response = selectedChoices
    .map((selection) => `${selection.group.title}: ${selection.choice.label}`)
    .join("\n");
  const trimmedNotes = notes.trim();

  return trimmedNotes
    ? `${response}\n\nGeneral notes:\n${trimmedNotes}`
    : response;
};

/**
 * Recovers the selections a recorded reply made. Each answered group is one
 * `Title: Label` line in producer order, so a group is matched only by an
 * exact line built from its own title and one of its own choice labels,
 * searching forward from the previous match. Free-form replies, replies that
 * skip a group and repeated titles therefore never select a wrong choice.
 */
export const parseFeatureSyncDecisionResponse = (
  groups: readonly FeatureSyncDecisionGroup[],
  response: string | undefined,
): FeatureSyncDecisionSelectionMap => {
  if (!response) return {};

  const [selectionBlock = ""] = response.split("\n\nGeneral notes:");
  const lines = selectionBlock.split("\n");
  const selections: Record<string, string> = {};
  let nextLine = 0;

  for (const group of groups) {
    for (let index = nextLine; index < lines.length; index += 1) {
      const choice = group.choices.find(
        (candidate) => `${group.title}: ${candidate.label}` === lines[index],
      );
      if (!choice) continue;

      selections[group.id] = choice.id;
      nextLine = index + 1;
      break;
    }
  }

  return selections;
};

export const FeatureSyncDecisionReport: React.FC<
  FeatureSyncDecisionReportProps
> = (props) => {
  if ("decisionGroups" in props.payload) {
    return (
      <FeatureSyncDecisionReportV2
        usage={props.report.usage}
        interaction={props.interaction}
        payload={props.payload}
        recordedResponse={props.recordedResponse}
        reportTestId={props.reportTestId}
      />
    );
  }

  return (
    <FeatureSyncDecisionReportV1
      interaction={props.interaction}
      payload={props.payload}
      reportTestId={props.reportTestId}
    />
  );
};

const FeatureSyncDecisionReportV1: React.FC<
  FeatureSyncDecisionReportV1RenderProps
> = ({ payload, reportTestId }) => {
  const reconciliationOptions = payload.reconciliationOptions.map(
    toNumberedReconciliationOption,
  );
  const reconciliationGroups = groupDiscrepanciesByReconciliationOptions(
    payload.discrepancies,
    reconciliationOptions,
  );

  return (
    <Stack data-testid={`${reportTestId}-feature-sync-decision`} spacing={1.5}>
      <Stack
        data-testid={`${reportTestId}-feature-sync-decision-groups-list`}
        spacing={1}
      >
        {reconciliationGroups.map((group, groupIndex) => (
          <ReconciliationGroupCard
            group={group}
            key={`reconciliation-group-${groupIndex}`}
            groupIndex={groupIndex}
            testIdPrefix={`${reportTestId}-feature-sync-decision`}
          />
        ))}
      </Stack>
    </Stack>
  );
};

interface NumberedReconciliationOption {
  option: FeatureSyncReportReconciliationOption;
  optionIndex: number;
  optionNumber: number;
  displayDescription: string;
}

interface IndexedDiscrepancy {
  discrepancy: FeatureSyncReportDiscrepancy;
  discrepancyIndex: number;
}

interface ReconciliationGroup {
  discrepancies: IndexedDiscrepancy[];
  reconciliationOptions: NumberedReconciliationOption[];
}

const NUMBERED_OPTION_PREFIX = /^\s*(\d+)[.)]\s+/;

const toNumberedReconciliationOption = (
  option: FeatureSyncReportReconciliationOption,
  index: number,
): NumberedReconciliationOption => {
  const match = NUMBERED_OPTION_PREFIX.exec(option.description);
  if (!match) {
    return {
      option,
      optionIndex: index,
      optionNumber: index + 1,
      displayDescription: option.description,
    };
  }

  return {
    option,
    optionIndex: index,
    optionNumber: Number(match[1]),
    displayDescription: option.description.slice(match[0].length),
  };
};

const groupDiscrepanciesByReconciliationOptions = (
  discrepancies: FeatureSyncReportDiscrepancy[],
  reconciliationOptions: NumberedReconciliationOption[],
): ReconciliationGroup[] => {
  const groupsByOptionSet = new Map<string, ReconciliationGroup>();

  discrepancies.forEach((discrepancy, discrepancyIndex) => {
    const applicableOptions = reconciliationOptions.filter(({ option }) =>
      option.discrepancyIndices.includes(discrepancyIndex),
    );
    const optionSetKey = applicableOptions
      .map(({ optionIndex }) => optionIndex)
      .join(",");
    const existingGroup = groupsByOptionSet.get(optionSetKey);
    const indexedDiscrepancy = { discrepancy, discrepancyIndex };

    if (existingGroup) {
      existingGroup.discrepancies.push(indexedDiscrepancy);
      return;
    }

    groupsByOptionSet.set(optionSetKey, {
      discrepancies: [indexedDiscrepancy],
      reconciliationOptions: applicableOptions,
    });
  });

  return [...groupsByOptionSet.values()];
};

interface ReconciliationGroupCardProps {
  group: ReconciliationGroup;
  groupIndex: number;
  testIdPrefix: string;
}

const ReconciliationGroupCard: React.FC<ReconciliationGroupCardProps> = ({
  group,
  groupIndex,
  testIdPrefix,
}) => (
  <Stack
    data-group-index={groupIndex}
    data-testid={`${testIdPrefix}-group-card`}
    spacing={0.75}
    sx={(theme) => ({
      borderBottom: `1px solid ${theme.palette.divider}`,
      pb: 1.5,
      "&:last-of-type": {
        borderBottom: 0,
        pb: 0,
      },
    })}
  >
    <Box
      sx={{
        columnGap: 2,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "minmax(10rem, 0.35fr) 1fr" },
      }}
    >
      <Typography color="text.secondary" variant="caption">
        Source
      </Typography>
      <Typography color="text.secondary" variant="caption">
        Issue
      </Typography>
    </Box>
    <Stack data-testid={`${testIdPrefix}-group-issues-list`} spacing={1.5}>
      {group.discrepancies.map(({ discrepancy, discrepancyIndex }) => (
        <DiscrepancyRow
          discrepancy={discrepancy}
          discrepancyIndex={discrepancyIndex}
          key={`discrepancy-${discrepancyIndex}`}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </Stack>
    <ReconciliationOptionsList
      reconciliationOptions={group.reconciliationOptions}
      testIdPrefix={testIdPrefix}
    />
  </Stack>
);

interface DiscrepancyRowProps {
  discrepancy: FeatureSyncReportDiscrepancy;
  discrepancyIndex: number;
  testIdPrefix: string;
}

const DiscrepancyRow: React.FC<DiscrepancyRowProps> = ({
  discrepancy,
  discrepancyIndex,
  testIdPrefix,
}) => {
  const mention: EntityMention = {
    entityType: discrepancy.source.entityType,
    entityId: discrepancy.source.entityId,
    entityName: discrepancy.source.title,
  };

  return (
    <Box
      data-discrepancy-index={discrepancyIndex}
      data-testid={`${testIdPrefix}-group-issue`}
      sx={{
        columnGap: 2,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "minmax(10rem, 0.35fr) 1fr" },
        rowGap: 0.5,
      }}
    >
      <Box data-testid={`${testIdPrefix}-group-issue-source`}>
        <MentionBadgeInner mention={mention} mode="minimal" />
      </Box>
      <Typography
        data-testid={`${testIdPrefix}-group-issue-description`}
        variant="body2"
      >
        {renderInlineMentions(discrepancy.description, "minimal")}
      </Typography>
    </Box>
  );
};

interface ReconciliationOptionsListProps {
  reconciliationOptions: NumberedReconciliationOption[];
  testIdPrefix: string;
}

const ReconciliationOptionsList: React.FC<ReconciliationOptionsListProps> = ({
  reconciliationOptions,
  testIdPrefix,
}) =>
  reconciliationOptions.length > 0 ? (
    <Stack
      component="ol"
      data-testid={`${testIdPrefix}-group-options-list`}
      spacing={0.5}
      sx={{ m: 0, pl: 3 }}
    >
      {reconciliationOptions.map(
        ({ displayDescription, optionIndex, optionNumber }) => (
          <Box
            component="li"
            data-option-index={optionIndex}
            data-option-number={optionNumber}
            data-testid={`${testIdPrefix}-group-option-card`}
            key={`option-${optionIndex}`}
            value={optionNumber}
          >
            <Typography
              data-testid={`${testIdPrefix}-group-option-title`}
              variant="body2"
            >
              {renderInlineMentions(displayDescription, "minimal")}
            </Typography>
          </Box>
        ),
      )}
    </Stack>
  ) : null;

const FeatureSyncDecisionReportV2: React.FC<
  FeatureSyncDecisionReportV2RenderProps
> = ({ usage, payload, reportTestId, interaction, recordedResponse }) => {
  const [selections, setSelections] =
    React.useState<FeatureSyncDecisionSelectionMap>(() =>
      parseFeatureSyncDecisionResponse(
        payload.decisionGroups,
        recordedResponse,
      ),
    );
  const [notes, setNotes] = React.useState("");
  const testIdPrefix = `${reportTestId}-feature-sync-decision`;
  const canSubmit =
    interaction !== undefined &&
    !interaction.disabled &&
    serializeFeatureSyncDecisionResponse(payload.decisionGroups, selections) !==
      null;

  const handleSubmit = () => {
    if (!interaction || interaction.disabled) return;

    const response = serializeFeatureSyncDecisionResponse(
      payload.decisionGroups,
      selections,
      notes,
    );
    if (!response) return;

    interaction.submit(response, interaction.parentMessageId);
  };

  const groupCount = payload.decisionGroups.length;
  // One decision's title is the card lead; several decisions each lead their own block.
  const singleGroup = groupCount === 1 ? payload.decisionGroups[0] : undefined;

  return (
    <Box data-testid={testIdPrefix}>
      <ConversationCard
        chips={<Chip label="Before implementation" size="small" />}
        data-testid={`${testIdPrefix}-card`}
        footer={
          interaction
            ? {
                primary: {
                  disabled: !canSubmit,
                  label:
                    groupCount > 1 ? "Submit decisions" : "Submit decision",
                  onClick: handleSubmit,
                  testId: `${testIdPrefix}-submit-button`,
                },
              }
            : undefined
        }
        icon={<SyncAlt fontSize="small" />}
        kindLabel="Project sync · Decision"
        lead={
          singleGroup ? (
            <span
              data-group-index={0}
              data-testid={`${testIdPrefix}-group-title`}
            >
              {renderInlineMentions(singleGroup.title, "minimal")}
            </span>
          ) : undefined
        }
        tone={{ role: "projectSync" }}
      >
        <ConversationCardSection label="Overview">
          <Typography data-testid={`${testIdPrefix}-summary`} variant="body2">
            {renderInlineMentions(payload.summary, "minimal")}
          </Typography>
        </ConversationCardSection>
        {groupCount === 0 ? (
          <Typography color="text.secondary" variant="body2">
            No decision groups were provided.
          </Typography>
        ) : (
          <Stack data-testid={`${testIdPrefix}-groups-list`} spacing={2.5}>
            {payload.decisionGroups.map((group, groupIndex) => (
              <FeatureSyncDecisionGroupBlock
                group={group}
                groupIndex={groupIndex}
                interaction={interaction}
                key={group.id}
                selectedChoiceId={selections[group.id]}
                showTitle={singleGroup === undefined}
                setSelectedChoice={(choiceId) =>
                  setSelections((previous) => ({
                    ...previous,
                    [group.id]: choiceId,
                  }))
                }
                testIdPrefix={testIdPrefix}
              />
            ))}
          </Stack>
        )}
        {interaction ? (
          <>
            <Stack data-testid={`${testIdPrefix}-notes`} spacing={0.75}>
              <Typography
                color="text.secondary"
                data-testid={`${testIdPrefix}-notes-label`}
                variant="body2"
              >
                General notes (optional)
              </Typography>
              <SmarterTextAreaCard
                disabled={interaction.disabled}
                hasUnsavedChanges={false}
                mentionConversationId={interaction.conversationId}
                onChange={setNotes}
                placeholder="Add any context for these decisions."
                saveMode={null}
                saveStatus="draft"
                value={notes}
              />
            </Stack>
            <Typography
              color="text.secondary"
              data-testid={`${testIdPrefix}-free-form-guidance`}
              variant="caption"
            >
              You can also reply with free-form guidance instead of selecting
              every decision.
            </Typography>
          </>
        ) : null}
        <ReportUsageBar usage={usage ?? null} />
      </ConversationCard>
    </Box>
  );
};

interface FeatureSyncDecisionGroupBlockProps {
  group: FeatureSyncDecisionGroup;
  groupIndex: number;
  interaction?: FeatureSyncDecisionReportInteractionContext;
  selectedChoiceId?: string;
  setSelectedChoice: (choiceId: string) => void;
  showTitle: boolean;
  testIdPrefix: string;
}

const FeatureSyncDecisionGroupBlock: React.FC<
  FeatureSyncDecisionGroupBlockProps
> = ({
  group,
  groupIndex,
  interaction,
  selectedChoiceId,
  setSelectedChoice,
  showTitle,
  testIdPrefix,
}) => (
  <Stack
    data-group-id={group.id}
    data-testid={`${testIdPrefix}-group-card`}
    spacing={1.5}
    sx={(theme) => ({
      borderTop: `1px solid ${theme.palette.divider}`,
      pt: 2.5,
      "&:first-of-type": { borderTop: 0, pt: 0 },
    })}
  >
    {showTitle ? (
      <Typography
        data-group-index={groupIndex}
        data-testid={`${testIdPrefix}-group-title`}
        sx={{ fontWeight: 600 }}
        variant="body1"
      >
        {renderInlineMentions(group.title, "minimal")}
      </Typography>
    ) : null}
    <ConversationCardSection label="Summary">
      <Typography data-testid={`${testIdPrefix}-group-summary`} variant="body2">
        {renderInlineMentions(group.summary, "minimal")}
      </Typography>
    </ConversationCardSection>
    <ConversationCardSection label="Affected">
      <Box data-testid={`${testIdPrefix}-group-entities`}>
        <ConversationCardRelatedRows
          rows={getUniqueAffectedEntities(group.affectedEntities).map(
            (entity) => ({
              key: `${entity.entityType}:${entity.entityId}`,
              mention: {
                entityId: entity.entityId,
                entityName: entity.title,
                entityType: entity.entityType,
              },
              reason: entity.reason,
            }),
          )}
        />
      </Box>
    </ConversationCardSection>
    <ConversationCardSection label="Choose one">
      {interaction ? (
        <FormControl
          component="fieldset"
          data-testid={`${testIdPrefix}-group-choices`}
          disabled={interaction.disabled}
          sx={{ width: "100%" }}
        >
          <RadioGroup
            aria-label={group.title}
            name={`${testIdPrefix}-${group.id}`}
            onChange={(event) => setSelectedChoice(event.target.value)}
            sx={{ gap: 1 }}
            value={selectedChoiceId ?? ""}
          >
            {group.choices.map((choice, choiceIndex) => (
              <FeatureSyncDecisionChoiceOption
                choice={choice}
                choiceIndex={choiceIndex}
                key={choice.id}
                testIdPrefix={testIdPrefix}
              />
            ))}
          </RadioGroup>
        </FormControl>
      ) : (
        <Stack data-testid={`${testIdPrefix}-group-choices`} spacing={1}>
          {group.choices.map((choice, choiceIndex) => (
            <Box
              data-choice-id={choice.id}
              data-choice-index={choiceIndex}
              data-no-change={choice.isNoChange}
              data-selected={choice.id === selectedChoiceId}
              data-testid={`${testIdPrefix}-choice`}
              key={choice.id}
              sx={(theme) => ({
                ...decisionChoiceSurfaceSx(theme),
                alignItems: "flex-start",
                display: "flex",
                gap: 1,
                ...(choice.id === selectedChoiceId && {
                  outline: `2px solid ${theme.palette.conversationCard.roles.projectSync.main}`,
                }),
              })}
            >
              {choice.id === selectedChoiceId ? (
                <CheckCircle
                  aria-label="Selected choice"
                  data-testid={`${testIdPrefix}-choice-selected`}
                  fontSize="small"
                  sx={{
                    color: "var(--card-main)",
                  }}
                />
              ) : null}
              <FeatureSyncDecisionChoiceText
                choice={choice}
                testIdPrefix={testIdPrefix}
              />
            </Box>
          ))}
        </Stack>
      )}
    </ConversationCardSection>
  </Stack>
);

interface FeatureSyncDecisionChoiceOptionProps {
  choice: FeatureSyncDecisionChoice;
  choiceIndex: number;
  testIdPrefix: string;
}

const FeatureSyncDecisionChoiceOption: React.FC<
  FeatureSyncDecisionChoiceOptionProps
> = ({ choice, choiceIndex, testIdPrefix }) => (
  <FormControlLabel
    data-choice-id={choice.id}
    data-choice-index={choiceIndex}
    data-no-change={choice.isNoChange}
    data-testid={`${testIdPrefix}-choice`}
    label={
      <FeatureSyncDecisionChoiceText
        choice={choice}
        testIdPrefix={testIdPrefix}
      />
    }
    value={choice.id}
    control={<Radio />}
    sx={(theme) => ({
      ...decisionChoiceSurfaceSx(theme),
      alignItems: choice.description ? "flex-start" : "center",
      m: 0,
      width: "100%",
      "& .MuiFormControlLabel-label": { flex: 1 },
    })}
  />
);

interface FeatureSyncDecisionChoiceTextProps {
  choice: FeatureSyncDecisionChoice;
  testIdPrefix: string;
}

const FeatureSyncDecisionChoiceText: React.FC<
  FeatureSyncDecisionChoiceTextProps
> = ({ choice, testIdPrefix }) => (
  <Stack spacing={0.5}>
    {choice.description ? (
      <>
        <Typography
          data-testid={`${testIdPrefix}-choice-description`}
          variant="body2"
        >
          {renderInlineMentions(choice.description, "minimal")}
        </Typography>
        <Typography
          color="text.secondary"
          data-testid={`${testIdPrefix}-choice-label`}
          variant="caption"
        >
          {renderInlineMentions(choice.label, "minimal")}
        </Typography>
      </>
    ) : (
      <Typography data-testid={`${testIdPrefix}-choice-label`} variant="body2">
        {renderInlineMentions(choice.label, "minimal")}
      </Typography>
    )}
  </Stack>
);

const decisionChoiceSurfaceSx = (theme: Theme) => ({
  bgcolor: theme.palette.action.hover,
  borderRadius: 1,
  px: 1.5,
  py: 1.5,
  "&:hover": { bgcolor: theme.palette.action.selected },
});

const getUniqueAffectedEntities = (
  entities: FeatureSyncDecisionGroup["affectedEntities"],
): FeatureSyncDecisionGroup["affectedEntities"] => {
  const seen = new Set<string>();

  return entities.filter((entity) => {
    const identity = `${entity.entityType}:${entity.entityId}`;
    if (seen.has(identity)) return false;

    seen.add(identity);
    return true;
  });
};
