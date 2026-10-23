import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionReportDismissalChannel,
  hasShownRecord,
  writeShownRecord,
} from "../sessionReportToastCoordination";

const TTL_MS = 24 * 60 * 60 * 1000;

const flushBroadcast = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

describe("sessionReportToastCoordination", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  describe("shown record", () => {
    it("reports no record before one is written", () => {
      expect(hasShownRecord("project-1", "report-1")).toBe(false);
    });

    it("reports a record after writeShownRecord for the same project + report", () => {
      writeShownRecord("project-1", "report-1");

      expect(hasShownRecord("project-1", "report-1")).toBe(true);
    });

    it("keys the record per project so other projects do not cross-suppress", () => {
      writeShownRecord("project-1", "report-1");

      expect(hasShownRecord("project-1", "report-1")).toBe(true);
      expect(hasShownRecord("project-2", "report-1")).toBe(false);
    });

    it("keys the record per report", () => {
      writeShownRecord("project-1", "report-1");

      expect(hasShownRecord("project-1", "report-2")).toBe(false);
    });
  });

  describe("shown record pruning", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("treats a record past the TTL as absent", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-21T00:00:00.000Z"));
      writeShownRecord("project-1", "report-1");

      vi.setSystemTime(new Date("2026-05-21T00:00:00.000Z").getTime() + TTL_MS);

      expect(hasShownRecord("project-1", "report-1")).toBe(false);
    });

    it("keeps a record that is still within the TTL", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-21T00:00:00.000Z"));
      writeShownRecord("project-1", "report-1");

      vi.setSystemTime(
        new Date("2026-05-21T00:00:00.000Z").getTime() + 60 * 60 * 1000,
      );

      expect(hasShownRecord("project-1", "report-1")).toBe(true);
    });

    it("caps records per project, evicting the oldest first", () => {
      vi.useFakeTimers();
      const start = new Date("2026-05-21T00:00:00.000Z").getTime();
      // Write 55 records 1s apart; the per-project cap is 50.
      for (let index = 0; index < 55; index += 1) {
        vi.setSystemTime(start + index * 1000);
        writeShownRecord("project-1", `report-${index}`);
      }

      // The five oldest were evicted once the map exceeded the cap.
      expect(hasShownRecord("project-1", "report-0")).toBe(false);
      expect(hasShownRecord("project-1", "report-4")).toBe(false);
      // The most recent 50 survive.
      expect(hasShownRecord("project-1", "report-5")).toBe(true);
      expect(hasShownRecord("project-1", "report-54")).toBe(true);
    });

    it("prunes expired entries of other reports when a new record is written", () => {
      vi.useFakeTimers();
      const start = new Date("2026-05-21T00:00:00.000Z").getTime();
      vi.setSystemTime(start);
      writeShownRecord("project-1", "stale-report");

      // Past the TTL, write a fresh record — the stale entry is pruned out.
      vi.setSystemTime(start + TTL_MS + 1000);
      writeShownRecord("project-1", "fresh-report");

      expect(hasShownRecord("project-1", "stale-report")).toBe(false);
      expect(hasShownRecord("project-1", "fresh-report")).toBe(true);
    });
  });

  describe("dismissal channel", () => {
    it("delivers a dismissal to a sibling channel on the same project", async () => {
      const sender = createSessionReportDismissalChannel("project-1");
      const receiver = createSessionReportDismissalChannel("project-1");
      const received: string[] = [];
      const unsubscribe = receiver.subscribe((reportId) => {
        received.push(reportId);
      });

      sender.broadcastDismissal("report-1");
      await flushBroadcast();

      expect(received).toEqual(["report-1"]);

      unsubscribe();
      sender.close();
      receiver.close();
    });

    it("does not deliver a dismissal across projects", async () => {
      const sender = createSessionReportDismissalChannel("project-1");
      const receiver = createSessionReportDismissalChannel("project-2");
      const received: string[] = [];
      const unsubscribe = receiver.subscribe((reportId) => {
        received.push(reportId);
      });

      sender.broadcastDismissal("report-1");
      await flushBroadcast();

      expect(received).toEqual([]);

      unsubscribe();
      sender.close();
      receiver.close();
    });

    it("stops delivering after unsubscribe", async () => {
      const sender = createSessionReportDismissalChannel("project-1");
      const receiver = createSessionReportDismissalChannel("project-1");
      const received: string[] = [];
      const unsubscribe = receiver.subscribe((reportId) => {
        received.push(reportId);
      });
      unsubscribe();

      sender.broadcastDismissal("report-1");
      await flushBroadcast();

      expect(received).toEqual([]);

      sender.close();
      receiver.close();
    });
  });
});
