import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("agent operation architecture", () => {
  const productionFiles = (root: string): string[] =>
    readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : productionFiles(path);
      }
      return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")
        ? [path]
        : [];
    });

  it("routes Agent Session start and follow-up gestures through interaction access", () => {
    for (const file of [
      "src/components/AgentSession/AgentConversationView.tsx",
      "src/components/AgentSession/useLaunchRunOrchestration.ts",
    ]) {
      expect(readFileSync(file, "utf8")).toContain(
        "useAgentSessionInteractionAccess"
      );
    }

    const conversationView = readFileSync(
      "src/components/AgentSession/AgentConversationView.tsx",
      "utf8"
    );
    expect(conversationView).toContain(
      "onDirectTrigger ?? handleExternalPostMessage"
    );
    expect(conversationView).toContain("onDirectTrigger={handleDirectTrigger}");
    expect(conversationView).not.toContain("onPostMessage={handlePostMessage}");
  });

  it("does not expose raw coordinator or detached start mutations", () => {
    expect(
      existsSync(
        "src/components/AgentSession/operations/useAgentOperationCoordinator.ts"
      )
    ).toBe(false);
    expect(
      existsSync(
        "src/components/AgentSession/operations/useStartAgentSession.ts"
      )
    ).toBe(false);

    const productionSources = productionFiles(
      "src/components/AgentSession"
    ).concat(productionFiles("src/components/InteractionComponent"));
    const bypasses = productionSources.filter((file) => {
      if (file.includes("/operations/")) return false;
      const source = readFileSync(file, "utf8");
      return (
        source.includes("useAgentOperationCoordinator") ||
        /\bAgentOperationCoordinator\b(?!["'])/.test(source) ||
        source.includes("useStartAgentSession")
      );
    });
    expect(bypasses).toEqual([]);
  });

  it("uses platform current-state events as authoritative session observation", () => {
    expect(
      readFileSync("src/components/AgentSession/runtime/index.ts", "utf8")
    ).not.toContain('export * from "./api"');
    expect(existsSync("src/components/AgentSession/runtime/api.ts")).toBe(
      false
    );

    for (const file of [
      "src/data/websockets/handler.ts",
      "src/services/webSocketService.ts",
    ]) {
      expect(readFileSync(file, "utf8")).toContain(
        "AgentSessionCurrentStateChanged"
      );
    }
  });

  it("keeps interactive endpoint calls and operation identity in their designated owners", () => {
    const files = productionFiles("src/components/AgentSession").concat(
      productionFiles("src/data/hooks")
    );
    const directEndpointOwners = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("unifiedApiClient.startConversationRun") ||
        source.includes("unifiedApiClient.postMessage")
      );
    });
    expect(directEndpointOwners).toEqual([
      "src/components/AgentSession/operations/AgentOperationProvider.tsx",
    ]);

    const legacySources = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("useStartConversationRun") ||
        source.includes("useSubmitControllerAuthorizedMessage") ||
        source.includes("postPlatformWorkflowMessage") ||
        source.includes("ControllerAuthorizedUserMessage") ||
        source.includes("onPostMessage")
      );
    });
    expect(legacySources).toEqual([]);
    expect(existsSync("src/data/hooks/useStartConversationRun.ts")).toBe(false);
    expect(
      existsSync(
        "src/components/AgentSession/runtime/hooks/postPlatformWorkflowMessage.ts"
      )
    ).toBe(false);
    expect(
      existsSync("src/data/hooks/useSubmitControllerAuthorizedMessage.ts")
    ).toBe(false);
  });

  it("does not wrap coordinator operation creation in generic retry", () => {
    const conversationSubmission = readFileSync(
      "src/components/Conversation/hooks/useConversationSubmission.ts",
      "utf8"
    );
    expect(conversationSubmission).not.toMatch(
      /retryWithBackoff\([\s\S]{0,800}(startSession|submitMessage)/
    );
  });
});
