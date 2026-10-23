/**
 * Codebase Context Hook
 *
 * Provides context about the current codebase for intelligent initiative suggestions
 */

import { useState, useEffect } from "react";

export interface CodebaseContext {
  packageJson?: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
    name: string;
    version: string;
  };
  existingFiles: string[];
  integrations: {
    github: boolean;
    slack: boolean;
    jira: boolean;
  };
  techStack: {
    frontend: string[];
    backend: string[];
    database: string[];
    infrastructure: string[];
  };
  patterns: {
    authenticationMethod?: "jwt" | "oauth" | "session";
    stateManagement?: "redux" | "context" | "zustand";
    testingFramework?: "jest" | "vitest" | "cypress";
    styling?: "mui" | "tailwind" | "styled-components";
  };
}

export interface UseCodebaseContextReturn {
  context: CodebaseContext | null;
  isLoading: boolean;
  error: string | null;
  refreshContext: () => Promise<void>;
}

/**
 * Hook to get codebase context for intelligent initiative creation
 */
export function useCodebaseContext(
  projectId?: string
): UseCodebaseContextReturn {
  const [context, setContext] = useState<CodebaseContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeCodebase = async (): Promise<CodebaseContext> => {
    // For Phase 1, return mock data based on the current project structure
    // In Phase 2, this would integrate with actual file system analysis

    return {
      packageJson: {
        name: "hey-hey-ui",
        version: "0.0.0",
        dependencies: {
          react: "^18.0.0",
          "@mui/material": "^5.0.0",
          typescript: "^5.0.0",
          "@tanstack/react-query": "^4.0.0",
          "react-i18next": "^12.0.0",
          motion: "^10.0.0",
        },
        devDependencies: {
          vite: "^4.0.0",
          "@types/react": "^18.0.0",
          eslint: "^8.0.0",
        },
        scripts: {
          dev: "vite",
          build: "vite build",
          "type-check": "tsc -b",
          lint: "eslint",
        },
      },
      existingFiles: [
        "src/components/LlmForms/",
        "src/components/Conversation/",
        "src/services/authService.ts",
        "src/hooks/useConversationData.ts",
        "src/api/",
        "src/i18n/",
      ],
      integrations: {
        github: true,
        slack: false,
        jira: false,
      },
      techStack: {
        frontend: ["React", "TypeScript", "MUI", "Vite"],
        backend: ["Node.js", "Express", "TypeScript"],
        database: ["PostgreSQL"],
        infrastructure: ["Docker"],
      },
      patterns: {
        authenticationMethod: "jwt",
        stateManagement: "context",
        testingFramework: "jest",
        styling: "mui",
      },
    };
  };

  const refreshContext = async (): Promise<void> => {
    if (!projectId) {
      setContext(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newContext = await analyzeCodebase();
      setContext(newContext);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to analyze codebase";
      setError(errorMessage);
      console.error("Failed to get codebase context:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshContext();
  }, [projectId]);

  return {
    context,
    isLoading,
    error,
    refreshContext,
  };
}

/**
 * Helper function to extract tech stack suggestions from codebase context
 */
export function getTechStackSuggestions(context: CodebaseContext | null): {
  suggestions: string[];
  conflicts: string[];
} {
  if (!context) {
    return { suggestions: [], conflicts: [] };
  }

  const suggestions: string[] = [];
  const conflicts: string[] = [];

  // Analyze existing patterns and suggest compatible technologies
  if (context.patterns.styling === "mui") {
    suggestions.push("Use Material-UI components for consistency");
  }

  if (context.patterns.stateManagement === "context") {
    suggestions.push("Leverage React Context for state management");
  }

  if (context.patterns.authenticationMethod === "jwt") {
    suggestions.push("Implement JWT-based authentication");
  }

  // Check for potential conflicts
  if (
    context.packageJson?.dependencies.react &&
    context.techStack.frontend.includes("Vue")
  ) {
    conflicts.push("React and Vue.js detected - choose one framework");
  }

  return { suggestions, conflicts };
}

/**
 * Helper function to get integration suggestions based on codebase context
 */
export function getIntegrationSuggestions(
  context: CodebaseContext | null
): string[] {
  if (!context) return [];

  const suggestions: string[] = [];

  if (context.integrations.github) {
    suggestions.push("Integrate with existing GitHub workflows");
    suggestions.push("Use GitHub Actions for CI/CD");
  }

  if (context.packageJson?.dependencies["@tanstack/react-query"]) {
    suggestions.push("Use React Query for API state management");
  }

  if (context.packageJson?.dependencies["react-i18next"]) {
    suggestions.push("Add internationalization support");
  }

  return suggestions;
}
