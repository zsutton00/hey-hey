import { useMemo } from "react";
import { useRole } from "./useRole";
import type { OrganizationRole } from "../../api";

export interface Permission {
  name: string;
  description: string;
  requiredRole?: OrganizationRole;
}

export interface Permissions {
  // Playground permissions
  accessPlayground: boolean;
  viewDragDropExamples: boolean;
  exportPlaygroundConfigs: boolean;

  // Organization management
  manageOrganization: boolean;
  inviteMembers: boolean;
  removeMembers: boolean;
  changeUserRoles: boolean;

  // Project management
  createProjects: boolean;
  deleteProjects: boolean;
  manageProjectSettings: boolean;

  // Utilities
  hasPermission: (permission: string) => boolean;
  getPermissionInfo: (permission: string) => Permission | undefined;
}

// Define permission rules
const PERMISSION_DEFINITIONS: Record<string, Permission> = {
  // Playground permissions
  accessPlayground: {
    name: "accessPlayground",
    description:
      "Access to the Playground tab for testing drag & drop components",
    requiredRole: "OWNER",
  },
  viewDragDropExamples: {
    name: "viewDragDropExamples",
    description: "View and interact with drag & drop examples in playground",
    requiredRole: "OWNER",
  },
  exportPlaygroundConfigs: {
    name: "exportPlaygroundConfigs",
    description: "Export playground configurations and settings",
    requiredRole: "OWNER",
  },

  // Organization management
  manageOrganization: {
    name: "manageOrganization",
    description: "Manage organization settings and configuration",
    requiredRole: "OWNER",
  },
  inviteMembers: {
    name: "inviteMembers",
    description: "Invite new members to the organization",
    requiredRole: "ADMIN",
  },
  removeMembers: {
    name: "removeMembers",
    description: "Remove members from the organization",
    requiredRole: "ADMIN",
  },
  changeUserRoles: {
    name: "changeUserRoles",
    description: "Change user roles within the organization",
    requiredRole: "OWNER",
  },

  // Project management
  createProjects: {
    name: "createProjects",
    description: "Create new projects",
    requiredRole: "ADMIN",
  },
  deleteProjects: {
    name: "deleteProjects",
    description: "Delete existing projects",
    requiredRole: "ADMIN",
  },
  manageProjectSettings: {
    name: "manageProjectSettings",
    description: "Manage project settings and configuration",
    requiredRole: "ADMIN",
  },
};

/**
 * Hook for managing granular permissions based on user roles and authentication status.
 */
export const usePermissions = (): Permissions => {
  const { isAuthenticated, hasOrganizationRole } = useRole();

  return useMemo<Permissions>(() => {
    const checkPermission = (permissionName: string): boolean => {
      if (!isAuthenticated) return false;

      const permission = PERMISSION_DEFINITIONS[permissionName];
      if (!permission) return false;

      // Check organization role requirements
      if (permission.requiredRole) {
        return hasOrganizationRole(permission.requiredRole);
      }

      return true;
    };

    const hasPermission = (permission: string): boolean => {
      return checkPermission(permission);
    };

    const getPermissionInfo = (permission: string): Permission | undefined => {
      return PERMISSION_DEFINITIONS[permission];
    };

    return {
      // Playground permissions
      accessPlayground: checkPermission("accessPlayground"),
      viewDragDropExamples: checkPermission("viewDragDropExamples"),
      exportPlaygroundConfigs: checkPermission("exportPlaygroundConfigs"),

      // Organization management
      manageOrganization: checkPermission("manageOrganization"),
      inviteMembers: checkPermission("inviteMembers"),
      removeMembers: checkPermission("removeMembers"),
      changeUserRoles: checkPermission("changeUserRoles"),

      // Project management
      createProjects: checkPermission("createProjects"),
      deleteProjects: checkPermission("deleteProjects"),
      manageProjectSettings: checkPermission("manageProjectSettings"),

      // Utilities
      hasPermission,
      getPermissionInfo,
    };
  }, [isAuthenticated, hasOrganizationRole]);
};
