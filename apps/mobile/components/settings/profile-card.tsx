import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
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
  const [busy, setBusy] = useState<"pick" | "upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // One operation owns the picker, upload or removal, including its local web preview.
  const operation = useRef<{ previewUrl: string | null } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const pending = operation.current;
      operation.current = null;
      if (pending?.previewUrl) {
        const url = pending.previewUrl;
        pending.previewUrl = null;
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const change = async () => {
    if (!mounted.current || operation.current) return;
    const token: { previewUrl: string | null } = { previewUrl: null };
    operation.current = token;
    setBusy("pick");
    setError(null);
    try {
      const image = await pickAvatarImage();
      // Only the web picker creates an object URL owned by this operation; native and remote URIs stay intact.
      token.previewUrl = Platform.OS === "web" && image?.preview?.startsWith("blob:") ? image.preview : null;
      if (operation.current !== token) return;
      if (!image) return;
      setPreview(image.preview ?? null);
      setBusy("upload");
      await uploadAvatar(image);
      if (operation.current === token) haptic.success();
    } catch (e) {
      if (operation.current === token) {
        haptic.error();
        setError(e instanceof Error ? e.message : "Couldn't save that photo. Try another.");
      }
    } finally {
      if (token.previewUrl) {
        const url = token.previewUrl;
        token.previewUrl = null;
        URL.revokeObjectURL(url);
      }
      if (operation.current === token) {
        operation.current = null;
        setPreview(null);
        setBusy(null);
      }
    }
  };
  const remove = async () => {
    if (!mounted.current || operation.current) return;
    const token = { previewUrl: null };
    operation.current = token;
    setError(null);
    setBusy("remove");
    try {
      await removeAvatar();
    } catch (e) {
      if (operation.current === token) setError(e instanceof Error ? e.message : "Couldn't remove the photo. Try again.");
    } finally {
      if (operation.current === token) {
        operation.current = null;
        setBusy(null);
      }
    }
  };

  const blocked = busy !== null;
  const name = profile?.name ?? null;
  return (
    <View style={{ alignItems: "center", gap: layout.stack.base }}>
      <Pressable accessibilityRole="button" accessibilityLabel={profile?.avatarKey ? "Change your photo" : "Add a photo"} accessibilityState={{ disabled: blocked, busy: busy === "pick" || busy === "upload" }} disabled={blocked} onPress={blocked ? undefined : change} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
        <Animated.View style={{ transform: [{ scale: press.scale }] }}>
          <ProfileAvatar size={AVATAR} preview={preview} />
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
        <RowAction label={profile?.avatarKey ? "Change photo" : "Add a photo"} onPress={change} busy={busy === "pick" || busy === "upload"} disabled={blocked} />
        {profile?.avatarKey ? <RowAction label="Remove" tone="quiet" onPress={remove} busy={busy === "remove"} disabled={blocked} accessibilityLabel="Remove your photo" /> : null}
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
