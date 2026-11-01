import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "modal-browser-fixture",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== "/browser-test") return next();
          response.setHeader("Content-Type", "text/html");
          response.end(
            '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/scripts/browser/model-selector.tsx"></script>',
          );
        });
      },
    },
  ],
});
await server.listen();
const profile = await mkdtemp(join(tmpdir(), "modal-browser-"));
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Chrome startup timed out")),
      10000,
    );
    chrome.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.on("error", reject);
  });
  const targets = await (
    await fetch(`http://${new URL(endpoint).host}/json/list`)
  ).json();
  socket = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    message.error
      ? task.reject(new Error(JSON.stringify(message.error)))
      : task.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(
      `Timed out: ${expression}; ${JSON.stringify(exceptions)}; ${await evaluate("document.body.innerText")}`,
    );
  };
  const click = async (selector) => {
    const point = await evaluate(
      `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing control'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", {
    url: `http://127.0.0.1:${server.httpServer.address().port}/browser-test`,
  });
  await waitFor(
    "!!document.querySelector('[data-testid=model-selector-root]')",
  );
  await delay(300);
  const root = "document.querySelector('[data-testid=model-selector-root]')";
  const initialSelection = await evaluate(
    "document.querySelector('[data-testid=selection]').textContent",
  );
  const assertFits = async () =>
    assert.equal(
      await evaluate(`${root}.scrollWidth <= ${root}.clientWidth`),
      true,
      "hidden probes must not widen the selector",
    );
  assert.equal(await evaluate(`${root}.dataset.presentation`), "full");
  assert.equal(await evaluate(`${root}.clientWidth`), 852);
  await assertFits();
  const positions = await evaluate(
    `["model-selector-provider-select", "model-selector-favorite-select", "model-selector-model-select", "model-selector-effort-select", "machine-picker-select"].map(id => { const r=document.querySelector('[data-testid="'+id+'"]').getBoundingClientRect(); return {top:r.top,right:r.right}; })`,
  );
  assert.ok(
    positions.every(
      (position) => Math.abs(position.top - positions[0].top) < 1,
    ),
    "all launch selectors share one row",
  );
  assert.ok(
    positions.every((position) => position.right <= positions.at(-1).right),
  );
  for (const [width, presentation] of [
    [500, "chips"],
    [180, "minimal"],
    [852, "full"],
  ]) {
    await evaluate(`${root}.style.width = "${width}px"`);
    await waitFor(`${root}.dataset.presentation === "${presentation}"`);
    await assertFits();
    assert.equal(
      await evaluate(
        "document.querySelector('[data-testid=selection]').textContent",
      ),
      initialSelection,
      "resizing preserves all controlled launch values",
    );
    if (presentation === "minimal") {
      await click('[data-testid="model-selector-minimal-edit"]');
      await waitFor(
        "!!document.querySelector('[data-testid=model-selector-controls]')",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('[data-testid=model-selector-model-input]').value",
        ),
        "Opus 5.5",
      );
      await click('[data-testid="model-selector-fast-mode-switch"] input');
      await waitFor(
        "document.querySelector('[data-testid=selection]').textContent.includes('\"fast\":true')",
      );
      await click('[data-testid="model-selector-fast-mode-switch"] input');
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e => e.textContent === 'Done').click()",
      );
      await waitFor(
        "!document.querySelector('[data-testid=model-selector-controls]')",
      );
    }
  }
  console.log(
    "PASS: 852px inline row, 500px chips, 180px accessible Edit, resize restoration, controlled Fast mode and no measurement overflow",
  );
  assert.deepEqual(exceptions, []);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  socket?.close();
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await exited;
  await server.close();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 100,
  });
}
