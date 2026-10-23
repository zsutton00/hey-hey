import { describe, it, expect } from "vitest";
import {
  taskAdapter,
  initiativeAdapter,
  agentSessionAdapter,
  conversationAdapter,
  designDocAdapter,
  planAdapter,
  serviceAdapter,
  type AdapterOptions,
} from "../adapters";
import { getPathService, type PathService } from "../../../services";
import {
  WorkStatus,
  Priority,
  AgentSessionType,
  ConversationStatus,
  InitiationType,
  TaskSource,
  WorkflowName,
  type TaskResponseDto,
  type InitiativeResponseDto,
  type AgentSessionDto,
  type DesignDocResponseDto,
  type Service,
  type TrackedEntitySnapshot,
  type WorkItemTypeDefinitionDto,
  type ConversationResponseDto,
} from "../../../api";
import type { PlanWorkItem } from "../../../data/plans/canonicalPlan";

describe("Entity Adapters", () => {
  describe("taskAdapter", () => {
    const statusBearingDefinition: WorkItemTypeDefinitionDto = {
      key: "BUG",
      name: "Bug",
      sections: [],
      allowedStatuses: [WorkStatus.Active, WorkStatus.Completed],
      iconKey: "bug",
    };
    const statuslessDefinition: WorkItemTypeDefinitionDto = {
      key: "FEATURE",
      name: "Feature",
      sections: [],
      allowedStatuses: [],
      iconKey: "feature",
    };

    const mockTask: TaskResponseDto = {
      id: "task-1",
      organizationId: "org-1",
      name: "Fix authentication bug",
      sections: [
        {
          id: "task-1-description",
          key: "description",
          order: 0,
          materializedMarkdown: "Users cannot log in with OAuth",
          crdtSnapshotSeq: null,
        },
      ],
      status: WorkStatus.Active,
      priority: Priority.High,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      type: "BUG",
      childCounts: {
        total: 3,
        done: 1,
        inProgress: 1,
        backlog: 1,
      },
      designDocCount: 2,
      agentSessionCount: 5,
      assigneeId: "user-1",
      dueDate: "2024-12-31T00:00:00Z",
      initiativeId: "initiative-1",
    };

    it("should transform task with all fields", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
        users: {
          "user-1": { name: "John Doe", email: "john@example.com" },
        },
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);

      expect(result.title).toBe("Fix authentication bug");
      expect(result.description).toBe("Users cannot log in with OAuth");
      expect(result.status).toBe(WorkStatus.Active);
      expect(result.href).toContain("/projects/project-1");
      expect(result.href).toContain("/tasks/task-1");
    });

    it("uses the registry display name and preserves status for a status-bearing type", () => {
      const result = taskAdapter.toEntityListItemProps(mockTask, {
        showEntityKind: true,
        workItemTypeDefinition: statusBearingDefinition,
      });

      expect(result.entityKindLabel).toBe("Bug");
      expect(result.entityKindIcon).toBe("task");
      expect(result.workItemIcon).toEqual({
        typeKey: "BUG",
        definition: statusBearingDefinition,
      });
      expect(result.status).toBe(WorkStatus.Active);
    });

    it("withholds status for a registry type without lifecycle statuses", () => {
      const result = taskAdapter.toEntityListItemProps(
        { ...mockTask, type: "FEATURE" },
        {
          showEntityKind: true,
          workItemTypeDefinition: statuslessDefinition,
        }
      );

      expect(result.entityKindLabel).toBe("Feature");
      expect(result.entityKindIcon).toBe("task");
      expect(result.workItemIcon).toEqual({
        typeKey: "FEATURE",
        definition: statuslessDefinition,
      });
      expect(result.status).toBeUndefined();
    });

    it("fails closed while registry configuration is unresolved", () => {
      const result = taskAdapter.toEntityListItemProps(mockTask, {
        showEntityKind: true,
        workItemTypeDefinition: undefined,
      });

      expect(result.entityKindLabel).toBeUndefined();
      expect(result.entityKindIcon).toBe("task");
      expect(result.workItemIcon).toEqual({
        typeKey: "BUG",
        definition: undefined,
      });
      expect(result.status).toBeUndefined();
    });

    it("keeps legacy rendering unchanged without registry-aware options", () => {
      const result = taskAdapter.toEntityListItemProps(mockTask);

      expect(result.entityKindLabel).toBeUndefined();
      expect(result.entityKindIcon).toBeUndefined();
      expect(result.status).toBe(WorkStatus.Active);
    });

    it("should use injected pathService when provided", () => {
      const baseService = getPathService();
      const injectedPathService: PathService = {
        ...baseService,
        task: ({ taskId }) => `/custom/tasks/${taskId}`,
      };
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
        pathService: injectedPathService,
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);
      expect(result.href).toBe("/custom/tasks/task-1");
    });

    it("should include child counts", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);

      expect(result.counts).toBeDefined();
      expect(result.counts?.length).toBeGreaterThan(0);
      // Should have task counts group
      const taskCountsGroup = result.counts?.[0];
      expect(taskCountsGroup).toBeDefined();
    });

    it("should include design doc count when present", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);

      const designDocGroup = result.counts?.find((group) =>
        group.some((item) => item.label === "design doc")
      );
      expect(designDocGroup).toBeDefined();
      const designDocCount = designDocGroup?.find(
        (item) => item.label === "design doc"
      );
      expect(designDocCount?.count).toBe(2);
    });

    it("should include coding session count when present", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);

      const agentSessionGroup = result.counts?.find((group) =>
        group.some((item) => item.label === "agent session")
      );
      expect(agentSessionGroup).toBeDefined();
      const agentSessionCount = agentSessionGroup?.find(
        (item) => item.label === "agent session"
      );
      expect(agentSessionCount?.count).toBe(5);
    });

    it("should include assignee metadata when user is provided", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
        users: {
          "user-1": { name: "John Doe" },
        },
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);

      expect(result.metadata).toContainEqual({
        label: "assignee",
        value: "John Doe",
      });
    });

    it("should handle task without assignee", () => {
      const taskWithoutAssignee: TaskResponseDto = {
        ...mockTask,
        assigneeId: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
      };

      const result = taskAdapter.toEntityListItemProps(
        taskWithoutAssignee,
        options
      );

      expect(result.title).toBe("Fix authentication bug");
      expect(result.href).toBeDefined();
    });

    it("should handle task without due date", () => {
      const taskWithoutDueDate: TaskResponseDto = {
        ...mockTask,
        dueDate: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
      };

      const result = taskAdapter.toEntityListItemProps(
        taskWithoutDueDate,
        options
      );

      expect(result.title).toBe("Fix authentication bug");
    });

    it("should not generate href without required IDs", () => {
      const result = taskAdapter.toEntityListItemProps(mockTask, {});

      expect(result.href).toBeUndefined();
    });

    it("should handle custom onClick handler", () => {
      const handleClick = () => {};
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
        onClick: handleClick,
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);

      expect(result.onClick).toBe(handleClick);
    });

    it("should handle custom onDelete handler", () => {
      const handleDelete = () => {};
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
        onDelete: handleDelete,
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);

      expect(result.onDelete).toBe(handleDelete);
    });

    it("should forward createdAt and updatedAt", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, options);

      expect(result.createdAt).toBe("2024-01-01T00:00:00Z");
      expect(result.updatedAt).toBe("2024-01-01T00:00:00Z");
    });

    it("should leave createdAt and updatedAt undefined when task has none", () => {
      const taskWithoutDates: TaskResponseDto = {
        ...mockTask,
        createdAt: undefined,
        updatedAt: undefined,
      };

      const result = taskAdapter.toEntityListItemProps(taskWithoutDates, {
        projectId: "project-1",
        initiativeId: "initiative-1",
      });

      expect(result.createdAt).toBeUndefined();
      expect(result.updatedAt).toBeUndefined();
    });

    it("should handle task with no counts", () => {
      const taskWithNoCounts: TaskResponseDto = {
        ...mockTask,
        childCounts: undefined,
        designDocCount: undefined,
        agentSessionCount: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
        initiativeId: "initiative-1",
      };

      const result = taskAdapter.toEntityListItemProps(
        taskWithNoCounts,
        options
      );

      expect(result.counts).toBeUndefined();
    });

    describe("dependencies", () => {
      const stubPathService: PathService = {
        ...getPathService(),
        task: ({ taskId }) => `/stub/tasks/${taskId}`,
      };

      it("omits dependencies when task.edges is absent", () => {
        const result = taskAdapter.toEntityListItemProps(mockTask, {
          projectId: "project-1",
          pathService: stubPathService,
        });

        expect(result.dependencies).toBeUndefined();
      });

      it("omits dependencies when task.edges is empty", () => {
        const result = taskAdapter.toEntityListItemProps(
          { ...mockTask, edges: [] },
          { projectId: "project-1", pathService: stubPathService }
        );

        expect(result.dependencies).toBeUndefined();
      });

      it("emits a sorted, direction-aware payload with hrefs and titles", () => {
        const taskWithEdges: TaskResponseDto = {
          ...mockTask,
          edges: [
            {
              id: "edge-related",
              type: "RELATED_TO",
              sourceNodeId: mockTask.id,
              targetNodeId: "task-related",
              reasoning: "context",
              createdBySessionId: "s1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
            {
              id: "edge-blocking",
              type: "DEPENDS_ON",
              sourceNodeId: mockTask.id,
              targetNodeId: "task-blocker",
              reasoning: "must finish first",
              createdBySessionId: "s2",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
            {
              id: "edge-incoming-block",
              type: "DEPENDS_ON",
              sourceNodeId: "task-downstream",
              targetNodeId: mockTask.id,
              reasoning: "downstream waits on us",
              createdBySessionId: "s3",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        };

        const result = taskAdapter.toEntityListItemProps(taskWithEdges, {
          projectId: "project-1",
          pathService: stubPathService,
          relatedEntities: {
            tasks: {
              "task-blocker": { name: "Blocker task" },
              "task-related": { name: "Related task" },
              "task-downstream": { name: "Downstream task" },
            },
          },
        });

        expect(result.dependencies).toEqual([
          {
            edgeType: "DEPENDS_ON",
            direction: "outgoing",
            targetTitle: "Blocker task",
            href: "/stub/tasks/task-blocker",
          },
          {
            edgeType: "DEPENDS_ON",
            direction: "incoming",
            targetTitle: "Downstream task",
            href: "/stub/tasks/task-downstream",
          },
          {
            edgeType: "RELATED_TO",
            direction: "outgoing",
            targetTitle: "Related task",
            href: "/stub/tasks/task-related",
          },
        ]);
      });

      it("prefers connected node names from edge endpoints", () => {
        const taskWithEdges: TaskResponseDto = {
          ...mockTask,
          edges: [
            {
              id: "edge-outgoing",
              type: "DEPENDS_ON",
              sourceNodeId: mockTask.id,
              targetNodeId: "task-blocker",
              targetNodeName: "Named blocker from edge",
              reasoning: "must finish first",
              createdBySessionId: "s1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
            {
              id: "edge-incoming",
              type: "RELATED_TO",
              sourceNodeId: "task-downstream",
              sourceNodeName: "Named downstream from edge",
              targetNodeId: mockTask.id,
              reasoning: "downstream references us",
              createdBySessionId: "s2",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        };

        const result = taskAdapter.toEntityListItemProps(taskWithEdges, {
          projectId: "project-1",
          pathService: stubPathService,
          relatedEntities: {
            tasks: {
              "task-blocker": { name: "Lookup blocker" },
              "task-downstream": { name: "Lookup downstream" },
            },
          },
        });

        expect(result.dependencies).toEqual([
          {
            edgeType: "DEPENDS_ON",
            direction: "outgoing",
            targetTitle: "Named blocker from edge",
            href: "/stub/tasks/task-blocker",
          },
          {
            edgeType: "RELATED_TO",
            direction: "incoming",
            targetTitle: "Named downstream from edge",
            href: "/stub/tasks/task-downstream",
          },
        ]);
      });

      it("resolves outgoing subtype icons and incoming endpoint types", () => {
        const taskWithEdges: TaskResponseDto = {
          ...mockTask,
          edges: [
            {
              id: "edge-feature",
              type: "RELATED_TO",
              sourceNodeId: mockTask.id,
              targetNodeId: "feature-task",
              targetEntityType: "TASK",
              targetNodeType: "FEATURE",
              targetNodeName: "Feature task",
              reasoning: "context",
              createdBySessionId: "s1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
            {
              id: "edge-incoming",
              type: "DEPENDS_ON",
              sourceNodeId: "initiative-source",
              sourceEntityType: "INITIATIVE",
              sourceNodeName: "Source initiative",
              targetNodeId: mockTask.id,
              reasoning: "context",
              createdBySessionId: "s2",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
            {
              id: "edge-legacy",
              type: "EVOLVES",
              sourceNodeId: mockTask.id,
              targetNodeId: "legacy-target",
              targetNodeName: "Legacy target",
              reasoning: "legacy",
              createdBySessionId: "s3",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        };

        const result = taskAdapter.toEntityListItemProps(taskWithEdges, {
          projectId: "project-1",
          pathService: stubPathService,
        });

        expect(result.dependencies).toEqual([
          {
            edgeType: "DEPENDS_ON",
            direction: "incoming",
            entityType: "INITIATIVE",
            targetTitle: "Source initiative",
            href: "/stub/tasks/initiative-source",
          },
          {
            edgeType: "EVOLVES",
            direction: "outgoing",
            targetTitle: "Legacy target",
            href: "/stub/tasks/legacy-target",
          },
          {
            edgeType: "RELATED_TO",
            direction: "outgoing",
            entityType: "FEATURE",
            targetTitle: "Feature task",
            href: "/stub/tasks/feature-task",
          },
        ]);
      });

      it("falls back to a short id when the connected task is not in relatedEntities", () => {
        const longId = "abcdef1234567890";
        const taskWithEdges: TaskResponseDto = {
          ...mockTask,
          edges: [
            {
              id: "edge-1",
              type: "RELATED_TO",
              sourceNodeId: mockTask.id,
              targetNodeId: longId,
              reasoning: "",
              createdBySessionId: "s1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        };

        const result = taskAdapter.toEntityListItemProps(taskWithEdges, {
          projectId: "project-1",
          pathService: stubPathService,
          // No relatedEntities passed at all — adapter should not skip,
          // and should fall back to a short id.
        });

        expect(result.dependencies).toEqual([
          {
            edgeType: "RELATED_TO",
            direction: "outgoing",
            targetTitle: "abcdef12…",
            href: `/stub/tasks/${longId}`,
          },
        ]);
      });

      it("emits a tracked count chip and goal href for GOAL-typed tasks", () => {
        const trackedEntities: TrackedEntitySnapshot[] = [
          {
            targetEntityId: "task-tracked-1",
            targetEntityType: "TASK",
            title: "Tracked task 1",
          },
          {
            targetEntityId: "task-tracked-2",
            targetEntityType: "TASK",
            title: "Tracked task 2",
          },
          {
            targetEntityId: "plan-tracked",
            targetEntityType: "PLAN",
            title: "Tracked plan",
          },
        ];

        const goalTask: TaskResponseDto = {
          ...mockTask,
          type: "GOAL",
          trackedEntities,
        };

        const result = taskAdapter.toEntityListItemProps(goalTask, {
          projectId: "project-1",
        });

        const trackedGroup = result.counts?.find((group) =>
          group.some((item) => item.label === "tracked")
        );
        expect(trackedGroup).toBeDefined();
        const trackedCount = trackedGroup?.find(
          (item) => item.label === "tracked"
        );
        expect(trackedCount?.count).toBe(trackedEntities.length);
        expect(result.href).toBe("/projects/project-1/tasks/task-1");
      });

      it("prefers the compact tracked-work summary for the GOAL tracked count", () => {
        const goalTask: TaskResponseDto = {
          ...mockTask,
          type: "GOAL",
          trackedWorkSummary: {
            totalCount: 4,
            completedCount: 1,
            cancelledCount: 0,
            pastDueCount: 0,
            openUndatedCount: 1,
          },
        };

        const result = taskAdapter.toEntityListItemProps(goalTask, {
          projectId: "project-1",
        });

        const trackedCount = result.counts
          ?.flat()
          .find((item) => item.label === "tracked");
        expect(trackedCount?.count).toBe(4);
      });

      it("omits the tracked count when a GOAL summary reports no tracked work", () => {
        const goalTask: TaskResponseDto = {
          ...mockTask,
          type: "GOAL",
          trackedWorkSummary: {
            totalCount: 0,
            completedCount: 0,
            cancelledCount: 0,
            pastDueCount: 0,
            openUndatedCount: 0,
          },
        };

        const result = taskAdapter.toEntityListItemProps(goalTask, {
          projectId: "project-1",
        });

        expect(
          result.counts?.flat().some((item) => item.label === "tracked")
        ).toBe(false);
      });

      it("does not emit a tracked chip for non-GOAL tasks even when trackedEntities is populated", () => {
        const defensiveTask: TaskResponseDto = {
          ...mockTask,
          type: "STANDARD",
          trackedEntities: [
            {
              targetEntityId: "task-tracked-1",
              targetEntityType: "TASK",
              title: "Tracked task 1",
            },
          ],
        };

        const result = taskAdapter.toEntityListItemProps(defensiveTask, {
          projectId: "project-1",
          initiativeId: "initiative-1",
        });

        const trackedGroup = result.counts?.find((group) =>
          group.some((item) => item.label === "tracked")
        );
        expect(trackedGroup).toBeUndefined();
        expect(result.href).toContain("/tasks/task-1");
        expect(result.href).not.toContain("/goals/");
      });

      it("falls back to a short id for targets not in the tasks lookup", () => {
        const taskWithEdges: TaskResponseDto = {
          ...mockTask,
          edges: [
            {
              id: "edge-doc",
              type: "DERIVES_FROM",
              sourceNodeId: mockTask.id,
              targetNodeId: "design-doc-1",
              reasoning: "",
              createdBySessionId: "s1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
            {
              id: "edge-task",
              type: "RELATED_TO",
              sourceNodeId: mockTask.id,
              targetNodeId: "task-known",
              reasoning: "",
              createdBySessionId: "s1",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        };

        const result = taskAdapter.toEntityListItemProps(taskWithEdges, {
          projectId: "project-1",
          pathService: stubPathService,
          relatedEntities: {
            tasks: { "task-known": { name: "Known task" } },
          },
        });

        expect(result.dependencies).toEqual([
          {
            edgeType: "DERIVES_FROM",
            direction: "outgoing",
            targetTitle: "design-d…",
            href: "/stub/tasks/design-doc-1",
          },
          {
            edgeType: "RELATED_TO",
            direction: "outgoing",
            targetTitle: "Known task",
            href: "/stub/tasks/task-known",
          },
        ]);
      });
    });
  });

  describe("initiativeAdapter", () => {
    const mockInitiative: InitiativeResponseDto = {
      id: "initiative-1",
      organizationId: "org-1",
      name: "Implement dark mode",
      sections: [
        {
          id: "initiative-1-description",
          key: "description",
          order: 0,
          materializedMarkdown: "Add dark theme across the application",
          crdtSnapshotSeq: null,
        },
      ],
      status: WorkStatus.Active,
      priority: Priority.Medium,
      tags: ["ui", "enhancement"],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      childCounts: {
        total: 5,
        done: 2,
        inProgress: 2,
        backlog: 1,
      },
      designDocCount: 1,
      assigneeId: "user-2",
      dueDate: "2024-06-30T00:00:00Z",
    };

    it("should transform initiative with all fields", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
        users: {
          "user-2": { name: "Jane Smith", email: "jane@example.com" },
        },
      };

      const result = initiativeAdapter.toEntityListItemProps(
        mockInitiative,
        options
      );

      expect(result.title).toBe("Implement dark mode");
      expect(result.description).toBe("Add dark theme across the application");
      expect(result.status).toBe(WorkStatus.Active);
      expect(result.tags).toEqual(["ui", "enhancement"]);
      expect(result.href).toContain("/projects/project-1");
      expect(result.href).toContain("/initiatives/initiative-1");
    });

    it("supplies its canonical kind only when requested", () => {
      expect(
        initiativeAdapter.toEntityListItemProps(mockInitiative).entityKindLabel
      ).toBeUndefined();
      expect(
        initiativeAdapter.toEntityListItemProps(mockInitiative, {
          showEntityKind: true,
        }).entityKindLabel
      ).toBe("Initiative");
      expect(
        initiativeAdapter.toEntityListItemProps(mockInitiative, {
          showEntityKind: true,
        }).entityKindIcon
      ).toBe("initiative");
    });

    it("should include child counts", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = initiativeAdapter.toEntityListItemProps(
        mockInitiative,
        options
      );

      expect(result.counts).toBeDefined();
      expect(result.counts?.length).toBeGreaterThan(0);
    });

    it("should handle initiative without tags", () => {
      const initiativeWithoutTags: InitiativeResponseDto = {
        ...mockInitiative,
        tags: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = initiativeAdapter.toEntityListItemProps(
        initiativeWithoutTags,
        options
      );

      expect(result.tags).toBeUndefined();
    });

    it("should handle initiative without assignee", () => {
      const initiativeWithoutAssignee: InitiativeResponseDto = {
        ...mockInitiative,
        assigneeId: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = initiativeAdapter.toEntityListItemProps(
        initiativeWithoutAssignee,
        options
      );

      expect(result.title).toBe("Implement dark mode");
    });

    it("should not generate href without project ID", () => {
      const result = initiativeAdapter.toEntityListItemProps(
        mockInitiative,
        {}
      );

      expect(result.href).toBeUndefined();
    });

    it("should handle custom handlers", () => {
      const handleClick = () => {};
      const handleDelete = () => {};
      const options: AdapterOptions = {
        projectId: "project-1",
        onClick: handleClick,
        onDelete: handleDelete,
      };

      const result = initiativeAdapter.toEntityListItemProps(
        mockInitiative,
        options
      );

      expect(result.onClick).toBe(handleClick);
      expect(result.onDelete).toBe(handleDelete);
    });
  });

  describe("agentSessionAdapter", () => {
    const mockSession: AgentSessionDto = {
      id: "session-1",
      organizationId: "org-1",
      userId: "user-1",
      status: "IN_PROGRESS",
      type: AgentSessionType.Coding,
      title: "Implement OAuth flow",
      sessionDate: "2024-01-15T10:30:00Z",
      conversationId: "conv-1",
      initiativeId: "initiative-1",
      taskId: "task-1",
      designDocId: "doc-1",
      createdAt: "2024-01-15T10:30:00Z",
      updatedAt: "2024-01-15T10:30:00Z",
    };

    it("should transform coding session with all fields", () => {
      const sessionWithDetails: AgentSessionDto = {
        ...mockSession,
        user: {
          id: "user-1",
          name: "Bob Johnson",
          email: "bob@test.com",
          isActive: true,
          createdAt: "",
          updatedAt: "",
        },
        service: { id: "svc-1", name: "Auth Service" },
        provider: "claude",
      };

      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = agentSessionAdapter.toEntityListItemProps(
        sessionWithDetails,
        options
      );

      expect(result.title).toBe("Implement OAuth flow");
      expect(result.status).toBe("In Progress");
      expect(result.tags).toContain("Bob Johnson");
      expect(result.tags).toContain("Auth Service");
      expect(result.tags).toContain("Claude");
      expect(result.metadata).toEqual([
        { label: "User", value: "Bob Johnson" },
        { label: "Service", value: "Auth Service" },
        { label: "Provider", value: "Claude" },
      ]);
      expect(result.agentSessionType).toBe(AgentSessionType.Coding);
      expect(result.conversationId).toBe("conv-1");
      expect(result.href).toContain("/projects/project-1");
      expect(result.href).toContain("/resolve-agent-session-by-id/session-1");
    });

    it("should show user from options.users fallback", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
        users: {
          "user-1": { name: "Bob Johnson" },
        },
      };

      const result = agentSessionAdapter.toEntityListItemProps(
        mockSession,
        options
      );

      expect(result.tags).toContain("Bob Johnson");
    });

    it("should handle untitled session", () => {
      const untitledSession: AgentSessionDto = {
        ...mockSession,
        title: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = agentSessionAdapter.toEntityListItemProps(
        untitledSession,
        options
      );

      expect(result.title).toBe("Untitled agent session");
    });

    it("should show provider as Codex tag", () => {
      const sessionWithCodex: AgentSessionDto = {
        ...mockSession,
        provider: "codex",
      };

      const result = agentSessionAdapter.toEntityListItemProps(
        sessionWithCodex,
        { projectId: "project-1" }
      );

      expect(result.tags).toContain("Codex");
    });

    it("should append the trimmed worktree branch for a coding session", () => {
      const sessionWithWorktree: AgentSessionDto = {
        ...mockSession,
        config: {
          type: "CODING_SESSION",
          version: "v2",
          model: "gpt-5.6-codex",
          worktree: " feature/shared-session-rows ",
        },
      };

      const result =
        agentSessionAdapter.toEntityListItemProps(sessionWithWorktree);

      expect(result.tags).toEqual(["feature/shared-session-rows"]);
    });

    it.each([
      [
        "blank",
        {
          type: "CODING_SESSION",
          version: "v2",
          model: "gpt-5.6-codex",
          worktree: "   ",
        } satisfies NonNullable<AgentSessionDto["config"]>,
      ],
      ["absent", undefined],
    ])("should omit a %s coding-session worktree", (_case, config) => {
      const result = agentSessionAdapter.toEntityListItemProps({
        ...mockSession,
        config,
      });

      expect(result.tags).toBeUndefined();
    });

    it("should not append config metadata for a non-coding session", () => {
      const nonCodingSession: AgentSessionDto = {
        ...mockSession,
        type: AgentSessionType.EntityConversation,
        config: {
          type: "ENTITY_CONVERSATION",
          version: "v1",
          model: "gpt-5.6-codex",
        },
      };

      const result =
        agentSessionAdapter.toEntityListItemProps(nonCodingSession);

      expect(result.tags).toBeUndefined();
    });

    it("should preserve the authoritative non-coding session subtype", () => {
      const sessionWithSubtype: AgentSessionDto = {
        ...mockSession,
        type: AgentSessionType.EntityConversation,
      };

      const result = agentSessionAdapter.toEntityListItemProps(
        sessionWithSubtype,
        { projectId: "project-1" }
      );

      expect(result.agentSessionType).toBe(AgentSessionType.EntityConversation);
    });

    it("should format status correctly", () => {
      const result = agentSessionAdapter.toEntityListItemProps(mockSession, {
        projectId: "project-1",
      });

      expect(result.status).toBe("In Progress");
    });

    it("should show session date as description", () => {
      const result = agentSessionAdapter.toEntityListItemProps(mockSession, {
        projectId: "project-1",
      });

      expect(result.description).toBeDefined();
      expect(result.description).toContain("2024");
    });

    it("should handle session without date", () => {
      const sessionWithoutDate: AgentSessionDto = {
        ...mockSession,
        sessionDate: undefined,
      };

      const result = agentSessionAdapter.toEntityListItemProps(
        sessionWithoutDate,
        { projectId: "project-1" }
      );

      expect(result.description).toBe("No date");
    });

    it("should not generate href without project ID", () => {
      const result = agentSessionAdapter.toEntityListItemProps(mockSession, {});

      expect(result.href).toBeUndefined();
    });
  });

  describe("designDocAdapter", () => {
    const mockDesignDoc: DesignDocResponseDto = {
      id: "doc-1",
      organizationId: "org-1",
      name: "Authentication Architecture",
      summary: "Comprehensive authentication design",
      template: "architecture",
      status: "draft",
      tags: ["security", "backend"],
      sections: {},
      metadata: {},
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    it("should transform design doc with all fields", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = designDocAdapter.toEntityListItemProps(
        mockDesignDoc,
        options
      );

      expect(result.title).toBe("Authentication Architecture");
      expect(result.description).toBe("Comprehensive authentication design");
      expect(result.status).toBe("draft");
      expect(result.tags).toContain("security");
      expect(result.tags).toContain("backend");
      expect(result.tags).toContain("Template: architecture");
      expect(result.href).toContain("/projects/project-1");
      expect(result.href).toContain("/design-docs/doc-1");
    });

    it("supplies the canonical design-doc kind when requested", () => {
      const result = designDocAdapter.toEntityListItemProps(mockDesignDoc, {
        showEntityKind: true,
      });

      expect(result.entityKindLabel).toBe("Design doc");
      expect(result.entityKindIcon).toBe("design_doc");
    });

    it("maps design docs to the shared simple reference presentation", () => {
      const result = designDocAdapter.toEntityListItemProps(mockDesignDoc, {
        projectId: "project-1",
        showEntityKind: true,
        presentation: "reference",
      });

      expect(result).toEqual({
        title: "Authentication Architecture",
        entityKindLabel: "Design doc",
        entityKindIcon: "design_doc",
        displayMode: "list",
      });
    });

    it("should include template as tag", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = designDocAdapter.toEntityListItemProps(
        mockDesignDoc,
        options
      );

      expect(result.tags).toContain("Template: architecture");
    });

    it("should handle design doc without tags", () => {
      const docWithoutTags: DesignDocResponseDto = {
        ...mockDesignDoc,
        tags: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = designDocAdapter.toEntityListItemProps(
        docWithoutTags,
        options
      );

      // Should still have template tag
      expect(result.tags).toEqual(["Template: architecture"]);
    });

    it("should handle design doc without summary", () => {
      const docWithoutSummary: DesignDocResponseDto = {
        ...mockDesignDoc,
        summary: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = designDocAdapter.toEntityListItemProps(
        docWithoutSummary,
        options
      );

      expect(result.description).toBeUndefined();
    });

    it("should not generate href without project ID", () => {
      const result = designDocAdapter.toEntityListItemProps(mockDesignDoc, {});

      expect(result.href).toBeUndefined();
    });

    it("should handle custom handlers", () => {
      const handleClick = () => {};
      const handleDelete = () => {};
      const options: AdapterOptions = {
        projectId: "project-1",
        onClick: handleClick,
        onDelete: handleDelete,
      };

      const result = designDocAdapter.toEntityListItemProps(
        mockDesignDoc,
        options
      );

      expect(result.onClick).toBe(handleClick);
      expect(result.onDelete).toBe(handleDelete);
    });
  });

  describe("serviceAdapter", () => {
    const mockService: Service = {
      id: "service-1",
      organizationId: "org-1",
      name: "User API",
      description: "User management service",
      status: "active",
      serviceType: "api",
      language: "TypeScript",
      framework: "NestJS",
      tags: ["backend", "users"],
      repositoryUrl: "https://github.com/org/user-api",
      repositoryType: "github",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    it("should transform service with all fields", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = serviceAdapter.toEntityListItemProps(mockService, options);

      expect(result.title).toBe("User API");
      expect(result.description).toBe("User management service");
      expect(result.status).toBe("active");
      expect(result.tags).toContain("backend");
      expect(result.tags).toContain("users");
      expect(result.tags).toContain("api");
      expect(result.tags).toContain("TypeScript");
      expect(result.href).toContain("/projects/project-1");
      expect(result.href).toContain("/services/service-1");
    });

    it("supplies the canonical service kind when requested", () => {
      const result = serviceAdapter.toEntityListItemProps(mockService, {
        showEntityKind: true,
      });

      expect(result.entityKindLabel).toBe("Service");
      expect(result.entityKindIcon).toBe("service");
    });

    it("maps services to the shared simple reference presentation", () => {
      const result = serviceAdapter.toEntityListItemProps(mockService, {
        projectId: "project-1",
        showEntityKind: true,
        presentation: "reference",
      });

      expect(result).toEqual({
        title: "User API",
        entityKindLabel: "Service",
        entityKindIcon: "service",
        displayMode: "list",
      });
    });

    it("should include service type as tag", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = serviceAdapter.toEntityListItemProps(mockService, options);

      expect(result.tags).toContain("api");
    });

    it("should include language as tag", () => {
      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = serviceAdapter.toEntityListItemProps(mockService, options);

      expect(result.tags).toContain("TypeScript");
    });

    it("should handle service without description", () => {
      const serviceWithoutDescription: Service = {
        ...mockService,
        description: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = serviceAdapter.toEntityListItemProps(
        serviceWithoutDescription,
        options
      );

      expect(result.description).toBeUndefined();
    });

    it("should handle service without tags", () => {
      const serviceWithoutTags: Service = {
        ...mockService,
        tags: undefined,
        serviceType: undefined,
        language: undefined,
      };

      const options: AdapterOptions = {
        projectId: "project-1",
      };

      const result = serviceAdapter.toEntityListItemProps(
        serviceWithoutTags,
        options
      );

      expect(result.tags).toBeUndefined();
    });

    it("should generate organization-level href when no project ID", () => {
      const options: AdapterOptions = {
        organizationId: "org-1",
      };

      const result = serviceAdapter.toEntityListItemProps(mockService, options);

      expect(result.href).toContain("/organizations/org-1");
      expect(result.href).toContain("/services/service-1");
    });

    it("should prefer project-level href when both IDs provided", () => {
      const options: AdapterOptions = {
        organizationId: "org-1",
        projectId: "project-1",
      };

      const result = serviceAdapter.toEntityListItemProps(mockService, options);

      expect(result.href).toContain("/projects/project-1");
      expect(result.href).not.toContain("/organizations/");
    });

    it("should not generate href without any IDs", () => {
      const result = serviceAdapter.toEntityListItemProps(mockService, {});

      expect(result.href).toBeUndefined();
    });

    it("should handle custom handlers", () => {
      const handleClick = () => {};
      const handleDelete = () => {};
      const options: AdapterOptions = {
        projectId: "project-1",
        onClick: handleClick,
        onDelete: handleDelete,
      };

      const result = serviceAdapter.toEntityListItemProps(mockService, options);

      expect(result.onClick).toBe(handleClick);
      expect(result.onDelete).toBe(handleDelete);
    });
  });

  describe("remaining canonical kind labels", () => {
    const mockConversation: ConversationResponseDto = {
      id: "conversation-1",
      projectId: "project-1",
      organizationId: "org-1",
      initiatedBy: InitiationType.User,
      status: ConversationStatus.Started,
      title: "Planning discussion",
      version: 1,
      workflowName: WorkflowName.EntityConversation,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      messages: [],
    };
    const mockPlan: PlanWorkItem = {
      id: "plan-1",
      organizationId: "org-1",
      projectId: "project-1",
      parentTaskId: "feature-1",
      name: "Delivery plan",
      type: "PLAN",
      sections: [
        {
          id: "outcome-section",
          key: "outcome",
          order: 0,
          materializedMarkdown: "Ship the feature",
          materializedAt: "2024-01-01T00:00:00Z",
        },
      ],
      status: WorkStatus.Ready,
      source: TaskSource.System,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    it("supplies canonical conversation and plan kinds only when requested", () => {
      expect(
        conversationAdapter.toEntityListItemProps(mockConversation)
          .entityKindLabel
      ).toBeUndefined();
      expect(
        conversationAdapter.toEntityListItemProps(mockConversation, {
          showEntityKind: true,
        }).entityKindLabel
      ).toBe("Conversation");
      expect(
        conversationAdapter.toEntityListItemProps(mockConversation, {
          showEntityKind: true,
        }).entityKindIcon
      ).toBe("conversation");
      expect(
        planAdapter.toEntityListItemProps(mockPlan, {
          showEntityKind: true,
        }).entityKindLabel
      ).toBe("Plan");
      expect(
        planAdapter.toEntityListItemProps(mockPlan, {
          showEntityKind: true,
        }).entityKindIcon
      ).toBe("plan");
    });

    it("maps plans to the shared simple reference presentation", () => {
      expect(
        planAdapter.toEntityListItemProps(mockPlan, {
          projectId: "project-1",
          showEntityKind: true,
          presentation: "reference",
        })
      ).toEqual({
        title: "Delivery plan",
        entityKindLabel: "Plan",
        entityKindIcon: "plan",
        displayMode: "list",
      });
    });

    it("formats plan lifecycle statuses for list consumers", () => {
      const result = planAdapter.toEntityListItemProps(
        { ...mockPlan, status: WorkStatus.Verifying },
        { projectId: "project-1" }
      );

      expect(result.status).toBe("Verifying");
    });
  });

  describe("Date formatting utilities", () => {
    it("should format valid dates correctly", () => {
      const mockTask: TaskResponseDto = {
        id: "task-1",
        organizationId: "org-1",
        name: "Test task",
        description: "Test description",
        status: WorkStatus.Active,
        priority: Priority.High,
        dueDate: "2024-12-25T00:00:00Z",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, {
        projectId: "project-1",
        initiativeId: "initiative-1",
      });

      expect(result).toBeDefined();
      // Date formatting is internal to metadata
    });

    it("should handle invalid date strings", () => {
      const mockTask: TaskResponseDto = {
        id: "task-1",
        organizationId: "org-1",
        name: "Test task",
        description: "Test description",
        status: WorkStatus.Active,
        priority: Priority.High,
        dueDate: "invalid-date",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, {
        projectId: "project-1",
        initiativeId: "initiative-1",
      });

      expect(result).toBeDefined();
    });

    it("should handle null dates", () => {
      const mockTask: TaskResponseDto = {
        id: "task-1",
        organizationId: "org-1",
        name: "Test task",
        description: "Test description",
        status: WorkStatus.Active,
        priority: Priority.High,
        dueDate: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      const result = taskAdapter.toEntityListItemProps(mockTask, {
        projectId: "project-1",
        initiativeId: "initiative-1",
      });

      expect(result).toBeDefined();
    });
  });
});
