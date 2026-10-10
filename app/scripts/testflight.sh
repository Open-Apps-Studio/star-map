#!/bin/bash
# Local release: archive with Xcode (automatic signing via the App Store
# Connect API key, no Apple ID / 2FA) and upload straight to TestFlight.
# Usage: scripts/testflight.sh <build-number>
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=${1:?build number}
set -a; source ~/.config/iconic-release/release.env; set +a
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_FILE"
      -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
OUT=build/release; rm -rf "$OUT"; mkdir -p "$OUT"

./scripts/sync-web.sh
npx expo prebuild -p ios --clean >/dev/null

xcodebuild -workspace ios/StarMap.xcworkspace -scheme StarMap -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/StarMap.xcarchive" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD" \
  "${AUTH[@]}" archive | tail -5

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

xcodebuild -exportArchive -archivePath "$OUT/StarMap.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT/export" "${AUTH[@]}" | tail -5
echo "Uploaded build $BUILD"
