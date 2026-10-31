import { describe, expect, it } from "vitest";
import { bareUrl, privatePath, scrub } from "./analytics-scrub";

// A made-up ticket: never a real one.
const TICKET = "https://dandelist.knightaiav.com/auth/callback?ticket=SYNTHETIC-TICKET-123#state=abc";

describe("what the web build sends PostHog (review of #139)", () => {
  it("sends nothing at all from a sign-in page", () => {
    expect(privatePath("/auth/callback")).toBe(true);
    expect(privatePath("/auth")).toBe(true);
    expect(privatePath("/author")).toBe(false);
    expect(scrub({ event: "$pageview", properties: { $pathname: "/auth/callback", $current_url: TICKET } })).toBeNull();
    expect(scrub({ event: "$snapshot", properties: { $pathname: "/auth/callback", $snapshot_data: [] } })).toBeNull();
  });

  it("cuts every address to its path elsewhere, the person's own properties and replays included", () => {
    const event = {
      event: "$autocapture",
      properties: {
        $pathname: "/",
        $current_url: "https://dandelist.knightaiav.com/?ticket=SYNTHETIC-TICKET-123#x",
        $referrer: TICKET,
        $set: { $current_url: TICKET },
        $snapshot_data: [{ type: 4, data: { href: TICKET, width: 390 } }, { type: 2, data: {} }],
      },
    };
    const out = scrub(event)!;
    expect(JSON.stringify(out)).not.toContain("SYNTHETIC-TICKET-123");
    expect(out.properties.$current_url).toBe("https://dandelist.knightaiav.com/");
    expect(out.properties.$referrer).toBe("https://dandelist.knightaiav.com/auth/callback");
    expect((out.properties.$snapshot_data[0] as { data: { href: string; width: number } }).data).toEqual({ href: "https://dandelist.knightaiav.com/auth/callback", width: 390 });
  });

  it("leaves what isn't an address alone", () => {
    expect(bareUrl(undefined)).toBeUndefined();
    expect(bareUrl("not a url?x=1")).toBe("not a url");
    expect(scrub(null)).toBeNull();
  });
});
