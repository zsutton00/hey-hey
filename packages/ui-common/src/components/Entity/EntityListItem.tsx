import { useModalState } from "../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItem,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  alpha,
  type PaletteColor,
  type Theme,
  useTheme as useMuiTheme,
} from "@mui/material/styles";
import BlockIcon from "@mui/icons-material/Block";
import CheckIcon from "@mui/icons-material/Check";
import ChevronRight from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMore from "@mui/icons-material/ExpandMore";
import InventoryIcon from "@mui/icons-material/Inventory2";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ScheduleIcon from "@mui/icons-material/Schedule";
import VisibilityIcon from "@mui/icons-material/Visibility";
import React, { useState } from "react";
import pluralize from "pluralize";
import { Link as RouterLink } from "react-router-dom";
import { AgentEdgeType } from "../../api";
import type { AgentSessionType } from "../../api";
import { useConversationPhase } from "../../data/hooks/useConversationPhase";
import { ConversationPhaseIndicator } from "../Conversation/Components/ConversationPhaseIndicator";
import {
  AGENT_EDGE_TYPE_FALLBACK_LABELS,
  AGENT_EDGE_TYPE_INVERSE_FALLBACK_LABELS,
  agentEdgeTypeToRelationshipValue,
  formatRelationshipLabel,
} from "./relationshipLabels";
import { getStatusColorMapping } from "../../utils";
import { renderInlineMentions } from "../SmarterTextAreaCard/renderInlineMentions";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import { useElementWidth } from "../useElementWidth";
import capitalize from "lodash/capitalize.js";
import type { CountGroup, CountItem } from "../WorkItem/utils";
import {
  MetadataDisclosure,
  type MetadataDisclosureRow,
} from "../shared/MetadataDisclosure";
import { EntityIcon } from "./EntityIcon";
import type {
  EntityIconKey,
  WorkItemIconIdentity,
} from "../../utils/entityIcons";

export interface EntityDependency {
  edgeType: AgentEdgeType;
  /** Relationship direction relative to the item this list row represents. */
  direction: "outgoing" | "incoming";
  /** Resolved endpoint type used to select the linked entity icon. */
  entityType?: string;
  targetTitle: string;
  href: string;
}

export interface EntityListItemProps {
  title: React.ReactNode;
  contentSlot?: React.ReactNode;
  description?: string;
  status?: string;
  leadingContent?: React.ReactNode;
  statusLeadingAdornment?: React.ReactNode;
  attentionContent?: React.ReactNode;
  entityKindLabel?: string;
  entityKindIcon?: EntityIconKey;
  workItemIcon?: WorkItemIconIdentity;
  agentSessionType?: AgentSessionType;
  conversationId?: string;
  tags?: string[];
  metadata?: readonly MetadataDisclosureRow[];
  counts?: CountGroup[];
  href?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
  onDelete?: () => void;
  /** Trailing row controls; handlers must stop propagation to avoid opening the row. */
  actions?: React.ReactNode;
  nestingLevel?: number;
  displayMode?: "default" | "minimal" | "list";
  titleStatusLayout?: "responsive" | "row";
  createdAt?: string;
  updatedAt?: string;
  dependencies?: EntityDependency[];
  expandButton?: {
    expanded: boolean;
    onToggle: () => void;
    hasChildren: boolean;
  };
}

const DEPENDS_ON_INVERSE_LABEL = "Blocks";

const labelForEdgeType = (edgeType: AgentEdgeType): string => {
  const relationshipValue = agentEdgeTypeToRelationshipValue(edgeType);
  if (relationshipValue) return formatRelationshipLabel(relationshipValue);
  return AGENT_EDGE_TYPE_FALLBACK_LABELS[edgeType] ?? edgeType;
};

const formatDependencyLabel = (dep: EntityDependency): string => {
  if (
    dep.direction === "incoming" &&
    dep.edgeType === AgentEdgeType.DependsOn
  ) {
    return DEPENDS_ON_INVERSE_LABEL;
  }
  if (dep.direction === "incoming") {
    const inverseLabel = AGENT_EDGE_TYPE_INVERSE_FALLBACK_LABELS[dep.edgeType];
    if (inverseLabel) return inverseLabel;
  }
  const base = labelForEdgeType(dep.edgeType);
  return dep.direction === "incoming" ? `${base} (incoming)` : base;
};

