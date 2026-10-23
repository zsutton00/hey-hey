import CloseIcon from "@mui/icons-material/Close";
import {
  alpha,
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import React, { memo, useCallback, useMemo } from "react";
import { AdvancedSearch } from "../../AdvancedSearch/AdvancedSearch";
import type { SearchEntity } from "../../AdvancedSearch/types";
import { EntityLinkWithPreview } from "../../Entity";
import { QuestionGroup } from "../../QuestionGroup";
import { SelectableEntityList } from "../../SelectableEntityList";
import type {
  EntityType,
  PlanGapItemPayload,
  RelatedEntityDto,
} from "../../../api";
import type {
  PlanGapAddedExistingEntity,
  PlanGapClarifyingAnswer,
  PlanGapCoverageReview,
  PlanGapReview,
} from "./types";
import { getPotentialCoverageForGap } from "./planGapsUtils";
import { EntityStatusChip } from "./EntityStatusChip";
import { sectionHeaderSx } from "./planGapsSharedState";
import { useDesignDoc } from "../../../data/hooks/useDesignDoc";
import { useWorkItem } from "../../../data/hooks/useWorkItem";

const SOURCE_CATEGORY_TO_ENTITY_TYPE: Record<string, string> = {
  design_docs: "design_doc",
  tasks: "task",
  services: "service",
};

interface PlanGapsCoverageListProps {
  items: RelatedEntityDto[];
  reviews: PlanGapCoverageReview[];
  isLocked: boolean;
  isEnabled: boolean;
  gapTitle: string;
  sourceCategory: "design_docs" | "tasks" | "services";
  onAcceptCoverage: (gapTitle: string, entityId: string) => void;
  onRejectCoverage: (gapTitle: string, entityId: string) => void;
  onCoverageCommentChange: (
    gapTitle: string,
    entityId: string,
    comment: string,
  ) => void;
  organizationId: string;
  projectId: string;
}

const CoverageItemWithStatus: React.FC<{
  entity: RelatedEntityDto;
  review: PlanGapCoverageReview | undefined;
  isLocked: boolean;
  isEnabled: boolean;
  organizationId: string;
  projectId: string;
  onAccept: (entityId: string) => void;
  onReject: (entityId: string) => void;
  onCommentChange: (entityId: string, comment: string) => void;
}> = memo(
  ({
    entity,
    review,
    isLocked,
    isEnabled,
    organizationId,
    projectId,
    onAccept,
    onReject,
    onCommentChange,
  }) => {
    const entityTypeLower = entity.entityType.toLowerCase();
    const isDesignDoc =
      entityTypeLower === "design_docs" || entityTypeLower === "design_doc";
    const isTask = entityTypeLower === "tasks" || entityTypeLower === "task";

    const { data: designDoc } = useDesignDoc(
      organizationId,
      isDesignDoc ? entity.entityId : undefined,
      { enabled: isDesignDoc },
    );

    const { workItem: task } = useWorkItem(
      organizationId,
      "task",
      isTask ? entity.entityId : "",
      { enabled: isTask },
    );

    const status = isDesignDoc
      ? designDoc?.status
      : isTask
        ? task?.status
        : null;

    // Extract description from task sections
    const description =
      isTask && task?.sections
        ? task.sections.find((section) => section.key === "description")
            ?.materializedMarkdown
        : null;

    const formatStatus = (statusValue: string): string => {
      return String(statusValue)
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
    };

    const statusMeta = status ? formatStatus(status) : undefined;

    const truncatedDescription = description
      ? description.length > 120
        ? `${description.slice(0, 120)}...`
        : description
      : undefined;

    return (
      <SelectableEntityList
        items={[
          {
            id: entity.entityId,
            title: entity.entityName,
            badgeColor: "secondary",
            status: review?.action ?? "pending",
            comment: review?.comment,
            meta: statusMeta,
            description: truncatedDescription,
            link: {
              entityId: entity.entityId,
              entityType: entity.entityType,
              organizationId,
              projectId,
            },
          },
        ]}
        emptyMessage=""
        showActions={true}
        disabled={isLocked || !isEnabled}
        showBorder={true}
        onAccept={onAccept}
        onReject={onReject}
        onCommentChange={onCommentChange}
      />
    );
  },
);

const PlanGapsCoverageListComponent: React.FC<PlanGapsCoverageListProps> = ({
  items,
  reviews,
  isLocked,
  isEnabled,
  gapTitle,
  sourceCategory,
  onAcceptCoverage,
  onRejectCoverage,
  onCoverageCommentChange,
  organizationId,
  projectId,
}) => {
  const handleAccept = useCallback(
    (entityId: string) => {
      onAcceptCoverage(gapTitle, entityId);
    },
    [gapTitle, onAcceptCoverage],
  );

  const handleReject = useCallback(
    (entityId: string) => {
      onRejectCoverage(gapTitle, entityId);
    },
    [gapTitle, onRejectCoverage],
  );

  const handleCommentChange = useCallback(
    (entityId: string, comment: string) => {
      onCoverageCommentChange(gapTitle, entityId, comment);
    },
    [gapTitle, onCoverageCommentChange],
  );

  if (items.length === 0) {
    return null;
  }

  const getExplanationText = (): string => {
    if (sourceCategory === "design_docs") {
      return "These are existing design documents that may already cover this gap. Select any that apply instead of creating a new one.";
    }
    if (sourceCategory === "tasks") {
      return "These are existing tasks that may already address this gap. Select any that apply instead of creating a new one.";
    }
    return "These are existing items that may already cover this gap. Select any that apply.";
  };

  return (
    <Paper
      elevation={0}
      sx={{
        mt: 1.5,
        p: 1.5,
        bgcolor: "action.hover",
        border: 1,
        borderColor: "divider",
      }}
    >
      <Stack spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Existing items
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {getExplanationText()}
        </Typography>
        <Box sx={{ opacity: isEnabled ? 1 : 0.45 }}>
          {items.map((entity) => {
            const review = reviews.find(
              (item) => item.entityId === entity.entityId,
            );
            return (
              <CoverageItemWithStatus
                key={entity.entityId}
                entity={entity}
                review={review}
                isLocked={isLocked}
                isEnabled={isEnabled}
                organizationId={organizationId}
                projectId={projectId}
                onAccept={handleAccept}
                onReject={handleReject}
                onCommentChange={handleCommentChange}
              />
            );
          })}
        </Box>
      </Stack>
    </Paper>
  );
};

const PlanGapsCoverageList = memo(PlanGapsCoverageListComponent);

export interface PlanGapsGapListProps {
  title: string;
  description?: string;
  gaps: PlanGapItemPayload[];
  gapReviews: PlanGapReview[];
  isLocked: boolean;
  emptyMessage: string;
  sourceCategory: "design_docs" | "tasks" | "services";
  onAcceptGap: (gapTitle: string) => void;
  onRejectGap: (gapTitle: string) => void;
  onGapCommentChange: (gapTitle: string, comment: string) => void;
  onAcceptCoverage: (gapTitle: string, entityId: string) => void;
  onRejectCoverage: (gapTitle: string, entityId: string) => void;
  onCoverageCommentChange: (
    gapTitle: string,
    entityId: string,
    comment: string,
  ) => void;
  organizationId: string;
  projectId: string;
}

const PlanGapsGapListComponent: React.FC<PlanGapsGapListProps> = ({
  title,
  description,
  gaps,
  gapReviews,
  isLocked,
  emptyMessage,
  sourceCategory,
  onAcceptGap,
  onRejectGap,
  onGapCommentChange,
  onAcceptCoverage,
  onRejectCoverage,
  onCoverageCommentChange,
  organizationId,
  projectId,
}) => {
  const theme = useTheme();
  const hasItems = gaps.length > 0;

  const statusBackgroundColors = useMemo(() => {
    const getAcceptColor = (): string => {
      if (sourceCategory === "design_docs") {
        return alpha(theme.palette.interactive.contrastText, 0.08);
      }
      if (sourceCategory === "tasks") {
        return alpha(theme.palette.task.main, 0.08);
      }
      return alpha(theme.palette.grey[500], 0.08);
    };

    return {
      accept: getAcceptColor(),
      pending: theme.palette.background.paper,
    };
  }, [sourceCategory, theme]);

  const items = useMemo(
    () =>
      gaps.map((gap) => {
        const review = gapReviews.find((item) => item.title === gap.title);
        const coverageItems = getPotentialCoverageForGap(gap);
        const isEnabled = review?.action === "accept";
        return {
          id: gap.title,
          title: gap.title,
          description: gap.description || undefined,
          entityType: SOURCE_CATEGORY_TO_ENTITY_TYPE[gap.sourceCategory],
          notes: gap.notes,
          overlapNotes:
            gap.overlapDetected && gap.overlapNotes
              ? gap.overlapNotes
              : undefined,
          status: review?.action ?? "pending",
          comment: review?.comment,
          detailContent: (
            <PlanGapsCoverageList
              items={coverageItems}
              reviews={review?.coverageReviews ?? []}
              isLocked={isLocked}
              isEnabled={isEnabled}
              gapTitle={gap.title}
              sourceCategory={gap.sourceCategory}
              onAcceptCoverage={onAcceptCoverage}
              onRejectCoverage={onRejectCoverage}
              onCoverageCommentChange={onCoverageCommentChange}
              organizationId={organizationId}
              projectId={projectId}
            />
          ),
        };
      }),
    [
      gaps,
      gapReviews,
      isLocked,
      onAcceptCoverage,
      onRejectCoverage,
      onCoverageCommentChange,
      organizationId,
      projectId,
    ],
  );

  return (
    <Box>
      <Typography variant="overline" sx={sectionHeaderSx}>
        {title}
      </Typography>
      {description && hasItems && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 3, fontSize: 15 }}
        >
          {description}
        </Typography>
      )}
      <SelectableEntityList
        items={items}
        emptyMessage={emptyMessage}
        showActions={true}
        showBorder={true}
        showBackground={true}
        disabled={isLocked}
        showEntityTypeChip={false}
        entityIconPosition="inline"
        titleFontSize="1.1rem"
        statusBackgroundColors={statusBackgroundColors}
        onAccept={onAcceptGap}
        onReject={onRejectGap}
        onCommentChange={onGapCommentChange}
      />
    </Box>
  );
};

