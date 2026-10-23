import { useTranslation } from "react-i18next";

/**
 * Hook for commonly used translations across the app
 * Provides easy access to frequently used translation keys
 */
export const useCommonTranslations = () => {
  const { t } = useTranslation();

  return {
    // Common actions
    save: t("common.save"),
    cancel: t("common.cancel"),
    delete: t("common.delete"),
    edit: t("common.edit"),
    create: t("common.create"),
    back: t("common.back"),
    next: t("common.next"),
    submit: t("common.submit"),
    search: t("common.search"),
    refresh: t("common.refresh"),

    // Status messages
    loading: t("common.loading"),
    thinking: t("common.thinking"),
    processing: t("common.processing"),
    analyzing: t("common.analyzing"),
    error: t("common.error"),
    success: t("common.success"),

    // Navigation
    home: t("navigation.home"),
    projects: t("navigation.projects"),
    initiatives: t("navigation.initiatives"),
    artifacts: t("navigation.artifacts"),

    // Alerts
    deleteSuccess: t("alerts.deleteSuccess"),
    createSuccess: t("alerts.createSuccess"),
    updateSuccess: t("alerts.updateSuccess"),
    saveSuccess: t("alerts.saveSuccess"),
    errorOccurred: t("alerts.errorOccurred"),
    tryAgain: t("alerts.tryAgain"),

    // Form validation
    required: t("forms.required"),
    invalidEmail: t("forms.invalidEmail"),
    passwordTooShort: t("forms.passwordTooShort"),
    passwordMismatch: t("forms.passwordMismatch"),
  };
};

/**
 * Hook for status-related translations (initiatives, tasks, etc.)
 */
export const useStatusTranslations = () => {
  const { t } = useTranslation();

  return {
    // Initiative status
    initiativeStatus: {
      planning: t("initiatives.status.planning"),
      active: t("initiatives.status.active"),
      onHold: t("initiatives.status.onHold"),
      completed: t("initiatives.status.completed"),
      cancelled: t("initiatives.status.cancelled"),
    },

    // Task status
    taskStatus: {
      todo: t("tasks.status.todo"),
      inProgress: t("tasks.status.inProgress"),
      done: t("tasks.status.done"),
      blocked: t("tasks.status.blocked"),
    },

    // Task types
    taskType: {
      task: t("tasks.type.task"),
      bug: t("tasks.type.bug"),
      feature: t("tasks.type.feature"),
      improvement: t("tasks.type.improvement"),
    },

    // Priority levels
    priority: {
      low: t("initiatives.priority.low"),
      medium: t("initiatives.priority.medium"),
      high: t("initiatives.priority.high"),
    },

    // Artifact types
    artifactTypes: {
      qaPair: t("artifacts.types.qaPair"),
      document: t("artifacts.types.document"),
      codeSnippet: t("artifacts.types.codeSnippet"),
      conversationSummary: t("artifacts.types.conversationSummary"),
      projectInsight: t("artifacts.types.projectInsight"),
    },

    // Artifact status
    artifactStatus: {
      active: t("artifacts.status.active"),
      archived: t("artifacts.status.archived"),
      draft: t("artifacts.status.draft"),
    },
  };
};

/**
 * Hook for formatting translated messages with interpolation
 */
export const useFormattedTranslations = () => {
  const { t } = useTranslation();

  return {
    // Format welcome message with user name
    welcome: (name: string) => t("navigation.welcome", { name }),

    // Format task subtitle with initiative title
    taskSubtitle: (initiativeTitle: string) =>
      t("tasks.subtitle", { initiativeTitle }),

    // Format artifact count message
    artifactSubtitle: (count: number) => t("artifacts.subtitle", { count }),

    // Format delete confirmation messages
    deleteTaskConfirm: (title: string) => t("tasks.deleteConfirm", { title }),

    // Format metadata messages
    sourceMetadata: (sourceType: string) =>
      t("artifacts.metadata.source", { sourceType }),

    publicMetadata: (isPublic: boolean) =>
      t("artifacts.metadata.public", { isPublic: isPublic ? "Yes" : "No" }),
  };
};
