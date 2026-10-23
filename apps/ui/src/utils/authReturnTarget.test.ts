import { describe, expect, it } from "vitest";
import type { Location } from "react-router-dom";
import {
  DEFAULT_POST_LOGIN_PATH,
  getAuthReturnTarget,
  normalizeInternalReturnTarget,
  resolveAuthReturnTarget,
} from "./authReturnTarget";

const makeLocation = (overrides: Partial<Location>): Location =>
  ({
    pathname: "/login",
    search: "",
    hash: "",
    state: null,
    key: "test",
    ...overrides,
  }) as Location;

describe("authReturnTarget", () => {
  it("normalizes an internal path with query and hash", () => {
    expect(
      normalizeInternalReturnTarget(
        "/projects/project-1/features/feature-1?tab=docs#notes",
      ),
    ).toBe("/projects/project-1/features/feature-1?tab=docs#notes");
  });

  it("normalizes router location state with query and hash", () => {
    expect(
      normalizeInternalReturnTarget({
        pathname: "/projects/project-1/activity",
        search: "?target=report-1",
        hash: "#summary",
      }),
    ).toBe("/projects/project-1/activity?target=report-1#summary");
  });

  it.each([
    "https://example.com/projects",
    "http://app.local/projects",
    "//example.com/projects",
    "projects/project-1",
    "/login",
    "/login?returnTo=/projects",
    "/login/step",
    "/projects\\evil",
    " /projects",
  ])("rejects unsafe return target %s", (target) => {
    expect(normalizeInternalReturnTarget(target)).toBeNull();
  });

  it("resolves state before the returnTo query param", () => {
    const location = makeLocation({
      search: "?returnTo=%2Fprojects%2Ffrom-query",
      state: {
        from: {
          pathname: "/projects/from-state",
          search: "?tab=activity",
          hash: "#item",
        },
      },
    });

    expect(resolveAuthReturnTarget(location)).toBe(
      "/projects/from-state?tab=activity#item",
    );
  });

  it("falls back when no valid target exists", () => {
    const location = makeLocation({
      search: "?returnTo=https%3A%2F%2Fexample.com%2Fphish",
      state: { from: "/login" },
    });

    expect(resolveAuthReturnTarget(location)).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it("captures the full current router location", () => {
    const location = makeLocation({
      pathname: "/projects/project-1/features/feature-1",
      search: "?tab=docs",
      hash: "#notes",
    });

    expect(getAuthReturnTarget(location)).toEqual({
      pathname: "/projects/project-1/features/feature-1",
      search: "?tab=docs",
      hash: "#notes",
    });
  });
});
