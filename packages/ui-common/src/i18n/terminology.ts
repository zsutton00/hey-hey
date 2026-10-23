/**
 * Centralized terminology system for composable i18n strings
 *
 * This module defines all core business terms used throughout the application.
 * Change terminology in one place to update it everywhere.
 *
 * Usage:
 * - Import TERMINOLOGY to access term definitions
 * - Use with composition functions to build dynamic strings
 * - Switch terminology themes by changing the active configuration
 */

// Base terminology interface - defines the structure for all term sets
export interface TerminologySet {
  // Core business entities
  initiative: {
    singular: string;
    plural: string;
    article: string; // "an" or "a"
  };
  task: {
    singular: string;
    plural: string;
    article: string;
  };
  project: {
    singular: string;
    plural: string;
    article: string;
  };
  artifact: {
    singular: string;
    plural: string;
    article: string;
  };
  integration: {
    singular: string;
    plural: string;
    article: string;
  };
  assistant: {
    singular: string;
    plural: string;
    article: string;
  };
  feature: {
    singular: string;
    plural: string;
    article: string;
  };
  plan: {
    singular: string;
    plural: string;
    article: string;
  };
  conversation: {
    singular: string;
    plural: string;
    article: string;
  };
  agentSession: {
    singular: string;
    plural: string;
    article: string;
  };

  // Actions and operations
  actions: {
    create: string;
    edit: string;
    delete: string;
    view: string;
    manage: string;
  };

  // Status and states
  status: {
    active: string;
    inactive: string;
    completed: string;
    inProgress: string;
    planning: string;
  };
}

// Default terminology - current system terms
export const DEFAULT_TERMINOLOGY: TerminologySet = {
  initiative: {
    singular: "initiative",
    plural: "initiatives",
    article: "an",
  },
  task: {
    singular: "task",
    plural: "tasks",
    article: "a",
  },
  project: {
    singular: "project",
    plural: "projects",
    article: "a",
  },
  artifact: {
    singular: "artifact",
    plural: "artifacts",
    article: "an",
  },
  integration: {
    singular: "integration",
    plural: "integrations",
    article: "an",
  },
  assistant: {
    singular: "assistant",
    plural: "assistants",
    article: "an",
  },
  feature: {
    singular: "feature",
    plural: "features",
    article: "a",
  },
  plan: {
    singular: "plan",
    plural: "plans",
    article: "a",
  },
  conversation: {
    singular: "conversation",
    plural: "conversations",
    article: "a",
  },
  agentSession: {
    singular: "agent session",
    plural: "agent sessions",
    article: "an",
  },
  actions: {
    create: "create",
    edit: "edit",
    delete: "delete",
    view: "view",
    manage: "manage",
  },
  status: {
    active: "active",
    inactive: "inactive",
    completed: "completed",
    inProgress: "in progress",
    planning: "planning",
  },
};

// Alternative terminology sets for easy switching
export const GOAL_FOCUSED_TERMINOLOGY: TerminologySet = {
  initiative: {
    singular: "goal",
    plural: "goals",
    article: "a",
  },
  task: {
    singular: "action",
    plural: "actions",
    article: "an",
  },
  project: {
    singular: "project",
    plural: "projects",
    article: "a",
  },
  artifact: {
    singular: "resource",
    plural: "resources",
    article: "a",
  },
  integration: {
    singular: "connection",
    plural: "connections",
    article: "a",
  },
  assistant: {
    singular: "assistant",
    plural: "assistants",
    article: "an",
  },
  feature: {
    singular: "feature",
    plural: "features",
    article: "a",
  },
  plan: {
    singular: "plan",
    plural: "plans",
    article: "a",
  },
  conversation: {
    singular: "conversation",
    plural: "conversations",
    article: "a",
  },
  agentSession: {
    singular: "agent session",
    plural: "agent sessions",
    article: "an",
  },
  actions: {
    create: "set up",
    edit: "refine",
    delete: "remove",
    view: "review",
    manage: "organize",
  },
  status: {
    active: "active",
    inactive: "inactive",
    completed: "achieved",
    inProgress: "in progress",
    planning: "planning",
  },
};

