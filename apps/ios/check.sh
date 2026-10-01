#!/usr/bin/env bash
# Compile the app and its tests without a device or simulator runtime:
# the check every iOS change must pass. Regenerates the project first.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcodegen generate --spec "$DIR/project.yml" --project "$DIR" --quiet
xcodebuild \
  -project "$DIR/Pulso.xcodeproj" -scheme Pulso \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DIR/DerivedData" \
  CODE_SIGNING_ALLOWED=NO build-for-testing 2>&1 | grep -E "error:|warning: .*\.swift|TEST BUILD (SUCCEEDED|FAILED)"
