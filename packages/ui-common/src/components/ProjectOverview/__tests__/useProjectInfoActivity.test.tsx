import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIdentitySnapshot } from "../projectInfoActivityState";

describe("committed activity snapshots", () => {
  it("retains a coherent empty success, replaces it atomically, and forgets old identities", () => {
    const empty = { rows: [], created: 0, updated: 0 };
    const { result, rerender } = renderHook(
      ({
        identity,
        value,
      }: {
        identity: string;
        value: typeof empty | undefined;
      }) => useIdentitySnapshot(identity, value),
      {
        initialProps: {
          identity: "a",
          value: empty as typeof empty | undefined,
        },
      }
    );
    rerender({ identity: "a", value: undefined });
    expect(result.current).toBe(empty);
    const next = { rows: [], created: 8, updated: 4 };
    rerender({ identity: "a", value: next });
    expect(result.current).toBe(next);
    rerender({ identity: "b", value: undefined });
    expect(result.current).toBeUndefined();
    rerender({ identity: "a", value: undefined });
    expect(result.current).toBeUndefined();
  });
});
