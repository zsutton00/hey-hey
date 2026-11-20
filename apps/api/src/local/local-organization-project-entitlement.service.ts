import { Injectable } from '@nestjs/common';
import { OrganizationProjectEntitlementDto } from '@hey-hey/contracts/api/models';
import { AnyTransactionClient } from '../prisma/prisma.service';
import { OrganizationId } from '../types';
import {
  DEFAULT_PROJECT_LIMIT,
  OrganizationProjectEntitlementService,
} from '../services/organization-project-entitlement.service';

/**
 * Local installations have no project limit. Any stored override is ignored,
 * so existing installs that hit the hosted default keep working. Usage is
 * still recorded. Selected only when the process is a local application.
 */
@Injectable()
export class LocalOrganizationProjectEntitlementService extends OrganizationProjectEntitlementService {
  override async resolve(
    organizationId: OrganizationId,
    tx: AnyTransactionClient = this.prisma.db,
    options: { lockForProjectCreation?: boolean } = {},
  ): Promise<OrganizationProjectEntitlementDto> {
    const { usage } = await this.readAndRecordUsage(
      organizationId,
      tx,
      options,
    );

    return {
      defaultProjectLimit: DEFAULT_PROJECT_LIMIT,
      projectLimitOverride: null,
      projectLimit: null,
      usage,
      canCreateProject: true,
      creationUnavailableReason: null,
    } satisfies OrganizationProjectEntitlementDto;
  }
}
