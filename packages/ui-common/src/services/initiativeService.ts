/**
 * Initiative Service - New Initiative-First API Integration
 *
 * Service for managing individual initiatives using the new backend endpoints:
 * - GET /initiatives/:id - Start/get refinement session
 * - GET /initiatives/:id/conversations - Get chat history
 * - PUT /initiatives/:id/content - Update content
 * - POST /initiatives/:id/refine - Refine via conversation
 * - POST /initiatives/:id/review - Mark as reviewed
 * - POST /initiatives/:id/deepen - Progress to next level
 * - POST /initiatives/:id/finalize - Finalize initiative
 */

import { getAuthToken } from "./authService";
import type { ContentUpdatePayload, RefinePayload } from "./workItemTypes";

// Initiative-specific data model
export interface Initiative {
  id: string;
  title: string;
  description?: string;
  details?: string;
  acceptanceCriteria?: string;
  currentLevel: "description" | "details" | "acceptanceCriteria";
  reviewStatus: "unreviewed" | "reviewed" | "approved";
  priority?: "low" | "medium" | "high";
  tags: string[];
  userCorrections?: string[];
  systemSuggestions?: string[];
  projectId: string;
  organizationId: string;
}

// Initiative-specific response types
export interface InitiativeSystemResponse {
  updatedInitiative: Initiative;
  systemResponse: string;
  suggestedChanges?: string[];
  crossInitiativeImpacts?: string[];
  readyForNextLevel?: boolean;
}

export interface InitiativeContentUpdateResponse {
  updatedInitiative: Initiative;
  systemResponse?: string;
  detectedChanges: Array<{
    type: "addition" | "removal" | "modification";
    content: string;
    intent?: string;
  }>;
  crossInitiativeImpacts?: string[];
}

export interface InitiativeDeepenResponse {
  updatedInitiative: Initiative;
  systemResponse: string;
  nextLevelContent: string;
}

export interface InitiativeReviewResponse {
  updatedInitiative: Initiative;
  sessionProgress?: {
    reviewedCount: number;
    totalCount: number;
    canFinalize: boolean;
  };
}

export interface InitiativeFinalizeResponse {
  success: boolean;
  finalizedInitiative: Initiative;
  message: string;
}

// Note: Shared types (ConversationMessage, ContentUpdatePayload, RefinePayload)
// are available from workItemTypes.ts to avoid duplicate exports

class InitiativeService {
  private static instance: InitiativeService;
  private baseUrl: string;

  private constructor() {
    // New initiative-first base URL
    this.baseUrl = "/api/v1/initiatives";
  }

  /**
   * Get singleton instance
   */
  static getInstance(): InitiativeService {
    if (!InitiativeService.instance) {
      InitiativeService.instance = new InitiativeService();
    }
    return InitiativeService.instance;
  }

  /**
   * Build URL for initiative endpoints
   */
  private buildUrl(initiativeId: string, path: string = ""): string {
    return `${this.baseUrl}/${initiativeId}${path}`;
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
   * Get or start initiative refinement session
   * GET /initiatives/:initiativeId
   */
  async getInitiative(initiativeId: string): Promise<Initiative> {
    const url = this.buildUrl(initiativeId);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to load initiative: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to get initiative:", error);
      throw new Error("Failed to load initiative. Please try again.");
    }
  }

  /**
   * Update initiative content directly
   * PUT /initiatives/:initiativeId/content
   */
  async updateInitiativeContent(
    initiativeId: string,
    payload: ContentUpdatePayload
  ): Promise<InitiativeContentUpdateResponse> {
    const url = this.buildUrl(initiativeId, "/content");

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
      console.error("Failed to update initiative content:", error);
      throw new Error("Failed to update content. Please try again.");
    }
  }

  /**
   * Refine initiative through conversation
   * POST /initiatives/:initiativeId/refine
   */
  async refineInitiative(
    initiativeId: string,
    payload: RefinePayload
  ): Promise<InitiativeSystemResponse> {
    const url = this.buildUrl(initiativeId, "/refine");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to refine initiative: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to refine initiative:", error);
      throw new Error("Failed to refine initiative. Please try again.");
    }
  }

  /**
   * Progress initiative to next level (description → details → acceptance criteria)
   * POST /initiatives/:initiativeId/deepen
   */
  async deepenInitiative(
    initiativeId: string,
    currentLevel: "description" | "details"
  ): Promise<InitiativeDeepenResponse> {
    const url = this.buildUrl(initiativeId, "/deepen");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ currentLevel }),
      });

      if (!response.ok) {
        throw new Error(`Failed to deepen initiative: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to deepen initiative:", error);
      throw new Error("Failed to expand initiative details. Please try again.");
    }
  }

  /**
   * Mark initiative as reviewed
   * POST /initiatives/:initiativeId/review
   */
  async reviewInitiative(
    initiativeId: string,
    approved: boolean,
    level: "description" | "details" | "acceptanceCriteria"
  ): Promise<InitiativeReviewResponse> {
    const url = this.buildUrl(initiativeId, "/review");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ approved, level }),
      });

      if (!response.ok) {
        throw new Error(`Failed to review initiative: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to review initiative:", error);
      throw new Error("Failed to review initiative. Please try again.");
    }
  }

  /**
   * Finalize initiative
   * POST /initiatives/:initiativeId/finalize
   */
  async finalizeInitiative(
    initiativeId: string
  ): Promise<InitiativeFinalizeResponse> {
    const url = this.buildUrl(initiativeId, "/finalize");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to finalize initiative: ${response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to finalize initiative:", error);
      throw new Error("Failed to finalize initiative. Please try again.");
    }
  }
}

export const initiativeService = InitiativeService.getInstance();
