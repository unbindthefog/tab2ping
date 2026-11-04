#!/bin/zsh
# Builds the helper (helper/main.swift) as one signed file for Apple Silicon and Intel.
# Usage: tools/build-helper.sh <output file>
set -e
ROOT=${0:A:h:h}
OUT=${1:?usage: $0 <output file>}
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
for arch in arm64 x86_64; do
  swiftc -O -target $arch-apple-macos12 -o "$BUILD/helper-$arch" "$ROOT/helper/main.swift"
done
lipo -create -output "$BUILD/tab2ping-helper" "$BUILD/helper-arm64" "$BUILD/helper-x86_64"
# Apple Silicon only runs signed code; an ad hoc signature is enough for a file fetched with curl
# (no quarantine flag, so no Gatekeeper check).
codesign --force --sign - "$BUILD/tab2ping-helper" 2>/dev/null
mkdir -p "${OUT:h}"
mv -f "$BUILD/tab2ping-helper" "$OUT"
