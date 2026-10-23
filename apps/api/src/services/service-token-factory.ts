import type { OrganizationId, ProjectId } from '../types';

export type ServiceTokenFactory = (
  organizationId: OrganizationId,
  projectId: ProjectId,
) => string;

export const SERVICE_TOKEN_FACTORY = Symbol('SERVICE_TOKEN_FACTORY');
