import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FieldComponentProps } from "./types";
import { EntityType } from "../../../api";
import {
  TriageApplicationCoordinator,
  type TriageApplicationPorts,
} from "../../../data/triage/application";
import { OpenItemsTriageField } from "./OpenItemsTriageField";
import { FIELD_REGISTRY } from "./Registry";
import { getFieldResponseMetadata } from "./fieldResponseMetadata";

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../../Conversation/Components/ConversationContext", () => ({
  useConversationContext: () => context.value,
}));
const items = [
  { entityType: EntityType.Task, entityId: "first", title: "First task" },
];
const payload = {
  summary: "Keep the active work.",
  suggestions: [
    {
      suggestionId: "remove",
      kind: "removeOpenItems" as const,
      items,
      rationale: "No longer in focus",
      evidence: [
        { kind: "attention" as const, summary: "Not viewed recently" },
      ],
    },
    {
      suggestionId: "track",
      kind: "trackOnGoal" as const,
      items,
      goal: { kind: "existingGoal" as const, goalId: "goal", title: "Ship" },
      rationale: "Same outcome",
      evidence: [{ kind: "edge" as const, summary: "Related work" }],
    },
  ],
};
function setup(
  remove: TriageApplicationPorts["remove"] = vi
    .fn()
    .mockResolvedValue(undefined)
) {
  const ports: TriageApplicationPorts = {
    refresh: vi.fn().mockResolvedValue(undefined),
    target: () => ({ open: true, groupId: null, pinned: false }),
    groupExists: () => true,
    remove,
    reopen: vi.fn(),
    createGroup: vi.fn(),
    group: vi.fn(),
    createGoal: vi.fn(),
    track: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn(),
    revalidateGoals: vi.fn().mockResolvedValue(undefined),
  };
  const owner = new TriageApplicationCoordinator(ports);
  context.value = {
    triageApplication: owner,
    triageItemHref: () => "/tasks/first",
    isReadOnly: false,
  };
  // The registry passes this exact typed payload and stable field identity.
  const props = {
    config: { field: "triage", payload },
    context: { conversationId: "conversation", messageId: "reply" },
    disabled: false,
  } as FieldComponentProps;
  return { ports, owner, props };
}
describe("triage rendering and owning callbacks", () => {
  it("registers display-only replies without claiming the conversation composer", () => {
    expect(FIELD_REGISTRY.open_items_triage.Component).toBe(
      OpenItemsTriageField
    );
    expect(
      getFieldResponseMetadata("open_items_triage").responseBehavior
    ).toEqual({ ownership: "display-only" });
  });
  it("renders evidence and links, deselects work, and updates independent outcomes after Apply all", async () => {
    const { ports, props } = setup();
    render(<OpenItemsTriageField {...props} />);
    expect(screen.getByText(payload.summary)).toBeInTheDocument();
    expect(screen.getByText(/Not viewed recently/)).toBeInTheDocument();
    expect(screen.getAllByRole("link")[0]).toHaveAttribute(
      "href",
      "/tasks/first"
    );
    expect(ports.remove).not.toHaveBeenCalled();
    expect(ports.track).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole("checkbox")[1]);
    await userEvent.click(screen.getByTestId("triage-apply-all"));
    await waitFor(() =>
      expect(screen.getByTestId("triage-outcome")).toHaveTextContent(/Applied/)
    );
    expect(ports.remove).toHaveBeenCalledTimes(1);
    expect(ports.track).not.toHaveBeenCalled();
  });
  it("boxes evidence, labels promotion Apply… and notes independent application", () => {
    const { props } = setup();
    const promotion = {
      suggestionId: "promote",
      kind: "promoteGroupToGoal" as const,
      groupId: "group",
      groupName: "This week",
      goalName: "Ship it",
      rationale: "One outcome",
      evidence: [{ kind: "coAttention" as const, summary: "Viewed together" }],
      affectedMembers: items,
    };
    render(
      <OpenItemsTriageField
        {...props}
        config={{
          field: "triage",
          payload: {
            ...payload,
            suggestions: [...payload.suggestions, promotion],
          },
        }}
      />
    );
    const evidence = screen.getAllByTestId("triage-evidence");
    expect(evidence).toHaveLength(3);
    expect(evidence[0]).toHaveTextContent(/Not viewed recently/);
    expect(
      screen.getAllByTestId("triage-apply").map((button) => button.textContent)
    ).toEqual(["Apply", "Apply", "Apply…"]);
    expect(screen.getByTestId("triage-apply-note")).toHaveTextContent(
      "Each suggestion is applied independently."
    );
  });
  it("shows pending and local failure while independent selected work still succeeds", async () => {
    let reject!: (cause: Error) => void;
    const { ports, props } = setup(
      vi.fn(
        () =>
          new Promise<void>((_resolve, failure) => {
            reject = failure;
          })
      )
    );
    render(<OpenItemsTriageField {...props} />);
    await userEvent.click(screen.getByTestId("triage-apply-all"));
    await waitFor(() =>
      expect(screen.getByTestId("triage-outcome")).toHaveTextContent(/Applying/)
    );
    await act(async () => {
      reject(new Error("Moved target"));
    });
    await waitFor(() => expect(ports.track).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Moved target/)).toBeInTheDocument();
    expect(screen.getAllByTestId("triage-outcome")[1]).toHaveTextContent(
      /Applied/
    );
  });
});
