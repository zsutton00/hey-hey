/** @vitest-environment node */

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockTimeoutError, SessionNotFoundError } from "../errors";
import { createPersistentSessionManager } from "../manager";
import type { SessionModel, SessionPaths } from "../types";

interface TestSession {
  state_version: number;
  cliSessionId: string;
  workspaceRoot: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  navigationState: {
    route: string;
  };
  agenticAgentSessions: Array<{
    updatedAt: string;
    events: Array<{ ts: string }>;
  }>;
}

const tempDir = path.join(process.cwd(), "tmp-persistent-session-manager-test");

const makeClock = (startMs = Date.UTC(2026, 1, 12, 0, 0, 0)) => {
  let tick = 0;
  return () => {
    const date = new Date(startMs + tick * 1000);
    tick += 1;
    return date;
  };
};

const makeIdGen = () => {
  let i = 1;
  return () => {
    const value = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    i += 1;
    return value;
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid field: ${fieldName}`);
  }
  return value;
};

const normalizeIso = (value: string, fieldName: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid iso: ${fieldName}`);
  }
  return date.toISOString();
};

const validateSession = (value: unknown): TestSession => {
  if (!isObject(value)) {
    throw new Error("Invalid session payload");
  }

  const stateVersion = value["state_version"];
  if (
    typeof stateVersion !== "number" ||
    !Number.isInteger(stateVersion) ||
    stateVersion <= 0
  ) {
    throw new Error("Invalid session state_version");
  }

  const navigationStateRaw = value["navigationState"];
  if (!isObject(navigationStateRaw)) {
    throw new Error("Invalid navigationState");
  }

  const sessionsRaw = value["agenticAgentSessions"];
  if (!Array.isArray(sessionsRaw)) {
    throw new Error("Invalid agenticAgentSessions");
  }

  const agenticAgentSessions = sessionsRaw.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`Invalid agentic session at ${String(index)}`);
    }
    const eventsRaw = entry["events"];
    if (!Array.isArray(eventsRaw)) {
      throw new Error(`Invalid events at ${String(index)}`);
    }

    return {
      updatedAt: normalizeIso(
        readString(
          entry["updatedAt"],
          `agenticAgentSessions[${String(index)}].updatedAt`
        ),
        `agenticAgentSessions[${String(index)}].updatedAt`
      ),
      events: eventsRaw.map((event, eventIndex) => {
        if (!isObject(event)) {
          throw new Error("Invalid event");
        }
        return {
          ts: normalizeIso(
            readString(event["ts"], `events[${String(eventIndex)}].ts`),
            `events[${String(eventIndex)}].ts`
          ),
        };
      }),
    };
  });

  const result: TestSession = {
    state_version: stateVersion,
    cliSessionId: readString(value["cliSessionId"], "cliSessionId"),
    workspaceRoot: readString(value["workspaceRoot"], "workspaceRoot"),
    createdAt: normalizeIso(
      readString(value["createdAt"], "createdAt"),
      "createdAt"
    ),
    updatedAt: normalizeIso(
      readString(value["updatedAt"], "updatedAt"),
      "updatedAt"
    ),
    navigationState: {
      route: readString(navigationStateRaw["route"], "navigationState.route"),
    },
    agenticAgentSessions,
  };

  if (value["closedAt"] !== undefined) {
    result.closedAt = normalizeIso(
      readString(value["closedAt"], "closedAt"),
      "closedAt"
    );
  }

  return result;
};

const createPaths = (baseDir: string): SessionPaths => ({
  baseDir,
  sessionsDir: path.join(baseDir, "sessions"),
  indexPath: path.join(baseDir, "sessions", "index.json"),
  lockPath: path.join(baseDir, "session.lock"),
});

const createModel = (): SessionModel<TestSession> => ({
  stateVersion: 1,
  createInitialSession: ({
    sessionId,
    timestamp,
    workspaceRoot,
    stateVersion,
  }) => ({
    state_version: stateVersion,
    cliSessionId: sessionId,
    workspaceRoot,
    createdAt: timestamp,
    updatedAt: timestamp,
    navigationState: {
      route: "projects",
    },
    agenticAgentSessions: [],
  }),
  validateSession,
  getSessionId: (session) => session.cliSessionId,
  getCreatedAt: (session) => session.createdAt,
  getUpdatedAt: (session) => session.updatedAt,
  getClosedAt: (session) => session.closedAt,
  setUpdatedAt: (session, value) => {
    session.updatedAt = value;
  },
  setClosedAt: (session, value) => {
    session.closedAt = value;
  },
  clearClosedAt: (session) => {
    delete session.closedAt;
  },
});

