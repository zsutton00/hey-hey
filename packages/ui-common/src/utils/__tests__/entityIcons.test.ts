import AccountTreeIcon from "@mui/icons-material/AccountTree";
import BugReportIcon from "@mui/icons-material/BugReport";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import { TaskIcon } from "../../utils/icons/Task";
import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../api";
import { AgentSessionType, WorkItemTypeRole } from "../../api";
import { AgentSessionIcon } from "../icons/AgentSession";
import { ContractIcon } from "../icons/Contract";
import { DecisionIcon } from "../icons/Decision";
import { DesignIcon } from "../icons/Design";
import { FeatureIcon } from "../icons/Feature";
import { ProposalIcon } from "../icons/Proposal";
import { TaskMonitorIcon } from "../icons/TaskMonitor";
import { MockupsIcon } from "../icons/Mockups";
import {
  getAgentSessionIcon,
  getEntityColors,
  getEntityIcon,
  resolveWorkItemIcon,
  resolveWorkItemIconPresentation,
} from "../entityIcons";

const definition = (
  key: string,
  iconKey: WorkItemTypeDefinitionDto["iconKey"]
): WorkItemTypeDefinitionDto => ({
  key,
  name: key,
  role: WorkItemTypeRole.WorkItem,
  sections: [],
  allowedStatuses: [],
  iconKey,
});

describe("entityIcons", () => {
  it("uses a dedicated workflow icon and colors", () => {
    expect(getEntityIcon("workflow")).toBe(AccountTreeIcon);
    expect(getEntityColors("workflow")).toEqual({
      background: "plan.main",
      color: "plan.contrastText",
    });
  });

  it("resolves the explicit Mockups icon without changing Feature resolution", () => {
    expect(getEntityIcon("mockups")).toBe(MockupsIcon);
    expect(getEntityIcon("feature")).toBe(FeatureIcon);
  });

  it("resolves Design and Decision icons and semantic colors from matching definitions", () => {
    expect(getEntityIcon("mockup")).toBe(DesignIcon);
    expect(getEntityIcon("decision")).toBe(DecisionIcon);
    expect(getEntityColors("mockup")).toEqual({
      background: "error.main",
      color: "error.contrastText",
    });
    expect(getEntityColors("decision")).toEqual({
      background: "success.main",
      color: "success.contrastText",
    });
    expect(
      resolveWorkItemIconPresentation("mockup", definition("mockup", "design"))
    ).toEqual({
      Icon: DesignIcon,
      colors: { background: "error.main", color: "error.contrastText" },
    });
    expect(
      resolveWorkItemIconPresentation("mockup", definition("mockup", "task"))
    ).toEqual({
      Icon: DesignIcon,
      colors: { background: "error.main", color: "error.contrastText" },
    });
    expect(
      resolveWorkItemIconPresentation(
        "decision",
        definition("decision", "decision")
      )
    ).toEqual({
      Icon: DecisionIcon,
      colors: { background: "success.main", color: "success.contrastText" },
    });
  });

  it("withholds type-specific icon and color when the registry definition is unavailable or mismatched", () => {
    expect(
      resolveWorkItemIconPresentation("decision", undefined)
    ).toBeUndefined();
    expect(
      resolveWorkItemIconPresentation(
        "decision",
        definition("mockup", "decision")
      )
    ).toBeUndefined();
    expect(
      resolveWorkItemIconPresentation(
        "decision",
        definition("decision", undefined)
      )
    ).toBeUndefined();
  });

  it.each([
    ["standard", "task.main", "task.contrastText"],
    ["task_monitor", "task.main", "task.contrastText"],
    ["workflow_step", "plan.main", "plan.contrastText"],
  ])("uses the work-item palette for %s", (type, background, color) => {
    expect(getEntityColors(type)).toEqual({ background, color });
  });

  it("uses the amber warning color for Contracts", () => {
    expect(getEntityColors("contract")).toEqual({
      background: "warning.main",
      color: "warning.contrastText",
    });
  });

  it("uses the amber warning color for Bugs", () => {
    expect(getEntityColors("bug")).toEqual({
      background: "warning.main",
      color: "warning.contrastText",
    });
  });

  it("resolves registry-backed work-item icons from the closed palette", () => {
    expect(
      resolveWorkItemIcon("CONTRACT", definition("CONTRACT", "contract"))
    ).toBe(ContractIcon);
    expect(
      resolveWorkItemIcon("workflow", definition("workflow", "workflow"))
    ).toBe(AccountTreeIcon);
    expect(resolveWorkItemIcon("BUG", definition("BUG", "bug"))).toBe(
      BugReportIcon
    );
  });

  it("uses the dedicated Task Monitor icon for the built-in monitor type", () => {
    expect(
      resolveWorkItemIcon("TASK_MONITOR", definition("TASK_MONITOR", undefined))
    ).toBe(TaskMonitorIcon);
    expect(
      resolveWorkItemIcon("TASK_MONITOR", definition("TASK_MONITOR", "task"))
    ).toBe(TaskMonitorIcon);
    expect(getEntityIcon("TASK_MONITOR")).toBe(TaskMonitorIcon);
  });

  it("uses the standard-task fallback only when the task type is absent", () => {
    expect(resolveWorkItemIcon(undefined, undefined)).toBe(TaskIcon);
    expect(resolveWorkItemIcon("CONTRACT", undefined)).toBeUndefined();
    expect(
      resolveWorkItemIcon("CONTRACT", definition("workflow", "workflow"))
    ).toBeUndefined();
    expect(
      resolveWorkItemIcon("CONTRACT", definition("CONTRACT", undefined))
    ).toBeUndefined();
  });

  it("uses the coding icon for coding sessions and the generic fallback", () => {
    expect(getAgentSessionIcon(AgentSessionType.Coding)).toBe(AgentSessionIcon);
    expect(getAgentSessionIcon()).toBe(AgentSessionIcon);
    expect(getEntityIcon("agent_session")).toBe(AgentSessionIcon);
  });

  it("uses the proposal icon and colors for proposal identity", () => {
    expect(getEntityIcon("PROPOSAL")).toBe(ProposalIcon);
    expect(getEntityColors("proposal")).toEqual({
      background: "attention.main",
      color: "attention.contrastText",
    });
  });

  it("uses the talking icon for every non-coding session type", () => {
    for (const type of Object.values(AgentSessionType)) {
      if (type !== AgentSessionType.Coding) {
        expect(getAgentSessionIcon(type)).toBe(ForumOutlinedIcon);
      }
    }
  });
});

