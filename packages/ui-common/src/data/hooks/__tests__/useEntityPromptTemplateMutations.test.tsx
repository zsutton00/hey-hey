import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../../api";
import { refetchEntityPromptTemplateProjections } from "../../collections/entityPromptTemplates";
import {
  useCreateEntityPromptTemplateChangeProposal,
  useCreateEntityPromptTemplateRetirementProposal,
  useEntityPromptTemplateProposal,
  type CreateEntityPromptTemplateChangeProposalVariables,
} from "../useEntityPromptTemplates";

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return { ...actual, useSetAtom: vi.fn() };
});

vi.mock("../../collections/entityPromptTemplates", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../collections/entityPromptTemplates")
  >()),
  refetchEntityPromptTemplateProjections: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    createProposal: vi.fn(),
  },
  entityPromptTemplatesClient: {
    getProjectEntityPromptTemplateCatalog: vi.fn(),
    getEffectiveEntityPromptTemplate: vi.fn(),
  },
}));

let observedProposal: ProposalResponseDto | null = null;
let observedProposalError: Error | null = null;

vi.mock("../useProposal", () => ({
  useProposal: vi.fn(() => ({
    proposal: observedProposal,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: observedProposalError === null,
    error: observedProposalError,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  })),
}));

import { useSetAtom } from "jotai";
import { proposalsClient } from "../../../clients/serviceClients";

const mockUseSetAtom = useSetAtom as Mock;
const mockDispatch = vi.fn();
const mockRefetchProjections = refetchEntityPromptTemplateProjections as Mock;
const mockCreateProposal = proposalsClient.createProposal as Mock;

const identity = {
  organizationId: "org-1",
  projectId: "project-1",
  templateKey: "entity_context",
  selector: {
    entityType: "WORK_ITEM" as const,
    workItemTypeKey: "STANDARD",
  },
};

const variables: CreateEntityPromptTemplateChangeProposalVariables = {
  ...identity,
  eli5: "Update the entity context template.",
  syntaxVersion: "V1",
  content: "{{entity.name}}",
  expectedEffectiveRevision: {
    revisionId: "effective-revision-1",
    revisionNumber: 1,
  },
};

const proposal = (
  id: string,
  status: ProposalResponseDto["status"] = ProposalStatus.Draft,
  updatedAt = "2026-08-21T00:00:00.000Z"
): ProposalResponseDto => ({
  id,
  organizationId: identity.organizationId,
  projectId: identity.projectId,
  type: ProposalType.Single,
  action: ProposalAction.Update,
  status,
  targetEntityId: identity.templateKey,
  targetEntityType: TargetEntityType.EntityPromptTemplate,
  updates: {
    operation: "UPSERT",
    projectId: identity.projectId,
    selector: identity.selector,
    syntaxVersion: variables.syntaxVersion,
    content: variables.content,
    expectedEffectiveRevision: variables.expectedEffectiveRevision,
  },
  requestorId: "user-1",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt,
});

