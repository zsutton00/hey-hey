import { describe, expect, it } from "vitest";
import { extractErrorMessage, getErrorMessage } from "./errorUtils";

describe("errorUtils", () => {
  it("prefers the server response message over Axios transport text", () => {
    const error = {
      message: "Request failed with status code 400",
      response: {
        data: {
          message: "Conversation owner has no active CLI websocket connection",
        },
      },
    };

    expect(extractErrorMessage(error)).toBe(
      "Conversation owner has no active CLI websocket connection"
    );
  });

  it("uses a direct error message when no server message is available", () => {
    expect(extractErrorMessage(new Error("Session creation failed"))).toBe(
      "Session creation failed"
    );
  });

  it("uses the supplied fallback when the error has no message", () => {
    expect(getErrorMessage({ response: { data: {} } }, "Fallback")).toBe(
      "Fallback"
    );
  });
});
