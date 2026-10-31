#!/bin/bash
# Dandelist's iPhone build on the owner's Mac (knight-mac) by the K1 route: an unsigned archive, signed with a
# throwaway keychain inside the job folder, packed with ditto and uploaded with altool (owner, 2026-10-29: "Use my
# fucking Mac", "Why pay for that"; TEAM KNIGHT's LOCKS row, 18:13:28Z).
#
#   bash build-ios.sh /Users/knightaiav/builds/dandelist-ios-<sha> <sha> <build number>
#
# The signing secrets arrive in the environment only (SIGN_P12_B64, SIGN_P12_PW, SIGN_PROFILE_B64, ASC_KEY_ID,
# ASC_ISSUER_ID, ASC_P8_B64): they go into the folder and out of the environment at once, and the keychain and key
# files are removed on exit, success or not. Everything else the build writes stays inside the folder too: the
# source, node_modules, the pnpm store, the CocoaPods home and cache, Expo's home, temp files and DerivedData. The
# login keychain, the keychain list and ~/Library/MobileDevice are never touched. The folder itself is deleted only
# after the IPA has been copied off the Mac and its sha256 checked on the other side.
set -euo pipefail
JOB="$1"
SHA="$2"
BUILD="$3"
case "$JOB" in /Users/knightaiav/builds/dandelist-ios-*) ;; *) echo "refusing job folder $JOB" >&2; exit 2 ;; esac
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "need the full commit sha" >&2; exit 2; }
[[ "$BUILD" =~ ^[0-9]+$ ]] || { echo "need a numeric build" >&2; exit 2; }

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
say() { echo "[$(date -u +%H:%M:%SZ)] $*"; }
# Mac Team Attack's memory STOP is pressure level 4; stop before a heavy step rather than be stopped in it.
pressure() { [ "$(sysctl -n kern.memorystatus_vm_pressure_level)" -lt 4 ] || { say "STOP: memory pressure level 4"; exit 3; }; }

# The Xcode this job builds with: the Mac's default (xcode-select, untouched), or Xcode 27.1 for this job alone when
# the launcher passes DEVELOPER_DIR (owner, 2026-10-31: "xcode yea go", side by side; the iPhone Duo's inner screen
# needs an iOS 27.1 SDK build). xcodebuild and xcrun both read DEVELOPER_DIR; nothing runs xcode-select -s.
if [ -n "${DEVELOPER_DIR:-}" ]; then
  case "$DEVELOPER_DIR" in /Applications/Xcode-27.1.app/Contents/Developer) ;; *) echo "refusing DEVELOPER_DIR $DEVELOPER_DIR" >&2; exit 2 ;; esac
  [ -d "$DEVELOPER_DIR" ] || { echo "no Xcode at $DEVELOPER_DIR" >&2; exit 2; }
  export DEVELOPER_DIR
fi
IOS_SDK="$(xcrun --sdk iphoneos --show-sdk-version)"
XCODE_VERSION="$(xcodebuild -version | tr '\n' ' ')"
say "Xcode: $XCODE_VERSION; iOS SDK $IOS_SDK"
# A 27.1 job must really be Xcode 27.1 (27A9275) building against the iOS 27.1 SDK (Mac Team Attack's review), so no
# other 27.1.x slips in: anything else stops here.
if [ -n "${DEVELOPER_DIR:-}" ]; then
  [ "$IOS_SDK" = "27.1" ] || { echo "Xcode 27.1 reports iOS SDK $IOS_SDK, not 27.1" >&2; exit 2; }
  case "$XCODE_VERSION" in *"Build version 27A9275"*) ;; *) echo "not Xcode 27.1 build 27A9275: $XCODE_VERSION" >&2; exit 2 ;; esac
fi

