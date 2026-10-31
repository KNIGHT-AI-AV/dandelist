import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Text, TextInput, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { useMoney } from "../../lib/currency";
import { useDandy } from "../../lib/dandy";
import { adoptAmend, amendWish, dismissRecheck, useRechecks } from "../../lib/rechecks";
import { layout, radius, space, type, usePalette } from "../../lib/theme";
import { useWishes, type Wish } from "../../lib/wishes";
import { hostOf } from "../../lib/words";
import { Ring, caretColors, useToggle, webInput } from "../inputs/field";
import { ErrorLine, Eyebrow, Glass, QuietButton } from "../lux";

/** The longest description the reading takes in one go, with the wish's name before it. */
const SAID_MAX = 300;

/**
 * Tell the Dandy what you meant (owner, 2026-10-31: "clicking item that you already added and amend it someway by
 * adding more context of what you wanted instead"). The wish is hunted again with the person's words beside its name;
 * what comes back waits here and in the Dandy's corner, to use in place of the saved find or not. `onReveal(dy)`
 * scrolls the page by `dy` so the field stays above the keyboard.
 */
export function AmendWish({ wish, autoFocus = false, onReveal }: { wish: Wish; autoFocus?: boolean; onReveal?: (dy: number) => void }) {
  const p = usePalette();
  const dandy = useDandy();
  const money = useMoney();
  const { api } = useAuth();
  const { reload } = useWishes();
  // Only a look the person started with their own words shows here; a plain price check stays in the Dandy's corner.
  const r = useRechecks().find((c) => c.wishId === wish.id && c.said);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focus = useToggle(focused);
  const box = useRef<View>(null);

  // On a phone the keyboard rises over the lower half: once it is up, the page scrolls the field into sight.
  useEffect(() => {
    if (!focused || Platform.OS === "web") return;
    const sub = Keyboard.addListener("keyboardDidShow", (e) => {
      box.current?.measureInWindow((_x, y, _w, h) => {
        const dy = y + h + layout.stack.base - e.endCoordinates.screenY;
        if (dy > 0) onReveal?.(dy);
      });
    });
    return () => sub.remove();
  }, [focused, onReveal]);

  const look = () => {
    const words = text.trim();
    if (!words) return;
    Keyboard.dismiss();
    setText("");
    setError(null);
    void amendWish(api, wish, words);
  };
  // Both answers belong to this look (r.attempt); neither works while its result is being saved.
  const saving = busy || !!r?.saving;
  const use = async () => {
    if (saving || !r) return;
    setBusy(true);
    setError(null);
    try {
      await adoptAmend(api, wish, reload, r.attempt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const o = r?.outcome;
  return (
    <View ref={box} collapsable={false} style={{ gap: layout.stack.tight }}>
      <Eyebrow>{`Tell ${dandy.name} what you meant`}</Eyebrow>
      {o?.kind === "running" ? (
        <Text accessibilityLiveRegion="polite" style={[type.callout, { color: p.ink2 }]}>{`Looking again for "${r!.said}"...`}</Text>
      ) : o?.kind === "amended" ? (
        <View style={{ gap: space[8] }}>
          <Text accessibilityLiveRegion="polite" style={[type.callout, { color: p.ink }]}>
            {`${o.name}: `}
            <Text style={{ color: p.accentText }}>{money.format(o.option.upfrontCents)}</Text>
            {` at ${hostOf(o.option.url) || "the seller"}.`}
          </Text>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[8] }}>
            <QuietButton label={saving ? "Saving..." : "Use it"} onPress={() => void use()} />
            <QuietButton label="Keep the one I had" onPress={() => void (saving || dismissRecheck(wish.id, r!.attempt))} />
          </View>
        </View>
      ) : (
        <>
          {o?.kind === "failed" ? <ErrorLine>{o.message}</ErrorLine> : null}
          <View>
            <Glass style={{ borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: p.line }}>
              <TextInput
                accessibilityLabel={`Tell ${dandy.name} what you meant`}
                value={text}
                onChangeText={(t) => setText(t.slice(0, SAID_MAX))}
                maxLength={SAID_MAX}
                placeholder="The black dial, the newer model, another size"
                placeholderTextColor={p.ink3}
                autoCapitalize="sentences"
                autoCorrect
                autoFocus={autoFocus}
                returnKeyType="search"
                onSubmitEditing={look}
                {...caretColors(p)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={[type.body, { color: p.ink, paddingHorizontal: layout.stack.base, paddingVertical: 14 }, webInput(p)]}
              />
            </Glass>
            <Ring color={p.ink} opacity={focus} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: layout.stack.base }}>
            <Text style={[type.footnote, { color: p.ink3, flexShrink: 1 }]}>{`${dandy.name} hunts it again with your words, and you choose whether to use what it finds.`}</Text>
            <QuietButton label="Look again" onPress={look} />
          </View>
        </>
      )}
    </View>
  );
}
