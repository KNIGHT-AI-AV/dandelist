import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Text, TextInput, View } from "react-native";
import { useDandy } from "../../lib/dandy";
import { layout, radius, type, usePalette } from "../../lib/theme";
import { useWishes, type Wish } from "../../lib/wishes";
import { Ring, caretColors, useToggle, webInput } from "../inputs/field";
import { ErrorLine, Eyebrow, Glass, QuietButton } from "../lux";

/** The API's limit (apps/api/src/notes.ts). */
export const NOTE_MAX = 600;
/** The count shows from here, so the limit never surprises anyone. */
const COUNT_FROM = 500;
/** A pause in typing this long saves. */
const SAVE_AFTER_MS = 800;
/** Four lines to start; the field grows to about eight, then scrolls inside itself. */
const NOTE_MIN = 4 * (type.body.lineHeight ?? 23) + 2 * 14;
const NOTE_MAX_HEIGHT = 8 * (type.body.lineHeight ?? 23) + 2 * 14;

/** What goes to the server for what's typed: the words, or null for nothing. */
export const noteValue = (text: string): string | null => (text.trim() ? text : null);

/**
 * Why it matters to you (owner, 2026-10-29: "users can click items and write notes to explain more details of why they
 * like this item and what it means to them"). Saved a moment after typing stops and when the page closes; only they
 * see it, and their Dandy keeps it in mind when it plans for them. `onReveal(dy)` scrolls the page by `dy` so the
 * field stays above the keyboard.
 */
export function WishNote({ wish, onReveal }: { wish: Wish; onReveal?: (dy: number) => void }) {
  const p = usePalette();
  const dandy = useDandy();
  const store = useWishes();
  const setNote = useRef(store.setNote);
  setNote.current = store.setNote;
  const [text, setText] = useState(wish.note ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(NOTE_MIN);
  const focus = useToggle(focused);
  const box = useRef<View>(null);
  const latest = useRef(text);
  const saved = useRef(noteValue(wish.note ?? ""));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves run one after another, so an older answer can never land after a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);

  const save = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    queue.current = queue.current.then(async () => {
      const value = noteValue(latest.current);
      if (value === saved.current) return;
      if (alive.current) setState("saving");
      try {
        await setNote.current(wish.id, value);
        saved.current = value;
        if (alive.current) setState(noteValue(latest.current) === value ? "saved" : "idle");
      } catch {
        if (alive.current) setState("error");
      }
    });
  };

  const onChange = (t: string) => {
    const next = t.slice(0, NOTE_MAX);
    setText(next);
    latest.current = next;
    setState((s) => (s === "saving" ? s : "idle"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_AFTER_MS);
  };

  // Leaving the page keeps what was typed.
  useEffect(
    () => () => {
      alive.current = false;
      if (timer.current) save();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  const left = NOTE_MAX - text.length;
  const status = state === "saving" ? "Saving..." : state === "saved" ? "Saved" : null;
  return (
    <View ref={box} collapsable={false} style={{ gap: layout.stack.tight }}>
      <Eyebrow>Why it matters to you</Eyebrow>
      <View>
        <Glass style={{ borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: p.line }}>
          <TextInput
            accessibilityLabel="Why it matters to you"
            accessibilityHint={`Saved as you type. Only you see it, and ${dandy.name} keeps it in mind.`}
            value={text}
            onChangeText={onChange}
            maxLength={NOTE_MAX}
            multiline
            placeholder="What it means to you, why you want it"
            placeholderTextColor={p.ink3}
            autoCapitalize="sentences"
            autoCorrect
            spellCheck
            {...caretColors(p)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              save();
            }}
            // The web sizes the box from its content; phones grow a multiline field themselves between the bounds.
            onContentSizeChange={Platform.OS === "web" ? (e) => setHeight(Math.min(NOTE_MAX_HEIGHT, Math.max(NOTE_MIN, e.nativeEvent.contentSize.height))) : undefined}
            style={[
              type.body,
              { color: p.ink, paddingHorizontal: layout.stack.base, paddingTop: 14, paddingBottom: 14, textAlignVertical: "top" },
              Platform.OS === "web" ? { height } : { minHeight: NOTE_MIN, maxHeight: NOTE_MAX_HEIGHT },
              webInput(p),
            ]}
          />
        </Glass>
        <Ring color={p.ink} opacity={focus} />
      </View>
      {state === "error" ? (
        <View style={{ alignItems: "flex-start" }}>
          <ErrorLine>Your note isn't saved yet. Check your connection.</ErrorLine>
          <QuietButton label="Try again" onPress={save} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: layout.stack.base }}>
          <Text style={[type.footnote, { color: p.ink3, flexShrink: 1 }]}>{`Only you see this. ${dandy.name} keeps it in mind when finding things for you.`}</Text>
          <Text accessibilityLiveRegion="polite" style={[type.footnote, { color: p.ink3 }]}>
            {text.length >= COUNT_FROM ? `${left} left` : (status ?? "")}
          </Text>
        </View>
      )}
    </View>
  );
}
