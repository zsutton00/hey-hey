import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { selectAffected } from "./affected-builds.mjs";

export function candidateSelection(
  { event, target, before, revision, ref },
  diff = (base, head) =>
    execFileSync("git", ["diff", "--name-only", "--no-renames", base, head], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean),
) {
  let selection;
  if (event === "workflow_dispatch") {
    const files = {
      UI: ["apps/ui/retry"],
      API: ["apps/api/retry"],
      Both: ["apps/ui/retry", "apps/api/retry"],
      "Graph Search": ["apps/graph-search/retry"],
      All: ["<manual retry>"],
    }[target];
    if (!files) throw new Error("Unknown retry target");
    selection = selectAffected(files);
  } else if (event === "push") {
    // A release is a complete CLI bundle, including unchanged images at this revision.
    if (ref?.startsWith("refs/heads/release/")) {
      return selectAffected(["<complete release bundle>"]);
    }

    let files = ["<unavailable push base>"];
    if (/^[a-f0-9]{40}$/.test(before ?? "") && !/^0+$/.test(before)) {
      try {
        files = diff(before, revision);
      } catch {
        /* Missing history selects all. */
      }
    }
    selection = selectAffected(files);
  } else throw new Error("Unsupported candidate event");
  return selection;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = candidateSelection({
    event: process.env.GITHUB_EVENT_NAME,
    target: process.env.TARGET,
    before: process.env.BEFORE,
    revision: process.env.GITHUB_SHA,
    ref: process.env.REF,
  });
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `images=${JSON.stringify(result.images)}\n`,
  );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Selected images: ${result.images.join(", ") || "none"}\n\n${result.externalConsumerHandoff ? "OpenAPI inputs selected: Graph and Embeddings consumers must review their pinned specification; neither is built here." : ""}\n`,
  );
}