describe("independent registry colors", () => {
  it("allows a custom color without an authored icon", () => {
    expect(
      resolveWorkItemIconPresentation(
        "custom",
        {
          ...definition("custom", undefined),
          colorKey: "primary",
        },
        "PROJECT_CUSTOM"
      )?.colors
    ).toEqual({ background: "primary.main", color: "primary.contrastText" });
  });
  it.each([
    "primary",
    "secondary",
    "success",
    "warning",
    "error",
    "info",
  ] as const)(
    "uses custom %s contrast tokens independently of the glyph",
    (colorKey) => {
      const custom = { ...definition("custom", "star"), colorKey };
      expect(
        resolveWorkItemIconPresentation("custom", custom, "PROJECT_CUSTOM")
          ?.colors
      ).toEqual({
        background: `${colorKey}.main`,
        color: `${colorKey}.contrastText`,
      });
      expect(
        resolveWorkItemIconPresentation("other", custom, "PROJECT_CUSTOM")
      ).toBeUndefined();
      expect(resolveWorkItemIconPresentation("custom", custom)?.colors).toEqual(
        { background: "action.hover", color: "text.secondary" }
      );
    }
  );
  it.each(["CANONICAL", "CANONICAL_OVERRIDE"] as const)(
    "preserves base colors for %s after a glyph change",
    (source) => {
      const builtin = {
        ...definition("BUG", "star"),
        colorKey: "primary" as const,
      };
      expect(
        resolveWorkItemIconPresentation("BUG", builtin, source)?.colors
      ).toEqual(getEntityColors("BUG"));
      expect(
        resolveWorkItemIconPresentation(
          "BUG",
          definition("BUG", undefined),
          source
        )?.colors
      ).toEqual(getEntityColors("BUG"));
    }
  );
  it.each([
    "star",
    "flag",
    "folder",
    "book",
    "lightbulb",
    "science",
    "code",
    "database",
    "link",
    "people",
    "chat",
    "calendar",
    "timer",
    "chart",
    "shield",
  ] as const)(
    "resolves the added %s token with a neutral default",
    (iconKey) => {
      const result = resolveWorkItemIconPresentation(
        "custom",
        definition("custom", iconKey),
        "PROJECT_CUSTOM"
      );
      expect(result?.Icon).toBeDefined();
      expect(result?.colors).toEqual({
        background: "action.hover",
        color: "text.secondary",
      });
    }
  );
  it("restores the legacy custom default after clearing", () => {
    const selected = {
      ...definition("decision", "decision"),
      colorKey: "primary" as const,
    };
    expect(
      resolveWorkItemIconPresentation("decision", selected, "PROJECT_CUSTOM")
        ?.colors.background
    ).toBe("primary.main");
    expect(
      resolveWorkItemIconPresentation(
        "decision",
        definition("decision", "decision"),
        "PROJECT_CUSTOM"
      )?.colors.background
    ).toBe("success.main");
  });
});
