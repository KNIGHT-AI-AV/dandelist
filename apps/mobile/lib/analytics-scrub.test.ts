import { describe, expect, it } from "vitest";
import { bareUrl, privatePath, scrub } from "./analytics-scrub";

// A made-up ticket: never a real one.
const TICKET = "https://dandelist.knightaiav.com/auth/callback?ticket=SYNTHETIC-TICKET-123#state=abc";
const BARE = "https://dandelist.knightaiav.com/auth/callback";

describe("what the web build sends PostHog (review of #139)", () => {
  it("sends nothing at all from a sign-in page", () => {
    expect(privatePath("/auth/callback")).toBe(true);
    expect(privatePath("/auth")).toBe(true);
    expect(privatePath("/author")).toBe(false);
    expect(scrub({ properties: { $pathname: "/auth/callback", $current_url: TICKET } })).toBeNull();
    expect(scrub({ properties: { $pathname: "/auth/callback", $snapshot_data: [] } })).toBeNull();
  });

  it("cuts every address the SDK attaches, in the shapes posthog-js 1.438.12 sends", () => {
    // A $pageview as the SDK builds it after a visit that began on the sign-in link: the initial and session-entry
    // addresses it keeps in its own storage come along as person properties set once and as event properties.
    const pageview = {
      uuid: "0192",
      event: "$pageview",
      properties: {
        $pathname: "/",
        $current_url: "https://dandelist.knightaiav.com/?ticket=SYNTHETIC-TICKET-123#x",
        $referrer: TICKET,
        $referring_domain: "dandelist.knightaiav.com",
        $session_entry_url: TICKET,
        $session_entry_referrer: TICKET,
        $session_entry_pathname: "/auth/callback",
        $prev_pageview_url: TICKET,
        $set: { $current_url: TICKET },
      },
      $set_once: { $initial_current_url: TICKET, $initial_referrer: TICKET, $initial_pathname: "/auth/callback" },
      $set: { $current_url: TICKET },
    };
    const out = scrub(pageview)!;
    expect(JSON.stringify(out)).not.toContain("SYNTHETIC-TICKET-123");
    expect(out.properties.$current_url).toBe("https://dandelist.knightaiav.com/");
    expect(out.properties.$session_entry_url).toBe(BARE);
    expect(out.$set_once).toEqual({ $initial_current_url: BARE, $initial_referrer: BARE, $initial_pathname: "/auth/callback" });
  });

  it("cuts addresses inside replay data: page records, navigation events and node attributes", () => {
    const snapshot = {
      event: "$snapshot",
      properties: {
        $pathname: "/",
        $snapshot_data: [
          { type: 4, data: { href: TICKET, width: 390, height: 844 } },
          { type: 5, data: { tag: "$pageview", payload: { href: TICKET } } },
          { type: 3, data: { source: 0, attributes: [{ id: 7, attributes: { href: TICKET, "aria-label": "masked" } }] } },
        ],
      },
    };
    const out = scrub(snapshot)!;
    expect(JSON.stringify(out)).not.toContain("SYNTHETIC-TICKET-123");
    expect((out.properties.$snapshot_data as { data: { href?: string; width?: number } }[])[0]!.data).toEqual({ href: BARE, width: 390, height: 844 });
  });

  it("leaves what isn't an address alone", () => {
    expect(bareUrl(undefined)).toBeUndefined();
    expect(bareUrl("not a url?x=1")).toBe("not a url");
    expect(scrub(null)).toBeNull();
    const plain = scrub({ properties: { $pathname: "/", kind: "buy", price: "under 10000" } })!;
    expect(plain.properties).toEqual({ $pathname: "/", kind: "buy", price: "under 10000" });
  });
});
