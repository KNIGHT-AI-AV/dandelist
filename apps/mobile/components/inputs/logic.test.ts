import { describe, expect, it } from "vitest";
import { CODE_LENGTH, MONEY_MAX_CENTS, centsToRaw, displayCaret, echoes, editMoney, isEmail, moneyText, nextCode, rawToCents, sanitizeCode } from "./logic";

/** Types `ch` into `text` with the caret at `at`, as the native input would report it. */
const typeAt = (text: string, at: number, ch: string) => editMoney(text, text.slice(0, at) + ch + text.slice(at), { start: at, end: at });
/** Backspace with the caret at `at`. */
const backspaceAt = (text: string, at: number) => editMoney(text, text.slice(0, at - 1) + text.slice(at), { start: at, end: at });
/** Types a whole string one key at a time at the end. */
const typeAll = (keys: string) => [...keys].reduce((text, k) => typeAt(text, text.length, k).text, "");

describe("code sanitising", () => {
  it("keeps digits only and caps at six", () => {
    expect(CODE_LENGTH).toBe(6);
    expect(sanitizeCode("12a3-4 5")).toBe("12345");
    expect(sanitizeCode("123456789")).toBe("123456");
    expect(sanitizeCode("")).toBe("");
  });

  it("reads full-width and Arabic-Indic digits", () => {
    expect(sanitizeCode("１２３４５６")).toBe("123456");
    expect(sanitizeCode("١٢٣٤٥٦")).toBe("123456");
    expect(sanitizeCode("۱۲۳")).toBe("123");
  });

  it("finds the code inside a pasted sentence instead of the first six digits", () => {
    expect(nextCode("", "On 2026-10-28 your code is 482913.")).toBe("482913");
    expect(nextCode("", "482 913")).toBe("482913");
  });

  it("lets a pasted or autofilled code replace digits already typed", () => {
    expect(nextCode("12", "12482913")).toBe("482913");
    expect(nextCode("12", "12Your code: 482913")).toBe("482913");
  });

  it("appends one typed digit and refuses a seventh", () => {
    expect(nextCode("12", "123")).toBe("123");
    expect(nextCode("123456", "1234567")).toBe("123456");
    expect(nextCode("123", "12")).toBe("12");
  });
});

describe("money formatting and parsing", () => {
  it("groups thousands and keeps decimals as typed", () => {
    expect(moneyText("")).toBe("");
    expect(moneyText("12500")).toBe("$12,500");
    expect(moneyText("1250000.5")).toBe("$1,250,000.5");
    expect(moneyText("12.")).toBe("$12.");
    expect(moneyText("0.99")).toBe("$0.99");
  });

  it("converts between raw text and cents", () => {
    expect(rawToCents("")).toBeNull();
    expect(rawToCents("12.")).toBe(1200);
    expect(rawToCents("0.29")).toBe(29);
    expect(rawToCents("999999999.99")).toBe(MONEY_MAX_CENTS);
    expect(centsToRaw(250000)).toBe("2500");
    expect(centsToRaw(2999)).toBe("29.99");
    expect(centsToRaw(null)).toBe("");
    expect(centsToRaw(-5)).toBe("");
  });

  it("formats live as you type", () => {
    expect(typeAll("12500")).toBe("$12,500");
    expect(typeAll("29.99")).toBe("$29.99");
    expect(typeAll("1234567")).toBe("$1,234,567");
  });

  it("takes digits only and never a minus", () => {
    expect(typeAll("-12a")).toBe("$12");
    expect(typeAt("", 0, "-").text).toBe("");
  });

  it("drops leading zeros and a second point, and stops at two decimals", () => {
    expect(typeAll("007")).toBe("$7");
    expect(typeAll(".5")).toBe("$0.5");
    expect(typeAll("1.2.3")).toBe("$1.23");
    expect(typeAll("4.999")).toBe("$4.99");
  });

  it("reads a comma typed on a European keypad as the point", () => {
    expect(typeAll("12,5")).toBe("$12.5");
  });

  it("reads pasted amounts in either convention", () => {
    expect(editMoney("", "$12,500.00").text).toBe("$12,500.00");
    expect(editMoney("", "12,500").text).toBe("$12,500");
    expect(editMoney("", "12,50").text).toBe("$12.50");
    expect(editMoney("", "1.250,50").text).toBe("$1,250.50");
    expect(editMoney("", "USD 3 000").cents).toBe(300000);
  });

  it("refuses amounts over the cap and keeps the previous text", () => {
    const max = "$999,999,999";
    const r = typeAt(max, max.length, "9");
    expect(r.over).toBe(true);
    expect(r.text).toBe(max);
    expect(r.caret).toBe(max.length);
    expect(typeAll("999999999.99")).toBe("$999,999,999.99");
    expect(editMoney("", "5000000000").over).toBe(true);
    expect(editMoney("$10", "$100", undefined, 50_000).over).toBe(false);
    expect(editMoney("$100", "$1000", undefined, 50_000).over).toBe(true);
  });
});

