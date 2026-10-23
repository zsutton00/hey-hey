import type { ImplementationHintDto } from "@hey-hey/ui-common/api";
import type { FilterConfig } from "@hey-hey/ui-common/components";
import {
  EntityFilters,
  ImplementationHintEditor,
  ImplementationHintReadView,
  ImplementationHintsList,
} from "@hey-hey/ui-common/components";
import { useImplementationHints } from "@hey-hey/ui-common/data";
import { KEYS } from "@hey-hey/ui-common/i18n";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseAsString, useQueryState } from "nuqs";
import { CardHeader } from "../CardHeader";
import { TabContainer } from "./TabContainer";

interface ImplementationHintsTabProps {
  organizationId: string;
  projectId?: string;
  serviceId?: string;
  agentSessionId?: string;
  emptyMessage?: string;
  enableFilters?: boolean;
  enabled?: boolean;
}

interface ImplementationHintsListSectionProps {
  organizationId: string;
  serviceId?: string;
  enableFilters: boolean;
  filters: FilterConfig[];
  filterValues: Record<string, string>;
  sortOptions: { value: string; label: string }[];
  sortBy: string;
  isLoading: boolean;
  searchTerm: string;
  emptyMessage: string;
  error?: string | null;
  hints: ImplementationHintDto[];
  onFilterChange: (key: string, value: unknown) => void;
  onSortChange: (value: string) => void;
  onHintClick: (hint: ImplementationHintDto) => void;
}

interface SelectedHintSectionProps {
  hint: ImplementationHintDto | null;
  emptyMessage: string;
}

interface HintEditorSectionProps {
  hint: ImplementationHintDto | null;
  serviceId?: string;
  organizationId: string;
  onSuccess: (hint: ImplementationHintDto) => void;
}

const sortHints = (
  hints: ImplementationHintDto[],
  sortBy: string,
): ImplementationHintDto[] => {
  const sorted = [...hints];

  sorted.sort((a, b) => {
    switch (sortBy) {
      case "created-asc":
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      case "created-desc":
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      case "name-asc":
        return a.featureName.localeCompare(b.featureName);
      case "name-desc":
        return b.featureName.localeCompare(a.featureName);
      default:
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }
  });

  return sorted;
};

const filterHints = (
  hints: ImplementationHintDto[],
  searchTerm: string,
): ImplementationHintDto[] => {
  if (!searchTerm.trim()) {
    return hints;
  }

  const normalizedSearch = searchTerm.toLowerCase();

  return hints.filter((hint) => {
    const featureMatch = hint.featureName
      ?.toLowerCase()
      .includes(normalizedSearch);
    const descriptionMatch = hint.description
      ?.toLowerCase()
      .includes(normalizedSearch);
    return featureMatch || descriptionMatch;
  });
};

const ImplementationHintsListSection: React.FC<
  ImplementationHintsListSectionProps
> = ({
  organizationId,
  serviceId,
  enableFilters,
  filters,
  filterValues,
  sortOptions,
  sortBy,
  isLoading,
  searchTerm,
  emptyMessage,
  error,
  hints,
  onFilterChange,
  onSortChange,
  onHintClick,
}) => {
  const resolvedServiceId = serviceId ?? hints[0]?.serviceId ?? "";

  return (
    <>
      {enableFilters && (
        <EntityFilters
          filters={filters}
          values={filterValues}
          onChange={onFilterChange}
          sortOptions={sortOptions}
          sortBy={sortBy}
          onSortChange={onSortChange}
          layout="row"
          spacing={2}
        />
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <ImplementationHintsList
        organizationId={organizationId}
        serviceId={resolvedServiceId}
        hints={hints}
        isLoading={isLoading}
        searchTerm={searchTerm}
        emptyMessage={emptyMessage}
        onHintClick={onHintClick}
      />
    </>
  );
};

const SelectedHintSection: React.FC<SelectedHintSectionProps> = ({
  hint,
  emptyMessage,
}) => {
  if (!hint) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyMessage}
      </Typography>
    );
  }

  return <ImplementationHintReadView hint={hint} />;
};

const HintEditorSection: React.FC<HintEditorSectionProps> = ({
  hint,
  serviceId,
  organizationId,
  onSuccess,
}) => {
  if (!serviceId || !hint) {
    return null;
  }

  return (
    <ImplementationHintEditor
      hint={hint}
      serviceId={serviceId}
      organizationId={organizationId}
      onSuccess={onSuccess}
    />
  );
};

