import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocalRuntimeUnavailableAlert } from "../LocalRuntimeUnavailableAlert";

describe("LocalRuntimeUnavailableAlert (always returns null)", () => {
  it("renders nothing regardless of error prop", () => {
    const { container } = render(
      <LocalRuntimeUnavailableAlert error="Failed to fetch" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when error is null", () => {
    const { container } = render(<LocalRuntimeUnavailableAlert error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no prop is passed", () => {
    const { container } = render(<LocalRuntimeUnavailableAlert />);
    expect(container.firstChild).toBeNull();
  });
});
