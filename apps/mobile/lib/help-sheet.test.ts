import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askForHelp, closeHelp, currentSheet, keptLines, noteLine, sendSheet, setHelpOwner } from "./help-sheet";

const gate = <T>() => {
  let open!: (v: T) => void;
  const shut = new Promise<T>((r) => (open = r));
  return { shut, open };
};
/** The sign-in generation as lib/auth.tsx keeps it: it moves the moment another account's bearer is in place. */
let generation = 1;
const signIn = () => generation;

describe("help belongs to the sign-in that made it (review of #140, H2)", () => {
  beforeEach(() => {
    generation = 1;
    setHelpOwner(null);
    setHelpOwner("ada:1");
  });
  afterEach(() => setHelpOwner(null));

  it("drops a picture that comes back after someone else signs in", async () => {
    const shot = gate<string | null>();
    const asking = askForHelp(() => shot.shut, signIn);
    setHelpOwner(null);
    setHelpOwner("bob:1");
    shot.open("ADA-SCREEN");
    await asking;
    expect(currentSheet()).toBeNull();
  });

  it("drops it too when the same person signs out and back in", async () => {
    const shot = gate<string | null>();
    const asking = askForHelp(() => shot.shut, signIn);
    setHelpOwner(null);
    setHelpOwner("ada:2");
    shot.open("ADA-SCREEN");
    await asking;
    expect(currentSheet()).toBeNull();
  });

  it("drops a picture taken while another bearer came in, before the app's owner moved", async () => {
    const shot = gate<string | null>();
    const asking = askForHelp(() => shot.shut, signIn);
    generation = 2;
    shot.open("ADA-SCREEN");
    await asking;
    expect(currentSheet()).toBeNull();
  });

  it("opens on the picture for the same sign-in, keeping its generation (control)", async () => {
    await askForHelp(async () => "ADA-SCREEN", signIn);
    expect(currentSheet()).toMatchObject({ owner: "ada:1", signIn: 1, shot: "ADA-SCREEN", phase: "ready", code: null });
  });

  it("clears the open sheet and the kept lines on every change", async () => {
    noteLine("error", "the Leica Q3 card broke");
    await askForHelp(async () => "ADA-SCREEN", signIn);
    setHelpOwner(null);
    expect(currentSheet()).toBeNull();
    expect(keptLines()).toEqual([]);
  });

  it("sends nothing for a sheet made under an earlier sign-in, even before the app's owner moved", async () => {
    await askForHelp(async () => "ADA-SCREEN", signIn);
    generation = 2;
    let sent = 0;
    expect(await sendSheet(async () => (sent++, { code: "BOB001" }), signIn)).toBe("dropped");
    expect(sent).toBe(0);
    expect(currentSheet()!.phase).toBe("ready");
  });

  it("drops an answer that comes back after the sign-in moved, before the app's owner did", async () => {
    await askForHelp(async () => "ONE", signIn);
    const reply = gate<{ code: string }>();
    const sending = sendSheet(() => reply.shut, signIn);
    generation = 2;
    reply.open({ code: "LATE00" });
    expect(await sending).toBe("dropped");
    expect(currentSheet()).toMatchObject({ phase: "sending", code: null });
  });

  it("lets an answer land only on its own sheet: Cancel, a new sheet, then the old answer", async () => {
    await askForHelp(async () => "ONE", signIn);
    const reply = gate<{ code: string }>();
    const first = sendSheet(() => reply.shut, signIn);
    expect(currentSheet()!.phase).toBe("sending");
    closeHelp(currentSheet()!.id);
    await askForHelp(async () => "TWO", signIn);
    reply.open({ code: "OLD123" });
    expect(await first).toBe("dropped");
    expect(currentSheet()).toMatchObject({ shot: "TWO", phase: "ready", code: null });
    // The new sheet's own answer lands (control).
    expect(await sendSheet(async () => ({ code: "NEW456" }), signIn)).toBe("sent");
    expect(currentSheet()).toMatchObject({ shot: "TWO", phase: "sent", code: "NEW456" });
  });

  it("drops an answer that comes back after a sign-out, having sent with its own sheet's key", async () => {
    await askForHelp(async () => "ONE", signIn);
    const id = currentSheet()!.id;
    const reply = gate<{ code: string }>();
    let key = "";
    const sending = sendSheet((s) => ((key = s.id), reply.shut), signIn);
    setHelpOwner(null);
    setHelpOwner("ada:2");
    reply.open({ code: "LATE01" });
    expect(await sending).toBe("dropped");
    expect(key).toBe(id);
    expect(currentSheet()).toBeNull();
  });

  it("keeps a sheet whose send failed for another try, with the same key", async () => {
    await askForHelp(async () => "ONE", signIn);
    const id = currentSheet()!.id;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const failed = await sendSheet(async () => {
      throw new Error("Couldn't send it. Try again.");
    }, signIn);
    expect(failed).toBe("failed");
    expect(currentSheet()).toMatchObject({ id, phase: "ready", error: "Couldn't send it. Try again." });
    let key = "";
    expect(await sendSheet(async (s) => ((key = s.id), { code: "ABC123" }), signIn)).toBe("sent");
    expect(key).toBe(id);
  });

  it("takes one picture at a time, and opens without one when none can be taken", async () => {
    const shot = gate<string | null>();
    let takes = 0;
    const take = () => (takes++, shot.shut);
    const a = askForHelp(take, signIn);
    const b = askForHelp(take, signIn);
    shot.open("ONE");
    await Promise.all([a, b]);
    expect(takes).toBe(1);
    await askForHelp(async () => {
      throw new Error("capture failed");
    }, signIn);
    expect(currentSheet()).toMatchObject({ shot: null, phase: "ready" });
  });
});

