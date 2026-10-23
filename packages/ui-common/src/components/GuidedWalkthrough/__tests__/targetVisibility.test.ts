import { afterEach, describe, expect, it } from "vitest";
import { isGuidableTargetVisible } from "../targetVisibility";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("live target readiness", () => {
  it.each([
    "hidden",
    "aria-hidden",
    "display",
    "visibility",
    "zero-size",
    "detached",
  ])(
    "rejects a mounted address with %s instead of highlighting empty space",
    (state) => {
      const container = document.createElement("div");
      const target = document.createElement("button");
      container.appendChild(target);
      document.body.appendChild(container);
      target.getBoundingClientRect = () =>
        new DOMRect(10, 10, 100, state === "zero-size" ? 0 : 30);
      if (state === "hidden") container.hidden = true;
      if (state === "aria-hidden")
        container.setAttribute("aria-hidden", "true");
      if (state === "display") container.style.display = "none";
      if (state === "visibility") container.style.visibility = "hidden";
      if (state === "detached") container.remove();
      expect(isGuidableTargetVisible(target)).toBe(false);
      container.hidden = false;
      container.removeAttribute("aria-hidden");
      container.removeAttribute("style");
      target.getBoundingClientRect = () => new DOMRect(10, 10, 100, 30);
      document.body.appendChild(container);
      expect(isGuidableTargetVisible(target)).toBe(true);
    }
  );
});
