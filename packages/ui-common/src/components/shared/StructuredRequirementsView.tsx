import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import {
  buildRequirementPresentationChanges,
  buildRequirementPresentationModel,
  type FeatureRequirementRecord,
  type RequirementPresentationItem,
  type RequirementPresentationModel,
} from "../../utils/structuredRequirements";
import {
  DiffRenderer,
  type DiffViewMode,
  WordDiffText,
} from "../SuggestedContent/DiffRenderer";
import { MentionBadgeInner } from "../SmarterTextAreaCard/MentionBadge";
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface StructuredRequirementsViewProps {
  requirements: readonly FeatureRequirementRecord[];
  itemAttributes?: ReadonlyMap<string, Record<string, string>>;
  itemStatementRenderers?: ReadonlyMap<string, React.ReactNode>;
  itemCitationDiffTones?: ReadonlyMap<
    string,
    ReadonlyMap<string, "equal" | "insert" | "delete">
  >;
  /**
   * Opt-in reading preview: show only the first `previewLimit` records in
   * collection order with a Show all control. Omit to render every record.
   */
  previewLimit?: number;
  /** Controls the preview disclosure when the owner keeps it across remounts. */
  previewExpanded?: boolean;
  onTogglePreview?: () => void;
  /** Render statement mentions as text badges instead of inline visuals. */
  badgeMentions?: boolean;
  /**
   * Records that are present in `requirements` but not rendered. Each group (or
   * the ungrouped list) that hides records says how many are hidden.
   */
  hiddenRequirementIds?: ReadonlySet<string>;
}

type CitationSlot = "designedBy" | "fulfilledBy" | "contracts";

const CITATION_SLOTS = ["designedBy", "fulfilledBy", "contracts"] as const;

const CITATION_SLOT_LABELS = {
  designedBy: "Designed by",
  fulfilledBy: "Fulfilled by",
  contracts: "Contracts",
} as const satisfies Record<CitationSlot, string>;

type RequirementCitationEntityType =
  "DESIGN_DOC" | "MOCKUP" | "DIAGRAM" | "TASK" | "PLAN" | "CONTRACT";

const REQUIREMENT_CITATION_ENTITY_TYPES: readonly string[] = [
  "DESIGN_DOC",
  "MOCKUP",
  "DIAGRAM",
  "TASK",
  "PLAN",
  "CONTRACT",
];

const isRequirementCitationEntityType = (
  value: string,
): value is RequirementCitationEntityType =>
  REQUIREMENT_CITATION_ENTITY_TYPES.includes(value);

interface CitationPresentationProps {
  cite: NonNullable<FeatureRequirementRecord[CitationSlot]>[number];
}

const CitationPresentation: React.FC<CitationPresentationProps> = ({
  cite,
}) => {
  if (!isRequirementCitationEntityType(cite.entityType)) {
    return <Typography variant="caption">Citation unavailable</Typography>;
  }

  return (
    <MentionBadgeInner
      mention={{
        entityType: cite.entityType,
        entityId: cite.entityId,
        entityName: cite.entityTitle,
      }}
      mode="minimal"
    />
  );
};

interface RequirementCitationsProps {
  item: RequirementPresentationItem;
  onShowAllFulfilledBy: (item: RequirementPresentationItem) => void;
  citationDiffTones?: ReadonlyMap<string, "equal" | "insert" | "delete">;
}

type CitationDiffTone = "equal" | "insert" | "delete";

const getCitationKey = (
  slot: CitationSlot,
  cite: NonNullable<FeatureRequirementRecord[CitationSlot]>[number],
): string => `${slot}:${cite.entityType}:${cite.entityId}`;

const getCitationKeys = (
  requirement: RequirementPresentationItem["requirement"] | undefined,
): Set<string> =>
  new Set(
    CITATION_SLOTS.flatMap((slot) =>
      (requirement?.[slot] ?? []).map((cite) => getCitationKey(slot, cite)),
    ),
  );

const getHiddenCitationDiffTone = (
  slot: CitationSlot,
  hiddenCites: NonNullable<FeatureRequirementRecord[CitationSlot]>,
  citationDiffTones: ReadonlyMap<string, CitationDiffTone> | undefined,
): CitationDiffTone | undefined => {
  const tones = hiddenCites.map((cite) =>
    citationDiffTones?.get(getCitationKey(slot, cite)),
  );

  return (
    tones.find((tone) => tone === "insert" || tone === "delete") ??
    tones.find((tone) => tone === "equal")
  );
};

