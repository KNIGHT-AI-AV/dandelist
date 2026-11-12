import * as Crypto from "expo-crypto";
import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { PrimaryButton, QuietButton } from "../components/lux";
import { useAccountConsent } from "../lib/account-consent";
import { bindToSignIn, currentSignIn, useAuth } from "../lib/auth";
import { nativeStore } from "../lib/billing/native-store";
import { billingService } from "../lib/billing/service";
import { StoreController, type StoreProduct, type StoreState } from "../lib/billing/store-core";
import copy from "../lib/billing/copy.json";
import { space, type, usePalette } from "../lib/theme";

/** Explicit internal-build lab; ordinary builds redirect and never import or connect the native SDK. */
export default function StoreTest() {
  const auth = useAuth();
  const consent = useAccountConsent();
  const p = usePalette();
  const [catalogue, setCatalogue] = useState<StoreProduct[]>([]);
  const [state, setState] = useState<StoreState>({ status: "idle" });
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const generation = useRef(0);
  const controller = useRef<StoreController | null>(null);
  const current = useRef({ user: auth.user?.id, accepted: consent.state === "accepted", mounted: true });
  current.current = { ...current.current, user: auth.user?.id, accepted: consent.state === "accepted" };
  useEffect(() => {
    current.current.mounted = true;
    setCatalogue([]); setState({ status: "idle" }); setError(false); setBusy(false); working.current = false;
    return () => {
      generation.current++;
      current.current.mounted = false;
      void controller.current?.close().catch(() => undefined); controller.current = null;
    };
  }, [auth.user?.id, consent.state]);
  const enabled = process.env.EXPO_PUBLIC_BILLING_SANDBOX === "1";
  if (!enabled || Platform.OS !== "ios" && Platform.OS !== "android") return <Redirect href="/" />;
  const platform = Platform.OS;
  const valid = auth.status === "signedIn" && !!auth.user && consent.state === "accepted";
  const run = async (operation: () => Promise<void>) => {
    if (working.current || !valid) return;
    const at = generation.current;
    working.current = true;
    setBusy(true); setError(false);
    try { await operation(); } catch { if (current.current.mounted && generation.current === at) setError(true); }
    finally { if (generation.current === at) { working.current = false; if (current.current.mounted) setBusy(false); } }
  };
  const load = async () => {
    const userId = auth.user!.id;
    const at = currentSignIn();
    const isCurrent = () => current.current.mounted && current.current.accepted && current.current.user === userId && currentSignIn() === at;
    const backend = billingService(bindToSignIn(auth.api, at), userId);
    // No store sheet until the service confirms that this platform's verifier is configured.
    if (!await backend.available(platform) || !isCurrent()) throw new Error("Store verifier unavailable");
    await controller.current?.close();
    const next = new StoreController({ enabled, userId, platform, isCurrent,
      accountHash: id => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, id),
      load: () => nativeStore(platform), verify: backend.verify,
      onState: value => { if (isCurrent()) setState(value); },
    });
    controller.current = next;
    const found = await next.list();
    if (isCurrent()) setCatalogue(found);
  };
  return <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: space[24], gap: space[16], maxWidth: 620, width: "100%", alignSelf: "center" }}>
    <Text accessibilityRole="header" style={[type.headline, { color: p.ink }]}>{copy.title}</Text>
    {!valid ? <Text style={[type.body, { color: p.ink2 }]}>{copy.consent}</Text> : <>
      <PrimaryButton label={copy.load} busy={busy} onPress={() => { void run(load); }} />
      <PrimaryButton label={copy.restore} busy={busy} disabled={!controller.current} onPress={() => { void run(async () => { await controller.current!.restore(); }); }} />
      {catalogue.map(product => <View key={product.id} style={{ gap: space[12] }}>
        <Text style={[type.headline, { color: p.ink }]}>{product.title}</Text>
        <Text style={[type.body, { color: p.ink2 }]}>{product.displayPrice}</Text>
        {platform === "ios" ? <>
          {product.trialDays === 14 && <PrimaryButton label={copy.trial} busy={busy} onPress={() => { void run(() => controller.current!.buy(product.id, "trial")); }} />}
          <PrimaryButton label={copy.subscribe} busy={busy} onPress={() => { void run(() => controller.current!.buy(product.id, "subscribe")); }} />
        </> : product.offers.map(offer => <PrimaryButton key={offer.token} label={`${copy.subscribe} · ${offer.displayPrice}`} busy={busy} onPress={() => { void run(() => controller.current!.buy(product.id, "subscribe", offer.token)); }} />)}
      </View>)}
      <Text accessibilityLiveRegion="polite" style={[type.body, { color: p.ink2 }]}>{error ? copy.service : copy[state.status]}</Text>
    </>}
    <QuietButton label={copy.close} onPress={() => router.replace("/")} />
  </ScrollView>;
}
