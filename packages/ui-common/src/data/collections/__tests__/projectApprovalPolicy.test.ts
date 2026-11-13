import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { entityContextKeys } from "../entityContext";
import { messageKeys } from "../messages";
import { changeProjectApprovalPolicy } from "../projectApprovalPolicy";
import { proposalKeys } from "../proposals";

const platform = vi.hoisted(() => ({
  replaceProjectApprovalPolicy: vi.fn(),
  restoreProjectApprovalPolicyDefaults: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: platform,
}));

const snapshot = { rules: [] };
const names = ["message", "context", "proposal"] as const;

const keysFor = (org: string, project: string) => ({
  message: messageKeys.list(org, project, "c1"),
  context: entityContextKeys.entity(org, project, "TASK", "t1"),
  proposal: proposalKeys.detail(org, project, "p1"),
});

describe("changeProjectApprovalPolicy review refresh", () => {
  let client: QueryClient;
  let unsubscribers: Array<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    unsubscribers = [];
    platform.replaceProjectApprovalPolicy.mockResolvedValue({
      data: { data: snapshot },
    });
    platform.restoreProjectApprovalPolicyDefaults.mockResolvedValue({
      data: { data: snapshot },
    });
  });

  // Mounted review projections holding data that was fresh before the save.
  async function mountProject(project: string) {
    const keys = keysFor("o", project);
    const reads = {
      message: vi.fn().mockResolvedValue("before"),
      context: vi.fn().mockResolvedValue("before"),
      proposal: vi.fn().mockResolvedValue("before"),
    };
    for (const name of names) {
      const observer = new QueryObserver(client, {
        queryKey: keys[name],
        queryFn: reads[name],
        staleTime: 300_000,
      });
      unsubscribers.push(observer.subscribe(() => {}));
    }
    await vi.waitFor(() => {
      for (const name of names) {
        expect(client.getQueryData(keys[name])).toBe("before");
      }
    });
    return { keys, reads };
  }

  it.each([
    [
      "saving rules",
      () =>
        changeProjectApprovalPolicy(client, "o", "A", { rules: [] } as never),
    ],
    [
      "restoring defaults",
      () =>
        changeProjectApprovalPolicy(client, "o", "A", {
          expectedRevision: 1,
        } as never),
    ],
  ])("%s refreshes the affected project only", async (_label, change) => {
    const a = await mountProject("A");
    const b = await mountProject("B");
    for (const name of names) {
      a.reads[name].mockResolvedValue("after");
    }

    await change();

    await vi.waitFor(() => {
      for (const name of names) {
        expect(client.getQueryData(a.keys[name])).toBe("after");
      }
    });
    for (const name of names) {
      expect(b.reads[name]).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(b.keys[name])).toBe("before");
    }
  });

  it("keeps a pre-save response from satisfying the refresh", async () => {
    const keys = keysFor("o", "A");
    let resolveOld!: (value: string) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => (resolveOld = resolve)),
      )
      .mockResolvedValue("post-save");
    const observer = new QueryObserver(client, {
      queryKey: keys.message,
      queryFn: read,
    });
    unsubscribers.push(observer.subscribe(() => {}));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    await changeProjectApprovalPolicy(client, "o", "A", { rules: [] } as never);
    resolveOld("pre-save");

    await vi.waitFor(() =>
      expect(client.getQueryData(keys.message)).toBe("post-save"),
    );
  });

  it("leaves cached review state alone when the save fails", async () => {
    const a = await mountProject("A");
    platform.replaceProjectApprovalPolicy.mockRejectedValue(
      new Error("rejected"),
    );

    await expect(
      changeProjectApprovalPolicy(client, "o", "A", { rules: [] } as never),
    ).rejects.toThrow("rejected");

    expect(client.isFetching()).toBe(0);
    for (const name of names) {
      expect(a.reads[name]).toHaveBeenCalledTimes(1);
    }
  });
});
