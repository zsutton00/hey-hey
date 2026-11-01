import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImplementationHintDto } from "../../../api";
import { implementationHintsQueryOptions } from "../implementationHints";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../../clients", () => ({ dataClient: { request } }));
vi.mock("../../../clients/serviceClients", () => ({ unifiedApiClient: {} }));

const hint = (serviceId: string, index: number): ImplementationHintDto => ({
  id: `hint-${serviceId}-${index}`,
  serviceId,
  agentSessionId: "session",
  featureName: "Legacy guidance",
  description: "Summary",
  sourceType: "USER",
  hint: "Complete content",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("implementation hints collection", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("loads beyond 25 hints with the same scope and cancellation signal", async () => {
    const first = Array.from({ length: 25 }, (_, i) => hint("service-a", i));
    request
      .mockResolvedValueOnce({ data: { data: first } })
      .mockResolvedValueOnce({ data: { data: [hint("service-a", 25)] } });
    const client = new QueryClient();
    const result = await client.fetchQuery(
      implementationHintsQueryOptions("org", { serviceId: "service-a" }),
    );
    expect(result).toHaveLength(26);
    expect(request.mock.calls.map(([options]) => options.params)).toEqual([
      { serviceId: "service-a", agentSessionId: undefined, page: 1, size: 25 },
      { serviceId: "service-a", agentSessionId: undefined, page: 2, size: 25 },
    ]);
    expect(request.mock.calls[0][0].signal).toBe(
      request.mock.calls[1][0].signal,
    );
    client.clear();
  });

  it("rejects later-page errors instead of caching a partial list", async () => {
    request
      .mockResolvedValueOnce({
        data: {
          data: Array.from({ length: 25 }, (_, i) => hint("service-a", i)),
        },
      })
      .mockRejectedValueOnce(new Error("Read failed"));
    const client = new QueryClient();
    const options = {
      ...implementationHintsQueryOptions("org", { serviceId: "service-a" }),
      retry: false,
    };
    await expect(client.fetchQuery(options)).rejects.toThrow("Read failed");
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    client.clear();
  });

  it("separates Service and organization results while retaining session filters", async () => {
    request.mockImplementation(async ({ params }) => ({
      data: { data: [hint(params.serviceId, 1)] },
    }));
    const client = new QueryClient();
    for (const [org, serviceId] of [
      ["org", "a"],
      ["org", "b"],
      ["other-org", "a"],
    ]) {
      const result = await client.fetchQuery(
        implementationHintsQueryOptions(org, {
          serviceId,
          agentSessionId: "session",
        }),
      );
      expect(result[0].serviceId).toBe(serviceId);
    }
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].params.agentSessionId).toBe("session");
    client.clear();
  });
});
