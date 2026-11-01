// Runs the production Diagram surface, its real shared element card and the real
// sandboxed screen iframe in local Chrome. No mocked renderer or runtime wiring;
// only the work-item caches are seeded so no backend is needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

let forbiddenRequests = 0;
const serveFixture = (request, response, next) => {
  if (request.url?.startsWith("/forbidden")) {
    forbiddenRequests++;
    response.end("Forbidden resource reached");
  } else if (request.url === "/browser-test") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/browser/diagram-element-screen.tsx"></script></body>',
    );
  } else next();
};
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      name: "local-browser-fixture",
      configureServer(devServer) {
        devServer.middlewares.use(serveFixture);
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const profile = await mkdtemp(resolve(".diagram-screen-browser-"));
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
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  const endpoint = await new Promise((done, reject) => {
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
        done(match[1]);
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
  await new Promise((open) =>
    socket.addEventListener("open", open, { once: true }),
  );
  let nextId = 0;
  const pending = new Map();
  const failures = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      failures.push(message.params.exceptionDetails);
    if (message.id) {
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(message.id);
        message.error
          ? entry.reject(new Error(JSON.stringify(message.error)))
          : entry.resolve(message.result);
      }
    }
  });
  const send = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 60000);
      pending.set(id, { resolve: done, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error(
      `Condition timed out: ${expression}; errors: ${JSON.stringify(failures)}; page: ${await evaluate("document.body.innerText")}`,
    );
  };

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 900,
    height: 600,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await send("Runtime.enable");
  await send("Page.navigate", { url: `${origin}/browser-test` });
  await waitFor(
    '!!document.querySelector(\'[data-testid="diagram-element-screen"][data-screen-state="ready"]\')',
  );
  await delay(500);
  await evaluate(
    "window.authoredScriptRan = false; window.addEventListener('message', e => { if (e.data === 'authored-script-ran') window.authoredScriptRan = true; })",
  );

  const geometry = await evaluate(`(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const frame = [...document.querySelectorAll('[data-testid="workflow-inline-step-frame"]')]
      .find((f) => f.textContent.includes('Cart'));
    const plainFrame = [...document.querySelectorAll('[data-testid="workflow-inline-step-frame"]')]
      .find((f) => f.textContent.includes('Shopper'));
    const thumb = frame.querySelector('[data-testid="html-css-section-thumbnail"]');
    const iframe = frame.querySelector('iframe');
    const role = frame.querySelector('[data-testid="diagram-element-role-icon"]');
    const strip = frame.querySelector('[data-testid="diagram-element-link-strip"]');
    const button = strip.querySelector('button');
    const name = frame.querySelector('[data-testid="workflow-inline-step-title"]');
    const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const at = (point) => document.elementFromPoint(point.x, point.y);
    const describe = (el) => el && (el.getAttribute('data-testid') || el.tagName);
    const thumbRect = rect(thumb);
    return {
      frame: rect(frame), thumb: thumbRect, name: rect(name), role: rect(role), strip: rect(strip),
      iframe: { sandbox: iframe.getAttribute('sandbox'), referrer: iframe.referrerPolicy, pointerEvents: getComputedStyle(iframe).pointerEvents, tabIndex: iframe.tabIndex, ariaHidden: iframe.getAttribute('aria-hidden'),
        transformOrigin: getComputedStyle(iframe).transformOrigin, width: getComputedStyle(iframe).width, height: getComputedStyle(iframe).height },
      hitRole: describe(at(centre(rect(role)))), hitButton: describe(at(centre(rect(button)))),
      hitScreen: describe(at(centre(thumbRect))), hitScreenIsLink: at(centre(thumbRect))?.closest('a') !== null,
      stripInsideLink: !!frame.querySelector('a')?.contains(strip),
      plainHasScreen: !!plainFrame.querySelector('[data-testid="diagram-element-screen"]'),
      plainFrame: rect(plainFrame),
      opaque: (() => { try { void iframe.contentWindow.document; return false; } catch { return true; } })(),
      frameSize: { width: frame.offsetWidth, height: frame.offsetHeight },
    };
  })()`);

  const close = (actual, expected, tolerance, message) =>
    assert.ok(
      Math.abs(actual - expected) <= tolerance,
      `${message}: ${actual} vs ${expected}`,
    );
  // Footprint: the medium density card is unchanged and the plain card keeps it.
  assert.deepEqual(geometry.frameSize, { width: 140, height: 140 });
  assert.equal(geometry.plainHasScreen, false);
  // Complete screen, proportional (1280x800), laid out at its authored size.
  close(geometry.thumb.width / geometry.thumb.height, 1.6, 0.05, "aspect");
  assert.equal(geometry.iframe.width, "1280px");
  assert.equal(geometry.iframe.height, "800px");
  assert.ok(geometry.thumb.left >= geometry.frame.left);
  assert.ok(geometry.thumb.right <= geometry.frame.right);
  assert.ok(geometry.thumb.top >= geometry.frame.top);
  // Name below the screen, inside the card.
  assert.ok(
    geometry.name.top >= geometry.thumb.bottom - 1,
    "name below screen",
  );
  assert.ok(geometry.name.bottom <= geometry.frame.bottom, "name inside card");
  // Role icon at the screen's upper-left; link strip at its lower-left.
  assert.ok(
    geometry.role.left >= geometry.thumb.left &&
      geometry.role.top >= geometry.thumb.top &&
      geometry.role.left - geometry.thumb.left <= 12 &&
      geometry.role.top - geometry.thumb.top <= 12,
    `role icon over screen upper-left: ${JSON.stringify([geometry.role, geometry.thumb])}`,
  );
  assert.ok(
    geometry.strip.left >= geometry.thumb.left &&
      geometry.strip.bottom <= geometry.thumb.bottom &&
      geometry.strip.left - geometry.thumb.left <= 8 &&
      geometry.thumb.bottom - geometry.strip.bottom <= 8,
    `link strip over screen lower-left: ${JSON.stringify([geometry.strip, geometry.thumb])}`,
  );
  // Stacking: host controls sit above the iframe; the iframe never takes input.
  assert.equal(
    geometry.hitRole,
    "diagram-element-role-icon",
    "role icon on top",
  );
  assert.notEqual(geometry.hitButton, "IFRAME");
  assert.equal(geometry.hitButton, "svg", "link icon hit");
  assert.notEqual(
    geometry.hitScreen,
    "IFRAME",
    "screen content takes no pointer events",
  );
  assert.equal(
    geometry.hitScreenIsLink,
    true,
    "screen pointer falls through to the card",
  );
  assert.equal(geometry.stripInsideLink, false);
  // Isolation.
  assert.deepEqual(
    {
      sandbox: geometry.iframe.sandbox,
      referrer: geometry.iframe.referrer,
      pointerEvents: geometry.iframe.pointerEvents,
      tabIndex: geometry.iframe.tabIndex,
      ariaHidden: geometry.iframe.ariaHidden,
      opaque: geometry.opaque,
    },
    {
      sandbox: "",
      referrer: "no-referrer",
      pointerEvents: "none",
      tabIndex: -1,
      ariaHidden: "true",
      opaque: true,
    },
  );
  await delay(500);
  assert.equal(await evaluate("window.authoredScriptRan"), false);
  assert.equal(forbiddenRequests, 0, "authored external loads must be blocked");

  // Keyboard: the screen adds no tab stop; the link icon stays reachable.
  assert.deepEqual(
    await evaluate(`(() => {
      const screenBody = document.querySelector('[data-testid="diagram-element-screen"]');
      return {
        iframeTabIndex: screenBody.querySelector('iframe').tabIndex,
        focusableInScreen: screenBody.querySelectorAll('a[href], button, input, [tabindex]:not([tabindex="-1"])').length,
        linkIconTabbable: document.querySelector('[data-testid="diagram-element-direct-link"]').tabIndex >= 0,
      };
    })()`),
    { iframeTabIndex: -1, focusableInScreen: 0, linkIconTabbable: true },
  );

  // Clicking a link icon does not navigate away from the page.
  await evaluate(
    "document.querySelector('[data-testid=\"diagram-element-direct-link\"]').click()",
  );
  await delay(150);
  assert.equal(await evaluate("location.href"), `${origin}/browser-test`);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const shotPath = resolve(
    process.env.DIAGRAM_SCREEN_SHOT ?? ".diagram-element-screen.png",
  );
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));
  console.log(`screenshot: ${shotPath}`);
  console.log(
    "PASS: Mockup screen card in real Chrome: footprint, proportional full screen, name below, role/link controls over the screen corners, stacking and hit testing, static noninteractive sandboxed iframe, blocked authored scripts and loads",
  );
} finally {
  socket?.close();
  chrome.kill();
  await new Promise((done) =>
    chrome.exitCode !== null || chrome.signalCode !== null
      ? done()
      : chrome.once("exit", done),
  );
  await server.close();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
