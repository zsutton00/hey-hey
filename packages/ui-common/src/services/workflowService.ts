/**
 * Workflow Service
 *
 * Service layer for workflow management API calls
 */

import { getAuthToken } from "./authService";
import { configService } from "./configService";
import type { UnifiedApiClient } from "../clients";
import type {
  WorkflowTemplateId,
  WorkflowTemplateSummary,
  WorkflowTemplate,
  WorkflowTemplateStructure,
  WorkflowTemplatesListResponse,
  WorkflowTemplateDetailResponse,
  WorkflowTemplateStructureResponse,
  WorkflowApiResponse,
  WorkflowMetrics,
  WorkflowAnalytics,
  WorkflowValidationResult,
  WorkflowSimulationRequest,
  WorkflowSimulationResult,
  WorkflowExecution,
  WorkflowTemplateQuery,
  WorkflowNodeId,
  WorkflowNodeDetailResponse,
  WorkflowNodeTestRequest,
  WorkflowNodeTestResponse,
  // Admin UI types
  WorkflowHealthMetrics,
  WorkflowAlert,
  WorkflowMonitoringResponse,
  ContextVersion,
  ContextVersionResponse,
  ContextRollbackRequest,
  CoordinationEvent,
  AgentCoordinationResponse,
} from "../types/workflow";

/**
 * Workflow Service Class
 * Handles all workflow-related API operations
 */
