import {
  Checkbox,
  Button,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import React, { useEffect, useState } from "react";
import {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  type WorkStatus,
  type WorkItemReferenceDto,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeEffectiveSource,
} from "../../../api";
import { usePreviewHost } from "../../../contexts/PreviewHostContext";
import { useWorkItemReferencePage } from "../../../data/hooks/useWorkItemReferences";
import { createOpenItemEntity } from "../../../types/openItems";
import { getStatusLabel } from "../../../utils/statusUtils";
import { workItemReferenceAdapter } from "../../Entity/adapters";
import {
  EntityCollectionPickerDialog,
  type EntityCollectionPickerRow,
  type EntityCollectionSort,
} from "./EntityCollectionPickerDialog";

const WORK_ITEM_REFERENCE_SEARCH_DEBOUNCE_MS = 300;

const resolveSort = (sort: EntityCollectionSort) => {
  switch (sort) {
    case "name-asc":
      return {
        sortBy:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.Name,
        sortOrder:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Asc,
      } as const;
    case "name-desc":
      return {
        sortBy:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.Name,
        sortOrder:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Desc,
      } as const;
    case "created-desc":
      return {
        sortBy:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.CreatedAt,
        sortOrder:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Desc,
      } as const;
    case "created-asc":
      return {
        sortBy:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.CreatedAt,
        sortOrder:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Asc,
      } as const;
  }
};

const useDebouncedValue = (value: string): string => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedValue(value),
      WORK_ITEM_REFERENCE_SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [value]);
  return debouncedValue;
};

interface WorkItemReferencePickerDialogProps {
  organizationId: string;
  projectId: string;
  definition: WorkItemTypeDefinitionDto;
  effectiveSource?: WorkItemTypeEffectiveSource;
  onClose: () => void;
  onSelect: (reference: WorkItemReferenceDto) => void;
  onCreate?: () => void;
}

export const WorkItemReferencePickerDialog: React.FC<
  WorkItemReferencePickerDialogProps
> = ({
  organizationId,
  projectId,
  definition,
  effectiveSource,
  onClose,
  onSelect,
  onCreate,
}) => {
  const previewHost = usePreviewHost();
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter);
  const [statuses, setStatuses] = useState<WorkStatus[]>([]);
  const [sort, setSort] = useState<EntityCollectionSort>("name-asc");
  const [page, setPage] = useState(1);
  const referenceState = useWorkItemReferencePage({
    organizationId,
    projectId,
    workItemType: definition.key,
    page,
    filter: debouncedFilter,
    statuses,
    ...resolveSort(sort),
  });
  const responsePage = referenceState.page;
  const references = responsePage?.items ?? [];
  const rows: EntityCollectionPickerRow[] = references.map((reference) => ({
    entityId: reference.id,
    entityType: reference.type,
    entityName: reference.name,
    listItemProps: workItemReferenceAdapter.toEntityListItemProps(reference, {
      projectId,
      showEntityKind: true,
      workItemTypeDefinition: definition,
      workItemTypeEffectiveSource: effectiveSource,
      presentation: "reference",
    }),
  }));

  const handleStatusChange = (event: SelectChangeEvent<WorkStatus[]>): void => {
    const value = event.target.value;
    const nextStatuses = typeof value === "string" ? value.split(",") : value;
    setStatuses(
      nextStatuses.flatMap((candidate) => {
        const match = definition.allowedStatuses.find(
          (allowedStatus) => allowedStatus === candidate,
        );
        return match ? [match] : [];
      }),
    );
    setPage(1);
  };

  return (
    <EntityCollectionPickerDialog
      testIdPrefix="work-item-reference"
      dialogTestId="slash-work-item-reference-picker"
      organizationId={organizationId}
      projectId={projectId}
      title={`Choose ${definition.name}`}
      titleAction={
        onCreate ? (
          <Button onClick={onCreate}>Create {definition.name}</Button>
        ) : undefined
      }
      searchLabel={`Search ${definition.name}`}
      errorMessage={`Unable to load ${definition.name.toLowerCase()} references.`}
      updatingLabel="Updating work-item references"
      rows={rows}
      status={
        referenceState.status === "disabled" ? "loading" : referenceState.status
      }
      filter={filter}
      sort={sort}
      page={responsePage?.pagination.page ?? page}
      totalPages={Math.max(responsePage?.pagination.totalPages ?? 0, 1)}
      additionalFilters={
        <FormControl fullWidth>
          <InputLabel id="work-item-reference-status-label">Status</InputLabel>
          <Select<WorkStatus[]>
            multiple
            labelId="work-item-reference-status-label"
            label="Status"
            value={statuses}
            onChange={handleStatusChange}
            renderValue={(selected) =>
              selected.map((status) => getStatusLabel(status)).join(", ")
            }
            inputProps={{ "data-testid": "work-item-reference-status-filter" }}
          >
            {definition.allowedStatuses.map((status) => (
              <MenuItem key={status} value={status}>
                <Checkbox checked={statuses.includes(status)} />
                <ListItemText primary={getStatusLabel(status)} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      }
      onFilterChange={(nextFilter) => {
        setFilter(nextFilter);
        setPage(1);
      }}
      onSortChange={(nextSort) => {
        setSort(nextSort);
        setPage(1);
      }}
      onPageChange={setPage}
      onClose={onClose}
      onSelect={(row) => {
        const reference = references.find((item) => item.id === row.entityId);
        if (reference) onSelect(reference);
      }}
      onPreview={(row) =>
        previewHost.openPreview(createOpenItemEntity("task", row.entityId))
      }
    />
  );
};
