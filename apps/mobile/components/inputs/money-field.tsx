import { forwardRef, useEffect, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { haptic } from "../../lib/motion";
import { Field, type FieldProps } from "./field";
import { MONEY_MAX_CENTS, centsToRaw, editMoney, moneyText, textCents, type Selection } from "./logic";

/** The refusal shown when an amount passes the default cap. */
const OVER = "Keep it under $1 billion.";

export interface MoneyFieldProps extends Omit<FieldProps, "value" | "defaultValue" | "onChangeText" | "keyboardType" | "inputMode" | "selection"> {
  /** The amount in cents, or null while the field is empty. */
  cents: number | null;
  onChangeCents(cents: number | null): void;
  /** The largest amount accepted, in cents (default $999,999,999.99). */
  maxCents?: number;
  /** The plain sentence shown when a keystroke would pass `maxCents`. */
  overMessage?: string;
}

/**
 * A dollar amount. Digits only, grouped as you type ("$12,500"), up to two decimals, never negative. The caret
 * stays after the digit you typed, even mid-number. A keystroke that would pass the cap is refused with a plain
 * message under the field and the error haptic.
 */
export const MoneyField = forwardRef<TextInput, MoneyFieldProps>(function MoneyField(
  { cents, onChangeCents, maxCents = MONEY_MAX_CENTS, overMessage = OVER, error, submitted, onSelectionChange, placeholder = "$0", ...props },
  ref,
) {
  const [text, setText] = useState(() => moneyText(centsToRaw(cents)));
  const [selection, setSelection] = useState<Selection | undefined>();
  const [over, setOver] = useState(false);
  /** The selection before the next edit, which says where a repeated digit went. */
  const before = useRef<Selection | undefined>(undefined);

  // Follow the amount when it changes from outside: a stored value loads, or a form resets.
  useEffect(() => {
    if (cents !== textCents(text)) setText(moneyText(centsToRaw(cents)));
    // Only an outside change of `cents` should rewrite the text; typing already keeps them in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);

  // The caret is placed in the same render as the regrouped text, then released so taps move it freely again.
  useEffect(() => {
    if (!selection) return;
    const id = requestAnimationFrame(() => setSelection(undefined));
    return () => cancelAnimationFrame(id);
  }, [selection]);

  return (
    <Field
      ref={ref}
      {...props}
      value={text}
      selection={selection}
      placeholder={placeholder}
      keyboardType="decimal-pad"
      inputMode="decimal"
      autoComplete="off"
      textContentType="none"
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      error={over ? overMessage : error}
      submitted={submitted || over}
      onSelectionChange={(e) => {
        before.current = e.nativeEvent.selection;
        onSelectionChange?.(e);
      }}
      onChangeText={(next) => {
        const r = editMoney(text, next, before.current, maxCents);
        if (r.over && !over) haptic.error();
        setOver(r.over);
        setText(r.text);
        // A new object even when the caret didn't move, so a refused keystroke re-renders and the input snaps back.
        setSelection({ start: r.caret, end: r.caret });
        before.current = { start: r.caret, end: r.caret };
        if (!r.over && r.cents !== cents) onChangeCents(r.cents);
      }}
    />
  );
});
