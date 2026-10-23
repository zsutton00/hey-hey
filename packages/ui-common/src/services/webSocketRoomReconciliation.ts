import type { WebSocketLeaveRoomRequest } from "../api";

export type Room = WebSocketLeaveRoomRequest;
export type RoomKey = `${Room["roomType"]}:${string}`;
export interface RoomOperation {
  kind: "join" | "leave";
  room: Room;
}
export const roomKey = (room: Room): RoomKey =>
  `${room.roomType}:${room.roomId}`;

/** Departures take priority; an in-flight operation must settle before selecting again. */
export function selectRoomOperation(
  desired: ReadonlyMap<RoomKey, Room>,
  confirmed: ReadonlyMap<RoomKey, Room>,
  denied: ReadonlySet<RoomKey>,
): RoomOperation | undefined {
  for (const [key, room] of confirmed) {
    if (!desired.has(key)) return { kind: "leave", room };
  }
  for (const [key, room] of desired) {
    if (!confirmed.has(key) && !denied.has(key)) return { kind: "join", room };
  }
}

export function settleRoomOperation(
  confirmed: ReadonlyMap<RoomKey, Room>,
  operation: RoomOperation,
): Map<RoomKey, Room> {
  const next = new Map(confirmed);
  if (operation.kind === "join")
    next.set(roomKey(operation.room), operation.room);
  else next.delete(roomKey(operation.room));
  return next;
}
