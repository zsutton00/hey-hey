import React from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import type { TargetEntityType } from "../../api";
import { InteractionComponent } from "../InteractionComponent";
import { EntityIcon } from "../Entity/EntityIcon";
import { useProjectContext } from "../../contexts/ProjectContext";
import { usePathService } from "../../contexts";
import { useUserIdentity } from "../../hooks/useUserIdentity";
import { buildEntityHref } from "../../utils/buildEntityHref";
import { useOptionalActionsCapsule } from "../ActionsCapsule/ActionsCapsuleContext";
import { useScratchpad } from "./useScratchpad";
import type { ScratchpadItem } from "./types";

const ICONABLE_SUBTYPES = new Set(["feature", "bug"]);

const resolveIconKey = (item: ScratchpadItem): string => {
  const subtype = item.entitySubtype?.toLowerCase();
  if (subtype && ICONABLE_SUBTYPES.has(subtype)) return subtype;
  return item.entityType.toLowerCase();
};

const SUBTYPE_LABEL: Record<string, string> = {
  feature: "Feature",
  bug: "Bug",
  standard: "Task",
};

const resolveTypeLabel = (item: ScratchpadItem): string => {
  const subtype = item.entitySubtype?.toLowerCase();
  if (subtype && SUBTYPE_LABEL[subtype]) return SUBTYPE_LABEL[subtype];
  const normalized = item.entityType.toLowerCase();
  return (
    normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, " ")
  );
};

interface ScratchpadItemRowProps {
  item: ScratchpadItem;
  onRemove: (entityId: string) => void;
  organizationId?: string;
  projectId?: string;
  onNavigate?: () => void;
}

const ScratchpadItemRow: React.FC<ScratchpadItemRowProps> = ({
  item,
  onRemove,
  organizationId,
  projectId,
  onNavigate,
}) => {
  const pathService = usePathService();
  const href = projectId
    ? buildEntityHref(pathService, projectId, {
        entityType: item.entityType,
        entityId: item.entityId,
      })
    : undefined;

  const rowContent = (
    <>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <EntityIcon entityType={resolveIconKey(item)} size={24} round />
      </ListItemIcon>
      <ListItemText
        primary={item.entityName}
        secondary={resolveTypeLabel(item)}
        primaryTypographyProps={{ variant: "body2", fontWeight: 500 }}
        secondaryTypographyProps={{ variant: "caption" }}
      />
    </>
  );

  return (
    <InteractionComponent
      entityId={item.entityId}
      entityType={item.entityType as TargetEntityType}
      entitySubtype={item.entitySubtype}
      hasProposalSupport
      organizationId={organizationId}
      projectId={projectId}
      entityTitle={item.entityName}
    >
      <ListItem
        disablePadding
        sx={{
          bgcolor: "background.paper",
          borderRadius: 1,
          mb: 0.5,
          border: 1,
          borderColor: "divider",
        }}
        secondaryAction={
          <IconButton
            edge="end"
            aria-label="Remove from scratchpad"
            onClick={() => onRemove(item.entityId)}
            size="small"
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        }
      >
        {href ? (
          <ListItemButton
            component={RouterLink}
            to={href}
            onClick={onNavigate}
            sx={{ borderRadius: 1 }}
          >
            {rowContent}
          </ListItemButton>
        ) : (
          <ListItemButton disabled sx={{ borderRadius: 1 }}>
            {rowContent}
          </ListItemButton>
        )}
      </ListItem>
    </InteractionComponent>
  );
};

export const ScratchpadPage: React.FC = () => {
  const { items, removeItem, clearAll } = useScratchpad();
  const projectContext = useProjectContext();
  const pathService = usePathService();
  const userIdentity = useUserIdentity();
  const location = useLocation();
  const actionsCapsule = useOptionalActionsCapsule();
  const handleNavigate = actionsCapsule
    ? () => actionsCapsule.collapseAction()
    : undefined;
  // The scratchpad renders both inside a route (ProjectContext.Provider is set
  // up by Layout) and inside the global ActionsCapsule, which is a sibling of
  // Layout and therefore outside that provider. Fall back to deriving the
  // current project from the URL so item rows can produce real links in both
  // contexts.
  const resolvedProjectId =
    projectContext?.projectId ??
    pathService.extractProjectId(location.pathname) ??
    undefined;
  const resolvedOrganizationId =
    projectContext?.organizationId ?? userIdentity?.currentOrgId ?? undefined;

  if (items.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          py: 8,
          px: 4,
          textAlign: "center",
        }}
      >
        <ContentPasteIcon
          sx={{ fontSize: 48, color: "text.disabled", mb: 2 }}
        />
        <Typography variant="h6" gutterBottom>
          Scratchpad is empty
        </Typography>
        <Typography variant="body2" color="text.secondary" maxWidth={400}>
          Drag and drop entities from anywhere in the app to collect them here.
          Use the scratchpad to review, compare, or gather items for discussion.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          {items.length} {items.length === 1 ? "item" : "items"}
        </Typography>
        <Button size="small" onClick={clearAll} color="inherit">
          Clear all
        </Button>
      </Box>
      <List disablePadding>
        {items.map((item) => (
          <ScratchpadItemRow
            key={item.entityId}
            item={item}
            onRemove={removeItem}
            organizationId={resolvedOrganizationId}
            projectId={resolvedProjectId}
            onNavigate={handleNavigate}
          />
        ))}
      </List>
    </Box>
  );
};
