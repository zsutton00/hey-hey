import { describe, expect, it } from "vitest";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import {
  buildDefaultMenuContributions,
  composeMenuContributions,
  OPEN_ITEM_INTERACTION_ENTITY_TYPES,
  resolveEntityTypeConfig,
} from "../entityTypeRegistry";

describe("entityTypeRegistry — menu contributions", () => {
  it("composes sections and contribution order deterministically", () => {
    const result = composeMenuContributions(
      [{ id: "secondary", section: "secondary", order: 0 }],
      [
        { id: "shared-later", section: "shared", order: 20 },
        { id: "shared-first", section: "shared", order: 10 },
      ],
      [{ id: "primary", section: "primary", order: 100 }],
      [{ id: "removal", section: "removal", order: 0 }],
      [{ id: "async", section: "async", order: 0 }],
    );
    expect(result.map(({ id }) => id)).toEqual([
      "primary",
      "shared-first",
      "shared-later",
      "secondary",
      "removal",
      "async",
    ]);
  });

  it("builds human-readable Discuss and scoped Star defaults", () => {
    const contributions = buildDefaultMenuContributions("AGENT_SESSION", {
      entityId: "session-1",
      entityType: "AGENT_SESSION",
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(contributions).toEqual([
      expect.objectContaining({
        section: "shared",
        controller: "discuss",
        items: [
          expect.objectContaining({
            label: "Discuss Agent Session",
            icon: ChatBubbleOutlineIcon,
          }),
        ],
      }),
      expect.objectContaining({ section: "shared", controller: "star" }),
    ]);
  });

  it("uses a task subtype for the Discuss label while preserving STANDARD as Task", () => {
    expect(
      buildDefaultMenuContributions("TASK", {
        entityId: "feature-1",
        entityType: "TASK",
        entitySubtype: "FEATURE",
      }),
    ).toEqual([
      expect.objectContaining({
        items: [expect.objectContaining({ label: "Discuss Feature" })],
      }),
    ]);

    expect(
      buildDefaultMenuContributions("TASK", {
        entityId: "task-1",
        entityType: "TASK",
        entitySubtype: "STANDARD",
      }),
    ).toEqual([
      expect.objectContaining({
        items: [expect.objectContaining({ label: "Discuss Task" })],
      }),
    ]);
  });
});

describe("entityTypeRegistry — proposal entry", () => {
  it("resolves the PROPOSAL key to a config with a 'proposal' lineage entityType", () => {
    const config = resolveEntityTypeConfig("PROPOSAL");

    expect(config).toBeDefined();
    expect(config?.displayLabel).toBe("proposal");
    expect(config?.lineageFieldMapping).toEqual({
      sessionField: "entityId",
      entityType: "proposal",
    });
  });

  it("exposes Discuss... as the built-in menu item for PROPOSAL", () => {
    const config = resolveEntityTypeConfig("PROPOSAL");

    expect(config?.menuItems).toEqual([
      {
        action: "discuss",
        label: "Discuss...",
        icon: ChatBubbleOutlineIcon,
        testId: "interaction-menu-discuss",
      },
    ]);
  });
});

describe("entityTypeRegistry — goal entry", () => {
  it("resolves GOAL to a goal Open Item preview while launching task conversations", () => {
    const config = resolveEntityTypeConfig("GOAL");

    expect(config).toMatchObject({
      displayLabel: "goal",
      previewCapability: { kind: "supported", entityType: "goal" },
      lineageFieldMapping: {
        sessionField: "entityId",
        entityType: "task",
      },
    });
  });
});

describe("entityTypeRegistry — preview capability", () => {
  it("resolves lowercase and work-item mention types to static Discuss and Preview actions", () => {
    expect(resolveEntityTypeConfig("task")).toMatchObject({
      menuItems: [{ action: "discuss" }],
      previewCapability: { kind: "supported", entityType: "task" },
    });
    expect(resolveEntityTypeConfig("feature")).toMatchObject({
      displayLabel: "feature",
      menuItems: [{ action: "discuss" }],
      previewCapability: { kind: "supported", entityType: "task" },
      lineageFieldMapping: { entityType: "task" },
    });
  });

  it("still supplies Discuss for entity types outside the preview contract", () => {
    expect(resolveEntityTypeConfig("project")).toMatchObject({
      displayLabel: "project",
      menuItems: [{ action: "discuss" }],
      previewCapability: { kind: "unsupported" },
    });
  });

  it("exhaustively maps every Open Item entity type to Preview", () => {
    for (const [entityType, interactionEntityType] of Object.entries(
      OPEN_ITEM_INTERACTION_ENTITY_TYPES,
    )) {
      expect(
        resolveEntityTypeConfig(interactionEntityType)?.previewCapability,
      ).toEqual({
        kind: "supported",
        entityType: entityType === "plan" ? "task" : entityType,
      });
    }
  });

  it("keeps types outside the Open Items contract explicitly unsupported", () => {
    expect(resolveEntityTypeConfig("SERVICE")?.previewCapability).toEqual({
      kind: "unsupported",
    });
    expect(resolveEntityTypeConfig("REPORT")?.previewCapability).toEqual({
      kind: "unsupported",
    });
  });
});
