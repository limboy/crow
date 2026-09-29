#!/bin/sh
# Builds the Quick Look extensions into out/quicklook/:
#   CrowQuickLook.appex — the space-bar preview (Preview/)
#   CrowThumbnail.appex — Finder's thumbnail (Thumbnail/)
# electron-builder copies them into Crow.app/Contents/PlugIns (see extraFiles
# in electron-builder.yml) and macos/sign.cjs signs them with the app's
# identity. They're ad-hoc signed here so an unsigned local build still loads them.
set -eu
cd "$(dirname "$0")"
root=../..
version=$(node -p "require('$root/package.json').version")

# build <module> <source dir>
build() {
  appex="$root/out/quicklook/$1.appex"
  rm -rf "$appex"
  mkdir -p "$appex/Contents/MacOS"
  xcrun swiftc -O -parse-as-library -module-name "$1" \
    -target "$(uname -m)-apple-macos12.0" \
    -Xlinker -e -Xlinker _NSExtensionMain \
    CrowDocument.swift CrowPreview.swift "$2"/*.swift -o "$appex/Contents/MacOS/$1"
  cp "$2/Info.plist" "$appex/Contents/Info.plist"
  plutil -replace CFBundleShortVersionString -string "$version" "$appex/Contents/Info.plist"
  plutil -replace CFBundleVersion -string "$version" "$appex/Contents/Info.plist"
}

build CrowQuickLook Preview
build CrowThumbnail Thumbnail
for appex in "$root"/out/quicklook/*.appex; do
  codesign --force --sign - --entitlements QuickLook.entitlements "$appex"
done
echo "built $root/out/quicklook"
