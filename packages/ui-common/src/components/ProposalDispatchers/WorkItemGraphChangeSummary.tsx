import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { alpha, useTheme } from "@mui/material/styles";
import type {
  AgentEdgeResponseDto,
  ProjectedWorkItemRelationship,
  WorkItemGraphAggregateResponseDto,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetOperation,
  WorkItemChangeSetRelationshipIdentity,
} from "../../api";
import { DiffRenderer } from "../SuggestedContent";
import type { DiffViewMode } from "../SuggestedContent";
import type { WorkItemGraphDraftProjection } from "../shared/workItemGraphDraft";
import {
  DIAGRAM_GROUP_MEANING_LABELS,
  DIAGRAM_GROUPS_SCHEMA_VERSION,
  parseDiagramGroups,
} from "../shared/diagramGroupBoundaries";

interface WorkItemGraphChangeSummaryProps {
  operations: readonly WorkItemChangeSetOperation[];
  projection: WorkItemGraphDraftProjection;
  priorAggregate?: WorkItemGraphAggregateResponseDto | null;
  resolvedEntityNames?: Readonly<Record<string, string>>;
  diffDefaultViewMode?: DiffViewMode;
}

export interface GraphChangeSummaryItem {
  key: string;
  kind: "added" | "changed" | "deleted";
  title: string;
  detail?: string;
  /** Single-sided text: nothing to compare against. */
  content?: string;
  /** Both sides present: compared with DiffRenderer. */
  before?: string;
  after?: string;
}

const workItemIdentityKey = (identity: WorkItemChangeSetIdentity): string =>
  identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;

const relationshipIdentityKey = (
  identity: WorkItemChangeSetRelationshipIdentity,
): string =>
  identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;

const humanize = (value: string): string =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (content === null) return "null";
  return JSON.stringify(content, null, 2);
};

const formatSectionContent = (key: string, content: unknown): string => {
  if (typeof content !== "object" || content === null)
    return formatContent(content);
  const value = content as Readonly<Record<string, unknown>>;
  if (
    key === "diagramMetadata" &&
    typeof value.kind === "string" &&
    typeof value.level === "string"
  ) {
    return `Kind: ${humanize(value.kind.toLowerCase())}\nLevel: ${humanize(
      value.level.toLowerCase(),
    )}`;
  }
  if (key === "diagramElementMetadata" && typeof value.role === "string") {
    const reference = value.canonicalReference;
    const referenceText =
      typeof reference === "object" &&
      reference !== null &&
      "entityType" in reference
        ? `\nCanonical reference: ${humanize(String(reference.entityType))}`
        : "\nCanonical reference: None";
    return `Role: ${humanize(value.role.toLowerCase())}${referenceText}`;
  }
  return formatContent(content);
};

const canonicalReferenceKey = (content: unknown): string | undefined => {
  if (typeof content !== "object" || content === null) return undefined;
  const reference = (content as Record<string, unknown>).canonicalReference;
  if (typeof reference !== "object" || reference === null) return undefined;
  const entityId = (reference as Record<string, unknown>).entityId;
  const entityType = (reference as Record<string, unknown>).entityType;
  return typeof entityId === "string" && typeof entityType === "string"
    ? `${entityType}:${entityId}`
    : undefined;
};

const formatDiagramElementMetadata = (
  content: unknown,
  resolvedEntityNames: Readonly<Record<string, string>>,
): string => {
  if (typeof content !== "object" || content === null)
    return formatContent(content);
  const value = content as Readonly<Record<string, unknown>>;
  const role =
    typeof value.role === "string"
      ? humanize(value.role.toLowerCase())
      : "None";
  const referenceKey = canonicalReferenceKey(content);
  return `Role: ${role}\nCanonical reference: ${
    referenceKey
      ? (resolvedEntityNames[referenceKey] ?? "Unavailable target")
      : "None"
  }`;
};

const isDiagramGroupsValue = (content: unknown): boolean => {
  let value = content;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return false;
    }
  }
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion ===
      DIAGRAM_GROUPS_SCHEMA_VERSION
  );
};

