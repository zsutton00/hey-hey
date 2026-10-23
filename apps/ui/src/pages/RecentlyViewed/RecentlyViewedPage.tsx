import type { AttentionEventResponse } from "@hey-hey/ui-common/api";
import { EntityIcon } from "@hey-hey/ui-common/components";
import { useAttentionEvents, useProject } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose } from "@hey-hey/ui-common/i18n";
import {
  Alert,
  Box,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { parseAsStringEnum, useQueryState } from "nuqs";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import {
  getProjectRecentlyViewedEvents,
  getRecentlyViewedEntityIconType,
  getRecentlyViewedEntityName,
  getRecentlyViewedEntityPath,
} from "../../components/Notifications/recentlyViewed";

const RECENTLY_VIEWED_LIMIT = 50;

const SORT_VALUES = [
  "mostRecent",
  "oldest",
  "alphabetical",
  "entityType",
] as const;
type RecentlyViewedSort = (typeof SORT_VALUES)[number];

const SORT_OPTIONS: Array<{
  value: RecentlyViewedSort;
  labelKey: string;
  defaultLabel: string;
}> = [
  {
    value: "mostRecent",
    labelKey: "recentlyViewed.sort.mostRecent",
    defaultLabel: "Most recent",
  },
  {
    value: "oldest",
    labelKey: "recentlyViewed.sort.oldest",
    defaultLabel: "Oldest",
  },
  {
    value: "alphabetical",
    labelKey: "recentlyViewed.sort.alphabetical",
    defaultLabel: "Alphabetical",
  },
  {
    value: "entityType",
    labelKey: "recentlyViewed.sort.entityType",
    defaultLabel: "Entity type",
  },
];

const getFocusEndMs = (event: AttentionEventResponse): number => {
  const parsed = Date.parse(event.focusEnd);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortRecentlyViewed = (
  events: AttentionEventResponse[],
  sort: RecentlyViewedSort,
): AttentionEventResponse[] => {
  const copy = [...events];
  switch (sort) {
    case "oldest":
      return copy.sort((a, b) => getFocusEndMs(a) - getFocusEndMs(b));
    case "alphabetical":
      return copy.sort((a, b) =>
        getRecentlyViewedEntityName(a).localeCompare(
          getRecentlyViewedEntityName(b),
          undefined,
          { sensitivity: "base" },
        ),
      );
    case "entityType":
      return copy.sort((a, b) => {
        const typeCompare = a.entityType.localeCompare(b.entityType);
        if (typeCompare !== 0) {
          return typeCompare;
        }
        return getFocusEndMs(b) - getFocusEndMs(a);
      });
    case "mostRecent":
    default:
      return copy.sort((a, b) => getFocusEndMs(b) - getFocusEndMs(a));
  }
};

export const RecentlyViewedPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId = "" } = useParams<{ projectId: string }>();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  const [sort, setSort] = useQueryState<RecentlyViewedSort>(
    "sort",
    parseAsStringEnum<RecentlyViewedSort>([...SORT_VALUES]).withDefault(
      "mostRecent",
    ),
  );

  const { data: project } = useProject(organizationId, projectId, {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });

  const {
    events,
    error,
    isLoading,
  } = useAttentionEvents(organizationId, {
    enabled: !!organizationId && !!projectId,
    includeEntity: true,
    limit: RECENTLY_VIEWED_LIMIT,
    sort: "mostRecent",
  });

  const items = useMemo(() => {
    const filtered = getProjectRecentlyViewedEvents(events, projectId);
    return sortRecentlyViewed(filtered, sort).slice(0, RECENTLY_VIEWED_LIMIT);
  }, [events, projectId, sort]);

  const handleSortChange = (event: SelectChangeEvent<RecentlyViewedSort>) => {
    const next = event.target.value as RecentlyViewedSort;
    void setSort(next);
  };

  const handleItemClick = (
    clickEvent: React.MouseEvent<HTMLAnchorElement>,
    route: string,
  ) => {
    if (
      !clickEvent.ctrlKey &&
      !clickEvent.metaKey &&
      !clickEvent.shiftKey &&
      clickEvent.button === 0
    ) {
      clickEvent.preventDefault();
      navigate(route);
    }
  };

  if (!projectId) {
    return (
      <Alert severity="error">
        {t("recentlyViewed.errors.missingProjectId", "Project ID is required")}
      </Alert>
    );
  }

  return (
    <>
      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={[
          {
            label: t("recentlyViewed.breadcrumbs.projects", "Projects"),
            to: "/projects",
          },
          {
            label: project?.name ?? compose("{{term.Project}}"),
            to: `/projects/${projectId}`,
            type: project?.name ? "project" : undefined,
          },
          {
            label: t("recentlyViewed.title", "Recently Viewed"),
            isCurrent: true,
          },
        ]}
      />

      <DetailPageContainer>
        <DetailPageHeader
          title={t("recentlyViewed.title", "Recently Viewed")}
        />

        <Stack spacing={2} sx={{ px: 3, pb: 3 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              flexWrap: "wrap",
            }}
          >
            <Typography color="text.secondary" variant="body2">
              {t(
                "recentlyViewed.summary",
                "The {{count}} most recently viewed entities in this project.",
                { count: RECENTLY_VIEWED_LIMIT },
              )}
            </Typography>
            <Select<RecentlyViewedSort>
              data-testid="recently-viewed-sort-select"
              onChange={handleSortChange}
              size="small"
              value={sort}
              sx={{ minWidth: 200 }}
            >
              {SORT_OPTIONS.map((option) => (
                <MenuItem
                  data-testid={`recently-viewed-sort-option-${option.value}`}
                  key={option.value}
                  value={option.value}
                >
                  {t(option.labelKey, option.defaultLabel)}
                </MenuItem>
              ))}
            </Select>
          </Box>

          {error ? (
            <Alert severity="error">
              {t(
                "recentlyViewed.errors.load",
                "Failed to load recently viewed items",
              )}
            </Alert>
          ) : null}

          {isLoading ? (
            <Box
              data-testid="recently-viewed-loading"
              sx={{ display: "flex", justifyContent: "center", py: 6 }}
            >
              <CircularProgress size={28} />
            </Box>
          ) : null}

          {!isLoading && !error && items.length === 0 ? (
            <Paper
              data-testid="recently-viewed-empty"
              sx={{ p: 3, textAlign: "center" }}
              variant="outlined"
            >
              <Typography color="text.secondary" variant="body2">
                {t(
                  "recentlyViewed.empty",
                  "No recently viewed items in this project yet.",
                )}
              </Typography>
            </Paper>
          ) : null}

          {!isLoading && !error && items.length > 0 ? (
            <Stack
              component="ol"
              data-testid="recently-viewed-list"
              spacing={1}
              sx={{ listStyle: "none", m: 0, p: 0 }}
            >
              {items.map((event) => {
                const route = getRecentlyViewedEntityPath(event, projectId);
                if (!route) {
                  return null;
                }

                return (
                  <Paper
                    component="li"
                    data-testid={`recently-viewed-row-${event.id}`}
                    key={`${event.entityType}:${event.entityId}:${event.id}`}
                    sx={{ p: 0 }}
                    variant="outlined"
                  >
                    <Box
                      component="a"
                      href={route}
                      onClick={(
                        clickEvent: React.MouseEvent<HTMLAnchorElement>,
                      ) => handleItemClick(clickEvent, route)}
                      sx={{
                        alignItems: "center",
                        color: "inherit",
                        display: "flex",
                        gap: 1.5,
                        px: 2,
                        py: 1.25,
                        textDecoration: "none",
                        "&:hover": {
                          bgcolor: "action.hover",
                        },
                        "&:focus": {
                          outline: "2px solid",
                          outlineColor: "primary.main",
                          outlineOffset: "-2px",
                        },
                      }}
                    >
                      <EntityIcon
                        entityType={getRecentlyViewedEntityIconType(event)}
                        size={28}
                        sx={{ flexShrink: 0 }}
                      />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          sx={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          variant="subtitle2"
                        >
                          {getRecentlyViewedEntityName(event)}
                        </Typography>
                        <Typography
                          color="text.secondary"
                          sx={{ textTransform: "capitalize" }}
                          variant="caption"
                        >
                          {event.entityType.replace(/_/g, " ")}
                        </Typography>
                      </Box>
                    </Box>
                  </Paper>
                );
              })}
            </Stack>
          ) : null}
        </Stack>
      </DetailPageContainer>
    </>
  );
};