const getDiffToneSx = (tone: CitationDiffTone | undefined) =>
  tone === "insert"
    ? {
        backgroundColor: "success.main",
        color: "success.contrastText",
      }
    : tone === "delete"
      ? {
          backgroundColor: "error.light",
          color: "error.contrastText",
        }
      : undefined;

const RequirementCitations: React.FC<RequirementCitationsProps> = ({
  item,
  onShowAllFulfilledBy,
  citationDiffTones,
}) => (
  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
    {CITATION_SLOTS.map((slot) => {
      const cites = item.requirement[slot] ?? [];
      if (cites.length === 0) return null;

      const visibleCites = slot === "fulfilledBy" ? cites.slice(0, 2) : cites;
      const hiddenCites = cites.slice(visibleCites.length);
      const hiddenCount = hiddenCites.length;
      const hiddenDiffTone = getHiddenCitationDiffTone(
        slot,
        hiddenCites,
        citationDiffTones,
      );
      return (
        <Stack
          key={slot}
          direction="row"
          spacing={0.75}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          data-testid="structured-requirement-citations"
          data-citation-slot={slot}
        >
          <Typography variant="caption" color="text.secondary">
            {CITATION_SLOT_LABELS[slot]}
          </Typography>
          {visibleCites.map((cite) => (
            <Box
              key={`${cite.entityType}:${cite.entityId}`}
              data-testid="structured-requirement-citation"
              data-diff-tone={citationDiffTones?.get(
                getCitationKey(slot, cite),
              )}
              sx={
                citationDiffTones?.get(getCitationKey(slot, cite)) === "insert"
                  ? {
                      "& [data-mention-token]": {
                        backgroundColor: "success.main",
                        color: "success.contrastText",
                      },
                    }
                  : citationDiffTones?.get(getCitationKey(slot, cite)) ===
                      "delete"
                    ? {
                        "& [data-mention-token]": {
                          backgroundColor: "error.light",
                          color: "error.contrastText",
                        },
                      }
                    : undefined
              }
            >
              <CitationPresentation cite={cite} />
            </Box>
          ))}
          {hiddenCount > 0 ? (
            <Button
              size="small"
              variant="text"
              onClick={() => onShowAllFulfilledBy(item)}
              aria-label={`Show all fulfilled by citations for ${item.statement}`}
              data-testid="structured-requirement-fulfilled-by-overflow"
              data-diff-tone={hiddenDiffTone}
              sx={{
                minWidth: 0,
                px: 0.5,
                py: 0,
                ...getDiffToneSx(hiddenDiffTone),
                ...(hiddenDiffTone === "insert" || hiddenDiffTone === "delete"
                  ? {
                      "&:hover": getDiffToneSx(hiddenDiffTone),
                    }
                  : {}),
              }}
            >
              +{hiddenCount}
            </Button>
          ) : null}
        </Stack>
      );
    })}
  </Stack>
);

const renderRequirement = (
  item: RequirementPresentationItem,
  onShowAllFulfilledBy: (item: RequirementPresentationItem) => void,
  itemAttributes?: ReadonlyMap<string, Record<string, string>>,
  itemStatementRenderers?: ReadonlyMap<string, React.ReactNode>,
  itemCitationDiffTones?: ReadonlyMap<
    string,
    ReadonlyMap<string, "equal" | "insert" | "delete">
  >,
  badgeMentions?: boolean,
): React.ReactNode => (
  <Box
    component="li"
    key={item.id}
    data-testid="structured-requirement-row"
    data-requirement-id={item.id}
    sx={{ mb: 0.5, "&:last-child": { mb: 0 } }}
    {...itemAttributes?.get(item.id)}
  >
    {itemStatementRenderers?.get(item.id) ?? (
      <MarkdownRenderer badgeMentions={badgeMentions}>
        {item.statement}
      </MarkdownRenderer>
    )}
    <RequirementCitations
      item={item}
      onShowAllFulfilledBy={onShowAllFulfilledBy}
      citationDiffTones={itemCitationDiffTones?.get(item.id)}
    />
  </Box>
);

