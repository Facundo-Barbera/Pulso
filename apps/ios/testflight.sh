#!/usr/bin/env bash
# Archive Pulso (app + Live Activity + widgets) and upload it to TestFlight.
# Delta's apps/ios/testflight.sh, adapted; same measured lessons:
#   - the EXPORT re-signs with Apple Distribution (a development-signed upload is
#     refused, 90035), with the system rsync first on PATH (Homebrew's breaks it);
#   - the archive is signed (automatic signing, profiles fetched by Xcode's account),
#     because archiving unsigned silently drops entitlements — here HealthKit, the
#     App Group the widgets read and the shared keychain group. The check after the
#     export keeps that true.
#
#   apps/ios/testflight.sh                archive → export → upload → wait until processed
#   apps/ios/testflight.sh --export-only  archive → export; no upload
#
# Release configuration: bundle id `com.facundo.pulso` (App Store Connect app
# "Pulso by BiXKu"), not `.dev`, which stays what phone.sh installs by hand.
# Auth: PULSO_ASC_KEY_ID / PULSO_ASC_ISSUER_ID / PULSO_ASC_KEY_PATH, from the
# environment or apps/ios/.asc.env (gitignored: the repo is public).
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  "" | --export-only) ;;
  *) echo "usage: $(basename "$0") [--export-only]" >&2; exit 2 ;;
esac

DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$DIR/.asc.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$DIR/.asc.env"
  set +a
fi
: "${PULSO_ASC_KEY_ID:?set PULSO_ASC_KEY_ID (App Store Connect API key id)}"
: "${PULSO_ASC_ISSUER_ID:?set PULSO_ASC_ISSUER_ID}"
: "${PULSO_ASC_KEY_PATH:?set PULSO_ASC_KEY_PATH (path to the .p8)}"
# Signing goes through the Apple ID logged into Xcode, like phone.sh: xcodebuild
# refuses this API key ("Authentication failed") even though the REST API takes
# it. PULSO_SIGN_WITH_KEY=1 tries the key instead. The key still does the upload.
AUTH=(-allowProvisioningUpdates)
if [[ "${PULSO_SIGN_WITH_KEY:-}" == 1 ]]; then
  AUTH+=(-authenticationKeyID "$PULSO_ASC_KEY_ID"
    -authenticationKeyIssuerID "$PULSO_ASC_ISSUER_ID"
    -authenticationKeyPath "$PULSO_ASC_KEY_PATH")
fi

TEAM="${DEVELOPMENT_TEAM:-MM74W7WGAM}"
VERSION="${PULSO_VERSION:-0.1.0}"
# Unique per upload; a re-run after a dead upload gets a fresh one.
BUILD_NUMBER="${PULSO_BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
DERIVED="${PULSO_IOS_DERIVED_DATA:-$HOME/Library/Caches/pulso-ci/DerivedData}"
WORK="${PULSO_IOS_WORK:-$HOME/Library/Caches/pulso-ci/archives}"
ARCHIVE="$WORK/Pulso-$BUILD_NUMBER.xcarchive"
EXPORT_DIR="$WORK/export-$BUILD_NUMBER"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
mkdir -p "$WORK"
# Archives are big and only the newest is ever looked at again.
find "$WORK" -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} + 2>/dev/null || true

xcodegen generate --spec "$DIR/project.yml" --project "$DIR" --quiet

started=$SECONDS
xcodebuild \
  -project "$DIR/Pulso.xcodeproj" -scheme Pulso \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED" \
  -archivePath "$ARCHIVE" \
  -quiet \
  "${AUTH[@]}" \
  DEVELOPMENT_TEAM="$TEAM" \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive
echo "archived Pulso $VERSION ($BUILD_NUMBER) in $((SECONDS - started)) s"

for ext in PulsoActivity PulsoWidgets; do
  if [[ ! -d "$ARCHIVE/Products/Applications/Pulso.app/PlugIns/$ext.appex" ]]; then
    echo "the archive has no PlugIns/$ext.appex — refusing to ship without it" >&2
    exit 1
  fi
done

started=$SECONDS
PATH="/usr/bin:/bin:$PATH" xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$DIR/ExportOptions.plist" \
  -exportPath "$EXPORT_DIR" \
  "${AUTH[@]}"
IPA="$EXPORT_DIR/Pulso.ipa"
ls -l "$IPA"
echo "exported in $((SECONDS - started)) s"

# What the app needs from the signature, checked on the exported app itself.
CHECK="$(mktemp -d)"
ditto -x -k "$IPA" "$CHECK"
ENTITLEMENTS="$(codesign -d --entitlements - --xml "$CHECK/Payload/Pulso.app" 2>/dev/null | plutil -convert json -o - -)"
rm -rf "$CHECK"
for wanted in '"com.apple.developer.healthkit":true' '"com.apple.security.application-groups"' '"keychain-access-groups"'; do
  if [[ "$ENTITLEMENTS" != *"$wanted"* ]]; then
    echo "the exported app is missing $wanted in its entitlements: $ENTITLEMENTS" >&2
    exit 1
  fi
done

if [[ "$MODE" == "--export-only" ]]; then
  echo "exported $IPA (upload skipped)"
  exit 0
fi

# altool finds keys by NAME in a directory, not by path.
KEYS_DIR="$(mktemp -d)/private_keys"
mkdir -p "$KEYS_DIR"
cp "$PULSO_ASC_KEY_PATH" "$KEYS_DIR/AuthKey_$PULSO_ASC_KEY_ID.p8"
trap 'rm -rf "$(dirname "$KEYS_DIR")"' EXIT
export API_PRIVATE_KEYS_DIR="$KEYS_DIR"

# altool can print a validation ERROR and still exit 0 — the output is the verdict.
started=$SECONDS
UPLOAD_LOG=$(mktemp)
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$PULSO_ASC_KEY_ID" --apiIssuer "$PULSO_ASC_ISSUER_ID" 2>&1 | tee "$UPLOAD_LOG"
if grep -q "ERROR" "$UPLOAD_LOG" || ! grep -q "UPLOAD SUCCEEDED" "$UPLOAD_LOG"; then
  echo "upload FAILED — see altool output above" >&2
  exit 1
fi
echo "uploaded build $BUILD_NUMBER in $((SECONDS - started)) s"

# The internal group gets every build, so processed means installable.
started=$SECONDS
node "$DIR/asc.mjs" wait "$BUILD_NUMBER"
echo "processed in $((SECONDS - started)) s — Pulso $VERSION ($BUILD_NUMBER) is in TestFlight"