interface DependencyRowsProps {
  dependencies: readonly EntityDependency[];
  testIdPrefix: "entity-dependency" | "entity-dependency-dialog";
  theme: Theme;
}

const DependencyRows: React.FC<DependencyRowsProps> = ({
  dependencies,
  testIdPrefix,
  theme,
}) => (
  <Stack spacing={0.5} data-testid={`${testIdPrefix}-rows`}>
    {dependencies.map((dep, index) => {
      const isBlocking = dep.edgeType === AgentEdgeType.DependsOn;
      const previous = dependencies[index - 1];
      const previousIsBlocking = previous?.edgeType === AgentEdgeType.DependsOn;
      const showSeparator = index > 0 && previousIsBlocking && !isBlocking;

      return (
        <React.Fragment
          key={`${dep.edgeType}-${dep.direction}-${dep.href}-${index}`}
        >
          {showSeparator && (
            <Box
              sx={{
                height: "1px",
                backgroundColor: theme.palette.divider,
                my: 0.25,
              }}
            />
          )}
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            data-testid={`${testIdPrefix}-row`}
            sx={{
              flexWrap: "nowrap",
              minWidth: 0,
              width: "100%",
            }}
          >
            <Chip
              label={formatDependencyLabel(dep)}
              size="small"
              color={isBlocking ? "info" : "default"}
              variant={isBlocking ? "filled" : "outlined"}
              sx={{
                fontWeight: 600,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            />
            <Box
              component={RouterLink}
              to={dep.href}
              data-testid={`${testIdPrefix}-link`}
              onClick={(event: React.MouseEvent) => event.stopPropagation()}
              sx={{
                display: "flex",
                alignItems: "center",
                flex: "1 1 auto",
                minWidth: 0,
                overflow: "hidden",
                color: theme.palette.primary.main,
                textDecoration: "none",
                fontSize: "0.875rem",
                "&:hover": { textDecoration: "underline" },
              }}
            >
              {dep.entityType && (
                <Box
                  component="span"
                  role="img"
                  aria-label={dep.entityType}
                  data-testid={`${testIdPrefix}-icon`}
                  sx={{
                    display: "inline-flex",
                    mr: 0.5,
                    verticalAlign: "middle",
                  }}
                >
                  <EntityIcon entityType={dep.entityType} size={18} />
                </Box>
              )}
              <Box
                component="span"
                data-testid={`${testIdPrefix}-title`}
                sx={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {dep.targetTitle}
              </Box>
            </Box>
          </Stack>
        </React.Fragment>
      );
    })}
  </Stack>
);

const formatEntityDate = (value?: string): string | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getCompactStatusIcon = (status: string): React.ReactElement => {
  switch (status.toUpperCase().replace(/_/g, " ")) {
    case "ACTIVE":
    case "IN PROGRESS":
      return <PlayArrowIcon aria-hidden="true" />;
    case "COMPLETED":
    case "COMPLETE":
      return <CheckIcon aria-hidden="true" />;
    case "CANCELLED":
      return <CloseIcon aria-hidden="true" />;
    case "BLOCKED":
      return <BlockIcon aria-hidden="true" />;
    case "ON HOLD":
      return <PauseIcon aria-hidden="true" />;
    case "VERIFYING":
      return <VisibilityIcon aria-hidden="true" />;
    case "ARCHIVED":
    case "SUPERSEDED":
      return <InventoryIcon aria-hidden="true" />;
    default:
      return <ScheduleIcon aria-hidden="true" />;
  }
};

const resolvePaletteColor = (
  theme: Theme,
  statusColor: ReturnType<typeof getStatusColorMapping>,
): PaletteColor | undefined => {
  switch (statusColor) {
    case "primary":
    case "secondary":
    case "error":
    case "info":
    case "success":
    case "warning":
    case "ready":
      return theme.palette[statusColor];
    default:
      return undefined;
  }
};

const formatCountLabel = (item: CountItem): string => {
  return capitalize(
    item.pluralizable !== false
      ? pluralize(item.label, item.count)
      : item.label,
  );
};

const renderCounts = (counts: CountGroup[], theme: Theme): React.ReactNode => {
  return (
    <Stack
      direction="row"
      spacing={2.5}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      divider={
        <Box
          sx={{
            width: "1px",
            height: 24,
            backgroundColor: theme.palette.divider,
            borderRadius: "999px",
          }}
        />
      }
    >
      {counts.map((group, groupIndex) => (
        <Stack
          key={groupIndex}
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          {group.map((item, itemIndex) => {
            const paletteColor = resolvePaletteColor(
              theme,
              getStatusColorMapping(item.label),
            );
            const mainColor = paletteColor?.main ?? theme.palette.grey[400];
            const backgroundColor =
              paletteColor?.main !== undefined
                ? alpha(paletteColor.main, 0.1)
                : theme.palette.grey[50];
            // const textColor =
            //   paletteColor?.dark ??
            //   paletteColor?.main ??
            //   theme.palette.text.primary;

            return (
              <Stack
                key={`${item.label}-${itemIndex}`}
                direction="row"
                spacing={0.75}
                alignItems="center"
              >
                <Box
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: "8px",
                    border: `1px solid ${mainColor}`,
                    backgroundColor,
                    color: "#333",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: "0.7rem",
                    flexShrink: 0,
                  }}
                >
                  {item.count}
                </Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontWeight: 500 }}
                >
                  {formatCountLabel(item)}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      ))}
    </Stack>
  );
};

export const EntityListItem: React.FC<EntityListItemProps> = ({
  title,
  contentSlot,
  description,
  status,
  leadingContent,
  statusLeadingAdornment,
  attentionContent,
  entityKindLabel,
  entityKindIcon,
  workItemIcon,
  agentSessionType,
  conversationId,
  tags,
  metadata,
  counts,
  href,
  onClick,
  onDelete,
  actions,
  nestingLevel = 0,
  displayMode = "default",
  titleStatusLayout = "responsive",
  createdAt,
  updatedAt,
  dependencies,
  expandButton,
}) => {
  const formattedCreatedAt = formatEntityDate(createdAt);
  const formattedUpdatedAt = formatEntityDate(updatedAt);
  const hasDates = Boolean(formattedCreatedAt || formattedUpdatedAt);
  const theme = useMuiTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isCompactStatus = titleStatusLayout === "responsive" && isMobile;
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [confirmOpen, setConfirmOpen, confirmOpenOwnerKey] =
    useModalState(false);
  const [
    dependencyDetailsOpen,
    setDependencyDetailsOpen,
    dependencyDetailsOpenOwnerKey,
  ] = useModalState(false);
  const [containerRef, descriptionWidth] = useElementWidth<HTMLElement>();
  const isMinimal = displayMode === "minimal";
  const isList = displayMode === "list";
  const { phase: conversationPhase } = useConversationPhase(conversationId);

  const handleDeleteClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setConfirmOpen(true);
  };

  const handleConfirmDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setConfirmOpen(false);
    onDelete?.();
  };

  const handleCancelDelete = () => {
    setConfirmOpen(false);
  };

  const inlineDependencies = dependencies?.slice(0, 2) ?? [];
  const hiddenDependencyCount = Math.max((dependencies?.length ?? 0) - 2, 0);

  const handleDependencySummaryClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setDependencyDetailsOpen(true);
  };

  const handleDependencyDetailsClose = (event: React.MouseEvent) => {
    event.stopPropagation();
    setDependencyDetailsOpen(false);
  };

  const primaryMetadataRow = metadata?.[0];
  const metadataContent = primaryMetadataRow ? (
    <MetadataDisclosure
      rows={metadata}
      title="More details"
      testIdPrefix="entity-list-item-metadata"
      mobileBreakpoint="md"
      mobileTrigger={{
        primaryRow: primaryMetadataRow,
        closedAriaLabel: "Show more details",
        openAriaLabel: "Hide more details",
      }}
      desktopJustifyContent="flex-start"
      desktopChipVariant="muted"
    />
  ) : null;

  return (
    <ListItem
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      sx={{
        cursor: href || onClick ? "pointer" : "default",
        mb: isList ? 0 : isMinimal ? 1.5 : 2.5,
        p: isList ? 1.25 : isMinimal ? 1 : 1.5,
        pl:
          (isList ? 1.25 : isMinimal ? 1 : 1.5) +
          (nestingLevel ? nestingLevel * 4 : 0),
        backgroundColor: (theme) =>
          isList
            ? "transparent"
            : theme.palette.mode === "dark"
              ? alpha(theme.palette.common.white, 0.05)
              : theme.palette.background.paper,
        border: isList ? 0 : `1px solid ${theme.palette.divider}`,
        borderRadius: isList ? 0 : 0.5,
        display: "block",
        width: "100%",
        boxSizing: "border-box",
        "&:hover": {
          backgroundColor: (theme) =>
            theme.palette.mode === "dark"
              ? alpha(theme.palette.common.white, 0.1)
              : theme.palette.action.hover,
        },
      }}
    >
      {contentSlot ?? (
        <Stack
          direction="row"
          alignItems="flex-start"
          spacing={1}
          sx={{ minWidth: 0, width: "100%" }}
        >
          <Box
            ref={containerRef}
            sx={{
              minWidth: 0,
              width: "100%",
              flexGrow: 1,
              display: "block",
            }}
          >
            <Box
              {...(href
                ? { component: RouterLink, to: href }
                : { component: "div" })}
              sx={{
                minWidth: 0,
                width: "100%",
                textDecoration: "none",
                color: "inherit",
                display: "block",
              }}
            >
              {/* Title with entity kind and status */}
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                justifyContent={"space-between"}
                sx={{ mb: isMinimal ? 0 : 0.25, minWidth: 0 }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: isList ? 0.75 : 0.5,
                    minWidth: 0,
                    maxWidth: "100%",
                  }}
                >
                  {leadingContent}
                  <ConversationPhaseIndicator phase={conversationPhase} />
                  {entityKindIcon && (
                    <Box
                      component="span"
                      role="img"
                      aria-label={entityKindLabel ?? entityKindIcon}
                      data-testid="entity-kind-icon"
                      sx={{
                        display: "inline-flex",
                        flexShrink: 0,
                        alignSelf: isList ? "center" : "flex-start",
                      }}
                    >
                      <EntityIcon
                        entityType={entityKindIcon}
                        workItemIcon={workItemIcon}
                        agentSessionType={agentSessionType}
                        size={24}
                      />
                    </Box>
                  )}
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 500,
                      fontSize: isList
                        ? "1.125rem"
                        : isMinimal
                          ? "1rem"
                          : undefined,
                      lineHeight: isList || isMinimal ? 1.3 : undefined,
                      textDecoration: href && isHovered ? "underline" : "none",
                      textUnderlineOffset: "2px",
                      minWidth: 0,
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    {title}
                  </Typography>
                  <ChevronRight
                    sx={{
                      fontSize: "1.25rem",
                      opacity: isHovered ? 1 : 0,
                      transition: "opacity 0.2s ease-in-out",
                      flexShrink: 0,
                    }}
                  />
                </Box>
                {(attentionContent || status) && (
                  <Stack
                    alignItems="center"
                    data-testid="entity-list-item-indicators"
                    direction="row"
                    spacing={1}
                    sx={{ flexShrink: 0 }}
                  >
                    {attentionContent}
                    {status && (
                      <Stack
                        alignItems="center"
                        data-testid="entity-list-item-status"
                        direction="row"
                        spacing={1}
                      >
                        {statusLeadingAdornment}
                        <Chip
                          label={isCompactStatus ? undefined : status}
                          aria-label={isCompactStatus ? status : undefined}
                          icon={
                            isCompactStatus
                              ? getCompactStatusIcon(status)
                              : undefined
                          }
                          color={getStatusColorMapping(status)}
                          size="small"
                          sx={
                            isCompactStatus
                              ? {
                                  width: 30,
                                  height: 30,
                                  minWidth: 30,
                                  flexShrink: 0,
                                  padding: 0,
                                  borderRadius: "50%",
                                  "& .MuiChip-icon": { margin: 0 },
                                  "& .MuiChip-label": { padding: 0 },
                                }
                              : undefined
                          }
                        />
                      </Stack>
                    )}
                  </Stack>
                )}
              </Stack>

              {/* Description */}
              {description &&
                (isMobile ? (
                  <Typography
                    component="div"
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      mb: isMinimal ? 1 : 1.5,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      minWidth: 0,
                      width: "100%",
                    }}
                  >
                    {renderInlineMentions(description)}
                  </Typography>
                ) : (
                  (descriptionWidth ?? 0) > 0 && (
                    <Typography
                      component="div"
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        mb: isMinimal ? 1 : 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "block",
                        width: `${descriptionWidth}px`,
                      }}
                    >
                      {renderInlineMentions(description)}
                    </Typography>
                  )
                ))}

              {/* Counts */}
              {counts && counts.length > 0 && (
                <Stack
                  direction={isMobile ? "column" : "row"}
                  spacing={isMobile ? 1 : 3}
                  alignItems={isMobile ? "flex-start" : "center"}
                  sx={{ mb: isMinimal ? 0.75 : 1.5, minWidth: 0 }}
                >
                  {renderCounts(counts, theme)}

                  {expandButton && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        expandButton.onToggle();
                      }}
                      sx={{
                        transform: expandButton.expanded
                          ? "rotate(0deg)"
                          : "rotate(-90deg)",
                        transition: "transform 0.2s",
                      }}
                    >
                      <ExpandMore fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              )}

              {/* Secondary metadata */}
              {metadataContent ? null : tags && tags.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: "wrap", gap: 0.5, minWidth: 0 }}
                >
                  {tags.map((tag: string, index: number) => (
                    <Chip
                      key={index}
                      label={tag}
                      size="small"
                      sx={{
                        backgroundColor: (theme) =>
                          theme.palette.mode === "dark"
                            ? "grey.800"
                            : "grey.200",
                        color: "text.primary",
                        border: "none",
                      }}
                    />
                  ))}
                </Stack>
              ) : null}

              {hasDates && (
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{
                    mt: isMinimal ? 0.5 : 1,
                    flexWrap: "wrap",
                    mb: 1.5,
                    minWidth: 0,
                  }}
                >
                  {formattedCreatedAt && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      data-testid="entity-created-at"
                    >
                      Created {formattedCreatedAt}
                    </Typography>
                  )}
                  {formattedUpdatedAt && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      data-testid="entity-updated-at"
                    >
                      Updated {formattedUpdatedAt}
                    </Typography>
                  )}
                </Stack>
              )}

              {dependencies && dependencies.length > 0 && (
                <Box
                  data-testid="entity-dependencies"
                  sx={{
                    mt: isMinimal ? 0.5 : 1,
                    pt: 1,
                    borderTop: `1px dashed ${theme.palette.divider}`,
                  }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      display: "block",
                      mb: 0.5,
                    }}
                  >
                    Dependencies
                  </Typography>
                  <DependencyRows
                    dependencies={inlineDependencies}
                    testIdPrefix="entity-dependency"
                    theme={theme}
                  />
                  {hiddenDependencyCount > 0 && (
                    <Button
                      aria-label={`Show ${hiddenDependencyCount} more dependencies`}
                      data-testid="entity-dependency-more"
                      onClick={handleDependencySummaryClick}
                      size="small"
                      sx={{
                        alignSelf: "flex-start",
                        minWidth: 0,
                        mt: 0.5,
                        px: 0.75,
                        py: 0.25,
                      }}
                    >
                      +{hiddenDependencyCount}
                    </Button>
                  )}
                </Box>
              )}
            </Box>
            {metadataContent}
          </Box>

          {actions}

          {onDelete && !isMobile && (
            <IconButton
              aria-label="Delete"
              size="small"
              onClick={handleDeleteClick}
              sx={{ mt: isMinimal ? 0 : 0.5 }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      )}

      {hiddenDependencyCount > 0 && (
        <Dialog
          ownerKey={dependencyDetailsOpenOwnerKey}
          data-testid="entity-dependency-dialog"
          open={dependencyDetailsOpen}
          onClose={() => setDependencyDetailsOpen(false)}
          onClick={(event: React.MouseEvent) => event.stopPropagation()}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>All dependencies</DialogTitle>
          <DialogContent
            dividers
            data-testid="entity-dependency-dialog-content"
          >
            <DependencyRows
              dependencies={dependencies ?? []}
              testIdPrefix="entity-dependency-dialog"
              theme={theme}
            />
          </DialogContent>
          <DialogActions>
            <Button
              data-testid="entity-dependency-dialog-close"
              onClick={handleDependencyDetailsClose}
            >
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {onDelete && isMobile && (
        <Stack
          direction="row"
          justifyContent="flex-end"
          sx={{ mt: 1, width: "100%" }}
        >
          <IconButton
            aria-label="Delete"
            size="small"
            onClick={handleDeleteClick}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      )}

      {onDelete && (
        <Dialog
          ownerKey={confirmOpenOwnerKey}
          open={confirmOpen}
          onClose={handleCancelDelete}
        >
          <DialogTitle>{t(KEYS.common.delete)}</DialogTitle>
          <DialogContent>
            <Typography>Are you sure you want to delete "{title}"?</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCancelDelete}>
              {t(KEYS.common.cancel)}
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={handleConfirmDelete}
            >
              {t(KEYS.common.delete)}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </ListItem>
  );
};
