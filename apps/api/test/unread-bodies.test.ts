import { describe, expect, it, vi } from "vitest";
// Hosts resolve to a public documentation address, so no test touches real DNS.
vi.mock("node:dns/promises", async (importOriginal) => ({ ...(await importOriginal<object>()), lookup: async () => [{ address: "93.184.215.14", family: 4 }] }));
import { readListing } from "../src/dream/pages";
import { getPage, safeGet } from "../src/agent/tools";

/**
 * Every response the agent won't read is let go (2026-11-03): mercedes-amg.com answered a page with a 307 and
 * `Connection: close`, and the redirect's body left unread tripped an assertion in undici's parser when the site closed
 * the socket. Thrown from a socket event, nothing could catch it, and the whole API exited with every hunt in flight.
 */
const answer = (status: number, headers: Record<string, string>, cancelled: string[], name: string) =>
  new Response(new ReadableStream({ pull: (c) => c.enqueue(new TextEncoder().encode("<html>moved</html>")), cancel: () => void cancelled.push(name) }), { status, headers });

describe("responses the agent won't read", () => {
  it("lets go of each redirect's body before following it", async () => {
    const cancelled: string[] = [];
    const web = (async (input: string | URL) => {
      const u = String(input);
      if (u.endsWith("/a")) return answer(301, { location: "https://shop.example/b", "content-type": "text/html" }, cancelled, "301");
      if (u.endsWith("/b")) return answer(307, { location: "/c", "content-type": "text/html", connection: "close" }, cancelled, "307");
      return new Response("<html><title>Here</title></html>", { headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const { res, url } = await safeGet("https://shop.example/a", web, {});
    expect(url.toString()).toBe("https://shop.example/c");
    expect(await res.text()).toContain("Here");
    expect(cancelled).toEqual(["301", "307"]);
    // The listing reader follows its own redirects the same way.
    cancelled.length = 0;
    expect((await readListing("https://shop.example/a", web)).title).toBe("Here");
    expect(cancelled).toEqual(["301", "307"]);
  });

  it("lets go of a body that isn't a web page", async () => {
    const cancelled: string[] = [];
    const web = (async () => answer(200, { "content-type": "application/pdf" }, cancelled, "pdf")) as unknown as typeof fetch;
    expect((await getPage("https://shop.example/brochure", web)).error).toMatch(/Not a web page/);
    expect((await readListing("https://shop.example/brochure", web)).error).toMatch(/Not a web page/);
    expect(cancelled).toEqual(["pdf", "pdf"]);
  });
});
