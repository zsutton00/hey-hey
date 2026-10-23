import { describe, expect, it } from "vitest";
import {
  ActivityCorrelationLinkType,
  EntityType,
  type ActivityCorrelationLinkedEntityDto,
} from "../../../api";
import { resolveAgentSessionDisplayTitle } from "../activityFormatting";

const makeLinkedEntity = (
  overrides: Partial<ActivityCorrelationLinkedEntityDto> & {
    linkType: ActivityCorrelationLinkType;
    title: string;
  }
): ActivityCorrelationLinkedEntityDto => ({
  entityId: "entity-id",
  entityType: EntityType.Task,
  ...overrides,
});

describe("resolveAgentSessionDisplayTitle", () => {
  it("returns the title unchanged when entity type is not AgentSession", () => {
    const linkedEntities: ActivityCorrelationLinkedEntityDto[] = [
      makeLinkedEntity({
        linkType: ActivityCorrelationLinkType.Parent,
        title: "Parent Task",
      }),
    ];

    expect(
      resolveAgentSessionDisplayTitle(
        EntityType.Task,
        "Some task title",
        linkedEntities
      )
    ).toBe("Some task title");
  });

  it("prefixes the persisted title with the Parent-linked entity's title", () => {
    const linkedEntities: ActivityCorrelationLinkedEntityDto[] = [
      makeLinkedEntity({
        linkType: ActivityCorrelationLinkType.Related,
        title: "Related Entity",
      }),
      makeLinkedEntity({
        linkType: ActivityCorrelationLinkType.Parent,
        title: "Parent Task",
      }),
    ];

    expect(
      resolveAgentSessionDisplayTitle(
        EntityType.AgentSession,
        "Coding Session",
        linkedEntities
      )
    ).toBe("Parent Task - Coding Session");
  });

  it("falls back to a Related-linked entity when no Parent link exists", () => {
    const linkedEntities: ActivityCorrelationLinkedEntityDto[] = [
      makeLinkedEntity({
        linkType: ActivityCorrelationLinkType.Related,
        title: "Related Entity",
      }),
    ];

    expect(
      resolveAgentSessionDisplayTitle(
        EntityType.AgentSession,
        "Coding Session",
        linkedEntities
      )
    ).toBe("Related Entity - Coding Session");
  });

  it("returns the persisted title when the linked entity title is empty or whitespace", () => {
    const linkedEntities: ActivityCorrelationLinkedEntityDto[] = [
      makeLinkedEntity({
        linkType: ActivityCorrelationLinkType.Parent,
        title: "   ",
      }),
    ];

    expect(
      resolveAgentSessionDisplayTitle(
        EntityType.AgentSession,
        "Coding Session",
        linkedEntities
      )
    ).toBe("Coding Session");
  });

  it("prefixes a generic persisted title with the parent title", () => {
    const linkedEntities: ActivityCorrelationLinkedEntityDto[] = [
      makeLinkedEntity({
        linkType: ActivityCorrelationLinkType.Parent,
        title: "Implement feature X",
      }),
    ];

    expect(
      resolveAgentSessionDisplayTitle(
        EntityType.AgentSession,
        "Agent session",
        linkedEntities
      )
    ).toBe("Implement feature X - Agent session");
  });
});
