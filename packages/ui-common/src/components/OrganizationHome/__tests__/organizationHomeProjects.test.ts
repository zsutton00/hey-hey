import { describe, expect, it } from "vitest";
import { paginateHomeProjects } from "../organizationHomeProjects";

describe("Home project pagination", () => {
  it("clamps the current page after result removal and gives a defined empty page", () => {
    expect(paginateHomeProjects([1, 2, 3, 4, 5, 6], 3)).toEqual({
      page: 2,
      pageCount: 2,
      projects: [6],
    });
    expect(paginateHomeProjects([], 3)).toEqual({
      page: 1,
      pageCount: 1,
      projects: [],
    });
  });
});
