import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import copy from "./copy.json";
import { STORE_PRODUCTS } from "./store-core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({
  platform: "ios", status: "signedIn", user: "11111111-2222-4333-8444-555555555555", consent: "accepted", signIn: 1,
  api: vi.fn(), native: vi.fn(), close: vi.fn(), connect: vi.fn(), buy: vi.fn(),
}));
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA256" }, digestStringAsync: async () => "a".repeat(64) }));
vi.mock("expo-router", () => ({ Redirect: (props: object) => createElement("Redirect", props), router: { replace: vi.fn() } }));
vi.mock("react-native", () => ({ Platform: { get OS() { return h.platform; } }, ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("../auth", () => ({ useAuth: () => ({ status: h.status, user: h.user ? { id: h.user } : null, api: h.api }), currentSignIn: () => h.signIn, bindToSignIn: (api: unknown) => api }));
vi.mock("../account-consent", () => ({ useAccountConsent: () => ({ state: h.consent }) }));
vi.mock("../theme", () => ({ space: { 12: 12, 16: 16, 24: 24 }, type: {}, usePalette: () => ({}) }));
vi.mock("../../components/lux", () => ({ PrimaryButton: (props: object) => createElement("Button", props), QuietButton: (props: object) => createElement("Button", props) }));
vi.mock("./native-store", () => ({ nativeStore: h.native }));
const { default: StoreTest } = await import("../../app/store-test");
let root: ReactTestRenderer | undefined;
const mount = async () => { await act(async () => { if (root) root.update(createElement(StoreTest)); else root = create(createElement(StoreTest)); }); };
const button = (label: string) => root!.root.findAll(n => n.type === "Button" as never).find(n => n.props.label === label)!;
const press = async (label: string) => { await act(async () => { button(label).props.onPress(); }); };
beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_BILLING_SANDBOX", "1");
  Object.assign(h, { platform: "ios", status: "signedIn", user: "11111111-2222-4333-8444-555555555555", consent: "accepted", signIn: 1 });
  vi.clearAllMocks();
  h.api.mockImplementation(async () => Response.json({ stores: { ios: true, android: true } }));
  h.native.mockImplementation(async () => ({ connect: h.connect, close: h.close, products: async () => [{ id: STORE_PRODUCTS.monthly, title: "Monthly", displayPrice: "$9.99", trialDays: 14, offers: [] }], buy: h.buy, eligibleForTrial: async () => true }));
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; vi.unstubAllEnvs(); });
it.each(["", "0"])("ordinary builds redirect without loading a store or calling the service (%s)", async flag => {
  vi.stubEnv("EXPO_PUBLIC_BILLING_SANDBOX", flag); await mount();
  expect(root!.root.findByType("Redirect" as never).props.href).toBe("/"); expect(h.api).not.toHaveBeenCalled(); expect(h.native).not.toHaveBeenCalled();
});
it("web never imports or connects the native billing SDK", async () => { h.platform = "web"; await mount(); expect(h.native).not.toHaveBeenCalled(); expect(h.api).not.toHaveBeenCalled(); });
it.each(["required", "checking", "failed"])("no store work occurs before account consent (%s)", async consent => {
  h.consent = consent; await mount(); expect(button(copy.load)).toBeUndefined(); expect(h.native).not.toHaveBeenCalled(); expect(h.api).not.toHaveBeenCalled();
});
it("an unavailable verifier cannot open a store connection or purchase sheet", async () => {
  h.api.mockResolvedValueOnce(new Response(null, { status: 404 })); await mount(); await press(copy.load);
  expect(h.native).not.toHaveBeenCalled(); expect(JSON.stringify(root!.toJSON())).toContain(copy.service);
});
it("checking platform readiness precedes the native connection and localized product display", async () => {
  await mount(); await press(copy.load); expect(h.api).toHaveBeenCalledWith("/me/billing/", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(h.native).toHaveBeenCalledWith("ios"); expect(h.connect).toHaveBeenCalledTimes(1); expect(JSON.stringify(root!.toJSON())).toContain("$9.99");
});
it("a sign-in change clears old products and closes that account's connection", async () => {
  await mount(); await press(copy.load); h.user = "aaaaaaaa-2222-4333-8444-555555555555"; h.signIn++; await mount();
  expect(h.close).toHaveBeenCalledTimes(1); expect(JSON.stringify(root!.toJSON())).not.toContain("$9.99"); expect(button(copy.restore).props.disabled).toBe(true);
});
it("a delayed readiness reply after sign-in changes never loads the store", async () => {
  let resolve!: (r: Response) => void; h.api.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
  await mount(); await press(copy.load); h.signIn++; h.user = "aaaaaaaa-2222-4333-8444-555555555555"; await mount();
  await act(async () => resolve(Response.json({ stores: { ios: true } }))); expect(h.native).not.toHaveBeenCalled();
  expect(JSON.stringify(root!.toJSON())).not.toContain(copy.service);
});
