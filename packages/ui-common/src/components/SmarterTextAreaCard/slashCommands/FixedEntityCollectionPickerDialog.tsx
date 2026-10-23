import React, { useEffect, useMemo, useState } from "react";
import {
  EntityType,
  ServiceDtoStatusEnum,
  type DesignDocResponseDto,
  type ServiceDto,
} from "../../../api";
import { usePreviewHost } from "../../../contexts/PreviewHostContext";
import { useDesignDocs } from "../../../data/hooks/useDesignDocs";
import { useServices } from "../../../data/hooks/useServices";
import { createOpenItemEntity } from "../../../types/openItems";
import { designDocAdapter, serviceAdapter } from "../../Entity/adapters";
import { resolveEntityTypeConfig } from "../../InteractionComponent/entityTypeRegistry";
import type { EntityMention } from "../types";
import {
  EntityCollectionPickerDialog,
  type EntityCollectionPickerRow,
  type EntityCollectionPickerStatus,
  type EntityCollectionSort,
} from "./EntityCollectionPickerDialog";

const FIXED_ENTITY_PAGE_SIZE = 20;
const FIXED_ENTITY_SEARCH_DEBOUNCE_MS = 300;

const useDebouncedFilter = (filter: string): string => {
  const [debouncedFilter, setDebouncedFilter] = useState(filter);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedFilter(filter),
      FIXED_ENTITY_SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [filter]);
  return debouncedFilter;
};

export type FixedEntityCollectionTarget =
  | { kind: "service"; entityType: typeof EntityType.Service }
  | { kind: "design-doc"; entityType: typeof EntityType.DesignDoc };

type FixedEntitySource =
  | { kind: "service"; items: readonly ServiceDto[] }
  | { kind: "design-doc"; items: readonly DesignDocResponseDto[] };

interface FixedEntityDescriptor {
  entityId: string;
  entityType: "service" | "design_doc";
  entityName: string;
  createdAt: string | undefined;
  listItemProps: EntityCollectionPickerRow["listItemProps"];
}

interface PreparedEntityCollection {
  rows: EntityCollectionPickerRow[];
  totalPages: number;
  totalItems: number;
}

const compareNames = (
  left: FixedEntityDescriptor,
  right: FixedEntityDescriptor,
): number =>
  left.entityName.localeCompare(right.entityName) ||
  left.entityId.localeCompare(right.entityId);

const compareCreated = (
  left: FixedEntityDescriptor,
  right: FixedEntityDescriptor,
): number => {
  if (left.createdAt === undefined || right.createdAt === undefined) {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt === undefined ? 1 : -1;
    }
    return left.entityId.localeCompare(right.entityId);
  }
  return (
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
    left.entityId.localeCompare(right.entityId)
  );
};

const sortDescriptors = (
  descriptors: FixedEntityDescriptor[],
  sort: EntityCollectionSort,
): FixedEntityDescriptor[] =>
  descriptors.sort((left, right) => {
    switch (sort) {
      case "name-asc":
        return compareNames(left, right);
      case "name-desc":
        return -compareNames(left, right);
      case "created-asc":
        return compareCreated(left, right);
      case "created-desc":
        return -compareCreated(left, right);
    }
  });

const describeSource = (
  source: FixedEntitySource,
  organizationId: string,
  projectId: string,
): FixedEntityDescriptor[] => {
  switch (source.kind) {
    case "service":
      return source.items
        .filter((service) => service.status !== ServiceDtoStatusEnum.Archived)
        .map((service) => ({
          entityId: service.id,
          entityType: "service" as const,
          entityName: service.name,
          createdAt: service.createdAt,
          listItemProps: serviceAdapter.toEntityListItemProps(service, {
            organizationId,
            projectId,
            showEntityKind: true,
            presentation: "reference",
          }),
        }));
    case "design-doc":
      return source.items
        .filter((designDoc) => designDoc.status.toUpperCase() !== "ARCHIVED")
        .map((designDoc) => ({
          entityId: designDoc.id,
          entityType: "design_doc" as const,
          entityName: designDoc.name,
          createdAt: designDoc.createdAt,
          listItemProps: designDocAdapter.toEntityListItemProps(designDoc, {
            projectId,
            showEntityKind: true,
            presentation: "reference",
          }),
        }));
  }
};