mkdir -p "$JOB"/{secrets,private_keys,kc,home,tmp,logs,out,cache}
KC="$JOB/kc/dandelist-build.keychain-db"
KCPW="$(openssl rand -hex 24)"
# altool starts its own `log stream` and leaves it running after it exits (Mac Team Attack's after-check, TF17).
ALTOOL_LOG='^/usr/bin/log stream --predicate process contains "altool"'
LOGS_BEFORE=""
UPLOADING=""
cleanup() {
  security delete-keychain "$KC" 2>/dev/null || true
  rm -rf "$JOB/secrets" "$JOB/private_keys"
  # Only the log streams this run's upload started; anything that was running before stays.
  if [ -n "$UPLOADING" ]; then
    for pid in $(pgrep -f "$ALTOOL_LOG" || true); do
      printf '%s\n' "$LOGS_BEFORE" | grep -qx "$pid" || kill "$pid" 2>/dev/null || true
    done
  fi
}
trap cleanup EXIT

# The secrets: into the folder, out of the environment.
umask 077
printf '%s' "$SIGN_P12_B64" | base64 -D > "$JOB/secrets/dist.p12"
printf '%s' "$SIGN_PROFILE_B64" | base64 -D > "$JOB/secrets/app.mobileprovision"
printf '%s' "$ASC_P8_B64" | base64 -D > "$JOB/private_keys/AuthKey_${ASC_KEY_ID}.p8"
P12PW="$SIGN_P12_PW"
unset SIGN_P12_B64 SIGN_PROFILE_B64 ASC_P8_B64 SIGN_P12_PW
umask 022

# Every tool's home, cache and temp inside the folder.
export TMPDIR="$JOB/tmp" EXPO_HOME="$JOB/home/.expo" EXPO_NO_TELEMETRY=1 COREPACK_HOME="$JOB/cache/corepack" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export EXPO_PUBLIC_API_URL="https://api.dandelist.knightaiav.com"
FAKE_HOME="$JOB/home"

say "source $SHA"
git init -q "$JOB/src"
HOME="$FAKE_HOME" git -C "$JOB/src" fetch -q --depth 1 https://github.com/KNIGHT-AI-AV/dandelist.git "$SHA"
HOME="$FAKE_HOME" git -C "$JOB/src" -c advice.detachedHead=false checkout -q FETCH_HEAD
APP_DIR="$JOB/src/apps/mobile"

pressure
say "pnpm install (the app and its workspace packages only)"
(cd "$JOB/src" && HOME="$FAKE_HOME" corepack pnpm install --frozen-lockfile --filter "@dandelist/mobile..." --store-dir "$JOB/cache/pnpm-store") > "$JOB/logs/install.log" 2>&1 || { tail -n 40 "$JOB/logs/install.log"; exit 1; }

say "expo prebuild"
(cd "$APP_DIR" && HOME="$FAKE_HOME" CI=1 npx expo prebuild --platform ios --clean --no-install) > "$JOB/logs/prebuild.log" 2>&1 || { tail -n 40 "$JOB/logs/prebuild.log"; exit 1; }

pressure
say "pod install (CocoaPods home and cache in the folder)"
(cd "$APP_DIR/ios" && HOME="$FAKE_HOME" LANG=en_US.UTF-8 pod install) > "$JOB/logs/pods.log" 2>&1 || { tail -n 40 "$JOB/logs/pods.log"; exit 1; }

WS="$(ls -d "$APP_DIR"/ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WS" .xcworkspace)"
pressure
say "archive $SCHEME, unsigned"
xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release -sdk iphoneos -destination "generic/platform=iOS" \
  -archivePath "$JOB/out/$SCHEME.xcarchive" -derivedDataPath "$JOB/dd" -clonedSourcePackagesDirPath "$JOB/spm" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" archive > "$JOB/logs/archive.log" 2>&1 || { grep -E "error:|\*\* ARCHIVE" "$JOB/logs/archive.log" | tail -n 30; tail -n 20 "$JOB/logs/archive.log"; exit 1; }
APP="$(ls -d "$JOB/out/$SCHEME.xcarchive/Products/Applications/"*.app | head -1)"