export const AGILE_TERMINOLOGY: TerminologySet = {
  initiative: {
    singular: "epic",
    plural: "epics",
    article: "an",
  },
  task: {
    singular: "story",
    plural: "stories",
    article: "a",
  },
  project: {
    singular: "project",
    plural: "projects",
    article: "a",
  },
  artifact: {
    singular: "artifact",
    plural: "artifacts",
    article: "an",
  },
  integration: {
    singular: "integration",
    plural: "integrations",
    article: "an",
  },
  assistant: {
    singular: "assistant",
    plural: "assistants",
    article: "an",
  },
  feature: {
    singular: "feature",
    plural: "features",
    article: "a",
  },
  plan: {
    singular: "plan",
    plural: "plans",
    article: "a",
  },
  conversation: {
    singular: "conversation",
    plural: "conversations",
    article: "a",
  },
  agentSession: {
    singular: "agent session",
    plural: "agent sessions",
    article: "an",
  },
  actions: {
    create: "create",
    edit: "update",
    delete: "remove",
    view: "view",
    manage: "manage",
  },
  status: {
    active: "active",
    inactive: "inactive",
    completed: "done",
    inProgress: "in progress",
    planning: "backlog",
  },
};

// Current active terminology - can be switched at runtime
export let ACTIVE_TERMINOLOGY: TerminologySet = DEFAULT_TERMINOLOGY;

// Function to switch terminology theme
export const setTerminology = (terminology: TerminologySet): void => {
  ACTIVE_TERMINOLOGY = terminology;
};

// Getter function for current terminology
export const getTerminology = (): TerminologySet => {
  return ACTIVE_TERMINOLOGY;
};

// Type-safe terminology access
export type TerminologyKey = keyof TerminologySet;

// Helper function to get a specific term
export const getTerm = <
  TCategory extends TerminologyKey,
  TKey extends keyof TerminologySet[TCategory],
>(
  category: TCategory,
  key: TKey,
): TerminologySet[TCategory][TKey] => {
  const categoryTerms = ACTIVE_TERMINOLOGY[category];
  if (
    typeof categoryTerms === "object" &&
    categoryTerms !== null &&
    key in categoryTerms
  ) {
    return (categoryTerms as Record<string, string>)[
      key as string
    ] as TerminologySet[TCategory][TKey];
  }
  return `[missing: ${String(category)}.${String(
    key,
  )}]` as TerminologySet[TCategory][TKey];
};

// Helper functions for common term access patterns
export const getEntityTerm = (
  entity:
    | "initiative"
    | "task"
    | "project"
    | "artifact"
    | "integration"
    | "assistant"
    | "feature"
    | "plan"
    | "conversation"
    | "agentSession",
  form: "singular" | "plural" | "article",
): string => {
  return getTerm(entity, form);
};

export const getActionTerm = (
  action: keyof TerminologySet["actions"],
): string => {
  return getTerm("actions", action);
};

export const getStatusTerm = (
  status: keyof TerminologySet["status"],
): string => {
  return getTerm("status", status);
};

// Helper function for work generation components
export const getWorkTypeTerm = (
  workType: "workstream" | "workitem",
  form: "singular" | "plural",
): string => {
  return workType === "workstream"
    ? getEntityTerm("initiative", form as "singular" | "plural" | "article")
    : getEntityTerm("task", form as "singular" | "plural" | "article");
};

