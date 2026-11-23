import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangeWalkthroughReportPayload } from "../../../api";
import { ChangeWalkthroughReport } from "./ChangeWalkthroughReport";

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

const payload = {
  reportType: "CHANGE_WALKTHROUGH",
  summary:
    "The Run made session metadata reliable.\n\n- **resolveAgentSessionMetadata** (`metadata.ts`): reads session data.",
  targetRunId: "11111111-1111-4111-8111-111111111111",
  groups: [
    {
      title: "Metadata",
      changes: [
        {
          title: "Resolve metadata",
          context: "Called by **the launcher**.",
          walkthrough: [],
          behavioralConsequence: "Sessions start with metadata.",
        },
      ],
    },
  ],
} satisfies ChangeWalkthroughReportPayload;

describe("ChangeWalkthroughReport", () => {
  it("sends the summary and change prose through the Markdown renderer", () => {
    render(<ChangeWalkthroughReport payload={payload} />);

    const rendered = screen
      .getAllByTestId("markdown")
      .map((n) => n.textContent);
    expect(rendered).toContain(payload.summary);
    expect(rendered).toContain("Called by **the launcher**.");
    expect(rendered).toContain("Sessions start with metadata.");
  });

  it("shows a headed parts section before the change groups", () => {
    render(
      <ChangeWalkthroughReport
        payload={{
          ...payload,
          parts: [
            {
              name: "transition-service",
              role: "Moves a message between delivery states.",
              relations: "Called by the mail delivery service.",
            },
          ],
        }}
      />,
    );

    const parts = screen.getByTestId("walkthrough-parts");
    const group = screen.getByTestId("walkthrough-group");
    expect(parts).toHaveTextContent("Parts of the system");
    expect(screen.getByTestId("walkthrough-part")).toHaveTextContent(
      "transition-service",
    );
    expect(parts).toHaveTextContent("Moves a message between delivery states.");
    expect(parts).toHaveTextContent("Called by the mail delivery service.");
    expect(
      parts.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders older reports saved without parts and shows no parts section", () => {
    render(<ChangeWalkthroughReport payload={payload} />);

    expect(screen.getByTestId("walkthrough-group")).toBeInTheDocument();
    expect(screen.queryByTestId("walkthrough-parts")).not.toBeInTheDocument();
  });
});
