import axios, { type AxiosAdapter } from "axios";
import { describe, expect, it, vi } from "vitest";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  EntityType,
  type PrivateBetaAccessApiSubmitPrivateBetaAccessRequestRequest,
  type PrivateBetaAccessApiUpdatePrivateBetaSelfServiceAdmissionModeRequest,
  type ListStars200Response,
  type ListOrganizationDirectory200Response,
  type StarEntity200Response,
  type SubmitPrivateBetaAccessRequest202Response,
  type SubmitOnboardingReply202Response,
  type SubmitOnboardingReplyRequestDto,
  type OrganizationsOrganizationIdProjectsProjectIdTasksGet200Response,
  type OrganizationsOrganizationIdProjectsProjectIdTasksPost201Response,
  type CreateTaskDto,
  type TaskResponseDto,
} from "../../api";
import { createApiRuntime, type ApiTransport } from "../createApiRuntime";
import { UnifiedApiClient } from "../serviceClients";

const createTransport = (): ApiTransport => ({
  axios: axios.create(),
  request: vi.fn(),
  setAuthToken: vi.fn(),
  onUnauthorized: vi.fn(() => () => undefined),
});

const createTaskResponse =
  (): OrganizationsOrganizationIdProjectsProjectIdTasksPost201Response => ({
    success: true,
    data: null,
  });

const createTaskListResponse =
  (): OrganizationsOrganizationIdProjectsProjectIdTasksGet200Response => ({
    success: true,
    data: [],
  });

const createStarsListResponse = (): ListStars200Response => ({
  success: true,
  message: "ok",
  timestamp: "now",
  statusCode: 200,
  data: [],
});

const createStarResponse = (): StarEntity200Response => ({
  success: true,
  message: "ok",
  timestamp: "now",
  statusCode: 200,
  data: undefined,
});

describe("UnifiedApiClient stars", () => {
  it("routes generated star operations through the dedicated Stars client", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const listStars = vi
      .spyOn(runtime.clients.stars, "listStars")
      .mockResolvedValue({
        data: createStarsListResponse(),
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });
    const starEntity = vi
      .spyOn(runtime.clients.stars, "starEntity")
      .mockResolvedValue({
        data: createStarResponse(),
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });
    const unstarEntity = vi
      .spyOn(runtime.clients.stars, "unstarEntity")
      .mockResolvedValue({
        data: undefined,
        status: 204,
        statusText: "No Content",
        headers: {},
        config: {},
      });

    await client.listStars({ organizationId: "org-1" });
    await client.listStars({
      organizationId: "org-1",
      entityType: EntityType.Project,
    });
    await client.starEntity({
      organizationId: "org-1",
      entityType: EntityType.Project,
      entityId: "project-1",
    });
    await client.unstarEntity({
      organizationId: "org-1",
      entityType: EntityType.Project,
      entityId: "project-1",
    });

    expect(runtime.clients.stars).toBeDefined();
    expect(listStars).toHaveBeenNthCalledWith(1, {
      organizationId: "org-1",
    });
    expect(listStars).toHaveBeenNthCalledWith(2, {
      organizationId: "org-1",
      entityType: EntityType.Project,
    });
    expect(starEntity).toHaveBeenCalledWith({
      organizationId: "org-1",
      entityType: EntityType.Project,
      entityId: "project-1",
    });
    expect(unstarEntity).toHaveBeenCalledWith({
      organizationId: "org-1",
      entityType: EntityType.Project,
      entityId: "project-1",
    });
  });
});

describe("UnifiedApiClient organization directory", () => {
  it("forwards the generated directory query to OrganizationsApi", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const response: ListOrganizationDirectory200Response = {
      success: true,
      message: "ok",
      data: { organizations: [], totalCount: 0, nextCursor: null },
      timestamp: "now",
      statusCode: 200,
    };
    const listOrganizationDirectory = vi
      .spyOn(runtime.clients.organizations, "listOrganizationDirectory")
      .mockResolvedValue({
        data: response,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });

    await client.listOrganizationDirectory({
      name: "Acme",
      sortBy: "memberCount",
      sortOrder: "desc",
      cursor: "page-2",
      limit: 25,
    });

    expect(listOrganizationDirectory).toHaveBeenCalledWith({
      name: "Acme",
      sortBy: "memberCount",
      sortOrder: "desc",
      cursor: "page-2",
      limit: 25,
    });
  });
});

describe("proposal-backed entity prompt-template clients", () => {
  it("exposes generated template reads and standard proposal creation", () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    expect(
      runtime.clients.entityPromptTemplates
        .getProjectEntityPromptTemplateCatalog,
    ).toBeTypeOf("function");
    expect(
      runtime.clients.entityPromptTemplates.getEffectiveEntityPromptTemplate,
    ).toBeTypeOf("function");
    expect(runtime.clients.proposals.createProposal).toBeTypeOf("function");
    expect(
      "publishProjectEntityPromptTemplateRevision" in
        runtime.clients.entityPromptTemplates,
    ).toBe(false);
    expect(
      "retireProjectEntityPromptTemplateOverride" in
        runtime.clients.entityPromptTemplates,
    ).toBe(false);
  });
});

