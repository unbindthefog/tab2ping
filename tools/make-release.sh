#!/bin/zsh
# Prepares the release files in dist/: the helper and install.sh (version and checksum filled in).
# The version is the extension's (extension/manifest.json). Publishing is a separate, deliberate
# step; the command for it is printed at the end.
set -e
ROOT=${0:A:h:h}
VERSION=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/extension/manifest.json")
DIST="$ROOT/dist"
rm -rf "$DIST"
"$ROOT/tools/build-helper.sh" "$DIST/tab2ping-helper"
SHA256=$(shasum -a 256 "$DIST/tab2ping-helper" | cut -d' ' -f1)
sed -e "s/@VERSION@/$VERSION/" -e "s/@SHA256@/$SHA256/" "$ROOT/tools/install.sh.in" > "$DIST/install.sh"
echo "dist/ ready for v$VERSION (helper sha256 $SHA256)."
echo "Publish: gh release create v$VERSION dist/tab2ping-helper dist/install.sh --repo unbindthefog/tab2ping --title v$VERSION"
