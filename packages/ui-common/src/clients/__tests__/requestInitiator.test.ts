import { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserApiRuntime } from "../createApiRuntime";
import { REQUEST_INITIATOR_TRACKING_STORAGE_KEY } from "../../data/core/initiatorContext";
import { initiatorRequestOptions } from "../../data/core/requestInitiator";
import { createUnifiedApiClient } from "../serviceClients";
import * as initiatorContext from "../../data/core/initiatorContext";

function runtimeWithRequests() {
  const runtime = createBrowserApiRuntime({ baseUrl: "https://example.test" });
  const requests: InternalAxiosRequestConfig[] = [];
  runtime.transport.axios.defaults.adapter = async (config) => {
    requests.push(config);
    return {
      data: {},
      status: 200,
      statusText: "OK",
      headers: new AxiosHeaders(),
      config,
    };
  };
  return { runtime, requests };
}
const params = {
  organizationId: "org",
  projectId: "project",
  conversationId: "conversation",
};
const trace = (name: string) =>
  `Error\n at ${name} (http://localhost/src/components/${name}.tsx:270:7)`;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("request-local initiator options through generated clients", () => {
  it("captures and maps a compiled caller on a direct client call after enabling the flag", async () => {
    const { runtime, requests } = runtimeWithRequests();
    window.localStorage.setItem(REQUEST_INITIATOR_TRACKING_STORAGE_KEY, "true");
    vi.spyOn(initiatorContext, "captureInitiator").mockReturnValue(
      `Error\n at minified (${window.location.origin}/assets/direct.js:1:20)`
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            version: 3,
            sources: ["../src/components/DirectView.tsx"],
            names: [],
            mappings: "AAAA",
          })
        )
      )
    );
    await runtime.clients.conversations.getMessages(params);
    expect(requests[0].params._from).toBe("src/components/DirectView.tsx:1:1");
  });

  it("honors flag changes after client creation and preserves existing parameters", async () => {
    const { runtime, requests } = runtimeWithRequests();
    const options = {
      ...initiatorRequestOptions(trace("View")),
      params: { existing: "yes" },
    };
    await runtime.clients.conversations.getMessages(params, options);
    window.localStorage.setItem(REQUEST_INITIATOR_TRACKING_STORAGE_KEY, "true");
    await runtime.clients.conversations.getMessages(params, options);
    window.localStorage.removeItem(REQUEST_INITIATOR_TRACKING_STORAGE_KEY);
    await runtime.clients.conversations.getMessages(params, options);
    expect(requests.map((request) => request.params)).toEqual([
      { existing: "yes" },
      { existing: "yes", _from: "src/components/View.tsx:270:7" },
      { existing: "yes" },
    ]);
    expect(options.params).toEqual({ existing: "yes" });
    expect(requests[1].headers.has("requestInitiator")).toBe(false);
  });

  it("keeps concurrent callers separate across awaits and follow-up reads", async () => {
    const { runtime, requests } = runtimeWithRequests();
    window.localStorage.setItem(REQUEST_INITIATOR_TRACKING_STORAGE_KEY, "true");
    const read = async (name: string) => {
      const options = initiatorRequestOptions(trace(name));
      await Promise.resolve();
      await runtime.clients.conversations.getMessages(params, options);
      await runtime.clients.conversations.getMessages(params, options);
    };
    await Promise.all([read("First"), read("Second")]);
    expect(requests.map((request) => request.params._from)).toEqual([
      "src/components/First.tsx:270:7",
      "src/components/Second.tsx:270:7",
      "src/components/First.tsx:270:7",
      "src/components/Second.tsx:270:7",
    ]);
  });

  it("forwards options through the custom task facade methods", async () => {
    const { runtime, requests } = runtimeWithRequests();
    window.localStorage.setItem(REQUEST_INITIATOR_TRACKING_STORAGE_KEY, "true");
    const client = createUnifiedApiClient(runtime);
    const options = initiatorRequestOptions(trace("TaskView"));
    await client.getTask(
      { organizationId: "org", projectId: "project", taskId: "task" },
      options
    );
    await client.getTasks(
      { organizationId: "org", projectId: "project" },
      options
    );
    await client.getWorkItemGraph(
      { organizationId: "org", projectId: "project", workItemId: "task" },
      options
    );
    expect(requests.map((request) => request.params._from)).toEqual(
      Array(3).fill("src/components/TaskView.tsx:270:7")
    );
  });
});
