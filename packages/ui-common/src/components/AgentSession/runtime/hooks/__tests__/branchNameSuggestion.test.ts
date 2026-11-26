import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliReadServicePlacesEntry } from "../../../../../api";
import {
  findUnusedBranchName,
  MAX_CANDIDATE_SEARCHES,
  suggestedBranchBase,
} from "../branchNameSuggestion";
import type { ServicePlacesRead } from "../readServicePlaces";

const BASE = "fix-the-pairing-poll";

interface Repository {
  main?: string | null;
  worktrees?: (string | null)[];
  branches?: string[];
}

/**
 * Answers like the machine: substring search ignoring case, 20 at most, with
 * the branches named the query or under it first.
 */
const machineWith = (repositories: Record<string, Repository>) =>
  vi.fn(async (query: string): Promise<ServicePlacesRead> => {
    const entries = Object.entries(repositories).map(
      ([serviceId, repository]): [string, CliReadServicePlacesEntry] => {
        const needle = query.toLowerCase();
        const blocks = (branch: string): boolean =>
          `${branch.toLowerCase()}/`.startsWith(`${needle}/`);
        const matches = (repository.branches ?? [])
          .filter((branch) => branch.toLowerCase().includes(needle))
          .sort((a, b) => Number(blocks(b)) - Number(blocks(a)));

        return [
          serviceId,
          {
            serviceId,
            status: "ok",
            mainFolder: {
              path: `/${serviceId}`,
              branch: repository.main === undefined ? "main" : repository.main,
            },
            worktrees: (repository.worktrees ?? []).map((branch, index) => ({
              branch,
              worktreePath: `/${serviceId}/${String(index)}`,
            })),
            branchMatches: matches.slice(0, 20),
            branchMatchesTruncated: matches.length > 20,
          },
        ];
      },
    );

    return new Map(entries);
  });

/** Enough look-alike branches, listed first, to cut a search off. */
const crowd = Array.from(
  { length: 25 },
  (_, index) => `old/${BASE}-${String(index)}x`,
);

describe("suggestedBranchBase", () => {
  it.each([
    ["Fix the pairing poll", BASE],
    ["  Fix: the (pairing)  poll!! ", BASE],
    [
      "Name a new worktree in place of the Branch or worktree field",
      "name-a-new-worktree-in-place-of-the",
    ],
    // The word ending exactly at the limit is kept whole.
    [`${"a".repeat(35)} bcde fgh`, `${"a".repeat(35)}-bcde`],
    ["x".repeat(55), "x".repeat(40)],
    ["修复配对 — !!", ""],
    ["", ""],
  ])("makes %j into %j", (name, expected) => {
    expect(suggestedBranchBase(name)).toBe(expected);
  });
});

describe("findUnusedBranchName", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("offers the task's own name when no Service has it", async () => {
    const read = machineWith({
      api: { branches: [`${BASE}ing`, `team/${BASE}`] },
    });

    await expect(findUnusedBranchName(BASE, ["api"], read)).resolves.toBe(BASE);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("numbers past every use in any applicable Service, in one read", async () => {
    const read = machineWith({
      api: { main: "Fix-The-Pairing-Poll" },
      ui: { worktrees: [null, `${BASE}-2`] },
      cli: { branches: [`${BASE}-3/spike`] },
      other: { branches: [`${BASE}-4`] },
    });

    await expect(
      findUnusedBranchName(BASE, ["api", "ui", "cli"], read),
    ).resolves.toBe(`${BASE}-4`);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("searches for each candidate itself when the first search was cut off", async () => {
    // The numbered branch sits beyond the first 20 matches.
    const read = machineWith({
      api: { branches: [BASE, ...crowd, `${BASE}-2`] },
    });

    await expect(findUnusedBranchName(BASE, ["api"], read)).resolves.toBe(
      `${BASE}-3`,
    );
    expect(read.mock.calls.map(([query]) => query)).toEqual([
      BASE,
      `${BASE}-2`,
      `${BASE}-3`,
    ]);
  });

  it("numbers past an exact branch older than a full page of look-alikes", async () => {
    const read = machineWith({ api: { branches: [...crowd, BASE] } });

    await expect(findUnusedBranchName(BASE, ["api"], read)).resolves.toBe(
      `${BASE}-2`,
    );
  });

  it("still offers a name after the extra searches are used up", async () => {
    const numbered = Array.from(
      { length: MAX_CANDIDATE_SEARCHES + 3 },
      (_, index) => `${BASE}-${String(index + 2)}`,
    );
    const read = machineWith({
      api: { branches: [BASE, ...crowd, ...numbered] },
    });

    await expect(findUnusedBranchName(BASE, ["api"], read)).resolves.toBe(
      `${BASE}-${String(MAX_CANDIDATE_SEARCHES + 2)}`,
    );
    expect(read).toHaveBeenCalledTimes(1 + MAX_CANDIDATE_SEARCHES);
  });

  it("offers the name and logs the cause when the read fails", async () => {
    const failure = new Error("machine offline");

    await expect(
      findUnusedBranchName(BASE, ["api"], async () => {
        throw failure;
      }),
    ).resolves.toBe(BASE);
    expect(warn).toHaveBeenCalledWith(expect.any(String), failure);
  });

  it("checks the readable Services and logs the one that cannot be read", async () => {
    const readable = machineWith({ api: { branches: [BASE] } });
    const read = async (query: string): Promise<ServicePlacesRead> =>
      new Map([
        ...(await readable(query)),
        [
          "ui",
          {
            serviceId: "ui",
            status: "error",
            code: "NOT_A_GIT_REPOSITORY",
            message: "Not a git repository",
          } as CliReadServicePlacesEntry,
        ],
      ]);

    await expect(findUnusedBranchName(BASE, ["api", "ui"], read)).resolves.toBe(
      `${BASE}-2`,
    );
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      serviceId: "ui",
      code: "NOT_A_GIT_REPOSITORY",
      message: "Not a git repository",
    });
  });
});