describe("entity prompt-template proposal hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observedProposal = null;
    observedProposalError = null;
    mockUseSetAtom.mockReturnValue(mockDispatch);
  });

  it("creates a generated complete template-change proposal without touching projections", async () => {
    const created = proposal("proposal-change");
    mockCreateProposal.mockResolvedValue({ data: { data: created } });
    const { result } = renderHook(() =>
      useCreateEntityPromptTemplateChangeProposal()
    );

    await expect(
      act(async () => result.current.mutate(variables))
    ).resolves.toEqual(created);

    expect(mockCreateProposal).toHaveBeenCalledWith({
      organizationId: identity.organizationId,
      projectId: identity.projectId,
      createProposalRequestDto: {
        type: ProposalType.Single,
        action: ProposalAction.Update,
        eli5: variables.eli5,
        targetEntityId: identity.templateKey,
        targetEntityType: TargetEntityType.EntityPromptTemplate,
        updates: {
          operation: "UPSERT",
          projectId: identity.projectId,
          selector: identity.selector,
          syntaxVersion: variables.syntaxVersion,
          content: variables.content,
          expectedEffectiveRevision: variables.expectedEffectiveRevision,
        },
      },
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("creates retirement through standard proposal state", async () => {
    const created = {
      ...proposal("proposal-retire"),
      action: ProposalAction.Delete,
    };
    mockCreateProposal.mockResolvedValue({ data: { data: created } });
    const { result } = renderHook(() =>
      useCreateEntityPromptTemplateRetirementProposal()
    );

    await act(async () => {
      await result.current.mutate({
        ...identity,
        eli5: "Retire this entity context template.",
        expectedEffectiveRevision: variables.expectedEffectiveRevision,
      });
    });

    expect(mockCreateProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        createProposalRequestDto: expect.objectContaining({
          action: ProposalAction.Delete,
          eli5: "Retire this entity context template.",
          updates: {
            operation: "RETIRE",
            projectId: identity.projectId,
            selector: identity.selector,
            expectedEffectiveRevision: variables.expectedEffectiveRevision,
          },
        }),
      })
    );
    expect(result.current.isSuccess).toBe(true);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("keeps projections unchanged for rejected and stale-applicability states", () => {
    observedProposal = proposal("proposal-rejected", ProposalStatus.Rejected);
    const rejected = renderHook(() =>
      useEntityPromptTemplateProposal(observedProposal, identity)
    );
    expect(rejected.result.current.proposal?.status).toBe(
      ProposalStatus.Rejected
    );

    observedProposal = proposal("proposal-stale", ProposalStatus.Draft);
    observedProposalError = new Error(
      "expected revision is no longer effective"
    );
    rejected.rerender();

    expect(rejected.result.current.error).toBe(observedProposalError);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("propagates proposal transport failures without touching projections", async () => {
    const transportError = new Error("proposal service unavailable");
    mockCreateProposal.mockRejectedValue(transportError);
    const { result } = renderHook(() =>
      useCreateEntityPromptTemplateChangeProposal()
    );

    await act(async () => {
      await expect(result.current.mutate(variables)).rejects.toBe(
        transportError
      );
    });

    expect(result.current.error).toBe(transportError);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("refreshes only the exact selector after authoritative approval", async () => {
    observedProposal = proposal("proposal-approved", ProposalStatus.Approved);
    renderHook(() =>
      useEntityPromptTemplateProposal(observedProposal, identity)
    );

    await waitFor(() => expect(mockRefetchProjections).toHaveBeenCalledOnce());
    expect(mockRefetchProjections).toHaveBeenCalledWith(
      expect.anything(),
      identity
    );
  });

  it("does not refresh a cache partition that does not match the approved proposal payload", async () => {
    observedProposal = proposal("proposal-approved", ProposalStatus.Approved);
    const mismatchedIdentity = {
      ...identity,
      selector: {
        entityType: "WORK_ITEM" as const,
        workItemTypeKey: "BUG",
      },
    };

    const hook = renderHook(() =>
      useEntityPromptTemplateProposal(observedProposal, mismatchedIdentity)
    );

    await act(async () => Promise.resolve());
    expect(mockRefetchProjections).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("does not let a concurrent pending proposal refresh an approved selector", async () => {
    const approvedIdentity = identity;
    const pendingIdentity = {
      ...identity,
      selector: {
        entityType: "WORK_ITEM" as const,
        workItemTypeKey: "BUG",
      },
    };
    const approved = proposal("proposal-approved", ProposalStatus.Approved);
    const pending = proposal("proposal-pending", ProposalStatus.Draft);

    observedProposal = approved;
    const first = renderHook(() =>
      useEntityPromptTemplateProposal(approved, approvedIdentity)
    );
    observedProposal = pending;
    const second = renderHook(() =>
      useEntityPromptTemplateProposal(pending, pendingIdentity)
    );

    await waitFor(() => expect(mockRefetchProjections).toHaveBeenCalledOnce());
    expect(mockRefetchProjections.mock.calls[0]?.[1]).toBe(approvedIdentity);

    first.unmount();
    second.unmount();
  });

  it("keeps concurrent proposal creations independent", async () => {
    let resolveFirst!: (value: { data: { data: ProposalResponseDto } }) => void;
    const firstResponse = new Promise<{ data: { data: ProposalResponseDto } }>(
      (resolve) => {
        resolveFirst = resolve;
      }
    );
    mockCreateProposal
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce({ data: { data: proposal("proposal-second") } });
    const first = renderHook(() =>
      useCreateEntityPromptTemplateChangeProposal()
    );
    const second = renderHook(() =>
      useCreateEntityPromptTemplateChangeProposal()
    );

    await act(async () => {
      const firstMutation = first.result.current.mutate(variables);
      const secondMutation = second.result.current.mutate({
        ...variables,
        selector: { entityType: "DESIGN_DOC" },
      });
      await expect(secondMutation).resolves.toEqual(
        proposal("proposal-second")
      );
      resolveFirst({ data: { data: proposal("proposal-first") } });
      await expect(firstMutation).resolves.toEqual(proposal("proposal-first"));
    });

    expect(mockCreateProposal).toHaveBeenCalledTimes(2);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