describe("money caret maths", () => {
  it("keeps the caret after a digit typed in the middle", () => {
    // "$1,|250" + "9" → "$19,250" with the caret after the 9: "$19|,250".
    const r = typeAt("$1,250", 3, "9");
    expect(r.text).toBe("$19,250");
    expect(r.caret).toBe(3);
  });

  it("tells repeated digits apart using the selection", () => {
    // "$1,0|00" + "0": plain diffing would put the caret at the end.
    const r = typeAt("$1,000", 4, "0");
    expect(r.text).toBe("$10,000");
    expect(r.caret).toBe(5);
  });

  it("puts the caret at the end after typing at the end", () => {
    const r = typeAt("$1,250", 6, "0");
    expect(r.text).toBe("$12,500");
    expect(r.caret).toBe(r.text.length);
  });

  it("deletes the digit before a comma when backspacing over the comma", () => {
    // "$12,|500" backspace removes the "2", not just the comma.
    const r = backspaceAt("$12,500", 4);
    expect(r.text).toBe("$1,500");
    expect(r.caret).toBe(2);
  });

  it("keeps the caret in place when a deletion regroups the number", () => {
    // "$1,25|0,000" backspace removes the 5 → "$120,000", the caret after the 2: "$12|0,000".
    const r = backspaceAt("$1,250,000", 5);
    expect(r.text).toBe("$120,000");
    expect(r.caret).toBe(3);
  });

  it("empties to nothing so the placeholder shows", () => {
    const r = backspaceAt("$5", 2);
    expect(r.text).toBe("");
    expect(r.cents).toBeNull();
    expect(r.caret).toBe(0);
  });

  it("maps raw positions to display positions", () => {
    expect(displayCaret("$12,500", 0)).toBe(1);
    expect(displayCaret("$12,500", 2)).toBe(3);
    expect(displayCaret("$12,500", 3)).toBe(5);
    expect(displayCaret("$12,500", 5)).toBe(7);
    expect(displayCaret("", 3)).toBe(0);
  });

  it("falls back to diffing when no selection is known", () => {
    const r = editMoney("$1,250", "$1,2500");
    expect(r.text).toBe("$12,500");
    expect(r.caret).toBe(7);
  });
});

describe("email check", () => {
  it("accepts whole addresses and refuses partial ones", () => {
    expect(isEmail("you@example.com")).toBe(true);
    expect(isEmail("  you@mail.example.co.uk ")).toBe(true);
    expect(isEmail("you@example")).toBe(false);
    expect(isEmail("you@example.c")).toBe(false);
    expect(isEmail("you example@x.com")).toBe(false);
    expect(isEmail("@example.com")).toBe(false);
  });
});

describe("the composer's sent-text echo", () => {
  // iOS can hand the sent words back after the field was cleared (owner, 2026-10-31: the Rolex rode along with the DB11).
  it("knows the sent text coming back, even with one word autocorrected", () => {
    expect(echoes("Rolex day date 40 green ombré Roman", "Rolex day date 40 green ombré Roman")).toBe(true);
    expect(echoes("rolex day date 40 green ombré roman ", "Rolex day date 40 green ombré Roman")).toBe(true);
    expect(echoes("Rolex day date 40 green ombré Romano", "Rolex day date 40 green ombré Roman")).toBe(true);
  });

  it("never takes new typing for an echo", () => {
    expect(echoes("A", "Rolex day date 40 green ombré Roman")).toBe(false);
    expect(echoes("Aston Martin DB 11", "Rolex day date 40 green ombré Roman")).toBe(false);
    expect(echoes("Rolex day date 40 green ombré Roman\nAston Martin DB 11", "Rolex day date 40 green ombré Roman")).toBe(false);
    expect(echoes("", "Rolex")).toBe(false);
  });
});