export const prepareFixedEntityRows = (
  source: FixedEntitySource,
  options: {
    organizationId: string;
    projectId: string;
    filter: string;
    sort: EntityCollectionSort;
    page: number;
    pageSize: number;
  },
): PreparedEntityCollection => {
  const normalizedFilter = options.filter.trim().toLocaleLowerCase();
  const descriptors = describeSource(
    source,
    options.organizationId,
    options.projectId,
  );
  const filtered = normalizedFilter
    ? descriptors.filter((item) =>
        item.entityName.toLocaleLowerCase().includes(normalizedFilter),
      )
    : descriptors;
  const sorted = sortDescriptors(filtered, options.sort);
  const totalPages = Math.max(Math.ceil(sorted.length / options.pageSize), 1);
  const page = Math.min(options.page, totalPages);
  const start = (page - 1) * options.pageSize;
  return {
    rows: sorted.slice(start, start + options.pageSize),
    totalPages,
    totalItems: sorted.length,
  };
};

interface FixedEntityCollectionPickerDialogProps {
  organizationId: string;
  projectId: string;
  target: FixedEntityCollectionTarget;
  onClose: () => void;
  onSelect: (mention: EntityMention) => void;
}

const targetCopy = (target: FixedEntityCollectionTarget) => {
  switch (target.kind) {
    case "service":
      return {
        title: "Choose a service",
        searchLabel: "Search services",
        errorMessage: "Unable to load services.",
      };
    case "design-doc":
      return {
        title: "Choose a design doc",
        searchLabel: "Search design docs",
        errorMessage: "Unable to load design docs.",
      };
  }
};

export const FixedEntityCollectionPickerDialog: React.FC<
  FixedEntityCollectionPickerDialogProps
> = ({ organizationId, projectId, target, onClose, onSelect }) => {
  const previewHost = usePreviewHost();
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedFilter(filter);
  const [sort, setSort] = useState<EntityCollectionSort>("name-asc");
  const [page, setPage] = useState(1);
  const services = useServices(organizationId, {
    projectId,
    enabled: target.kind === "service",
  });
  const designDocs = useDesignDocs(organizationId, {
    projectId,
    enabled: target.kind === "design-doc",
  });

  const source: FixedEntitySource =
    target.kind === "service"
      ? { kind: "service", items: services.services }
      : { kind: "design-doc", items: designDocs.designDocs };
  const activeState =
    target.kind === "service"
      ? {
          isLoading: services.isLoading,
          isFetching: services.isFetching,
          error: services.error,
        }
      : {
          isLoading: designDocs.isLoading,
          isFetching: designDocs.isFetching,
          error: designDocs.error,
        };
  const prepared = useMemo(
    () =>
      prepareFixedEntityRows(source, {
        organizationId,
        projectId,
        filter: debouncedFilter,
        sort,
        page,
        pageSize: FIXED_ENTITY_PAGE_SIZE,
      }),
    [source, organizationId, projectId, debouncedFilter, sort, page],
  );
  const status: EntityCollectionPickerStatus = activeState.error
    ? "error"
    : activeState.isLoading
      ? "loading"
      : prepared.totalItems === 0
        ? "empty"
        : activeState.isFetching
          ? "updating"
          : "ready";
  const copy = targetCopy(target);
  const previewCapability = resolveEntityTypeConfig(
    target.entityType,
  )?.previewCapability;
  const canPreview = previewCapability?.kind === "supported";

  return (
    <EntityCollectionPickerDialog
      testIdPrefix="slash-fixed-entity"
      organizationId={organizationId}
      projectId={projectId}
      {...copy}
      rows={prepared.rows}
      status={status}
      filter={filter}
      sort={sort}
      page={Math.min(page, prepared.totalPages)}
      totalPages={prepared.totalPages}
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
      onSelect={(row) =>
        onSelect({
          entityType: row.entityType,
          entityId: row.entityId,
          entityName: row.entityName,
        })
      }
      onPreview={
        canPreview && previewCapability.kind === "supported"
          ? (row) =>
              previewHost.openPreview(
                createOpenItemEntity(
                  previewCapability.entityType,
                  row.entityId,
                ),
              )
          : undefined
      }
    />
  );
};
