import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ API_URL: "https://api.dandelist.knightaiav.com/" }));
import { MCP_URL, lastUsedLine } from "./agent-keys";

describe("agent keys in Settings", () => {
  it("points agents at the API's MCP server", () => {
    expect(MCP_URL).toBe("https://api.dandelist.knightaiav.com/mcp");
  });

  it("says when a key was last used in a few words", () => {
    const now = new Date(2026, 9, 29, 12);
    expect(lastUsedLine(null, now)).toBe("Never used");
    expect(lastUsedLine(new Date(2026, 9, 29, 8).toISOString(), now)).toBe("Used today");
    expect(lastUsedLine(new Date(2026, 9, 28, 23).toISOString(), now)).toBe("Used yesterday");
    expect(lastUsedLine(new Date(2026, 9, 3, 9).toISOString(), now)).toBe("Used 3 Oct");
  });
});
