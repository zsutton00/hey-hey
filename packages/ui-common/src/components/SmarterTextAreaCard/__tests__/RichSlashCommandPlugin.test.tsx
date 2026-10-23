import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURE_TREE_PICKER, type PickerEmit } from "../slashCommands/types";

const hoistedMocks = vi.hoisted(() => {
  let onPickerEmit: ((emit: PickerEmit) => void) | null = null;
  const insertedMention = {
    insertAfter: vi.fn(),
  };
  const createdTextNodes: Array<{
    text: string;
    select: ReturnType<typeof vi.fn>;
  }> = [];
  const anchorNode = {
    getTextContent: () => "/feature-tree",
    setTextContent: vi.fn(),
    insertAfter: vi.fn(),
  };
  const recordRecentSelection = vi.fn();
  const focusEditor = vi.fn();
  const rootElement = document.createElement("div");
  const openModal = vi.fn();
  const featurePickerProps = vi.fn();
  const diagramCreateProps = vi.fn();
  let focalWorkItem: { id: string; type: string } | null = null;

  return {
    anchorNode,
    focusEditor,
    rootElement,
    insertedMention,
    openModal,
    featurePickerProps,
    diagramCreateProps,
    getFocalWorkItem: () => focalWorkItem,
    setFocalWorkItem: (workItem: { id: string; type: string } | null) => {
      focalWorkItem = workItem;
    },
    recordRecentSelection,
    setOnPickerEmit: (handler: (emit: PickerEmit) => void) => {
      onPickerEmit = handler;
    },
    emitPicker: (emit: PickerEmit) => {
      onPickerEmit?.(emit);
    },
    createTextNode: (text: string) => {
      const node = {
        text,
        select: vi.fn(),
      };
      createdTextNodes.push(node);
      return node;
    },
    createdTextNodes,
  };
});

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [
    {
      update: (fn: () => void) => fn(),
      focus: hoistedMocks.focusEditor,
      getRootElement: () => hoistedMocks.rootElement,
    },
  ],
}));

vi.mock("lexical", async () => {
  const actual = await vi.importActual<typeof import("lexical")>("lexical");
  return {
    ...actual,
    $createTextNode: (text: string) => hoistedMocks.createTextNode(text),
    $getNodeByKey: () => hoistedMocks.anchorNode,
    $getSelection: () => null,
    $isRangeSelection: () => false,
    $isTextNode: () => true,
  };
});

vi.mock("../../../contexts/ModalContext", () => ({
  useModal: () => ({ openModal: hoistedMocks.openModal }),
}));

vi.mock("../recentMentionSelections", () => ({
  useRecentMentionSelections: () => ({
    record: hoistedMocks.recordRecentSelection,
  }),
}));

vi.mock("../MentionNode", () => ({
  $createMentionNode: vi.fn(() => hoistedMocks.insertedMention),
}));

vi.mock("../slashCommands/SlashCommandPlugin", () => ({
  SlashCommandPlugin: ({
    onPickerEmit,
  }: {
    onPickerEmit: (emit: PickerEmit) => void;
  }) => {
    hoistedMocks.setOnPickerEmit(onPickerEmit);
    return <div data-testid="slash-command-plugin" />;
  },
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: (
    _organizationId: string | undefined,
    _projectId: string | undefined,
    typeKey: string | undefined,
  ) => ({
    isReady: Boolean(typeKey),
    workItemTypeDefinition: typeKey
      ? typeKey === "DIAGRAM"
        ? {
            key: typeKey,
            name: "Diagram",
            allowedParentEntityTypes: ["TASK"],
            allowedParentTypes: ["FEATURE"],
            capabilities: {
              graph: {
                nodeChildType: "DIAGRAM_ELEMENT",
                layout: { sectionKey: "graphLayout" },
              },
            },
          }
        : { key: typeKey, name: "Contract" }
      : undefined,
  }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: hoistedMocks.getFocalWorkItem() }),
}));

vi.mock("../slashCommands/WorkItemReferencePickerDialog", () => ({
  WorkItemReferencePickerDialog: ({
    onSelect,
    onCreate,
  }: {
    onSelect: (reference: {
      id: string;
      name: string;
      type: string;
      parentTaskId: string | null;
    }) => void;
    onCreate?: () => void;
  }) => (
    <>
      <button
        type="button"
        data-testid="select-work-item-reference"
        onClick={() =>
          onSelect({
            id: "contract-1",
            name: "Reference promise",
            type: "CONTRACT",
            parentTaskId: null,
          })
        }
      >
        Reference promise
      </button>
      {onCreate ? (
        <button type="button" data-testid="create-work-item" onClick={onCreate}>
          Create
        </button>
      ) : null}
    </>
  ),
}));

