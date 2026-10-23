import { useParams } from "react-router-dom";
import { useUserIdentity } from "./useUserIdentity";

export interface EditorContextData {
  organizationId: string;
  projectId: string;
}

/**
 * Hook that combines organizationId from useUserIdentity and projectId from URL params.
 * Falls back to localStorage when outside route context (e.g., in ActionsCapsule).
 * Returns null if neither source provides valid values.
 */
export const useProjectIds = (): EditorContextData | null => {
  const userIdentity = useUserIdentity();
  const { projectId: urlProjectId } = useParams<{ projectId: string }>();

  // Try to get projectId from URL first, then fall back to localStorage
  let projectId = urlProjectId;
  if (!projectId) {
    try {
      const stored = localStorage.getItem("last-project-id");
      if (stored) {
        projectId = stored;
      }
    } catch (err) {
      // localStorage might not be available in some environments
      console.debug("Could not access localStorage:", err);
    }
  }

  if (!userIdentity || !projectId) {
    return null;
  }

  return {
    organizationId: userIdentity.currentOrgId,
    projectId,
  };
};
