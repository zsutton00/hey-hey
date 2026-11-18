import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BrandedButton,
  BrandedDivider,
  BrandedHeadline,
  BrandedPage,
  BrandedWordmark,
} from "../BrandedFrame";

describe("BrandedFrame", () => {
  it("renders the wordmark, headline and optional line outside any card", () => {
    render(
      <BrandedPage data-testid="page">
        <BrandedWordmark>HEY HEY</BrandedWordmark>
        <BrandedHeadline line="Sign in to continue">
          Welcome back
        </BrandedHeadline>
      </BrandedPage>,
    );

    expect(screen.getByRole("main")).toBe(screen.getByTestId("page"));
    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome back" }),
    ).toBeVisible();
    expect(screen.getByText("Sign in to continue")).toBeVisible();
  });

  it("omits the line when none is given", () => {
    const { container } = render(<BrandedHeadline>Title</BrandedHeadline>);

    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("exposes the divider as a labelled separator", () => {
    render(<BrandedDivider label="OR" />);

    expect(screen.getByRole("separator", { name: "or" })).toBeVisible();
  });

  it("gives both button variants the same size and renders links", () => {
    render(
      <>
        <BrandedButton>Primary</BrandedButton>
        <BrandedButton variant="secondary">Secondary</BrandedButton>
        <BrandedButton href="/x">Link</BrandedButton>
      </>,
    );

    const primary = getComputedStyle(
      screen.getByRole("button", { name: "Primary" }),
    );
    const secondary = getComputedStyle(
      screen.getByRole("button", { name: "Secondary" }),
    );
    expect(secondary.width).toBe(primary.width);
    expect(secondary.minHeight).toBe(primary.minHeight);
    expect(screen.getByRole("link", { name: "Link" })).toHaveAttribute(
      "href",
      "/x",
    );
  });
});
