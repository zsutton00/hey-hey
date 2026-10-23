import React, { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box, Link, Typography } from "@mui/material";
import { EntityType, TargetEntityType } from "../api";
import { getEntityColors } from "../utils";
import { useDesignDoc } from "../data/hooks/useDesignDoc";
import { useInitiative } from "../data/hooks/useInitiative";
import { useProject } from "../data/hooks/useProject";
import { useWorkItem } from "../data/hooks/useWorkItem";
import { isPlanWorkItem } from "../data/plans/canonicalPlan";
import { getAuthToken } from "../services/authService";
import { InteractionComponent } from "./InteractionComponent";
import { useEntityDragSource } from "./InteractionComponent/useEntityDragSource";

export interface BreadcrumbLinkProps {
  to?: string;
  children: React.ReactNode;
  isCurrentPage?: boolean;
  type?: string;
  typeLabel?: string;
  hideTypeLabel?: boolean;
  wrapLabel?: boolean;
  entityId?: string;
  "data-testid"?: string;
}

const INTERNAL_BREADCRUMB_MAX_LENGTH = 24;
const CURRENT_BREADCRUMB_MAX_LENGTH = 40;
const SHORT_THRESHOLD = 25;

const normalizeEntityType = (type: string): string => {
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "parent_task" || normalized === "tasks") {
    return "task";
  }
  if (
    normalized === "design_doc" ||
    normalized === "design_docs" ||
    normalized === "document" ||
    normalized === "documents"
  ) {
    return "design_doc";
  }
  if (normalized === "initiatives") {
    return "initiative";
  }
  if (normalized === "projects") {
    return "project";
  }
  if (normalized === "plans") {
    return "plan";
  }

  return normalized;
};

type ResolvableEntityType =
  | "project"
  | "plan"
  | "task"
  | "initiative"
  | "design_doc";

const UUID_V4_LIKE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID_V4_LIKE_REGEX.test(value);

const asResolvableEntityType = (
  type: string | undefined,
): ResolvableEntityType | null => {
  if (!type) {
    return null;
  }

  const normalized = normalizeEntityType(type);
  if (
    normalized === "project" ||
    normalized === "plan" ||
    normalized === "task" ||
    normalized === "initiative" ||
    normalized === "design_doc"
  ) {
    return normalized;
  }

  return null;
};

