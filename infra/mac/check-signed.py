"""The signed app, checked before it is uploaded (TEAM KNIGHT and Mac Team Attack, 2026-10-30: "STOP before upload if
codesign shows aps-environment"). Prints the entitlements codesign reads back from the signed app and the Info.plist
usage strings and background modes, then exits 1, so build-ios.sh stops before altool, on anything Dandelist doesn't
ship: a push entitlement, any capability beyond Sign in with Apple, a debuggable build, a missing microphone string
(the app asks for the microphone to hear a wish), or background modes.

    python3 check-signed.py <signed-entitlements.plist> <Info.plist>
"""
import plistlib
import sys

STANDARD = {"application-identifier", "com.apple.developer.team-identifier", "get-task-allow", "keychain-access-groups"}
CAPABILITIES = {"com.apple.developer.applesignin"}
REQUIRED_USAGE = {"NSMicrophoneUsageDescription"}


def problems(ent: dict, info: dict) -> list:
    found = []
    if "aps-environment" in ent:
        found.append("aps-environment is signed in; Dandelist's notifications are local and need no push")
    extra = sorted(set(ent) - STANDARD - CAPABILITIES - {"aps-environment"})
    if extra:
        found.append(f"entitlements beyond Sign in with Apple and the standard four: {extra}")
    if ent.get("get-task-allow") is not False:
        found.append("get-task-allow is not false")
    missing = sorted(REQUIRED_USAGE - {k for k, v in info.items() if k.endswith("UsageDescription") and v})
    if missing:
        found.append(f"missing usage strings: {missing}")
    if info.get("UIBackgroundModes"):
        found.append(f"background modes: {info['UIBackgroundModes']}")
    return found


def main(argv: list) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    with open(argv[1], "rb") as f:
        ent = plistlib.load(f)
    with open(argv[2], "rb") as f:
        info = plistlib.load(f)
    print("signed entitlements:", ", ".join(sorted(ent)) or "none")
    for key in sorted(k for k in info if k.endswith("UsageDescription")):
        print(f"{key}: {info[key]}")
    print("UIBackgroundModes:", info.get("UIBackgroundModes") or "none")
    found = problems(ent, info)
    for p in found:
        print("STOP:", p)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
