import { beforeEach, describe, expect, it } from "vitest";
import {
  WebPathService,
  getPathService,
  resetPathService,
  setPathService,
  type PathService,
} from "../webPathService";

describe("webPathService", () => {
  beforeEach(() => {
    resetPathService();
  });

  it("builds default onboarding paths", () => {
    expect(WebPathService.onboarding({ projectId: "project-1" })).toBe(
      "/projects/project-1/onboarding",
    );
    expect(
      WebPathService.onboarding({ projectId: "project-1", isNew: true }),
    ).toBe("/projects/project-1/onboarding?isNew=t");
  });

  it("builds initiative list paths with optional search query", () => {
    expect(WebPathService.projectInitiatives({ projectId: "project-1" })).toBe(
      "/projects/project-1/initiatives",
    );
    expect(
      WebPathService.projectInitiatives({
        projectId: "project-1",
        search: "auth bug",
      }),
    ).toBe("/projects/project-1/initiatives?search=auth+bug");
  });

  it("builds the project Agents Coding destination with stable query ordering", () => {
    expect(
      WebPathService.projectAgentsCoding({ projectId: "project-1" }),
    ).toBe("/projects/project-1?view=coding&tab=agents");
  });

  it("uses an injected project Agents Coding path service override", () => {
    const baseService = getPathService();
    const override: PathService = {
      ...baseService,
      projectAgentsCoding: ({ projectId }) =>
        `/custom/projects/${projectId}?destination=agents-coding`,
    };

    setPathService(override);

    expect(
      WebPathService.projectAgentsCoding({ projectId: "project-1" }),
    ).toBe("/custom/projects/project-1?destination=agents-coding");
  });

  it("uses an injected path service override", () => {
    const baseService = getPathService();
    const override: PathService = {
      ...baseService,
      task: ({ taskId }) => `/custom/tasks/${taskId}`,
    };

    setPathService(override);

    expect(
      WebPathService.task({
        projectId: "project-1",
        initiativeId: "initiative-1",
        taskId: "task-1",
      }),
    ).toBe("/custom/tasks/task-1");
  });

  it("resets back to the default path service", () => {
    const baseService = getPathService();
    const override: PathService = {
      ...baseService,
      plan: ({ planId }) => `/custom/plans/${planId}`,
    };

    setPathService(override);
    expect(
      WebPathService.plan({ projectId: "project-1", planId: "plan-1" }),
    ).toBe("/custom/plans/plan-1");

    resetPathService();
    expect(
      WebPathService.plan({ projectId: "project-1", planId: "plan-1" }),
    ).toBe("/projects/project-1/plans/plan-1");
  });

  it("builds plan-scoped entity paths", () => {
    expect(
      WebPathService.planStep({
        projectId: "project-1",
        planId: "plan-1",
        stageId: "stage-1",
        stepId: "step-1",
      }),
    ).toBe("/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1");

    expect(
      WebPathService.planTask({
        projectId: "project-1",
        planId: "plan-1",
        taskId: "task-1",
      }),
    ).toBe("/projects/project-1/tasks/task-1?planId=plan-1");

    expect(
      WebPathService.planDesignDoc({
        projectId: "project-1",
        planId: "plan-1",
        designDocId: "design-doc-1",
      }),
    ).toBe("/projects/project-1/design-docs/design-doc-1?planId=plan-1");

    expect(
      WebPathService.planAgentSession({
        projectId: "project-1",
        planId: "plan-1",
        stageId: "stage-1",
        stepId: "step-1",
        agentSessionId: "session-1",
      }),
    ).toBe(
      "/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1/agent-sessions/session-1",
    );
  });

  it("builds design document paths with an optional editing flag", () => {
    expect(
      WebPathService.designDoc({
        projectId: "project-1",
        designDocId: "design-doc-1",
      }),
    ).toBe("/projects/project-1/design-docs/design-doc-1");

    expect(
      WebPathService.designDoc({
        projectId: "project-1",
        designDocId: "design-doc-1",
        editing: true,
      }),
    ).toBe("/projects/project-1/design-docs/design-doc-1?editing=true");
  });

  it("builds report paths", () => {
    expect(
      WebPathService.report({
        projectId: "project-1",
        reportId: "report-1",
      }),
    ).toBe("/projects/project-1/reports/report-1");

    expect(
      WebPathService.organizationReport({
        organizationId: "org-1",
        reportId: "report-1",
      }),
    ).toBe("/organizations/org-1/reports/report-1");
  });

  it("builds project- and organization-scoped user paths", () => {
    expect(
      WebPathService.user({ projectId: "project-1", userId: "user-1" }),
    ).toBe("/projects/project-1/users/user-1");
    expect(
      WebPathService.organizationUser({
        organizationId: "organization-1",
        userId: "user-1",
      }),
    ).toBe("/organizations/organization-1/users/user-1");
  });

  it("builds the recently viewed page path", () => {
    expect(WebPathService.recentlyViewed({ projectId: "project-1" })).toBe(
      "/projects/project-1/recently-viewed",
    );
  });

  it("builds Goal detail paths through the canonical task route", () => {
    expect(
      WebPathService.goal({ projectId: "project-1", taskId: "goal-1" }),
    ).toBe("/projects/project-1/tasks/goal-1");
  });

  it("builds proposal paths with an optional editing flag", () => {
    expect(
      WebPathService.proposal({
        projectId: "project-1",
        proposalId: "proposal-1",
      }),
    ).toBe("/projects/project-1/proposals/proposal-1");

    expect(
      WebPathService.proposal({
        projectId: "project-1",
        proposalId: "proposal-1",
        editing: true,
      }),
    ).toBe("/projects/project-1/proposals/proposal-1?editing=true");

    expect(
      WebPathService.proposal({
        projectId: "project-1",
        proposalId: "proposal-1",
        returnTo: "/projects/project-1/tasks/root-1?tab=graph",
      }),
    ).toBe(
      "/projects/project-1/proposals/proposal-1?returnTo=%2Fprojects%2Fproject-1%2Ftasks%2Froot-1%3Ftab%3Dgraph",
    );
  });

  it("builds proposal group paths", () => {
    expect(
      WebPathService.proposalGroup({
        projectId: "project-1",
        groupId: "group-1",
      }),
    ).toBe("/projects/project-1/proposal-groups/group-1");
  });

  it.each(["https://example.com", "//example.com/path", "projects/project-1"])(
    "rejects unsafe proposal return targets: %s",
    (returnTo) => {
      expect(() =>
        WebPathService.proposal({
          projectId: "project-1",
          proposalId: "proposal-1",
          returnTo,
        }),
      ).toThrow("internal application path");
    },
  );

  it("orders proposal query parameters deterministically", () => {
    expect(
      WebPathService.proposal({
        projectId: "project-1",
        proposalId: "proposal-1",
        editing: true,
        returnTo: "/projects/project-1/tasks/root-1",
      }),
    ).toBe(
      "/projects/project-1/proposals/proposal-1?editing=true&returnTo=%2Fprojects%2Fproject-1%2Ftasks%2Froot-1",
    );
  });

  it("builds activity detail paths", () => {
    expect(
      WebPathService.activityDetail({
        projectId: "project-1",
        entityType: "TASK",
        entityId: "task-1",
      }),
    ).toBe("/projects/project-1/activities/TASK-task-1");
  });

  it("preserves an internal Activity return path on detail routes", () => {
    expect(
      WebPathService.activityDetail({
        projectId: "project-2",
        entityType: "TASK",
        entityId: "task-1",
        returnTo:
          "/organizations/organization-1/activity?metric=TASK_COMPLETED&projectIds=project-1&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&limit=25&offset=50",
      })
    ).toBe(
      "/projects/project-2/activities/TASK-task-1?returnTo=%2Forganizations%2Forganization-1%2Factivity%3Fmetric%3DTASK_COMPLETED%26projectIds%3Dproject-1%26windowStart%3D2026-03-01T00%253A00%253A00.000Z%26windowEnd%3D2026-03-02T00%253A00%253A00.000Z%26limit%3D25%26offset%3D50"
    );
  });

  it.each(["https://example.com", "//example.com/path", "projects/project-1/activity"])(
    "rejects unsafe Activity detail return paths: %s",
    (returnTo) => {
      expect(() =>
        WebPathService.activityDetail({
          projectId: "project-1",
          entityType: "TASK",
          entityId: "task-1",
          returnTo,
        })
      ).toThrow("internal application path");
    }
  );

  it("builds stable organization Activity filter paths", () => {
    expect(
      WebPathService.organizationActivity({
        organizationId: "organization-1",
        projectId: "project-1",
        userId: "user-1",
        entityType: ["TASK", "PLAN"],
        activityMode: "ALL",
        activityType: ["NOTIFICATION", "VIEWED"],
        source: ["SYSTEM", "REPORT"],
        serviceId: "service-1",
        since: "2026-03-01T00:00:00.000Z",
        until: "2026-03-02T00:00:00.000Z",
        affectsMe: true,
        sinceLastVisit: false,
        limit: 25,
        offset: 50,
      })
    ).toBe(
      "/organizations/organization-1/activity?projectId=project-1&userId=user-1&entityType=PLAN%2CTASK&activityMode=ALL&activityType=NOTIFICATION%2CVIEWED&source=REPORT%2CSYSTEM&serviceId=service-1&since=2026-03-01T00%3A00%3A00.000Z&until=2026-03-02T00%3A00%3A00.000Z&affectsMe=true&sinceLastVisit=false&limit=25&offset=50"
    );
  });

  it("serializes the exact metric continuation fields", () => {
    expect(
      WebPathService.organizationActivity({
        organizationId: "organization-1",
        metricContinuation: {
          metric: "TASK_COMPLETED",
          projectIds: ["project-2", "project-1"],
          windowStart: "2026-03-01T00:00:00.000Z",
          windowEnd: "2026-03-02T00:00:00.000Z",
          actorScope: { mode: "ORGANIZATION" },
        },
      })
    ).toBe(
      "/organizations/organization-1/activity?metric=TASK_COMPLETED&projectIds=project-2&projectIds=project-1&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=ORGANIZATION"
    );
  });

  it("keeps project presentation scope separate from metric evidence", () => {
    const path = WebPathService.organizationActivity({
      organizationId: "organization-1",
      viewScope: "project",
      metricContinuation: {
        metric: "TASK_COMPLETED",
        projectIds: ["project-1"],
        windowStart: "2026-03-01T00:00:00.000Z",
        windowEnd: "2026-03-02T00:00:00.000Z",
        actorScope: { mode: "ORGANIZATION" },
      },
    });

    const url = new URL(path, "https://example.test");
    expect(url.searchParams.get("viewScope")).toBe("project");
    expect(url.searchParams.getAll("projectIds")).toEqual(["project-1"]);
  });

  it("uses the same canonical href for public conversation links and ownership resolution", () => {
    const params = { projectId: "project-1", conversationId: "conversation-1" };
    expect(WebPathService.conversation(params)).toBe(
      "/projects/project-1/resolve-agent-session/conversation-1"
    );
    expect(WebPathService.conversation(params)).toBe(WebPathService.resolveAgentSession(params));
    expect(WebPathService.sessionlessConversation(params)).toBe(
      "/projects/project-1/sessionless-conversations/conversation-1"
    );
    expect(WebPathService.sessionlessConversation(params)).not.toBe(WebPathService.conversation(params));
  });

  it("builds conversation-based agent-session resolver paths", () => {
    expect(
      WebPathService.resolveAgentSession({
        projectId: "project-1",
        conversationId: "conversation-1",
      }),
    ).toBe("/projects/project-1/resolve-agent-session/conversation-1");
  });
});
