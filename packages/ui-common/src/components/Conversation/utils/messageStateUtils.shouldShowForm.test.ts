import { describe, expect, it } from "vitest";
import { MessageType, type MessageResponseDto } from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import { shouldShowForm } from "./messageStateUtils";

/**
 * Regression: an interstitial narration row is a completed SYSTEM message that
 * never receives a USER reply. The default completed-branch gate in
 * shouldShowForm requires a USER response, so without the field-level
 * `shouldShowForm: () => true` override the row is dropped and the body never
 * renders. This mirrors the real message shape that exposed the bug.
 */
describe("shouldShowForm — interstitial narration", () => {
  const interstitialMessage: ConversationMessage = {
    state: "completed",
    canEdit: false,
    message: {
      id: "17cc72d7-dbdc-453b-8730-f207c8cb7126",
      type: MessageType.System,
      status: "completed",
      awaitingResponse: false,
      data: {
        type: "AGENT",
        response: "Looking at the project structure now.",
        uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
      },
      responses: [
        {
          id: "f63a5a48-2a31-4729-9e2c-6e08f29f9955",
          type: MessageType.System,
          status: "completed",
          awaitingResponse: true,
          data: { type: "AGENT", response: "done poking around." },
        } as MessageResponseDto,
      ],
    } as unknown as MessageResponseDto,
  };

  it("renders a completed interstitial row even with no user reply", () => {
    expect(shouldShowForm(interstitialMessage)).toBe(true);
  });
});
