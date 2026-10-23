import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FeatureTag } from "../../../api";
import { FEATURE_TAG_PALETTE } from "../../Features/featureTagPalette";
import { FeatureTagSelector } from "../FeatureTagSelector";

describe("FeatureTagSelector", () => {
  it("renders the selected tag in the closed control", () => {
    render(
      <FeatureTagSelector value={FeatureTag.Product} onChange={vi.fn()} />
    );

    expect(
      screen.getByText(FEATURE_TAG_PALETTE[FeatureTag.Product].label)
    ).toBeInTheDocument();
  });

  it("calls onChange with the picked tag", async () => {
    const onChange = vi.fn();
    render(
      <FeatureTagSelector value={FeatureTag.Product} onChange={onChange} />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(
      screen.getByRole("option", {
        name: FEATURE_TAG_PALETTE[FeatureTag.Backend].label,
      })
    );

    expect(onChange).toHaveBeenCalledWith(FeatureTag.Backend);
  });

  it("renders the unset state when value is null", () => {
    render(<FeatureTagSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Untagged")).toBeInTheDocument();
  });

  it("does not call onChange when disabled", async () => {
    const onChange = vi.fn();
    render(
      <FeatureTagSelector
        value={FeatureTag.Product}
        onChange={onChange}
        disabled
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    expect(
      screen.queryByRole("option", {
        name: FEATURE_TAG_PALETTE[FeatureTag.Backend].label,
      })
    ).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