describe("UnifiedApiClient task reads", () => {
  it("forwards task launch config unchanged through generated task creation", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const createTask = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdTasksPost",
      )
      .mockResolvedValue({
        data: createTaskResponse(),
        status: 201,
        statusText: "Created",
        headers: {},
        config: {},
      });
    const config = {
      kind: "INITIAL_WORKTREE" as const,
      version: "v1" as const,
      initialWorktreeBranch: "feature/launch-default",
    };
    const createTaskDto: CreateTaskDto = {
      name: "Configured task",
      type: "STANDARD",
      config,
    };

    await client.createTask({
      organizationId: "org-1",
      projectId: "project-1",
      createTaskDto,
    });

    expect(createTask).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      createTaskDto,
    });
  });

  it("retains task launch config from generated collection reads", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const config = {
      kind: "INITIAL_WORKTREE" as const,
      version: "v1" as const,
      initialWorktreeBranch: null,
    };
    const configuredTask = {
      id: "task-1",
      name: "Configured task",
      type: "STANDARD",
      organizationId: "org-1",
      projectId: "project-1",
      status: "BACKLOG" as const,
      source: "system" as const,
      config,
    } as TaskResponseDto;
    const getTasks = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdTasksGet",
      )
      .mockResolvedValue({
        data: {
          success: true,
          data: [configuredTask],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      } as any);

    const response = await client.getTasks({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(getTasks).toHaveBeenCalled();
    expect(response.data.data?.[0]?.config).toEqual(config);
  });

  it("loads a graph-capable work-item aggregate through the tasks client", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const getWorkItemGraph = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdWorkItemsWorkItemIdGraphGet",
      )
      .mockResolvedValue({
        data: {
          success: true,
          message: "ok",
          timestamp: "now",
          statusCode: 200,
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });

    await client.getWorkItemGraph({
      organizationId: "org-1",
      projectId: "project-1",
      workItemId: "workflow-1",
      incidentRelationshipTypes: new Set(["GUARANTEES"]),
    });

    expect(getWorkItemGraph).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      workItemId: "workflow-1",
      incidentRelationshipTypes: new Set(["GUARANTEES"]),
    }, undefined);
  });

  it("threads bounded task IDs through the generated collection read", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const getTasks = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdTasksGet",
      )
      .mockResolvedValue({
        data: createTaskListResponse(),
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });

    await client.getTasks({
      organizationId: "org-1",
      projectId: "project-1",
      taskIds: ["task-1", "task-2"],
      includeServiceRelations: true,
      includeEdges: true,
      includeTrackedEntities: false,
      edgeTypes: [AgentEdgeType.DependsOn],
    });

    const request = getTasks.mock.calls[0]?.[0];
    expect(request?.organizationId).toBe("org-1");
    expect(request?.projectId).toBe("project-1");
    expect(request?.taskIds).toEqual(new Set(["task-1", "task-2"]));
    expect(request?.includeServiceRelations).toBe(true);
    expect(request?.includeEdges).toBe(true);
    expect(request?.includeTrackedEntities).toBe(false);
    expect(request?.edgeTypes).toEqual([AgentEdgeType.DependsOn]);
  });

  it("forwards connected-entity filters without requesting edge hydration", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const getTasks = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdTasksGet",
      )
      .mockResolvedValue({
        data: createTaskListResponse(),
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });

    await client.getTasks({
      organizationId: "org-1",
      projectId: "project-1",
      type: "TASK_MONITOR",
      relatedEntityId: "plan-1",
      relatedEntityType: AgentEdgeEndpointEntityType.Plan,
      edgeTypes: [AgentEdgeType.RelatedTo],
    });

    const request = getTasks.mock.calls[0]?.[0];
    expect(request?.includeEdges).toBeUndefined();
    expect(request?.edgeTypes).toEqual([AgentEdgeType.RelatedTo]);
    expect(request?.type).toBe("TASK_MONITOR");
    expect(request?.relatedEntityId).toBe("plan-1");
    expect(request?.relatedEntityType).toBe(AgentEdgeEndpointEntityType.Plan);
  });

  it("omits includeEdges from the single-task read by default", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const getTask = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet",
      )
      .mockResolvedValue({
        data: createTaskResponse(),
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });

    await client.getTask({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "task-1",
    });

    expect(getTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        taskId: "task-1",
      }), undefined,
    );
  });

  it("requests includeEdges through the generated read parameter when enabled", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const getTask = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet",
      )
      .mockResolvedValue({
        data: createTaskResponse(),
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });

    await client.getTask({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "task-1",
      includeServiceRelations: true,
      includeEdges: true,
    });

    expect(getTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        taskId: "task-1",
        includeServiceRelations: true,
        includeEdges: true,
      }), undefined,
    );
  });

  it("requests edgeTypes through the generated read parameter when provided", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const getTask = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet",
      )
      .mockResolvedValue({
        data: createTaskResponse(),
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });

    await client.getTask({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "task-1",
      includeEdges: true,
      edgeTypes: [AgentEdgeType.Standard, AgentEdgeType.FulfilledBy],
    });

    expect(getTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        taskId: "task-1",
        includeEdges: true,
        edgeTypes: [AgentEdgeType.Standard, AgentEdgeType.FulfilledBy],
      }), undefined,
    );
  });
});

