#!/usr/bin/env bash
# Downloads the pinned arctic-embed-s INT8 ONNX model and tokenizer (Apache-2.0)
# into the given folder and verifies every file's checksum.
# The pinned revision and checksums live in model-pins.json, which the CLI release
# manifest also reads, so there is one set of values.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${1:-$here/../models/snowflake-arctic-embed-s}"
pins="$here/../model-pins.json"
mkdir -p "$dir"
node -e '
  const pins = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const f of Object.values(pins.files)) {
    console.log(`https://huggingface.co/${pins.repository}/resolve/${pins.revision}/${f.path} ${f.file} ${f.sha256}`);
  }
' "$pins" | while read -r url file sum; do
  target="$dir/$file"
  curl --fail --silent --show-error --location -o "$target" "$url"
  echo "$sum  $target" | shasum -a 256 -c -
done
