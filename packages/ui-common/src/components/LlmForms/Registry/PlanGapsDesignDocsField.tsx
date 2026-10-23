import { Box, Divider, Stack, Typography } from "@mui/material";
import React, { useCallback, useMemo, useState } from "react";
import type { SearchEntity } from "../../AdvancedSearch/types";
import { EntityType } from "../../../api";
import type { FieldComponentProps } from "./types";
import type {
  PlanGapsDesignDocsFieldConfig,
  PlanGapsDesignDocsValue,
} from "./types";
import { createPlanGapsDesignDocsValue } from "./planGapsUtils";
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

export interface PlanGapsDesignDocsFieldProps
  extends Omit<FieldComponentProps<PlanGapsDesignDocsValue>, "config"> {
  config: PlanGapsDesignDocsFieldConfig;
}

export const PlanGapsDesignDocsField: React.FC<
  PlanGapsDesignDocsFieldProps
> = ({
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
        ? createPlanGapsDesignDocsValue(
            payload.gaps.design_docs,
            payload.clarificationQuestions.design_docs
          )
        : null,
    [payload]
  );
  const [showSearch, setShowSearch] = useState(false);

  const { fieldValue, gapReviews, clarifyingAnswers } =
    usePlanGapsReviewState<PlanGapsDesignDocsValue>({
      payload,
      value,
      fallbackValue,
      gaps: payload?.gaps.design_docs ?? [],
      clarificationQuestions: payload?.clarificationQuestions.design_docs ?? [],
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

  const handleRemoveDoc = useCallback(
    (entityId: string) => {
      if (!fieldValue) return;
      onChange?.({
        ...fieldValue,
        gapReviews: fieldValue.gapReviews,
        clarifyingAnswers: fieldValue.clarifyingAnswers,
        manuallyAdded: fieldValue.manuallyAdded.filter(
          (item) => item.entityId !== entityId
        ),
      });
    },
    [fieldValue, onChange]
  );

  const handleSearchSelect = useCallback(
    (entities: SearchEntity[]) => {
      if (!fieldValue || entities.length === 0) return;

      const existingIds = new Set(
        fieldValue.manuallyAdded.map((item) => item.entityId)
      );

      const additions = entities
        .filter(
          (entity) =>
            entity.type.toLowerCase() === EntityType.DesignDoc.toLowerCase()
        )
        .filter((entity) => !existingIds.has(entity.id))
        .map((entity) => ({
          source: "user_added" as const,
          kind: "existing" as const,
          entityType: "design_docs" as const,
          entityId: entity.id,
          name: entity.name,
        }));

      if (additions.length === 0) return;

      onChange?.({
        ...fieldValue,
        gapReviews: fieldValue.gapReviews,
        clarifyingAnswers: fieldValue.clarifyingAnswers,
        manuallyAdded: [...fieldValue.manuallyAdded, ...additions],
      });
    },
    [fieldValue, onChange]
  );

  const handleShowSearch = useCallback(() => setShowSearch(true), []);

  if (!payload || !fieldValue) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Missing plan gap design docs payload</Typography>
      </Box>
    );
  }

  const isLocked = disabled || isSubmitted;

  return (
    <Stack spacing={3} data-testid={`plan-gaps-design-docs-${config.field}`}>
      <PlanGapsGapList
        title="Recommended design docs"
        description="We think designs on these subjects could be useful. If you accept, we'll create a step in the plan to write them."
        gaps={payload.gaps.design_docs}
        gapReviews={gapReviews}
        isLocked={isLocked}
        emptyMessage="No design doc gaps identified."
        sourceCategory="design_docs"
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
          Any design docs we missed?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Did we miss any design docs? Show us what to include.
        </Typography>
        <PlanGapsAddedExistingList
          items={fieldValue.manuallyAdded}
          isLocked={isLocked}
          organizationId={context.organizationId}
          projectId={context.projectId}
          onRemove={handleRemoveDoc}
        />

        <PlanGapsSearchSection
          showSearch={showSearch}
          onShowSearch={handleShowSearch}
          isLocked={isLocked}
          entityType={EntityType.DesignDoc}
          organizationId={context.organizationId}
          projectId={context.projectId}
          onSelect={handleSearchSelect}
          searchButtonLabel="Search for design docs"
        />
      </Box>

      <Divider />

      <PlanGapsClarifyingSection
        questions={payload.clarificationQuestions.design_docs}
        answers={clarifyingAnswers}
        onChange={updateClarifyingAnswers}
        isLocked={isLocked}
      />
    </Stack>
  );
};
