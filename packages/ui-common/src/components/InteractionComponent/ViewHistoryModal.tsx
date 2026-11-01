import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import React, { useMemo } from "react";
import {
  Box,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { EntityType } from "../../api";
import { usePathService } from "../../contexts/PathServiceContext";
import type { PathService } from "../../services/webPathService";
import {
  entityNameKey,
  useEntityNames,
  type EntityNameLookup,
} from "../../data/hooks/useEntityNames";
import type { EntityProposalHistoryEntry } from "./ProvenanceSummary";

export interface ViewHistoryModalProps {
  open: boolean;
  onClose: () => void;
  proposals: EntityProposalHistoryEntry[];
  entityTitle?: string;
  organizationId?: string;
  projectId?: string;
  onNavigateToEntity?: (entityId: string, entityType: EntityType) => void;
}

const NAVIGABLE_ENTITY_TYPES = new Set<EntityType>([
  EntityType.Task,
  EntityType.DesignDoc,
  EntityType.Initiative,
  EntityType.AgentSession,
]);

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const buildHrefForEntity = (
  pathService: PathService,
  projectId: string | undefined,
  entityId: string,
  entityType: EntityType,
): string | null => {
  if (!projectId) return null;
  switch (entityType) {
    case EntityType.Task:
      return pathService.task({ projectId, taskId: entityId });
    case EntityType.DesignDoc:
      return pathService.designDoc({ projectId, designDocId: entityId });
    case EntityType.Initiative:
      return pathService.initiativeDetail({
        projectId,
        initiativeId: entityId,
      });
    case EntityType.AgentSession:
      return pathService.agentSession({
        projectId,
        agentSessionId: entityId,
      });
    default:
      return null;
  }
};

export const ViewHistoryModal: React.FC<ViewHistoryModalProps> = ({
  open,
  onClose,
  proposals,
  entityTitle,
  organizationId,
  projectId,
  onNavigateToEntity,
}) => {
  const pathService = usePathService();

  // Collect (entityId, entityType) pairs for influences whose stamped
  // entityTitle is missing so we can backfill them via the entities/names
  // batch endpoint.
  const lookups = useMemo<EntityNameLookup[]>(() => {
    const result: EntityNameLookup[] = [];
    for (const proposal of proposals) {
      if (!proposal.influences) continue;
      for (const influence of proposal.influences) {
        if (influence.entityTitle) continue;
        result.push({
          entityId: influence.entityId,
          entityType: influence.entityType,
        });
      }
    }
    return result;
  }, [proposals]);

  const { names } = useEntityNames({
    organizationId: organizationId ?? "",
    entities: lookups,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="view-history-modal"
      closeControl={
        <IconButton onClick={onClose} size="small" aria-label="close">
          <CloseIcon fontSize="small" />
        </IconButton>
      }
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Box>
          History
          {entityTitle && (
            <Typography variant="body2" color="text.secondary" noWrap>
              {entityTitle}
            </Typography>
          )}
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {proposals.map((proposal) => (
          <Box
            key={proposal.id}
            data-testid={`history-proposal-${proposal.id}`}
            sx={{ mb: 2, "&:last-child": { mb: 0 } }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "baseline",
                gap: 1,
                mb: 0.5,
              }}
            >
              <Typography
                variant="subtitle2"
                sx={{ textTransform: "capitalize" }}
              >
                {proposal.action.toLowerCase()}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatDate(proposal.createdAt)}
              </Typography>
            </Box>

            {proposal.influences && proposal.influences.length > 0 && (
              <Box sx={{ mt: 0.5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600, display: "block", mb: 0.5 }}
                >
                  Influences
                </Typography>
                {proposal.influences.map((influence, idx) => {
                  const entityType = influence.entityType as EntityType;
                  const isNavigable =
                    !!onNavigateToEntity &&
                    NAVIGABLE_ENTITY_TYPES.has(entityType);
                  const resolvedTitle =
                    influence.entityTitle ??
                    names.get(entityNameKey(influence.entityId, entityType)) ??
                    null;
                  const titleText = resolvedTitle ?? influence.entityId;
                  const href = isNavigable
                    ? buildHrefForEntity(
                        pathService,
                        projectId,
                        influence.entityId,
                        entityType,
                      )
                    : null;
                  const separatorSx = {
                    pb: idx < (proposal.influences?.length ?? 0) - 1 ? 1 : 0,
                    mb: idx < (proposal.influences?.length ?? 0) - 1 ? 1 : 0,
                    borderBottom:
                      idx < (proposal.influences?.length ?? 0) - 1 ? 1 : 0,
                    borderColor: "divider",
                  };
                  return (
                    <Box
                      key={`${influence.entityId}-${idx}`}
                      data-testid={`history-influence-${proposal.id}-${idx}`}
                      sx={separatorSx}
                    >
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontStyle: "italic", display: "block" }}
                      >
                        {entityType}
                      </Typography>
                      {isNavigable && href ? (
                        <Link
                          href={href}
                          variant="caption"
                          underline="hover"
                          onClick={(event) => {
                            // Allow modifier-clicks (cmd/ctrl/middle/shift)
                            // to use native browser behavior so right-click
                            // → "Open in new tab" and ⌘-click work.
                            if (
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              event.button === 1
                            ) {
                              return;
                            }
                            event.preventDefault();
                            onNavigateToEntity!(influence.entityId, entityType);
                            onClose();
                          }}
                          sx={{
                            display: "block",
                            whiteSpace: "normal",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          {titleText}
                        </Link>
                      ) : (
                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                            whiteSpace: "normal",
                            fontWeight: 600,
                          }}
                        >
                          {titleText}
                        </Typography>
                      )}
                      <Typography
                        variant="caption"
                        sx={{ display: "block", whiteSpace: "normal" }}
                      >
                        {influence.reasoning}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
};
