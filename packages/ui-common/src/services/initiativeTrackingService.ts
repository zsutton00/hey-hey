/**
 * Initiative Tracking Service
 *
 * Provides specialized tracking for Initiative workflows with semantic
 * event types and context-aware human-readable descriptions
 */

import type { InitiativeAction, InitiativeEvent } from "../types/userTracking";
import type { InitiativeResponseDto } from "../api";
import type { Priority } from "../api";
import { userActionTracker } from "./userActionTracker";

// Enhanced Initiative tracking data with business context
export interface InitiativeTrackingData {
  initiative: InitiativeResponseDto;
  previousValue?: unknown;
  newValue?: unknown;
  field?: keyof InitiativeResponseDto;
  requirement?: {
    id: string;
    text: string;
    type?:
      | "acceptanceCriteria"
      | "functional"
      | "non_functional"
      | "business_rule";
  };
  project?: {
    id: string;
    name: string;
  };
  conversation?: {
    id: string;
    messageCount: number;
    duration?: number;
  };
  collaborator?: {
    id: string;
    name: string;
    role?: string;
  };
  workflow?: {
    id: string;
    name: string;
    step?: string;
  };
  metadata?: Record<string, unknown>;
}

// Initiative workflow stages for semantic tracking
export enum InitiativeWorkflowStage {
  CONCEPTION = "conception",
  REFINEMENT = "refinement",
  EXECUTION = "execution",
  REVIEW = "review",
  COMPLETION = "completion",
}

// Requirement interaction types
export enum RequirementInteractionType {
  ADD = "add_requirement",
  UPDATE = "update_requirement",
  REMOVE = "remove_requirement",
  APPROVE = "approve_requirement",
  REJECT = "reject_requirement",
  CLARIFY = "clarify_requirement",
}

// Collaboration interaction types
export enum CollaborationInteractionType {
  INVITE = "invite_collaborator",
  ASSIGN = "assign_collaborator",
  COMMENT = "add_comment",
  MENTION = "mention_collaborator",
  APPROVE = "approve_initiative",
  REQUEST_CHANGES = "request_changes",
}

// Initiative tracking service class
export class InitiativeTrackingService {
  /**
   * Track Initiative creation with rich context
   */
  static trackInitiativeCreation(
    initiative: InitiativeResponseDto,
    _context?: {
      templateUsed?: string;
      collaborators?: string[];
      estimatedDuration?: number;
      inspiration?: string;
    }
  ): void {
    userActionTracker.track({
      category: "initiative",
      action: "create",
      data: {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
      },
    });
  }

  /**
   * Track Initiative field updates with semantic descriptions
   */
  static trackInitiativeUpdate(
    initiative: InitiativeResponseDto,
    field: keyof InitiativeResponseDto,
    previousValue: unknown,
    newValue: unknown,
    _context?: {
      reason?: string;
      triggeredBy?: "user_input" | "system_update" | "workflow_step";
      relatedRequirement?: string;
    }
  ): void {
    // Generate semantic action based on field and values
    const action = this.getSemanticUpdateAction(field, previousValue, newValue);

    userActionTracker.track({
      category: "initiative",
      action,
      data: {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
        previousValue,
        newValue,
      },
    });
  }

  /**
   * Track requirement interactions with detailed context
   */
  static trackRequirementInteraction(
    initiative: InitiativeResponseDto,
    interactionType: RequirementInteractionType,
    requirement: {
      id: string;
      text: string;
      type?: string;
      priority?: Priority;
      acceptanceCriteria?: string[];
    },
    _context?: {
      reason?: string;
      relatedRequirements?: string[];
      estimatedEffort?: number;
      stakeholder?: string;
    }
  ): void {
    const actionMap: Record<RequirementInteractionType, InitiativeAction> = {
      [RequirementInteractionType.ADD]: "add_requirement",
      [RequirementInteractionType.UPDATE]: "update_requirement",
      [RequirementInteractionType.REMOVE]: "remove_requirement",
      [RequirementInteractionType.APPROVE]: "approve",
      [RequirementInteractionType.REJECT]: "reject",
      [RequirementInteractionType.CLARIFY]: "review",
    };

    userActionTracker.track({
      category: "initiative",
      action: actionMap[interactionType],
      data: {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
        requirement: {
          id: requirement.id,
          text: requirement.text.substring(0, 200),
        },
      },
    });
  }

  /**
   * Track Initiative refinement conversations
   */
  static trackInitiativeConversation(
    initiative: InitiativeResponseDto,
    conversationData: {
      id: string;
      messageCount: number;
      duration?: number;
      participantCount?: number;
      topics?: string[];
      outcome?: "refined" | "clarified" | "approved" | "rejected" | "deferred";
      requirementsGenerated?: number;
      decisionsMatured?: string[];
    }
  ): void {
    userActionTracker.track({
      category: "initiative",
      action: "start_conversation",
      data: {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
        conversation: {
          id: conversationData.id,
          messageCount: conversationData.messageCount,
        },
      },
    });
  }

