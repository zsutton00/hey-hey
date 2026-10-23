import { describe, expect, it } from "vitest";
import {
  roomKey,
  selectRoomOperation,
  settleRoomOperation,
  type Room,
} from "../webSocketRoomReconciliation";

const project: Room = { roomType: "project", roomId: "project" };
const conversation: Room = { roomType: "conversation", roomId: "conversation" };
const rooms = (...values: Room[]) =>
  new Map(values.map((room) => [roomKey(room), room]));

describe("room reconciliation", () => {
  it("departs obsolete membership before admitting new demand", () => {
    const desired = rooms(conversation);
    const confirmed = rooms(project);
    const departure = selectRoomOperation(desired, confirmed, new Set());
    expect(departure).toEqual({ kind: "leave", room: project });
    expect(
      selectRoomOperation(
        desired,
        settleRoomOperation(confirmed, departure!),
        new Set(),
      ),
    ).toEqual({ kind: "join", room: conversation });
    expect(confirmed.has(roomKey(project))).toBe(true);
  });
  it("rejoins demand re-added during departure only after settlement", () => {
    const desired = rooms(project);
    const confirmed = settleRoomOperation(rooms(project), {
      kind: "leave",
      room: project,
    });
    expect(selectRoomOperation(desired, confirmed, new Set())).toEqual({
      kind: "join",
      room: project,
    });
  });
  it("does not retry denied demand or touch unchanged rooms", () => {
    expect(
      selectRoomOperation(
        rooms(project, conversation),
        rooms(project),
        new Set([roomKey(conversation)]),
      ),
    ).toBeUndefined();
  });
});
