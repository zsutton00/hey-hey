// Runs the production tool-call list with native scroll anchoring in local Chrome.
// No remote app, credentials, test aliases, or mocked renderer/runtime wiring.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), "tool-scroll-browser-"));
const chrome = spawn(
  process.env.CHROME_BIN ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`Chrome startup timed out: ${output}`)),
      10000,
    );
    chrome.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolveEndpoint(match[1]);
      }
    });
    chrome.on("error", reject);
    chrome.on("exit", (code) =>
      reject(new Error(`Chrome exited ${code}: ${output}`)),
    );
  });
  const targets = await (
    await fetch(`http://${new URL(endpoint).host}/json/list`)
  ).json();
  socket = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolveOpen) =>
    socket.addEventListener("open", resolveOpen, { once: true }),
  );
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolveResult, reject) => {
      const id = ++nextId;
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out`)),
        30000,
      );
      pending.set(id, { resolve: resolveResult, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await send("Page.enable");
  await send("Page.navigate", {
    url: `${origin}/scripts/browser/tool-call-scroll.html`,
  });
  const deadline = Date.now() + 30000;
  while (!(await evaluate('!!document.querySelector("#verify")'))) {
    assert.ok(Date.now() < deadline, "Fixture did not load");
    await delay(100);
  }
  await evaluate('document.querySelector("#verify").click()');
  while (
    (await evaluate('document.querySelector("#results").dataset.status')) ===
    "running"
  ) {
    assert.ok(Date.now() < deadline, "Fixture timed out");
    await delay(100);
  }
  const status = await evaluate(
    'document.querySelector("#results").dataset.status',
  );
  const results = await evaluate(
    'document.querySelector("#results").textContent',
  );
  assert.equal(status, "passed", results);
  console.log(`PASS: native tool-call arrival anchoring\n${results}`);
} finally {
  socket?.close();
  chrome.kill();
  await new Promise((resolveExit) =>
    chrome.exitCode !== null || chrome.signalCode !== null
      ? resolveExit()
      : chrome.once("exit", resolveExit),
  );
  await server.close();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
