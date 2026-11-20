#!/bin/zsh
# Prepares the release files in dist/: the helper and install.sh (version and checksum filled in).
# The version is the extension's (extension/manifest.json); install.sh downloads the helper from the
# release of exactly that tag, so the release must carry it. Publishing is a separate, deliberate
# step: the complete command is printed at the end, to be copied as it is.
set -e
ROOT=${0:A:h:h}
REPO=unbindthefog/tab2ping
VERSION=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/extension/manifest.json")
TAG=v$VERSION
# A tag that exists already would publish install.sh pointing at another release's helper. Without
# an answer from GitHub nothing is built: that is exactly when a duplicate would slip through.
rc=0; git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 || rc=$?
case $rc in
  0) echo "$TAG exists on GitHub already: commit first (the version is the commit count), then run again." >&2; exit 1 ;;
  2) ;;
  *) echo "GitHub not reachable, cannot check whether $TAG exists." >&2; exit 1 ;;
esac
# The release points at HEAD: it must be what is built here, and on GitHub.
if ! git -C "$ROOT" diff --quiet HEAD; then echo "Uncommitted changes: commit first." >&2; exit 1; fi
if ! git -C "$ROOT" branch -r --contains HEAD | grep -q .; then echo "HEAD is not pushed: push first." >&2; exit 1; fi
DIST="$ROOT/dist"
rm -rf "$DIST"
"$ROOT/tools/build-helper.sh" "$DIST/tab2ping-helper"
SHA256=$(shasum -a 256 "$DIST/tab2ping-helper" | cut -d' ' -f1)
sed -e "s/@VERSION@/$VERSION/" -e "s/@SHA256@/$SHA256/" "$ROOT/tools/install.sh.in" > "$DIST/install.sh"
COMMIT=$(git -C "$ROOT" rev-parse HEAD)
echo "dist/ ready for $TAG (helper sha256 $SHA256)."
echo "Publish (copy as it is):"
echo "  cd ${(q)ROOT} && gh release create $TAG dist/tab2ping-helper dist/install.sh --repo $REPO --target $COMMIT --title $TAG --notes 'Helper: curl -fsSL https://github.com/$REPO/releases/latest/download/install.sh | sh'"
