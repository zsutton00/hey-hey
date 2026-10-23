/** @vitest-environment node */

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialManager } from "../CredentialManager";
import { clearCredentialStateOnLogout } from "../logout";
import { EncryptedFileCredentialStorage } from "../storage";
import { toAgentAccountId } from "../types";

describe("clearCredentialStateOnLogout", () => {
  const tempDirs: string[] = [];

  const createTempHome = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "ui-common-cred-logout-"));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears credentials and session files", async () => {
    const homeDir = createTempHome();
    const storage = new EncryptedFileCredentialStorage({
      heyHeyHomeDir: homeDir,
      passphrase: "logout-passphrase",
    });
    const manager = new CredentialManager({ storage });

    await manager.storeCredential("claude", {
      accountId: toAgentAccountId("logout-account"),
      accessToken: "token",
      refreshToken: null,
      idToken: null,
      tokenType: null,
      scopes: [],
      expiresAt: null,
    });

    const sessionsDir = join(homeDir, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session-1.session.json"), "{}", "utf8");

    await clearCredentialStateOnLogout({
      manager,
      heyHeyHomeDir: homeDir,
    });

    expect(await manager.listCredentials()).toEqual([]);
    expect(existsSync(sessionsDir)).toBe(false);
  });
});
