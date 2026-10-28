import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { layout, space, type, usePalette, useType } from "../../lib/theme";
import { Eyebrow, Glass, QuietButton } from "../lux";
import { useTopRoom } from "./chrome";

/** The person's settings: the look, sign out, privacy and terms, and deleting the account. */
export function SettingsPage() {
  const p = usePalette();
  const t = useType();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const top = useTopRoom();
  const gutter = layout.gutter(width);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // App Store rule 5.1.1(v): accounts can be deleted from inside the app. A second tap confirms.
  const deleteAccount = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    const res = await auth.api("/me", { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 204) await auth.signOut();
  };
  return (
    <ScrollView contentContainerStyle={{ paddingTop: top + layout.contentTop, paddingBottom: insets.bottom + space[40], paddingHorizontal: gutter, gap: space[20], width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
      <View style={{ gap: layout.stack.tight }}>
        <Eyebrow>Settings</Eyebrow>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>{auth.user?.email ?? ""}</Text>
      </View>
      <Glass style={{ paddingVertical: space[4] }}>
        <QuietButton label="Theme" onPress={() => router.push("/theme")} />
        <QuietButton label="Privacy" onPress={() => router.push("/privacy")} />
        <QuietButton label="Terms" onPress={() => router.push("/terms")} />
        <QuietButton label="Sign out" onPress={() => auth.signOut()} />
        <QuietButton label={confirmDelete ? "Tap again to delete everything" : "Delete my account"} onPress={deleteAccount} />
      </Glass>
      <Text style={[type.footnote, { color: p.ink3 }]}>Signed in as {auth.user?.email}</Text>
    </ScrollView>
  );
}