export const PlanGapsGapList = memo(PlanGapsGapListComponent);

export interface PlanGapsAddedExistingListProps {
  items: PlanGapAddedExistingEntity[];
  isLocked: boolean;
  organizationId: string;
  projectId: string;
  onRemove: (entityId: string) => void;
}

const PlanGapsAddedExistingListComponent: React.FC<
  PlanGapsAddedExistingListProps
> = ({ items, isLocked, organizationId, projectId, onRemove }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <List sx={{ py: 0 }}>
      {items.map((item) => (
        <ListItem
          key={item.entityId}
          sx={{
            px: 1,
            py: 1,
            borderRadius: 1,
            mb: 1,
            alignItems: "flex-start",
            backgroundColor: "action.hover",
            border: 1,
            borderColor: "divider",
          }}
        >
          <ListItemText
            primary={
              <Stack direction="row" spacing={1} alignItems="center">
                <EntityLinkWithPreview
                  label={item.name}
                  entityId={item.entityId}
                  entityType={item.entityType}
                  organizationId={organizationId}
                  projectId={projectId}
                />
                <EntityStatusChip
                  entityId={item.entityId}
                  entityType={item.entityType}
                  organizationId={organizationId}
                />
                <Chip label="Added" size="small" color="primary" />
              </Stack>
            }
          />
          <IconButton
            size="small"
            onClick={() => onRemove(item.entityId)}
            disabled={isLocked}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </ListItem>
      ))}
    </List>
  );
};

