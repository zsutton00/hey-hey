import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const blockedReads = [
  'axios.get("/organizations/o/projects/p/tasks");',
  'api.get("/api/v1/organizations/o/projects/p/work-items/t/graph?view=all");',
  "api.get(`/organizations/${org}/projects/${project}/conversations/${id}`);",
  'fetch("/organizations/o/projects/p/conversations/c/messages/latest");',
  'fetch("/projects/p/workflows/name/about/conversations", { method: "GET" });',
  'api.request({ url: "/projects/p/messages/m", method: "get" });',
  'axios({ url: "/projects/p/messages/search" });',
  "client.getMessages(params);",
  '{ const url = "/organizations/o/projects/p/work-items/t"; fetch(url); }',
  '{ const path = "/projects/p/messages/m"; const url = path; api.get(url); }',
  '{ const path = "/projects/p/messages"; const url = `${path}/${id}`; api.get(url); }',
  '{ const url = "/projects/p/messages/m" as const; api.request({ url }); }',
  '{ const url = "/projects/p/messages/m"; const options = { method: "GET" }; fetch(url, options); }',
];

const permittedCalls = [
  'api.post("/organizations/o/projects/p/work-items", payload);',
  'api.delete("/organizations/o/projects/p/work-items/t");',
  'api.request({ url: "/projects/p/messages/m", method: "PATCH" });',
  'fetch("/projects/p/conversations/c", { method: "POST" });',
  'api.get("/organizations/o/projects/p/conversations/c/queued-inputs");',
  "fetch(`/projects/${project}/conversations/${id}/queued-inputs`);",
  "client.getQueuedConversationInputs(params);",
  'api.get("/organizations/o/projects/p/conversations/c/cli-status");',
  'api.get("/organizations/o/projects/p/entity-activity");',
  'import { http as mockHttp } from "msw";',
  'mockHttp.get("/organizations/o/projects/p/conversations/c", handler);',
  '{ const url = "/projects/p/conversations/c"; const method = "POST"; fetch(url, { method }); }',
  '{ const url = "/projects/p/conversations/c"; const options = { method: "POST" }; fetch(url, options); }',
  '{ const url = "/projects/p/conversations/c/queued-inputs"; fetch(url); }',
  '{ const url = "/projects/p/messages/m"; { const url = "/projects/p/entity-activity"; fetch(url); } fetch(url, { method: "PATCH" }); }',
];

for (const project of ["apps/ui", "packages/ui-common"]) {
  test(`${project} rejects REST entity reads and permits writes and queued inputs`, async () => {
    const config = new URL(`../${project}/eslint.config.js`, import.meta.url);
    const { ESLint } = createRequire(config)("eslint");
    const eslint = new ESLint({ cwd: fileURLToPath(new URL(".", config)) });
    const source = [...blockedReads, ...permittedCalls].join("\n");
    const [result] = await eslint.lintText(source, {
      filePath: "src/probe.ts",
    });
    const errors = result.messages.filter(({ severity }) => severity === 2);

    assert.deepEqual(
      errors.map(({ line }) => line),
      blockedReads.map((_, index) => index + 1),
    );
  });
}
