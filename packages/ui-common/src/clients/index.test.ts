import { describe, expect, it } from "vitest";
import { eventsClient } from "./index";

describe("eventsClient", () => {
  it("exposes the generated replay operation through the runtime proxy", () => {
    expect(typeof eventsClient.replayDebugEvents).toBe("function");
  });
});