const formatHiddenCount = (count: number, ungrouped = false): string =>
  `${count} unchanged ${ungrouped ? "ungrouped " : ""}${
    count === 1 ? "requirement" : "requirements"
  } hidden`;

const renderBlock = (
  block: RequirementPresentationModel["blocks"][number],
  onShowAllFulfilledBy: (item: RequirementPresentationItem) => void,
  itemAttributes?: ReadonlyMap<string, Record<string, string>>,
  itemStatementRenderers?: ReadonlyMap<string, React.ReactNode>,
  itemCitationDiffTones?: ReadonlyMap<
    string,
    ReadonlyMap<string, "equal" | "insert" | "delete">
  >,
  badgeMentions?: boolean,
  hiddenRequirementIds?: ReadonlySet<string>,
  hasGroups?: boolean,
): React.ReactNode => {
  const visibleItems = block.requirements.filter(
    (item) => !hiddenRequirementIds?.has(item.id),
  );
  const hiddenCount = block.requirements.length - visibleItems.length;
  const requirements = visibleItems.map((item) =>
    renderRequirement(
      item,
      onShowAllFulfilledBy,
      itemAttributes,
      itemStatementRenderers,
      itemCitationDiffTones,
      badgeMentions,
    ),
  );
  const hiddenNotice =
    hiddenCount > 0 ? (
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        data-testid="structured-requirements-hidden-count"
        sx={{ mt: visibleItems.length > 0 ? 0.5 : 0.25 }}
      >
        {formatHiddenCount(
          hiddenCount,
          block.kind === "ungrouped" && hasGroups,
        )}
      </Typography>
    ) : null;

  if (block.kind === "ungrouped") {
    return (
      <Box key="ungrouped">
        {visibleItems.length > 0 ? (
          <Box
            component="ul"
            sx={{
              m: 0,
              pl: 3,
              "& > li": { mb: 0.5, "&:last-child": { mb: 0 } },
            }}
          >
            {requirements}
          </Box>
        ) : null}
        {hiddenNotice}
      </Box>
    );
  }

  return (
    <Box
      component="div"
      key={`group-${block.label}`}
      data-testid="structured-requirements-group"
      data-requirement-group={block.label}
    >
      <Typography component="div" variant="subtitle2" fontWeight={700}>
        {block.label}
      </Typography>
      {visibleItems.length > 0 ? (
        <Box
          component="ul"
          sx={{
            m: 0,
            mt: 0.5,
            pl: 3,
            "& > li": { mb: 0.5, "&:last-child": { mb: 0 } },
          }}
        >
          {requirements}
        </Box>
      ) : null}
      {hiddenNotice}
    </Box>
  );
};

export const StructuredRequirementsView: React.FC<
  StructuredRequirementsViewProps
