import { Box } from "@mui/material";
import React, {
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { Link as RouterLink } from "react-router-dom";
import type { EntityMention } from "./types";
import {
  getEntityIcon,
  getEntityColors,
  resolveWorkItemIconPresentation,
} from "../../utils/entityIcons";
import {
  useMentionWorkItemTypeKey,
  useWorkItemTypeByKey,
} from "../../data/hooks/useWorkItemTypes";
import { navigateToEntity } from "../../components/WebUtils/navigateToEntity";
import type { SearchEntity } from "./types";
import { MentionEditorContext } from "./EditorContext";
import { EntityHoverCard } from "./EntityHoverCard";
import { usePathService, useProjectContext } from "../../contexts";
import { buildEntityHref } from "../../utils/buildEntityHref";
import {
  InteractionComponent,
  resolveEntityTypeConfig,
  type ContextualMenuAction,
} from "../InteractionComponent";
import {
  formatMention,
  resolvePreviewEntityType,
} from "../../utils/mentionFormatting";

export type MentionMode = "full" | "minimal";

export interface MentionBadgeInnerProps {
  mention: EntityMention;
  mode?: MentionMode;
}

export const MentionBadgeInner: React.FC<MentionBadgeInnerProps> = ({
  mention,
  mode = "full",
}) => {
  const editorContext = useContext(MentionEditorContext);
  const projectContext = useProjectContext();
  const pathService = usePathService();
  const [isNavigating, setIsNavigating] = useState(false);
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const badgeRef = useRef<HTMLElement | null>(null);

  // Prefer MentionEditorContext (explicit override), fall back to ProjectContext
  const ctx = editorContext ?? projectContext;

  const setBadgeRef = useCallback((node: HTMLElement | null) => {
    badgeRef.current = node;
  }, []);
  const setTextLinkRef = useCallback((node: HTMLElement | null) => {
    badgeRef.current = node;
  }, []);
  const closeHoverCard = useCallback(() => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoverAnchor(null);
  }, []);

  const isWorkItem = resolvePreviewEntityType(mention.entityType) === "task";
  const mentionType = useMentionWorkItemTypeKey(
    isWorkItem ? ctx?.organizationId : undefined,
    isWorkItem ? ctx?.projectId : undefined,
    isWorkItem ? mention.entityType : undefined
  );
  const typeKey = mentionType.typeKey;
  const typeQuery = useWorkItemTypeByKey(
    isWorkItem ? ctx?.organizationId : undefined,
    isWorkItem ? ctx?.projectId : undefined,
    isWorkItem ? typeKey : undefined
  );
  const workItemPresentation =
    isWorkItem && typeKey && typeQuery.isFetched && !typeQuery.error
      ? resolveWorkItemIconPresentation(
          typeKey,
          typeQuery.workItemTypeDefinition,
          typeQuery.workItemTypeSummary?.effectiveSource
        )
      : undefined;
  const IconComponent = isWorkItem
    ? workItemPresentation?.Icon ?? getEntityIcon("task")
    : getEntityIcon(mention.entityType);
  const entityColors = isWorkItem
    ? workItemPresentation?.colors
    : getEntityColors(mention.entityType);
  const entityColor = entityColors?.background ?? "text.secondary";
  const canonicalMention = formatMention(mention);
  const copyAttributes = {
    "data-mention-token": canonicalMention,
    "data-entity-type": mention.entityType,
    "data-entity-id": mention.entityId,
    "data-entity-name": mention.entityName,
  } as const;
  const contextualActions = useMemo<readonly ContextualMenuAction[]>(() => {
    const previewCapability = resolveEntityTypeConfig(
      mention.entityType
    )?.previewCapability;
    if (previewCapability?.kind === "supported") {
      return [];
    }

    return [
      {
        action: "preview",
        label: "Preview",
        testId: "interaction-menu-preview",
        onSelect: () => setHoverAnchor(badgeRef.current),
      },
    ];
  }, [mention.entityType]);

  const handleClick = async (e: React.MouseEvent) => {
    if (!ctx || isNavigating) return;

    // Handle cmd/ctrl+click to open in new tab
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      await openInNewTab();
      return;
    }

    // Regular click for navigation
    e.preventDefault();
    e.stopPropagation();

    const searchEntity: SearchEntity = {
      id: mention.entityId,
      type: mention.entityType,
      name: mention.entityName,
    };

    setIsNavigating(true);
    try {
      await navigateToEntity({
        entity: searchEntity,
        navigate: ctx.navigate,
        projectId: ctx.projectId,
        pathService,
      });
    } catch (error: unknown) {
      console.error("Navigation failed:", error);
    } finally {
      setIsNavigating(false);
    }
  };

  const mentionHref = ctx
    ? buildEntityHref(pathService, ctx.projectId, mention)
    : undefined;

  const openInNewTab = async () => {
    if (!mentionHref) return;

    try {
      window.open(mentionHref, "_blank");
    } catch (error: unknown) {
      console.error("Failed to open in new tab:", error);
    }
  };

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoverAnchor(badgeRef.current);
    }, 300);
  };

  const handleMouseLeave = () => {
    closeHoverCard();
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const hoverCard = ctx && hoverAnchor && (
    <EntityHoverCard
      entityId={mention.entityId}
      entityType={mention.entityType}
      organizationId={ctx.organizationId}
      projectId={ctx.projectId}
      anchorEl={hoverAnchor}
      onPopoverMouseEnter={() => {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
      }}
      onPopoverMouseLeave={handleMouseLeave}
    />
  );

  if (mode === "minimal") {
    const linkProps = mentionHref
      ? { component: RouterLink, to: mentionHref }
      : { component: "span" as const };

    return (
      <>
        <InteractionComponent
          entityId={mention.entityId}
          entityType={mention.entityType}
          entityTitle={mention.entityName}
          organizationId={ctx?.organizationId}
          projectId={ctx?.projectId}
          hasProposalSupport
          draggable={false}
          showIndicator={false}
          idScope="mention"
          surfaceLayout="inline"
          contextualActions={contextualActions}
          onContextMenuOpen={closeHoverCard}
        >
          <Box
            ref={setTextLinkRef}
            {...linkProps}
            {...copyAttributes}
            data-testid="mention-badge"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            sx={{
              color: "primary.main",
              textTransform: "uppercase",
              fontFamily: "Tilt Neon",
              textDecoration: "none",
              cursor: mentionHref ? "pointer" : "default",
              "&:hover .mention-text": { textDecoration: "underline" },
            }}
          >
            <IconComponent
              sx={{
                fontSize: "1em",
                color: entityColor,
                verticalAlign: "-0.125em",
                marginRight: "0.25em",
              }}
            />
            <span className="mention-text">{mention.entityName}</span>
          </Box>
        </InteractionComponent>
        {hoverCard}
      </>
    );
  }

  return (
    <>
      <InteractionComponent
        entityId={mention.entityId}
        entityType={mention.entityType}
        entityTitle={mention.entityName}
        organizationId={ctx?.organizationId}
        projectId={ctx?.projectId}
        hasProposalSupport
        draggable
        showIndicator={false}
        idScope="mention"
        surfaceLayout="inline"
        contextualActions={contextualActions}
        onContextMenuOpen={closeHoverCard}
      >
        <Box
          ref={setBadgeRef}
          component="span"
          {...copyAttributes}
          data-testid="mention-badge"
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            maxWidth: "340px",
            verticalAlign: "middle",
            backgroundColor: "rgb(238, 238, 238)",
            color: entityColor,
            borderRadius: "16px",
            padding: "2px 8px",
            fontSize: "0.875rem",
            fontWeight: 500,
            margin: "0 2px",
            cursor: ctx ? "pointer" : "default",
            userSelect: "text",
            whiteSpace: "nowrap",
            transition: "all 0.2s ease",
            opacity: isNavigating ? 0.6 : 1,
            position: "relative",
            top: "-2px",
            "&:hover": {
              backgroundColor: "rgb(238, 238, 238)",
              transform: ctx ? "scale(1.05)" : "none",
            },
          }}
        >
          <IconComponent sx={{ fontSize: "1rem", flexShrink: 0 }} />
          <Box
            component="span"
            sx={{
              color: "#333",
              textTransform: "uppercase",
              fontFamily: "Tilt Neon",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {mention.entityName}
          </Box>
        </Box>
      </InteractionComponent>
      {hoverCard}
    </>
  );
};