describe("createPersistentSessionManager", () => {
  beforeEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates and reuses the active session", async () => {
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths: createPaths(tempDir),
      now: makeClock(),
      randomId: makeIdGen(),
    });

    const first = await manager.initialize();
    expect(first.authValid).toBe(true);
    expect(first.recoveredFromCorruption).toBe(false);

    await manager.updateActiveSession((session) => {
      session.navigationState.route = "plans";
    });

    const second = await manager.initialize();
    expect(second.session.cliSessionId).toBe(first.session.cliSessionId);
    expect(second.session.navigationState.route).toBe("plans");

    const sessionPath = path.join(
      tempDir,
      "sessions",
      `${first.session.cliSessionId}.json`
    );
    await expect(fs.stat(sessionPath)).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(tempDir, "sessions", "index.json"))
    ).resolves.toBeTruthy();
  });

  it("supports create/list/load/setActive", async () => {
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths: createPaths(tempDir),
      now: makeClock(),
      randomId: makeIdGen(),
    });

    const first = await manager.initialize();
    const second = await manager.createSession();

    const sessions = await manager.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(
      sessions.find((entry) => entry.sessionId === second.cliSessionId)
        ?.isActive
    ).toBe(true);

    const loadedFirst = await manager.loadSession(first.session.cliSessionId);
    expect(loadedFirst.cliSessionId).toBe(first.session.cliSessionId);

    await manager.setActiveSession(first.session.cliSessionId);
    const active = await manager.getActiveSession();
    expect(active.cliSessionId).toBe(first.session.cliSessionId);
  });

  it("throws when activating unknown session", async () => {
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths: createPaths(tempDir),
      now: makeClock(),
      randomId: makeIdGen(),
    });
    await manager.initialize();

    await expect(
      manager.setActiveSession("00000000-0000-4000-8000-000000009999")
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it("supports concurrent active-session updates", async () => {
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths: createPaths(tempDir),
      now: makeClock(),
      randomId: makeIdGen(),
    });
    await manager.initialize();

    await Promise.all(
      Array.from({ length: 6 }).map((_, index) =>
        manager.updateActiveSession((session) => {
          session.agenticAgentSessions.push({
            updatedAt: new Date(Date.now() + index).toISOString(),
            events: [],
          });
        })
      )
    );

    const active = await manager.getActiveSession();
    expect(active.agenticAgentSessions).toHaveLength(6);
  });

  it("reports invalid auth during initialize", async () => {
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths: createPaths(tempDir),
      now: makeClock(),
      randomId: makeIdGen(),
      authValidator: async () => false,
    });

    const result = await manager.initialize();
    expect(result.authValid).toBe(false);
  });

  it("recovers from corrupted index and writes backup", async () => {
    const paths = createPaths(tempDir);
    await fs.mkdir(path.dirname(paths.indexPath), { recursive: true });
    await fs.writeFile(paths.indexPath, "{broken", "utf8");

    const manager = createPersistentSessionManager({
      model: createModel(),
      paths,
      now: makeClock(),
      randomId: makeIdGen(),
    });

    const result = await manager.initialize();
    expect(result.recoveredFromCorruption).toBe(true);

    const files = await fs.readdir(paths.sessionsDir);
    expect(files.some((name) => name.startsWith("index.json.corrupt."))).toBe(
      true
    );
  });

  it("recovers from corrupted active session and reports recoveredFromCorruption", async () => {
    const paths = createPaths(tempDir);
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths,
      now: makeClock(),
      randomId: makeIdGen(),
    });

    const first = await manager.initialize();
    const sessionPath = path.join(
      paths.sessionsDir,
      `${first.session.cliSessionId}.json`
    );
    await fs.writeFile(sessionPath, "{broken", "utf8");

    const second = await manager.initialize();
    expect(second.recoveredFromCorruption).toBe(true);
    expect(second.session.cliSessionId).not.toBe(first.session.cliSessionId);

    const files = await fs.readdir(paths.sessionsDir);
    expect(
      files.some((name) =>
        name.startsWith(`${first.session.cliSessionId}.json.corrupt.`)
      )
    ).toBe(true);
  });

  it("times out when lock cannot be acquired", async () => {
    const paths = createPaths(tempDir);
    await fs.writeFile(
      paths.lockPath,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      "utf8"
    );

    const manager = createPersistentSessionManager({
      model: createModel(),
      paths,
      now: makeClock(),
      randomId: makeIdGen(),
      timeoutMs: 120,
      retryDelayMs: 20,
      staleLockMs: 60_000,
    });

    await expect(manager.initialize()).rejects.toBeInstanceOf(LockTimeoutError);
  });

  it("fails fast on session read IO failure instead of rotating sessions", async () => {
    const paths = createPaths(tempDir);
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths,
      now: makeClock(),
      randomId: makeIdGen(),
    });

    const first = await manager.initialize();
    const sessionPath = path.join(
      paths.sessionsDir,
      `${first.session.cliSessionId}.json`
    );
    await fs.rm(sessionPath, { force: true });
    await fs.mkdir(sessionPath, { recursive: true });

    await expect(manager.initialize()).rejects.toThrow(
      /Failed reading session file/
    );
  });

  it("fails fast on index read IO failure during create/load/update flows", async () => {
    const paths = createPaths(tempDir);
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths,
      now: makeClock(),
      randomId: makeIdGen(),
    });

    await manager.initialize();
    await fs.rm(paths.indexPath, { force: true });
    await fs.mkdir(paths.indexPath, { recursive: true });

    await expect(manager.createSession()).rejects.toThrow(
      /Failed reading session index file/
    );
    await expect(manager.load()).rejects.toThrow(
      /Failed reading session index file/
    );
    await expect(
      manager.updateActiveSession((session) => {
        session.navigationState.route = "plans";
      })
    ).rejects.toThrow(/Failed reading session index file/);
  });

  it("emits lifecycle hooks", async () => {
    const manager = createPersistentSessionManager({
      model: createModel(),
      paths: createPaths(tempDir),
      now: makeClock(),
      randomId: makeIdGen(),
    });

    const events: string[] = [];
    const stopStart = manager.onSessionStart(() => {
      events.push("start");
    });
    const stopUpdate = manager.onSessionStateChange(() => {
      events.push("update");
    });
    const stopEnd = manager.onSessionEnd(() => {
      events.push("end");
    });

    const created = await manager.createSession();
    await manager.setActiveSession(created.cliSessionId);
    await manager.updateActiveSession((session) => {
      session.navigationState.route = "plans";
    });
    await manager.closeSession();

    stopStart();
    stopUpdate();
    stopEnd();

    expect(events).toEqual(["start", "start", "update", "end"]);
  });
});
