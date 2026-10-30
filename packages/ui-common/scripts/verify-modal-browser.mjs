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
            '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/scripts/browser/modal-shell.tsx"></script>',
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
      exceptions.push(message.params.exceptionDetails.text);
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
    throw new Error(`Timed out: ${expression}`);
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
  await send("Browser.grantPermissions", {
    origin: `http://127.0.0.1:${server.httpServer.address().port}`,
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  });
  for (const width of [375, 1280])
    for (const side of ["bottom-left", "bottom-right"]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width === 375,
      });
      await send("Page.navigate", {
        url: `http://127.0.0.1:${server.httpServer.address().port}/browser-test`,
      });
      await waitFor("!!document.querySelector('[data-testid=browser-draft]')");
      await evaluate(
        `localStorage.setItem('capsule-anchor', ${JSON.stringify(side)})`,
      );
      await send("Page.reload");
      await waitFor("!!document.querySelector('[data-testid=browser-draft]')");
      await click('[data-testid="browser-draft"]');
      await click('[data-testid="modal-minimize"]');
      await waitFor(
        "getComputedStyle(document.body).overflow !== 'hidden' && !!document.querySelector('[data-testid=modal-restore]')",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('[data-testid=browser-draft]').value",
        ),
        "Preserved browser draft",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('[data-testid=browser-draft]')).visibility === 'visible'",
        ),
        false,
      );
      await click('[data-testid="page-click"]');
      assert.match(
        await evaluate(
          "document.querySelector('[data-testid=page-click]').textContent",
        ),
        /1/,
      );
      // Real pointer selection produces copyable page text while the dialog is inert.
      await evaluate(
        "{const r=document.createRange();r.selectNodeContents(document.querySelector('[data-testid=copy-source]'));getSelection().removeAllRanges();getSelection().addRange(r)}",
      );
      assert.match(
        await evaluate("getSelection().toString()"),
        /Copy this page text/,
      );
      assert.equal(await evaluate("document.execCommand('copy')"), true);
      assert.match(
        await evaluate("navigator.clipboard.readText()"),
        /Copy this page text/,
      );
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 120,
        y: 450,
        deltaY: 350,
        deltaX: 0,
      });
      await waitFor("scrollY > 0");
      await click('[data-testid="expand-capsule"]');
      await delay(150);
      assert.equal(
        await evaluate(
          "(() => { const c=document.querySelector('[data-testid=fixture-capsule]').getBoundingClientRect();const r=document.querySelector('[data-testid=modal-restore]').getBoundingClientRect(); return r.bottom <= c.top && r.top>=0 && r.left>=0 && r.right<=innerWidth; })()",
        ),
        true,
      );
      assert.equal(
        await evaluate("document.documentElement.scrollWidth <= innerWidth"),
        true,
      );
      await click('[data-testid="modal-restore"]');
      await waitFor(
        "getComputedStyle(document.querySelector('[data-testid=browser-draft]')).visibility === 'visible'",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('[data-testid=browser-draft]').value",
        ),
        "Preserved browser draft",
      );
      await waitFor(
        "document.activeElement === document.querySelector('[data-testid=browser-draft]')",
      );
      assert.equal(
        await evaluate(
          "Array.from(document.querySelectorAll('[data-testid=modal-primary-actions] button')).every(b=>b.scrollWidth<=b.clientWidth)",
        ),
        true,
      );
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Review changes').click()",
      );
      await waitFor(
        "Array.from(document.querySelectorAll('[role=dialog]')).some(e=>e.textContent.includes('Pending review') && getComputedStyle(e).visibility === 'visible')",
      );
      await click(
        '.MuiDialog-root:not([aria-hidden="true"]) [data-testid="modal-minimize"]',
      );
      await waitFor("getComputedStyle(document.body).overflow !== 'hidden'");
      await click('[data-testid="modal-restore"]');
      await waitFor(
        "Array.from(document.querySelectorAll('[role=dialog]')).some(e=>e.textContent.includes('Pending review') && getComputedStyle(e).visibility === 'visible')",
      );
      console.log(
        `PASS ${width}px ${side}: draft, focus, page click/scroll/selection, expanded anchor, nested review, labels and overflow`,
      );
    }
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
