import { expect, it } from "vitest";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../../api";
import { manualReconciliationContent } from "../manualReconciliationContent";

it("retains intervening fields and sections while exposing overlapping proposed text for review", () => {
  const baseline = {
    name: "Original",
    type: "FEATURE",
    priority: "LOW",
    sections: [
      { key: "description", order: 0, materializedMarkdown: "Old" },
      { key: "notes", order: 1, materializedMarkdown: "Unchanged" },
    ],
  };
  const result = {
    ...baseline,
    name: "Proposed",
    sections: [
      { ...baseline.sections[0], materializedMarkdown: "Proposed body" },
      baseline.sections[1],
    ],
  };
  const proposal = {
    action: "VERSIONED_UPDATE",
    updates: { operation: "REVISE", baseline: { content: baseline } },
  } as ProposalResponseDto;
  const state = {
    candidateRevisionId: "revision",
    revisions: [{ id: "revision", proposedResult: result }],
    currentBases: [
      {
        content: {
          name: "Current",
          materializedSections: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              key: "added",
              materializedProposalId: "",
            },
          ],
          priority: "HIGH",
          sections: {
            description: "Overlapping current body",
            notes: "New notes",
            added: "New section",
          },
          sectionOrder: { description: 0, notes: 1, added: 2 },
        },
      },
    ],
  } as unknown as ProposalReconciliationState;
  const edited = manualReconciliationContent(proposal, state);
  expect(edited).toMatchObject({
    name: "Proposed",
    priority: "HIGH",
    sections: [
      { key: "description", materializedMarkdown: "Proposed body" },
      { key: "notes", materializedMarkdown: "New notes" },
      { key: "added", materializedMarkdown: "New section" },
    ],
  });
  expect(edited.sections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "added",
        id: "10000000-0000-4000-8000-000000000001",
      }),
    ]),
  );
  expect(result.priority).toBe("LOW");
});
