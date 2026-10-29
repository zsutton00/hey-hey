import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProposalResponseDto,
  ProposalReviewNoteRecord,
  WorkItemTypeSummaryDto,
} from "../../../api";
import { workItemTypeKeys } from "../../../data/collections/workItemTypes";
import { usersQueryOptions } from "../../../data/collections/users";
import { ProposalScreenInspection } from "../ProposalScreenInspection";

const type = {
  id: "10000000-0000-4000-8000-000000000001",
  status: "ACTIVE",
  projectId: "project-1",
  effectiveSource: "CANONICAL",
  definition: {
    key: "mockup",
    name: "Mockup",
    role: "project-info",
    allowedStatuses: [],
    sections: [
      {
        key: "screen",
        label: "Screen",
        kind: "html/css",
        defaultSizeKey: "desktop",
        sizeProfiles: [
          {
            key: "desktop",
            label: "Desktop",
            breakpoints: [
              {
                minContainerWidth: 0,
                inline: { width: 320, height: 200 },
                page: { width: 320, height: 200 },
              },
            ],
          },
        ],
      },
    ],
  },
} satisfies WorkItemTypeSummaryDto;
const proposal = {
  id: "20000000-0000-4000-8000-000000000001",
  organizationId: "org-1",
  projectId: "project-1",
  type: "SINGLE",
  action: "CREATE",
  status: "DRAFT",
  targetEntityId: "30000000-0000-4000-8000-000000000001",
  targetEntityType: "TASK",
  title: "Cart",
  updates: {
    name: "Cart",
    type: "mockup",
    sections: [
      {
        key: "screen",
        content: {
          html: '<main><button data-hh-id="checkout">Checkout</button></main>',
          css: "",
          sizeKey: "desktop",
        },
      },
    ],
  },
  requestorId: "user-1",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-10-28T00:00:00Z",
  updatedAt: "2026-10-28T00:00:00Z",
} satisfies ProposalResponseDto;

afterEach(() => vi.restoreAllMocks());

describe("frozen proposed screen inspection", () => {
  it("keeps annotation saving separate from screen content, with pending state and retry", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 320, 200),
    );
    const query = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    query.setQueryData(
      workItemTypeKeys.byKey("org-1", "project-1", "mockup"),
      type,
    );
    query.setQueryData(usersQueryOptions("org-1").queryKey, []);
    let complete: (() => void) | undefined;
    const save = vi
      .fn<(record: ProposalReviewNoteRecord) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Connection unavailable"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      );
    const Harness = () => {
      const [notes, setNotes] = useState<ProposalReviewNoteRecord[]>([]);
      return (
        <ProposalScreenInspection
          proposal={proposal}
          frozenRevision={7}
          notes={notes}
          onAddNote={async (record) => {
            await save(record);
            setNotes((previous) => [...previous, record]);
          }}
        />
      );
    };
    const frozenContent = structuredClone(proposal.updates);
    render(
      <QueryClientProvider client={query}>
        <Harness />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("html-css-add-annotation"));
    fireEvent.click(screen.getByTestId("html-css-annotation-canvas"), {
      clientX: 80,
      clientY: 150,
    });
    await user.type(
      screen.getByTestId("journey-screen-annotation-note"),
      "Make Checkout clearer",
    );
    await user.click(screen.getByTestId("journey-screen-annotation-save"));
    expect(
      await screen.findByText("Connection unavailable"),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("journey-screen-annotation-save"));
    expect(screen.getByTestId("journey-screen-annotation-save")).toBeDisabled();
    const first = save.mock.calls[0][0];
    expect(save.mock.calls[1][0]).toEqual(first);
    expect(first).toEqual(
      expect.objectContaining({
        proposalId: proposal.id,
        review: expect.objectContaining({
          frozenRevision: 7,
          sectionKey: "screen",
          sizeKey: "desktop",
          note: "Make Checkout clearer",
          target: { type: "position", x: 0.25, y: 0.75, sizeKey: "desktop" },
        }),
      }),
    );
    complete?.();
    await waitFor(() =>
      expect(
        screen.queryByTestId("journey-screen-annotation-note"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Make Checkout clearer")).toBeInTheDocument();
    expect(proposal.updates).toEqual(frozenContent);
    query.clear();
  });
});
