import { createContext, useContext } from "react";

export interface ProjectContextValue {
  organizationId: string;
  projectId: string;
  navigate: (url: string) => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

/**
 * Returns the current project context (organizationId, projectId, navigate).
 * Must be used within a ProjectContext.Provider set up by the consuming app.
 */
export const useProjectContext = (): ProjectContextValue | null => {
  return useContext(ProjectContext);
};

/**
 * Strict version — throws if no ProjectContext is available.
 * Use in components that must be rendered within a project scope.
 */
export const useRequiredProjectContext = (): ProjectContextValue => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error(
      "useRequiredProjectContext must be used within a ProjectContext.Provider"
    );
  }
  return context;
};
