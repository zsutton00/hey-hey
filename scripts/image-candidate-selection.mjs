import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { selectAffected } from "./affected-builds.mjs";

export function candidateSelection(
  { ref, event, target, before, revision },
  diff = (base, head) =>
    execFileSync("git", ["diff", "--name-only", "--no-renames", base, head], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean),
) {
  if (!/^refs\/heads\/release\/.+/.test(ref ?? ""))
    throw new Error("Candidate publication requires a release branch");
  let selection;
  if (event === "workflow_dispatch") {
    const files = {
      UI: ["apps/ui/retry"],
      API: ["apps/api/retry"],
      Both: ["<manual retry>"],
    }[target];
    if (!files) throw new Error("Unknown retry target");
    selection = selectAffected(files);
  } else if (event === "push") {
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
  if (selection.images.length)
    selection.checks.push({
      target: "contracts",
      command:
        "pnpm test:scripts && pnpm generate:check && pnpm check:controller-producers",
    });
  return selection;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = candidateSelection({
    ref: process.env.GITHUB_REF,
    event: process.env.GITHUB_EVENT_NAME,
    target: process.env.TARGET,
    before: process.env.BEFORE,
    revision: process.env.GITHUB_SHA,
  });
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `images=${JSON.stringify(result.images)}\nchecks=${JSON.stringify(result.checks)}\n`,
  );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Selected images: ${result.images.join(", ") || "none"}\n\n${result.externalConsumerHandoff ? "OpenAPI inputs selected: Graph and Embeddings consumers must review their pinned specification; neither is built here." : ""}\n`,
  );
}
