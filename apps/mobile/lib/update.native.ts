import { requireOptionalNativeModule } from "expo";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Linking, Platform } from "react-native";
import { buildNumber, type Running, type Updater } from "./update-core";

export * from "./update-core";

/** The web app's address. latest.json is published with it (apps/mobile/public). */
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "https://dandelist.knightaiav.com").replace(/\/+$/, "");

/**
 * This binary's build number: CFBundleVersion on iOS, versionCode on Android. It is expo-application's
 * nativeBuildVersion, read through expo's module loader because that native module is already in every build (it
 * comes with expo-notifications), so no package is added. Expo Constants can't give it on Android: its native side
 * has no versionCode, and expoConfig has none either, because EAS numbers builds remotely. On iOS it reads the
 * Info.plist, so it is the fallback there. (The Mac's build script stamps CFBundleVersion after archiving, so
 * expoConfig's buildNumber would be wrong on iOS too.)
 */
function installedBuild(): number | null {
  const app = requireOptionalNativeModule<{ nativeBuildVersion?: string | null }>("ExpoApplication");
  return buildNumber(app?.nativeBuildVersion ?? (Platform.OS === "ios" ? Constants.platform?.ios?.buildNumber : null));
}

function running(): Running | null {
  // Development builds and Expo Go have their own build numbers; only release builds are asked.
  if (__DEV__ || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  const os = Platform.OS;
  if (os !== "ios" && os !== "android") return null;
  const build = installedBuild();
  return build === null ? null : { platform: os, build };
}

/** Phones: their own build against their platform's entry, and the store link (TestFlight for now, or the APK). */
export const updater: Updater = {
  running: running(),
  source: `${WEB_URL}/latest.json`,
  tried: () => null,
  go(offer) {
    if (offer.kind === "store") Linking.openURL(offer.url).catch(() => {});
  },
};
