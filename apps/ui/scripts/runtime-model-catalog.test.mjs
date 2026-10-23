import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";

const uiRoot = fileURLToPath(new URL("../", import.meta.url));

test("ordinary Vite returns 404 for the loader's missing JSON request", async (t) => {
  const vite = await createServer({
    root: uiRoot,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  await vite.listen();
  const response = await fetch(
    `http://127.0.0.1:${vite.httpServer.address().port}/config/model-catalog.json`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  assert.equal(response.status, 404);
});

async function startServer(distDir, t) {
  const child = spawn(process.execPath, [path.join(uiRoot, "docker/server.mjs")], {
    env: { ...process.env, DIST_DIR: distDir, HOST: "127.0.0.1", PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    const event = JSON.parse(line);
    if (event.event === "server_started") {
      lines.close();
      return `http://127.0.0.1:${event.port}`;
    }
  }
  throw new Error("Static server exited before listening.");
}


test("production plugins emit no catalog and image server preserves config 404", { timeout: 30000 }, async (t) => {
  const fixture = await realpath(await mkdtemp(path.join(tmpdir(), "ui-catalog-")));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await writeFile(path.join(fixture, "index.html"), "<!doctype html><title>Test app</title>");
  const distDir = path.join(fixture, "dist");
  await build({
    configFile: path.join(uiRoot, "vite.config.ts"),
    root: fixture,
    publicDir: path.join(uiRoot, "public"),
    logLevel: "silent",
    build: { outDir: distDir },
  });
  const files = await readdir(distDir, { recursive: true });
  assert.ok(!files.some((file) => /model-catalog\.json(?:\.(?:gz|br))?$/.test(file)));
  const origin = await startServer(distDir, t);
  const missing = await fetch(`${origin}/config/model-catalog.json`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Not Found" });
  const route = await fetch(`${origin}/projects/example`);
  assert.equal(route.status, 200);
  assert.match(route.headers.get("content-type"), /text\/html/);
});
