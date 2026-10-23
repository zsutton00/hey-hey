import { useLocation, useParams } from "react-router-dom";

/**
 * Hook to get the active project ID from the current route.
 *
 * This hook works in two ways:
 * 1. First tries to get projectId from route params (for components within routes)
 * 2. Falls back to parsing the URL pathname (for components outside route hierarchy)
 *
 * @returns The project ID if found in the current route, undefined otherwise
 */
export function useActiveProjectId(): string | undefined {
  // Try to get projectId from route params first (works for components within routes)
  const { projectId: paramsProjectId } = useParams<{ projectId: string }>();

  // Get current location to parse pathname
  const location = useLocation();

  // If we have projectId from params, return it
  if (paramsProjectId) {
    return paramsProjectId;
  }

  // Otherwise, parse the pathname to extract projectId
  // Expected patterns: /projects/:projectId/... or /projects/:projectId
  const pathMatch = location.pathname.match(/\/projects\/([^/]+)/);

  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }

  // No projectId found
  return undefined;
}
