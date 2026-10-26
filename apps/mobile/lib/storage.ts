import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Phones keep tokens in the Keychain or Keystore. The web build keeps them in localStorage for now;
// the production web build moves the refresh token to an HTTP-only cookie.
export async function getSecret(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: string, value: string | null): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      // Private browsing can refuse storage; the session then lasts only until the tab closes.
    }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}
