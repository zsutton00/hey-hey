import { FeaturePicker } from "@hey-hey/ui-common/components";
import { useServices, useWorkItems } from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";
import {
  Alert,
  Box,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getTypeSpecificFilters } from "./Explorer/ExplorerWorkItemQuery";
import { WORK_ITEM_TYPE_KEYS } from "../types/workItemTypes";

export type SearchBrowseTarget =
  | { kind: "work-item"; typeKey: string; label: string }
  | { kind: "services"; label: string };

interface BrowseRow {
  id: string;
  name: string;
  href: string;
}

const MIN_ROW_HEIGHT = 44;

const getWorkItemHref = (
  typeKey: string,
  projectId: string,
  id: string,
): string => {
  if (typeKey === "PLAN") {
    return `/projects/${projectId}/plans/${id}`;
  }

  return WebPathService.task({ projectId, taskId: id });
};

interface BrowseListProps {
  organizationId: string;
  projectId: string;
  target: SearchBrowseTarget;
  onNavigated: () => void;
}

const useBrowseRows = (
  organizationId: string,
  projectId: string,
  target: SearchBrowseTarget,
): { rows: BrowseRow[]; isLoading: boolean; error: unknown } => {
  const isService = target.kind === "services";
  const typeKey = target.kind === "work-item" ? target.typeKey : "";

  const workItems = useWorkItems(organizationId, "task", projectId, undefined, {
    ...getTypeSpecificFilters(typeKey),
    enabled: !isService,
    taskType: typeKey,
    websocketsEnabled: false,
  });
  const services = useServices(organizationId, {
    projectId,
    enabled: isService,
  });

  return useMemo(() => {
    if (isService) {
      return {
        rows: services.services
          .map((service) => ({
            id: service.id,
            name: service.name,
            href: `/projects/${projectId}/services/${service.id}`,
          }))
          .sort(compareRows),
        isLoading: services.isLoading,
        error: services.error,
      };
    }

    return {
      rows: workItems.workItems
        .filter((item) => item.type === typeKey)
        .map((item) => ({
          id: item.id,
          name: item.name,
          href: getWorkItemHref(typeKey, projectId, item.id),
        }))
        .sort(compareRows),
      isLoading: workItems.isLoading,
      error: workItems.error,
    };
  }, [isService, projectId, services, typeKey, workItems]);
};

const compareRows = (a: BrowseRow, b: BrowseRow): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const BrowseList: React.FC<BrowseListProps> = ({
  organizationId,
  projectId,
  target,
  onNavigated,
}) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const { rows, isLoading, error } = useBrowseRows(
    organizationId,
    projectId,
    target,
  );

  const normalizedFilter = filter.trim().toLowerCase();
  const visibleRows = normalizedFilter
    ? rows.filter((row) => row.name.toLowerCase().includes(normalizedFilter))
    : rows;

  const handleOpen = (event: React.MouseEvent, href: string): void => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(href);
    onNavigated();
  };

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      data-testid="search-browse-list"
      data-browse-target={target.label}
    >
      <TextField
        size="small"
        fullWidth
        autoFocus
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={`Filter ${target.label.toLowerCase()} by title`}
        slotProps={{
          htmlInput: {
            "aria-label": `Filter ${target.label} by title`,
            "data-testid": "search-browse-filter",
          },
        }}
      />
      <Box sx={{ flex: 1, overflow: "auto", mt: 1 }}>
        {error ? (
          <Alert severity="error" data-testid="search-browse-error">
            Could not load {target.label.toLowerCase()}.
          </Alert>
        ) : isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
            <CircularProgress size={20} />
          </Box>
        ) : visibleRows.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ p: 2 }}
            data-testid="search-browse-empty"
          >
            {normalizedFilter
              ? `No ${target.label.toLowerCase()} match “${filter.trim()}”.`
              : `No ${target.label.toLowerCase()} yet.`}
          </Typography>
        ) : (
          <List disablePadding>
            {visibleRows.map((row) => (
              <ListItemButton
                key={row.id}
                component="a"
                href={row.href}
                onClick={(event: React.MouseEvent) =>
                  handleOpen(event, row.href)
                }
                data-testid="search-browse-row"
                data-item-id={row.id}
                sx={{ minHeight: MIN_ROW_HEIGHT }}
              >
                <ListItemText
                  primary={row.name}
                  slotProps={{
                    primary: { variant: "body2", noWrap: true },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
};

interface SearchBrowseTabProps {
  organizationId: string;
  projectId: string;
  target: SearchBrowseTarget;
  onNavigated: () => void;
}

export const SearchBrowseTab: React.FC<SearchBrowseTabProps> = ({
  organizationId,
  projectId,
  target,
  onNavigated,
}) => {
  const navigate = useNavigate();
  const isFeatures =
    target.kind === "work-item" &&
    target.typeKey === WORK_ITEM_TYPE_KEYS.Feature;

  if (!isFeatures) {
    return (
      <BrowseList
        key={target.label}
        organizationId={organizationId}
        projectId={projectId}
        target={target}
        onNavigated={onNavigated}
      />
    );
  }

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      data-testid="search-browse-features"
    >
      <FeaturePicker
        inline
        organizationId={organizationId}
        projectId={projectId}
        label="Search features"
        value={null}
        sx={{ flex: 1, minHeight: 0 }}
        getFeatureHref={(featureId) =>
          WebPathService.feature({ projectId, featureId })
        }
        onChange={(featureId, feature) => {
          if (!featureId || !feature) {
            return;
          }
          navigate(WebPathService.feature({ projectId, featureId }));
          onNavigated();
        }}
      />
    </Box>
  );
};
