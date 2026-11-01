import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function publicationEvidence(evidence, state, digest) {
  if (evidence.source?.workingChanges !== false)
    throw new Error("Publication requires a clean candidate");
  if (!evidence.localImageId || !evidence.source?.revision || !evidence.inputs)
    throw new Error("Missing build identity");
  if (state === "verified")
    return { ...evidence, smoke: "passed", published: false };
  if (
    state !== "published" ||
    evidence.smoke !== "passed" ||
    evidence.published !== false ||
    !/^sha256:[a-f0-9]{64}$/.test(digest ?? "")
  )
    throw new Error(
      "Publication requires smoke verification and a registry digest",
    );
  return {
    ...evidence,
    published: true,
    registryDigest: digest,
    immutableReference: `${evidence.intendedRepository}@${digest}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [state, file, digest] = process.argv.slice(2);
  const result = publicationEvidence(
    JSON.parse(fs.readFileSync(file, "utf8")),
    state,
    digest,
  );
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `${result.image}: ${result.published ? `published ${result.immutableReference}` : "smoke verified; not yet published"} (source ${result.source.revision})\n\n`,
  );
}