vi.mock("../../shared/DiagramCreateDialog", () => ({
  DiagramCreateDialog: (props: unknown) => {
    hoistedMocks.diagramCreateProps(props);
    return <div data-testid="diagram-create-dialog" />;
  },
}));

vi.mock("../slashCommands/FixedEntityCollectionPickerDialog", () => ({
  FixedEntityCollectionPickerDialog: ({
    target,
    onSelect,
    onClose,
  }: {
    target: { kind: "plan" | "service" | "design-doc" };
    onSelect: (mention: {
      entityType: string;
      entityId: string;
      entityName: string;
    }) => void;
    onClose: () => void;
  }) => (
    <div data-testid="fixed-entity-picker" data-target-kind={target.kind}>
      <button
        type="button"
        data-testid="select-fixed-entity"
        onClick={() =>
          onSelect({
            entityType:
              target.kind === "design-doc" ? "design_doc" : target.kind,
            entityId: `${target.kind}-1`,
            entityName: `${target.kind} choice`,
          })
        }
      >
        Select fixed entity
      </button>
      <button type="button" data-testid="close-fixed-entity" onClick={onClose}>
        Close fixed entity
      </button>
    </div>
  ),
}));

vi.mock("../slashCommands/SkillPickerDialog", () => ({
  SkillPickerDialog: ({
    onSelect,
  }: {
    onSelect: (selection: {
      provider: "codex";
      name: string;
      catalogScope: "repo";
    }) => void;
  }) => (
    <div data-testid="skill-picker-dialog">
      <button
        type="button"
        data-testid="select-skill"
        onClick={() =>
          onSelect({
            provider: "codex",
            name: "release-check",
            catalogScope: "repo",
          })
        }
      >
        release-check
      </button>
    </div>
  ),
}));

vi.mock("../../Features/FeaturePicker", () => ({
  FeaturePicker: ({
    onChange,
    ...props
  }: {
    onChange: (
      featureId: string | null,
      feature?: { id: string; name: string },
    ) => void;
    searchable?: boolean;
  }) => {
    hoistedMocks.featurePickerProps({ onChange, ...props });
    return (
      <button
        type="button"
        data-testid="select-feature"
        onClick={() =>
          onChange("feature-1", { id: "feature-1", name: "Roadmap" })
        }
      >
        Roadmap
      </button>
    );
  },
}));

import { $createMentionNode } from "../MentionNode";
import { RichSlashCommandPlugin } from "../slashCommands/RichSlashCommandPlugin";

beforeEach(() => {
  vi.clearAllMocks();
  hoistedMocks.createdTextNodes.length = 0;
  hoistedMocks.setFocalWorkItem(null);
});