export class WorkflowService {
  private baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    options: {
      baseUrl?: string;
      client?: UnifiedApiClient;
      fetchImplementation?: typeof fetch;
    } = {}
  ) {
    this.baseUrl = options.baseUrl || configService.getApiBaseUrl();
    this.fetchImpl = options.fetchImplementation || fetch;
  }

  /**
   * Helper to get auth headers
   */
  private getAuthHeaders(): HeadersInit {
    const token = getAuthToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Get all workflow templates with optional filtering
   */
  async getWorkflowTemplates(
    query?: WorkflowTemplateQuery
  ): Promise<WorkflowTemplateSummary[]> {
    try {
      const url = new URL(
        `${this.baseUrl}/workflows/templates`,
        typeof window === "undefined" ? undefined : window.location.origin
      );

      // Add query parameters if provided
      if (query?.filters?.searchTerm) {
        url.searchParams.append("search", query.filters.searchTerm);
      }
      if (query?.filters?.status) {
        query.filters.status.forEach((status) => {
          url.searchParams.append("status", status);
        });
      }
      if (query?.sortBy) {
        url.searchParams.append("sortBy", query.sortBy);
      }
      if (query?.sortOrder) {
        url.searchParams.append("sortOrder", query.sortOrder);
      }
      if (query?.page) {
        url.searchParams.append("page", query.page.toString());
      }
      if (query?.limit) {
        url.searchParams.append("limit", query.limit.toString());
      }

      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: this.getAuthHeaders(),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch workflow templates: ${response.statusText}`
        );
      }

      const data: WorkflowTemplatesListResponse = await response.json();
      return data.data.templates;
    } catch (error) {
      console.error("Error fetching workflow templates:", error);
      throw error;
    }
  }

  /**
   * Get a specific workflow template by ID
   */
  async getWorkflowTemplate(
    templateId: WorkflowTemplateId
  ): Promise<WorkflowTemplate> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${templateId}`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch workflow template: ${response.statusText}`
        );
      }

      const data: WorkflowTemplateDetailResponse = await response.json();
      return data.data;
    } catch (error) {
      console.error("Error fetching workflow template:", error);
      throw error;
    }
  }

  /**
   * Get workflow template structure for visualization
   */
  async getWorkflowTemplateStructure(
    templateId: WorkflowTemplateId
  ): Promise<WorkflowTemplateStructure> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${templateId}/structure`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        // If API is not available, return mock data for demo purposes
        console.warn(
          "Workflow API not available, returning mock structure data"
        );
        return this.getMockStructureData(templateId);
      }

      const data: WorkflowTemplateStructureResponse = await response.json();
      return data.data;
    } catch (error) {
      console.warn(
        "Error fetching workflow template structure, returning mock data:",
        error
      );
      // Return mock data if API is not available
      return this.getMockStructureData(templateId);
    }
  }

  /**
   * NO MOCK DATA - Use real API only
   */
  private getMockStructureData(
    _templateId: WorkflowTemplateId
  ): WorkflowTemplateStructure {
    console.error("Mock service called! This should not happen.");
    throw new Error("Mock service has been disabled. Real API should be used.");
  }

  /**
   * Validate a workflow template
   */
  async validateWorkflowTemplate(
    templateId: WorkflowTemplateId
  ): Promise<WorkflowValidationResult> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${templateId}/validate`,
        {
          method: "POST",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to validate workflow template: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<WorkflowValidationResult> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error validating workflow template:", error);
      throw error;
    }
  }

  /**
   * Get workflow template metrics
   */
  async getWorkflowTemplateMetrics(
    templateId: WorkflowTemplateId
  ): Promise<WorkflowMetrics> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${templateId}/metrics`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch workflow template metrics: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<WorkflowMetrics> = await response.json();
      return data.data;
    } catch (error) {
      console.error("Error fetching workflow template metrics:", error);
      throw error;
    }
  }

  /**
   * Get workflow analytics across all templates
   */
  async getWorkflowAnalytics(): Promise<WorkflowAnalytics> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/analytics`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch workflow analytics: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<WorkflowAnalytics> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error fetching workflow analytics:", error);
      throw error;
    }
  }

  /**
   * Get workflow executions
   */
  async getWorkflowExecutions(
    templateId?: WorkflowTemplateId
  ): Promise<WorkflowExecution[]> {
    try {
      const url = new URL(
        `${this.baseUrl}/workflows/executions`,
        typeof window === "undefined" ? undefined : window.location.origin
      );

      if (templateId) {
        url.searchParams.append("templateId", templateId);
      }

      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: this.getAuthHeaders(),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch workflow executions: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<WorkflowExecution[]> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error fetching workflow executions:", error);
      throw error;
    }
  }

  /**
   * Simulate a workflow execution
   */
  async simulateWorkflow(
    request: WorkflowSimulationRequest
  ): Promise<WorkflowSimulationResult> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${request.templateId}/simulate`,
        {
          method: "POST",
          headers: this.getAuthHeaders(),
          credentials: "include",
          body: JSON.stringify({
            initialContext: request.initialContext,
            startFromNode: request.startFromNode,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to simulate workflow: ${response.statusText}`);
      }

      const data: WorkflowApiResponse<WorkflowSimulationResult> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error simulating workflow:", error);
      throw error;
    }
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    request: WorkflowSimulationRequest
  ): Promise<WorkflowExecution> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${request.templateId}/execute`,
        {
          method: "POST",
          headers: this.getAuthHeaders(),
          credentials: "include",
          body: JSON.stringify({
            initialContext: request.initialContext,
            startFromNode: request.startFromNode,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to execute workflow: ${response.statusText}`);
      }

      const data: WorkflowApiResponse<WorkflowExecution> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error executing workflow:", error);
      throw error;
    }
  }

  /**
   * Debug a workflow step-by-step
   */
  async debugWorkflow(
    request: WorkflowSimulationRequest
  ): Promise<WorkflowSimulationResult> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${request.templateId}/debug`,
        {
          method: "POST",
          headers: this.getAuthHeaders(),
          credentials: "include",
          body: JSON.stringify({
            initialContext: request.initialContext,
            startFromNode: request.startFromNode,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to debug workflow: ${response.statusText}`);
      }

      const data: WorkflowApiResponse<WorkflowSimulationResult> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error debugging workflow:", error);
      throw error;
    }
  }

  /**
   * Get detailed information about a specific workflow node
   */
  async getWorkflowNodeDetail(
    templateId: WorkflowTemplateId,
    nodeId: WorkflowNodeId
  ): Promise<WorkflowNodeDetailResponse> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${templateId}/nodes/${nodeId}`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch node details: ${response.statusText}`);
      }

      const data: WorkflowApiResponse<WorkflowNodeDetailResponse> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error fetching node details:", error);
      throw error;
    }
  }

  /**
   * Test a specific workflow node with custom input
   */
  async testWorkflowNode(
    templateId: WorkflowTemplateId,
    nodeId: WorkflowNodeId,
    testRequest: WorkflowNodeTestRequest
  ): Promise<WorkflowNodeTestResponse> {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/workflows/templates/${templateId}/nodes/${nodeId}/test`,
        {
          method: "POST",
          headers: this.getAuthHeaders(),
          credentials: "include",
          body: JSON.stringify(testRequest),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to test workflow node: ${response.statusText}`);
      }

      const data: WorkflowApiResponse<WorkflowNodeTestResponse> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error testing workflow node:", error);
      throw error;
    }
  }

  // Admin UI API Methods

  /**
   * Get real-time workflow monitoring data
   */
  async getWorkflowMonitoring(
    workflowId: string
  ): Promise<WorkflowMonitoringResponse> {
    try {
      const response = await fetch(
        `${this.baseUrl}/workflows/${workflowId}/monitoring/metrics`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch workflow monitoring data: ${response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching workflow monitoring data:", error);
      throw error;
    }
  }

  /**
   * Get workflow health metrics
   */
  async getWorkflowHealth(workflowId: string): Promise<WorkflowHealthMetrics> {
    try {
      const response = await fetch(
        `${this.baseUrl}/workflows/${workflowId}/monitoring/health`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch workflow health data: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<WorkflowHealthMetrics> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error fetching workflow health data:", error);
      throw error;
    }
  }

  /**
   * Get workflow alerts
   */
  async getWorkflowAlerts(workflowId: string): Promise<WorkflowAlert[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/workflows/${workflowId}/monitoring/alerts`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch workflow alerts: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<WorkflowAlert[]> = await response.json();
      return data.data;
    } catch (error) {
      console.error("Error fetching workflow alerts:", error);
      throw error;
    }
  }

  /**
   * Get context versions for a workflow
   */
  async getContextVersions(
    workflowId: string
  ): Promise<ContextVersionResponse> {
    try {
      const response = await fetch(
        `${this.baseUrl}/workflows/${workflowId}/context/versions`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch context versions: ${response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching context versions:", error);
      throw error;
    }
  }

  /**
   * Create a new context snapshot
   */
  async createContextSnapshot(
    workflowId: string,
    metadata: {
      reason: string;
      createdBy: string;
      tags: string[];
    }
  ): Promise<ContextVersion> {
    try {
      const response = await fetch(
        `${this.baseUrl}/workflows/${workflowId}/context/versions`,
        {
          method: "POST",
          headers: this.getAuthHeaders(),
          credentials: "include",
          body: JSON.stringify(metadata),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to create context snapshot: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<ContextVersion> = await response.json();
      return data.data;
    } catch (error) {
      console.error("Error creating context snapshot:", error);
      throw error;
    }
  }

  /**
   * Rollback to a specific context version
   */
  async rollbackToContextVersion(
    workflowId: string,
    rollbackRequest: ContextRollbackRequest
  ): Promise<ContextVersion> {
    try {
      const response = await fetch(
        `${this.baseUrl}/workflows/${workflowId}/context/rollback`,
        {
          method: "POST",
          headers: this.getAuthHeaders(),
          credentials: "include",
          body: JSON.stringify(rollbackRequest),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to rollback context version: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<ContextVersion> = await response.json();
      return data.data;
    } catch (error) {
      console.error("Error rolling back context version:", error);
      throw error;
    }
  }

  /**
   * Get agent coordination status
   */
  async getAgentCoordination(
    workflowId: string
  ): Promise<AgentCoordinationResponse> {
    try {
      const response = await fetch(
        `${this.baseUrl}/workflows/${workflowId}/agents/coordination`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch agent coordination data: ${response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching agent coordination data:", error);
      throw error;
    }
  }

  /**
   * Get coordination events for a workflow
   */
  async getCoordinationEvents(
    workflowId: string
  ): Promise<CoordinationEvent[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/workflows/${workflowId}/agents/events`,
        {
          method: "GET",
          headers: this.getAuthHeaders(),
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch coordination events: ${response.statusText}`
        );
      }

      const data: WorkflowApiResponse<CoordinationEvent[]> =
        await response.json();
      return data.data;
    } catch (error) {
      console.error("Error fetching coordination events:", error);
      throw error;
    }
  }
}

// Export singleton instance
export const workflowService = new WorkflowService();

// Export the service class for dependency injection if needed
export default WorkflowService;
