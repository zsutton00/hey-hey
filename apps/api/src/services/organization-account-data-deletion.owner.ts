import type { OrganizationClosureExecution } from '@prisma/client';
import type { OrganizationId } from '../types';

export abstract class OrganizationAccountDataDeletionOwner {
  abstract execute(execution: OrganizationClosureExecution): Promise<void>;

  abstract executeAfterProjectionDeletion(
    execution: OrganizationClosureExecution,
  ): Promise<void>;

  abstract executeForOrganization(
    organizationId: OrganizationId,
  ): Promise<boolean>;
}
