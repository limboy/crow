#!/bin/sh
# Builds the Quick Look preview extension into out/quicklook/CrowQuickLook.appex.
# electron-builder copies it into Crow.app/Contents/PlugIns (see extraFiles in
# electron-builder.yml) and macos/sign.cjs signs it with the app's identity.
# It's ad-hoc signed here so an unsigned local build still loads it.
set -eu
cd "$(dirname "$0")"
root=../..
appex="$root/out/quicklook/CrowQuickLook.appex"
version=$(node -p "require('$root/package.json').version")

rm -rf "$appex"
mkdir -p "$appex/Contents/MacOS"
xcrun swiftc -O -parse-as-library -module-name CrowQuickLook \
  -target "$(uname -m)-apple-macos12.0" \
  -Xlinker -e -Xlinker _NSExtensionMain \
  PreviewProvider.swift -o "$appex/Contents/MacOS/CrowQuickLook"
cp Info.plist "$appex/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$version" "$appex/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$appex/Contents/Info.plist"
codesign --force --sign - --entitlements CrowQuickLook.entitlements "$appex"
echo "built $appex"