describe("RichSlashCommandPlugin feature-tree picker", () => {
  it.each([
    ["SERVICE", "service", "service"],
    ["DESIGN_DOC", "design-doc", "design_doc"],
  ] as const)(
    "opens the %s collection and inserts exactly one canonical mention",
    async (entityType, targetKind, mentionType) => {
      render(
        <RichSlashCommandPlugin
          organizationId="org-1"
          projectId="project-1"
          surfaceContext={{
            focalEntity: { kind: "none" },
            cachedConversationMentionOptions: [],
          }}
          rendering="rich"
        />,
      );

      act(() => {
        hoistedMocks.emitPicker({
          type: "openEntitySelection",
          target: { kind: "entity-type", entityType },
          replacementRange: {
            nodeKey: "slash-node-1",
            sliceStart: 0,
            cursorOffset: 13,
          },
        });
      });

      expect(screen.getByTestId("fixed-entity-picker")).toHaveAttribute(
        "data-target-kind",
        targetKind,
      );
      fireEvent.click(screen.getByTestId("select-fixed-entity"));
      expect($createMentionNode).toHaveBeenCalledWith({
        entityType: mentionType,
        entityId: `${targetKind}-1`,
        entityName: `${targetKind} choice`,
      });
      expect($createMentionNode).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("fixed-entity-picker")).toBeNull();
      await waitFor(() =>
        expect(hoistedMocks.focusEditor).toHaveBeenCalledTimes(1),
      );
    },
  );

  it("dismisses a fixed collection without replacing text and restores focus", () => {
    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        rendering="rich"
      />,
    );
    act(() => {
      hoistedMocks.emitPicker({
        type: "openEntitySelection",
        target: { kind: "entity-type", entityType: "SERVICE" },
        replacementRange: {
          nodeKey: "slash-node-1",
          sliceStart: 0,
          cursorOffset: 13,
        },
      });
    });

    fireEvent.click(screen.getByTestId("close-fixed-entity"));
    expect(hoistedMocks.anchorNode.setTextContent).not.toHaveBeenCalled();
    expect(hoistedMocks.focusEditor).toHaveBeenCalledTimes(1);
  });

  it.each(["PLAN", "CONTRACT"])(
    "opens the %s work-item picker and inserts one canonical mention",
    async (workItemTypeKey) => {
      render(
        <RichSlashCommandPlugin
          organizationId="org-1"
          projectId="project-1"
          surfaceContext={{
            focalEntity: { kind: "none" },
            cachedConversationMentionOptions: [],
          }}
          rendering="rich"
        />,
      );

      act(() => {
        hoistedMocks.emitPicker({
          type: "openEntitySelection",
          target: { kind: "work-item-type", workItemTypeKey },
          replacementRange: {
            nodeKey: "slash-node-1",
            sliceStart: 0,
            cursorOffset: 13,
          },
        });
      });

      fireEvent.click(screen.getByTestId("select-work-item-reference"));

      // The picked item's own type key, never the generic `task` kind.
      expect($createMentionNode).toHaveBeenCalledWith({
        entityType: "CONTRACT",
        entityId: "contract-1",
        entityName: "Reference promise",
      });
      expect($createMentionNode).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("select-work-item-reference")).toBeNull();
      await waitFor(() =>
        expect(hoistedMocks.focusEditor).toHaveBeenCalledTimes(1),
      );
    },
  );

  it("omits an ineligible focal task from the editable Diagram creation draft", () => {
    hoistedMocks.setFocalWorkItem({ id: "task-1", type: "STANDARD" });
    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: {
            kind: "entity",
            entityType: "TASK",
            entityId: "task-1",
          },
          cachedConversationMentionOptions: [],
        }}
        rendering="rich"
      />,
    );

    act(() => {
      hoistedMocks.emitPicker({
        type: "openEntitySelection",
        target: { kind: "work-item-type", workItemTypeKey: "DIAGRAM" },
        replacementRange: {
          nodeKey: "slash-node-1",
          sliceStart: 0,
          cursorOffset: 8,
        },
      });
    });
    fireEvent.click(screen.getByTestId("create-work-item"));

    expect(screen.getByTestId("diagram-create-dialog")).toBeInTheDocument();
    expect(hoistedMocks.diagramCreateProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ parent: undefined }),
    );
    expect(hoistedMocks.anchorNode.setTextContent).not.toHaveBeenCalled();
  });

  it("opens FeaturePicker and replaces the command range with a feature mention", async () => {
    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        rendering="rich"
      />,
    );

    act(() => {
      hoistedMocks.emitPicker({
        type: "openPicker",
        picker: FEATURE_TREE_PICKER,
        replacementRange: {
          nodeKey: "slash-node-1",
          sliceStart: 0,
          cursorOffset: 13,
        },
        anchorPosition: {
          top: 84,
          left: 160,
        },
      });
    });

    expect(screen.getByTestId("slash-feature-tree-picker")).toBeVisible();
    expect(screen.getByText("Choose a feature")).toBeVisible();
    expect(hoistedMocks.featurePickerProps).toHaveBeenCalledWith(
      expect.objectContaining({ searchable: true }),
    );

    fireEvent.click(screen.getByTestId("select-feature"));

    expect($createMentionNode).toHaveBeenCalledWith({
      entityType: "feature",
      entityId: "feature-1",
      entityName: "Roadmap",
    });
    expect(hoistedMocks.anchorNode.setTextContent).toHaveBeenCalledWith("");
    expect(hoistedMocks.anchorNode.insertAfter).toHaveBeenCalledWith(
      hoistedMocks.insertedMention,
    );
    expect(hoistedMocks.recordRecentSelection).toHaveBeenCalledWith({
      id: "feature-1",
      type: "feature",
      name: "Roadmap",
    });
    expect($createMentionNode).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(hoistedMocks.focusEditor).toHaveBeenCalledTimes(1),
    );
  });

  it("opens the attached Codex Skill picker and emits only pathless identity", () => {
    const onSkillSelected = vi.fn();

    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        agentContext={{
          organizationId: "org-1",
          projectId: "project-1",
          agentSessionId: "session-1",
          runId: "run-1",
          machineId: "machine-1",
          provider: "codex",
          selectedSkill: null,
          onSkillSelected,
        }}
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        rendering="rich"
      />,
    );

    act(() => {
      hoistedMocks.emitPicker({
        type: "openSkillPicker",
        picker: "skill-picker",
        replacementRange: {
          nodeKey: "slash-node-1",
          sliceStart: 0,
          cursorOffset: 13,
        },
      });
    });

    expect(screen.getByTestId("skill-picker-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("select-skill"));

    expect(onSkillSelected).toHaveBeenCalledWith({
      provider: "codex",
      name: "release-check",
      catalogScope: "repo",
    });
    expect(hoistedMocks.anchorNode.setTextContent).toHaveBeenCalledWith("");
    expect(screen.queryByTestId("skill-picker-dialog")).toBeNull();
  });

  it("cancels without changing the command text and restores composer focus", () => {
    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        rendering="rich"
      />,
    );

    act(() => {
      hoistedMocks.emitPicker({
        type: "openPicker",
        picker: FEATURE_TREE_PICKER,
        replacementRange: {
          nodeKey: "slash-node-1",
          sliceStart: 0,
          cursorOffset: 13,
        },
        anchorPosition: {
          top: 84,
          left: 160,
        },
      });
    });

    fireEvent.click(screen.getByTestId("close-feature-tree-picker"));

    expect(screen.queryByTestId("slash-feature-tree-picker")).toBeNull();
    expect(hoistedMocks.anchorNode.setTextContent).not.toHaveBeenCalled();
    expect(hoistedMocks.focusEditor).toHaveBeenCalledTimes(1);
  });

  it("dismisses the modal with Escape", () => {
    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        rendering="rich"
      />,
    );

    act(() => {
      hoistedMocks.emitPicker({
        type: "openPicker",
        picker: FEATURE_TREE_PICKER,
        replacementRange: {
          nodeKey: "slash-node-1",
          sliceStart: 0,
          cursorOffset: 13,
        },
        anchorPosition: {
          top: 84,
          left: 160,
        },
      });
    });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByTestId("slash-feature-tree-picker")).toBeNull();
    expect(hoistedMocks.anchorNode.setTextContent).not.toHaveBeenCalled();
    expect(hoistedMocks.focusEditor).toHaveBeenCalledTimes(1);
  });

  it("leaves the command text untouched when project context is missing", () => {
    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId={null}
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        rendering="rich"
      />,
    );

    act(() => {
      hoistedMocks.emitPicker({
        type: "openPicker",
        picker: FEATURE_TREE_PICKER,
        replacementRange: {
          nodeKey: "slash-node-1",
          sliceStart: 0,
          cursorOffset: 13,
        },
        anchorPosition: {
          top: 84,
          left: 160,
        },
      });
    });

    expect(screen.queryByTestId("slash-feature-tree-picker")).toBeNull();
    expect(hoistedMocks.anchorNode.setTextContent).not.toHaveBeenCalled();
  });

  it("replaces picker mentions with canonical plain-text tokens in plain mode", () => {
    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        rendering="plain"
      />,
    );

    act(() => {
      hoistedMocks.emitPicker({
        type: "insertMention",
        entityRef: {
          entityType: "task",
          entityId: "task-1",
          entityName: "Task One",
        },
        replacementRange: {
          nodeKey: "slash-node-1",
          sliceStart: 0,
          cursorOffset: 13,
        },
      });
    });

    expect($createMentionNode).not.toHaveBeenCalled();
    expect(hoistedMocks.anchorNode.setTextContent).toHaveBeenCalledWith("");
    expect(hoistedMocks.createdTextNodes).toHaveLength(1);
    expect(hoistedMocks.createdTextNodes[0]?.text).toBe(
      "@[task:task-1|Task One] ",
    );
    expect(hoistedMocks.anchorNode.insertAfter).toHaveBeenCalledWith(
      hoistedMocks.createdTextNodes[0],
    );
    expect(hoistedMocks.recordRecentSelection).toHaveBeenCalledWith({
      id: "task-1",
      type: "task",
      name: "Task One",
    });
  });

  it("keeps the advanced-search modal path unchanged", () => {
    render(
      <RichSlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        rendering="rich"
      />,
    );

    act(() => {
      hoistedMocks.emitPicker({
        type: "openModal",
        modal: "search",
        prefill: "roadmap",
      });
    });

    expect(hoistedMocks.openModal).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        defaultQuery: "roadmap",
      }),
    );
    expect(screen.queryByTestId("slash-feature-tree-picker")).toBeNull();
  });
});