// Capitalization helpers
export const capitalize = (text: string): string => {
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const titleCase = (text: string): string => {
  return text.replace(/\w\S*/g, (word) => capitalize(word.toLowerCase()));
};

// Quick access object for templates
export const TERMS = {
  get initiative() {
    return getEntityTerm("initiative", "singular");
  },
  get initiatives() {
    return getEntityTerm("initiative", "plural");
  },
  get anInitiative() {
    return `${getEntityTerm("initiative", "article")} ${getEntityTerm(
      "initiative",
      "singular",
    )}`;
  },

  get back() {
    return "return";
  },
  get Back() {
    return "Return";
  },

  get task() {
    return getEntityTerm("task", "singular");
  },

  get tasks() {
    return getEntityTerm("task", "plural");
  },
  get aTask() {
    return `${getEntityTerm("task", "article")} ${getEntityTerm(
      "task",
      "singular",
    )}`;
  },

  get project() {
    return getEntityTerm("project", "singular");
  },
  get projects() {
    return getEntityTerm("project", "plural");
  },
  get aProject() {
    return `${getEntityTerm("project", "article")} ${getEntityTerm(
      "project",
      "singular",
    )}`;
  },

  get artifact() {
    return getEntityTerm("artifact", "singular");
  },
  get artifacts() {
    return getEntityTerm("artifact", "plural");
  },
  get anArtifact() {
    return `${getEntityTerm("artifact", "article")} ${getEntityTerm(
      "artifact",
      "singular",
    )}`;
  },

  get integration() {
    return getEntityTerm("integration", "singular");
  },
  get integrations() {
    return getEntityTerm("integration", "plural");
  },
  get anIntegration() {
    return `${getEntityTerm("integration", "article")} ${getEntityTerm(
      "integration",
      "singular",
    )}`;
  },

  get Feature() {
    return capitalize(getEntityTerm("feature", "singular"));
  },
  get Plan() {
    return capitalize(getEntityTerm("plan", "singular"));
  },
  get Conversation() {
    return capitalize(getEntityTerm("conversation", "singular"));
  },
  get AgentSession() {
    return capitalize(getEntityTerm("agentSession", "singular"));
  },

  // Capitalized versions
  get Initiative() {
    return capitalize(this.initiative);
  },
  get Initiatives() {
    return capitalize(this.initiatives);
  },
  get AnInitiative() {
    return capitalize(this.anInitiative);
  },

  get Task() {
    return capitalize(this.task);
  },
  get Tasks() {
    return capitalize(this.tasks);
  },
  get ATask() {
    return capitalize(this.aTask);
  },

  get Project() {
    return capitalize(this.project);
  },
  get Projects() {
    return capitalize(this.projects);
  },
  get AProject() {
    return capitalize(this.aProject);
  },

  get Artifact() {
    return capitalize(this.artifact);
  },
  get Artifacts() {
    return capitalize(this.artifacts);
  },
  get AnArtifact() {
    return capitalize(this.anArtifact);
  },

  get Integration() {
    return capitalize(this.integration);
  },
  get Integrations() {
    return capitalize(this.integrations);
  },
  get AnIntegration() {
    return capitalize(this.anIntegration);
  },

  get assistant() {
    return getEntityTerm("assistant", "singular");
  },
  get assistants() {
    return getEntityTerm("assistant", "plural");
  },
  get anAssistant() {
    return `${getEntityTerm("assistant", "article")} ${getEntityTerm(
      "assistant",
      "singular",
    )}`;
  },

  get Assistant() {
    return capitalize(this.assistant);
  },
  get Assistants() {
    return capitalize(this.assistants);
  },
  get AnAssistant() {
    return capitalize(this.anAssistant);
  },

  // Actions
  get create() {
    return getActionTerm("create");
  },
  get edit() {
    return getActionTerm("edit");
  },
  get delete() {
    return getActionTerm("delete");
  },
  get view() {
    return getActionTerm("view");
  },
  get manage() {
    return getActionTerm("manage");
  },

  get Create() {
    return capitalize(this.create);
  },
  get Edit() {
    return capitalize(this.edit);
  },
  get Delete() {
    return capitalize(this.delete);
  },
  get View() {
    return capitalize(this.view);
  },
  get Manage() {
    return capitalize(this.manage);
  },
};
