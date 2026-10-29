import { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { haptic, usePress } from "../../lib/motion";
import { NAME_MAX, pickAvatarImage, useProfile } from "../../lib/profile";
import { layout, type, usePalette, useType } from "../../lib/theme";
import { ProfileAvatar } from "../home/profile-avatar";
import { Field } from "../inputs";
import { ErrorLine } from "../lux";
import { RowAction } from "./kit";

const AVATAR = 96;

/** The top of settings: the picture (tap to change), the name as it greets them, and the email they sign in with. */
export function ProfileCard() {
  const p = usePalette();
  const t = useType();
  const auth = useAuth();
  const { profile, uploadAvatar, removeAvatar } = useProfile();
  const press = usePress(0.97);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async () => {
    if (busy) return;
    setError(null);
    try {
      const image = await pickAvatarImage();
      if (!image) return;
      setBusy("upload");
      await uploadAvatar(image);
      haptic.success();
    } catch (e) {
      haptic.error();
      setError(e instanceof Error ? e.message : "Couldn't save that photo. Try another.");
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setError(null);
    setBusy("remove");
    try {
      await removeAvatar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the photo. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const name = profile?.name ?? null;
  return (
    <View style={{ alignItems: "center", gap: layout.stack.base }}>
      <Pressable accessibilityRole="button" accessibilityLabel={profile?.avatarKey ? "Change your photo" : "Add a photo"} onPress={change} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
        <Animated.View style={{ transform: [{ scale: press.scale }] }}>
          <ProfileAvatar size={AVATAR} />
          {busy === "upload" ? (
            <View style={[StyleSheet.absoluteFill, { borderRadius: AVATAR / 2, alignItems: "center", justifyContent: "center", backgroundColor: `rgba(${p.bgRgb}, 0.55)` }]}>
              <ActivityIndicator color={p.ink} accessibilityLabel="Saving your photo" />
            </View>
          ) : null}
        </Animated.View>
      </Pressable>
      <View style={{ alignItems: "center", gap: 4 }}>
        <Text accessibilityRole="header" style={[t.title1, { color: p.ink, textAlign: "center" }]} numberOfLines={2}>
          {name ?? "Your settings"}
        </Text>
        <Text style={[type.footnote, { color: p.ink3 }]}>{profile?.email ?? auth.user?.email ?? ""}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <RowAction label={profile?.avatarKey ? "Change photo" : "Add a photo"} onPress={change} busy={busy === "upload"} />
        {profile?.avatarKey ? <RowAction label="Remove" tone="quiet" onPress={remove} busy={busy === "remove"} accessibilityLabel="Remove your photo" /> : null}
      </View>
      <ErrorLine>{error}</ErrorLine>
    </View>
  );
}

/** The name they go by, saved when they leave the field or press return. */
export function NameField() {
  const p = usePalette();
  const { profile, saveName } = useProfile();
  const [value, setValue] = useState(profile?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const stored = profile?.name ?? "";

  // The profile arrives a moment after the page; follow it until the person starts typing.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setValue(stored);
  }, [stored, touched]);

  const save = async () => {
    const next = value.replace(/\s+/g, " ").trim();
    if (next === stored) return;
    if (next.length > NAME_MAX) return setError(`Keep it under ${NAME_MAX} characters.`);
    setError(null);
    try {
      await saveName(next);
      setTouched(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your name. Try again.");
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Field
        label="Your name"
        value={value}
        onChangeText={(v) => {
          setTouched(true);
          setValue(v);
          if (error) setError(null);
        }}
        onBlur={() => void save()}
        onSubmitEditing={() => void save()}
        placeholder="What should we call you?"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={NAME_MAX + 10}
        returnKeyType="done"
        error={error}
        submitted={!!error}
      />
      {saved ? <Text style={[type.footnote, { color: p.ink3 }]}>Saved</Text> : null}
    </View>
  );
}
