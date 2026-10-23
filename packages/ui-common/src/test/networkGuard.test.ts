import axios from "axios";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { takeUnexpectedRequests } from "./networkGuard";

describe("shared network guard", () => {
  it("returns a local error and records a missing mock even when the caller handles the error", async () => {
    await expect(
      axios.get("http://unmocked-test.invalid/missing-fixture", {
        timeout: 1000,
      })
    ).rejects.toMatchObject({
      response: {
        status: 500,
        data: { message: "Missing test request handler: GET /missing-fixture" },
      },
    });
    expect(takeUnexpectedRequests()).toEqual(["GET /missing-fixture"]);
    expect(takeUnexpectedRequests()).toEqual([]);
  });

  it("allows explicit suite handlers to override the guard", async () => {
    globalThis.mswServer.use(
      http.get("http://unmocked-test.invalid/explicit-fixture", () =>
        HttpResponse.json({ configured: true })
      )
    );
    const response = await axios.get(
      "http://unmocked-test.invalid/explicit-fixture"
    );
    expect(response.data).toEqual({ configured: true });
    expect(takeUnexpectedRequests()).toEqual([]);
  });
});
