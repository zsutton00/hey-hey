import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildOpenOutputCommands } from "./openOutputCommands";

const roots: string[] = [];
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("buildOpenOutputCommands", () => {
  it("does not apply the patch in the person's clone when the worktree destination already exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyhey-open-output-"));
    roots.push(root);
    const clone = path.join(root, "clone");
    fs.mkdirSync(clone);
    git(clone, "init", "-q", "-b", "main");
    git(clone, "config", "user.email", "t@example.com");
    git(clone, "config", "user.name", "T");
    fs.writeFileSync(path.join(clone, "a.txt"), "one\n");
    git(clone, "add", ".");
    git(clone, "commit", "-qm", "base");
    const sha = git(clone, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(clone, "a.txt"), "two\n");
    const patchPath = path.join(root, "out.patch");
    fs.writeFileSync(patchPath, git(clone, "diff") + "\n");
    git(clone, "checkout", "--", "a.txt");

    // The destination already exists and holds an unrelated checkout of the same file.
    const taken = path.join(root, "attempt-1");
    fs.mkdirSync(taken);
    fs.writeFileSync(path.join(taken, "a.txt"), "one\n");

    const script = buildOpenOutputCommands({
      attemptName: "attempt-1",
      sha,
      patchPath,
      hasPatch: true,
      opening: null,
    }).join("\n");
    let failed = false;
    try {
      execFileSync("sh", ["-c", script], { cwd: clone, stdio: "pipe" });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    expect(fs.readFileSync(path.join(clone, "a.txt"), "utf8")).toBe("one\n");
    expect(fs.readFileSync(path.join(taken, "a.txt"), "utf8")).toBe("one\n");
  });

  it("checks out the commit and applies the patch when the destination is free", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyhey-open-output-"));
    roots.push(root);
    const clone = path.join(root, "clone");
    fs.mkdirSync(clone);
    git(clone, "init", "-q", "-b", "main");
    git(clone, "config", "user.email", "t@example.com");
    git(clone, "config", "user.name", "T");
    fs.writeFileSync(path.join(clone, "a.txt"), "one\n");
    git(clone, "add", ".");
    git(clone, "commit", "-qm", "base");
    const sha = git(clone, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(clone, "a.txt"), "two\n");
    const patchPath = path.join(root, "out.patch");
    fs.writeFileSync(patchPath, git(clone, "diff") + "\n");
    git(clone, "checkout", "--", "a.txt");

    const script = buildOpenOutputCommands({
      attemptName: "attempt-2",
      sha,
      patchPath,
      hasPatch: true,
      opening: null,
    }).join("\n");
    execFileSync("sh", ["-c", script], { cwd: clone, stdio: "pipe" });

    expect(fs.readFileSync(path.join(root, "attempt-2", "a.txt"), "utf8")).toBe(
      "two\n",
    );
  });
});
