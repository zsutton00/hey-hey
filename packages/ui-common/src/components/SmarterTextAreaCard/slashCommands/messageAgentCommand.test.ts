import { describe, expect, it } from "vitest";
import { resolveMessageAgentCommand } from "./messageAgentCommand";

const target = "@[agent_session:11111111-1111-4111-8111-111111111111|Target]";

describe("resolveMessageAgentCommand", () => {
  it("selects one canonical target at the first token", () => {
    const commandText = ` \n/message-agent ${target} Investigate the failing job`;
    expect(resolveMessageAgentCommand(commandText)).toEqual({
      kind: "executable",
      intent: {
        kind: "message-agent",
        targetSessionId: "11111111-1111-4111-8111-111111111111",
        commandText,
      },
    });
  });

  it("leaves mid-message command text literal", () => {
    expect(resolveMessageAgentCommand(`Please run /message-agent ${target} hello`)).toEqual({ kind: "literal" });
  });

  it("rejects absent, malformed and multiple targets", () => {
    expect(resolveMessageAgentCommand("/message-agent hello").kind).toBe("incomplete");
    expect(resolveMessageAgentCommand("/message-agent @[task:11111111-1111-4111-8111-111111111111|Target] hello").kind).toBe("incomplete");
    expect(resolveMessageAgentCommand(`/message-agent ${target} ask ${target}`).kind).toBe("incomplete");
  });
});
