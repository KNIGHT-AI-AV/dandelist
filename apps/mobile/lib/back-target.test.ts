import { describe, expect, it } from "vitest";
import { welcomeBack } from "./back-target";

describe("Android's Back on the guest welcome", () => {
  it("steps the page back while it can, and leaves from the first step", () => {
    expect(welcomeBack({ sheet: false, canGoBack: true })).toBe("step");
    expect(welcomeBack({ sheet: false, canGoBack: false })).toBe("leave");
  });

  it("is the save sheet's while the sheet is up, even where the page could step back (#212's review)", () => {
    expect(welcomeBack({ sheet: true, canGoBack: true })).toBe("sheet");
    expect(welcomeBack({ sheet: true, canGoBack: false })).toBe("sheet");
  });
});