  /**
   * Track Initiative workflow progression
   */
  static trackWorkflowProgression(
    initiative: InitiativeResponseDto,
    fromStage: InitiativeWorkflowStage,
    toStage: InitiativeWorkflowStage,
    _context?: {
      duration?: number;
      blockers?: string[];
      accelerators?: string[];
      stakeholderApproval?: boolean;
      qualityGate?: "passed" | "failed" | "bypassed";
    }
  ): void {
    userActionTracker.track({
      category: "initiative",
      action: "change_status",
      data: {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
        previousValue: fromStage,
        newValue: toStage,
      },
    });
  }

  /**
   * Track project linking/unlinking
   */
  static trackProjectLinking(
    initiative: InitiativeResponseDto,
    project: { id: string; name: string },
    action: "link" | "unlink",
    _context?: {
      reason?: string;
      expectedImpact?: string;
      stakeholder?: string;
    }
  ): void {
    const trackingAction =
      action === "link" ? "link_project" : "unlink_project";

    userActionTracker.track({
      category: "initiative",
      action: trackingAction,
      data: {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
        project: {
          id: project.id,
          name: project.name,
        },
      },
    });
  }

  /**
   * Track collaboration events
   */
  static trackCollaboration(
    initiative: InitiativeResponseDto,
    interactionType: CollaborationInteractionType,
    _collaborator: {
      id: string;
      name: string;
      role?: string;
    },
    _context?: {
      message?: string;
      decision?: string;
      nextSteps?: string[];
      urgency?: "low" | "medium" | "high" | "critical";
    }
  ): void {
    const actionMap: Record<CollaborationInteractionType, InitiativeAction> = {
      [CollaborationInteractionType.INVITE]: "update",
      [CollaborationInteractionType.ASSIGN]: "update",
      [CollaborationInteractionType.COMMENT]: "review",
      [CollaborationInteractionType.MENTION]: "review",
      [CollaborationInteractionType.APPROVE]: "approve",
      [CollaborationInteractionType.REQUEST_CHANGES]: "review",
    };

    userActionTracker.track({
      category: "initiative",
      action: actionMap[interactionType],
      data: {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
      },
    });
  }

  /**
   * Track export and sharing activities
   */
  static trackExportActivity(
    initiative: InitiativeResponseDto,
    _exportType: "pdf" | "word" | "markdown" | "json" | "csv",
    _context?: {
      includeRequirements?: boolean;
      includeConversations?: boolean;
      includeAnalytics?: boolean;
      recipient?: string;
      purpose?: string;
    }
  ): void {
    userActionTracker.track({
      category: "initiative",
      action: "export",
      data: {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
      },
    });
  }

  // Private helper methods

  /**
   * Generate semantic action based on field changes
   */
  private static getSemanticUpdateAction(
    field: keyof InitiativeResponseDto,
    previousValue: unknown,
    newValue: unknown
  ): InitiativeAction {
    switch (field) {
      case "status":
        return "change_status";
      case "priority":
        return "change_priority";
      case "dueDate":
        return "set_due_date";
      case "tags": {
        // Determine if tag was added or removed
        const prevTags = Array.isArray(previousValue) ? previousValue : [];
        const newTags = Array.isArray(newValue) ? newValue : [];
        return newTags.length > prevTags.length ? "add_tag" : "remove_tag";
      }
      case "name":
      case "sections":
      default:
        return "update";
    }
  }

  /**
   * Generate context-aware descriptions for Initiative events
   */
  static generateInitiativeDescription(event: InitiativeEvent): string {
    const { action, data } = event;
    const initiative = data.initiativeName;

    switch (action) {
      case "create":
        return `User created new initiative "${initiative}"`;

      case "update":
        return `User updated initiative "${initiative}" ${data.field} from "${data.previousValue}" to "${data.newValue}"`;

      case "add_requirement":
        return `User added requirement to initiative "${initiative}": "${data.requirement?.text}"`;

      case "link_project":
        return `User linked project "${data.project?.name}" to initiative "${initiative}"`;

      case "start_conversation":
        return `User started conversation about initiative "${initiative}" (${data.conversation?.messageCount} messages)`;

      case "change_status":
        return `User changed initiative "${initiative}" status from "${data.previousValue}" to "${data.newValue}"`;

      case "export": {
        const exportType = "unknown";
        return `User exported initiative "${initiative}" as ${exportType}`;
      }
      default:
        return `User performed ${action} on initiative "${initiative}"`;
    }
  }
}

// Convenience functions for common Initiative tracking patterns

/**
 * Track Initiative page view with context
 */
export const trackInitiativeView = (
  initiative: InitiativeResponseDto,
  _context?: {
    viewMode?: "summary" | "detailed" | "edit" | "conversation";
    timeSpent?: number;
    sectionsViewed?: string[];
  }
): void => {
  userActionTracker.track({
    category: "initiative",
    action: "view",
    data: {
      initiativeId: initiative.id,
      initiativeName: initiative.name,
    },
  });
};

/**
 * Track Initiative search and discovery
 */
export const trackInitiativeSearch = (
  query: string,
  _results: InitiativeResponseDto[],
  _context?: {
    filters?: Record<string, unknown>;
    sortBy?: string;
    timeToFind?: number;
    selectedInitiative?: string;
  }
): void => {
  userActionTracker.track({
    category: "ui_interaction",
    action: "search",
    data: {
      elementType: "initiative_search",
      searchQuery: query,
    },
  });
};
