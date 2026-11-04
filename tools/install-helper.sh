#!/bin/zsh
# Builds the tab2ping helper (helper/main.swift) and registers it with the installed browsers, for
# this macOS account. Usage: tools/install-helper.sh [--uninstall]
# (--uninstall removes entries in TAB2PING_NMH_DIRS only if it is set again.)
#   TAB2PING_NMH_DIRS  extra NativeMessagingHosts folders, separated by ":". A browser started with
#                      --user-data-dir still reads the per-user folder, not one in its profile.
# Development install from source (needs Xcode); users get the helper with the one line in
# tools/install.sh.in, which tools/make-release.sh attaches to a release.
set -e
ROOT=${0:A:h:h}
NAME=com.unbindthefog.tab2ping
# Fixed by the "key" in extension/manifest.json; the helper answers this extension only.
EXTENSION_ID=edkjcikcbhfepbdpkkpangmljbhknblc
DEST="${HOME:?}/Library/Application Support/tab2ping"
SUPPORT="$HOME/Library/Application Support"
case $1 in
  ""|--uninstall) ;;
  *) echo "usage: $0 [--uninstall]" >&2; exit 2 ;;
esac

# The browsers' per-user folders for native messaging hosts, if the browser is installed.
dirs=()
for browser in "BraveSoftware/Brave-Browser" "Google/Chrome" "Microsoft Edge" "Chromium"; do
  [[ -d "$SUPPORT/$browser" ]] && dirs+=("$SUPPORT/$browser/NativeMessagingHosts")
done
[[ -n $TAB2PING_NMH_DIRS ]] && dirs+=(${(s.:.)TAB2PING_NMH_DIRS})

if [[ $1 == --uninstall ]]; then
  for d in $dirs; do rm -f "$d/$NAME.json"; done
  rm -rf "$DEST"
  echo "tab2ping helper removed."
  exit 0
fi

BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
"$ROOT/tools/build-helper.sh" "$BUILD/tab2ping-helper"

mkdir -p "$DEST"
# Replace, not overwrite: a running helper keeps its file, and macOS caches signatures per file.
cp "$BUILD/tab2ping-helper" "$DEST/tab2ping-helper.new"
mv -f "$DEST/tab2ping-helper.new" "$DEST/tab2ping-helper"

for d in $dirs; do
  mkdir -p "$d"
  cat > "$d/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "tab2ping helper: ping and Terminal for the tab2ping extension",
  "path": "$DEST/tab2ping-helper",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "registered: $d"
done
echo "tab2ping helper installed: $DEST/tab2ping-helper"
