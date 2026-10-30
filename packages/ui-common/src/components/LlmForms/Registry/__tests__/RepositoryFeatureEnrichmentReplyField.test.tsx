import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FIELD_REGISTRY } from "../Registry";
import { RepositoryFeatureEnrichmentReplyField } from "../RepositoryFeatureEnrichmentReplyField";

vi.mock("../../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <textarea
      aria-label="enrichment reply"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const renderField = (
  props: Partial<
    React.ComponentProps<typeof RepositoryFeatureEnrichmentReplyField>
  > = {},
) =>
  render(
    <RepositoryFeatureEnrichmentReplyField
      config={{
        field: "reply",
        type: "repository_feature_enrichment_reply",
        description: "Your answer",
      }}
      context={{
        messageData: { type: "AGENT" },
        conversationId: "conversation",
        organizationId: "organization",
        projectId: "project",
        interaction: { proposals: [] },
      }}
      isSubmitted={false}
      {...props}
    />,
  );

describe("RepositoryFeatureEnrichmentReplyField", () => {
  it("is registered, exclusive, and only has content once the user typed an answer", () => {
    const entry = FIELD_REGISTRY.repository_feature_enrichment_reply;

    expect(entry).toBeDefined();
    expect(entry?.responseBehavior).toMatchObject({ ownership: "exclusive" });
    expect(entry?.getHasContent("   ")).toBe(false);
    expect(entry?.getHasContent("It powers billing.")).toBe(true);
  });

  it("propagates typed text", async () => {
    const onChange = vi.fn();
    renderField({ onChange });

    await userEvent.type(screen.getByLabelText("enrichment reply"), "a");

    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("shows an answered reply read-only", () => {
    renderField({ value: "It powers billing.", isSubmitted: true });

    const reply = screen.getByLabelText("enrichment reply");
    expect(reply).toHaveValue("It powers billing.");
    expect(reply).toBeDisabled();
  });
});