describe("UnifiedApiClient private-beta access", () => {
  it("reads the public mode through the generated anonymous GET route", async () => {
    const transport = createTransport();
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({
      data: { success: true, data: { mode: "PAUSED" } },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    }));
    transport.axios.defaults.adapter = adapter;
    const runtime = createApiRuntime({ baseUrl: "/api/v1", transport });
    const result = await new UnifiedApiClient(
      runtime.clients
    ).getPublicPrivateBetaAdmissionMode();
    expect(result.data.data).toEqual({ mode: "PAUSED" });
    expect(adapter.mock.calls[0]?.[0]).toMatchObject({
      method: "get",
      url: "/api/v1/private-beta-access/admission-mode",
    });
    expect(
      adapter.mock.calls[0]?.[0].headers.get("Authorization")
    ).toBeUndefined();
  });

  it("delegates the generated submission operation without changing its DTO", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const submission: PrivateBetaAccessApiSubmitPrivateBetaAccessRequestRequest =
      {
        privateBetaAccessRequestSubmissionDto: {
          name: " Ada Lovelace ",
          workEmail: "ada@example.com",
          organizationName: "Analytical Engines",
        },
      };
    const response: SubmitPrivateBetaAccessRequest202Response = {
      success: true,
      message: "Request processed successfully",
      data: { accepted: true },
      timestamp: "2026-08-11T00:00:00.000Z",
      statusCode: 202,
    };
    const submit = vi
      .spyOn(
        runtime.clients.privateBetaAccess,
        "submitPrivateBetaAccessRequest"
      )
      .mockResolvedValue({
        data: response,
        status: 202,
        statusText: "Accepted",
        headers: {},
        config: {},
      });

    await client.submitPrivateBetaAccessRequest(submission);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(submission);
  });

  it("delegates demo sandbox resume, provisioning and current reads to the generated client", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const resume = vi
      .spyOn(runtime.clients.demoSandboxes, "resumeDemoSandbox")
      .mockResolvedValue({ data: {} } as never);
    const provision = vi
      .spyOn(runtime.clients.demoSandboxes, "provisionDemoSandbox")
      .mockResolvedValue({ data: {} } as never);
    const current = vi
      .spyOn(runtime.clients.demoSandboxes, "getCurrentDemoSandbox")
      .mockResolvedValue({ data: {} } as never);
    const request = {
      provisionDemoSandboxDto: {
        botCheckToken: "token",
        demoTermsVersion: "1.2-beta",
        agentBridgeAcknowledgmentVersion: "1.2-beta",
      },
    };

    await client.resumeDemoSandbox();
    await client.provisionDemoSandbox(request);
    await client.getCurrentDemoSandbox();

    expect(resume).toHaveBeenCalledWith();
    expect(provision).toHaveBeenCalledWith(request);
    expect(current).toHaveBeenCalledWith();
  });

  it("delegates admission-mode reads and updates without changing generated DTOs", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const read = vi
      .spyOn(
        runtime.clients.privateBetaAccess,
        "getPrivateBetaSelfServiceAdmissionMode"
      )
      .mockResolvedValue({ data: {} } as never);
    const publicRead = vi
      .spyOn(
        runtime.clients.privateBetaAccess,
        "getPublicPrivateBetaAdmissionMode"
      )
      .mockResolvedValue({ data: {} } as never);
    const update = vi
      .spyOn(
        runtime.clients.privateBetaAccess,
        "updatePrivateBetaSelfServiceAdmissionMode"
      )
      .mockResolvedValue({ data: {} } as never);
    const request: PrivateBetaAccessApiUpdatePrivateBetaSelfServiceAdmissionModeRequest =
      {
        updatePrivateBetaSelfServiceAdmissionModeDto: { mode: "PAUSED" },
      };

    await client.getPrivateBetaSelfServiceAdmissionMode();
    await client.getPublicPrivateBetaAdmissionMode();
    await client.updatePrivateBetaSelfServiceAdmissionMode(request);

    expect(read).toHaveBeenCalledWith();
    expect(publicRead).toHaveBeenCalledWith();
    expect(update).toHaveBeenCalledWith(request);
  });
});

