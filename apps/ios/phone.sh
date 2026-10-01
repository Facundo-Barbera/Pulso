#!/usr/bin/env bash
# Build "Pulso Dev" onto the iPhone, headless — no Xcode GUI. Technique from Delta.
#
#   apps/ios/phone.sh          build Debug, install, launch
#   apps/ios/phone.sh --test   run the unit tests on the phone instead
set -euo pipefail

DEVICE="${PULSO_IPHONE_UDID:-00008150-001A7DC2367B401C}"
TEAM="${DEVELOPMENT_TEAM:-MM74W7WGAM}"
DIR="$(cd "$(dirname "$0")" && pwd)"
# xcode-select may point at the command-line tools; xcodebuild needs Xcode.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

CONFIG=Debug
BUNDLE=com.facundo.pulso.dev
ACTION=build
if [[ "${1:-}" == "--test" ]]; then ACTION=test; fi

xcodebuild \
  -project "$DIR/Pulso.xcodeproj" -scheme Pulso \
  -configuration "$CONFIG" \
  -destination "platform=iOS,id=$DEVICE" \
  -derivedDataPath "$DIR/DerivedData" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" \
  "$ACTION"

if [[ "$ACTION" == "test" ]]; then exit 0; fi

APP="$DIR/DerivedData/Build/Products/$CONFIG-iphoneos/Pulso.app"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE" || true
echo "installed Pulso Dev ($BUNDLE, $CONFIG)"