say "throwaway keychain in the folder"
security create-keychain -p "$KCPW" "$KC"
security set-keychain-settings -lut 7200 "$KC"
security unlock-keychain -p "$KCPW" "$KC"
security import "$JOB/secrets/dist.p12" -k "$KC" -P "$P12PW" -T /usr/bin/codesign -f pkcs12 > /dev/null
# The certificate's intermediate, so the chain is whole inside this keychain.
curl -fsSL https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer -o "$JOB/secrets/wwdr-g3.cer"
security import "$JOB/secrets/wwdr-g3.cer" -k "$KC" > /dev/null 2>&1 || true
# Partition list on this keychain only (its -s means "signing keys"), so codesign never prompts.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KCPW" "$KC" > /dev/null
SHA1="$(security find-identity -p codesigning "$KC" | awk '/"Apple Distribution: / {print $2; exit}')"
[ -n "$SHA1" ] || { say "no Apple Distribution identity in the keychain"; exit 4; }

say "entitlements from the app's own file, each checked against the profile"
security cms -D -i "$JOB/secrets/app.mobileprovision" > "$JOB/secrets/profile.plist"
ENT="$JOB/secrets/app.entitlements"
python3 - "$JOB/secrets/profile.plist" "$APP_DIR/ios/$SCHEME/$SCHEME.entitlements" "$ENT" <<'PY'
import plistlib, sys
profile = plistlib.load(open(sys.argv[1], "rb"))
allowed = profile["Entitlements"]
try:
    asked = plistlib.load(open(sys.argv[2], "rb"))
except FileNotFoundError:
    asked = {}
app_id = allowed["application-identifier"]
team = allowed["com.apple.developer.team-identifier"]
ent = {**asked, "application-identifier": app_id, "com.apple.developer.team-identifier": team, "get-task-allow": False, "keychain-access-groups": [app_id]}
missing = [k for k in ent if k not in allowed]
if missing:
    sys.exit(f"the profile doesn't allow: {missing}")
plistlib.dump(ent, open(sys.argv[3], "wb"))
print("entitlements:", sorted(ent))
PY

say "sign build $BUILD"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" "$APP/Info.plist"
cp "$JOB/secrets/app.mobileprovision" "$APP/embedded.mobileprovision"
if [ -d "$APP/Frameworks" ]; then
  find "$APP/Frameworks" -maxdepth 1 \( -name "*.framework" -o -name "*.dylib" \) -print0 | while IFS= read -r -d '' f; do
    codesign --force --sign "$SHA1" --keychain "$KC" --timestamp=none "$f"
  done
fi
if [ -d "$APP/PlugIns" ]; then say "app extensions found; this script signs the app only"; exit 5; fi
codesign --force --sign "$SHA1" --keychain "$KC" --timestamp=none --entitlements "$ENT" --generate-entitlement-der "$APP"
codesign --verify --deep --strict "$APP"

# What the signed app really holds, read back from it, before anything leaves the Mac: STOP on a push entitlement, any
# capability beyond Sign in with Apple, a missing microphone string or background modes (infra/mac/check-signed.py).
say "check the signed app before upload"
codesign -d --entitlements - --xml "$APP" > "$JOB/logs/signed-entitlements.plist" 2> /dev/null ||
  codesign -d --entitlements :- "$APP" > "$JOB/logs/signed-entitlements.plist" 2> /dev/null
python3 "$JOB/src/infra/mac/check-signed.py" "$JOB/logs/signed-entitlements.plist" "$APP/Info.plist" || { say "STOP before upload: see above"; exit 7; }

say "pack the IPA"
rm -rf "$JOB/ipa" && mkdir -p "$JOB/ipa/Payload"
ditto "$APP" "$JOB/ipa/Payload/$(basename "$APP")"
IPA="$JOB/out/Dandelist-$BUILD.ipa"
(cd "$JOB/ipa" && ditto -c -k --sequesterRsrc --keepParent Payload "$IPA")
shasum -a 256 "$IPA"

say "upload build $BUILD to TestFlight (no review submission)"
LOGS_BEFORE="$(pgrep -f "$ALTOOL_LOG" || true)"
UPLOADING=1
(cd "$JOB" && xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID") > "$JOB/logs/upload.log" 2>&1 || { tail -n 30 "$JOB/logs/upload.log"; exit 6; }
tail -n 5 "$JOB/logs/upload.log"
say "done: build $BUILD uploaded; the keychain and key files go now, the folder after the IPA is copied off"
