import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProposalApprovalFailureDiagnostic } from "../../../api";
import {
  extractProposalApprovalFailureDiagnostic,
  ProposalFailureDiagnostic,
  toProposalApprovalFailureError,
} from "../ProposalFailureDiagnostic";

const diagnostic: ProposalApprovalFailureDiagnostic = {
  issues: [
    {
      field: "operations[0].name",
      code: "required",
      reason: "Name is required",
      layer: "structural",
      suggestion: "Provide a name",
    },
  ],
  issueCount: 2,
  truncated: true,
  correlationId: "correlation-1",
};

describe("ProposalFailureDiagnostic", () => {
  it("renders API-owned issue details and correlation information", () => {
    render(<ProposalFailureDiagnostic diagnostic={diagnostic} />);

    expect(
      screen.getByTestId("proposal-failure-correlation"),
    ).toHaveTextContent("correlation-1");
    expect(screen.getByTestId("proposal-failure-issue")).toHaveTextContent(
      "structural · operations[0].name · required: Name is required (Provide a name)",
    );
    expect(screen.getByTestId("proposal-failure-truncated")).toHaveTextContent(
      "Showing 1 of 2 issues.",
    );
  });

  it("extracts the generated error response and preserves it in a typed error", () => {
    const error = toProposalApprovalFailureError(
      {
        response: {
          data: {
            message: "Projection requires retry",
            diagnostic,
          },
        },
      },
      "Approval failed",
    );

    expect(error.message).toBe("Projection requires retry");
    expect(extractProposalApprovalFailureDiagnostic(error)).toEqual(diagnostic);
  });
});
