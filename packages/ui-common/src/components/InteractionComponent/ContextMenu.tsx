import React from "react";
import Star from "@mui/icons-material/Star";
import StarBorder from "@mui/icons-material/StarBorder";
import {
  Box,
  CircularProgress,
  Divider,
  MenuList,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { EntityType } from "../../api";
import type { MenuAction, MenuContribution, MenuContributionItem, MenuPosition } from "./types";
import type { EntityMenuItem } from "./entityTypeRegistry";
import { useEntityStar } from "../../data/hooks/useEntityStars";
import {
  ProvenanceSummary,
  selectCreatedProposal,
  selectLastUpdatedProposal,
  type EntityProposalHistoryEntry,
} from "./ProvenanceSummary";

interface ContextMenuProps {
  position: MenuPosition;
  contributions: readonly MenuContribution[];
  proposals?: EntityProposalHistoryEntry[];
  isLoadingContext?: boolean;
  onAction: (action: MenuAction) => void;
  onViewHistory: () => void;
  onNavigateToEntity: (entityId: string, entityType: EntityType) => void;
  onNavigateToConversation: (conversationId: string) => void;
  onClose: () => void;
  menuRef?: React.Ref<HTMLDivElement>;
  star?: ContextMenuStar;
}

export interface ContextMenuStar {
  organizationId: string;
  entityType: EntityType;
  entityId: string;
}

const StarMenuContribution: React.FC<{
  star: ContextMenuStar;
  onClose: () => void;
}> = ({ star, onClose }) => {
  const starState = useEntityStar(
    star.organizationId,
    star.entityType,
    star.entityId,
    { enabled: true }
  );
  const errorMessage = starState.mutationError
    ? "Unable to update star"
    : starState.error
    ? "Unable to load star state"
    : null;
  return (
    <>
      <MenuItem
        disabled={
          starState.isLoading ||
          starState.isMutating ||
          Boolean(starState.error && !starState.mutationError)
        }
        onClick={async () => {
          try {
            await starState.toggle();
            onClose();
          } catch {
            // Keep the menu open so the explicit error remains visible.
          }
        }}
        data-testid="interaction-menu-star"
        data-menu-action={starState.isStarred ? "unstar" : "star"}
      >
        <ListItemIcon sx={{ minWidth: 36 }}>
          {starState.isLoading || starState.isMutating ? (
            <CircularProgress size={14} />
          ) : starState.isStarred ? (
            <Star fontSize="small" data-testid="interaction-menu-star-filled-icon" />
          ) : (
            <StarBorder
              fontSize="small"
              data-testid="interaction-menu-star-outline-icon"
            />
          )}
        </ListItemIcon>
        <ListItemText>
          {starState.isLoading
            ? "Loading star state..."
            : starState.isMutating
            ? "Saving..."
            : starState.isStarred
            ? "Unstar"
            : "Star"}
        </ListItemText>
      </MenuItem>
      {errorMessage && (
        <MenuItem disabled data-testid="interaction-menu-star-error">
          <Typography role="alert" color="error" variant="caption">
            {errorMessage}
          </Typography>
        </MenuItem>
      )}
    </>
  );
};

const MENU_WIDTH = 300;
const MENU_MARGIN = 8;

function clampToViewport(pos: MenuPosition): { left: number; top: number } {
  const maxX = window.innerWidth - MENU_WIDTH - MENU_MARGIN;
  const maxY = window.innerHeight - MENU_MARGIN;
  return {
    left: Math.max(MENU_MARGIN, Math.min(pos.x, maxX)),
    top: Math.max(MENU_MARGIN, Math.min(pos.y, maxY)),
  };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  position,
  contributions,
  proposals,
  isLoadingContext,
  onAction,
  onViewHistory,
  onNavigateToEntity,
  onNavigateToConversation,
  onClose,
  menuRef,
  star,
}) => {
  const [submenuAnchor, setSubmenuAnchor] = React.useState<HTMLElement | null>(null);
  const [submenuItems, setSubmenuItems] = React.useState<readonly MenuContributionItem[] | null>(null);
  const submenuRef = React.useRef<HTMLUListElement>(null);
  const paperRef = React.useRef<HTMLDivElement | null>(null);
  const [menuTop, setMenuTop] = React.useState<number | null>(null);
  const setPaperRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      paperRef.current = element;
      if (typeof menuRef === "function") {
        menuRef(element);
      } else if (menuRef) {
        (menuRef as { current: HTMLDivElement | null }).current = element;
      }
    },
    [menuRef],
  );

  React.useLayoutEffect(() => {
    const updateMenuTop = () => {
      const menuHeight = paperRef.current?.getBoundingClientRect().height;
      if (!menuHeight) return;

      const viewportBottom = window.innerHeight - MENU_MARGIN;
      const topAbovePointer = position.y - menuHeight;
      const top =
        position.y + menuHeight <= viewportBottom
          ? Math.max(MENU_MARGIN, position.y)
          : topAbovePointer >= MENU_MARGIN
            ? topAbovePointer
            : viewportBottom - menuHeight;
      const nextTop = Math.max(MENU_MARGIN, top);

      setMenuTop((currentTop) =>
        currentTop === nextTop ? currentTop : nextTop,
      );
    };

    updateMenuTop();
    window.addEventListener("resize", updateMenuTop);

    if (typeof ResizeObserver === "undefined" || !paperRef.current) {
      return () => window.removeEventListener("resize", updateMenuTop);
    }

    const resizeObserver = new ResizeObserver(updateMenuTop);
    resizeObserver.observe(paperRef.current);

    return () => {
      window.removeEventListener("resize", updateMenuTop);
      resizeObserver.disconnect();
    };
  }, [position.y]);

  const openSubmenu = (item: MenuContributionItem, anchor: HTMLElement) => {
    if (!item.submenu?.length) {
      setSubmenuAnchor(null);
      setSubmenuItems(null);
      return;
    }
    setSubmenuAnchor(anchor);
    setSubmenuItems(item.submenu);
  };
  const handleAction = (action: MenuAction) => {
    onClose();
    onAction(action);
  };

  const clamped = clampToViewport(position);
  const createdProposal = selectCreatedProposal(proposals);
  const lastUpdatedProposal = selectLastUpdatedProposal(proposals);
  const hasProposals = !!proposals?.length;
  const staticContributions = contributions.filter(
    (contribution) =>
      contribution.section !== "async" &&
      contribution.section !== "provenance"
  );
  const asyncContributions = contributions.filter(
    (contribution) => contribution.section === "async"
  );
  const provenanceContributions = contributions.filter(
    (contribution) => contribution.section === "provenance"
  );

  const getTestId = (item: EntityMenuItem): string =>
    item.testId ?? `interaction-menu-${item.action}`;
  const renderContributionNodes = (entries: readonly MenuContribution[]) =>
    entries.flatMap((contribution, index) => [
    ...(index > 0 &&
    contribution.section !== entries[index - 1]?.section
      ? [<Divider key={`${contribution.id}-divider`} />]
      : []),
    ...(contribution.items?.map((item) => {
      const Icon = item.icon;
      return (
        <MenuItem
          key={`${contribution.id}-${item.action}`}
          onClick={() => handleAction(item.action)}
          onMouseEnter={(event) => openSubmenu(item, event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" && item.submenu?.length) {
              event.preventDefault();
              event.stopPropagation();
              openSubmenu(item, event.currentTarget);
              window.requestAnimationFrame(() => {
                submenuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
              });
            }
          }}
          role={item.checked === undefined ? undefined : "menuitemcheckbox"}
          aria-checked={item.checked}
          aria-haspopup={item.submenu?.length ? "menu" : undefined}
          aria-expanded={item.submenu?.length ? submenuAnchor?.dataset.menuAction === item.action : undefined}
          selected={item.checked}
          data-testid={getTestId(item)}
          data-menu-action={item.action}
          {...(item.dataGroupId ? { "data-group-id": item.dataGroupId } : {})}
        >
          {Icon ? (
            <ListItemIcon sx={{ minWidth: 36 }}>
              <Icon
                fontSize="small"
                sx={
                  item.action === "discuss"
                    ? { color: "actionable.main" }
                    : undefined
                }
                data-testid={
                  item.action === "discuss"
                    ? "interaction-menu-discuss-icon"
                    : undefined
                }
              />
            </ListItemIcon>
          ) : null}
          <ListItemText>{item.label}</ListItemText>
          {item.submenu?.length ? <ChevronRightIcon fontSize="small" data-testid="interaction-menu-submenu-arrow" /> : null}
        </MenuItem>
      );
    }) ?? []),
    ...(contribution.controller === "star" && star
      ? [
          <StarMenuContribution
            key={`${contribution.id}-controller`}
            star={star}
            onClose={onClose}
          />,
        ]
      : []),
  ]);
  const staticNodes = renderContributionNodes(staticContributions);
  const provenanceNodes = renderContributionNodes(provenanceContributions);

  return (
    <Paper
      ref={setPaperRef}
      elevation={8}
      data-testid="interaction-context-menu"
      onClick={(e) => e.stopPropagation()}
      sx={{
        position: "fixed",
        left: clamped.left,
        top: menuTop ?? clamped.top,
        zIndex: "modal",
        minWidth: MENU_WIDTH,
        border: 1,
        borderColor: "divider",
        maxHeight: `calc(100vh - ${MENU_MARGIN * 2}px)`,
        overflowY: "auto",
      }}
    >
      <MenuList dense disablePadding autoFocusItem>
        {/* Static caller and shared contributions always precede async work. */}
        {staticNodes}

        {/* Async section — loading indicator or MCP items, below static items */}
        {(isLoadingContext || asyncContributions.length > 0) && <Divider />}
        {isLoadingContext ? (
          <MenuItem disabled>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={14} />
              <Typography variant="caption" color="text.secondary">
                Loading context...
              </Typography>
            </Box>
          </MenuItem>
        ) : asyncContributions.length > 0 ? (
          asyncContributions
            .flatMap((contribution) => contribution.items ?? [])
            .map((item) => (
            <MenuItem
              key={item.action}
              onClick={() => handleAction(item.action)}
              data-testid={getTestId(item)}
              data-menu-action={item.action}
            >
              <ListItemText>{item.label}</ListItemText>
            </MenuItem>
            ))
        ) : null}

        {provenanceNodes.length > 0 && <Divider />}
        {provenanceNodes}

        {/* Provenance section — Created, Last Updated, View All History */}
        {!isLoadingContext &&
          hasProposals && [
            <Divider key="provenance-divider" />,
            <ProvenanceSummary
              key="provenance-summary"
              createdProposal={createdProposal}
              lastUpdatedProposal={lastUpdatedProposal}
              onNavigateToEntity={onNavigateToEntity}
              onNavigateToConversation={onNavigateToConversation}
              onClose={onClose}
            />,
            <MenuItem
              key="view-all-history"
              onClick={() => {
                onClose();
                onViewHistory();
              }}
              data-testid="interaction-menu-view-all-history"
            >
              <ListItemText>View All History</ListItemText>
            </MenuItem>,
          ]}
      </MenuList>
      {submenuAnchor && submenuItems?.length ? (
        <Paper
          elevation={8}
          data-testid="interaction-submenu"
          sx={{
            position: "fixed",
            left: Math.max(MENU_MARGIN,
              submenuAnchor.getBoundingClientRect().right + 220 + MENU_MARGIN <= window.innerWidth
                ? submenuAnchor.getBoundingClientRect().right
                : submenuAnchor.getBoundingClientRect().left - 220),
            top: Math.max(
              MENU_MARGIN,
              Math.min(
                submenuAnchor.getBoundingClientRect().top,
                window.innerHeight - submenuItems.length * 40 - MENU_MARGIN,
              ),
            ),
            zIndex: 1,
            minWidth: 220,
            maxHeight: `calc(100vh - ${MENU_MARGIN * 2}px)`,
            overflowY: "auto",
            border: 1,
            borderColor: "divider",
          }}
        >
          <MenuList
            ref={submenuRef}
            dense
            disablePadding
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                submenuAnchor.focus();
                setSubmenuAnchor(null);
                setSubmenuItems(null);
              }
            }}
          >
            {submenuItems.map((item) => (
              <MenuItem
                key={item.action}
                onClick={() => handleAction(item.action)}
                data-testid={item.testId ?? `interaction-menu-${item.action}`}
                data-menu-action={item.action}
                {...(item.dataGroupId ? { "data-group-id": item.dataGroupId } : {})}
              >
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      ) : null}
    </Paper>
  );
};