describe("log lines are kept without anything shaped like a credential (review of #140, H2)", () => {
  beforeEach(() => {
    setHelpOwner(null);
    setHelpOwner("ada:1");
  });
  afterEach(() => setHelpOwner(null));

  it("cuts tickets, tokens, keys, passwords and codes before a line is kept", () => {
    noteLine("error", "GET https://dandelist.knightaiav.com/auth/callback?ticket=SYNTHETIC-TICKET-1#state=SYNTHETIC-STATE failed");
    noteLine("warn", "Authorization: Bearer SYNTHETIC-BEARER-2");
    noteLine("error", '{"accessToken":"SYNTHETIC-ACCESS-3","refresh_token":"SYNTHETIC-REFRESH-4","code":"SYNTHETIC-CODE-5"}');
    noteLine("error", "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SYNTHETICsignature0 rejected");
    noteLine("warn", "key sk_test_SYNTHETIC0123456789abcdefghijklmnopqrstuv in use");
    noteLine("error", "x-api-key=SYNTHETIC-APIKEY-6; password: SYNTHETIC-PASS-7; Basic U1lOVEhFVElDOnBhc3N3b3JkOA==");
    expect(keptLines().map((l) => l.text).join("\n")).not.toMatch(/SYNTHETIC|U1lOVEhFVElD/);
    expect(keptLines()[0]!.text).toBe("GET https://dandelist.knightaiav.com/auth/callback failed");
    // What helps find a bug stays (control).
    const plain = "TypeError: Cannot read properties of undefined (reading 'price') at WishCard, statusCode: 500";
    noteLine("error", plain);
    expect(keptLines().at(-1)!.text).toBe(plain);
  });

  it("keeps the last 40 lines, each at most 600 characters", () => {
    for (let i = 0; i < 45; i++) noteLine("warn", `line ${i} ${"word ".repeat(200)}`);
    const kept = keptLines();
    expect(kept).toHaveLength(40);
    expect(kept[0]!.text.startsWith("line 5 ")).toBe(true);
    expect(Math.max(...kept.map((l) => l.text.length))).toBe(600);
  });
});
