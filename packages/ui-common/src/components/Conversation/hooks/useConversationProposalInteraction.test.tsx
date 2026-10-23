import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ProposalStatus,
  TargetEntityType,
  type MessageResponseDto,
  type ProposalResponseDto,
} from "../../../api";
import {
  __resetForTests,
  setLifecycle,
} from "../../ProposalDispatchers/proposalSelectedStateCache";
import {
  collectConversationProposals,
  useConversationProposalInteraction,
} from "./useConversationProposalInteraction";

const proposal = (
  id: string,
  status: ProposalStatus = ProposalStatus.Draft
): ProposalResponseDto =>
  ({
    id,
    status,
    updatedAt: "2026-09-09T00:00:00Z",
  } as ProposalResponseDto);
const carrier = (
  id: string,
  proposals: ProposalResponseDto[],
  responses: MessageResponseDto[] = []
): MessageResponseDto =>
  ({
    id,
    type: "SYSTEM",
    data: { type: "CARRIER" },
    proposals,
    responses,
  } as MessageResponseDto);

describe("conversation proposal interaction", () => {
  beforeEach(__resetForTests);

  it("collects all carriers and nested messages, including grouped proposals, and deduplicates identities", () => {
    const grouped = {
      ...proposal("grouped"),
      groupMembership: { groupId: "group" },
    } as ProposalResponseDto;
    const newer = {
      ...proposal("one", ProposalStatus.Approved),
      updatedAt: "2026-09-09T01:00:00Z",
    };
    const messages = [
      carrier("first", [proposal("one")], [carrier("nested", [grouped])]),
      carrier("second", [newer, proposal("two")]),
      carrier("duplicate", [proposal("one")]),
    ];
    expect(collectConversationProposals(messages)).toEqual([
      newer,
      grouped,
      proposal("two"),
    ]);
  });

  it("updates approvals and rejections without a rendered carrier or refetch", () => {
    const messages = [carrier("hidden", [proposal("one"), proposal("two")])];
    const { result } = renderHook(() =>
      useConversationProposalInteraction(messages)
    );
    expect(result.current.proposals.map((p) => p.lifecycle)).toEqual([
      "DRAFT",
      "DRAFT",
    ]);
    act(() => setLifecycle("one", "applied"));
    expect(result.current.proposals.map((p) => p.lifecycle)).toEqual([
      "APPROVED",
      "DRAFT",
    ]);
    act(() => setLifecycle("one", "rejected"));
    expect(result.current.proposals.map((p) => p.lifecycle)).toEqual([
      "REJECTED",
      "DRAFT",
    ]);
  });

  it("projects the target work-item type needed by stage review", () => {
    const stage = {
      ...proposal("stage"),
      targetEntityType: TargetEntityType.Task,
      updates: { type: "PLAN_STAGE" },
    } as ProposalResponseDto;
    const designDoc = {
      ...proposal("design-doc"),
      targetEntityType: TargetEntityType.DesignDoc,
      updates: { type: "PLAN_STAGE" },
    } as ProposalResponseDto;

    const { result } = renderHook(() =>
      useConversationProposalInteraction([
        carrier("carrier", [stage, designDoc]),
      ])
    );

    expect(result.current.proposals).toEqual([
      {
        proposalId: "stage",
        lifecycle: "DRAFT",
        targetWorkItemType: "PLAN_STAGE",
      },
      {
        proposalId: "design-doc",
        lifecycle: "DRAFT",
        targetWorkItemType: null,
      },
    ]);
  });

  it("removes withdrawn proposals, accepts replacements, and isolates another conversation", () => {
    const { result, rerender } = renderHook(
      ({ messages }) => useConversationProposalInteraction(messages),
      {
        initialProps: { messages: [carrier("first", [proposal("old")])] },
      }
    );
    act(() => setLifecycle("old", "applied"));
    rerender({ messages: [carrier("first", [])] });
    expect(result.current.proposals).toEqual([]);
    rerender({ messages: [carrier("replacement", [proposal("new")])] });
    expect(result.current.proposals).toEqual([
      { proposalId: "new", lifecycle: "DRAFT", targetWorkItemType: null },
    ]);
    rerender({
      messages: [carrier("other-conversation", [proposal("other")])],
    });
    act(() => setLifecycle("new", "applied"));
    expect(result.current.proposals).toEqual([
      { proposalId: "other", lifecycle: "DRAFT", targetWorkItemType: null },
    ]);
  });

  it("refreshes membership and lifecycle from canonical message updates", () => {
    const { result, rerender } = renderHook(
      ({ messages }) => useConversationProposalInteraction(messages),
      {
        initialProps: { messages: [carrier("first", [proposal("one")])] },
      }
    );
    rerender({
      messages: [
        carrier("first", [proposal("one", ProposalStatus.Approved)]),
        carrier("second", [proposal("two")]),
      ],
    });
    expect(result.current.proposals).toEqual([
      {
        proposalId: "one",
        lifecycle: "APPROVED",
        targetWorkItemType: null,
      },
      { proposalId: "two", lifecycle: "DRAFT", targetWorkItemType: null },
    ]);
  });
});
