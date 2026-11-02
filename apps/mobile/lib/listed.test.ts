import { describe, expect, it } from "vitest";
import { asksForPhoto, cardPhoto, cardState, listedWish } from "./listed";

const list = [
  { id: "w1", name: "Leica Q3" },
  { id: "w2", name: "A week at Amanzoe" },
];

describe("a wish card in the chat says where it stands", () => {
  it("is still being worked out until a price lands, and never claims it is on the list meanwhile", () => {
    expect(cardState({ landed: false, failed: false, listedId: null })).toBe("working");
    // An older wish of the same name is on the list, but this card doesn't know what its thing is yet.
    expect(cardState({ landed: false, failed: false, listedId: "w1" })).toBe("working");
  });

  it("offers the list once priced, and says added once it is there", () => {
    expect(cardState({ landed: true, failed: false, listedId: null })).toBe("ready");
    expect(cardState({ landed: true, failed: false, listedId: "w1" })).toBe("added");
  });

  it("is stuck when the hunt stopped without a price", () => {
    expect(cardState({ landed: false, failed: true, listedId: null })).toBe("stuck");
  });
});

describe("the wish a card put on the list", () => {
  it("is the one saved from the card while it is still on the list", () => {
    expect(listedWish(list, "w2", ["Leica Q3"])).toBe("w2");
  });

  it("falls back to a wish of the same name when a conversation reopens", () => {
    expect(listedWish(list, undefined, ["  leica   q3 "])).toBe("w1");
    expect(listedWish(list, null, [null, "", "A week at Amanzoe"])).toBe("w2");
  });

  it("counts a wish taken off the list since as not added", () => {
    expect(listedWish(list, "gone", [])).toBeNull();
    expect(listedWish([], "w1", ["Leica Q3"])).toBeNull();
    expect(listedWish(list, undefined, ["Rolex Daytona"])).toBeNull();
  });
});

describe("the photo a chat wish card shows", () => {
  it("is only ever a checked one: the retake's, else the hunt's own", () => {
    expect(cardPhoto({ imageUrl: "https://a/retake.jpg" }, { imageUrl: "https://a/hunt.jpg" })).toBe("https://a/retake.jpg");
    expect(cardPhoto(null, { imageUrl: "https://a/hunt.jpg" })).toBe("https://a/hunt.jpg");
  });

  it("is none while the hunt has no checked photo, so the card waits under frosted glass, and a finished one asks again", () => {
    expect(cardPhoto(null, undefined)).toBeNull();
    expect(cardPhoto(undefined, {})).toBeNull();
  });

});

describe("a finished chat card asks for a photo by itself", () => {
  const card = { option: true, done: true, photo: null, opened: false, asked: false };
  it("once, when it has an option and no photo of any kind", () => {
    expect(asksForPhoto(card)).toBe(true);
    expect(asksForPhoto({ ...card, asked: true })).toBe(false);
  });

  it("not while it hunts, without an option, or with a checked photo", () => {
    expect(asksForPhoto({ ...card, done: false })).toBe(false);
    expect(asksForPhoto({ ...card, option: false })).toBe(false);
    expect(asksForPhoto({ ...card, photo: "https://a/hunt.jpg" })).toBe(false);
  });

  it("not when a page the research opened had a picture, as before, so retakes don't grow", () => {
    expect(asksForPhoto({ ...card, opened: true })).toBe(false);
  });
});