/** Reviewers read groups as a nested outline of labels, never raw JSON. */
const formatDiagramGroups = (
  content: unknown,
  projection: WorkItemGraphDraftProjection | undefined,
): string => {
  const groups = parseDiagramGroups(content);
  if (groups.length === 0) return "No groups";
  const ids = new Set(groups.map((group) => group.id));
  const lines: string[] = [];
  const visit = (parentId: string | undefined, depth: number) =>
    groups
      .filter((group) =>
        parentId
          ? group.parentGroupId === parentId
          : !group.parentGroupId || !ids.has(group.parentGroupId),
      )
      .forEach((group) => {
        const members = group.members.map((member) => {
          const identity: WorkItemChangeSetIdentity =
            member.kind === "persistedWorkItem"
              ? { refType: "existing", id: member.workItemId }
              : { refType: "temporary", tempId: member.temporaryRef };
          return projection
            ? getWorkItemLabel(identity, projection)
            : workItemIdentityKey(identity);
        });
        lines.push(
          `${"  ".repeat(depth)}${group.label} (${
            DIAGRAM_GROUP_MEANING_LABELS[group.meaning]
          })${members.length ? `: ${members.join(", ")}` : ""}`,
        );
        if (depth < groups.length) visit(group.id, depth + 1);
      });
  visit(undefined, 0);
  return lines.join("\n");
};

const formatReviewSection = (
  key: string,
  content: unknown,
  resolvedEntityNames: Readonly<Record<string, string>>,
  projection?: WorkItemGraphDraftProjection,
): string =>
  key === "diagramElementMetadata"
    ? formatDiagramElementMetadata(content, resolvedEntityNames)
    : isDiagramGroupsValue(content)
      ? formatDiagramGroups(content, projection)
      : formatSectionContent(key, content);

const compareSides = (
  before: string | undefined,
  after: string,
): Pick<GraphChangeSummaryItem, "content" | "before" | "after"> =>
  before === undefined ? { content: after } : { before, after };

const findPriorSection = (
  aggregate: WorkItemGraphAggregateResponseDto | null | undefined,
  identity: WorkItemChangeSetIdentity,
  key: string,
): unknown | undefined => {
  if (!aggregate || identity.refType !== "existing") return undefined;
  const item = [aggregate.root, ...aggregate.children].find(
    (candidate) => candidate.id === identity.id,
  );
  const markdown = item?.sections?.find(
    (section) => section.key === key,
  )?.materializedMarkdown;
  if (markdown === undefined) return undefined;
  if (key !== "diagramMetadata" && key !== "diagramElementMetadata") {
    return markdown;
  }
  try {
    return JSON.parse(markdown) as unknown;
  } catch {
    return markdown;
  }
};

const formatPriorLayout = (
  aggregate: WorkItemGraphAggregateResponseDto | null | undefined,
  projection: WorkItemGraphDraftProjection,
): string | undefined =>
  aggregate?.layout?.nodes
    .map((entry) => {
      const identity: WorkItemChangeSetIdentity =
        entry.node.kind === "persistedWorkItem"
          ? { refType: "existing", id: entry.node.workItemId }
          : { refType: "temporary", tempId: entry.node.temporaryRef };
      return `${getWorkItemLabel(identity, projection)}: (${
        entry.position.x
      }, ${entry.position.y})`;
    })
    .join("\n");

const priorRelationship = (
  aggregate: WorkItemGraphAggregateResponseDto | null | undefined,
  identity: WorkItemChangeSetRelationshipIdentity,
): AgentEdgeResponseDto | undefined =>
  aggregate && identity.refType === "existing"
    ? aggregate.relationships.find(
        (relationship) => relationship.id === identity.id,
      )
    : undefined;

const priorRelationshipExplanation = (
  relationship: AgentEdgeResponseDto | undefined,
): string | undefined =>
  relationshipExplanation(
    relationship
      ? {
          identity: { refType: "existing", id: relationship.id },
          label: relationship.type,
          source: { refType: "existing", id: relationship.sourceNodeId },
          target: { refType: "existing", id: relationship.targetNodeId },
          edgeType: relationship.type,
          category: relationship.category,
          direction: relationship.direction ?? undefined,
          predicate: relationship.predicate,
          reasoning: relationship.reasoning,
          metadata: relationship.metadata,
          deleted: false,
        }
      : undefined,
  );

