import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Stored {
  payload: Record<string, unknown>;
  version: number;
}

let stored: Stored;
// Runs once, between the rename's read and its write.
let beforeNextUpdate: Array<() => void>;

vi.mock("../../../clients/serviceClients", () => ({
  evalRunsClient: {},
  platformClient: {},
  unifiedApiClient: {
    getReport: async () => ({
      data: { data: { id: "run-1", ...stored } },
    }),
    updateReport: async ({
      updateReportDto,
    }: {
      updateReportDto: {
        payload: Record<string, unknown>;
        expectedVersion?: number;
      };
    }) => {
      beforeNextUpdate.shift()?.();
      if (updateReportDto.expectedVersion !== stored.version) {
        throw new AxiosError("conflict", "409", undefined, undefined, {
          status: 409,
        } as never);
      }
      stored = {
        payload: updateReportDto.payload,
        version: stored.version + 1,
      };
      return { data: { data: { id: "run-1", ...stored } } };
    },
  },
}));

import { renameEvalRun, type EvalRunReport } from "../evalRuns";

const RUNNING = {
  reportType: "EVAL_RUN",
  evalId: "eval-1",
  status: "RUNNING",
  cases: [{ id: "case-1" }],
  configurations: [{ id: "cfg" }],
};

const readRun = (): EvalRunReport =>
  ({ id: "run-1", ...stored }) as unknown as EvalRunReport;

describe("renameEvalRun", () => {
  beforeEach(() => {
    stored = { payload: { ...RUNNING, name: "Old" }, version: 1 };
    beforeNextUpdate = [];
  });

  it("changes only the name and trims it", async () => {
    await renameEvalRun("org", readRun(), "  New  ");

    expect(stored.payload).toEqual({ ...RUNNING, name: "New" });
  });

  it("removes the name when cleared, changing nothing else", async () => {
    await renameEvalRun("org", readRun(), "   ");

    expect(stored.payload).toEqual(RUNNING);
  });

  it("does not undo progress the runner recorded after the page last read the run", async () => {
    const stale = readRun();
    // The run finishes before the rename is saved.
    stored = {
      payload: {
        ...stored.payload,
        status: "FINISHED",
        completedAt: "2026-11-01T10:00:00.000Z",
      },
      version: 2,
    };

    await renameEvalRun("org", stale, "Renamed");

    expect(stored.payload).toMatchObject({
      status: "FINISHED",
      completedAt: "2026-11-01T10:00:00.000Z",
      name: "Renamed",
    });
  });

  it("keeps progress recorded while the rename is being saved", async () => {
    beforeNextUpdate.push(() => {
      stored = {
        payload: { ...stored.payload, status: "STOPPED" },
        version: stored.version + 1,
      };
    });

    await renameEvalRun("org", readRun(), "Renamed");

    expect(stored.payload).toMatchObject({
      status: "STOPPED",
      name: "Renamed",
    });
  });
});
