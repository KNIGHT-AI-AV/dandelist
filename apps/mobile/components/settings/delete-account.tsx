import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { haptic } from "../../lib/motion";
import { deleteAccount } from "../../lib/profile";
import { layout, radius, type, usePalette } from "../../lib/theme";
import { Field } from "../inputs";
import { ErrorLine, Glass, QuietButton } from "../lux";

/** The word that unlocks deletion: typing it is the deliberate second step. */
export const DELETE_WORD = "DELETE";

/**
 * Deleting the account, deep in settings (App Store rule 5.1.1(v); owner's walkthrough, 2026-10-28). The first tap
 * opens this panel; nothing happens until they type DELETE and press the button. Then the account and everything on
 * it goes, and they are signed out.
 */
export function DeleteAccount({ onCancel }: { onCancel(): void }) {
  const p = usePalette();
  const auth = useAuth();
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = word.trim().toUpperCase() === DELETE_WORD;

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(auth.api);
      haptic.success();
      await auth.signOut();
    } catch (e) {
      haptic.error();
      setError(e instanceof Error ? e.message : "Couldn't delete the account. Try again.");
      setBusy(false);
    }
  };

  return (
    <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: layout.cardPad, gap: layout.stack.base, borderColor: p.danger }}>
      <Text accessibilityRole="header" style={[type.headline, { color: p.ink }]}>
        Delete your account?
      </Text>
      <Text style={[type.callout, { color: p.ink2 }]}>
        This removes your account and everything on it: every wish, your conversations, your photo and your linked sign-in accounts. It can't be undone.
      </Text>
      <Field label={`Type ${DELETE_WORD} to confirm`} value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false} placeholder={DELETE_WORD} returnKeyType="done" onSubmitEditing={() => void confirm()} />
      <ErrorLine>{error}</ErrorLine>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete my account for good"
        accessibilityState={{ disabled: !ready || busy, busy }}
        onPress={ready && !busy ? () => void confirm() : undefined}
        style={({ pressed }) => [
          { minHeight: layout.control.primary, borderRadius: radius.control, borderCurve: "continuous", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: p.danger, backgroundColor: ready ? p.danger : "transparent", opacity: ready ? (pressed ? 0.85 : 1) : 0.5 },
          Platform.OS === "web" ? ({ cursor: ready ? "pointer" : "default" } as object) : null,
        ]}
      >
        {busy ? <ActivityIndicator color={p.bg} accessibilityLabel="Deleting your account" /> : <Text style={[type.button, { color: ready ? p.bg : p.danger }]}>Delete my account for good</Text>}
      </Pressable>
      <View style={{ alignItems: "center" }}>
        <QuietButton label="Keep my account" onPress={onCancel} />
      </View>
    </Glass>
  );
}
