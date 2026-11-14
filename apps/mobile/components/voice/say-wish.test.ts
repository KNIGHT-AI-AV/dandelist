import { expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Animated: {}, Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("../../lib/motion", () => ({ ease: {}, haptic: {}, native: false, spring: {}, step: {}, useReducedMotion: () => true, usePress: () => ({}) }));
vi.mock("../../lib/theme", () => ({ layout: { control: { icon: 44 } }, type: {}, usePalette: () => ({}) }));
vi.mock("../lux", () => ({ AgentDot: "AgentDot", Eyebrow: "Eyebrow", Glass: "Glass", Icon: "Icon" }));
vi.mock("./use-recorder", () => { throw Error("A disabled voice control must not load the recorder"); });
import { useVoiceWish } from "./say-wish";

it("keeps voice hidden and never records or transcribes even if invoked by an older control", () => {
  const transcribe = vi.fn(), onHeard = vi.fn(), onError = vi.fn();
  const voice = useVoiceWish({ transcribe, onHeard, onError });
  expect(voice.supported).toBe(false); expect(voice.phase).toBe("idle");
  voice.toggle(); voice.cancel();
  expect(onError).toHaveBeenCalledWith("Voice input is unavailable. Type your wish instead.");
  expect(transcribe).not.toHaveBeenCalled(); expect(onHeard).not.toHaveBeenCalled();
});
