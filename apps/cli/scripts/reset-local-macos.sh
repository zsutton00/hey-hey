#!/bin/sh
set -eu
if [ "$(uname -s)" != "Darwin" ]; then
  echo 'Use the reset entry point for your operating system.' >&2
  exit 1
fi
cd "$(dirname "$0")/.."
exec node --import tsx scripts/reset-local.ts
