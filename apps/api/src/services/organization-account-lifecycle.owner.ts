import type {
  OrganizationAccountLifecycleDto,
  OrganizationReactivationSuccess,
} from '../generated';
import type { OrganizationId, UserId } from '../types';

/**
 * Controller-facing boundary for organization account lifecycle mutations.
 *
 * The durable implementation is registered by the lifecycle snapshot layer;
 * HTTP handlers must not substitute OrganizationService administrative cleanup
 * methods for these scheduled lifecycle operations.
 */
export abstract class OrganizationAccountLifecycleOwner {
  abstract get(
    organizationId: OrganizationId,
    actorId: UserId,
  ): Promise<OrganizationAccountLifecycleDto>;

  abstract cancel(
    organizationId: OrganizationId,
    actorId: UserId,
  ): Promise<OrganizationAccountLifecycleDto>;

  abstract reactivate(
    organizationId: OrganizationId,
    actorId: UserId,
  ): Promise<OrganizationReactivationSuccess>;

  /** Materialize immutable closure evidence for a reached lifecycle snapshot. */
  abstract materializeReachedClosure(
    organizationId: OrganizationId,
    now?: Date,
  ): Promise<void>;
}
