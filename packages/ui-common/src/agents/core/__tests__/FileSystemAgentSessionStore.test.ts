/** @vitest-environment node */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemAgentSessionStore } from "../FileSystemAgentSessionStore";
import { toAgentSessionId } from "../types";

describe("FileSystemAgentSessionStore", () => {
  const tempDirs: string[] = [];

  const createBaseDir = (): string => {
    const baseDir = mkdtempSync(join(tmpdir(), "ui-common-session-store-"));
    tempDirs.push(baseDir);
    return baseDir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists and retrieves session metadata on disk", async () => {
    const store = new FileSystemAgentSessionStore({
      baseDir: createBaseDir(),
    });

    const sessionId = toAgentSessionId("session-1");
    await store.persist(sessionId, {
      adapter: "codex",
      createdAt: 1,
      credentialLifecycle: {
        agentType: "codex",
        accountId: "acct",
        scopes: ["scope:a"],
        expiresAt: null,
        lastRetrievedAt: 1,
        lastRefreshedAt: null,
      },
    });

    const metadata = await store.retrieve(sessionId);
    expect(metadata).toEqual(
      expect.objectContaining({
        adapter: "codex",
        credentialLifecycle: expect.objectContaining({
          accountId: "acct",
        }),
      })
    );

    expect(await store.listSessionIds()).toContain(sessionId);

    await store.clear();
    expect(await store.retrieve(sessionId)).toBeNull();
  });
});
