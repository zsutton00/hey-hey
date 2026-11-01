#!/usr/bin/env bash
# Downloads the pinned arctic-embed-s INT8 ONNX model and tokenizer (Apache-2.0)
# into the given folder and verifies every file's checksum.
set -euo pipefail
dir="${1:-$(dirname "$0")/../models/snowflake-arctic-embed-s}"
revision=e596f507467533e48a2e17c007f0e1dacc837b33
base="https://huggingface.co/Snowflake/snowflake-arctic-embed-s/resolve/$revision"
files=(
  "onnx/model_quantized.onnx f93ff225320628d2e88baf2a395cae791b0e3b27edf5c70bf7b312a4d3260c14"
  "tokenizer.json 91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854"
)
mkdir -p "$dir"
for entry in "${files[@]}"; do
  read -r path sum <<<"$entry"
  target="$dir/$(basename "$path")"
  curl --fail --silent --show-error --location -o "$target" "$base/$path"
  echo "$sum  $target" | shasum -a 256 -c -
done
