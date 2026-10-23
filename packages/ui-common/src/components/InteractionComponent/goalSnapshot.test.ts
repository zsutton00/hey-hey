import { expect, it } from "vitest";
import {
  getGoalSnapshotFromWorkItem,
  buildGoalEntityFields,
} from "./goalSnapshot";

it("omits deadlines from an undated Goal conversation snapshot", () => {
  const snapshot = getGoalSnapshotFromWorkItem({ type: "GOAL", dueDate: null });
  expect(snapshot).toBeDefined();
  expect(snapshot).not.toHaveProperty("dueDate");
  expect(buildGoalEntityFields(snapshot!)).not.toHaveProperty("dueDate");
});

it("retains a real date in the Goal conversation snapshot", () => {
  const dueDate = "2026-12-01T00:00:00.000Z";
  const snapshot = getGoalSnapshotFromWorkItem({ type: "GOAL", dueDate });
  expect(snapshot?.dueDate).toBe(dueDate);
  expect(buildGoalEntityFields(snapshot!).dueDate).toBe(dueDate);
});
