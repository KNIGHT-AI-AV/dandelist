#!/usr/bin/env bash
# Builds the iPhone app on CodeBuild's Mac (Xcode 26) and uploads it to TestFlight, with no Expo build service and
# so no monthly build limit (owner, 2026-10-29). Runs from the repo root; buildspec.yml passes the signing secret in
# SIGNING (JSON: p12, p12Password, profile, ascKeyId, ascIssuerId, ascKeyP8). Nothing secret is printed.
set -euo pipefail

: "${SIGNING:?the dandelist-ios/signing secret did not reach the build}"
field() { node -e 'const j = JSON.parse(process.env.SIGNING); process.stdout.write(String(j[process.argv[1]] ?? ""))' "$1"; }

WORK="$(mktemp -d)"
KEYCHAIN="$WORK/dandelist.keychain-db"
KEYCHAIN_PW="$(uuidgen)"
cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$WORK" "$HOME/.appstoreconnect/private_keys"
}
trap cleanup EXIT

echo "--- tools"
sw_vers -productVersion
xcodebuild -version | head -1
node --version

echo "--- unpack the secret, then take it out of the environment before any dependency code runs"
umask 077
field p12 | base64 --decode > "$WORK/dist.p12"
field profile | base64 --decode > "$WORK/app.mobileprovision"
P12_PASSWORD=$(field p12Password)
KEY_ID=$(field ascKeyId)
ISSUER=$(field ascIssuerId)
ASC_KEY_P8=$(field ascKeyP8)
unset SIGNING

echo "--- signing: a throwaway keychain with the distribution certificate, and the App Store profile"
security create-keychain -p "$KEYCHAIN_PW" "$KEYCHAIN"
security set-keychain-settings -lut 7200 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PW" "$KEYCHAIN"
security import "$WORK/dist.p12" -k "$KEYCHAIN" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
rm -f "$WORK/dist.p12"
unset P12_PASSWORD
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PW" "$KEYCHAIN" >/dev/null
# shellcheck disable=SC2046
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
security cms -D -i "$WORK/app.mobileprovision" > "$WORK/profile.plist"
UUID=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$WORK/profile.plist")
PROFILE_NAME=$(/usr/libexec/PlistBuddy -c 'Print Name' "$WORK/profile.plist")
TEAM=$(/usr/libexec/PlistBuddy -c 'Print TeamIdentifier:0' "$WORK/profile.plist")
for dir in "$HOME/Library/MobileDevice/Provisioning Profiles" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
  mkdir -p "$dir"
  cp "$WORK/app.mobileprovision" "$dir/$UUID.mobileprovision"
done
echo "profile \"$PROFILE_NAME\" for team $TEAM"

# The App Store Connect key is on disk only while it is used: here for the build number, and at the upload.
key_on() {
  mkdir -p "$HOME/.appstoreconnect/private_keys"
  printf '%s
' "$ASC_KEY_P8" > "$HOME/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8"
}
key_off() { rm -rf "$HOME/.appstoreconnect/private_keys"; }
key_on
BUILD_NUMBER=$(ASC_KEY_ID="$KEY_ID" ASC_ISSUER_ID="$ISSUER" ASC_KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8" node infra/aws/iphone/next-build.mjs)
key_off
umask 022
echo "build number $BUILD_NUMBER"

echo "--- install and generate the native project"
corepack enable
pnpm install --frozen-lockfile
cd apps/mobile
CI=1 npx expo prebuild --platform ios --clean
WORKSPACE=$(ls -d ios/*.xcworkspace | head -1)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "ios/$SCHEME/Info.plist"

# Manual signing on the app target only; the pods are libraries and are not signed with the app's profile.
ruby -rxcodeproj -e '
  project = Xcodeproj::Project.open(ARGV[0])
  target = project.targets.find { |t| t.name == ARGV[1] } or abort("no target #{ARGV[1]}")
  target.build_configurations.each do |c|
    c.build_settings["CODE_SIGN_STYLE"] = "Manual"
    c.build_settings["DEVELOPMENT_TEAM"] = ARGV[2]
    c.build_settings["CODE_SIGN_IDENTITY"] = "Apple Distribution"
    c.build_settings["CODE_SIGN_IDENTITY[sdk=iphoneos*]"] = "Apple Distribution"
    c.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = ARGV[3]
    c.build_settings["CURRENT_PROJECT_VERSION"] = ARGV[4]
  end
  project.save
' "ios/$SCHEME.xcodeproj" "$SCHEME" "$TEAM" "$PROFILE_NAME" "$BUILD_NUMBER"

echo "--- archive (the full log is kept, and its end is shown on failure)"
if ! xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release -destination "generic/platform=iOS" \
  -archivePath "$WORK/app.xcarchive" OTHER_CODE_SIGN_FLAGS="--keychain $KEYCHAIN" archive > "$WORK/archive.log" 2>&1; then
  grep -E "error:|\*\* ARCHIVE FAILED" "$WORK/archive.log" | head -40 || true
  tail -80 "$WORK/archive.log"
  exit 1
fi
echo "archived"

cat > "$WORK/export.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>com.knightaiav.dandelist</key><string>$PROFILE_NAME</string></dict>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
if ! xcodebuild -exportArchive -archivePath "$WORK/app.xcarchive" -exportPath "$WORK/ipa" -exportOptionsPlist "$WORK/export.plist" > "$WORK/export.log" 2>&1; then
  tail -60 "$WORK/export.log"
  exit 1
fi
IPA=$(ls "$WORK"/ipa/*.ipa | head -1)
echo "exported $(basename "$IPA") ($(du -h "$IPA" | cut -f1))"

echo "--- upload to TestFlight"
key_on
xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$KEY_ID" --apiIssuer "$ISSUER"
echo "uploaded build $BUILD_NUMBER"