describe("UnifiedApiClient onboarding replies", () => {
  it("forwards the closed onboarding admission request unchanged", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const request: SubmitOnboardingReplyRequestDto = {
      parentMessageId: "parent-message-1",
      expectedConversationVersion: 7,
      answers: {
        project_concept: "A graph-backed project workspace",
        feature_choice: "CREATE_INITIATIVE",
      },
    };
    const response: SubmitOnboardingReply202Response = {
      success: true,
      message: "Reply accepted",
      data: {
        id: "message-1",
        projectId: "project-1",
        type: "USER",
        status: "completed",
        data: request.answers,
        conversationId: "conversation-1",
        parentMessageId: request.parentMessageId,
        createdAt: "2026-08-28T00:00:00.000Z",
      },
      timestamp: "2026-08-28T00:00:00.000Z",
      statusCode: 202,
    };
    const submit = vi
      .spyOn(runtime.clients.conversationsApi, "submitOnboardingReply")
      .mockResolvedValue({
        data: response,
        status: 202,
        statusText: "Accepted",
        headers: {},
        config: {},
      });

    await client.submitOnboardingReply({
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      submitOnboardingReplyRequestDto: request,
    });

    expect(submit).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      submitOnboardingReplyRequestDto: request,
    });
  });
});

describe("UnifiedApiClient controller authorization routing", () => {
  it("routes preparation through the generated controller authorization client", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const transportFailure = new Error("stop before transport");
    const prepare = vi
      .spyOn(
        runtime.clients.controllerAuthorization,
        "prepareControllerAuthorization",
      )
      .mockRejectedValue(transportFailure);

    await expect(
      client.prepareControllerAuthorization({
        organizationId: "organization-1",
        projectId: "project-1",
        prepareControllerAuthorizationRequestDto: {
          machineId: "machine-1",
          controllerCredentialId: "credential-1",
          action: {
            requestId: "request-1",
            actionCategory: "TASK_MONITOR",
            actionType: "TASK_MONITOR_START",
            targetKind: "TASK_MONITOR",
            targetId: "task-monitor-1",
          },
        },
      }),
    ).rejects.toBe(transportFailure);

    expect(prepare).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      prepareControllerAuthorizationRequestDto: {
        machineId: "machine-1",
        controllerCredentialId: "credential-1",
        action: {
          requestId: "request-1",
          actionCategory: "TASK_MONITOR",
          actionType: "TASK_MONITOR_START",
          targetKind: "TASK_MONITOR",
          targetId: "task-monitor-1",
        },
      },
    });
  });
});

describe("UnifiedApiClient agent edges", () => {
  it("creates a typed relationship through the generated edge client", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const createAgentEdge = vi
      .spyOn(runtime.clients.agentEdges, "createAgentEdge")
      .mockResolvedValue({
        data: { success: true, data: null },
        status: 201,
        statusText: "Created",
        headers: {},
        config: {},
      });

    await client.createAgentEdge({
      organizationId: "org-1",
      projectId: "project-1",
      request: {
        sourceNodeId: "monitor-1",
        sourceEntityType: AgentEdgeEndpointEntityType.Task,
        targetNodeId: "plan-1",
        targetEntityType: AgentEdgeEndpointEntityType.Plan,
        type: AgentEdgeType.RelatedTo,
        reasoning: "Created from the Plan automation launch.",
        createdBySessionId: null,
      },
    });

    expect(createAgentEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        createAgentEdgeRequest: expect.objectContaining({
          sourceNodeId: "monitor-1",
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: "plan-1",
          targetEntityType: AgentEdgeEndpointEntityType.Plan,
          type: AgentEdgeType.RelatedTo,
          createdBySessionId: null,
        }),
      }),
    );
  });
});

describe("UnifiedApiClient problem reports", () => {
  it("routes the bounded report contract through the generated report client", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const reportBug = vi
      .spyOn(runtime.clients.reportBugs, "reportBug")
      .mockResolvedValue({
        data: {
          success: true,
          message: "Request processed successfully",
          timestamp: "2026-08-07T00:00:00.000Z",
          statusCode: 201,
          data: { bugId: "44444444-4444-4444-8444-444444444444" },
        },
        status: 201,
        statusText: "Created",
        headers: {},
        config: {},
      });
    const request = {
      description: "Saving a feature fails.",
      productLocation: "/projects/project-1/features/feature-1",
      correlationId: "correlation-123",
      diagnosticConsent: true,
    };

    await client.reportBug({ reportBugRequestDto: request });

    expect(reportBug).toHaveBeenCalledWith({ reportBugRequestDto: request });
  });
});
