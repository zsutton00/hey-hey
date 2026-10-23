import { Box, Divider, Stack, Typography } from "@mui/material";
import React, { useMemo, useState } from "react";
import type { SearchEntity } from "../../AdvancedSearch/types";
import { EntityType } from "../../../api";
import type { FieldComponentProps } from "./types";
import type {
  PlanGapsServicesFieldConfig,
  PlanGapsServicesValue,
} from "./types";
import { createPlanGapsServicesValue } from "./planGapsUtils";
import {
  PlanGapsAddedExistingList,
  PlanGapsClarifyingSection,
  PlanGapsGapList,
  PlanGapsSearchSection,
} from "./PlanGapsShared";
import {
  sectionHeaderSx,
  usePlanGapsReviewHandlers,
  usePlanGapsReviewState,
} from "./planGapsSharedState";

export interface PlanGapsServicesFieldProps
  extends Omit<FieldComponentProps<PlanGapsServicesValue>, "config"> {
  config: PlanGapsServicesFieldConfig;
}

export const PlanGapsServicesField: React.FC<PlanGapsServicesFieldProps> = ({
  config,
  value,
  onChange,
  disabled = false,
  isSubmitted = false,
  context,
}) => {
  const payload = config.payload;
  const fallbackValue = useMemo(
    () =>
      payload
        ? createPlanGapsServicesValue(
            payload.gaps.services,
            payload.clarificationQuestions.services
          )
        : null,
    [payload]
  );
  const [showSearch, setShowSearch] = useState(false);

  const { fieldValue, gapReviews, clarifyingAnswers } =
    usePlanGapsReviewState<PlanGapsServicesValue>({
      payload,
      value,
      fallbackValue,
      gaps: payload?.gaps.services ?? [],
      clarificationQuestions: payload?.clarificationQuestions.services ?? [],
    });
  const {
    updateGapReviewAction,
    updateGapReviewComment,
    updateCoverageReviewAction,
    updateCoverageReviewComment,
    updateClarifyingAnswers,
  } = usePlanGapsReviewHandlers({
    fieldValue,
    gapReviews,
    onChange,
  });

  if (!payload || !fieldValue) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Missing plan gap services payload</Typography>
      </Box>
    );
  }

  const isLocked = disabled || isSubmitted;

  const handleRemoveService = (entityId: string) => {
    onChange?.({
      ...fieldValue,
      gapReviews,
      clarifyingAnswers,
      manuallyAdded: fieldValue.manuallyAdded.filter(
        (item) => item.entityId !== entityId
      ),
    });
  };

  const handleSearchSelect = (entities: SearchEntity[]) => {
    if (entities.length === 0) return;

    const existingIds = new Set(
      fieldValue.manuallyAdded.map((item) => item.entityId)
    );

    const additions = entities
      .filter(
        (entity) =>
          entity.type.toLowerCase() === EntityType.Service.toLowerCase()
      )
      .filter((entity) => !existingIds.has(entity.id))
      .map((entity) => ({
        source: "user_added" as const,
        kind: "existing" as const,
        entityType: "services" as const,
        entityId: entity.id,
        name: entity.name,
      }));

    if (additions.length === 0) return;

    onChange?.({
      ...fieldValue,
      gapReviews,
      clarifyingAnswers,
      manuallyAdded: [...fieldValue.manuallyAdded, ...additions],
    });
  };

  return (
    <Stack spacing={3} data-testid={`plan-gaps-services-${config.field}`}>
      <Typography variant="body2" color="text.secondary">
        {config.description}
        {config.required && (
          <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>

      <PlanGapsGapList
        title="Recommended services"
        description="We think services on these subjects could be useful. Accept or reject them to shape the plan."
        gaps={payload.gaps.services}
        gapReviews={gapReviews}
        isLocked={isLocked}
        emptyMessage="No service gaps identified."
        sourceCategory="services"
        onAcceptGap={(gapId) => updateGapReviewAction(gapId, "accept")}
        onRejectGap={(gapId) => updateGapReviewAction(gapId, "reject")}
        onGapCommentChange={updateGapReviewComment}
        onAcceptCoverage={(gapTitle, entityId) =>
          updateCoverageReviewAction(gapTitle, entityId, "accept")
        }
        onRejectCoverage={(gapTitle, entityId) =>
          updateCoverageReviewAction(gapTitle, entityId, "reject")
        }
        onCoverageCommentChange={updateCoverageReviewComment}
        organizationId={context.organizationId}
        projectId={context.projectId}
      />

      <Divider />

      <Box>
        <Typography variant="overline" sx={sectionHeaderSx}>
          Any services we missed?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Did we miss any services? Show us what to include.
        </Typography>
        <PlanGapsAddedExistingList
          items={fieldValue.manuallyAdded}
          isLocked={isLocked}
          organizationId={context.organizationId}
          projectId={context.projectId}
          onRemove={handleRemoveService}
        />

        <PlanGapsSearchSection
          showSearch={showSearch}
          onShowSearch={() => setShowSearch(true)}
          isLocked={isLocked}
          entityType={EntityType.Service}
          organizationId={context.organizationId}
          projectId={context.projectId}
          onSelect={handleSearchSelect}
          searchButtonLabel="Search for services"
        />
      </Box>

      <Divider />

      <PlanGapsClarifyingSection
        questions={payload.clarificationQuestions.services}
        answers={clarifyingAnswers}
        onChange={updateClarifyingAnswers}
        isLocked={isLocked}
      />
    </Stack>
  );
};
