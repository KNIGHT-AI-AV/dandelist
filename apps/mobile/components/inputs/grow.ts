import { useState } from "react";
import type { NativeSyntheticEvent, TextInputContentSizeChangeEventData, TextInputKeyPressEventData, TextStyle } from "react-native";

/**
 * A short answer that grows into lines as it gets longer, instead of scrolling sideways and hiding its start (owner,
 * 2026-11-02: "Text over a single line should expand the box, not just move to the second line ... not showing what's
 * on the first line"). The wish field's way (components/wish-field.tsx): Return still submits and never adds a line;
 * the web sizes the box from its words, and a phone sizes a multiline field itself between `min` and `max` (feeding the
 * content size back into a fixed height made iOS jump, build 14). Past `max` it scrolls inside itself.
 */
export function growProps({ web, min, max, height, onSubmit, setHeight }: { web: boolean; min: number; max: number; height: number; onSubmit(): void; setHeight(h: number): void }) {
  const style: TextStyle = web ? { height, textAlignVertical: "top" } : { minHeight: min, maxHeight: max, textAlignVertical: "top" };
  return {
    multiline: true,
    submitBehavior: "blurAndSubmit" as const,
    onSubmitEditing: onSubmit,
    onKeyPress: web
      ? (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
          if (e.nativeEvent.key !== "Enter") return;
          e.preventDefault();
          onSubmit();
        }
      : undefined,
    onContentSizeChange: web ? (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => setHeight(Math.min(max, Math.max(min, e.nativeEvent.contentSize.height))) : undefined,
    scrollEnabled: web ? height >= max : true,
    style,
  };
}

/** growProps for one input: `min` its one-line height, `max` the most it grows before scrolling; `web` is Platform.OS === "web". */
export function useGrow(min: number, max: number, onSubmit: () => void, web: boolean) {
  const [height, setHeight] = useState(min);
  return growProps({ web, min, max, height, onSubmit, setHeight });
}
