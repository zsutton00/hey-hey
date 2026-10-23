import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceText = (path: string): string =>
  readFileSync(resolve("src/components", path), "utf8");
const renderedComponents = (path: string): string[] => {
  const source = ts.createSourceFile(
    path,
    sourceText(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      names.push(node.tagName.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
};

const directReviewOwners = [
  "CreateProposal",
  "DeleteProposal",
  "TaskCreateRenderer",
  "DesignDocCreateRenderer",
  "WorkItemTypeCreateRenderer",
  "PlanCreateRenderer",
  "WorkflowProposalRenderer",
  "TaskUpdateRenderer",
  "DesignDocUpdateRenderer",
  "WorkItemTypeLifecycleRenderer",
  "WorkItemGraphProposalRenderer",
  "EdgeOnlyUpdateRenderer",
];

describe("interactive proposal title ownership", () => {
  it.each(directReviewOwners)("%s composes ProposalTitle directly", (name) => {
    const components = renderedComponents(`ProposalDispatchers/${name}.tsx`);
    expect(components).toContain("ProposalTitle");
    expect(components).not.toContain("ProposalHeader");
  });

  it.each([
    "ProposalGroupReview/ProposalGroupMemberReview.tsx",
    "ProposalDispatchers/RejectedProposalCard.tsx",
    "ProposalDispatchers/ProposalStepper.tsx",
  ])("%s composes ProposalTitle directly", (path) => {
    expect(renderedComponents(path)).toContain("ProposalTitle");
  });

  it("keeps ProposalHeader metadata-only", () => {
    const source = sourceText("ProposalDispatchers/ProposalHeader.tsx");
    expect(
      renderedComponents("ProposalDispatchers/ProposalHeader.tsx")
    ).not.toEqual(
      expect.arrayContaining([
        "Typography",
        "EntityLinkWithPreview",
        "RouterLink",
        "ProposalTitle",
      ])
    );
    expect(source).not.toMatch(/\b(title|targetLink|titleSx|titleTestId)\b/);
  });

  it("keeps title markup and title-link branching in ProposalTitle only", () => {
    for (const path of [
      ...directReviewOwners.map((name) => `ProposalDispatchers/${name}.tsx`),
      "ProposalGroupReview/ProposalGroupMemberReview.tsx",
      "ProposalDispatchers/RejectedProposalCard.tsx",
      "ProposalDispatchers/ProposalStepper.tsx",
    ]) {
      const source = sourceText(path);
      expect(source).not.toContain("EntityLinkWithPreview");
      expect(source).not.toContain("component={RouterLink}");
      expect(source).not.toContain('data-testid="proposal-title"');
    }
    const owner = sourceText("ProposalDispatchers/ProposalTitle.tsx");
    expect(owner).toContain("EntityLinkWithPreview");
    expect(owner).not.toContain("RouterLink");
    expect(owner).toContain('variant="subtitle2"');
  });

  it.each([
    "Conversation/Components/MessageProposals.tsx",
    "ProposalDetail/ProposalDetail.tsx",
  ])("%s routes actions and groups to shared review", (path) => {
    expect(renderedComponents(path)).toEqual(
      expect.arrayContaining([
        "CreateProposal",
        "UpdateProposal",
        "DeleteProposal",
        "ProposalGroupReview",
      ])
    );
  });

  it.each([
    "ProposalList/ProposalListItem.tsx",
    "shared/EntityHoverCard/EntityHoverCard.tsx",
  ])("%s stays outside interactive title rendering", (path) => {
    expect(renderedComponents(path)).not.toContain("ProposalTitle");
    expect(renderedComponents(path)).not.toContain("ProposalHeader");
  });
});
