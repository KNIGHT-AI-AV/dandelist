import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ status: "signedOut", signIn: vi.fn(async () => true), accept: vi.fn(async () => {}), api: vi.fn() }));
const options = ["apple", "google", "facebook", "github"].map(id => ({ id, native: false, existingOnly: false }));
vi.mock("react-native", () => {
  class Value { setValue() {} stopAnimation() {} interpolate() { return 1; } }
  return { View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator",
    Animated: { Value, View: "AnimatedView", timing: () => ({ start() {}, stop() {} }) },
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1 }, Platform: { OS: "web" }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-apple-authentication", () => ({}));
vi.mock("expo-router", () => ({ Redirect: "Redirect", router: { canGoBack: () => false, replace() {}, push() {} }, useLocalSearchParams: () => ({}) }));
vi.mock("../lib/auth", () => ({ PROVIDER_ORDER: ["apple", "google", "facebook", "github"], providerName: (id: string) => ({ apple: "Apple", google: "Google", facebook: "Facebook", github: "GitHub" })[id],
  useAuth: () => ({ status: h.status, signInWith: h.signIn, signInWithApple: h.signIn, signOut: vi.fn(), api: h.api }), useSignInOptions: () => options,
  signInErrorMessage: () => null }));
vi.mock("../lib/account-consent", () => ({ useAccountConsent: () => ({ state: "required", accept: h.accept, saving: false }) }));
vi.mock("../lib/theme", () => ({ usePalette: () => ({ bg: "#000", bgRgb: "0,0,0", ink: "#fff", ink2: "#ddd", ink3: "#aaa" }),
  useType: () => ({}), type: {}, radius: { control: 16 }, fonts: {}, space: { 4: 4, 24: 24 },
  layout: { gutter: () => 16, control: { icon: 44 }, headerBar: 56, list: 480, column: 480, stack: { tight: 8, base: 16, section: 24 } } }));
vi.mock("../lib/motion", () => ({ ease: {}, native: false, haptic: { error() {}, success() {} }, useReducedMotion: () => true }));
vi.mock("../lib/landmark", () => ({ MAIN: {} }));
vi.mock("../lib/profile", () => ({ unlinkProvider: vi.fn() }));
vi.mock("./consent-gate", () => ({ takeReturn: () => null }));
vi.mock("./atmosphere", () => ({ Atmosphere: "Atmosphere" }));
vi.mock("./welcome/kit", () => ({ Rise: ({ children }: any) => createElement("Rise", null, children) }));
vi.mock("./inputs", () => ({ CODE_LENGTH: 6, isEmail: () => false, Field: "Field", CodeField: "CodeField",
  KeyboardLift: ({ children }: any) => createElement("KeyboardLift", null, children), KeyboardScroll: ({ children }: any) => createElement("KeyboardScroll", null, children) }));
vi.mock("./lux", () => Object.fromEntries(["Backdrop", "Eyebrow", "Grain", "IconButton", "PrimaryButton", "QuietButton", "Shade", "Wordmark", "AgentDot", "ErrorLine", "Glass", "Hairline"].map(name => [name, ({ children, ...props }: any) => createElement(name, props, children)])));
vi.mock("./settings/kit", () => ({ Card: ({ children }: any) => createElement("Card", null, children),
  Row: (props: any) => createElement("Row", props, props.accessory), RowAction: (props: any) => createElement("RowAction", props) }));

const assetRequire = createRequire(import.meta.url), oldSvg = assetRequire.extensions[".svg"], oldJpg = assetRequire.extensions[".jpg"];
assetRequire.extensions[".svg"] = assetRequire.extensions[".jpg"] = module => { module.exports = 1; };
afterAll(() => { if (oldSvg) assetRequire.extensions[".svg"] = oldSvg; else delete assetRequire.extensions[".svg"];
  if (oldJpg) assetRequire.extensions[".jpg"] = oldJpg; else delete assetRequire.extensions[".jpg"]; });
const { SignInOptions } = await import("./sign-in-options");
const { default: SignIn } = await import("../app/sign-in");
const { default: Consent, CONSENT } = await import("../app/consent");
const { LinkedAccounts } = await import("./settings/linked-accounts");
let root: ReactTestRenderer | undefined;
const mount = async (element: any) => { await act(async () => { root = create(element); }); };
const labels = () => root!.root.findAllByType("Pressable" as any).map(n => n.props.accessibilityLabel);
beforeEach(() => { h.status = "signedOut"; h.signIn.mockClear(); h.accept.mockClear(); h.api.mockClear(); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });

it("hides Facebook from onboarding even if a stale or mutated provider list offers it for new users", async () => {
  await mount(createElement(SignInOptions, { options: options as any, pending: null, disabled: false, onChoose: h.signIn }));
  expect(labels()).toEqual(["Continue with Apple", "Continue with Google", "Continue with GitHub"]);
  expect(JSON.stringify(root!.toJSON())).not.toContain("linked Facebook"); expect(h.signIn).not.toHaveBeenCalled();
});
it("makes returning Facebook discoverable on the actual sign-in page, with an explicit linked-account label", async () => {
  await mount(createElement(SignIn));
  expect(labels()).not.toContain("Sign in with linked Facebook");
  const returning = root!.root.findAll(n => (n.type as unknown) === "QuietButton" && n.props.label === "Already linked with Facebook?")[0]!;
  await act(async () => returning.props.onPress()); expect(h.signIn).not.toHaveBeenCalled();
  const button = root!.root.findAllByType("Pressable" as any).find(n => n.props.accessibilityLabel === "Sign in with linked Facebook")!;
  await act(async () => { await button.props.onPress(); }); expect(h.signIn).toHaveBeenCalledWith("facebook");
});
it("offers no new Facebook link in Settings and retains a currently linked identity", async () => {
  await mount(createElement(LinkedAccounts, { identities: [], options: options as any, email: "synthetic@example.com", onChange: vi.fn(), notice: null }));
  expect(root!.root.findAll(n => (n.type as unknown) === "Row" && n.props.label === "Facebook")).toHaveLength(0);
  const fb = { provider: "facebook" as const, email: null, name: null, linkedAt: "2026-11-14T00:00:00Z" };
  await act(async () => root!.update(createElement(LinkedAccounts, { identities: [fb], options: options as any, email: "synthetic@example.com", onChange: vi.fn(), notice: null })));
  expect(root!.root.findAll(n => (n.type as unknown) === "Row" && n.props.label === "Facebook")).toHaveLength(1);
  expect(root!.root.findAll(n => (n.type as unknown) === "RowAction" && n.props.accessibilityLabel === "Link Facebook")).toHaveLength(0);
  expect(h.api).not.toHaveBeenCalled();
});
it("renders the actual consent screen with direct Claude/pilot data facts and preserves the 18+ acceptance action", async () => {
  h.status = "signedIn"; await mount(createElement(Consent));
  const rendered = JSON.stringify(root!.toJSON());
  expect(rendered).toContain("Anthropic's Claude"); expect(rendered).toContain("Photos it checks and page content");
  expect(rendered).toContain("no Meta AI fallback"); expect(rendered).toContain("live web search are unavailable");
  expect(rendered).not.toContain("When Meta is busy"); expect(rendered).not.toContain("Neither gets your name");
  expect(CONSENT.age).toBe("You need to be 18 or older to use it."); expect(CONSENT.agree).toBe("I'm 18 or older and I agree");
  const agree = root!.root.findAll(n => (n.type as unknown) === "PrimaryButton" && n.props.label === CONSENT.agree)[0]!;
  await act(async () => agree.props.onPress()); expect(h.accept).toHaveBeenCalledOnce();
});