> = ({
  requirements,
  itemAttributes,
  itemStatementRenderers,
  itemCitationDiffTones,
  previewLimit,
  previewExpanded,
  onTogglePreview,
  badgeMentions,
  hiddenRequirementIds,
}) => {
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = previewExpanded ?? localExpanded;
  const hasPreviewOverflow =
    previewLimit !== undefined && requirements.length > previewLimit;
  const isPreviewing = hasPreviewOverflow && !isExpanded;
  const visibleRequirements = isPreviewing
    ? requirements.slice(0, previewLimit)
    : requirements;
  const model = buildRequirementPresentationModel(visibleRequirements);
  const hasGroups = model.blocks.some((block) => block.kind === "group");
  const [disclosedRequirementId, setDisclosedRequirementId] = useState<
    string | null
  >(null);
  const disclosedRequirement = disclosedRequirementId
    ? model.byId.get(disclosedRequirementId)
    : undefined;
  const disclosedCites = disclosedRequirement?.requirement.fulfilledBy ?? [];

  return (
    <>
      <Stack
        component="div"
        data-testid="structured-requirements"
        data-requirement-count={requirements.length}
        spacing={1.5}
      >
        {model.blocks.map((block, index) => (
          <React.Fragment
            key={block.kind === "group" ? block.label : `ungrouped-${index}`}
          >
            {renderBlock(
              block,
              (item) => setDisclosedRequirementId(item.id),
              itemAttributes,
              itemStatementRenderers,
              itemCitationDiffTones,
              badgeMentions,
              hiddenRequirementIds,
              hasGroups,
            )}
          </React.Fragment>
        ))}
        {hasPreviewOverflow ? (
          <Box>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setLocalExpanded((expanded) => !expanded);
                onTogglePreview?.();
              }}
              aria-expanded={isExpanded}
              data-testid="structured-requirements-show-all"
              sx={{ px: 0.5 }}
            >
              {isExpanded ? "Show less" : `View all (${requirements.length})`}
            </Button>
          </Box>
        ) : null}
      </Stack>
      <Dialog
        open={disclosedRequirement !== undefined}
        onClose={() => setDisclosedRequirementId(null)}
        maxWidth="sm"
        fullWidth
        data-testid="structured-requirement-fulfilled-by-dialog"
        closeControl={
          <IconButton
            aria-label="Close fulfilled by citations"
            onClick={() => setDisclosedRequirementId(null)}
            sx={{ position: "absolute", right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        }
      >
        <DialogTitle sx={{ pr: 6 }}>Fulfilled by</DialogTitle>
        <DialogContent dividers>
          {disclosedRequirement ? (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                {disclosedRequirement.statement}
              </Typography>
              <Stack spacing={1}>
                {disclosedCites.map((cite) => (
                  <Box key={`${cite.entityType}:${cite.entityId}`}>
                    <CitationPresentation cite={cite} />
                  </Box>
                ))}
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};

export interface StructuredRequirementsDiffViewProps {
  before: readonly FeatureRequirementRecord[];
  after: readonly FeatureRequirementRecord[];
  defaultViewMode?: DiffViewMode;
}

const buildChangeAttributes = (
  changes: ReturnType<typeof buildRequirementPresentationChanges>,
  pane: "old" | "new",
): ReadonlyMap<string, Record<string, string>> =>
  new Map(
    changes.map((change) => [
      change.id,
      {
        "data-requirement-change": change.kind,
        "data-diff-pane": pane,
      },
    ]),
  );

interface InlineRequirementsDiff {
  attributes: ReadonlyMap<string, Record<string, string>>;
  records: readonly FeatureRequirementRecord[];
  statementRenderers: ReadonlyMap<string, React.ReactNode>;
  citationDiffTones: ReadonlyMap<
    string,
    ReadonlyMap<string, "equal" | "insert" | "delete">
  >;
}

const buildStatementRenderer = (
  change: ReturnType<typeof buildRequirementPresentationChanges>[number],
  pane: "old" | "new",
): React.ReactNode | undefined => {
  const item = pane === "old" ? change.before : change.after;
  if (!item || change.kind === "unchanged") return undefined;

  return (
    <WordDiffText
      oldContent={change.before?.statement ?? ""}
      newContent={change.after?.statement ?? ""}
      pane={pane}
    />
  );
};

const buildCitationDiffTones = (
  change: ReturnType<typeof buildRequirementPresentationChanges>[number],
  pane: "old" | "new",
): ReadonlyMap<string, "equal" | "insert" | "delete"> | undefined => {
  const item = pane === "old" ? change.before : change.after;
  if (!item || change.kind === "unchanged") return undefined;

  const beforeKeys = getCitationKeys(change.before?.requirement);
  const afterKeys = getCitationKeys(change.after?.requirement);

  return new Map(
    CITATION_SLOTS.flatMap((slot) =>
      (item.requirement[slot] ?? []).map((cite) => {
        const key = getCitationKey(slot, cite);
        const isPresentOnOtherPane =
          pane === "old" ? afterKeys.has(key) : beforeKeys.has(key);
        return [
          key,
          isPresentOnOtherPane ? "equal" : pane === "old" ? "delete" : "insert",
        ] as const;
      }),
    ),
  );
};

const buildInlineRequirementsDiff = (
  changes: ReturnType<typeof buildRequirementPresentationChanges>,
): InlineRequirementsDiff => {
  const records: FeatureRequirementRecord[] = [];
  const attributes = new Map<string, Record<string, string>>();
  const statementRenderers = new Map<string, React.ReactNode>();
  const citationDiffTones = new Map<
    string,
    ReadonlyMap<string, "equal" | "insert" | "delete">
  >();

  for (const change of changes) {
    const versions =
      change.kind === "edited" || change.kind === "group-changed"
        ? (["old", "new"] as const)
        : change.kind === "removed"
          ? (["old"] as const)
          : (["new"] as const);

    for (const pane of versions) {
      const item = pane === "old" ? change.before : change.after;
      if (!item) continue;
      const renderId = `inline-${pane}-${change.id}`;
      records.push({ ...item.requirement, id: renderId });
      attributes.set(renderId, {
        "data-requirement-id": change.id,
        ...(change.kind === "unchanged"
          ? {}
          : {
              "data-requirement-change": change.kind,
              "data-diff-pane": pane,
            }),
      });
      const statementRenderer = buildStatementRenderer(change, pane);
      if (statementRenderer) {
        statementRenderers.set(renderId, statementRenderer);
      }
      const citationTones = buildCitationDiffTones(change, pane);
      if (citationTones) citationDiffTones.set(renderId, citationTones);
    }
  }

  return { records, attributes, statementRenderers, citationDiffTones };
};

export const StructuredRequirementsDiffView: React.FC<
  StructuredRequirementsDiffViewProps
> = ({ before, after, defaultViewMode = "split" }) => {
  const [showAll, setShowAll] = useState(false);
  const changes = buildRequirementPresentationChanges(before, after);
  const unchangedIds = changes
    .filter((change) => change.kind === "unchanged")
    .map((change) => change.id);
  const hiddenIds = showAll ? undefined : new Set(unchangedIds);
  const inlineHiddenIds = hiddenIds
    ? new Set(unchangedIds.map((changeId) => `inline-new-${changeId}`))
    : undefined;
  const oldAttributes = buildChangeAttributes(changes, "old");
  const newAttributes = buildChangeAttributes(changes, "new");
  const oldStatementRenderers = new Map(
    changes.flatMap((change) => {
      const renderer = buildStatementRenderer(change, "old");
      return renderer && change.before
        ? [[change.before.id, renderer] as const]
        : [];
    }),
  );
  const newStatementRenderers = new Map(
    changes.flatMap((change) => {
      const renderer = buildStatementRenderer(change, "new");
      return renderer && change.after
        ? [[change.after.id, renderer] as const]
        : [];
    }),
  );
  const oldCitationDiffTones = new Map(
    changes.flatMap((change) => {
      const tones = buildCitationDiffTones(change, "old");
      return tones && change.before ? [[change.before.id, tones] as const] : [];
    }),
  );
  const newCitationDiffTones = new Map(
    changes.flatMap((change) => {
      const tones = buildCitationDiffTones(change, "new");
      return tones && change.after ? [[change.after.id, tones] as const] : [];
    }),
  );
  const inline = buildInlineRequirementsDiff(changes);

  return (
    <Box data-testid="structured-requirements-diff">
      <DiffRenderer
        oldContent=""
        newContent=""
        defaultViewMode={defaultViewMode}
        showViewModeToggle
        contentRenderers={{
          split: {
            old: (
              <Box data-testid="structured-requirements-current">
                <StructuredRequirementsView
                  requirements={before}
                  itemAttributes={oldAttributes}
                  itemStatementRenderers={oldStatementRenderers}
                  itemCitationDiffTones={oldCitationDiffTones}
                  hiddenRequirementIds={hiddenIds}
                />
              </Box>
            ),
            new: (
              <Box data-testid="structured-requirements-proposed">
                <StructuredRequirementsView
                  requirements={after}
                  itemAttributes={newAttributes}
                  itemStatementRenderers={newStatementRenderers}
                  itemCitationDiffTones={newCitationDiffTones}
                  hiddenRequirementIds={hiddenIds}
                />
              </Box>
            ),
          },
          inline: (
            <Box data-testid="structured-requirements-inline">
              <StructuredRequirementsView
                requirements={inline.records}
                itemAttributes={inline.attributes}
                itemStatementRenderers={inline.statementRenderers}
                itemCitationDiffTones={inline.citationDiffTones}
                hiddenRequirementIds={inlineHiddenIds}
              />
            </Box>
          ),
        }}
      />
      {unchangedIds.length > 0 ? (
        <Box sx={{ mt: 0.5 }}>
          <Button
            size="small"
            variant="text"
            onClick={() => setShowAll((current) => !current)}
            aria-expanded={showAll}
            data-testid="structured-requirements-diff-show-all"
            sx={{ px: 0.5 }}
          >
            {showAll ? "Hide unchanged" : "Show all"}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
};
