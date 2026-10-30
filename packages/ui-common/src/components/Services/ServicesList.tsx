import React from "react";
import type { ServiceDto } from "../../api";
import { usePathService } from "../../contexts";
import { EntityGrid, EntityListItem, serviceAdapter } from "../Entity";

export interface ServicesListProps {
  /**
   * Array of services to display
   */
  services: ServiceDto[];

  /**
   * Organization ID for path generation
   */
  organizationId: string;

  /**
   * Optional project ID for project-scoped services
   */
  projectId?: string;

  /**
   * Loading state
   */
  isLoading?: boolean;

  /**
   * Custom empty message
   */
  emptyMessage?: string;

  /**
   * Custom click handler
   */
  onServiceClick?: (service: ServiceDto) => void;

  /**
   * Delete handler (if delete functionality is supported)
   */
  onServiceDeleted?: (serviceId: string) => void;

  /**
   * Trailing per-row controls (e.g. lifecycle actions)
   */
  renderActions?: (service: ServiceDto) => React.ReactNode;
}

/**
 * ServicesList component - displays a list of services
 *
 * @example
 * ```typescript
 * const { services, isLoading } = useServices(organizationId, { projectId });
 *
 * <ServicesList
 *   services={services}
 *   organizationId={organizationId}
 *   projectId={projectId}
 *   isLoading={isLoading}
 * />
 * ```
 */
export const ServicesList: React.FC<ServicesListProps> = ({
  services,
  organizationId,
  projectId,
  isLoading = false,
  emptyMessage = "No services found",
  onServiceClick,
  onServiceDeleted,
  renderActions,
}) => {
  const pathService = usePathService();

  return (
    <EntityGrid
      items={services}
      loading={isLoading}
      renderItem={(service) => {
        const props = serviceAdapter.toEntityListItemProps(service, {
          organizationId,
          projectId,
          pathService,
        });

        // Custom click handler if provided
        const handleClick = onServiceClick
          ? (event: React.MouseEvent<HTMLElement>) => {
              if (!props.href) {
                event.preventDefault();
              }
              onServiceClick(service);
            }
          : undefined;

        // Delete handler if provided
        const handleDelete = onServiceDeleted
          ? () => {
              onServiceDeleted(service.id);
            }
          : undefined;

        return (
          <EntityListItem
            {...props}
            status={service.status === "ARCHIVED" ? "Archived" : undefined}
            onClick={handleClick}
            onDelete={handleDelete}
            actions={renderActions?.(service)}
          />
        );
      }}
      keyExtractor={(service) => service.id}
      emptyMessage={emptyMessage}
    />
  );
};
