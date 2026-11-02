import { useLayoutEffect, useRef, useState } from "react";
import type { NativeSyntheticEvent, TextInput, TextInputKeyPressEventData, TextStyle } from "react-native";

/**
 * A short answer that grows into lines as it gets longer, instead of scrolling sideways and hiding its start (owner,
 * 2026-11-02: "Text over a single line should expand the box, not just move to the second line ... not showing what's
 * on the first line"). The wish field's way (components/wish-field.tsx): Return still submits and never adds a line;
 * the web sizes the box from its words, and a phone sizes a multiline field itself between `min` and `max` (feeding the
 * content size back into a fixed height made iOS jump, build 14). Past `max` it scrolls inside itself. `min` and `max`
 * are the whole box: the words' lines, the padding and any border.
 */

/** The parts of a web textarea the measuring reads. */
export type Measured = { style: { height: string }; scrollHeight: number; offsetHeight: number; clientHeight: number };

/**
 * The height a web textarea needs for its words, between `min` and `max`. A textarea never reports shrinking, so it is
 * measured at zero height (the composer's way, components/inputs/composer.tsx), and its border is added back: the box
 * counts it and scrollHeight does not, and a box a pixel short drew a scrollbar on Windows.
 */
export function measure(el: Measured, min: number, max: number): number {
  const was = el.style.height;
  el.style.height = "0px";
  const content = el.scrollHeight + el.offsetHeight - el.clientHeight;
  el.style.height = was;
  return Math.min(max, Math.max(min, Math.ceil(content)));
}

/** Return sends; the Return that confirms a word an input method is still composing does not. */
export function sends(key: { key: string; isComposing?: boolean; keyCode?: number }): boolean {
  return key.key === "Enter" && !key.isComposing && key.keyCode !== 229;
}

export function growProps({ web, min, max, height, onSubmit }: { web: boolean; min: number; max: number; height: number; onSubmit(): void }) {
  // Below its cap the web box fits its words exactly, so it never shows a scrollbar; at the cap it scrolls.
  const style: TextStyle = web ? { height, textAlignVertical: "top", ...(height < max ? { overflow: "hidden" as const } : null) } : { minHeight: min, maxHeight: max, textAlignVertical: "top" };
  return {
    multiline: true,
    submitBehavior: "blurAndSubmit" as const,
    onSubmitEditing: onSubmit,
    onKeyPress: web
      ? (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
          if (!sends(e.nativeEvent as unknown as { key: string; isComposing?: boolean; keyCode?: number })) return;
          e.preventDefault();
          onSubmit();
        }
      : undefined,
    scrollEnabled: web ? height >= max : true,
    style,
  };
}

/**
 * growProps for one input, with the `ref` to put on it: `min` its one-line height, `max` the most it grows before
 * scrolling; `web` is Platform.OS === "web". The web box is measured after every render, so it follows the words both
 * ways and a field that closes and opens again starts from its own words, not the height it last had.
 */
export function useGrow(min: number, max: number, onSubmit: () => void, web: boolean) {
  const [height, setHeight] = useState(min);
  const ref = useRef<TextInput>(null);
  useLayoutEffect(() => {
    const el = ref.current as unknown as Measured | null;
    if (web && el?.style) setHeight(measure(el, min, max));
  });
  return { ...growProps({ web, min, max, height, onSubmit }), ref };
}
