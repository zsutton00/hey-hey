import { OrganizationRole } from '@hey-hey/contracts/api/models';
import { OrganizationId, ProjectId } from 'src/types';

export interface ContextAuthMembership {
  orgId: OrganizationId;
  role: OrganizationRole;
}

export interface ContextAuthContext {
  sub: string;
  scopes?: string[];
  orgMemberships?: ContextAuthMembership[];
  currentOrgId?: OrganizationId;
  projectIds?: ProjectId[];
  isDevAdmin?: boolean;
}
