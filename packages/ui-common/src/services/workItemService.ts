/**
 * Work Item Service - Generic Work Item API Integration
 *
 * Service for managing work items (initiatives and tasks) using backend endpoints:
 * - GET /work-items/:id - Start/get refinement session
 * - GET /work-items/:id/conversations - Get chat history
 * - PUT /work-items/:id/content - Update content
 * - POST /work-items/:id/refine - Refine via conversation
 * - POST /work-items/:id/review - Mark as reviewed
 * - POST /work-items/:id/deepen - Progress to next level
 * - POST /work-items/:id/finalize - Finalize work item
 */

import { getAuthToken } from "./authService";
import type {
  ConversationMessage,
  ContentUpdatePayload,
  RefinePayload,
} from "./workItemTypes";
import type {
  WorkItem,
  WorkItemContentUpdateResponse,
  WorkItemDeepenResponse,
  WorkItemFinalizeResponse,
  WorkItemReviewResponse,
  WorkItemSystemResponse,
} from "../api";

export type {
  WorkItem,
  WorkItemContentUpdateResponse,
  WorkItemDeepenResponse,
  WorkItemFinalizeResponse,
  WorkItemReviewResponse,
  WorkItemSystemResponse,
} from "../api";

// Note: Shared types (ConversationMessage, ContentUpdatePayload, RefinePayload)
// are available from workItemTypes.ts to avoid duplicate exports

class WorkItemService {
  private static instance: WorkItemService;
  private baseUrl: string;

  private constructor() {
    // Work item base URL (will route to initiatives or tasks based on entityType)
    this.baseUrl = "/api/v1/work-items";
  }

  /**
   * Get singleton instance
   */
  static getInstance(): WorkItemService {
    if (!WorkItemService.instance) {
      WorkItemService.instance = new WorkItemService();
    }
    return WorkItemService.instance;
  }

  /**
   * Build URL for work item endpoints
   */
  private buildUrl(workItemId: string, path: string = ""): string {
    return `${this.baseUrl}/${workItemId}${path}`;
  }

  /**
   * Get authorization headers
   */
  private getHeaders(): Record<string, string> {
    const token = getAuthToken();
    return {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  /**
   * Get or start work item refinement session
   * GET /work-items/:workItemId
   */
  async getWorkItem(workItemId: string): Promise<WorkItem> {
    const url = this.buildUrl(workItemId);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to load work item: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to get work item:", error);
      throw new Error("Failed to load work item. Please try again.");
    }
  }

  /**
   * Get conversation history for work item
   * GET /work-items/:workItemId/conversations
   */
  async getWorkItemConversations(
    workItemId: string
  ): Promise<ConversationMessage[]> {
    const url = this.buildUrl(workItemId, "/conversations");

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to load conversations: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to get work item conversations:", error);
      throw new Error("Failed to load conversation history. Please try again.");
    }
  }

  /**
   * Update work item content directly
   * PUT /work-items/:workItemId/content
   */
  async updateWorkItemContent(
    workItemId: string,
    payload: ContentUpdatePayload
  ): Promise<WorkItemContentUpdateResponse> {
    const url = this.buildUrl(workItemId, "/content");

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to update content: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to update work item content:", error);
      throw new Error("Failed to update content. Please try again.");
    }
  }

  /**
   * Refine work item through conversation
   * POST /work-items/:workItemId/refine
   */
  async refineWorkItem(
    workItemId: string,
    payload: RefinePayload
  ): Promise<WorkItemSystemResponse> {
    const url = this.buildUrl(workItemId, "/refine");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to refine work item: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to refine work item:", error);
      throw new Error("Failed to refine work item. Please try again.");
    }
  }

  /**
   * Progress work item to next level (description → details → acceptance criteria)
   * POST /work-items/:workItemId/deepen
   */
  async deepenWorkItem(
    workItemId: string,
    currentLevel: "description" | "details"
  ): Promise<WorkItemDeepenResponse> {
    const url = this.buildUrl(workItemId, "/deepen");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ currentLevel }),
      });

      if (!response.ok) {
        throw new Error(`Failed to deepen work item: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to deepen work item:", error);
      throw new Error("Failed to expand work item details. Please try again.");
    }
  }

  /**
   * Mark work item as reviewed
   * POST /work-items/:workItemId/review
   */
  async reviewWorkItem(
    workItemId: string,
    approved: boolean,
    level: "description" | "details" | "acceptanceCriteria"
  ): Promise<WorkItemReviewResponse> {
    const url = this.buildUrl(workItemId, "/review");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ approved, level }),
      });

      if (!response.ok) {
        throw new Error(`Failed to review work item: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to review work item:", error);
      throw new Error("Failed to review work item. Please try again.");
    }
  }

  /**
   * Finalize work item
   * POST /work-items/:workItemId/finalize
   */
  async finalizeWorkItem(
    workItemId: string
  ): Promise<WorkItemFinalizeResponse> {
    const url = this.buildUrl(workItemId, "/finalize");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to finalize work item: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to finalize work item:", error);
      throw new Error("Failed to finalize work item. Please try again.");
    }
  }
}

export const workItemService = WorkItemService.getInstance();
