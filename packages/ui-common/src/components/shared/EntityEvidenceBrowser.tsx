import { useModalState } from "../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Box,
  Button,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useMemo, useState, type ReactNode } from "react";
import { EntityIcon } from "../Entity/EntityIcon";

export interface EntityEvidenceItem {
  id: string;
  entityType: string;
  title: string;
  subtitle?: string;
  preview?: string;
  details?: string;
  highlighted?: boolean;
}

export interface EntityEvidenceGroup {
  id: string;
  label: string;
  items: EntityEvidenceItem[];
}

export interface EntityEvidenceBrowserProps {
  groups: EntityEvidenceGroup[];
  title?: string;
  emptyText?: string;
  modalTitle?: string;
  dataTestId?: string;
  listDataTestId?: string;
  modalActions?: ReactNode;
  renderItemActions?: (item: EntityEvidenceItem) => ReactNode;
}

const dedupeForIconStrip = (
  groups: EntityEvidenceGroup[],
): EntityEvidenceItem[] => {
  const seenByTypeCount = new Map<string, number>();
  const dedupedItems: EntityEvidenceItem[] = [];

  for (const group of groups) {
    for (const item of group.items) {
      const count = seenByTypeCount.get(item.entityType) ?? 0;
      seenByTypeCount.set(item.entityType, count + 1);
      if (count <= 3) {
        dedupedItems.push(item);
      }
    }
  }

  return dedupedItems;
};

const isHighlighted = (item: EntityEvidenceItem): boolean =>
  item.highlighted === true;

const getTotalCount = (groups: EntityEvidenceGroup[]): number =>
  groups.reduce((accumulator, group) => accumulator + group.items.length, 0);

export const EntityEvidenceBrowser = ({
  groups,
  title = "Evidence Sources",
  emptyText = "No evidence items available.",
  modalTitle = "Evidence Details",
  dataTestId = "entity-evidence-browser",
  listDataTestId = "entity-evidence-browser-list",
  modalActions,
  renderItemActions,
}: EntityEvidenceBrowserProps) => {
  const [isOpen, setIsOpen, isOpenOwnerKey] = useModalState(false);
  const [expandedByItemId, setExpandedByItemId] = useState<
    Record<string, boolean>
  >({});

  const totalCount = useMemo(() => getTotalCount(groups), [groups]);
  const dedupedItems = useMemo(() => dedupeForIconStrip(groups), [groups]);

  if (totalCount === 0) {
    return (
      <Stack spacing={1} data-testid={dataTestId}>
        <Typography variant="subtitle2">{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      </Stack>
    );
  }

  const firstItem = groups[0]?.items[0] ?? null;
  const remainingCount = Math.max(0, totalCount - 1);

  return (
    <>
      <Paper
        variant="outlined"
        sx={(theme) => ({
          p: 2,
          borderColor: groups.some((group) => group.items.some(isHighlighted))
            ? theme.palette.success.light
            : "divider",
          backgroundColor: "background.paper",
          ...(groups.some((group) => group.items.some(isHighlighted))
            ? {
                boxShadow: `0 0 0 1px ${alpha(
                  theme.palette.success.main,
                  0.2,
                )}, ${theme.shadows[2]}`,
                backgroundImage: `linear-gradient(${alpha(
                  theme.palette.success.main,
                  0.08,
                )}, ${alpha(theme.palette.success.main, 0.02)})`,
              }
            : {}),
        })}
        data-testid={dataTestId}
      >
        <Stack spacing={1}>
          <Typography variant="subtitle2">{title}</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {dedupedItems.map((item) => (
              <EntityIcon key={item.id} entityType={item.entityType} />
            ))}
          </Box>
          {firstItem ? (
            <Stack
              direction="row"
              spacing={0.5}
              alignItems="baseline"
              flexWrap="wrap"
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {firstItem.title}
              </Typography>
              {remainingCount > 0 ? (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => setIsOpen(true)}
                  sx={{
                    p: 0,
                    minWidth: "auto",
                    textTransform: "none",
                    fontWeight: 500,
                  }}
                  data-testid="entity-evidence-open-more"
                >
                  and {remainingCount} more
                </Button>
              ) : (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => setIsOpen(true)}
                  sx={{
                    p: 0,
                    minWidth: "auto",
                    textTransform: "none",
                    fontWeight: 500,
                  }}
                  data-testid="entity-evidence-open-details"
                >
                  view details
                </Button>
              )}
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      <Dialog
        ownerKey={isOpenOwnerKey}
        open={isOpen}
        onClose={() => setIsOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
          >
            <Typography component="span" variant="h6">
              {modalTitle}
            </Typography>
            {modalActions ? (
              <Box data-testid="entity-evidence-modal-actions">
                {modalActions}
              </Box>
            ) : null}
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ p: 2 }}>
            <Stack spacing={2} data-testid={listDataTestId}>
              {groups.map((group) => (
                <Stack
                  key={group.id}
                  spacing={1.25}
                  data-testid={`entity-evidence-group-${group.id}`}
                >
                  <Typography variant="subtitle2">{group.label}</Typography>
                  <List disablePadding>
                    {group.items.map((item) => {
                      const expanded = expandedByItemId[item.id] ?? false;
                      const itemActions = renderItemActions?.(item);
                      return (
                        <ListItem
                          key={item.id}
                          sx={(theme) => ({
                            py: 1,
                            ...(item.highlighted
                              ? {
                                  borderRadius: 1,
                                  backgroundColor: alpha(
                                    theme.palette.success.main,
                                    0.06,
                                  ),
                                  boxShadow: `0 0 0 1px ${alpha(
                                    theme.palette.success.main,
                                    0.28,
                                  )} inset`,
                                }
                              : {}),
                          })}
                        >
                          <Stack spacing={1} sx={{ width: "100%" }}>
                            <Stack
                              direction="row"
                              spacing={1}
                              alignItems="center"
                              justifyContent="space-between"
                            >
                              <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                              >
                                <ListItemIcon sx={{ minWidth: 40 }}>
                                  <EntityIcon
                                    entityType={item.entityType}
                                    size={24}
                                  />
                                </ListItemIcon>
                                <ListItemText
                                  primary={item.title}
                                  secondary={item.subtitle ?? item.entityType}
                                />
                              </Stack>
                              <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                              >
                                {item.details ? (
                                  <Button
                                    type="button"
                                    size="small"
                                    onClick={() =>
                                      setExpandedByItemId((current) => ({
                                        ...current,
                                        [item.id]: !expanded,
                                      }))
                                    }
                                    data-testid={`entity-evidence-toggle-${item.id}`}
                                  >
                                    {expanded ? "Hide details" : "View details"}
                                  </Button>
                                ) : null}
                                {itemActions ? (
                                  <Box
                                    data-testid={`entity-evidence-item-actions-${item.id}`}
                                  >
                                    {itemActions}
                                  </Box>
                                ) : null}
                              </Stack>
                            </Stack>
                            {item.preview ? (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {item.preview}
                              </Typography>
                            ) : null}
                            {item.details && expanded ? (
                              <Typography
                                component="pre"
                                variant="body2"
                                sx={{
                                  m: 0,
                                  whiteSpace: "pre-wrap",
                                  overflowWrap: "anywhere",
                                  wordBreak: "break-word",
                                }}
                              >
                                {item.details}
                              </Typography>
                            ) : null}
                          </Stack>
                        </ListItem>
                      );
                    })}
                  </List>
                </Stack>
              ))}
            </Stack>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};
