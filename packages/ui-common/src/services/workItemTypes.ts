/**
 * Shared types for work items (initiatives and tasks)
 * Used by both initiativeService and workItemService
 */

import type {
  WorkItemContentUpdateResponse,
  WorkItemDetectedChange,
} from "../api";

export interface ConversationMessage {
  id: string;
  type: "user_message" | "user_edit" | "system_response";
  content: string;
  timestamp: string;
  metadata?: {
    contentBefore?: string;
    contentAfter?: string;
    detectedChanges?: ContentChange[];
  };
}

export type ContentChange = WorkItemDetectedChange;

export interface ContentUpdatePayload {
  content: string;
  level: "description" | "details" | "acceptanceCriteria";
  previousContent?: string;
}

export interface RefinePayload {
  message: string;
  context?: {
    currentLevel: "description" | "details" | "acceptanceCriteria";
    previousContent?: string;
  };
}

// Generic system response - specific services will define their own with typed work items
export interface SystemResponse<T = unknown> {
  systemResponse: string;
  suggestedChanges?: string[];
  readyForNextLevel?: boolean;
  updatedWorkItem?: T;
  updatedInitiative?: T;
}

// Generic content update response - specific services will define their own with typed work items
export type ContentUpdateResponse = WorkItemContentUpdateResponse;

// Generic deepen response - specific services will define their own with typed work items
export interface DeepenResponse<T = unknown> {
  systemResponse: string;
  nextLevelContent: string;
  updatedWorkItem?: T;
  updatedInitiative?: T;
}

// Generic review response - specific services will define their own with typed work items
export interface ReviewResponse<T = unknown> {
  sessionProgress?: {
    reviewedCount: number;
    totalCount: number;
    canFinalize: boolean;
  };
  updatedWorkItem?: T;
  updatedInitiative?: T;
}

// Generic finalize response - specific services will define their own with typed work items
export interface FinalizeResponse<T = unknown> {
  success: boolean;
  message: string;
  finalizedWorkItem?: T;
  finalizedInitiative?: T;
}
