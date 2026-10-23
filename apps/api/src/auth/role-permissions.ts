import { OrganizationRole, ProjectRole } from '@prisma/client';

type CapabilityRoles = {
  readonly project?: readonly ProjectRole[];
  readonly organization?: readonly OrganizationRole[];
};

/** The one place that decides which roles may perform an administrative action. */
export const ROLE_PERMISSIONS = {
  updateProject: { project: [ProjectRole.OWNER, ProjectRole.ARCHITECT] },
  deleteProject: { project: [ProjectRole.OWNER] },
  addProjectMember: { project: [ProjectRole.OWNER, ProjectRole.ARCHITECT] },
  removeProjectMember: { project: [ProjectRole.OWNER] },
  manageWorkItemTypes: { project: [ProjectRole.OWNER, ProjectRole.ARCHITECT] },
  viewProjectEmbeddings: { project: [ProjectRole.OWNER] },
  createProject: {
    organization: [OrganizationRole.OWNER, OrganizationRole.ADMIN],
  },
  updateOrganization: {
    organization: [OrganizationRole.OWNER, OrganizationRole.ADMIN],
  },
  inviteToOrganization: {
    organization: [OrganizationRole.OWNER, OrganizationRole.ADMIN],
  },
  removeOrganizationMember: {
    organization: [OrganizationRole.OWNER, OrganizationRole.ADMIN],
  },
} as const satisfies Record<string, CapabilityRoles>;

type RolePermissions = typeof ROLE_PERMISSIONS;

export type ProjectCapability = {
  [K in keyof RolePermissions]: RolePermissions[K] extends {
    project: readonly ProjectRole[];
  }
    ? K
    : never;
}[keyof RolePermissions];

export type OrganizationCapability = {
  [K in keyof RolePermissions]: RolePermissions[K] extends {
    organization: readonly OrganizationRole[];
  }
    ? K
    : never;
}[keyof RolePermissions];

export function projectRolesAllowing(
  capability: ProjectCapability,
): readonly ProjectRole[] {
  return ROLE_PERMISSIONS[capability].project;
}

export function organizationRolesAllowing(
  capability: OrganizationCapability,
): readonly OrganizationRole[] {
  return ROLE_PERMISSIONS[capability].organization;
}