const projectedRelationshipDescription = (
  relationship: ProjectedWorkItemRelationship | undefined,
  projection: WorkItemGraphDraftProjection,
): string | undefined =>
  relationship
    ? [
        relationshipDetail(relationship, projection),
        relationshipExplanation(relationship),
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n")
    : undefined;

const priorRelationshipDescription = (
  relationship: AgentEdgeResponseDto | undefined,
  projection: WorkItemGraphDraftProjection,
): string | undefined =>
  relationship
    ? [
        relationshipDetail(
          {
            source: { refType: "existing", id: relationship.sourceNodeId },
            target: { refType: "existing", id: relationship.targetNodeId },
          },
          projection,
        ),
        priorRelationshipExplanation(relationship),
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n")
    : undefined;

const relationshipExplanation = (
  relationship: ProjectedWorkItemRelationship | undefined,
): string | undefined => {
  if (!relationship) return undefined;
  const metadata = relationship.metadata;
  const values = [
    relationship.direction
      ? `Direction: ${humanize(relationship.direction)}`
      : null,
    relationship.predicate ? `Label: ${relationship.predicate}` : null,
    typeof metadata?.label === "string" ? `Label: ${metadata.label}` : null,
    typeof metadata?.description === "string"
      ? `Description: ${metadata.description}`
      : null,
    relationship.reasoning ? `Reason: ${relationship.reasoning}` : null,
  ].filter((value): value is string => value !== null);
  return values.length ? values.join("\n") : undefined;
};

const getWorkItemLabel = (
  identity: WorkItemChangeSetIdentity,
  projection: WorkItemGraphDraftProjection,
): string => {
  const key = workItemIdentityKey(identity);
  const projectedItem = [projection.projectedRoot, ...projection.children].find(
    (item) => workItemIdentityKey(item.identity) === key,
  );

  return projection.identityLabels[key] ?? projectedItem?.label ?? "Work item";
};

const getProjectedRelationship = (
  identity: WorkItemChangeSetRelationshipIdentity,
  projection: WorkItemGraphDraftProjection,
): ProjectedWorkItemRelationship | undefined => {
  const key = relationshipIdentityKey(identity);
  return projection.incidentRelationships.find(
    (relationship) => relationshipIdentityKey(relationship.identity) === key,
  );
};

const relationshipDetail = (
  relationship: Pick<ProjectedWorkItemRelationship, "source" | "target">,
  projection: WorkItemGraphDraftProjection,
): string =>
  `${getWorkItemLabel(relationship.source, projection)} → ${getWorkItemLabel(
    relationship.target,
    projection,
  )}`;

const summarizeOperation = (
  operation: WorkItemChangeSetOperation,
  projection: WorkItemGraphDraftProjection,
  priorAggregate: WorkItemGraphAggregateResponseDto | null | undefined,
  resolvedEntityNames: Readonly<Record<string, string>>,
  index: number,
): GraphChangeSummaryItem => {
  const key = `${index}:${operation.op}`;

  switch (operation.op) {
    case "workItem.create":
      return { key, kind: "added", title: `Added ${operation.name}` };
    case "workItem.update":
      return {
        key,
        kind: "changed",
        title: `Updated ${getWorkItemLabel(operation.ref, projection)}`,
      };
    case "workItem.delete":
      return {
        key,
        kind: "deleted",
        title: `Removed ${getWorkItemLabel(operation.ref, projection)}`,
      };
    case "section.replace": {
      const previousSection = findPriorSection(
        priorAggregate,
        operation.ref,
        operation.key,
      );
      return {
        key,
        kind: "changed",
        title: `Updated ${humanize(operation.key)}`,
        detail: getWorkItemLabel(operation.ref, projection),
        ...compareSides(
          previousSection === undefined
            ? undefined
            : formatReviewSection(
                operation.key,
                previousSection,
                resolvedEntityNames,
                projection,
              ),
          formatReviewSection(
            operation.key,
            operation.content,
            resolvedEntityNames,
            projection,
          ),
        ),
      };
    }
    case "section.clear": {
      const clearedSection = findPriorSection(
        priorAggregate,
        operation.ref,
        operation.key,
      );
      return {
        key,
        kind: "deleted",
        title: `Removed ${humanize(operation.key)}`,
        detail: getWorkItemLabel(operation.ref, projection),
        ...compareSides(
          clearedSection === undefined
            ? undefined
            : formatReviewSection(
                operation.key,
                clearedSection,
                resolvedEntityNames,
                projection,
              ),
          "Explicitly cleared",
        ),
      };
    }
    case "relationship.create":
      return {
        key,
        kind: "added",
        title: `Added ${humanize(operation.edgeType)}`,
        detail: relationshipDetail(operation, projection),
        content: relationshipExplanation(
          getProjectedRelationship(operation.ref, projection),
        ),
      };
    case "relationship.delete": {
      const relationship = getProjectedRelationship(operation.ref, projection);
      const previous = priorRelationship(priorAggregate, operation.ref);
      return {
        key,
        kind: "deleted",
        title: relationship
          ? `Removed ${humanize(relationship.edgeType)}`
          : "Removed Relationship",
        detail: relationship
          ? relationshipDetail(relationship, projection)
          : undefined,
        before:
          projectedRelationshipDescription(relationship, projection) ??
          priorRelationshipDescription(previous, projection) ??
          "No explanation",
        after: "Removed",
      };
    }
    case "relationship.update": {
      const relationship = getProjectedRelationship(operation.ref, projection);
      const previous = priorRelationship(priorAggregate, operation.ref);
      return {
        key,
        kind: "changed",
        title: relationship
          ? `Updated ${humanize(relationship.edgeType)}`
          : "Updated Relationship",
        detail: relationship
          ? relationshipDetail(relationship, projection)
          : undefined,
        ...compareSides(
          priorRelationshipDescription(previous, projection),
          projectedRelationshipDescription(relationship, projection) ??
            "No explanation",
        ),
      };
    }
    case "layout.replace": {
      const positions = operation.entries
        .map(
          (entry) =>
            `${getWorkItemLabel(entry.node, projection)}: (${
              entry.position.x
            }, ${entry.position.y})`,
        )
        .join("\n");
      return {
        key,
        kind: "changed",
        title: "Updated Graph Layout",
        ...compareSides(
          formatPriorLayout(priorAggregate, projection),
          positions,
        ),
      };
    }
    case "layout.clear":
      return {
        key,
        kind: "deleted",
        title: "Removed Graph Layout",
        ...compareSides(
          formatPriorLayout(priorAggregate, projection),
          "Explicitly cleared",
        ),
      };
  }
};

export const WorkItemGraphChangeSummary = ({
  operations,
  projection,
  priorAggregate,
  resolvedEntityNames = {},
  diffDefaultViewMode,
}: WorkItemGraphChangeSummaryProps) => {
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down("md"));
  const defaultViewMode: DiffViewMode =
    diffDefaultViewMode ?? (isNarrow ? "inline" : "split");
  const changes = operations.map((operation, index) =>
    summarizeOperation(
      operation,
      projection,
      priorAggregate,
      resolvedEntityNames,
      index,
    ),
  );

  return (
    <Accordion
      disableGutters
      data-testid="work-item-graph-change-summary"
      aria-label="Proposed graph changes"
      slotProps={{ transition: { unmountOnExit: true } }}
      sx={{
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        data-testid="work-item-graph-change-summary-toggle"
      >
        <Typography variant="subtitle2">Proposed changes</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          {changes.map((change) => (
            <Paper
              key={change.key}
              variant="outlined"
              data-testid="work-item-graph-change"
              data-change-kind={change.kind}
              sx={{
                p: 1.25,
                borderColor: (theme) =>
                  change.kind === "deleted"
                    ? theme.palette.error.main
                    : theme.palette.success.main,
                bgcolor: (theme) =>
                  change.kind === "deleted"
                    ? alpha(theme.palette.error.main, 0.07)
                    : alpha(theme.palette.success.main, 0.07),
              }}
            >
              <Typography variant="body2" fontWeight={700}>
                {change.title}
              </Typography>
              {change.detail ? (
                <Typography variant="caption" color="text.secondary">
                  {change.detail}
                </Typography>
              ) : null}
              {change.before !== undefined && change.after !== undefined ? (
                <Box sx={{ mt: 0.75 }}>
                  <DiffRenderer
                    oldContent={change.before}
                    newContent={change.after}
                    defaultViewMode={defaultViewMode}
                    showViewModeToggle
                  />
                </Box>
              ) : change.content ? (
                <Typography
                  variant="body2"
                  sx={{
                    mt: 0.75,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {change.content}
                </Typography>
              ) : null}
            </Paper>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
};
