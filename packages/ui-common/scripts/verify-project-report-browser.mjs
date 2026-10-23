// Runs the production renderer and its real opaque-origin iframe in local Chrome.
// No remote app, credentials, test aliases, or mocked renderer/runtime wiring.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

let forbiddenRequests = 0;
const serveFixture = (request, response, next) => {
  if (request.url?.startsWith("/forbidden")) {
    forbiddenRequests++;
    response.end("Forbidden resource reached");
  } else if (request.url === "/browser-test") {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><div id="root"></div><script type="module" src="/scripts/browser/project-report.tsx"></script>');
  } else next();
};
const server = await createServer({
  configFile: false, root: process.cwd(),
  esbuild: { jsx: "automatic" },
  plugins: [{ name: "local-browser-fixture", configureServer(server) { server.middlewares.use(serveFixture); } }],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(resolve(".report-browser-"));
const chrome = spawn(process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless", "--no-first-run", "--no-default-browser-check",
  "--disable-background-networking", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Chrome startup timed out: ${output}`)), 10000);
    chrome.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]); }
    });
    chrome.on("error", reject);
    chrome.on("exit", code => reject(new Error(`Chrome exited ${code}: ${output}`)));
  });
  const targets = await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolveOpen => socket.addEventListener("open", resolveOpen, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const contexts = new Map();
  const iframeSessions = new Map();
  const failures = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Target.attachedToTarget" && message.params.targetInfo.type === "iframe") {
      iframeSessions.set(message.params.targetInfo.targetId, message.params.sessionId);
      send("Runtime.enable", {}, message.params.sessionId).catch(error => failures.push(error.message));
    }
    if (message.method === "Runtime.executionContextCreated") {
      const context = message.params.context;
      if (context.auxData?.isDefault) contexts.set(context.auxData.frameId, { id: context.id, sessionId: message.sessionId });
    }
    if (message.method === "Runtime.exceptionThrown") failures.push(message.params.exceptionDetails);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") failures.push(message.params.args);
    if (message.id) {
      const entry = pending.get(message.id);
      if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolveResult, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 60000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const evaluate = async (expression, contextId) => {
    const result = await send("Runtime.evaluate", { expression, contextId: contextId?.id, awaitPromise: true, returnByValue: true }, contextId?.sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, contextId) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await evaluate(expression, contextId)) return;
      await delay(50);
    }
    throw new Error(`Condition timed out: ${expression}; browser errors: ${JSON.stringify(failures)}; page: ${await evaluate('document.body.innerText')}`);
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Runtime.enable");
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send("Page.navigate", { url: `${origin}/browser-test` });
  await waitFor('!!document.querySelector("iframe")');
  let frameContext;
  const frameDeadline = Date.now() + 20000;
  do {
    frameContext = Array.from(contexts.values()).find(context => context.sessionId && Array.from(iframeSessions.values()).includes(context.sessionId));
    if (frameContext) break;
    await delay(50);
  } while (Date.now() < frameDeadline);
  assert.ok(frameContext, `Iframe must load a browsing context: ${JSON.stringify(Array.from(contexts))}; ${JSON.stringify(failures)}`);
  await waitFor('!!document.querySelector("iframe")?.getAttribute("srcdoc")');
  await waitFor('document.querySelector("#resolved")?.getAttribute("role") === "button"', frameContext);
  const item = 'document.querySelector(\'[data-testid="browser-project-report-evidence-item"][data-evidence-key="E1"]\')';
  await evaluate(`window.authoredScriptRan = false; window.addEventListener('message', event => { if(event.data === 'authored-script-ran') window.authoredScriptRan = true; });`);
  assert.deepEqual(await evaluate(`(() => { const frame = document.querySelector('iframe'); let opaque = false; try { void frame.contentWindow.document; } catch { opaque = true; } return { sandbox: frame.getAttribute('sandbox'), referrer: frame.referrerPolicy, opaque }; })()`),
    { sandbox: "allow-scripts", referrer: "no-referrer", opaque: true });
  assert.equal(await evaluate("document.referrer", frameContext), "");
  assert.equal(await evaluate("document.querySelectorAll('script').length", frameContext), 1, "Only the host nonce script survives");
  assert.equal(await evaluate("!!document.querySelector('[onclick], [onerror], [href], [src], [action], [target]')", frameContext), false);

  // Trusted mouse input lands on the nested span, exercising delegated activation.
  const click = async selector => {
    await evaluate("document.querySelector('iframe').scrollIntoView({block:'start',behavior:'instant'}) ");
    const offset = await evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.x, y: r.y }; })()");
    const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`, frameContext);
    assert.ok(offset.y + point.y >= 0 && offset.y + point.y < 1000, `Citation must be visible for trusted input: ${JSON.stringify({offset, point})}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: offset.x + point.x, y: offset.y + point.y });
    await delay(100);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: offset.x + point.x, y: offset.y + point.y, button: "left", clickCount: 1 });
  };
  await click("#resolved span");
  await waitFor(`document.activeElement === ${item}`);
  await waitFor(`(() => { const r = ${item}.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`);
  for (const key of ["Enter", " "]) {
    await evaluate("document.querySelector('iframe').scrollIntoView()");
    await evaluate("document.querySelector('#resolved').focus()", frameContext);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key === " " ? "Space" : "Enter", windowsVirtualKeyCode: key === " " ? 32 : 13 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key === " " ? "Space" : "Enter", windowsVirtualKeyCode: key === " " ? 32 : 13 });
    await waitFor(`document.activeElement === ${item}`);
  }
  assert.equal(await evaluate("document.querySelector('#unresolved').hasAttribute('tabindex')", frameContext), false);
  for (const action of ["click", "Enter", " "]) {
    await evaluate(`${item}.blur()`);
    if (action === "click") await click("#unresolved");
    else {
      await evaluate("document.querySelector('#unresolved').focus()", frameContext);
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: action, windowsVirtualKeyCode: action === " " ? 32 : 13 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: action, windowsVirtualKeyCode: action === " " ? 32 : 13 });
    }
    await delay(100);
    assert.equal(await evaluate(`document.activeElement === ${item}`), false, "Unknown evidence must never focus a host target");
  }
  assert.equal(await evaluate('document.querySelector(\'[data-testid="browser-project-report-evidence-unresolved"]\').textContent.includes("E9")'), true);
  await click("#navigation");
  await click("#submit");

  // DevTools supplies probes after sanitation to verify browser CSP/sandbox enforcement,
  // independently of the sanitizer. The probes do not replace the host runtime.
  assert.deepEqual(await evaluate(`(async () => {
    const violations = []; document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
    const script = document.createElement('script'); script.textContent = "window.authoredProbeRan = true"; document.body.append(script);
    const image = document.createElement('img'); image.src = '${origin}/forbidden-image'; document.body.append(image);
    let fetchBlocked = false; try { await fetch('${origin}/forbidden-fetch'); } catch { fetchBlocked = true; }
    let topBlocked = false; try { top.location = '${origin}/forbidden-navigation'; } catch { topBlocked = true; }
    await new Promise(resolve => setTimeout(resolve, 200));
    return { scriptBlocked: window.authoredProbeRan !== true, fetchBlocked, topBlocked,
      scriptCsp: violations.includes('script-src-elem'), imageCsp: violations.includes('img-src'), fetchCsp: violations.includes('connect-src') };
  })()`, frameContext), { scriptBlocked: true, fetchBlocked: true, topBlocked: true, scriptCsp: true, imageCsp: true, fetchCsp: true });
  assert.equal(forbiddenRequests, 0, "Blocked probes must not reach the local server");
  assert.equal(await evaluate("window.authoredScriptRan"), false);
  assert.equal(await evaluate("location.href"), `${origin}/browser-test`);
  assert.equal(await evaluate("location.href", frameContext), "about:srcdoc");
  console.log("PASS: actual ProjectReport iframe: click, Enter, Space, host focus/visibility, unresolved keys, opaque origin, no referrer, authored scripts, CSP network blocking, and navigation isolation");
} finally {
  socket?.close();
  chrome.kill();
  await new Promise(resolveExit => chrome.exitCode !== null || chrome.signalCode !== null ? resolveExit() : chrome.once("exit", resolveExit));
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
