import { useMemo } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import {
  parseAsArrayOf,
  parseAsFloat,
  parseAsString,
  useQueryState,
} from "nuqs";
import {
  useAdminProjectHints,
  useWorkItemTypes,
} from "@hey-hey/ui-common/data";
import { EntityFilters } from "@hey-hey/ui-common/components";
import type { FilterConfig } from "@hey-hey/ui-common/components";
import { EntityLinkWithPreview } from "@hey-hey/ui-common";

const STRENGTH_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({
  value,
  label: `Strength ≥ ${value}`,
}));

export function ProjectHintsSubtab({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const [search, setSearch] = useQueryState(
    "hintSearch",
    parseAsString.withDefault(""),
  );
  const [itemTypes, setItemTypes] = useQueryState(
    "hintTypes",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [minStrength, setMinStrength] = useQueryState(
    "hintMinStrength",
    parseAsFloat,
  );

  const { workItemTypes } = useWorkItemTypes(organizationId, { projectId });
  const typeLabels = useMemo(
    () =>
      new Map(
        workItemTypes.map(({ definition }) => [
          definition.key,
          definition.name,
        ]),
      ),
    [workItemTypes],
  );

  const { hints, matchingCount, totalCount, isLoading, error } =
    useAdminProjectHints(organizationId, projectId, {
      search,
      itemTypes,
      minStrength: minStrength ?? undefined,
    });

  const filters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: "Search hints and connected items",
      placeholder: "Search hint text or connected item titles",
    },
    {
      type: "multiselect",
      key: "itemTypes",
      label: "Connected item type",
      options: [...typeLabels].map(([value, label]) => ({ value, label })),
    },
    {
      type: "select",
      key: "minStrength",
      label: "Minimum strength",
      options: STRENGTH_OPTIONS,
    },
  ];
  const filterActive =
    search !== "" || itemTypes.length > 0 || minStrength !== null;

  const handleFilterChange = (key: string, value: unknown) => {
    if (key === "search") {
      void setSearch((value as string) || null);
    } else if (key === "itemTypes") {
      void setItemTypes(
        (value as string[]).length > 0 ? (value as string[]) : null,
      );
    } else if (key === "minStrength") {
      void setMinStrength(typeof value === "number" ? value : null);
    }
  };
  const clearFilters = () => {
    void setSearch(null);
    void setItemTypes(null);
    void setMinStrength(null);
  };

  return (
    <Stack spacing={3} sx={{ mt: 3 }} data-testid="project-admin-hints">
      <Typography variant="h6" component="h2">
        Hints
      </Typography>
      <EntityFilters
        filters={filters}
        values={{ search, itemTypes, minStrength: minStrength ?? "" }}
        onChange={handleFilterChange}
        layout="row"
        spacing={2}
      />
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="project-admin-hints-count"
          aria-live="polite"
        >
          {matchingCount} of {totalCount} hints
        </Typography>
        {filterActive && (
          <Button size="small" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </Stack>
      {isLoading ? (
        <CircularProgress size={24} aria-label="Loading hints" />
      ) : error ? (
        <Alert severity="error">
          Hints could not be loaded: {error.message}
        </Alert>
      ) : totalCount === 0 ? (
        <Typography color="text.secondary">
          This project has no live Hints.
        </Typography>
      ) : hints.length === 0 ? (
        <Typography color="text.secondary">
          No hints match these filters.
        </Typography>
      ) : (
        hints.map((hint) => (
          <Box key={hint.id} data-testid="project-admin-hint">
            <Typography sx={{ whiteSpace: "pre-wrap" }}>{hint.text}</Typography>
            <Stack component="ul" spacing={1} sx={{ pl: 3 }}>
              {hint.connections.map((connection) => {
                const { title } = connection;
                const typeLabel =
                  typeLabels.get(connection.itemType ?? "") ??
                  connection.itemType ??
                  connection.targetEntityType;
                return (
                  <Box
                    component="li"
                    key={connection.id}
                    data-testid="project-admin-hint-connection"
                  >
                    {title === undefined ? (
                      <Typography component="span" color="text.secondary">
                        Connected item unavailable
                      </Typography>
                    ) : (
                      <>
                        <Chip size="small" label={typeLabel} sx={{ mr: 1 }} />
                        {connection.targetEntityType === "HINT" ? (
                          <Typography component="span">{title}</Typography>
                        ) : (
                          <EntityLinkWithPreview
                            label={title}
                            entityId={connection.targetNodeId}
                            entityType={connection.targetEntityType.toLowerCase()}
                            organizationId={organizationId}
                            projectId={projectId}
                          />
                        )}
                      </>
                    )}
                    <Typography
                      component="span"
                      variant="body2"
                      color={title === undefined ? "text.secondary" : undefined}
                    >
                      {" "}
                      — strength {connection.strength}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </Box>
        ))
      )}
    </Stack>
  );
}