export const ImplementationHintsTab: React.FC<ImplementationHintsTabProps> = ({
  organizationId,
  serviceId,
  agentSessionId,
  emptyMessage,
  enableFilters = false,
  enabled = true,
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("created-desc");
  const [selectedHintId, setSelectedHintId] = useQueryState(
    "hintId",
    parseAsString,
  );
  const [, setIsCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "read" | "edit">(
    selectedHintId ? "read" : "list",
  );

  const { hints, isLoading, isFetched, error } = useImplementationHints(
    organizationId,
    serviceId,
    {
      agentSessionId,
      enabled,
    },
  );

  const filteredHints = useMemo(() => {
    const searchedHints = filterHints(hints, searchTerm);
    return sortHints(searchedHints, sortBy);
  }, [hints, searchTerm, sortBy]);

  const selectedHint = useMemo(
    () => hints.find((hint) => hint.id === selectedHintId) || null,
    [hints, selectedHintId],
  );

  useEffect(() => {
    if (!selectedHintId || !isFetched) {
      return;
    }

    if (hints.some((hint) => hint.id === selectedHintId)) {
      setViewMode("read");
    } else {
      void setSelectedHintId(null);
      setViewMode("list");
    }
  }, [hints, isFetched, selectedHintId, setSelectedHintId]);

  const defaultEmptyMessage = agentSessionId
    ? t(
        "implementationHints.emptySession",
        "No implementation hints linked to this coding session yet.",
      )
    : t(
        "implementationHints.empty",
        "No implementation hints available yet.",
      );

  const filters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: t(
        "implementationHints.filters.search",
        "Search implementation hints...",
      ),
      placeholder: t(
        "implementationHints.filters.search",
        "Search implementation hints...",
      ),
    },
  ];

  const sortOptions = [
    {
      value: "created-desc",
      label: t("common.sortCreatedDesc", "Newest first"),
    },
    {
      value: "created-asc",
      label: t("common.sortCreatedAsc", "Oldest first"),
    },
    {
      value: "name-asc",
      label: t("common.sortNameAsc", "Name (A-Z)"),
    },
    {
      value: "name-desc",
      label: t("common.sortNameDesc", "Name (Z-A)"),
    },
  ];

  const filterValues = { search: searchTerm };

  const handleFilterChange = (key: string, value: unknown): void => {
    if (key === "search") {
      setSearchTerm(value as string);
    }
  };

  const handleHintClick = useCallback(
    (hint: ImplementationHintDto) => {
      void setSelectedHintId(hint.id);
      setViewMode("read");
    },
    [setSelectedHintId],
  );

  const handleEditSuccess = useCallback(
    (hint: ImplementationHintDto) => {
      void setSelectedHintId(hint.id);
      setViewMode("read");
    },
    [setSelectedHintId],
  );

  const selectedHintMessage = t(
    "implementationHints.selectHint",
    "Select an implementation hint to view and edit details.",
  );

  return (
    <TabContainer>
      <Stack spacing={3}>
        {viewMode === "list" && (
          <>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <CardHeader
                title={t("implementationHints.title", "Implementation Hints")}
              />
              {serviceId && (
                <Button
                  variant="contained"
                  onClick={() => setIsCreateOpen(true)}
                >
                  {t("implementationHints.create", "New hint")}
                </Button>
              )}
            </Box>
            <ImplementationHintsListSection
              organizationId={organizationId}
              serviceId={serviceId}
              enableFilters={enableFilters}
              filters={filters}
              filterValues={filterValues}
              sortOptions={sortOptions}
              sortBy={sortBy}
              onSortChange={setSortBy}
              isLoading={isLoading}
              searchTerm={searchTerm}
              emptyMessage={emptyMessage || defaultEmptyMessage}
              error={error}
              hints={filteredHints}
              onFilterChange={handleFilterChange}
              onHintClick={handleHintClick}
            />
          </>
        )}

        {viewMode === "read" && (
          <Stack spacing={2}>
            <Box display="flex" justifyContent="space-between" gap={2}>
              <Button
                variant="text"
                onClick={() => {
                  void setSelectedHintId(null);
                  setViewMode("list");
                }}
              >
                {t(KEYS.common.back)}
              </Button>
              {serviceId && selectedHint && (
                <Button variant="contained" onClick={() => setViewMode("edit")}>
                  {t("common.edit", "Edit")}
                </Button>
              )}
            </Box>
            <SelectedHintSection
              hint={selectedHint}
              emptyMessage={selectedHintMessage}
            />
          </Stack>
        )}

        {viewMode === "edit" && (
          <Stack spacing={2}>
            <Box display="flex" justifyContent="space-between" gap={2}>
              <Button variant="text" onClick={() => setViewMode("read")}>
                {t(KEYS.common.back)}
              </Button>
            </Box>

            <HintEditorSection
              hint={selectedHint}
              serviceId={serviceId}
              organizationId={organizationId}
              onSuccess={handleEditSuccess}
            />
          </Stack>
        )}
      </Stack>
    </TabContainer>
  );
};