export const PlanGapsAddedExistingList = memo(
  PlanGapsAddedExistingListComponent,
);

export interface PlanGapsSearchSectionProps {
  showSearch: boolean;
  onShowSearch: () => void;
  isLocked: boolean;
  entityType: EntityType;
  organizationId: string;
  projectId: string;
  onSelect: (entities: SearchEntity[]) => void;
  searchButtonLabel: string;
}

const PlanGapsSearchSectionComponent: React.FC<PlanGapsSearchSectionProps> = ({
  showSearch,
  onShowSearch,
  isLocked,
  entityType,
  organizationId,
  projectId,
  onSelect,
  searchButtonLabel,
}) =>
  showSearch ? (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        mt: 2,
        overflow: "hidden",
        height: 420,
        opacity: isLocked ? 0.6 : 1,
        pointerEvents: isLocked ? "none" : "auto",
      }}
    >
      <AdvancedSearch
        organizationId={organizationId}
        projectId={projectId}
        allowMultiSelect={true}
        defaultEntityTypes={[entityType]}
        hideFilters={true}
        onSelect={onSelect}
      />
    </Box>
  ) : (
    <Box sx={{ mt: 2 }}>
      <Button
        variant="outlined"
        size="small"
        onClick={onShowSearch}
        disabled={isLocked}
      >
        {searchButtonLabel}
      </Button>
    </Box>
  );

export const PlanGapsSearchSection = memo(PlanGapsSearchSectionComponent);

export interface PlanGapsClarifyingSectionProps {
  questions: string[];
  answers: PlanGapClarifyingAnswer[];
  onChange: (answers: PlanGapClarifyingAnswer[]) => void;
  isLocked: boolean;
}

const PlanGapsClarifyingSectionComponent: React.FC<
  PlanGapsClarifyingSectionProps
> = ({ questions, answers, onChange, isLocked }) => {
  if (questions.length === 0) {
    return null;
  }

  return (
    <Box>
      <Typography variant="overline" sx={sectionHeaderSx}>
        Additional questions
      </Typography>
      <QuestionGroup
        questions={questions}
        answers={answers}
        onChange={onChange}
        disabled={isLocked}
      />
    </Box>
  );
};

export const PlanGapsClarifyingSection = memo(
  PlanGapsClarifyingSectionComponent,
);
