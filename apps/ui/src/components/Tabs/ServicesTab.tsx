import {
  useModalState,
  ModalWorkOwner,
} from "@hey-hey/ui-common/components/Modals";
import { Box, Button, Stack } from "@mui/material";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServices } from "@hey-hey/ui-common/data";
import {
  EntityFilters,
  EntityGrid,
  EntityListItem,
  serviceAdapter,
} from "@hey-hey/ui-common/components";
import type { FilterConfig } from "@hey-hey/ui-common/components";
import { TabContainer } from "./TabContainer";
import { CardHeader } from "../CardHeader";
import { CreateServiceModal } from "../CreateServiceModal";

export interface ServicesTabProps {
  organizationId: string;
  projectId: string;
  enableFilters?: boolean;
  emptyMessage?: string;
}

export const ServicesTab: React.FC<ServicesTabProps> = ({
  organizationId,
  projectId,
  enableFilters = false,
  emptyMessage = "No services found",
}) => {
  const { t } = useTranslation();
  const { services, isLoading } = useServices(organizationId, {
    projectId,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("created-desc");
  const [createOpen, setCreateOpen, createOpenOwnerKey] = useModalState(false);

  // Define filter configurations
  const filters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: t("services.filters.searchPlaceholder", "Search services..."),
      placeholder: t(
        "services.filters.searchPlaceholder",
        "Search services...",
      ),
    },
  ];

  // Define sort options
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

  // Map filter values
  const filterValues = {
    search: searchTerm,
  };

  // Handle filter changes
  const handleFilterChange = (key: string, value: unknown): void => {
    if (key === "search") {
      setSearchTerm(value as string);
    }
  };

  // Filter and sort services
  const filteredAndSortedServices = useMemo(() => {
    let filtered = [...services];

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter((service) => {
        const name = service.name?.toLowerCase() || "";
        const description = service.description?.toLowerCase() || "";
        return name.includes(searchLower) || description.includes(searchLower);
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "created-asc": {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return aTime - bTime;
        }
        case "created-desc": {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return bTime - aTime;
        }
        case "name-asc": {
          const aName = a.name || "";
          const bName = b.name || "";
          return aName.localeCompare(bName);
        }
        case "name-desc": {
          const aName = a.name || "";
          const bName = b.name || "";
          return bName.localeCompare(aName);
        }
        default: {
          // Default to created-desc (newest first)
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return bTime - aTime;
        }
      }
    });

    return filtered;
  }, [services, searchTerm, sortBy]);

  return (
    <TabContainer>
      <Stack spacing={3}>
        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <CardHeader title="Services" />
          <Button
            variant="contained"
            size="small"
            onClick={() => setCreateOpen(true)}
          >
            {t("services.createService", "Create Service")}
          </Button>
        </Box>

        <ModalWorkOwner.Provider value={createOpenOwnerKey}>
          <CreateServiceModal
            open={createOpen}
            organizationId={organizationId}
            projectId={projectId}
            onClose={() => setCreateOpen(false)}
          />
        </ModalWorkOwner.Provider>

        {/* Filters */}
        {enableFilters && (
          <EntityFilters
            filters={filters}
            values={filterValues}
            onChange={handleFilterChange}
            sortOptions={sortOptions}
            sortBy={sortBy}
            onSortChange={setSortBy}
            layout="row"
            spacing={2}
          />
        )}

        {/* Services Grid */}
        <EntityGrid
          items={filteredAndSortedServices}
          loading={isLoading}
          renderItem={(service) => {
            const props = serviceAdapter.toEntityListItemProps(service, {
              projectId,
            });
            return <EntityListItem {...props} />;
          }}
          keyExtractor={(service) => service.id}
          emptyMessage={emptyMessage}
        />
      </Stack>
    </TabContainer>
  );
};