const getPathSegmentValue = (
  path: string | undefined,
  segment: string,
): string | undefined => {
  if (!path) {
    return undefined;
  }

  const match = path.match(new RegExp(`/${segment}/([^/?#]+)`));
  if (!match?.[1]) {
    return undefined;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const TASK_LIKE_BREADCRUMB_TYPES = new Set(["task", "feature", "bug"]);

const toBreadcrumbInteractionType = (
  normalizedType: string,
): TargetEntityType | null => {
  if (TASK_LIKE_BREADCRUMB_TYPES.has(normalizedType)) {
    return TargetEntityType.Task;
  }
  if (normalizedType === "design_doc") {
    return TargetEntityType.DesignDoc;
  }
  return null;
};

// Entity types whose breadcrumb segments are made draggable through the pure
// `useEntityDragSource` hook rather than `InteractionComponent`. These types
// carry no `InteractionComponent` drop-target / context-menu affordances, so
// the lean drag surface is the correct composition — and it lets them drag
// even though `InteractionComponent` has no machinery for them. Task and
// design-doc segments keep going through `InteractionComponent` (see
// `toBreadcrumbInteractionType`) so their context menu is preserved.
const DRAG_ENTITY_TYPE_BY_BREADCRUMB: Partial<Record<string, string>> = {
  project: EntityType.Project,
  plan: EntityType.Task,
  initiative: EntityType.Initiative,
};

// Lean drag wrapper for entity segments that should be draggable but do not
// route through InteractionComponent. Emits the same entity-ref drag payload
// (`{ type: 'entity', data: { entityId, entityType, entityName } }`) the rest
// of the app drops on. `idScope="breadcrumb"` keeps the dnd id from colliding
// with a page-level InteractionComponent for the same entity.
const BreadcrumbDragSource: React.FC<{
  entityId: string;
  entityType: string;
  entityTitle?: string;
  children: React.ReactNode;
}> = ({ entityId, entityType, entityTitle, children }) => {
  const { attributes, listeners, setNodeRef } = useEntityDragSource({
    entityRef: { entityId, entityType, entityTitle },
    idScope: "breadcrumb",
  });

  return (
    <Box
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid="breadcrumb-drag-source"
      data-entity-id={entityId}
      data-entity-type={entityType}
      sx={{
        display: "block",
        maxWidth: "100%",
        minWidth: 0,
        cursor: "grab",
      }}
    >
      {children}
    </Box>
  );
};

const decodeCurrentOrgIdFromToken = (): string | null => {
  const token = getAuthToken();
  if (!token) {
    return null;
  }

  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    return null;
  }

  try {
    const base64 = tokenParts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${base64}${"=".repeat((4 - (base64.length % 4 || 4)) % 4)}`;
    const payloadText = atob(padded);
    const payload = JSON.parse(payloadText) as { currentOrgId?: unknown };

    return typeof payload.currentOrgId === "string"
      ? payload.currentOrgId
      : null;
  } catch {
    return null;
  }
};

export const BreadcrumbLink: React.FC<BreadcrumbLinkProps> = ({
  to,
  children,
  isCurrentPage = false,
  type,
  typeLabel,
  hideTypeLabel = false,
  wrapLabel = false,
  entityId,
  "data-testid": dataTestId,
}) => {
  const normalizedType = type ? normalizeEntityType(type) : undefined;
  const breadcrumbEntityType = asResolvableEntityType(type);
  const colorType = normalizedType ?? type;
  const resolvedColors = colorType
    ? getEntityColors(colorType, { useDefaultColors: false })
    : undefined;
  const breadcrumbColor =
    resolvedColors?.background !== "transparent"
      ? resolvedColors?.background
      : undefined;
  const resolvedLinkColor = breadcrumbColor ?? "rgb(8, 126, 139)";
  const labelText = typeof children === "string" ? children : null;
  const shouldResolveEntityName =
    !!labelText && !!breadcrumbEntityType && isUuid(labelText);
  const organizationId = decodeCurrentOrgIdFromToken();
  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : undefined;
  const projectId =
    getPathSegmentValue(to, "projects") ??
    getPathSegmentValue(currentPath, "projects");
  const safeOrganizationId = organizationId ?? "__noop__";

  // Only thread the breadcrumb label into a resolver hook when it is a UUID we
  // intend to resolve for that hook's entity type. Otherwise pass the
  // "__noop__" sentinel (or undefined) so a human-readable label — e.g.
  // "Projects" or a project name like "Hey Hey 4" — never becomes a query key
  // and registers a dead cache entry in that collection.
  const resolveTarget = shouldResolveEntityName ? breadcrumbEntityType : null;
  // `resolveTarget` is only non-null when `labelText` is a non-empty UUID, so
  // these casts are sound.
  const projectLabelId =
    resolveTarget === "project" ? (labelText as string) : undefined;
  const initiativeLabelId =
    resolveTarget === "initiative" ? (labelText as string) : "__noop__";
  const workItemLabelId =
    resolveTarget === "task" || resolveTarget === "plan"
      ? (labelText as string)
      : "__noop__";
  const designDocLabelId =
    resolveTarget === "design_doc" ? (labelText as string) : undefined;

  const projectQuery = useProject(organizationId ?? undefined, projectLabelId, {
    enabled: resolveTarget === "project" && !!organizationId,
    preferStale: true,
  });

  const initiativeQuery = useInitiative(safeOrganizationId, initiativeLabelId, {
    enabled: resolveTarget === "initiative" && !!organizationId,
    preferStale: true,
  });

  const workItemQuery = useWorkItem(
    safeOrganizationId,
    "task",
    workItemLabelId,
    {
      projectId: projectId ?? undefined,
      enabled:
        (resolveTarget === "task" || resolveTarget === "plan") &&
        !!organizationId &&
        !!projectId,
      preferStale: true,
    },
  );

  const designDocQuery = useDesignDoc(
    organizationId ?? undefined,
    designDocLabelId,
    {
      enabled: resolveTarget === "design_doc" && !!organizationId,
      preferStale: true,
    },
  );

  const resolvedLabel = useMemo(() => {
    if (!shouldResolveEntityName || !breadcrumbEntityType || !labelText) {
      return labelText;
    }

    switch (breadcrumbEntityType) {
      case "project":
        return projectQuery.data?.name ?? labelText;
      case "plan": {
        const plan = workItemQuery.workItem;
        if (plan && isPlanWorkItem(plan)) return plan.name;
        return workItemQuery.isLoading ? "Loading…" : "Unavailable plan";
      }
      case "initiative":
        return initiativeQuery.data?.name ?? labelText;
      case "task":
        return workItemQuery.workItem?.name ?? labelText;
      case "design_doc":
        return designDocQuery.data?.name ?? labelText;
      default:
        return labelText;
    }
  }, [
    breadcrumbEntityType,
    designDocQuery.data?.name,
    initiativeQuery.data?.name,
    labelText,
    projectQuery.data?.name,
    shouldResolveEntityName,
    workItemQuery.isLoading,
    workItemQuery.workItem,
  ]);

  const fullLabel =
    typeof children === "string" ? (resolvedLabel ?? children) : null;

  const maxLength = isCurrentPage
    ? CURRENT_BREADCRUMB_MAX_LENGTH
    : INTERNAL_BREADCRUMB_MAX_LENGTH;

  const truncatedLabel =
    !wrapLabel && fullLabel && fullLabel.length > maxLength
      ? `${fullLabel.slice(0, maxLength - 1).trimEnd()}…`
      : fullLabel;

  const renderedChildren =
    typeof children === "string" ? truncatedLabel : children;

  const titleAttr =
    fullLabel && truncatedLabel !== fullLabel ? fullLabel : undefined;

  const isShortText =
    typeof renderedChildren === "string" &&
    renderedChildren.length <= SHORT_THRESHOLD;

  const inner = (
    <>
      <span
        data-testid="breadcrumb-link-label"
        style={{
          fontFamily: "Tilt Neon",
          letterSpacing: "-0.025ch",
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: wrapLabel ? "normal" : "nowrap",
          overflowWrap: wrapLabel ? "anywhere" : undefined,
        }}
      >
        {renderedChildren}
      </span>
      {type && !hideTypeLabel && (
        <Typography
          sx={{
            position: "absolute",
            bottom: -12,
            textTransform: "uppercase",
            left: 1,
            fontSize: 8,
            color: breadcrumbColor ?? "text.secondary",
            whiteSpace: "nowrap",
          }}
          variant="caption"
        >
          {typeLabel ?? type}
        </Typography>
      )}
    </>
  );

  const sharedStyle = {
    position: "relative",
    fontFamily: "Tilt Neon",
    letterSpacing: "-0.025ch",
    display: "block",
    maxWidth: "100%",
    minWidth: 0,
  } as const;

  const interactionEntityType = normalizedType
    ? toBreadcrumbInteractionType(normalizedType)
    : null;
  const interactionEntitySubtype =
    interactionEntityType === TargetEntityType.Task && normalizedType !== "task"
      ? normalizedType
      : undefined;

  const element =
    isCurrentPage || !to ? (
      <Typography
        data-breadcrumb-short={isShortText ? "" : undefined}
        data-testid={dataTestId ?? "breadcrumb-link-current"}
        color={breadcrumbColor ? undefined : "text.secondary"}
        title={titleAttr}
        sx={{
          ...sharedStyle,
          textTransform: "uppercase",
          ...(breadcrumbColor ? { color: breadcrumbColor } : {}),
        }}
      >
        {inner}
      </Typography>
    ) : (
      <Link
        data-breadcrumb-short={isShortText ? "" : undefined}
        data-testid={dataTestId ?? "breadcrumb-link"}
        component={RouterLink}
        to={to}
        color="text.primary"
        underline="hover"
        draggable={false}
        title={titleAttr}
        sx={{
          color: resolvedLinkColor,
          ...sharedStyle,
        }}
      >
        {inner}
      </Link>
    );

  const entityTitle =
    typeof renderedChildren === "string" ? renderedChildren : undefined;

  if (entityId && interactionEntityType) {
    return (
      <InteractionComponent
        entityId={entityId}
        entityType={interactionEntityType}
        entitySubtype={interactionEntitySubtype}
        entityTitle={entityTitle}
        hasProposalSupport
        showIndicator={false}
        idScope="breadcrumb"
        organizationId={organizationId ?? undefined}
        projectId={projectId ?? undefined}
      >
        {element}
      </InteractionComponent>
    );
  }

  const dragEntityType =
    entityId && normalizedType
      ? DRAG_ENTITY_TYPE_BY_BREADCRUMB[normalizedType]
      : undefined;

  if (entityId && dragEntityType) {
    return (
      <BreadcrumbDragSource
        entityId={entityId}
        entityType={dragEntityType}
        entityTitle={entityTitle}
      >
        {element}
      </BreadcrumbDragSource>
    );
  }

  return element;
};
