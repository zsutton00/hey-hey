import { useMemo } from "react";
import { ProjectRole } from "../../api";
import { useProject } from "../../data/hooks/useProject";

export interface ProjectCapabilities {
  /** The server-reported role of the signed-in user, or null until known. */
  currentUserRole: ProjectRole | null;
  inviteToProject: boolean;
  removeMember: boolean;
  manageSettings: boolean;
  manageWorkItemTypes: boolean;
  deleteProject: boolean;
  viewProjectEmbeddings: boolean;
}

const OWNER_OR_ARCHITECT: readonly ProjectRole[] = [
  ProjectRole.Owner,
  ProjectRole.Architect,
];
const OWNER_ONLY: readonly ProjectRole[] = [ProjectRole.Owner];

const allows = (
  allowed: readonly ProjectRole[],
  role: ProjectRole | null
): boolean => role !== null && allowed.includes(role);

/**
 * Maps a project role to the administrative actions the Role Permissions
 * matrix allows it. Presentation only: the server enforces the same rules.
 */
export const projectCapabilitiesForRole = (
  role: ProjectRole | null
): ProjectCapabilities => ({
  currentUserRole: role,
  inviteToProject: allows(OWNER_OR_ARCHITECT, role),
  removeMember: allows(OWNER_ONLY, role),
  manageSettings: allows(OWNER_OR_ARCHITECT, role),
  manageWorkItemTypes: allows(OWNER_OR_ARCHITECT, role),
  deleteProject: allows(OWNER_ONLY, role),
  viewProjectEmbeddings: allows(OWNER_ONLY, role),
});

/**
 * Administrative capabilities of the signed-in user on a project, derived
 * from the server-reported `currentUserRole` of the project response. Every
 * capability is false until the project (and so the role) has loaded.
 */
export const useProjectCapabilities = (
  organizationId: string | undefined,
  projectId: string | undefined
): ProjectCapabilities => {
  const { data: project } = useProject(organizationId, projectId);
  const role = project?.currentUserRole ?? null;
  return useMemo(() => projectCapabilitiesForRole(role), [role]);
};
